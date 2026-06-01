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
  it("keeps narrow first screen focused on Runs before empty RoleCalls", () => {
    const output = renderToString(
      React.createElement(TuiInkFrame, {
        model: baseModel,
        state: createInitialInkState(),
        terminal: { columns: 78, rows: 32 }
      }),
      { columns: 78 }
    );

    expect(output).toContain("Agent Hub");
    expect(output.indexOf("Runs")).toBeLessThan(output.indexOf("Review"));
    expect(output.indexOf("Review")).toBeLessThan(output.indexOf("RoleCalls"));
    expect(output).toContain("none | loop stop blocking_risk");
    expect(output).not.toContain("-- more hidden --");
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
    expect(output).toContain("agent-hub runs show run_27984312-fc9a-46bf-9ccf-c06997187091");
    expect(output).toContain("agent-hub memory list --project-id project_1");
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
        terminal: { columns: 120, rows: 40 }
      }),
      { columns: 120 }
    );

    expect(state.scrollOffsets.runs).toBeGreaterThan(0);
    expect(selectedRun(model, state)?.id).toBe("run_0000000a");
    expect(output).toContain("> run_0000000a @codex ok");
    expect(output).not.toContain("run_00000000 @codex ok");
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
    expect(instance.lastFrame()).toContain("run_12345678 @codex ok");
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
    expect(instance.lastFrame()).toContain("esc clear");
    expect(instance.lastFrame()).toContain("ctrl+c exit");

    instance.stdin.write("\u001b");
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(instance.lastFrame()).toContain("Composer cleared.");
    expect(instance.lastFrame()).toContain("> @codex prompt");
    expect(instance.lastFrame()).toContain("x exit");
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
});

function modelWithRuns(ids) {
  const template = baseModel.runs[0];
  return {
    ...baseModel,
    runs: ids.map((id, index) => ({
      ...template,
      id,
      taskId: `task_${index}`,
      taskTitle: `Run ${index}`,
      updatedAt: `2026-05-29T12:${String(index).padStart(2, "0")}:00.000Z`
    }))
  };
}
