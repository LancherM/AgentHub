import { describe, expect, it } from "vitest";
import { createCliRuntime } from "@agent-hub/cli";
import {
  buildTuiCurrentContextModel,
  conservativePermissionSet,
  type RoleCall,
  type WorkgroupTaskAssignmentMetadata
} from "@agent-hub/core";

const now = "2026-05-29T10:00:00.000Z";

describe("TUI current-context read model", () => {
  it("returns bounded empty-state summaries without requiring new tables", async () => {
    const runtime = createCliRuntime({ storageMode: "memory" });

    const model = await buildTuiCurrentContextModel(runtime, {
      projectId: "missing_project",
      threadId: "missing_thread"
    });

    expect(model.context.projectId).toBe("missing_project");
    expect(model.transcript).toEqual([]);
    expect(model.runs).toEqual([]);
    expect(model.roleCalls.counts.total).toBe(0);
    expect(model.review.kind).toBe("none");
    expect(model.memory.counts).toEqual({
      proposed: 0,
      approved: 0,
      rejected: 0
    });
    expect(model.warnings).toEqual([
      "thread missing_thread not found",
      "project missing_project not found"
    ]);
  });

  it("summarizes transcript, runs, RoleCalls, tasks, memory, and skills in stable order", async () => {
    const runtime = createCliRuntime({ storageMode: "memory" });
    await seedCurrentContext(runtime);

    const model = await buildTuiCurrentContextModel(runtime, {
      projectId: "project_1",
      threadId: "thread_1",
      selectedSkillReferences: ["project:reviewer-checklist", "global:typescript-safety"],
      maxMessages: 2,
      hideCompletedRoleCalls: true,
      iteration: 2,
      maxIterations: 5
    });

    expect(model.context).toMatchObject({
      projectId: "project_1",
      projectName: "Agent Hub",
      threadId: "thread_1",
      roomHandle: "review",
      contextMode: "runtime_injection"
    });
    expect(model.transcript.map((message) => message.id)).toEqual([
      "message_2",
      "message_3"
    ]);
    expect(model.runs.map((run) => run.id)).toEqual(["run_active", "run_done"]);
    expect(model.runs[0]).toMatchObject({
      id: "run_active",
      stage: "verification started",
      evidence: {
        checks: { passed: 1, failed: 1, skipped: 1, failedNames: ["pnpm test"] },
        risk: { level: "medium", primaryReason: "partial verification" },
        diff: { changedFiles: 2, insertions: 12, deletions: 4 }
      }
    });
    expect(model.roleCalls.counts).toMatchObject({
      total: 6,
      visible: 5,
      active: 1,
      pending: 2,
      waiting: 2,
      failed: 1,
      terminal: 2
    });
    expect(model.roleCalls.nodes.map((node) => node.id)).toEqual([
      "call_running",
      "call_waiting_approval",
      "call_waiting_context",
      "call_failed",
      "call_deferred"
    ]);
    expect(model.roleCalls.loop).toMatchObject({
      iteration: 2,
      maxIterations: 5,
      stopReason: "waiting_approval",
      activeRoleCallIds: ["call_running"],
      waitingRoleCallIds: ["call_waiting_approval", "call_waiting_context"]
    });
    expect(model.review).toMatchObject({
      kind: "role_call",
      selectedId: "call_waiting_approval",
      evidence: {
        waitingReason: "Needs explicit approval before continuing."
      }
    });
    expect(model.tasks[0]).toMatchObject({
      id: "task_1",
      assignmentCount: 2,
      executableAssignmentCount: 2,
      nextAction: "inspect run_active"
    });
    expect(model.memory.counts).toEqual({
      proposed: 2,
      approved: 1,
      rejected: 1
    });
    expect(model.skills.selected.map((skill) => `${skill.scope}:${skill.id}`)).toEqual([
      "project:reviewer-checklist",
      "global:typescript-safety"
    ]);
  });

  it("can select run evidence directly and reports max-iteration stop state", async () => {
    const runtime = createCliRuntime({ storageMode: "memory" });
    await seedCurrentContext(runtime);

    const model = await buildTuiCurrentContextModel(runtime, {
      threadId: "thread_1",
      selectedRunId: "run_done",
      maxIterations: 2,
      iteration: 2
    });

    expect(model.review).toMatchObject({
      kind: "run",
      selectedId: "run_done",
      title: "Review retained-run cleanup"
    });
    expect(model.roleCalls.loop.stopReason).toBe("max_iterations");
  });
});

async function seedCurrentContext(runtime: ReturnType<typeof createCliRuntime>) {
  await runtime.projectRepository.create({
    id: "project_1",
    name: "Agent Hub",
    rootPath: "/tmp/agent-hub",
    createdAt: now,
    updatedAt: now
  });
  await runtime.conversationThreadRepository.create({
    id: "thread_1",
    projectId: "project_1",
    title: "Review room",
    metadata: { roomHandle: "review" },
    createdAt: now,
    updatedAt: "2026-05-29T10:04:00.000Z"
  });
  await runtime.conversationMessageRepository.createMany([
    message("message_1", 0, "user", "Fix retained-run cleanup summary."),
    message("message_2", 1, "assistant", "I changed the cleanup summary.", {
      agentKind: "codex",
      runId: "run_done",
      status: "succeeded"
    }),
    message("message_3", 2, "tool", "run_active @reviewer running", {
      kind: "run_card",
      agentKind: "fake",
      runId: "run_active",
      status: "running"
    })
  ]);

  const assignments: WorkgroupTaskAssignmentMetadata[] = [
    {
      assignmentId: "assignment_engineer",
      taskId: "task_1",
      threadId: "thread_1",
      sourceMessageId: "message_1",
      assignmentRole: "role",
      agentId: "codex",
      roleHandle: "engineer",
      displayName: "@engineer",
      executorKind: "agent_adapter",
      adapterKind: "codex",
      executable: true,
      runId: "run_done",
      status: "completed"
    },
    {
      assignmentId: "assignment_reviewer",
      taskId: "task_1",
      threadId: "thread_1",
      sourceMessageId: "message_1",
      assignmentRole: "role",
      agentId: "fake",
      roleHandle: "reviewer",
      displayName: "@reviewer",
      executorKind: "agent_adapter",
      adapterKind: "fake",
      executable: true,
      runId: "run_active",
      status: "failed"
    }
  ];
  await runtime.taskRepository.create({
    id: "task_1",
    projectId: "project_1",
    title: "Review retained-run cleanup",
    description: "Review retained-run cleanup summary.",
    metadata: {
      source: "cli_chat",
      threadId: "thread_1",
      assignments
    },
    status: "open",
    createdAt: now,
    updatedAt: "2026-05-29T10:03:00.000Z"
  });
  await runtime.taskRunRepository.create({
    id: "run_done",
    taskId: "task_1",
    agentKind: "codex",
    status: "succeeded",
    startedAt: "2026-05-29T10:01:00.000Z",
    completedAt: "2026-05-29T10:02:00.000Z",
    createdAt: "2026-05-29T10:01:00.000Z",
    updatedAt: "2026-05-29T10:02:00.000Z"
  });
  await runtime.taskRunRepository.create({
    id: "run_active",
    taskId: "task_1",
    agentKind: "fake",
    status: "running",
    startedAt: "2026-05-29T10:03:00.000Z",
    createdAt: "2026-05-29T10:03:00.000Z",
    updatedAt: "2026-05-29T10:04:00.000Z"
  });
  await runtime.runEventRepository.createMany([
    event("event_1", "run_active", 0, "status", "adapter started"),
    event("event_2", "run_active", 1, "status", "verification started"),
    event("event_3", "run_done", 0, "message", "Cleanup summary updated.")
  ]);
  await runtime.verificationResultRepository.createMany([
    verification("verification_1", "run_active", "pnpm typecheck", "passed"),
    verification("verification_2", "run_active", "pnpm test", "failed"),
    verification("verification_3", "run_active", "pnpm lint", "skipped")
  ]);
  await runtime.runArtifactRepository.create({
    id: "artifact_diff",
    taskRunId: "run_active",
    kind: "git_diff",
    content: "diff --git a/file.ts b/file.ts",
    metadata: {
      changedFiles: ["src/a.ts", "src/b.ts"],
      stat: { filesChanged: 2, insertions: 12, deletions: 4 }
    },
    createdAt: now
  });
  await runtime.riskReportRepository.create({
    id: "risk_1",
    taskRunId: "run_active",
    level: "medium",
    summary: "Partial verification.",
    changedFiles: ["src/a.ts", "src/b.ts"],
    verificationSummary: "2 passed, 1 failed",
    failedChecks: ["pnpm test"],
    riskFactors: ["partial verification"],
    manualReviewChecklist: ["Run full suite before acceptance."],
    acceptanceRecommendation: "Review manually.",
    findings: [],
    createdAt: now
  });
  await runtime.memoryItemRepository.create({
    id: "memory_1",
    projectId: "project_1",
    category: "project_fact",
    status: "proposed",
    content: "Use TUI read models.",
    createdAt: now,
    updatedAt: now
  });
  await runtime.memoryItemRepository.create({
    id: "memory_2",
    projectId: "project_1",
    category: "workflow_rule",
    status: "proposed",
    content: "Keep memory approval explicit.",
    createdAt: now,
    updatedAt: now
  });
  await runtime.memoryItemRepository.create({
    id: "memory_3",
    projectId: "project_1",
    category: "workflow_rule",
    status: "approved",
    content: "Use runtime injection by default.",
    createdAt: now,
    updatedAt: now
  });
  await runtime.memoryItemRepository.create({
    id: "memory_4",
    projectId: "project_1",
    category: "temporary_note",
    status: "rejected",
    content: "Do not inject stale notes.",
    createdAt: now,
    updatedAt: now
  });
  await runtime.skillRepository.create({
    id: "reviewer-checklist",
    projectId: "project_1",
    name: "Reviewer Checklist",
    description: "Check bounded evidence.",
    path: "/tmp/agent-hub/context/skills/reviewer-checklist/SKILL.md",
    createdAt: now,
    updatedAt: now
  });
  await runtime.skillRepository.create({
    id: "typescript-safety",
    name: "TypeScript Safety",
    description: "Verify TypeScript changes.",
    path: "/tmp/agent-hub/skills/typescript-safety/SKILL.md",
    createdAt: now,
    updatedAt: now
  });

  for (const call of [
    roleCall({ id: "call_running", status: "running", taskRunId: "run_active" }),
    roleCall({
      id: "call_waiting_approval",
      status: "waiting_approval",
      decision: {
        disposition: "needs_approval",
        reason: "Needs explicit approval before continuing."
      }
    }),
    roleCall({
      id: "call_waiting_context",
      status: "waiting_context",
      decision: {
        disposition: "needs_context",
        reason: "Needs extra context from the user.",
        requiredContext: ["full-suite test output"]
      }
    }),
    roleCall({ id: "call_failed", status: "failed", error: "Executor failed." }),
    roleCall({ id: "call_deferred", status: "deferred" }),
    roleCall({ id: "call_succeeded", status: "succeeded" })
  ]) {
    await runtime.roleCallRepository.create(call);
  }
  await runtime.roleTodoRepository.create({
    id: "todo_1",
    threadId: "thread_1",
    role: "reviewer",
    sourceRoleCallId: "call_deferred",
    title: "Review when full test output exists",
    status: "deferred",
    priority: "normal",
    relatedRoleCallIds: ["call_deferred"],
    createdAt: now,
    updatedAt: now
  });
  await runtime.roleCallEventRepository.create({
    id: "role_event_1",
    roleCallId: "call_waiting_approval",
    threadId: "thread_1",
    type: "approval_requested",
    actorRole: "reviewer",
    message: "Approval requested.",
    createdAt: "2026-05-29T10:03:30.000Z"
  });
}

function message(
  id: string,
  sequence: number,
  role: "user" | "assistant" | "system" | "tool",
  content: string,
  overrides: {
    kind?: "text" | "run_card";
    agentKind?: "fake" | "codex" | "claude-code";
    runId?: string;
    status?: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  } = {}
) {
  return {
    id,
    threadId: "thread_1",
    sequence,
    role,
    kind: overrides.kind ?? "text",
    content,
    agentKind: overrides.agentKind,
    runId: overrides.runId,
    status: overrides.status,
    createdAt: now
  };
}

function event(
  id: string,
  taskRunId: string,
  sequence: number,
  type: "stdout" | "stderr" | "message" | "status" | "error" | "exit",
  messageText: string
) {
  return {
    id,
    taskRunId,
    sequence,
    type,
    message: messageText,
    metadata: {},
    createdAt: now
  };
}

function verification(
  id: string,
  taskRunId: string,
  command: string,
  status: "passed" | "failed" | "skipped"
) {
  return {
    id,
    taskRunId,
    command,
    status,
    createdAt: now
  };
}

function roleCall(input: Partial<RoleCall>): RoleCall {
  return {
    id: input.id ?? "call_1",
    threadId: "thread_1",
    parentMessageId: "message_1",
    parentRoleCallId: input.parentRoleCallId,
    callerRole: input.callerRole ?? "engineer",
    calleeRole: input.calleeRole ?? "reviewer",
    task: input.task ?? "Review retained-run cleanup summary.",
    reason: input.reason ?? "Need focused review.",
    context: { userGoal: "Review retained-run cleanup summary." },
    permissions: conservativePermissionSet,
    expectedOutput: { format: "summary", description: "Review result." },
    priority: input.priority ?? "normal",
    depth: input.depth ?? 0,
    status: input.status ?? "accepted",
    decision: input.decision,
    result: input.result,
    taskRunId: input.taskRunId,
    todoId: input.todoId,
    error: input.error,
    createdAt: input.createdAt ?? now,
    startedAt: input.startedAt,
    completedAt: input.completedAt
  };
}
