import React from "../apps/cli/node_modules/react/index.js";
import { renderToString } from "../apps/cli/node_modules/ink/build/index.js";
import { render } from "../apps/cli/node_modules/ink-testing-library/build/index.js";
import { describe, expect, it, vi } from "vitest";
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
      id: "review-pending:run_27984312-fc9a-46bf-9ccf-c06997187091",
      type: "review_pending",
      timestamp: "2026-05-29T12:05:00.000Z",
      author: "@codex",
      content: "awaiting review - open [V]iew for details",
      agent: "codex",
      runId: "run_27984312-fc9a-46bf-9ccf-c06997187091",
      statusLabel: "awaiting review"
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

    expect(output).toContain("TUI Project · @codex");
    expect(output).toContain("user");
    expect(output).toContain("Check the TUI shell.");
    expect(output).toContain("@codex run_27984312 △ awaiting review");
    expect(output).toContain("open [V]iew for details");
    expect(output).not.toContain("checks 0/0/1");
    expect(output).toContain("C continue");
    expect(output).toContain("send @codex  thread Review (#review)  context runtime");
    expect(output).toContain("> @codex prompt");
    expect(output.indexOf("> @codex prompt")).toBeLessThan(output.indexOf("W Work"));
    expect(output).toContain("Team");
    expect(output).not.toContain("[E]am");
    expect(output).not.toContain("Runs + Review");
    expect(output).not.toContain("-- more hidden --");
  });

  it("keeps the narrow footer and tab row compact", () => {
    const output = renderToString(
      React.createElement(TuiInkFrame, {
        model: baseModel,
        state: createInitialInkState(),
        terminal: { columns: 48, rows: 20 }
      }),
      { columns: 48 }
    );
    const footerLine = output
      .split("\n")
      .find((value) => value.startsWith("keys:"));

    expect(output).toContain("W R V G T M Team ?");
    expect(output).toContain("keys: type | : cmd | ? | x");
    expect(output).not.toContain("[E]am");
    expect(output).not.toContain("agent-hub team roles list --project-id project_1");
    expect(footerLine?.length ?? 0).toBeLessThanOrEqual(48);
  });

  it("renders attention items in priority order and narrows to the highest item", () => {
    const wideOutput = renderToString(
      React.createElement(TuiInkFrame, {
        model: baseModel,
        state: createInitialInkState(),
        terminal: { columns: 120, rows: 32 }
      }),
      { columns: 120 }
    );
    const narrowOutput = renderToString(
      React.createElement(TuiInkFrame, {
        model: baseModel,
        state: createInitialInkState(),
        terminal: { columns: 48, rows: 20 }
      }),
      { columns: 48 }
    );

    expect(wideOutput).toContain("attention: risk blocking 1 G");
    expect(wideOutput.indexOf("risk blocking 1 G")).toBeLessThan(wideOutput.indexOf("review pending 1 V"));
    expect(wideOutput.indexOf("review pending 1 V")).toBeLessThan(wideOutput.indexOf("memory proposed 1 M"));
    expect(narrowOutput).toContain("attn: risk blocking 1 | : more");
    expect(narrowOutput).not.toContain("review pending 1 V");
  });

  it("surfaces failed checks, waiting RoleCalls, and unavailable executors", () => {
    const output = renderToString(
      React.createElement(TuiInkFrame, {
        model: {
          ...baseModel,
          runs: [
            {
              ...baseModel.runs[0],
              reviewDecision: { status: "accepted" },
              evidence: {
                latestEvent: "tests failed",
                checks: { passed: 0, failed: 2, skipped: 0, failedNames: ["pnpm test", "pnpm lint"] },
                risk: { level: "low", primaryReason: "tests failed" },
                diff: { changedFiles: 1, insertions: 1, deletions: 0 }
              }
            }
          ],
          roleCalls: {
            ...baseModel.roleCalls,
            loop: {
              ...baseModel.roleCalls.loop,
              stopReason: "waiting_approval",
              waitingRoleCallIds: ["call_waiting_approval"]
            }
          },
          tasks: [
            {
              id: "task_executor",
              title: "Configure reviewer",
              status: "open",
              updatedAt: "2026-05-29T12:10:00.000Z",
              assignmentCount: 1,
              executableAssignmentCount: 0,
              assignments: [
                {
                  id: "assignment_reviewer",
                  label: "Reviewer",
                  executable: false,
                  status: "queued"
                }
              ],
              roleTodos: [],
              followUps: []
            }
          ],
          review: {
            ...baseModel.review,
            evidence: {}
          },
          memory: {
            ...baseModel.memory,
            counts: { proposed: 0, approved: 1, rejected: 0 }
          }
        },
        state: createInitialInkState(),
        terminal: { columns: 120, rows: 32 }
      }),
      { columns: 120 }
    );

    expect(output).toContain("attention: checks failed 2 R | waiting approval 1 G | executor unavailable 1 T");
  });

  it("hides the attention strip for healthy contexts", () => {
    const output = renderToString(
      React.createElement(TuiInkFrame, {
        model: {
          ...baseModel,
          conversation: [],
          activeRuns: [],
          runs: [
            {
              ...baseModel.runs[0],
              reviewDecision: { status: "accepted" },
              evidence: {
                latestEvent: "Run completed.",
                checks: { passed: 1, failed: 0, skipped: 0, failedNames: [] },
                risk: { level: "low" },
                diff: { changedFiles: 1, insertions: 1, deletions: 0 }
              }
            }
          ],
          roleCalls: {
            ...baseModel.roleCalls,
            loop: {
              ...baseModel.roleCalls.loop,
              stopReason: "none",
              waitingRoleCallIds: []
            }
          },
          tasks: [],
          team: {
            ...baseModel.team,
            roles: [baseModel.team.roles[0]],
            counts: { total: 1, enabled: 1, runnable: 1, reserved: 0, custom: 0, presetOverrides: 0 }
          },
          review: {
            ...baseModel.review,
            evidence: {}
          },
          memory: {
            ...baseModel.memory,
            counts: { proposed: 0, approved: 1, rejected: 0 }
          }
        },
        state: createInitialInkState(),
        terminal: { columns: 100, rows: 32 }
      }),
      { columns: 100 }
    );

    expect(output).not.toContain("attention:");
    expect(output).not.toContain("attn:");
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

    expect(output).toContain("@codex run_active ⠋ running");
    expect(output).toContain("Reading logout.ts");
    expect(output).not.toContain("checks 1/0/0");
    expect(output).toContain("▍");
  });

  it("renders role display handles for active and review-pending runs", () => {
    const output = renderToString(
      React.createElement(TuiInkFrame, {
        model: {
          ...modelWithActiveRun(),
          conversation: [
            {
              ...baseModel.conversation[1],
              displayHandle: "implementer",
              outputLines: ["Patched auth.ts"],
              verificationLine: "verification passed (1 checks)"
            }
          ],
          activeRuns: [
            {
              ...modelWithActiveRun().activeRuns[0],
              displayHandle: "reviewer"
            }
          ]
        },
        state: createInitialInkState(),
        terminal: { columns: 100, rows: 32 }
      }),
      { columns: 100 }
    );

    expect(output).toContain("@implementer run_27984312 △ awaiting review");
    expect(output).toContain("Patched auth.ts");
    expect(output).toContain("△ awaiting review");
    expect(output).toContain("@reviewer run_active ⠋ running");
  });

  it("renders active run liveliness with spinner, fixed rounded box, metadata, and progress", () => {
    const output = renderToString(
      React.createElement(TuiInkFrame, {
        model: {
          ...baseModel,
          conversation: [],
          activeRuns: [
            {
              runId: "run_live",
              agent: "codex",
              displayHandle: "engineer",
              title: "@engineer run_live ● running",
              elapsedLabel: "12s",
              usageLabel: "42k tok",
              outputLines: [
                "Reading src/auth.ts",
                "Running pnpm test",
                "Step 2/5",
                "Still checking"
              ]
            }
          ]
        },
        state: createInitialInkState(),
        terminal: { columns: 78, rows: 32 },
        animationTick: 4
      }),
      { columns: 78 }
    );

    expect(output).toContain("╭─ @engineer run_live ⠼ running 12s 42k tok");
    expect(output).toContain("│ Reading src/auth.ts");
    expect(output).toContain("│ Running pnpm test");
    expect(output).toContain("2/5");
    expect(output).toContain("╰");
    const boxLines = output
      .split("\n")
      .filter((value) => value.startsWith("╭") || value.startsWith("│") || value.startsWith("╰"));
    expect(boxLines).toHaveLength(8);
  });

  it("marks old active runs as stale only when no useful output is visible", () => {
    const model = {
      ...baseModel,
      conversation: [],
      runs: [],
      roleCalls: {
        ...baseModel.roleCalls,
        loop: {
          ...baseModel.roleCalls.loop,
          stopReason: "none"
        }
      },
      team: {
        ...baseModel.team,
        roles: [baseModel.team.roles[0]],
        counts: { total: 1, enabled: 1, runnable: 1, reserved: 0, custom: 0, presetOverrides: 0 }
      },
      memory: {
        ...baseModel.memory,
        counts: { proposed: 0, approved: 1, rejected: 0 }
      },
      activeRuns: [
        {
          runId: "run_stale_active",
          agent: "codex",
          displayHandle: "engineer",
          title: "@engineer run_stale_active ● running",
          startedAt: "2000-01-01T00:00:00.000Z",
          outputLines: ["agent thinking..."]
        }
      ],
      review: {
        ...baseModel.review,
        evidence: {}
      }
    };
    const staleOutput = renderToString(
      React.createElement(TuiInkFrame, {
        model,
        state: createInitialInkState(),
        terminal: { columns: 100, rows: 32 }
      }),
      { columns: 100 }
    );
    const usefulOutput = renderToString(
      React.createElement(TuiInkFrame, {
        model: {
          ...model,
          activeRuns: [
            {
              ...model.activeRuns[0],
              outputLines: ["Running pnpm test"]
            }
          ]
        },
        state: createInitialInkState(),
        terminal: { columns: 100, rows: 32 }
      }),
      { columns: 100 }
    );

    expect(staleOutput).toContain("attention: stale run 1 R");
    expect(staleOutput).toContain("running stale");
    expect(usefulOutput).not.toContain("stale run");
    expect(usefulOutput).not.toContain("running stale");
  });

  it("wraps active agent output without truncating content", () => {
    const longLine = `agent output ${"x".repeat(90)} complete`;
    const output = renderToString(
      React.createElement(TuiInkFrame, {
        model: {
          ...baseModel,
          conversation: [],
          activeRuns: [
            {
              runId: "run_wrap",
              agent: "codex",
              displayHandle: "engineer",
              title: "@engineer run_wrap ● running",
              outputLines: [longLine]
            }
          ]
        },
        state: createInitialInkState(),
        terminal: { columns: 60, rows: 40 }
      }),
      { columns: 60 }
    );

    expect(output).toContain("agent output");
    expect(output).toContain("complete");
    expect(output).toContain("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
    const boxLines = output
      .split("\n")
      .filter((value) => value.startsWith("│"));
    expect(boxLines.join("\n")).not.toContain("...");
  });

  it("keeps Work structure coherent across explicit width budgets", () => {
    const model = {
      ...baseModel,
      conversation: [
        {
          id: "message:narrow-user",
          sequence: 0,
          role: "user",
          kind: "text",
          author: "user",
          content: "Please inspect the renderer budget with a deliberately long prompt at small widths before shipping.",
          createdAt: "2026-05-29T12:00:00.000Z",
          type: "user_message",
          timestamp: "2026-05-29T12:00:00.000Z"
        },
        {
          id: "run:narrow-agent",
          type: "agent_completed",
          timestamp: "2026-05-29T12:05:00.000Z",
          author: "@codex",
          agent: "codex",
          runId: "run_narrow_agent",
          statusLabel: "completed",
          outputLines: [
            "agent output keeps a structural prefix when this deliberately long sentence wraps across narrow terminal rows.",
            "```",
            "const structuralPrefix = true;",
            "```"
          ]
        }
      ],
      activeRuns: [
        {
          runId: "run_active_budget",
          agent: "codex",
          displayHandle: "engineer",
          title: "@engineer run_active_budget ● running",
          outputLines: [
            "Reading src/very-long-renderer-budget-file-name.ts",
            "Step 2/5"
          ]
        }
      ]
    };

    for (const columns of [48, 64, 80, 120]) {
      const output = renderToString(
        React.createElement(TuiInkFrame, {
          model,
          state: createInitialInkState(),
          terminal: { columns, rows: columns === 48 ? 20 : 24 }
        }),
        { columns }
      );
      const lines = output.split("\n");

      expect(output).toContain("> @codex prompt");
      expect(output).toContain("keys:");
      expect(output).toContain(columns < 56 ? "W R V G T M Team ?" : columns < 84 ? "W Work" : "[W]ork");
      expect(lines.some((value) => value.startsWith(" this deliberately"))).toBe(false);
      expect(lines.every((value) => value.length <= columns)).toBe(true);
    }

    const narrowOutput = renderToString(
      React.createElement(TuiInkFrame, {
        model,
        state: createInitialInkState(),
        terminal: { columns: 48, rows: 20 }
      }),
      { columns: 48 }
    );
    const narrowBoxLines = narrowOutput
      .split("\n")
      .filter((value) => value.startsWith("╭") || value.startsWith("│") || value.startsWith("╰"));

    expect(narrowBoxLines).toHaveLength(4);
    expect(narrowOutput).toContain("│ Step 2/5");
  });

  it("caps chatty active run boxes to preserve terminal row budget", () => {
    const output = renderToString(
      React.createElement(TuiInkFrame, {
        model: {
          ...baseModel,
          conversation: [],
          activeRuns: [
            {
              runId: "run_chatty",
              agent: "codex",
              displayHandle: "engineer",
              title: "@engineer run_chatty ● running",
              outputLines: Array.from({ length: 30 }, (_value, index) => `active output line ${index}`)
            }
          ]
        },
        state: createInitialInkState(),
        terminal: { columns: 78, rows: 20 }
      }),
      { columns: 78 }
    );

    const boxLines = output
      .split("\n")
      .filter((value) => value.startsWith("╭") || value.startsWith("│") || value.startsWith("╰"));
    expect(output.split("\n").length).toBeLessThanOrEqual(20);
    expect(boxLines).toHaveLength(8);
    expect(output).toContain("older lines hidden");
    expect(output).toContain("active output line 29");
    expect(output).not.toContain("active output line 0");
  });

  it("keeps long completed agent output below fixed Work chrome", () => {
    const rows = 20;
    const output = renderToString(
      React.createElement(TuiInkFrame, {
        model: {
          ...baseModel,
          activeRuns: [],
          conversation: [
            {
              id: "message:long-user",
              type: "user_message",
              timestamp: "2026-05-29T12:00:00.000Z",
              author: "user",
              content: "Summarize the long run output."
            },
            {
              id: "run:long-agent",
              type: "agent_completed",
              timestamp: "2026-05-29T12:05:00.000Z",
              author: "@codex",
              agent: "codex",
              runId: "run_long_agent",
              statusLabel: "completed",
              outputLines: Array.from({ length: 40 }, (_value, index) => `agent output line ${index}`)
            }
          ]
        },
        state: createInitialInkState(),
        terminal: { columns: 78, rows }
      }),
      { columns: 78 }
    );
    const renderedLines = output.split("\n");

    expect(renderedLines).toHaveLength(rows);
    expect(output).toContain("attention:");
    expect(output).toContain("agent output line 39");
    expect(output).not.toContain("agent output line 0");
    expect(output).toContain("> @codex prompt");
    expect(output).toContain("keys:");
  });

  it("collapses older active runs and keeps at most three full boxes", () => {
    const output = renderToString(
      React.createElement(TuiInkFrame, {
        model: {
          ...baseModel,
          conversation: [],
          activeRuns: Array.from({ length: 5 }, (_value, index) => ({
            runId: `run_active_${index}`,
            agent: "codex",
            title: `@codex run_active_${index} ● running`,
            outputLines: [`active ${index}`]
          }))
        },
        state: createInitialInkState(),
        terminal: { columns: 100, rows: 60 }
      }),
      { columns: 100 }
    );

    expect(output.match(/\.\.\./g)?.length).toBe(2);
    expect(output.match(/╭─ @codex run_active_/g)?.length).toBe(3);
  });

  it("renders transient failure feedback when supplied by renderer state", () => {
    const output = renderToString(
      React.createElement(TuiInkFrame, {
        model: {
          ...baseModel,
          conversation: [
            {
              id: "run:run_fail",
              type: "agent_failed",
              timestamp: "2026-05-29T12:06:00.000Z",
              author: "@codex",
              agent: "codex",
              runId: "run_fail",
              statusLabel: "failed",
              outputLines: ["tests failed"]
            }
          ]
        },
        state: createInitialInkState(),
        terminal: { columns: 100, rows: 32 },
        feedbackByRunId: { run_fail: "failure" }
      }),
      { columns: 100 }
    );

    expect(output).toContain("┃ !! @codex run_fail ✗ failed");
  });

  it("renders Phase 5A terminal visual grammar in the conversation flow", () => {
    const output = renderToString(
      React.createElement(TuiInkFrame, {
        model: {
          ...baseModel,
          conversation: [
            {
              id: "message:visual_user",
              type: "user_message",
              timestamp: "2026-05-29T12:00:00.000Z",
              author: "user",
              content: "Inspect src/auth.ts:42 and run pnpm test."
            },
            {
              id: "run:run_abcdef12-0000-4000-9000-000000000000",
              type: "agent_completed",
              timestamp: "2026-05-29T12:06:00.000Z",
              author: "@reviewer",
              displayHandle: "reviewer",
              agent: "codex",
              runId: "run_abcdef12-0000-4000-9000-000000000000",
              statusLabel: "completed",
              elapsedLabel: "1m30s",
              usageLabel: "92k tok / $0.03",
              outputLines: [
                "src/auth.ts:42 needs the guard.",
                "pnpm test tests/auth.test.ts",
                "```ts",
                "const message = \"ok\"; // comment",
                "```"
              ]
            }
          ]
        },
        state: createInitialInkState(),
        terminal: { columns: 120, rows: 40 }
      }),
      { columns: 120 }
    );

    expect(output).toContain("◈ TUI Project · @codex");
    expect(output).toContain("user 12:00:00");
    expect(output).toContain("Inspect src/auth.ts:42 and run pnpm test.");
    expect(output).toContain("┃ @reviewer run_abcdef12 ✓ completed  1m30s  92k tok / $0.03  12:06:00");
    expect(output).toContain("┃   src/auth.ts:42 needs the guard.");
    expect(output).toContain("┃   pnpm test tests/auth.test.ts");
    expect(output).toContain("┃   const message = \"ok\"; // comment");
    expect(output).toContain("── 6m later ──");
    expect(output).not.toContain("more lines");
  });

  it("renders quick reply suggestions and hides them while typing", () => {
    const model = modelWithSuggestions();
    const idleOutput = renderToString(
      React.createElement(TuiInkFrame, {
        model,
        state: createInitialInkState(),
        terminal: { columns: 100, rows: 32 }
      }),
      { columns: 100 }
    );
    const typingOutput = renderToString(
      React.createElement(TuiInkFrame, {
        model,
        state: createInitialInkState("draft"),
        terminal: { columns: 100, rows: 32 }
      }),
      { columns: 100 }
    );

    expect(idleOutput).toContain("┃   [1] Run more tests");
    expect(idleOutput).toContain("┃   [2] Fix verification");
    expect(idleOutput).toContain("┃   [3] Continue");
    expect(typingOutput).not.toContain("[1] Run more tests");
  });

  it("renders inline diff projections and collapses dense pending-review groups", () => {
    const output = renderToString(
      React.createElement(TuiInkFrame, {
        model: {
          ...baseModel,
          conversation: [
            ...Array.from({ length: 4 }, (_value, index) => ({
              id: `review-pending:run_dense_${index}`,
              type: "review_pending",
              timestamp: `2026-05-29T12:0${index}:00.000Z`,
              author: "@codex",
              agent: "codex",
              runId: `run_dense_${index}`,
              statusLabel: "awaiting review",
              outputLines: [`pending ${index}`]
            })),
            {
              id: "run:run_diff",
              type: "agent_completed",
              timestamp: "2026-05-29T12:10:00.000Z",
              author: "@codex",
              agent: "codex",
              runId: "run_diff",
              statusLabel: "completed",
              outputLines: ["patched auth"],
              inlineDiff: inlineDiffFixture()
            }
          ]
        },
        state: createInitialInkState(),
        terminal: { columns: 120, rows: 40 }
      }),
      { columns: 120 }
    );

    expect(output).toContain("4 pending reviews collapsed");
    expect(output).toContain("╭ diff (+1/-1 in 1 files)");
    expect(output).toContain("diff --git a/src/auth.ts b/src/auth.ts");
    expect(output).toContain("-const mode = \"old\";");
    expect(output).toContain("+const mode = \"new\";");
  });

  it("expands review diff details and shows read-only split compare state", () => {
    const output = renderToString(
      React.createElement(TuiInkFrame, {
        model: modelWithReviewDiffAndComparableRuns(),
        state: {
          ...createInitialInkState(),
          focus: "review",
          reviewDiffExpanded: true,
          reviewCompareMode: true
        },
        terminal: { columns: 120, rows: 40 }
      }),
      { columns: 120 }
    );

    expect(output).toContain("diff expanded");
    expect(output).toContain("+const mode = \"new\";");
    expect(output).toContain("split compare (read-only)");
    expect(output).toContain("run_compare_a @codex ok");
    expect(output).toContain("run_compare_b @claude-code ok");
  });

  it("toggles review diff expansion with Enter and Escape", async () => {
    const instance = render(
      React.createElement(TuiInkApp, {
        model: modelWithReviewDiffAndComparableRuns(),
        state: { ...createInitialInkState(), focus: "review" },
        terminal: { columns: 120, rows: 40 },
        interactive: true
      })
    );

    instance.stdin.write("\r");
    await waitForFrame(instance, "Review diff expanded.");
    expect(instance.lastFrame()).toContain("+const mode = \"new\";");

    instance.stdin.write("\u001b");
    await waitForFrame(instance, "Review diff collapsed.");
    expect(instance.lastFrame()).not.toContain("+const mode = \"new\";");
    instance.unmount();
  });

  it("renders search matches without consuming composer text", async () => {
    const instance = render(
      React.createElement(TuiInkApp, {
        model: {
          ...baseModel,
          conversation: [
            {
              id: "message:search",
              type: "user_message",
              timestamp: "2026-05-29T12:00:00.000Z",
              author: "user",
              content: "Inspect src/auth.ts before continuing."
            }
          ]
        },
        state: createInitialInkState("draft"),
        terminal: { columns: 120, rows: 40 },
        interactive: true
      })
    );

    instance.stdin.write("\u0006");
    await waitForFrame(instance, "Search opened.");
    for (const character of "auth") {
      instance.stdin.write(character);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    await waitForFrame(instance, "1/1 matches");
    expect(instance.lastFrame()).toContain("Inspect src/auth.ts before continuing.");

    instance.stdin.write("\u001b");
    await waitForFrame(instance, "Search closed.");
    expect(instance.lastFrame()).toContain("> draft");
    instance.unmount();
  });

  it("opens search from the slash command and restores the prompt surface on escape", async () => {
    const instance = render(
      React.createElement(TuiInkApp, {
        model: baseModel,
        state: createInitialInkState(),
        terminal: { columns: 120, rows: 40 },
        interactive: true
      })
    );

    for (const character of "/search") {
      instance.stdin.write(character);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    instance.stdin.write("\r");
    await waitForFrame(instance, "Search opened.");
    instance.stdin.write("\u001b");
    await waitForFrame(instance, "Search closed.");

    expect(instance.lastFrame()).toContain("> @codex prompt");
    instance.unmount();
  });

  it("filters the command palette and executes safe focus commands", async () => {
    const instance = render(
      React.createElement(TuiInkApp, {
        model: baseModel,
        state: createInitialInkState(),
        terminal: { columns: 120, rows: 40 },
        interactive: true
      })
    );

    instance.stdin.write(":");
    await waitForFrame(instance, "Command Palette");
    for (const character of "review") {
      instance.stdin.write(character);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    await waitForFrame(instance, ":review");
    expect(instance.lastFrame()).toContain("Open Review");

    instance.stdin.write("\r");
    await waitForFrame(instance, "Opened Open Review.");
    expect(instance.lastFrame()).toContain("Selected Run");
    instance.unmount();
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
    expect(output).toContain("Open Work");
    expect(output).toContain("agent-hub team roles list --project-id project_1");
    expect(output).toContain("agent-hub runs show run_27984312-fc9a-46bf-9ccf-c06997187091");
    expect(output).toContain("agent-hub memory list --project-id project_1");
  });

  it("keeps Help workflow entry points visible without terminal overflow", () => {
    for (const columns of [48, 80]) {
      const output = renderToString(
        React.createElement(TuiInkFrame, {
          model: baseModel,
          state: { ...createInitialInkState(), focus: "help" },
          terminal: { columns, rows: 20 }
        }),
        { columns }
      );
      const lines = output.split("\n");

      expect(output).toContain("Help");
      expect(output).toContain(": palette");
      expect(output).toContain("/search");
      expect(output).toContain("/timeline");
      expect(output).toContain("/notify");
      expect(output).toContain("review:");
      expect(output).toContain("prompt:");
      expect(lines.every((value) => value.length <= columns)).toBe(true);
    }
  });

  it("prints focused commands from non-Work panes without editing the composer", async () => {
    const instance = render(
      React.createElement(TuiInkApp, {
        model: baseModel,
        state: { ...createInitialInkState(), focus: "runs" },
        terminal: { columns: 120, rows: 40 },
        interactive: true
      })
    );

    instance.stdin.write("p");
    await waitForFrame(instance, "Status: agent-hub runs show run_27984312");

    expect(instance.lastFrame()).toContain("> @codex prompt");
    expect(instance.lastFrame()).not.toContain("> p");
    instance.unmount();
  });

  it("keeps single-letter command keys available as prompt text in Work", async () => {
    const instance = render(
      React.createElement(TuiInkApp, {
        model: baseModel,
        state: createInitialInkState(),
        terminal: { columns: 120, rows: 40 },
        interactive: true
      })
    );

    instance.stdin.write("p");
    await waitForFrame(instance, "> p");

    expect(instance.lastFrame()).not.toContain("Status: agent-hub");
    instance.unmount();
  });

  it("renders the optional startup splash and badge flash state", () => {
    const output = renderToString(
      React.createElement(TuiInkFrame, {
        model: baseModel,
        state: createInitialInkState(),
        terminal: { columns: 120, rows: 40 },
        showSplash: true,
        badgeFlash: true
      }),
      { columns: 120 }
    );

    expect(output).toContain("Agent Hub TUI");
    expect(output).toContain("! TUI Project · @codex");
  });

  it("keeps interactive startup splash out of the live Ink frame", async () => {
    const instance = render(
      React.createElement(TuiInkApp, {
        model: baseModel,
        state: createInitialInkState(),
        terminal: { columns: 120, rows: 40 },
        interactive: true,
        showSplash: true
      })
    );

    expect(instance.lastFrame()).toContain("TUI Project");
    expect(instance.lastFrame()).not.toContain("Agent Hub TUI");
    instance.unmount();
  });

  it("does not repaint active runs from an internal spinner timer", async () => {
    vi.useFakeTimers();
    const instance = render(
      React.createElement(TuiInkApp, {
        model: modelWithActiveRun(),
        state: createInitialInkState(),
        terminal: { columns: 120, rows: 40 },
        interactive: true
      })
    );

    const firstFrame = instance.lastFrame();
    await vi.advanceTimersByTimeAsync(1_500);

    expect(instance.lastFrame()).toBe(firstFrame);
    instance.unmount();
    vi.useRealTimers();
  });

  it("uses a slower idle polling cadence and keeps active polling responsive", async () => {
    vi.useFakeTimers();
    const idleLoadModel = vi.fn(async () => baseModel);
    const idleInstance = render(
      React.createElement(TuiInkApp, {
        model: baseModel,
        state: createInitialInkState(),
        terminal: { columns: 120, rows: 40 },
        interactive: true,
        loadModel: idleLoadModel,
        pollIntervalMs: 5,
        idlePollIntervalMs: 50
      })
    );

    await vi.advanceTimersByTimeAsync(10);
    expect(idleLoadModel).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(40);
    expect(idleLoadModel).toHaveBeenCalledTimes(1);
    idleInstance.unmount();

    const activeLoadModel = vi.fn(async () => modelWithActiveRun());
    const activeInstance = render(
      React.createElement(TuiInkApp, {
        model: modelWithActiveRun(),
        state: createInitialInkState(),
        terminal: { columns: 120, rows: 40 },
        interactive: true,
        loadModel: activeLoadModel,
        pollIntervalMs: 5,
        idlePollIntervalMs: 50
      })
    );

    await vi.advanceTimersByTimeAsync(5);
    expect(activeLoadModel).toHaveBeenCalledTimes(1);
    activeInstance.unmount();
    vi.useRealTimers();
  });

  it("toggles local notifications and timeline without submitting prompts", async () => {
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

    for (const character of "/notify") {
      instance.stdin.write(character);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    instance.stdin.write("\r");
    await waitForFrame(instance, "Completion notifications enabled.");
    expect(instance.lastFrame()).toContain("notify on");

    instance.stdin.write("L");
    await waitForFrame(instance, "Timeline shown.");
    expect(instance.lastFrame()).toContain("Timeline");
    expect(instance.lastFrame()).toContain("notify on");

    instance.stdin.write("\u001b");
    await waitForFrame(instance, "Timeline hidden.");
    for (const character of "/timeline") {
      instance.stdin.write(character);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    instance.stdin.write("\r");
    await waitForFrame(instance, "Timeline shown.");

    expect(submissions).toEqual([]);
    instance.unmount();
  });

  it("emits completion notifications only for eligible long runs", async () => {
    const notifications = [];
    const activeModel = {
      ...baseModel,
      conversation: [],
      activeRuns: [
        {
          runId: "run_notify",
          agent: "codex",
          startedAt: "2000-01-01T00:00:00.000Z",
          title: "@codex run_notify ● running",
          outputLines: ["Running long verification"]
        }
      ]
    };
    const completedModel = {
      ...baseModel,
      conversation: [
        {
          id: "run:run_notify",
          type: "agent_completed",
          timestamp: "2026-05-29T12:30:00.000Z",
          author: "@codex",
          agent: "codex",
          runId: "run_notify",
          statusLabel: "completed",
          outputLines: ["completed"]
        }
      ],
      activeRuns: []
    };
    const instance = render(
      React.createElement(TuiInkApp, {
        model: activeModel,
        state: { ...createInitialInkState(), notifyEnabled: true },
        terminal: { columns: 120, rows: 40 },
        interactive: true,
        loadModel: async () => completedModel,
        notify: (message) => {
          notifications.push(message);
        },
        pollIntervalMs: 5,
        modelRefreshTimeoutMs: 50
      })
    );

    await waitForCondition(() => notifications.length === 1);

    expect(notifications).toEqual(["Agent Hub run run_notify completed"]);
    instance.unmount();
  });

  it("skips completion notifications for short runs", async () => {
    const notifications = [];
    const activeModel = {
      ...baseModel,
      conversation: [],
      activeRuns: [
        {
          runId: "run_short",
          agent: "codex",
          startedAt: new Date(Date.now() - 1_000).toISOString(),
          title: "@codex run_short ● running",
          outputLines: ["Running quick check"]
        }
      ]
    };
    const completedModel = {
      ...baseModel,
      conversation: [
        {
          id: "run:run_short",
          type: "agent_completed",
          timestamp: "2026-05-29T12:30:00.000Z",
          author: "@codex",
          agent: "codex",
          runId: "run_short",
          statusLabel: "completed",
          outputLines: ["completed"]
        }
      ],
      activeRuns: []
    };
    const instance = render(
      React.createElement(TuiInkApp, {
        model: activeModel,
        state: { ...createInitialInkState(), notifyEnabled: true },
        terminal: { columns: 120, rows: 40 },
        interactive: true,
        loadModel: async () => completedModel,
        notify: (message) => {
          notifications.push(message);
        },
        pollIntervalMs: 5,
        modelRefreshTimeoutMs: 50
      })
    );

    await waitForFrame(instance, "@codex run_short ✓ completed");

    expect(notifications).toEqual([]);
    instance.unmount();
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
    expect(instance.lastFrame()).toContain("@engineer preset runs with codex #planning");
    expect(instance.lastFrame()).toContain("@reviewer preset manual #review");
    expect(instance.lastFrame()).toContain("> @codex prompt");
    instance.unmount();
  });

  it("switches to the Team tab from the tab bar shortcut", async () => {
    const instance = render(
      React.createElement(TuiInkApp, {
        model: baseModel,
        state: createInitialInkState(),
        terminal: { columns: 120, rows: 40 },
        interactive: true
      })
    );

    instance.stdin.write("E");
    await waitForFrame(instance, "Team Roles 2");

    expect(instance.lastFrame()).toContain("Team");
    expect(instance.lastFrame()).not.toContain("[E]am");
    expect(instance.lastFrame()).toContain("@engineer preset runs with codex #planning");
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
    expect(output).toContain("▌ run_0000000a @codex ok");
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
        terminal: { columns: 78, rows: 12 }
      }),
      { columns: 78 }
    );
    const scrolledState = reduceInkState(createInitialInkState(), "page_up", model);
    const scrolledOutput = renderToString(
      React.createElement(TuiInkFrame, {
        model,
        state: scrolledState,
        terminal: { columns: 78, rows: 12 }
      }),
      { columns: 78 }
    );

    expect(bottomOutput).toContain("Transcript message 9");
    expect(bottomOutput).not.toContain("Transcript message 0");
    expect(scrolledOutput).toContain("Transcript message 5");
    expect(scrolledOutput).not.toContain("Transcript message 9");
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
        idlePollIntervalMs: 5,
        modelRefreshTimeoutMs: 50
      })
    );

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(instance.lastFrame()).toContain("@codex run_polled01 ✓ completed");
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
    expect(instance.lastFrame()).toContain("@codex run_12345678 ✓ completed");
    instance.unmount();
  });

  it("submits visible quick replies through the normal prompt callback", async () => {
    const submissions = [];
    const model = modelWithSuggestions();
    const instance = render(
      React.createElement(TuiInkApp, {
        model,
        state: createInitialInkState(),
        terminal: { columns: 120, rows: 40 },
        interactive: true,
        submitPrompt: async (input) => {
          submissions.push(input);
          return { ok: true, message: "Suggestion submitted.", model };
        }
      })
    );

    instance.stdin.write("1");
    await waitForFrame(instance, "Suggestion submitted.");

    expect(submissions).toEqual([
      expect.objectContaining({
        prompt: "Run more targeted tests for run run_suggest and summarize the failures."
      })
    ]);
    instance.unmount();
  });

  it("keeps numeric keys as composer text when a prompt is being edited", async () => {
    const submissions = [];
    const instance = render(
      React.createElement(TuiInkApp, {
        model: modelWithSuggestions(),
        state: createInitialInkState("draft"),
        terminal: { columns: 120, rows: 40 },
        interactive: true,
        submitPrompt: async (input) => {
          submissions.push(input);
          return { ok: true, message: "Submitted prompt.", model: baseModel };
        }
      })
    );

    instance.stdin.write("1");
    await waitForFrame(instance, "> draft1");

    expect(submissions).toEqual([]);
    instance.unmount();
  });

  it("renders composer submit preview and agent completion choices", () => {
    const output = renderToString(
      React.createElement(TuiInkFrame, {
        model: baseModel,
        state: createInitialInkState("@"),
        terminal: { columns: 120, rows: 40 }
      }),
      { columns: 120 }
    );

    expect(output).toContain("send @codex  thread Review (#review)  context runtime");
    expect(output).toContain("agents @codex @claude-code @engineer @reviewer");
  });

  it("accepts role mention completion without trapping normal tab focus", async () => {
    const instance = render(
      React.createElement(TuiInkApp, {
        model: baseModel,
        state: createInitialInkState(),
        terminal: { columns: 120, rows: 40 },
        interactive: true
      })
    );

    for (const character of "@e") {
      instance.stdin.write(character);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    await waitForFrame(instance, "agents @engineer");
    instance.stdin.write("\t");
    await waitForFrame(instance, "Selected @engineer.");

    expect(instance.lastFrame()).toContain("> @engineer");
    expect(instance.lastFrame()).toContain("send @engineer  thread Review (#review)");
    instance.unmount();
  });

  it("keeps submitted prompt history in the current TUI session", async () => {
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

    for (const character of "first prompt") {
      instance.stdin.write(character);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    await waitForFrame(instance, "> first prompt");
    instance.stdin.write("\r");
    await waitForCondition(() => submissions.length === 1);
    await waitForFrame(instance, "> @codex prompt");

    for (const character of "second prompt") {
      instance.stdin.write(character);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    await waitForFrame(instance, "> second prompt");
    instance.stdin.write("\r");
    await waitForCondition(() => submissions.length === 2);
    await waitForFrame(instance, "> @codex prompt");

    instance.stdin.write("\u001b[A");
    await waitForFrame(instance, "History 2/2.");
    expect(instance.lastFrame()).toContain("> second prompt");

    instance.stdin.write("\u001b[A");
    await waitForFrame(instance, "History 1/2.");
    expect(instance.lastFrame()).toContain("> first prompt");
    expect(submissions.map((submission) => submission.prompt)).toEqual([
      "first prompt",
      "second prompt"
    ]);
    instance.unmount();
  });

  it("supports explicit multiline composer editing", async () => {
    const instance = render(
      React.createElement(TuiInkApp, {
        model: baseModel,
        state: createInitialInkState(),
        terminal: { columns: 120, rows: 40 },
        interactive: true
      })
    );

    for (const character of "line one") {
      instance.stdin.write(character);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    instance.stdin.write("\u000f");
    for (const character of "line two") {
      instance.stdin.write(character);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    await waitForFrame(instance, "line two");

    expect(instance.lastFrame()).toContain("> line one");
    expect(instance.lastFrame()).toContain("  line two");
    expect(instance.lastFrame()).toContain("ctrl+o newline");
    instance.unmount();
  });

  it("prepares a continue prompt with uppercase C without submitting", async () => {
    const submissions = [];
    const model = {
      ...baseModel,
      roleCalls: {
        ...baseModel.roleCalls,
        loop: {
          ...baseModel.roleCalls.loop,
          stopReason: "none"
        }
      }
    };
    const instance = render(
      React.createElement(TuiInkApp, {
        model,
        state: createInitialInkState(),
        terminal: { columns: 120, rows: 40 },
        interactive: true,
        submitPrompt: async (input) => {
          submissions.push(input);
          return { ok: true, message: "Submitted prompt.", model };
        }
      })
    );

    instance.stdin.write("C");
    await waitForFrame(instance, "Continuation prompt prepared");

    expect(submissions).toEqual([]);
    expect(instance.lastFrame()).toContain("> Continue the current task with the selected agent.");
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
    expect(instance.lastFrame()).toContain("ctrl+o newline");

    instance.stdin.write("\u001b");
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(instance.lastFrame()).toContain("Composer cleared.");
    expect(instance.lastFrame()).toContain("> @codex prompt");
    instance.unmount();
  });

  it("starts prompt text with lowercase focus-key characters outside Work", async () => {
    const instance = render(
      React.createElement(TuiInkApp, {
        model: baseModel,
        state: { ...createInitialInkState(), focus: "review" },
        terminal: { columns: 120, rows: 40 },
        interactive: true
      })
    );

    for (const character of "what") {
      instance.stdin.write(character);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    expect(instance.lastFrame()).toContain("Selected Run");
    expect(instance.lastFrame()).toContain("> what");
    instance.unmount();
  });

  it("edits composer text at the cursor", async () => {
    const instance = render(
      React.createElement(TuiInkApp, {
        model: baseModel,
        state: createInitialInkState(),
        terminal: { columns: 120, rows: 40 },
        interactive: true
      })
    );

    for (const character of "ac") {
      instance.stdin.write(character);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    instance.stdin.write("\u001b[D");
    await new Promise((resolve) => setTimeout(resolve, 10));
    instance.stdin.write("b");
    await waitForFrame(instance, "> abc");

    instance.stdin.write("\u007f");
    await waitForFrame(instance, "> ac");

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
    expect(instance.lastFrame()).toContain("awaiting review");
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
    reviewDecision: { status: "accepted" },
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
      outputLines: [`Run ${run.id} completed.`],
      agent: run.agentKind,
      runId: run.id,
      statusLabel: "completed",
      verificationLine: "verification passed (1 checks)",
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
      type: message.role === "user" ? "user_message" : "agent_completed",
      timestamp: message.createdAt,
      author: message.author,
      content: message.role === "user" ? message.content : undefined,
      outputLines: message.role === "user" ? undefined : [message.content],
      agent: message.role === "user" ? undefined : "codex",
      statusLabel: message.role === "user" ? undefined : "completed"
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
        title: "@codex run_active ● running",
        outputLines: ["Reading logout.ts", "Running tests"]
      }
    ]
  };
}

function modelWithSuggestions() {
  return {
    ...baseModel,
    conversation: [
      {
        id: "run:run_suggest",
        type: "agent_failed",
        timestamp: "2026-05-29T12:06:00.000Z",
        author: "@codex",
        agent: "codex",
        runId: "run_suggest",
        statusLabel: "failed",
        outputLines: ["tests failed"],
        verificationLine: "verification failed (1 checks: pnpm test)",
        suggestions: [
          {
            key: "1",
            label: "Run more tests",
            prompt: "Run more targeted tests for run run_suggest and summarize the failures."
          },
          {
            key: "2",
            label: "Fix verification",
            prompt: "Fix the verification issues from run run_suggest, then report what changed."
          },
          {
            key: "3",
            label: "Continue",
            prompt: "Continue from run run_suggest with the selected agent."
          }
        ]
      }
    ],
    activeRuns: []
  };
}

function inlineDiffFixture() {
  return {
    mode: "inline",
    summary: "(+1/-1 in 1 files)",
    lines: [
      { kind: "file", text: "diff --git a/src/auth.ts b/src/auth.ts" },
      { kind: "file", text: "@@ -1,3 +1,3 @@" },
      { kind: "context", text: " const keep = true;" },
      { kind: "delete", text: "-const mode = \"old\";" },
      { kind: "add", text: "+const mode = \"new\";" }
    ]
  };
}

function modelWithReviewDiffAndComparableRuns() {
  const runs = [
    {
      ...baseModel.runs[0],
      id: "run_compare_a",
      taskId: "task_compare",
      agentKind: "codex",
      reviewDecision: { status: "pending" }
    },
    {
      ...baseModel.runs[0],
      id: "run_compare_b",
      taskId: "task_compare",
      agentKind: "claude-code",
      reviewDecision: { status: "accepted" }
    }
  ];
  return {
    ...baseModel,
    runs,
    review: {
      ...baseModel.review,
      selectedId: "run_compare_a",
      evidence: {
        ...baseModel.review.evidence,
        linkedRunId: "run_compare_a",
        inlineDiff: inlineDiffFixture()
      }
    }
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

async function waitForCondition(
  condition,
  timeoutMs = 500
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition.");
}
