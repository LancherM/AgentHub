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
  workBlocks: [
    {
      id: "message:message_1",
      sourceId: "message:message_1",
      sourceKind: "conversation",
      type: "user_message",
      timestamp: "2026-05-29T12:00:00.000Z",
      speaker: "user",
      title: "user message",
      statusIcon: "●",
      statusLabel: undefined,
      statusTone: "normal",
      messageLines: ["Check the TUI shell."],
      toolSummaryLines: [],
      fileRefs: [],
      commandLines: [],
      artifactLines: [],
      evidenceLines: []
    },
    {
      id: "review-pending:run_27984312-fc9a-46bf-9ccf-c06997187091",
      sourceId: "review-pending:run_27984312-fc9a-46bf-9ccf-c06997187091",
      sourceKind: "conversation",
      type: "review_pending",
      timestamp: "2026-05-29T12:05:00.000Z",
      speaker: "@codex",
      title: "@codex run_27984312-fc9a-46bf-9ccf-c06997187091",
      statusIcon: "△",
      statusLabel: "awaiting review",
      statusTone: "warning",
      messageLines: ["awaiting review - open [V]iew for details"],
      toolSummaryLines: [],
      fileRefs: [],
      commandLines: [],
      artifactLines: [],
      evidenceLines: []
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
        purpose: "Implement local code changes through the coding agent path.",
        capabilitySummary: "Implementation, tests, refactoring within task scope.",
        persona: "Careful engineer who keeps changes small, tested, and local-first.",
        defaultInstructions: "Implement only the requested slice.",
        permissions: ["read_project_context", "write_isolated_worktree"],
        contextPolicy: {
          scope: "current_thread_and_project_context",
          includeApprovedMemory: true,
          includeThreadSummary: true,
          instructions: ["Use Agent Hub runtime-injected context only."]
        },
        approvalPolicy: {
          requiredFor: ["memory_approval"],
          summary: "User approval is required for memory approval."
        },
        delegation: {
          canInitiate: true,
          allowedIntentTypes: ["delegate", "request_review"],
          allowedTargets: ["@reviewer"],
          requiresApprovalForTargets: [],
          summary: "enabled intents delegate,request_review; targets @reviewer"
        },
        defaultSkillReferences: [],
        verificationCommands: ["pnpm test"],
        limits: ["keep changes small"],
        tags: ["engineering"],
        activeCallCount: 1,
        recentCallCount: 2,
        recentFailures: ["call_failed failed: Executor failed."],
        nextAction: "monitor 1 active call"
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
        purpose: "Review outputs, checks, risks, and acceptance readiness.",
        capabilitySummary: "Review, risk assessment, verification planning.",
        persona: "Strict reviewer who prioritizes evidence and missing tests.",
        defaultInstructions: "Inspect claims against evidence.",
        permissions: ["read_project_context", "read_run_evidence"],
        contextPolicy: {
          scope: "current_thread_and_project_context",
          includeApprovedMemory: true,
          includeThreadSummary: true,
          instructions: ["Use Agent Hub runtime-injected context only."]
        },
        approvalPolicy: {
          requiredFor: ["external_side_effects"],
          summary: "User approval is required for external effects."
        },
        delegation: {
          canInitiate: false,
          allowedIntentTypes: [],
          allowedTargets: [],
          requiresApprovalForTargets: [],
          summary: "role-call initiation policy not configured",
          unavailableReason: "role-call initiation policy not configured"
        },
        defaultSkillReferences: [],
        verificationCommands: [],
        limits: [],
        tags: ["review"],
        activeCallCount: 1,
        recentCallCount: 2,
        recentFailures: ["call_failed failed: Executor failed."],
        nextAction: "reserved/manual executor",
        unavailableReason: "Reserved executor is not runnable in this phase."
      }
    ],
    delegationMatrixRows: [
      {
        id: "preset:engineer",
        callerRole: "engineer",
        status: "enabled",
        allowedTargets: ["@reviewer"],
        requiresApprovalForTargets: [],
        allowedIntentTypes: ["delegate", "request_review"],
        summary: "enabled intents delegate,request_review; targets @reviewer"
      },
      {
        id: "preset:reviewer",
        callerRole: "reviewer",
        status: "unavailable",
        allowedTargets: [],
        requiresApprovalForTargets: [],
        allowedIntentTypes: [],
        summary: "role-call initiation policy not configured"
      }
    ],
    recentRoleCalls: [
      {
        id: "call_running",
        callerRole: "engineer",
        calleeRole: "reviewer",
        status: "running",
        statusLabel: "running",
        task: "Review retained-run cleanup summary.",
        updatedAt: "2026-05-29T12:05:00.000Z",
        linkedRunId: "run_27984312-fc9a-46bf-9ccf-c06997187091"
      },
      {
        id: "call_failed",
        callerRole: "engineer",
        calleeRole: "reviewer",
        status: "failed",
        statusLabel: "failed",
        task: "Review failed output.",
        updatedAt: "2026-05-29T12:04:00.000Z"
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
    counts: { proposed: 1, approved: 1, rejected: 0, retired: 0 },
    rows: [
      {
        id: "memory_proposed",
        projectId: "project_1",
        category: "workflow_rule",
        status: "proposed",
        confidence: "high",
        sourceRunId: "run_27984312-fc9a-46bf-9ccf-c06997187091",
        sourceTaskId: "task_1",
        summary: "Keep memory approval explicit.",
        updatedAt: "2026-05-29T12:05:00.000Z",
        recommendedAction: "review explicitly",
        evidenceExcerptLines: ["manual review required", "approved memory is injected at runtime"],
        writebackTarget: "memory/approved.md",
        sourceCommands: [
          "agent-hub runs show run_27984312-fc9a-46bf-9ccf-c06997187091",
          "agent-hub task history --task-id task_1"
        ]
      },
      {
        id: "memory_approved",
        projectId: "project_1",
        category: "project_fact",
        status: "approved",
        sourceTaskId: "task_1",
        summary: "Runtime injection is the default context mode.",
        updatedAt: "2026-05-29T12:02:00.000Z",
        recommendedAction: "injected at runtime",
        evidenceExcerptLines: [],
        sourceCommands: ["agent-hub task history --task-id task_1"]
      }
    ],
    command: "agent-hub memory list --project-id project_1",
    approvalCommands: [
      "agent-hub memory list --project-id project_1",
      "agent-hub memory approve --memory-id <memory-id>",
      "agent-hub memory reject --memory-id <memory-id>"
    ],
    approvedSource: "Agent Hub context store",
    approvalReminder: "Memory approval is explicit."
  },
  skills: {
    contextMode: "runtime_injection",
    runtimeSource: "Agent Hub context store",
    selected: [{ id: "typescript-safety", name: "TypeScript Safety", scope: "global" }],
    available: []
  },
  selectionDetails: {
    workBlocks: [
      {
        id: "message:message_1",
        kind: "work_block",
        title: "user message",
        sections: [{ id: "message", title: "Message", lines: ["Check the TUI shell."] }],
        commands: [],
        actions: []
      },
      {
        id: "review-pending:run_27984312-fc9a-46bf-9ccf-c06997187091",
        kind: "work_block",
        title: "@codex run_27984312",
        subtitle: "awaiting review",
        sections: [{ id: "message", title: "Message", lines: ["awaiting review - open [V]iew for details"] }],
        commands: ["agent-hub runs show run_27984312-fc9a-46bf-9ccf-c06997187091"],
        actions: [{ key: "p", label: "Prepare Command", kind: "prepare_command" }]
      }
    ],
    runs: [
      {
        id: "run_27984312-fc9a-46bf-9ccf-c06997187091",
        kind: "run",
        title: "Check TUI shell",
        subtitle: "@codex succeeded",
        sections: [
          { id: "run", title: "Run", lines: ["status succeeded", "stage succeeded"] },
          { id: "evidence", title: "Evidence", tone: "danger", lines: ["risk blocking: No changed files were collected."] }
        ],
        commands: [
          "agent-hub runs show run_27984312-fc9a-46bf-9ccf-c06997187091",
          "agent-hub runs diff run_27984312-fc9a-46bf-9ccf-c06997187091 --stat"
        ],
        actions: [{ key: "V", label: "Open Review", kind: "focus" }]
      }
    ],
    roleCalls: [],
    graph: {
      overlay: [],
      plan: [],
      trace: []
    },
    tasks: [],
    memoryRows: [
      {
        id: "memory_proposed",
        kind: "memory",
        title: "Keep memory approval explicit.",
        subtitle: "proposed workflow_rule",
        sections: [
          {
            id: "memory",
            title: "Memory Text",
            lines: [
              "Keep memory approval explicit.",
              "category workflow_rule",
              "status proposed",
              "confidence high",
              "updated 2026-05-29T12:05:00.000Z"
            ]
          },
          { id: "why", title: "Why It Matters", lines: ["recommended action review explicitly"] },
          {
            id: "evidence",
            title: "Evidence Excerpts",
            lines: ["manual review required", "approved memory is injected at runtime"]
          },
          { id: "writeback", title: "Writeback Target", lines: ["memory/approved.md"] },
          {
            id: "related",
            title: "Related Skills And Memory",
            lines: ["related skills/memory joins not available in current read model"]
          },
          {
            id: "source-commands",
            title: "Source Commands",
            lines: [
              "agent-hub runs show run_27984312-fc9a-46bf-9ccf-c06997187091",
              "agent-hub task history --task-id task_1"
            ],
            collapsedByDefault: true
          }
        ],
        commands: [
          "agent-hub memory list --project-id project_1",
          "agent-hub memory approve --memory-id memory_proposed",
          "agent-hub memory reject --memory-id memory_proposed",
          "agent-hub runs show run_27984312-fc9a-46bf-9ccf-c06997187091",
          "agent-hub task history --task-id task_1"
        ],
        actions: [
          { key: "a", label: "Approve", kind: "callback", disabledReason: "not available in TUI; use the listed CLI command" },
          { key: "R", label: "Reject", kind: "callback", disabledReason: "not available in TUI; use the listed CLI command" },
          { key: "e", label: "Edit", kind: "callback", disabledReason: "not available in TUI; editing requires a separate audited callback" },
          { key: "o", label: "Open Source", kind: "callback", disabledReason: "not available in TUI; use the listed CLI command" }
        ]
      },
      {
        id: "memory_approved",
        kind: "memory",
        title: "Runtime injection is the default context mode.",
        subtitle: "approved project_fact",
        sections: [
          {
            id: "memory",
            title: "Memory Text",
            lines: [
              "Runtime injection is the default context mode.",
              "category project_fact",
              "status approved",
              "updated 2026-05-29T12:02:00.000Z"
            ]
          },
          { id: "why", title: "Why It Matters", lines: ["recommended action injected at runtime"] },
          {
            id: "source-commands",
            title: "Source Commands",
            lines: ["agent-hub task history --task-id task_1"],
            collapsedByDefault: true
          }
        ],
        commands: [
          "agent-hub memory list --project-id project_1",
          "agent-hub memory approve --memory-id memory_approved",
          "agent-hub memory reject --memory-id memory_approved",
          "agent-hub task history --task-id task_1"
        ],
        actions: [
          { key: "a", label: "Approve", kind: "callback", disabledReason: "not available in TUI; use the listed CLI command" },
          { key: "R", label: "Reject", kind: "callback", disabledReason: "not available in TUI; use the listed CLI command" },
          { key: "e", label: "Edit", kind: "callback", disabledReason: "not available in TUI; editing requires a separate audited callback" },
          { key: "o", label: "Open Source", kind: "callback", disabledReason: "not available in TUI; use the listed CLI command" }
        ]
      }
    ],
    teamRoles: [
      {
        id: "preset:engineer",
        kind: "team_role",
        title: "@engineer",
        subtitle: "Engineer",
        sections: [
          { id: "role", title: "Role", lines: ["enabled yes", "executor codex"] },
          { id: "mission-boundaries", title: "Mission And Boundaries", lines: ["persona careful engineer"] },
          { id: "allowed-tools", title: "Allowed Tools And Permissions", lines: ["write_isolated_worktree"] },
          { id: "context-policy", title: "Context Policy", lines: ["scope current_thread_and_project_context"] },
          { id: "delegation", title: "Delegation Matrix", lines: ["enabled intents delegate,request_review; targets @reviewer"] },
          { id: "verification-profile", title: "Verification Profile", lines: ["pnpm test"] },
          { id: "limits", title: "Limits", lines: ["keep changes small"] },
          { id: "recent-failures", title: "Recent Failures", lines: ["call_failed failed: Executor failed."] }
        ],
        commands: [
          "agent-hub team roles list --project-id project_1",
          "agent-hub team roles executor --project-id project_1 --role engineer"
        ],
        actions: [{ key: "p", label: "Prepare Command", kind: "prepare_command" }]
      },
      {
        id: "preset:reviewer",
        kind: "team_role",
        title: "@reviewer",
        subtitle: "Reviewer",
        sections: [
          { id: "role", title: "Role", lines: ["enabled yes", "executor human reserved"] },
          { id: "mission-boundaries", title: "Mission And Boundaries", lines: ["persona strict reviewer"] },
          { id: "allowed-tools", title: "Allowed Tools And Permissions", lines: ["read_run_evidence"] },
          { id: "context-policy", title: "Context Policy", lines: ["scope current_thread_and_project_context"] },
          { id: "delegation", title: "Delegation Matrix", lines: ["role-call initiation policy not configured"] },
          {
            id: "verification-profile",
            title: "Verification Profile",
            lines: ["role-specific verification commands not available in current read model"]
          },
          {
            id: "limits",
            title: "Limits",
            lines: ["role-specific limits not available in current read model"]
          },
          { id: "recent-failures", title: "Recent Failures", lines: ["call_failed failed: Executor failed."] }
        ],
        commands: [
          "agent-hub team roles list --project-id project_1",
          "agent-hub team roles executor --project-id project_1 --role reviewer"
        ],
        actions: [{ key: "p", label: "Prepare Command", kind: "prepare_command" }]
      }
    ],
    memory: {
      id: "memory:project_1",
      kind: "memory",
      title: "Memory Governance",
      sections: [{ id: "counts", title: "Counts", lines: ["proposed 1", "approved 1"] }],
      commands: ["agent-hub memory list --project-id project_1"],
      actions: [{ key: "p", label: "Prepare Command", kind: "prepare_command" }]
    }
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

    expect(output).toContain("AGENT HUB | TUI Project");
    expect(output).toContain("role:@codex");
    expect(output).toContain("user");
    expect(output).toContain("Check the TUI shell.");
    expect(output).toContain("Work - Conversation | Normal | 2 blocks");
    expect(output).toContain("@codex run_27984312");
    expect(output).toContain("| △");
    expect(output).toContain("open [V]iew for details");
    expect(output).not.toContain("checks 0/0/1");
    expect(output).toContain("up/down/j/k move");
    expect(output).toContain("send @codex  thread Review (#review)  context runtime");
    expect(output).toContain("> @codex prompt");
    expect(output.indexOf("> @codex prompt")).toBeLessThan(output.indexOf("keys:"));
    expect(output).toContain("Enter/o detail");
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

    expect(output).toContain("keys: up/down/j/k move");
    expect(output).toContain("Work: 2 blocks");
    expect(output).not.toContain("[E]am");
    expect(output).not.toContain("agent-hub team roles list --project-id project_1");
    expect(footerLine?.length ?? 0).toBeLessThanOrEqual(48);
  });

  it("renders the V3 shell frame coherently at wide, normal, and narrow sizes", () => {
    const cases = [
      { columns: 120, rows: 36, nav: true, detail: true },
      { columns: 80, rows: 24, nav: true, detail: false },
      { columns: 48, rows: 20, nav: false, detail: false }
    ];

    for (const item of cases) {
      const output = renderToString(
        React.createElement(TuiInkFrame, {
          model: baseModel,
          state: createInitialInkState(),
          terminal: { columns: item.columns, rows: item.rows }
        }),
        { columns: item.columns }
      );
      const lines = output.split("\n");

      expect(output).toContain("AGENT HUB");
      if (item.columns >= 80) {
        expect(output).toContain("role:@codex");
      }
      expect(output).toContain("Check the TUI shell.");
      expect(output).toContain("> @codex prompt");
      expect(output).toContain("keys:");
      expect(output).toContain("up/down/j/k move");
      expect(lines.every((value) => value.length <= item.columns)).toBe(true);

      if (item.nav) {
        expect(output).toContain("> Work 2");
        expect(output).toContain("  Runs 1");
      } else {
        expect(output).not.toContain("> Work 2");
      }

      if (item.detail) {
        expect(output).toContain("Block Detail");
        expect(output).toContain("user message");
        expect(output).toContain("Check the TUI shell.");
      } else {
        expect(output).not.toContain("Block Detail");
      }
    }
  });

  it("keeps the workbench height stable across tab switches", () => {
    const terminal = { columns: 120, rows: 28 };
    const focuses = ["work", "graph", "runs", "review", "tasks", "memory", "team", "help"];
    const lineCounts = focuses.map((focus) => {
      const output = renderToString(
        React.createElement(TuiInkFrame, {
          model: baseModel,
          state: { ...createInitialInkState(), focus },
          terminal
        }),
        { columns: terminal.columns }
      );
      return output.split("\n").length;
    });

    expect(new Set(lineCounts).size).toBe(1);
  });

  it("labels the current RoleCall graph as Workflow DAG compatibility evidence", () => {
    const model = {
      ...baseModel,
      roleCalls: {
        ...baseModel.roleCalls,
        nodes: [
          {
            id: "call_trace",
            threadId: "thread_1",
            callerRole: "engineer",
            calleeRole: "reviewer",
            task: "Review execution trace copy.",
            status: "running",
            statusLabel: "running",
            priority: "normal",
            depth: 0,
            linkedRunId: "run_27984312-fc9a-46bf-9ccf-c06997187091",
            createdAt: "2026-05-29T12:00:00.000Z",
            hidden: false,
            evidence: {}
          }
        ],
        counts: {
          ...baseModel.roleCalls.counts,
          total: 1,
          visible: 1,
          active: 1
        },
        loop: {
          ...baseModel.roleCalls.loop,
          stopReason: "pending_role_calls",
          pendingRoleCallIds: ["call_trace"]
        }
      }
    };
    const output = renderToString(
      React.createElement(TuiInkFrame, {
        model,
        state: { ...createInitialInkState(), focus: "graph" },
        terminal: { columns: 120, rows: 28 }
      }),
      { columns: 120 }
    );

    expect(output).toContain("Graph - Workflow DAG");
    expect(output).toContain("legacy RoleCall evidence");
    expect(output).toContain("@engineer -> @reviewer");
    expect(output).toContain("Review execution trace");
  });

  it("renders Plan/Trace/Overlay Workflow DAG modes", () => {
    const model = {
      ...baseModel,
      executionTrace: {
        taskId: "task_1",
        planGraphId: "plan_graph:task_1:v1",
        planGraphVersion: 1,
        baseNodes: [
          {
            id: "plan_node_implement",
            kind: "implement",
            role: "engineer",
            title: "Implement graph view",
            instructions: "Implement the graph view.",
            acceptanceCriteria: ["Graph renders."],
            riskLevel: "low",
            required: true,
            execution: {
              mode: "primary_run",
              expectedAdapter: "fake",
              worktreePolicy: "isolated"
            }
          },
          {
            id: "plan_node_verify",
            kind: "verify",
            role: "reviewer",
            title: "Verify graph view",
            instructions: "Verify the graph view.",
            acceptanceCriteria: ["Graph is inspectable."],
            riskLevel: "medium",
            required: true,
            execution: {
              mode: "manual"
            }
          }
        ],
        baseEdges: [
          {
            from: "plan_node_implement",
            to: "plan_node_verify",
            type: "primary",
            label: "then"
          }
        ],
        dynamicNodes: [
          {
            id: "trace_node:run:run_1",
            planGraphId: "plan_graph:task_1:v1",
            kind: "task_run",
            title: "TaskRun run_1",
            status: "completed",
            sourcePlanNodeId: "plan_node_implement",
            sourceType: "task_run",
            sourceId: "run_1",
            createdAt: "2026-05-29T12:05:00.000Z"
          },
          {
            id: "trace_node:comparison:comparison_1",
            planGraphId: "plan_graph:task_1:v1",
            kind: "review",
            title: "Comparison comparison_1",
            status: "completed",
            sourcePlanNodeId: "plan_node_verify",
            sourceType: "comparison_report",
            sourceId: "comparison_1",
            createdAt: "2026-05-29T12:06:00.000Z"
          }
        ],
        dynamicEdges: [
          {
            id: "trace_edge:comparison:comparison_1:candidate",
            planGraphId: "plan_graph:task_1:v1",
            from: "trace_node:run:run_1",
            to: "trace_node:comparison:comparison_1",
            type: "evidence",
            label: "candidate"
          }
        ],
        evidence: [
          {
            id: "trace_evidence:run:run_1",
            planGraphId: "plan_graph:task_1:v1",
            sourceType: "task_run",
            sourceId: "run_1",
            planNodeId: "plan_node_implement",
            traceNodeId: "trace_node:run:run_1"
          },
          {
            id: "trace_evidence:comparison:comparison_1",
            planGraphId: "plan_graph:task_1:v1",
            sourceType: "comparison_report",
            sourceId: "comparison_1",
            planNodeId: "plan_node_verify",
            traceNodeId: "trace_node:comparison:comparison_1",
            summary: "Candidate won."
          }
        ],
        deviations: []
      },
      selectionDetails: {
        ...baseModel.selectionDetails,
        graph: {
          overlay: [
            {
              id: "plan_node_implement",
              kind: "graph_node",
              title: "Implement graph view",
              subtitle: "implement @engineer primary_run",
              sections: [
                {
                  id: "plan-node",
                  title: "Plan Node",
                  lines: ["id: plan_node_implement"]
                },
                {
                  id: "outgoing",
                  title: "Outgoing",
                  lines: ["plan plan_node_implement -> plan_node_verify primary then"]
                }
              ],
              commands: ["agent-hub execution-trace show --plan-graph-id plan_graph:task_1:v1"],
              actions: []
            },
            {
              id: "trace_node:run:run_1",
              kind: "graph_node",
              title: "TaskRun run_1",
              subtitle: "task_run completed",
              sections: [
                {
                  id: "trace-node",
                  title: "Trace Node",
                  lines: ["id: trace_node:run:run_1", "status: completed"]
                },
                {
                  id: "outgoing",
                  title: "Outgoing",
                  lines: ["trace trace_node:run:run_1 -> trace_node:comparison:comparison_1 evidence candidate"]
                }
              ],
              commands: ["agent-hub execution-trace show --plan-graph-id plan_graph:task_1:v1"],
              actions: []
            },
            {
              id: "trace_node:comparison:comparison_1",
              kind: "graph_node",
              title: "Comparison comparison_1",
              subtitle: "review completed",
              sections: [
                {
                  id: "trace-node",
                  title: "Trace Node",
                  lines: ["id: trace_node:comparison:comparison_1", "status: completed"]
                },
                {
                  id: "evidence",
                  title: "Evidence",
                  lines: ["comparison_report:comparison_1 Candidate won."]
                }
              ],
              commands: ["agent-hub execution-trace show --plan-graph-id plan_graph:task_1:v1"],
              actions: []
            }
          ],
          plan: [
            {
              id: "plan_node_implement",
              kind: "graph_node",
              title: "Implement graph view",
              subtitle: "implement @engineer primary_run",
              sections: [
                {
                  id: "plan-node",
                  title: "Plan Node",
                  lines: ["id: plan_node_implement"]
                }
              ],
              commands: ["agent-hub execution-trace show --plan-graph-id plan_graph:task_1:v1"],
              actions: []
            }
          ],
          trace: [
            {
              id: "trace_node:run:run_1",
              kind: "graph_node",
              title: "TaskRun run_1",
              subtitle: "task_run completed",
              sections: [
                {
                  id: "trace-node",
                  title: "Trace Node",
                  lines: ["id: trace_node:run:run_1", "status: completed"]
                }
              ],
              commands: ["agent-hub execution-trace show --plan-graph-id plan_graph:task_1:v1"],
              actions: []
            }
          ]
        }
      }
    };
    const overlay = renderToString(
      React.createElement(TuiInkFrame, {
        model,
        state: { ...createInitialInkState(), focus: "graph", graphLabels: "full" },
        terminal: { columns: 180, rows: 30 }
      }),
      { columns: 180 }
    );
    const plan = renderToString(
      React.createElement(TuiInkFrame, {
        model,
        state: { ...createInitialInkState(), focus: "graph", graphMode: "plan" },
        terminal: { columns: 120, rows: 28 }
      }),
      { columns: 120 }
    );
    const trace = renderToString(
      React.createElement(TuiInkFrame, {
        model,
        state: { ...createInitialInkState(), focus: "graph", graphMode: "trace" },
        terminal: { columns: 120, rows: 28 }
      }),
      { columns: 120 }
    );
    const compact = renderToString(
      React.createElement(TuiInkFrame, {
        model,
        state: { ...createInitialInkState(), focus: "graph" },
        terminal: { columns: 82, rows: 22 }
      }),
      { columns: 82 }
    );

    expect(overlay).toContain("Graph - Workflow DAG");
    expect(overlay).toContain("mode overlay");
    expect(overlay).toContain("mini-map 1/4");
    expect(overlay).toContain("P");
    expect(overlay).toContain("plan_node_imple");
    expect(overlay).toContain("--> then plan_node_verify");
    expect(overlay).toContain("T");
    expect(overlay).toContain("trace_node:run:");
    expect(overlay).toContain("legend: [P] plan");
    expect(overlay).toContain("TaskRun run_1");
    expect(plan).toContain("mode plan");
    expect(plan).toContain("plan_node_imple");
    expect(plan).not.toContain("TaskRun run_1");
    expect(trace).toContain("mode trace");
    expect(trace).toContain("TaskRun run_1");
    expect(trace).not.toContain("plan_node_imple");
    expect(compact).toContain("Graph - Workflow DAG");
    expect(compact).toContain("<=");

    const traceDetail = renderToString(
      React.createElement(TuiInkFrame, {
        model,
        state: {
          ...createInitialInkState(),
          focus: "graph",
          graphMode: "trace",
          detailVisible: true
        },
        terminal: { columns: 120, rows: 28 }
      }),
      { columns: 120 }
    );
    expect(traceDetail).toContain("Graph Node Detail");
    expect(traceDetail).toContain("Trace Node");
    expect(traceDetail).toContain("status: completed");
    expect(traceDetail).not.toContain("Empty Slot");
  });

  it("cycles graph mode only from the graph focus", () => {
    let state = { ...createInitialInkState(), focus: "graph" };
    state = reduceInkState(state, "cycle_graph_mode", baseModel);
    expect(state.graphMode).toBe("plan");
    state = reduceInkState(state, "cycle_graph_mode", baseModel);
    expect(state.graphMode).toBe("trace");
    state = reduceInkState(state, "toggle_graph_labels", baseModel);
    expect(state.graphLabels).toBe("full");
    state = reduceInkState(state, "toggle_graph_fold", baseModel);
    expect(state.graphFold).toBe("grouped");
    state = reduceInkState(state, "toggle_graph_zoom", baseModel);
    expect(state.graphZoom).toBe("detail");
  });

  it("keeps slash completion suggestions inside the terminal row budget", () => {
    const terminal = { columns: 120, rows: 28 };
    const output = renderToString(
      React.createElement(TuiInkFrame, {
        model: baseModel,
        state: createInitialInkState("/mem"),
        terminal
      }),
      { columns: terminal.columns }
    );
    const lines = output.split("\n");

    expect(output).toContain("commands /memory");
    expect(lines.length).toBeLessThanOrEqual(terminal.rows);
  });

  it("tabs through panes in the same order as the visible navigation", () => {
    let state = createInitialInkState();

    state = reduceInkState(state, "tab", baseModel);
    expect(state.focus).toBe("graph");
    state = reduceInkState(state, "tab", baseModel);
    expect(state.focus).toBe("runs");
    state = reduceInkState(state, "shift_tab", baseModel);
    expect(state.focus).toBe("graph");
  });

  it("opens selected-object detail in the medium shell without direct data access", () => {
    const state = reduceInkState(
      { ...createInitialInkState(), focus: "runs" },
      "enter",
      baseModel
    );
    const openedWithO = reduceInkState(createInitialInkState(), "open_detail", baseModel);
    const output = renderToString(
      React.createElement(TuiInkFrame, {
        model: baseModel,
        state,
        terminal: { columns: 80, rows: 24 }
      }),
      { columns: 80 }
    );

    expect(state.detailVisible).toBe(true);
    expect(openedWithO.detailVisible).toBe(true);
    expect(output).toContain("Final Report Detail");
    expect(output).toContain("[x] close");
    expect(output).toContain("Check TUI shell");
    expect(output).toContain("status succeeded");
    expect(output).toContain("agent-hub runs show run_27984312");
    expect(output).not.toContain("No detail selected");
  });

  it("pages long selected detail content without silently capping sections", () => {
    const detailLines = Array.from({ length: 20 }, (_, index) =>
      `detail line ${String(index).padStart(2, "0")}`
    );
    const model = {
      ...baseModel,
      selectionDetails: {
        ...baseModel.selectionDetails,
        workBlocks: [
          {
            ...baseModel.selectionDetails.workBlocks[0],
            sections: [{ id: "long-detail", title: "Long Detail", lines: detailLines }]
          },
          ...baseModel.selectionDetails.workBlocks.slice(1)
        ]
      }
    };
    const state = reduceInkState(
      { ...createInitialInkState(), detailVisible: true },
      "page_down",
      model
    );
    const output = renderToString(
      React.createElement(TuiInkFrame, {
        model,
        state,
        terminal: { columns: 80, rows: 16 }
      }),
      { columns: 80 }
    );

    expect(state.detailScrollOffset).toBeGreaterThan(0);
    expect(output).toContain("detail line 08");
    expect(output).toContain("scroll ");
    expect(output).not.toContain("detail line 00");
  });

  it("closes open detail with x instead of exiting the interactive TUI", async () => {
    const instance = render(
      React.createElement(TuiInkApp, {
        model: baseModel,
        state: { ...createInitialInkState(), detailVisible: true },
        terminal: { columns: 120, rows: 40 },
        interactive: true
      })
    );

    await waitForFrame(instance, "[x] close");
    instance.stdin.write("x");
    await waitForFrame(instance, "Detail closed.");

    expect(instance.lastFrame()).toContain("> @codex prompt");
    expect(instance.lastFrame()).not.toContain("[x] close");
    instance.unmount();
  });

  it("keeps team detail selection stable by selected id", () => {
    const teamState = reduceInkState(
      { ...createInitialInkState(), focus: "team", detailVisible: true },
      "down",
      baseModel
    );
    const output = renderToString(
      React.createElement(TuiInkFrame, {
        model: baseModel,
        state: teamState,
        terminal: { columns: 120, rows: 40 }
      }),
      { columns: 120 }
    );

    expect(teamState.selectedTeamRoleId).toBe("preset:reviewer");
    expect(output).toContain("@reviewer");
    expect(output).toContain("executor human reserved");
    expect(output).toContain("Mission And Boundaries");
    expect(output).toContain("Context Policy");
    expect(output).toContain("Delegation Matrix");
    expect(output).toContain("empty slot - role-call");
    expect(output).toContain("scroll ");
    expect(output).toContain("agent-hub team roles exe...");
  });

  it("renders Memory governance rows with selected proposal detail", () => {
    const memoryState = reduceInkState(
      { ...createInitialInkState(), focus: "memory", detailVisible: true },
      "down",
      baseModel
    );
    const output = renderToString(
      React.createElement(TuiInkFrame, {
        model: baseModel,
        state: memoryState,
        terminal: { columns: 120, rows: 36 }
      }),
      { columns: 120 }
    );

    expect(memoryState.selectedMemoryItemId).toBe("memory_approved");
    expect(output).toContain("Memory Inbox");
    expect(output).toContain("Memory Governance");
    expect(output).toContain("view all   status all   confidence all   search /");
    expect(output).toContain("ID                  Category");
    expect(output).toContain("memory_proposed");
    expect(output).toContain("workflow_rule");
    expect(output).toContain("memory_approved");
    expect(output).toContain("project_fact");
    expect(output).toContain("Evidence Excerpts (selected: memory_approved)");
    expect(output).toContain("Approved Memory Index");
    expect(output).toContain("Runtime injection is the");
    expect(output).toContain("default context mode.");
    expect(output).toContain("recommended action injected");
    expect(output).toContain("agent-hub memory approve...");
    expect(output).toContain("[a] Approve");
    expect(output).toContain("[R] Reject");
    expect(output).toContain("[o] Open Source");
    expect(output.split("\n").every((value) => value.length <= 120)).toBe(true);
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
            counts: { proposed: 0, approved: 1, rejected: 0, retired: 0 }
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
            counts: { proposed: 0, approved: 1, rejected: 0, retired: 0 }
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

  it("renders active run blocks inside Work", () => {
    const output = renderToString(
      React.createElement(TuiInkFrame, {
        model: modelWithActiveRun(),
        state: createInitialInkState(),
        terminal: { columns: 78, rows: 32 }
      }),
      { columns: 78 }
    );

    expect(output).toContain("Work - Conversation | Live | 3 blocks");
    expect(output).toContain("@codex run_active");
    expect(output).toContain("| ⠋");
    expect(output).toContain("Reading logout.ts");
    expect(output).not.toContain("checks 1/0/0");
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

    expect(output).toContain("@implementer run_27984312");
    expect(output).toContain("Patched auth.ts");
    expect(output).toContain("awaiting review △");
    expect(output).toContain("@reviewer");
    expect(output).toContain("run_active");
  });

  it("renders active run liveliness with spinner, metadata, and output tail", () => {
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

    expect(output).toContain("@engineer run_live");
    expect(output).toContain("⠼ running 12s 42k tok");
    expect(output).toContain("│ Reading src/auth.ts");
    expect(output).toContain("│ Running pnpm test");
    expect(output).toContain("2/5");
    expect(output).toContain("╰");
    const boxLines = activeRunFrameLines(output);
    expect(boxLines).toHaveLength(7);
  });

  it("opens V3 live-run detail for the selected active Work block", () => {
    const model = {
      ...baseModel,
      conversation: [],
      activeRuns: [
        {
          runId: "run_live_detail",
          agent: "codex",
          displayHandle: "engineer",
          title: "@engineer run_live_detail ● running",
          startedAt: "2026-05-29T12:00:00.000Z",
          elapsedLabel: "45s",
          usageLabel: "12k tok",
          outputLines: [
            "Reading src/auth.ts",
            "pnpm test tests/auth.test.ts"
          ]
        }
      ],
      workBlocks: [
        {
          id: "active-run:run_live_detail",
          sourceId: "run_live_detail",
          sourceKind: "active_run",
          type: "active_run",
          runId: "run_live_detail",
          timestamp: "2026-05-29T12:00:00.000Z",
          elapsedLabel: "45s",
          usageLabel: "12k tok",
          speaker: "@engineer",
          title: "@engineer run_live_detail ● running",
          statusIcon: "●",
          statusLabel: "running",
          statusTone: "info",
          messageLines: [
            "Reading src/auth.ts",
            "pnpm test tests/auth.test.ts"
          ],
          toolSummaryLines: [
            "inferred: Reading src/auth.ts",
            "inferred: pnpm test tests/auth.test.ts"
          ],
          fileRefs: ["src/auth.ts"],
          commandLines: ["pnpm test tests/auth.test.ts"],
          artifactLines: [],
          evidenceLines: ["elapsed 45s", "usage 12k tok"]
        }
      ],
      selectionDetails: {
        ...baseModel.selectionDetails,
        workBlocks: [
          {
            id: "active-run:run_live_detail",
            kind: "work_block",
            title: "@engineer run_live_detail ● running",
            subtitle: "running",
            sections: [
              {
                id: "live-run",
                title: "Live Run",
                lines: [
                  "speaker @engineer",
                  "state running",
                  "started 2026-05-29T12:00:00.000Z",
                  "elapsed 45s",
                  "spinner active",
                  "usage 12k tok"
                ]
              },
              {
                id: "streaming-output",
                title: "Streaming Output Tail",
                lines: ["Reading src/auth.ts", "pnpm test tests/auth.test.ts"]
              },
              {
                id: "tool-calls",
                title: "Tool Calls",
                lines: [
                  "structured durations/status are not available; these rows are inferred from visible output",
                  "inferred: Reading src/auth.ts"
                ]
              },
              {
                id: "active-commands",
                title: "Active Commands",
                lines: [
                  "queued/running command status is not available; commands are inferred from visible output",
                  "pnpm test tests/auth.test.ts"
                ]
              },
              {
                id: "pending-artifacts",
                title: "Pending Artifacts",
                lines: ["pending artifact rows not available in current read model"]
              }
            ],
            commands: ["agent-hub runs show run_live_detail"],
            actions: [{ key: "p", label: "Prepare Command", kind: "prepare_command" }]
          }
        ]
      }
    };
    const output = renderToString(
      React.createElement(TuiInkFrame, {
        model,
        state: { ...createInitialInkState(), detailVisible: true },
        terminal: { columns: 80, rows: 40 }
      }),
      { columns: 80 }
    );

    expect(output).toContain("Live Block Detail");
    expect(output).toContain("Live Run");
    expect(output).toContain("speaker @engineer");
    expect(output).toContain("spinner active");
    expect(output).toContain("Streaming Output Tail");
    expect(output).toContain("Active Commands");
    expect(output).toContain("Pending Artifacts");
    expect(output).toContain("agent-hub runs show run_live_detail");
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
        counts: { proposed: 0, approved: 1, rejected: 0, retired: 0 }
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
      expect(output).toContain("up/down/j/k move");
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
    expect(narrowOutput).toContain("Work - Conversation | Live");
    expect(narrowOutput).toContain("Step 2/5");
  });

  it("wraps display-wide completed agent lines without losing content", () => {
    const longAgentLine =
      "1. `DefaultContextCompiler` 先编出基础 `ContextBundle`：当前任务、选中 agent、目标仓库、项目摘要、低可信 conversation brief、approved memory、显式/角色技能、用户约束和执行 hint。见 [context-compiler.ts](/private/project/packages/context-compiler/src/context-compiler.ts:120)，需要实现自动换行。";
    const output = renderToString(
      React.createElement(TuiInkFrame, {
        model: {
          ...baseModel,
          activeRuns: [],
          conversation: [
            {
              id: "run:wide-agent-text",
              type: "agent_completed",
              timestamp: "2026-05-29T12:05:00.000Z",
              author: "@codex",
              agent: "codex",
              runId: "run_wide_agent_text",
              statusLabel: "completed",
              outputLines: [longAgentLine]
            }
          ]
        },
        state: createInitialInkState(),
        terminal: { columns: 64, rows: 32 }
      }),
      { columns: 64 }
    );
    const agentLines = framedContentLines(output)
      .filter((value) =>
        value.includes("ContextBundle") ||
        value.includes("approved memory") ||
        value.includes("context-compiler.ts") ||
        value.includes("自动换行")
      );

    expect(output).toContain("目标仓库");
    expect(output).toContain("显式/角色技能");
    expect(output).toContain("context-compiler.ts");
    expect(output).toContain("需要实现自动换行");
    expect(agentLines.length).toBeGreaterThan(1);
    expect(agentLines.every((value) => !value.includes("…"))).toBe(true);
  });

  it("wraps CJK selected detail content across release smoke widths", () => {
    const model = {
      ...baseModel,
      selectionDetails: {
        ...baseModel.selectionDetails,
        workBlocks: [
          {
            ...baseModel.selectionDetails.workBlocks[0],
            sections: [
              {
                id: "cjk-detail",
                title: "CJK Detail",
                lines: [
                  "默认上下文注入保持仓库根目录干净，审批记忆必须显式完成，长句在详情面板内需要稳定换行。"
                ]
              },
              {
                id: "unsupported",
                title: "Evidence Gap",
                lines: ["related skills/memory joins not available in current read model"],
                collapsedByDefault: true
              }
            ]
          },
          ...baseModel.selectionDetails.workBlocks.slice(1)
        ]
      }
    };

    for (const columns of [120, 80, 48]) {
      const output = renderToString(
        React.createElement(TuiInkFrame, {
          model,
          state: { ...createInitialInkState(), detailVisible: true },
          terminal: { columns, rows: 40 }
        }),
        { columns }
      );
      const lines = output.split("\n");

      expect(output).toContain("Block Detail");
      expect(output).toContain("默认上下文注入");
      expect(output).toContain("审批记忆");
      expect(output).toContain("Evidence Gap (collapsed)");
      expect(lines.every((value) => value.length <= columns)).toBe(true);
    }
  });

  it("renders V3 reference fixtures across visual QA sizes", () => {
    const sizes = [
      { columns: 154, rows: 42 },
      { columns: 160, rows: 48 },
      { columns: 120, rows: 36 },
      { columns: 80, rows: 24 }
    ];
    const completedWorkModel = {
      ...baseModel,
      selectionDetails: {
        ...baseModel.selectionDetails,
        workBlocks: [
          baseModel.selectionDetails.workBlocks[0],
          {
            ...baseModel.selectionDetails.workBlocks[1],
            sections: [
              {
                id: "message",
                title: "Message",
                lines: [
                  "awaiting review - open [V]iew for details",
                  "审批记忆必须显式完成，长句在详情面板内需要稳定换行。"
                ]
              },
              ...baseModel.selectionDetails.workBlocks[1].sections.slice(1)
            ]
          }
        ]
      }
    };
    const liveWorkModel = {
      ...baseModel,
      conversation: [],
      activeRuns: [
        {
          runId: "run_reference_live",
          agent: "codex",
          displayHandle: "engineer",
          title: "@engineer run_reference_live ● running",
          startedAt: "2026-05-29T12:00:00.000Z",
          elapsedLabel: "45s",
          usageLabel: "12k tok",
          outputLines: ["Reading src/auth.ts", "pnpm test tests/auth.test.ts"]
        }
      ],
      workBlocks: [
        {
          id: "active-run:run_reference_live",
          sourceId: "run_reference_live",
          sourceKind: "active_run",
          type: "active_run",
          runId: "run_reference_live",
          timestamp: "2026-05-29T12:00:00.000Z",
          elapsedLabel: "45s",
          usageLabel: "12k tok",
          speaker: "@engineer",
          title: "@engineer run_reference_live ● running",
          statusIcon: "●",
          statusLabel: "running",
          statusTone: "info",
          messageLines: ["Reading src/auth.ts", "pnpm test tests/auth.test.ts"],
          toolSummaryLines: ["inferred: Reading src/auth.ts"],
          fileRefs: ["src/auth.ts"],
          commandLines: ["pnpm test tests/auth.test.ts"],
          artifactLines: [],
          evidenceLines: ["elapsed 45s", "usage 12k tok"]
        }
      ],
      selectionDetails: {
        ...baseModel.selectionDetails,
        workBlocks: [
          {
            id: "active-run:run_reference_live",
            kind: "work_block",
            title: "@engineer run_reference_live ● running",
            subtitle: "running",
            sections: [
              {
                id: "live-run",
                title: "Live Run",
                lines: ["speaker @engineer", "state running", "elapsed 45s", "spinner active", "usage 12k tok"]
              },
              {
                id: "streaming-output",
                title: "Streaming Output Tail",
                lines: ["Reading src/auth.ts", "pnpm test tests/auth.test.ts"]
              },
              {
                id: "tool-calls",
                title: "Tool Calls",
                lines: ["inferred: Reading src/auth.ts"],
                collapsedByDefault: true
              }
            ],
            commands: ["agent-hub runs show run_reference_live"],
            actions: [{ key: "p", label: "Prepare Command", kind: "prepare_command" }]
          }
        ]
      }
    };
    const fixtures = [
      {
        name: "completed Work",
        model: completedWorkModel,
        state: {
          ...createInitialInkState(),
          selectedWorkBlockIndex: 1,
          selectedWorkBlockId: "review-pending:run_27984312-fc9a-46bf-9ccf-c06997187091",
          detailVisible: true
        },
        expected: ["Block Detail", "审批记忆", "Controls"]
      },
      {
        name: "live Work",
        model: liveWorkModel,
        state: { ...createInitialInkState(), detailVisible: true },
        expected: ["Live Block Detail", "Live Run", "Streaming Output Tail"]
      },
      {
        name: "Memory",
        model: baseModel,
        state: { ...createInitialInkState(), focus: "memory" },
        expected: ["Memory Inbox", "ID                  Category", "Evidence Excerpts", "Approved Memory Index"]
      },
      {
        name: "Team",
        model: baseModel,
        state: { ...createInitialInkState(), focus: "team" },
        expected: ["Team Workbench", "local-only", "Role          Source", "Recent RoleCalls", "Delegation Matrix"]
      }
    ];

    for (const fixture of fixtures) {
      for (const terminal of sizes) {
        const output = renderToString(
          React.createElement(TuiInkFrame, {
            model: fixture.model,
            state: fixture.state,
            terminal
          }),
          { columns: terminal.columns }
        );
        const lines = output.split("\n");

        expect(output, `${fixture.name} ${terminal.columns}x${terminal.rows}`).toContain("AGENT HUB");
        expect(output).toContain("┌");
        expect(output).toContain("└");
        expect(output).toContain("> @codex prompt");
        expect(output).toContain("keys:");
        const expectedValues = fixture.expected.filter((value) =>
          !(fixture.name === "live Work" && terminal.rows < 36 && value === "Streaming Output Tail") &&
          !(fixture.name === "Team" && terminal.rows < 36 && value === "Delegation Matrix")
        );
        for (const value of expectedValues) {
          expect(output, `${fixture.name} ${terminal.columns}x${terminal.rows}`).toContain(value);
        }
        if (fixture.name === "Memory" && terminal.columns >= 112) {
          expect(output).toContain("Proposal Detail");
        }
        if (fixture.name === "Team" && terminal.columns >= 112) {
          expect(output).toContain("Role Profile");
          expect(output).toContain("Caller");
        }
        expect(lines.every((value) => value.length <= terminal.columns)).toBe(true);
      }
    }
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

    const boxLines = activeRunFrameLines(output);
    expect(output.split("\n").length).toBeLessThanOrEqual(20);
    expect(boxLines.length).toBeGreaterThanOrEqual(4);
    expect(boxLines.length).toBeLessThanOrEqual(8);
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

  it("renders active runs as Work blocks without legacy active boxes", () => {
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

    expect(output).toContain("Work - Conversation | Live | 5 blocks");
    expect(output.match(/run_active_/g)?.length).toBeGreaterThanOrEqual(5);
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

    expect(output).toContain("@codex run_fail failed ✗");
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

    expect(output).toContain("◈ AGENT HUB | TUI Project");
    expect(output).toContain("12:00:00 user user_message");
    expect(output).toContain("Inspect src/auth.ts:42 and run pnpm test.");
    expect(output).toContain("@reviewer run_abcdef12");
    expect(output).toContain("1m30s");
    expect(output).toContain("92k tok / $0.03");
    expect(output).toContain("src/auth.ts:42 needs the guard.");
    expect(output).toContain("pnpm test tests/auth.test.ts");
    expect(output).toContain("const message = \"ok\"; // comment");
    expect(output).toContain("12:06:00 | @reviewer");
    expect(output).not.toContain("more lines");
  });

  it("renders V3 Work blocks with selected metadata and detail evidence", () => {
    const model = {
      ...baseModel,
      conversation: [
        {
          id: "message:v3-user",
          type: "user_message",
          timestamp: "2026-05-29T12:00:00.000Z",
          author: "user",
          content: "请检查 apps/cli/src/tui-ink/App.mts:1216 并保留完整输出。"
        },
        {
          id: "run:v3-block",
          type: "agent_completed",
          timestamp: "2026-05-29T12:04:00.000Z",
          author: "@implementer",
          displayHandle: "implementer",
          agent: "codex",
          runId: "v3-block",
          statusLabel: "completed",
          outputLines: [
            "read_file apps/cli/src/tui-ink/App.mts",
            "rg \"ConversationFlow\" apps/cli/src/tui-ink/App.mts",
            "```ts",
            "const block = \"保持完整输出\";",
            "```"
          ],
          verificationLine: "verification passed (2 checks)",
          inlineDiff: inlineDiffFixture()
        }
      ],
      activeRuns: [],
      workBlocks: [
        {
          id: "message:v3-user",
          sourceId: "message:v3-user",
          sourceKind: "conversation",
          type: "user_message",
          timestamp: "2026-05-29T12:00:00.000Z",
          speaker: "user",
          title: "user message",
          statusIcon: "●",
          statusTone: "normal",
          messageLines: ["请检查 apps/cli/src/tui-ink/App.mts:1216 并保留完整输出。"],
          toolSummaryLines: [],
          fileRefs: ["apps/cli/src/tui-ink/App.mts:1216"],
          commandLines: [],
          artifactLines: [],
          evidenceLines: []
        },
        {
          id: "run:v3-block",
          sourceId: "run:v3-block",
          sourceKind: "conversation",
          type: "agent_completed",
          timestamp: "2026-05-29T12:04:00.000Z",
          speaker: "@implementer",
          title: "@implementer v3-block",
          statusIcon: "✓",
          statusLabel: "completed",
          statusTone: "success",
          messageLines: [
            "read_file apps/cli/src/tui-ink/App.mts",
            "rg \"ConversationFlow\" apps/cli/src/tui-ink/App.mts",
            "```ts",
            "const block = \"保持完整输出\";",
            "```"
          ],
          toolSummaryLines: [
            "inferred: read_file apps/cli/src/tui-ink/App.mts",
            "inferred: rg \"ConversationFlow\" apps/cli/src/tui-ink/App.mts"
          ],
          fileRefs: ["apps/cli/src/tui-ink/App.mts"],
          commandLines: ["rg \"ConversationFlow\" apps/cli/src/tui-ink/App.mts"],
          artifactLines: [],
          evidenceLines: ["verification passed (2 checks)", "diff (+1/-1 in 1 files)"],
          inlineDiff: inlineDiffFixture()
        }
      ],
      selectionDetails: {
        ...baseModel.selectionDetails,
        workBlocks: [
          {
            id: "message:v3-user",
            kind: "work_block",
            title: "user message",
            sections: [
              { id: "message", title: "Message", lines: ["请检查 apps/cli/src/tui-ink/App.mts:1216 并保留完整输出。"] }
            ],
            commands: [],
            actions: []
          },
          {
            id: "run:v3-block",
            kind: "work_block",
            title: "@implementer v3-block",
            subtitle: "completed",
            sections: [
              { id: "message", title: "Message", lines: ["read_file apps/cli/src/tui-ink/App.mts"] },
              {
                id: "tool-calls",
                title: "Tool Calls",
                lines: ["structured durations/status are not available; these rows are inferred from visible output"]
              },
              { id: "file-refs", title: "File Refs", lines: ["apps/cli/src/tui-ink/App.mts"] },
              { id: "inline-diff", title: "Inline Diff", lines: ["(+1/-1 in 1 files)"] },
              { id: "fix-snippet", title: "Fix Snippet", lines: ["-const mode = \"old\";", "+const mode = \"new\";"] }
            ],
            commands: ["agent-hub runs show v3-block"],
            actions: [{ key: "p", label: "Prepare Command", kind: "prepare_command" }]
          }
        ]
      }
    };
    const state = reduceInkState(createInitialInkState(), "down", model);
    const output = renderToString(
      React.createElement(TuiInkFrame, {
        model,
        state,
        terminal: { columns: 120, rows: 40 }
      }),
      { columns: 120 }
    );

    expect(state.selectedWorkBlockId).toBe("run:v3-block");
    expect(output).toContain("╭─ 12:04:00 @implementer completed ✓");
    expect(output).toContain("> tools inferred 2");
    expect(output).toContain("> files apps/cli/src/tui-ink/App.mts");
    expect(output).toContain("> commands 1");
    expect(output).toContain("保持完整输出");
    expect(output).toContain("Tool Calls");
    expect(output).toContain("File Refs");
    expect(output).toContain("Fix Snippet");
    expect(output.split("\n").every((value) => value.length <= 120)).toBe(true);
  });

  it("does not render quick reply suggestions", () => {
    const model = modelWithFailedRun();
    const idleOutput = renderToString(
      React.createElement(TuiInkFrame, {
        model,
        state: createInitialInkState(),
        terminal: { columns: 100, rows: 32 }
      }),
      { columns: 100 }
    );

    expect(idleOutput).toContain("verification failed");
    expect(idleOutput).not.toContain("[1] Run more tests");
    expect(idleOutput).not.toContain("[2] Fix verification");
    expect(idleOutput).not.toContain("[3] Continue");
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
    expect(output).toContain("> diff (+1/-1 in 1 files)");
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

  it("opens the command palette from a slash-only command without submitting a prompt", async () => {
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

    instance.stdin.write("/");
    await waitForFrame(instance, "> /");
    instance.stdin.write("\r");
    await waitForFrame(instance, "Command Palette");

    expect(submissions).toEqual([]);
    expect(instance.lastFrame()).toContain("Open Help");
    expect(instance.lastFrame()).toContain("agent-hub memory list --project-id project_1");
    expect(instance.lastFrame()).toContain("> @codex prompt");
    instance.unmount();
  });

  it("toggles selected detail folds without writing hotkeys into the composer", async () => {
    const foldModel = {
      ...baseModel,
      memory: {
        ...baseModel.memory,
        rows: [
          {
            ...baseModel.memory.rows[0],
            evidenceExcerptLines: []
          },
          ...baseModel.memory.rows.slice(1)
        ]
      },
      selectionDetails: {
        ...baseModel.selectionDetails,
        memoryRows: [
          {
            ...baseModel.selectionDetails.memoryRows[0],
            sections: [
              { id: "memory", title: "Memory Text", lines: ["Keep memory approval explicit."] },
              {
                id: "evidence",
                title: "Evidence Excerpts",
                lines: ["manual review required"],
                collapsedByDefault: true
              }
            ]
          },
          ...baseModel.selectionDetails.memoryRows.slice(1)
        ]
      }
    };
    const instance = render(
      React.createElement(TuiInkApp, {
        model: foldModel,
        state: { ...createInitialInkState(), focus: "memory", detailVisible: true },
        terminal: { columns: 120, rows: 40 },
        interactive: true
      })
    );

    await waitForFrame(instance, "Evidence Excerpts (collapsed)");
    expect(instance.lastFrame()).not.toContain("manual review required");

    instance.stdin.write("O");
    await waitForFrame(instance, "Detail sections expanded.");
    expect(instance.lastFrame()).toContain("manual review required");
    expect(instance.lastFrame()).toContain("> @codex prompt");

    instance.stdin.write("<");
    await waitForFrame(instance, "Detail sections collapsed.");
    expect(instance.lastFrame()).toContain("Evidence Excerpts (collapsed)");

    instance.stdin.write("z");
    await waitForFrame(instance, "Fold prefix");
    instance.stdin.write("a");
    await waitForFrame(instance, "Detail sections expanded.");
    expect(instance.lastFrame()).toContain("manual review required");
    expect(instance.lastFrame()).not.toContain("> za");
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
      expect(output).toContain("/use <target>");
      expect(output).toContain("/memory auto");
      if (columns >= 80) {
        expect(output).toContain("/clear session");
      }
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
    await waitForFrame(instance, "agent-hub runs show run_27984312");

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
    expect(output).toContain("! AGENT HUB | TUI Project");
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

    await waitForFrame(instance, "@codex run_short completed ✓");

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

    await waitForFrame(instance, "Team Workbench 2");

    expect(submissions).toEqual([]);
    expect(instance.lastFrame()).toContain("Team Workbench 2");
    expect(instance.lastFrame()).toContain("local-only");
    expect(instance.lastFrame()).toContain("Role          Source");
    expect(instance.lastFrame()).toContain("@engineer");
    expect(instance.lastFrame()).toContain("runs with codex");
    expect(instance.lastFrame()).toContain("@reviewer");
    expect(instance.lastFrame()).toContain("manual");
    expect(instance.lastFrame()).toContain("Recent RoleCalls");
    expect(instance.lastFrame()).toContain("Status   Caller");
    expect(instance.lastFrame()).toContain("Delegation Matrix");
    expect(instance.lastFrame()).toContain("Caller");
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
    await waitForFrame(instance, "Team Workbench 2");

    expect(instance.lastFrame()).toContain("Team");
    expect(instance.lastFrame()).not.toContain("[E]am");
    expect(instance.lastFrame()).toContain("local-only");
    expect(instance.lastFrame()).toContain("@engineer");
    expect(instance.lastFrame()).toContain("runs with codex");
    expect(instance.lastFrame()).toContain("1/2");
    expect(instance.lastFrame()).toContain("Recent RoleCalls");
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
    expect(scrolledOutput).toContain("Transcript message 6");
    expect(scrolledOutput).not.toContain("Transcript message 9");
  });

  it("keeps the selected Work block visible while moving past the current viewport", () => {
    const model = modelWithWorkBlocks(12);
    let upwardState = {
      ...createInitialInkState(),
      selectedWorkBlockIndex: 11,
      selectedWorkBlockId: "message:block-11",
      conversationScrollOffset: 0
    };
    for (let index = 0; index < 10; index += 1) {
      upwardState = reduceInkState(upwardState, "up", model);
    }
    const upwardOutput = renderToString(
      React.createElement(TuiInkFrame, {
        model,
        state: upwardState,
        terminal: { columns: 78, rows: 18 }
      }),
      { columns: 78 }
    );

    expect(upwardState.selectedWorkBlockId).toBe("message:block-1");
    expect(upwardState.conversationScrollOffset).toBeGreaterThan(0);
    expect(upwardOutput).toContain("Work block 1");

    let downwardState = {
      ...createInitialInkState(),
      selectedWorkBlockIndex: 0,
      selectedWorkBlockId: "message:block-0",
      conversationScrollOffset: 99
    };
    for (let index = 0; index < 10; index += 1) {
      downwardState = reduceInkState(downwardState, "down", model);
    }
    const downwardOutput = renderToString(
      React.createElement(TuiInkFrame, {
        model,
        state: downwardState,
        terminal: { columns: 78, rows: 18 }
      }),
      { columns: 78 }
    );

    expect(downwardState.selectedWorkBlockId).toBe("message:block-10");
    expect(downwardState.conversationScrollOffset).toBeLessThan(99);
    expect(downwardOutput).toContain("Work block 10");
  });

  it("does not move the Work viewport when navigation is already at an edge", () => {
    const model = modelWithWorkBlocks(6);
    const bottomState = {
      ...createInitialInkState(),
      selectedWorkBlockIndex: 5,
      selectedWorkBlockId: "message:block-5",
      conversationScrollOffset: 3
    };
    const nextBottomState = reduceInkState(bottomState, "down", model);
    const topState = {
      ...createInitialInkState(),
      selectedWorkBlockIndex: 0,
      selectedWorkBlockId: "message:block-0",
      conversationScrollOffset: 4
    };
    const nextTopState = reduceInkState(topState, "up", model);

    expect(nextBottomState.selectedWorkBlockId).toBe("message:block-5");
    expect(nextBottomState.conversationScrollOffset).toBe(3);
    expect(nextTopState.selectedWorkBlockId).toBe("message:block-0");
    expect(nextTopState.conversationScrollOffset).toBe(4);
  });

  it("keeps the selected frame visible for long Work blocks", () => {
    const model = modelWithWorkBlocks(6, {
      longIndex: 3,
      longLines: Array.from({ length: 18 }, (_value, index) =>
        `Long selected Work block line ${index} with enough text to wrap across the terminal viewport.`
      )
    });
    let state = {
      ...createInitialInkState(),
      selectedWorkBlockIndex: 4,
      selectedWorkBlockId: "message:block-4",
      conversationScrollOffset: 0
    };

    state = reduceInkState(state, "up", model);
    const output = renderToString(
      React.createElement(TuiInkFrame, {
        model,
        state,
        terminal: { columns: 78, rows: 18 }
      }),
      { columns: 78 }
    );

    expect(state.selectedWorkBlockId).toBe("message:block-3");
    expect(output).toContain("╭─ 12:03:00 user user_message ●");
    expect(output).toContain("Long selected Work block line 0");
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

    expect(instance.lastFrame()).toContain("@codex run_polled01 completed ✓");
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

    instance.stdin.write("R");
    for (const character of "next") {
      instance.stdin.write(character);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    await waitForFrame(instance, "Runs: 1 runs");
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
    expect(instance.lastFrame()).toContain("@codex run_12345678 completed ✓");
    instance.unmount();
  });

  it("keeps numeric quick-reply keys as composer input", async () => {
    const submissions = [];
    const model = modelWithFailedRun();
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

    instance.stdin.write("1");
    await waitForFrame(instance, "> 1");

    expect(submissions).toEqual([]);
    instance.unmount();
  });

  it("keeps numeric keys as composer text when a prompt is being edited", async () => {
    const submissions = [];
    const instance = render(
      React.createElement(TuiInkApp, {
        model: modelWithFailedRun(),
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

  it("renders slash command suggestions and accepts slash completion", async () => {
    const output = renderToString(
      React.createElement(TuiInkFrame, {
        model: baseModel,
        state: createInitialInkState("/mem"),
        terminal: { columns: 120, rows: 40 }
      }),
      { columns: 120 }
    );

    expect(output).toContain("commands /memory");
    expect(output).toContain("/memory auto status");

    const instance = render(
      React.createElement(TuiInkApp, {
        model: baseModel,
        state: createInitialInkState("/use e"),
        terminal: { columns: 120, rows: 40 },
        interactive: true
      })
    );

    await waitForFrame(instance, "commands /use engineer");
    instance.stdin.write("\t");
    await waitForFrame(instance, "Selected /use engineer.");

    expect(instance.lastFrame()).toContain("> /use engineer");
    instance.unmount();
  });

  it("moves through slash completion choices before accepting one", async () => {
    const instance = render(
      React.createElement(TuiInkApp, {
        model: baseModel,
        state: createInitialInkState("/use "),
        terminal: { columns: 120, rows: 40 },
        interactive: true
      })
    );

    await waitForFrame(instance, "commands /use codex");
    instance.stdin.write("\u001b[B");
    await new Promise((resolve) => setTimeout(resolve, 25));
    instance.stdin.write("\t");
    await waitForFrame(instance, "Selected /use claude-code.");

    expect(instance.lastFrame()).toContain("> /use claude-code");
    instance.unmount();
  });

  it("handles local slash commands without invoking the remote slash callback", async () => {
    const remoteSlashCommands = [];
    const instance = render(
      React.createElement(TuiInkApp, {
        model: baseModel,
        state: createInitialInkState(),
        terminal: { columns: 120, rows: 40 },
        interactive: true,
        executeSlashCommand: async (input) => {
          remoteSlashCommands.push(input.command);
          return { ok: true, message: "remote slash command ran", model: baseModel };
        }
      })
    );

    for (const character of "/help") {
      instance.stdin.write(character);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    instance.stdin.write("\r");
    await waitForFrame(instance, "Help shown.");
    expect(instance.lastFrame()).toContain("Help");

    for (const character of "/agents") {
      instance.stdin.write(character);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    instance.stdin.write("\r");
    await waitForFrame(instance, "Team roles shown.");
    expect(instance.lastFrame()).toContain("Team Workbench");

    for (const character of "/runs") {
      instance.stdin.write(character);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    instance.stdin.write("\r");
    await waitForFrame(instance, "Runs shown.");
    expect(instance.lastFrame()).toContain("Runs");

    for (const character of "/memory") {
      instance.stdin.write(character);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    instance.stdin.write("\r");
    await waitForFrame(instance, "Memory shown.");
    expect(instance.lastFrame()).toContain("Memory Inbox");

    expect(remoteSlashCommands).toEqual([]);
    instance.unmount();
  });

  it("toggles local timeline and notification slash command state", async () => {
    const instance = render(
      React.createElement(TuiInkApp, {
        model: baseModel,
        state: createInitialInkState(),
        terminal: { columns: 120, rows: 40 },
        interactive: true
      })
    );

    for (const character of "/timeline on") {
      instance.stdin.write(character);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    instance.stdin.write("\r");
    await waitForFrame(instance, "Timeline shown.");
    expect(instance.lastFrame()).toContain("timeline");

    for (const character of "/timeline off") {
      instance.stdin.write(character);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    instance.stdin.write("\r");
    await waitForFrame(instance, "Timeline hidden.");
    expect(instance.lastFrame()).not.toContain("timeline  Timeline hidden.");

    for (const character of "/notify on") {
      instance.stdin.write(character);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    instance.stdin.write("\r");
    await waitForFrame(instance, "Completion notifications enabled.");
    expect(instance.lastFrame()).toContain("notify on");

    for (const character of "/notify off") {
      instance.stdin.write(character);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    instance.stdin.write("\r");
    await waitForFrame(instance, "Completion notifications disabled.");
    expect(instance.lastFrame()).toContain("notify off");
    instance.unmount();
  });

  it("routes memory auto slash commands through the slash callback", async () => {
    const remoteSlashCommands = [];
    const instance = render(
      React.createElement(TuiInkApp, {
        model: baseModel,
        state: createInitialInkState(),
        terminal: { columns: 120, rows: 40 },
        interactive: true,
        executeSlashCommand: async (input) => {
          remoteSlashCommands.push(input.command);
          return {
            ok: true,
            message: "Memory auto mode is suggest_only.",
            selectedTarget: input.selectedTarget,
            model: baseModel
          };
        }
      })
    );

    for (const character of "/memory auto status") {
      instance.stdin.write(character);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    instance.stdin.write("\r");
    await waitForFrame(instance, "Memory auto mode is suggest_only.");

    expect(remoteSlashCommands).toEqual(["/memory auto status"]);
    expect(instance.lastFrame()).not.toContain("Memory shown.");
    instance.unmount();
  });

  it("reports unavailable and failed remote slash commands in the composer status", async () => {
    const unavailable = render(
      React.createElement(TuiInkApp, {
        model: baseModel,
        state: createInitialInkState(),
        terminal: { columns: 120, rows: 40 },
        interactive: true
      })
    );

    for (const character of "/clear") {
      unavailable.stdin.write(character);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    unavailable.stdin.write("\r");
    await waitForFrame(unavailable, "Slash commands are unavailable.");
    unavailable.unmount();

    const failed = render(
      React.createElement(TuiInkApp, {
        model: baseModel,
        state: createInitialInkState(),
        terminal: { columns: 120, rows: 40 },
        interactive: true,
        executeSlashCommand: async () => {
          throw new Error("slash failed");
        }
      })
    );

    for (const character of "/clear") {
      failed.stdin.write(character);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    failed.stdin.write("\r");
    await waitForFrame(failed, "slash failed");
    failed.unmount();
  });

  it("sets the default target with /use and prefixes role-targeted submissions", async () => {
    const submissions = [];
    const instance = render(
      React.createElement(TuiInkApp, {
        model: baseModel,
        state: createInitialInkState(),
        terminal: { columns: 120, rows: 40 },
        interactive: true,
        executeSlashCommand: async (input) => {
          expect(input.command).toBe("/use engineer");
          return {
            ok: true,
            message: "Default target set to @engineer.",
            selectedTarget: "engineer",
            model: baseModel
          };
        },
        submitPrompt: async (input) => {
          submissions.push(input);
          return { ok: true, message: "Submitted prompt.", model: baseModel };
        }
      })
    );

    for (const character of "/use engineer") {
      instance.stdin.write(character);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    instance.stdin.write("\r");
    await waitForFrame(instance, "Default target set to @engineer.");
    expect(instance.lastFrame()).toContain("send @engineer");

    for (const character of "implement this") {
      instance.stdin.write(character);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    instance.stdin.write("\r");
    await waitForCondition(() => submissions.length === 1);

    expect(submissions.map((submission) => submission.prompt)).toEqual([
      "@engineer implement this"
    ]);
    instance.unmount();
  });

  it("preserves explicit mention targets over the /use default target", async () => {
    const submissions = [];
    const instance = render(
      React.createElement(TuiInkApp, {
        model: baseModel,
        state: { ...createInitialInkState(), selectedTarget: "engineer" },
        terminal: { columns: 120, rows: 40 },
        interactive: true,
        submitPrompt: async (input) => {
          submissions.push(input);
          return { ok: true, message: "Submitted prompt.", model: baseModel };
        }
      })
    );

    for (const character of "@reviewer check this") {
      instance.stdin.write(character);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    instance.stdin.write("\r");
    await waitForCondition(() => submissions.length === 1);

    expect(submissions.map((submission) => submission.prompt)).toEqual([
      "@reviewer check this"
    ]);
    instance.unmount();
  });

  it("runs /clear through the slash command callback and clears the terminal", async () => {
    let clearCount = 0;
    const instance = render(
      React.createElement(TuiInkApp, {
        model: baseModel,
        state: createInitialInkState(),
        terminal: { columns: 120, rows: 40 },
        interactive: true,
        clearTerminal: () => {
          clearCount += 1;
        },
        executeSlashCommand: async (input) => {
          expect(input.command).toBe("/clear");
          return {
            ok: true,
            message: "Screen cleared. Started isolated room #session-test.",
            selectedTarget: input.selectedTarget,
            clearScreen: true,
            model: {
              ...baseModel,
              context: {
                ...baseModel.context,
                threadId: "thread_session",
                threadTitle: "Session",
                roomHandle: "session-test"
              },
              conversation: [],
              transcript: [],
              workBlocks: []
            }
          };
        }
      })
    );

    for (const character of "/clear") {
      instance.stdin.write(character);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    instance.stdin.write("\r");
    await waitForFrame(instance, "Started isolated room #session-test.");

    expect(clearCount).toBe(1);
    expect(instance.lastFrame()).toContain("room:session-test");
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

    expect(instance.lastFrame()).toContain("> Graph");
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
    expect(instance.lastFrame()).toContain("Work: 2 blocks");
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

function modelWithWorkBlocks(count, options = {}) {
  const workBlocks = Array.from({ length: count }, (_value, index) => ({
    id: `message:block-${index}`,
    sourceId: `message:block-${index}`,
    sourceKind: "conversation",
    type: "user_message",
    timestamp: `2026-05-29T12:${String(index).padStart(2, "0")}:00.000Z`,
    speaker: "user",
    title: `Work block ${index}`,
    statusIcon: "●",
    statusLabel: undefined,
    statusTone: "normal",
    messageLines: index === options.longIndex && Array.isArray(options.longLines)
      ? options.longLines
      : [`Work block ${index}`],
    toolSummaryLines: [],
    fileRefs: [],
    commandLines: [],
    artifactLines: [],
    evidenceLines: []
  }));
  return {
    ...baseModel,
    conversation: workBlocks.map((block) => ({
      id: block.id,
      type: "user_message",
      timestamp: block.timestamp,
      author: block.speaker,
      content: block.messageLines[0]
    })),
    activeRuns: [],
    workBlocks,
    selectionDetails: {
      ...baseModel.selectionDetails,
      workBlocks: workBlocks.map((block) => ({
        id: block.id,
        kind: "work_block",
        title: block.title,
        subtitle: "message",
        sections: [{ id: "message", title: "Message", lines: block.messageLines }],
        commands: [],
        actions: []
      }))
    }
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

function modelWithFailedRun() {
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
        verificationLine: "verification failed (1 checks: pnpm test)"
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

function framedContentLines(output: string): string[] {
  return output.split("\n").map((value) => {
    if (value.startsWith("│") && value.endsWith("│") && !value.includes("││")) {
      return value.slice(1, -1).trimEnd();
    }
    return value;
  });
}

function activeRunFrameLines(output: string): string[] {
  return framedContentLines(output).filter((value) =>
    value.startsWith("╭") || value.startsWith("│") || value.startsWith("╰")
  );
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
