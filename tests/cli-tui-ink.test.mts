import React from "../apps/cli/node_modules/react/index.js";
import { renderToString } from "../apps/cli/node_modules/ink/build/index.js";
import { render } from "../apps/cli/node_modules/ink-testing-library/build/index.js";
import { describe, expect, it } from "vitest";
import { TuiInkApp, TuiInkFrame } from "../apps/cli/src/tui-ink/App.mts";
import {
  createInitialInkState,
  reduceInkState,
  selectedRun
} from "../apps/cli/src/tui-ink/state.mts";

const baseModel = {
  context: {
    projectId: "project_1",
    projectName: "TUI Project",
    projectRoot: "/tmp/tui-project",
    threadId: "thread_1",
    threadTitle: "Review",
    roomHandle: "review",
    selectedAgent: "codex",
    contextMode: "runtime_injection"
  },
  transcript: [
    {
      id: "message_1",
      sequence: 0,
      role: "user",
      kind: "text",
      author: "user",
      content: "Check the TUI shell.",
      createdAt: "2026-05-29T12:00:00.000Z"
    }
  ],
  conversation: [
    {
      id: "message:message_1",
      type: "user_message",
      timestamp: "2026-05-29T12:00:00.000Z",
      author: "user",
      content: "Check the TUI shell."
    },
    {
      id: "run:run_27984312-fc9a-46bf-9ccf-c06997187091",
      type: "agent_completed",
      timestamp: "2026-05-29T12:05:00.000Z",
      author: "@codex",
      content: "Codex exited with code 0",
      agent: "codex",
      runId: "run_27984312-fc9a-46bf-9ccf-c06997187091",
      statusLabel: "succeeded",
      verificationLine: "checks 0/0/1",
      riskLine: "risk blocking: No changed files were collected.",
      reviewLine: "review pending: v details"
    }
  ],
  activeRuns: [],
  runs: [
    {
      id: "run_27984312-fc9a-46bf-9ccf-c06997187091",
      taskId: "task_1",
      taskTitle: "Check TUI shell",
      agentKind: "codex",
      status: "succeeded",
      stage: "succeeded",
      startedAt: "2026-05-29T12:00:00.000Z",
      completedAt: "2026-05-29T12:05:00.000Z",
      updatedAt: "2026-05-29T12:05:00.000Z",
      retainedWorktree: true,
      evidence: {
        latestEvent: "Codex exited with code 0",
        checks: { passed: 0, failed: 0, skipped: 1 },
        risk: { level: "blocking", primaryReason: "No changed files were collected." },
        diff: { changedFiles: 0, insertions: 0, deletions: 0 }
      },
      reviewDecision: { status: "pending" },
      commands: [
        "agent-hub runs show run_27984312-fc9a-46bf-9ccf-c06997187091",
        "agent-hub runs diff run_27984312-fc9a-46bf-9ccf-c06997187091 --stat"
      ]
    }
  ],
  roleCalls: {
    nodes: [],
    todos: [],
    counts: {
      total: 0,
      visible: 0,
      active: 0,
      pending: 0,
      waiting: 0,
      failed: 0,
      terminal: 0
    },
    loop: {
      iteration: 0,
      pendingRoleCallIds: [],
      waitingRoleCallIds: [],
      activeRoleCallIds: [],
      stopReason: "blocking_risk",
      convergenceReason: "idle"
    }
  },
  review: {
    kind: "run",
    selectedId: "run_27984312-fc9a-46bf-9ccf-c06997187091",
    title: "Selected Run",
    summary: "Codex exited with code 0",
    evidence: {
      linkedRunId: "run_27984312-fc9a-46bf-9ccf-c06997187091",
      checks: { passed: 0, failed: 0, skipped: 1 },
      risk: { level: "blocking", primaryReason: "No changed files were collected." },
      diff: { changedFiles: 0, insertions: 0, deletions: 0 }
    },
    commands: ["agent-hub risks show run_27984312-fc9a-46bf-9ccf-c06997187091"]
  },
  tasks: [],
  team: {
    projectId: "project_1",
    roles: [
      {
        id: "preset:engineer",
        handle: "engineer",
        displayName: "Engineer",
        source: "preset",
        enabled: true,
        executorKind: "agent_adapter",
        executorLabel: "agent_adapter / codex",
        executorRunnable: true,
        defaultRoom: "planning",
        capabilitySummary: "Implementation, tests, refactoring within task scope.",
        defaultSkillReferences: []
      },
      {
        id: "preset:reviewer",
        handle: "reviewer",
        displayName: "Reviewer",
        source: "preset",
        enabled: true,
        executorKind: "human",
        executorLabel: "human reserved",
        executorRunnable: false,
        defaultRoom: "review",
        capabilitySummary: "Review, risk assessment, verification planning.",
        defaultSkillReferences: [],
        unavailableReason: "Reserved executor is not runnable in this phase."
      }
    ],
    counts: {
      total: 2,
      enabled: 2,
      runnable: 1,
      reserved: 1,
      custom: 0,
      presetOverrides: 0
    },
    command: "agent-hub team roles list --project-id project_1"
  },
  memory: {
    projectId: "project_1",
    counts: { proposed: 1, approved: 1, rejected: 0 },
    command: "agent-hub memory list --project-id project_1",
    approvalCommands: ["agent-hub memory list --project-id project_1"],
    approvedSource: "Agent Hub context store",
    approvalReminder: "Memory approval is explicit."
  },
  skills: {
    contextMode: "runtime_injection",
    runtimeSource: "Agent Hub context store",
    selected: [{ id: "typescript-safety", name: "TypeScript Safety", scope: "global" }],
    available: []
  },
  warnings: []
};

describe("Ink TUI renderer", () => {
  it("renders Work as a conversation terminal instead of an embedded dashboard", () => {
    const output = renderToString(
      React.createElement(TuiInkFrame, {
        model: baseModel,
        state: createInitialInkState(),
        terminal: { columns: 78, rows: 32 }
      }),
      { columns: 78 }
    );

    expect(output).toContain("TUI Project #review · @codex");
    expect(output).toContain("user");
    expect(output).toContain("Check the TUI shell.");
    expect(output).toContain("@codex run_27984312 ✓ succeeded");
    expect(output).toContain("checks 0/0/1");
    expect(output).toContain("risk blocking");
    expect(output).toContain("review pending: v details");
    expect(output).not.toContain("awaiting review");
    expect(output).toContain("> @codex prompt");
    expect(output.indexOf("> @codex prompt")).toBeLessThan(output.indexOf("[W]ork"));
    expect(output).not.toContain("Runs + Review");
    expect(output).not.toContain("-- more hidden --");
  });

  it("renders active run boxes inside Work", () => {
    const output = renderToString(
      React.createElement(TuiInkFrame, {
        model: modelWithActiveRun(),
        state: createInitialInkState(),
        terminal: { columns: 78, rows: 32 }
      }),
      { columns: 78 }
    );

    expect(output).toContain("@codex run_active ● running");
    expect(output).toContain("Reading logout.ts");
    expect(output).toContain("checks 1/0/0");
    expect(output).toContain("▍");
  });

  it("keeps full ids and governed commands inside the command palette", () => {
    const output = renderToString(
      React.createElement(TuiInkFrame, {
        model: baseModel,
        state: { ...createInitialInkState(), commandPaletteOpen: true },
        terminal: { columns: 120, rows: 40 }
      }),
      { columns: 120 }
    );

    expect(output).toContain("Command Palette");
    expect(output).toContain("agent-hub team roles list --project-id project_1");
    expect(output).toContain("agent-hub runs show run_27984312-fc9a-46bf-9ccf-c06997187091");
    expect(output).toContain("agent-hub memory list --project-id project_1");
  });

  it("opens team roles from the slash command without submitting a prompt", async () => {
    const submissions = [];
    const instance = render(
      React.createElement(TuiInkApp, {
        model: baseModel,
        state: createInitialInkState(),
        terminal: { columns: 120, rows: 40 },
        interactive: true,
        submitPrompt: async (input) => {
          submissions.push(input);
          return { ok: true, message: "Submitted prompt.", model: baseModel };
        }
      })
    );

    for (const character of "/team") {
      instance.stdin.write(character);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    instance.stdin.write("\r");

    await waitForFrame(instance, "Team roles shown.");

    expect(submissions).toEqual([]);
    expect(instance.lastFrame()).toContain("Team Roles 2");
    expect(instance.lastFrame()).toContain("@engineer preset agent_adapter / codex #planning");
    expect(instance.lastFrame()).toContain("@reviewer preset human reserved #review");
    expect(instance.lastFrame()).toContain("> @codex prompt");
    instance.unmount();
  });

  it("preserves selected runs by id when refreshed models insert new runs", () => {
    const model = modelWithRuns(["run_00000001", "run_00000002", "run_00000003"]);
    let state = { ...createInitialInkState(), focus: "runs" };

    state = reduceInkState(state, "down", model);
    state = reduceInkState(state, "down", model);

    expect(selectedRun(model, state)?.id).toBe("run_00000003");
    expect(selectedRun(modelWithRuns(["run_99999999", "run_00000001", "run_00000002", "run_00000003"]), state)?.id)
      .toBe("run_00000003");
  });

  it("scrolls the runs pane to keep keyboard selection visible", () => {
    const model = modelWithRuns(
      Array.from({ length: 12 }, (_value, index) => `run_${index.toString(16).padStart(8, "0")}`)
    );
    let state = { ...createInitialInkState(), focus: "runs" };
    for (let index = 0; index < 10; index += 1) {
      state = reduceInkState(state, "down", model);
    }

    const output = renderToString(
      React.createElement(TuiInkFrame, {
        model,
        state,
        terminal: { columns: 120, rows: 22 }
      }),
      { columns: 120 }
    );

    expect(state.scrollOffsets.runs).toBeGreaterThan(0);
    expect(selectedRun(model, state)?.id).toBe("run_0000000a");
    expect(output).toContain("> run_0000000a @codex ok");
    expect(output).not.toContain("run_00000000 @codex ok");
  });

  it("expands run rows when the terminal has enough height", () => {
    const model = modelWithRuns(
      Array.from({ length: 14 }, (_value, index) => `run_${index.toString(16).padStart(8, "0")}`)
    );
    const output = renderToString(
      React.createElement(TuiInkFrame, {
        model,
        state: { ...createInitialInkState(), focus: "runs" },
        terminal: { columns: 120, rows: 60 }
      }),
      { columns: 120 }
    );

    expect(output).toContain("run_0000000d @codex ok");
  });

  it("scrolls conversation history from the work focus", () => {
    const model = modelWithTranscript(10);
    const bottomOutput = renderToString(
      React.createElement(TuiInkFrame, {
        model,
        state: createInitialInkState(),
        terminal: { columns: 78, rows: 24 }
      }),
      { columns: 78 }
    );
    const scrolledState = reduceInkState(createInitialInkState(), "page_up", model);
    const scrolledOutput = renderToString(
      React.createElement(TuiInkFrame, {
        model,
        state: scrolledState,
        terminal: { columns: 78, rows: 24 }
      }),
      { columns: 78 }
    );

    expect(bottomOutput).toContain("Messages 3-10/10");
    expect(bottomOutput).not.toContain("Transcript message 0");
    expect(scrolledOutput).toContain("Messages 1-8/10");
    expect(scrolledOutput).toContain("Transcript message 0");
  });

  it("polls the read model while interactive", async () => {
    const polledModel = modelWithRuns(["run_polled01"]);
    const instance = render(
      React.createElement(TuiInkApp, {
        model: baseModel,
        state: createInitialInkState(),
        terminal: { columns: 120, rows: 40 },
        interactive: true,
        loadModel: async () => polledModel,
        pollIntervalMs: 5,
        modelRefreshTimeoutMs: 50
      })
    );

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(instance.lastFrame()).toContain("@codex run_polled01 ✓ succeeded");
    instance.unmount();
  });

  it("recovers keyboard input after a hung prompt submission timeout", async () => {
    const instance = render(
      React.createElement(TuiInkApp, {
        model: baseModel,
        state: createInitialInkState(),
        terminal: { columns: 120, rows: 40 },
        interactive: true,
        operationTimeoutMs: 5,
        submitPrompt: async () => new Promise<never>(() => undefined)
      })
    );

    for (const character of "hang") {
      instance.stdin.write(character);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    instance.stdin.write("\r");

    await waitForFrame(instance, "Prompt submission timed out after 5ms.");

    for (const character of "next") {
      instance.stdin.write(character);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    await waitForFrame(instance, "> next");
    instance.unmount();
  });

  it("keeps navigation and composer input available during prompt submission", async () => {
    let resolveSubmission;
    const instance = render(
      React.createElement(TuiInkApp, {
        model: baseModel,
        state: createInitialInkState(),
        terminal: { columns: 120, rows: 40 },
        interactive: true,
        operationTimeoutMs: 1_000,
        submitPrompt: async () =>
          new Promise((resolve) => {
            resolveSubmission = resolve;
          })
      })
    );

    for (const character of "long task") {
      instance.stdin.write(character);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    instance.stdin.write("\r");

    await waitForFrame(instance, "Submitting prompt...");
    await waitForFrame(instance, "> @codex prompt");

    instance.stdin.write("\t");
    for (const character of "next") {
      instance.stdin.write(character);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    await waitForFrame(instance, "[R]uns");
    await waitForFrame(instance, "> next");

    resolveSubmission({ ok: true, message: "Submitted prompt.", model: baseModel });

    await waitForFrame(instance, "Submitted prompt.");
    expect(instance.lastFrame()).toContain("> next");
    instance.unmount();
  });

  it("submits composer text without interpreting unknown mentions", async () => {
    const submissions = [];
    const submittedModel = modelWithRuns(["run_12345678"]);
    const instance = render(
      React.createElement(TuiInkApp, {
        model: baseModel,
        state: createInitialInkState(),
        terminal: { columns: 120, rows: 40 },
        interactive: true,
        submitPrompt: async (input) => {
          submissions.push(input);
          return { ok: true, message: "Submitted prompt.", model: submittedModel };
        }
      })
    );

    for (const character of "@unknown summarize") {
      instance.stdin.write(character);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
    instance.stdin.write("\n");
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(submissions).toEqual([
      expect.objectContaining({ prompt: "@unknown summarize" })
    ]);
    expect(instance.lastFrame()).toContain("Submitted prompt.");
    expect(instance.lastFrame()).toContain("@codex run_12345678 ✓ succeeded");
    instance.unmount();
  });

  it("shows composer-specific hints and clears composer with escape", async () => {
    const instance = render(
      React.createElement(TuiInkApp, {
        model: baseModel,
        state: createInitialInkState(),
        terminal: { columns: 120, rows: 40 },
        interactive: true
      })
    );

    for (const character of "exit") {
      instance.stdin.write(character);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(instance.lastFrame()).toContain("> exit");
    expect(instance.lastFrame()).toContain("enter submit");
    expect(instance.lastFrame()).toContain("tab focus");
    expect(instance.lastFrame()).toContain("esc clear");

    instance.stdin.write("\u001b");
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(instance.lastFrame()).toContain("Composer cleared.");
    expect(instance.lastFrame()).toContain("> @codex prompt");
    expect(instance.lastFrame()).toContain("x exit");
    instance.unmount();
  });

  it("keeps tab navigation available while the composer has text", async () => {
    const instance = render(
      React.createElement(TuiInkApp, {
        model: baseModel,
        state: createInitialInkState(),
        terminal: { columns: 120, rows: 40 },
        interactive: true
      })
    );

    for (const character of "draft") {
      instance.stdin.write(character);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    instance.stdin.write("\t");
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(instance.lastFrame()).toContain("[R]uns");
    expect(instance.lastFrame()).toContain("> draft");
    instance.unmount();
  });

  it("submits non-empty composer text with return without switching to review", async () => {
    const submissions = [];
    const instance = render(
      React.createElement(TuiInkApp, {
        model: baseModel,
        state: createInitialInkState(),
        terminal: { columns: 120, rows: 40 },
        interactive: true,
        submitPrompt: async (input) => {
          submissions.push(input);
          return { ok: true, message: "Submitted prompt.", model: baseModel };
        }
      })
    );

    for (const character of "execute command") {
      instance.stdin.write(character);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    instance.stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(submissions).toEqual([
      expect.objectContaining({ prompt: "execute command" })
    ]);
    expect(instance.lastFrame()).toContain("Submitted prompt.");
    expect(instance.lastFrame()).toContain("[W]ork");
    instance.unmount();
  });

  it("records governed review decisions from the selected run", async () => {
    const decisions = [];
    const acceptedModel = {
      ...baseModel,
      runs: [
        {
          ...baseModel.runs[0],
          reviewDecision: { status: "accepted" }
        }
      ]
    };
    const instance = render(
      React.createElement(TuiInkApp, {
        model: baseModel,
        state: { ...createInitialInkState(), focus: "review" },
        terminal: { columns: 120, rows: 40 },
        interactive: true,
        recordReviewDecision: async (input) => {
          decisions.push(input);
          return { ok: true, message: "Review accepted.", model: acceptedModel };
        }
      })
    );

    instance.stdin.write("a");
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(decisions).toEqual([
      expect.objectContaining({
        runId: "run_27984312-fc9a-46bf-9ccf-c06997187091",
        status: "accepted"
      })
    ]);
    expect(instance.lastFrame()).toContain("Review accepted.");
    expect(instance.lastFrame()).toContain("review accepted");
    instance.unmount();
  });

  it("keeps pending-review Work entries prompt-first", async () => {
    const decisions = [];
    const instance = render(
      React.createElement(TuiInkApp, {
        model: baseModel,
        state: createInitialInkState(),
        terminal: { columns: 120, rows: 40 },
        interactive: true,
        recordReviewDecision: async (input) => {
          decisions.push(input);
          return { ok: true, message: "Review accepted.", model: baseModel };
        }
      })
    );

    instance.stdin.write("a");
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(decisions).toEqual([]);
    expect(instance.lastFrame()).toContain("> a");
    expect(instance.lastFrame()).not.toContain("awaiting review");
    instance.unmount();
  });

  it("does not reject review on vim down and requires uppercase R", async () => {
    const decisions = [];
    const rejectedModel = {
      ...baseModel,
      runs: [
        {
          ...baseModel.runs[0],
          reviewDecision: { status: "rejected" }
        }
      ]
    };
    const instance = render(
      React.createElement(TuiInkApp, {
        model: baseModel,
        state: { ...createInitialInkState(), focus: "review" },
        terminal: { columns: 120, rows: 40 },
        interactive: true,
        recordReviewDecision: async (input) => {
          decisions.push(input);
          return { ok: true, message: "Review rejected.", model: rejectedModel };
        }
      })
    );

    instance.stdin.write("j");
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(decisions).toEqual([]);
    expect(instance.lastFrame()).not.toContain("Review rejected.");

    instance.stdin.write("R");
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(decisions).toEqual([
      expect.objectContaining({
        runId: "run_27984312-fc9a-46bf-9ccf-c06997187091",
        status: "rejected"
      })
    ]);
    expect(instance.lastFrame()).toContain("Review rejected.");
    instance.unmount();
  });
});

function modelWithRuns(ids) {
  const template = baseModel.runs[0];
  const runs = ids.map((id, index) => ({
    ...template,
    id,
    taskId: `task_${index}`,
    taskTitle: `Run ${index}`,
    updatedAt: `2026-05-29T12:${String(index).padStart(2, "0")}:00.000Z`
  }));
  return {
    ...baseModel,
    runs,
    activeRuns: [],
    conversation: runs.map((run) => ({
      id: `run:${run.id}`,
      type: "agent_completed",
      timestamp: run.updatedAt,
      author: `@${run.agentKind}`,
      content: `Run ${run.id} completed.`,
      agent: run.agentKind,
      runId: run.id,
      statusLabel: "succeeded",
      verificationLine: "checks 0/0/1",
      riskLine: "risk blocking: No changed files were collected."
    }))
  };
}

function modelWithTranscript(count) {
  const messages = Array.from({ length: count }, (_value, index) => ({
    id: `message_${index}`,
    sequence: index,
    role: index % 2 === 0 ? "user" : "assistant",
    kind: "text",
    author: index % 2 === 0 ? "user" : "codex",
    content: `Transcript message ${index}`,
    createdAt: `2026-05-29T12:${String(index).padStart(2, "0")}:00.000Z`
  }));
  return {
    ...baseModel,
    transcript: messages,
    conversation: messages.map((message) => ({
      id: `message:${message.id}`,
      type: message.role === "user" ? "user_message" : "assistant_message",
      timestamp: message.createdAt,
      author: message.author,
      content: message.content
    })),
    activeRuns: []
  };
}

function modelWithActiveRun() {
  return {
    ...baseModel,
    activeRuns: [
      {
        runId: "run_active",
        agent: "codex",
        state: "running",
        tone: "green",
        title: "@codex run_active ● running",
        outputLines: ["Reading logout.ts", "Running tests"],
        evidenceLines: ["checks 1/0/0", "risk low"],
        createdAt: "2026-05-29T12:06:00.000Z",
        updatedAt: "2026-05-29T12:07:00.000Z"
      }
    ]
  };
}

async function waitForFrame(
  instance,
  expected,
  timeoutMs = 500
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const frame = instance.lastFrame() ?? "";
    if (frame.includes(expected)) {
      return frame;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for frame text: ${expected}`);
}
