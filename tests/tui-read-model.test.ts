import { describe, expect, it } from "vitest";
import { createCliRuntime } from "@agent-hub/cli";
import {
  buildTuiCurrentContextModel,
  conservativePermissionSet,
  type JsonObject,
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
    expect(model.conversation).toEqual([]);
    expect(model.activeRuns).toEqual([]);
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
    expect(model.activeRuns.map((run) => run.runId)).toEqual(["run_active"]);
    expect(model.activeRuns.find((run) => run.runId === "run_active")).toMatchObject({
      title: "@reviewer run_active ● running",
      displayHandle: "reviewer",
      startedAt: "2026-05-29T10:03:00.000Z",
      elapsedLabel: "1m",
      usageLabel: "42k tok",
      outputLines: ["adapter started", "verification started"]
    });
    expect(model.conversation.map((entry) => entry.id)).toEqual([
      "message:message_1",
      "delegation:call_deferred",
      "delegation:call_failed",
      "delegation:call_running",
      "delegation:call_succeeded",
      "delegation:call_waiting_approval",
      "delegation:call_waiting_context",
      "review-pending:run_done"
    ]);
    expect(model.conversation.find((entry) => entry.id === "review-pending:run_done")).toMatchObject({
      type: "review_pending",
      displayHandle: "engineer",
      content: "awaiting review — 切换到 [V]iew 查看详情",
      outputLines: ["Cleanup summary updated."]
    });
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
      roleTodos: [expect.objectContaining({ id: "todo_1", status: "deferred" })],
      followUps: ["deferred @reviewer: Review retained-run cleanup summary."],
      nextAction: "inspect run_active"
    });
    expect(model.team.roles.map((role) => role.handle)).toContain("engineer");
    expect(model.team.counts).toMatchObject({
      total: 7,
      runnable: 1,
      reserved: 0
    });
    expect(model.team.command).toBe("agent-hub team roles list --project-id project_1");
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

  it("summarizes active, failed, completed, retained, and no-change run states", async () => {
    const runtime = createCliRuntime({ storageMode: "memory" });
    await seedRunStates(runtime);

    const model = await buildTuiCurrentContextModel(runtime, {
      projectId: "project_runs",
      threadId: "thread_runs",
      maxRuns: 5
    });

    expect(model.runs.map((run) => run.id)).toEqual([
      "run_active",
      "run_no_change",
      "run_retained",
      "run_failed",
      "run_completed"
    ]);
    expect(model.runs.find((run) => run.id === "run_active")).toMatchObject({
      status: "running",
      stage: "verifying"
    });
    expect(model.runs.find((run) => run.id === "run_failed")).toMatchObject({
      status: "failed",
      evidence: {
        checks: { failed: 1, failedNames: ["pnpm test"] },
        risk: { level: "high" }
      }
    });
    expect(model.runs.find((run) => run.id === "run_retained")).toMatchObject({
      status: "failed",
      retainedWorktree: true
    });
    expect(model.runs.find((run) => run.id === "run_no_change")).toMatchObject({
      status: "succeeded",
      evidence: {
        diff: { changedFiles: 0, insertions: 0, deletions: 0 }
      }
    });
    expect(model.runs.find((run) => run.id === "run_completed")).toMatchObject({
      status: "succeeded",
      evidence: {
        diff: { changedFiles: 1, insertions: 4, deletions: 1 }
      }
    });
    expect(model.activeRuns.map((run) => run.runId)).toEqual(["run_active"]);
    expect(model.conversation.find((entry) => entry.id === "run:run_failed")).toMatchObject({
      type: "agent_failed",
      outputLines: ["tests failed"]
    });
    expect(model.conversation.map((entry) => entry.id)).toContain("run:run_completed");
    expect(model.conversation.map((entry) => entry.id)).toContain("run:run_no_change");
    expect(model.conversation.map((entry) => entry.id)).not.toContain("review-pending:run_no_change");
    expect(model.conversation.find((entry) => entry.id === "run:run_no_change")).toMatchObject({
      type: "agent_completed",
      statusLabel: "completed"
    });
    expect(model.conversation.map((entry) => entry.id)).not.toContain("review:run_completed:accepted");
  });

  it("fills active run boxes from persisted live runtime events", async () => {
    const runtime = createCliRuntime({ storageMode: "memory" });
    await runtime.projectRepository.create({
      id: "project_live",
      name: "Live Events",
      rootPath: "/tmp/live-events",
      createdAt: now,
      updatedAt: now
    });
    await runtime.conversationThreadRepository.create({
      id: "thread_live",
      projectId: "project_live",
      title: "Live Events",
      createdAt: now,
      updatedAt: now
    });
    await runtime.taskRepository.create({
      id: "task_live",
      projectId: "project_live",
      title: "Watch a live run",
      metadata: { threadId: "thread_live" },
      status: "running",
      createdAt: now,
      updatedAt: now
    });
    await runtime.taskRunRepository.create({
      id: "run_live",
      taskId: "task_live",
      agentKind: "codex",
      status: "running",
      startedAt: now,
      createdAt: now,
      updatedAt: now
    });
    await runtime.runEventRepository.createMany([
      event("event_context", "run_live", 0, "status", "Context compiled.", {
        phase: "context",
        desktopEventType: "context_compiled"
      }),
      event("event_started", "run_live", 1, "status", "TaskRunner execution started.", {
        phase: "lifecycle",
        desktopEventType: "run_started"
      }),
      event("event_worktree", "run_live", 2, "status", "Isolated worktree is ready.", {
        phase: "agent",
        desktopEventType: "agent_step"
      }),
      event("event_preflight", "run_live", 3, "status", "Codex preflight passed"),
      event("event_starting", "run_live", 4, "status", "starting Codex"),
      event("event_json_stdout", "run_live", 5, "stdout", "{\"type\":\"session.created\"}\n"),
      event("event_session", "run_live", 6, "status", "Codex session.created", {
        adapterEvent: { type: "session.created" }
      }),
      event("event_skill", "run_live", 7, "message", "Using `noisy-skill` to satisfy setup."),
      event("event_stderr", "run_live", 8, "stderr", "waiting for network\n")
    ]);

    const model = await buildTuiCurrentContextModel(runtime, {
      projectId: "project_live",
      threadId: "thread_live"
    });

    expect(model.activeRuns).toEqual([
      expect.objectContaining({
        runId: "run_live",
        outputLines: ["stderr: waiting for network"]
      })
    ]);
    expect(model.activeRuns[0]?.outputLines.join("\n")).not.toContain("{\"type\"");
    expect(model.activeRuns[0]?.outputLines.join("\n")).not.toContain("Codex session.created");
    expect(model.activeRuns[0]?.outputLines.join("\n")).not.toContain("Using `");
  });

  it("adds elapsed and usage labels for terminal run conversation entries", async () => {
    const runtime = createCliRuntime({ storageMode: "memory" });
    await runtime.projectRepository.create({
      id: "project_usage",
      name: "Usage",
      rootPath: "/tmp/usage",
      createdAt: now,
      updatedAt: now
    });
    await runtime.conversationThreadRepository.create({
      id: "thread_usage",
      projectId: "project_usage",
      title: "Usage",
      createdAt: now,
      updatedAt: now
    });
    await runtime.taskRepository.create({
      id: "task_usage",
      projectId: "project_usage",
      title: "Track usage",
      metadata: { threadId: "thread_usage" },
      status: "completed",
      createdAt: now,
      updatedAt: now
    });
    await runtime.taskRunRepository.create({
      id: "run_usage",
      taskId: "task_usage",
      agentKind: "codex",
      status: "succeeded",
      startedAt: "2026-05-29T10:00:00.000Z",
      completedAt: "2026-05-29T10:01:30.000Z",
      createdAt: "2026-05-29T10:00:00.000Z",
      updatedAt: "2026-05-29T10:01:30.000Z"
    });
    await runtime.runEventRepository.createMany([
      event("event_usage_output", "run_usage", 0, "message", "Usage summary ready."),
      event("event_usage_tokens", "run_usage", 1, "status", "usage", {
        usage: {
          totalTokens: 92000,
          costUsd: 0.03
        }
      })
    ]);

    const model = await buildTuiCurrentContextModel(runtime, {
      projectId: "project_usage",
      threadId: "thread_usage"
    });

    expect(model.runs[0]).toMatchObject({
      id: "run_usage",
      elapsedLabel: "1m30s",
      usageLabel: "92k tok / $0.03",
      usage: {
        totalTokens: 92000,
        costUsd: 0.03
      }
    });
    expect(model.conversation.find((entry) => entry.id === "run:run_usage")).toMatchObject({
      type: "agent_completed",
      elapsedLabel: "1m30s",
      usageLabel: "92k tok / $0.03"
    });
  });

  it("adds quick reply suggestions only to the latest agent result", async () => {
    const runtime = createCliRuntime({ storageMode: "memory" });
    await runtime.projectRepository.create({
      id: "project_suggestions",
      name: "Suggestions",
      rootPath: "/tmp/suggestions",
      createdAt: now,
      updatedAt: now
    });
    await runtime.conversationThreadRepository.create({
      id: "thread_suggestions",
      projectId: "project_suggestions",
      title: "Suggestions",
      createdAt: now,
      updatedAt: now
    });
    await runtime.taskRepository.create({
      id: "task_suggestions",
      projectId: "project_suggestions",
      title: "Suggest replies",
      metadata: { threadId: "thread_suggestions" },
      status: "completed",
      createdAt: now,
      updatedAt: now
    });
    await runtime.taskRunRepository.create({
      id: "run_older",
      taskId: "task_suggestions",
      agentKind: "codex",
      status: "succeeded",
      startedAt: "2026-05-29T10:00:00.000Z",
      completedAt: "2026-05-29T10:00:30.000Z",
      createdAt: "2026-05-29T10:00:00.000Z",
      updatedAt: "2026-05-29T10:00:30.000Z"
    });
    await runtime.taskRunRepository.create({
      id: "run_newer",
      taskId: "task_suggestions",
      agentKind: "codex",
      status: "failed",
      startedAt: "2026-05-29T10:01:00.000Z",
      completedAt: "2026-05-29T10:02:00.000Z",
      createdAt: "2026-05-29T10:01:00.000Z",
      updatedAt: "2026-05-29T10:02:00.000Z"
    });
    await runtime.runEventRepository.createMany([
      event("event_older", "run_older", 0, "message", "older done"),
      event("event_newer", "run_newer", 0, "error", "tests failed")
    ]);
    await runtime.verificationResultRepository.create(
      verification("verification_newer", "run_newer", "pnpm test", "failed")
    );
    await runtime.riskReportRepository.create({
      id: "risk_newer",
      taskRunId: "run_newer",
      level: "high",
      summary: "Failed verification.",
      changedFiles: ["src/fail.ts"],
      verificationSummary: "failed",
      failedChecks: ["pnpm test"],
      riskFactors: ["failed checks"],
      manualReviewChecklist: ["Inspect failed tests."],
      acceptanceRecommendation: "Do not accept.",
      findings: [],
      createdAt: now
    });

    const model = await buildTuiCurrentContextModel(runtime, {
      projectId: "project_suggestions",
      threadId: "thread_suggestions"
    });

    expect(model.conversation.find((entry) => entry.id === "run:run_older")?.suggestions)
      .toBeUndefined();
    expect(model.conversation.find((entry) => entry.id === "run:run_newer")?.suggestions)
      .toEqual([
        expect.objectContaining({ key: "1", label: "Run more tests" }),
        expect.objectContaining({ key: "2", label: "Fix verification" }),
        expect.objectContaining({ key: "3", label: "Review changes" })
      ]);
  });

  it("reports bounded loop stop reasons for terminal, pending, waiting, blocking, and limits", async () => {
    await expect(loopStopReasonFor([roleCall({ id: "call_ok", status: "succeeded" })]))
      .resolves.toBe("terminal");
    await expect(loopStopReasonFor([roleCall({ id: "call_running", status: "running" })]))
      .resolves.toBe("pending_role_calls");
    await expect(
      loopStopReasonFor([
        roleCall({
          id: "call_waiting_approval",
          status: "waiting_approval",
          decision: {
            disposition: "needs_approval",
            reason: "Needs approval."
          }
        })
      ])
    ).resolves.toBe("waiting_approval");
    await expect(
      loopStopReasonFor([
        roleCall({
          id: "call_waiting_context",
          status: "waiting_context",
          decision: {
            disposition: "needs_context",
            reason: "Needs context.",
            requiredContext: ["test output"]
          }
        })
      ])
    ).resolves.toBe("waiting_context");
    await expect(
      loopStopReasonFor([roleCall({ id: "call_running", status: "running" })], {
        blockingRisk: true
      })
    ).resolves.toBe("blocking_risk");
    await expect(
      loopStopReasonFor([roleCall({ id: "call_running", status: "running" })], {
        iteration: 3,
        maxIterations: 3
      })
    ).resolves.toBe("max_iterations");
  });

  it("keeps RoleCall evidence readable when a linked run is missing", async () => {
    const runtime = createCliRuntime({ storageMode: "memory" });
    await runtime.projectRepository.create({
      id: "project_missing_run",
      name: "Missing Run",
      rootPath: "/tmp/missing-run",
      createdAt: now,
      updatedAt: now
    });
    await runtime.conversationThreadRepository.create({
      id: "thread_1",
      projectId: "project_missing_run",
      title: "Missing Run",
      createdAt: now,
      updatedAt: now
    });
    await runtime.roleCallRepository.create(
      roleCall({
        id: "call_missing_run",
        status: "running",
        taskRunId: "run_missing"
      })
    );

    const model = await buildTuiCurrentContextModel(runtime, {
      projectId: "project_missing_run",
      threadId: "thread_1"
    });

    expect(model.roleCalls.nodes[0]).toMatchObject({
      id: "call_missing_run",
      evidence: {
        linkedRunId: "run_missing",
        latestEvent: "linked run evidence unavailable",
        resultSummary: "Linked run no longer exists or could not be read."
      }
    });
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
    event("event_2", "run_active", 1, "status", "verification started", {
      usage: { totalTokens: 42000 }
    }),
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
  await runtime.runArtifactRepository.create({
    id: "artifact_diff_done",
    taskRunId: "run_done",
    kind: "git_diff",
    content: "diff --git a/src/done.ts b/src/done.ts",
    metadata: {
      changedFiles: ["src/done.ts"],
      stat: { filesChanged: 1, insertions: 3, deletions: 1 }
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
  messageText: string,
  metadata: JsonObject = {}
) {
  return {
    id,
    taskRunId,
    sequence,
    type,
    message: messageText,
    metadata,
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

async function seedRunStates(runtime: ReturnType<typeof createCliRuntime>) {
  await runtime.projectRepository.create({
    id: "project_runs",
    name: "Runs",
    rootPath: "/tmp/runs",
    createdAt: now,
    updatedAt: now
  });
  await runtime.conversationThreadRepository.create({
    id: "thread_runs",
    projectId: "project_runs",
    title: "Runs",
    createdAt: now,
    updatedAt: now
  });
  await runtime.taskRepository.create({
    id: "task_runs",
    projectId: "project_runs",
    title: "Operate on runs",
    metadata: { threadId: "thread_runs" },
    status: "running",
    createdAt: now,
    updatedAt: now
  });
  for (const runRecord of [
    runState("run_completed", "succeeded", "2026-05-29T12:01:00.000Z"),
    runState("run_failed", "failed", "2026-05-29T12:02:00.000Z"),
    runState("run_retained", "failed", "2026-05-29T12:03:00.000Z"),
    runState("run_no_change", "succeeded", "2026-05-29T12:04:00.000Z"),
    runState("run_active", "running", "2026-05-29T12:05:00.000Z")
  ]) {
    await runtime.taskRunRepository.create(runRecord);
  }
  await runtime.runEventRepository.createMany([
    event("run_event_active", "run_active", 0, "status", "verifying"),
    event("run_event_failed", "run_failed", 0, "error", "tests failed"),
    event("run_event_completed", "run_completed", 0, "message", "done")
  ]);
  await runtime.verificationResultRepository.create(
    verification("verification_failed", "run_failed", "pnpm test", "failed")
  );
  await runtime.riskReportRepository.create({
    id: "risk_failed",
    taskRunId: "run_failed",
    level: "high",
    summary: "Failed tests.",
    changedFiles: ["src/fail.ts"],
    verificationSummary: "failed",
    failedChecks: ["pnpm test"],
    riskFactors: ["failed checks"],
    manualReviewChecklist: ["Inspect failed tests."],
    acceptanceRecommendation: "Do not accept.",
    findings: [],
    createdAt: now
  });
  await runtime.runMetadataRepository.save({
    runId: "run_retained",
    workspaceCleanup: {
      cleaned: false,
      retained: true,
      reason: "retain_on_failure",
      commands: []
    }
  });
  await runtime.runMetadataRepository.save({
    runId: "run_no_change",
    diff: {
      ok: true,
      workspacePath: "/tmp/worktree",
      isClean: true,
      changedFiles: [],
      stat: { filesChanged: 0, insertions: 0, deletions: 0, text: "" },
      diff: "",
      fileSummaries: [],
      commands: []
    }
  });
  await runtime.runArtifactRepository.create({
    id: "artifact_completed",
    taskRunId: "run_completed",
    kind: "git_diff",
    content: "diff --git a/src/done.ts b/src/done.ts",
    metadata: {
      changedFiles: ["src/done.ts"],
      stat: { filesChanged: 1, insertions: 4, deletions: 1 }
    },
    createdAt: now
  });
  await runtime.runArtifactRepository.create({
    id: "review_completed",
    taskRunId: "run_completed",
    kind: "review_decision",
    content: "Accepted for record. No merge was performed.",
    metadata: {
      reviewStatus: "accepted",
      acceptedAt: "2026-05-29T12:01:30.000Z"
    },
    createdAt: "2026-05-29T12:01:30.000Z"
  });
}

function runState(
  id: string,
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled",
  updatedAt: string
) {
  return {
    id,
    taskId: "task_runs",
    agentKind: "fake" as const,
    status,
    startedAt: updatedAt,
    completedAt: status === "running" ? undefined : updatedAt,
    createdAt: updatedAt,
    updatedAt
  };
}

async function loopStopReasonFor(
  calls: RoleCall[],
  options: {
    iteration?: number;
    maxIterations?: number;
    blockingRisk?: boolean;
  } = {}
) {
  const runtime = createCliRuntime({ storageMode: "memory" });
  await runtime.projectRepository.create({
    id: "project_loop",
    name: "Loop",
    rootPath: "/tmp/loop",
    createdAt: now,
    updatedAt: now
  });
  await runtime.conversationThreadRepository.create({
    id: "thread_1",
    projectId: "project_loop",
    title: "Loop",
    createdAt: now,
    updatedAt: now
  });
  await runtime.taskRepository.create({
    id: "task_loop",
    projectId: "project_loop",
    title: "Loop",
    metadata: { threadId: "thread_1" },
    status: "running",
    createdAt: now,
    updatedAt: now
  });
  if (options.blockingRisk) {
    await runtime.taskRunRepository.create({
      id: "run_blocking",
      taskId: "task_loop",
      agentKind: "fake",
      status: "running",
      createdAt: now,
      updatedAt: now
    });
    await runtime.riskReportRepository.create({
      id: "risk_blocking",
      taskRunId: "run_blocking",
      level: "blocking",
      summary: "Blocking risk.",
      changedFiles: ["danger.ts"],
      verificationSummary: "not safe",
      failedChecks: [],
      riskFactors: ["blocking risk"],
      manualReviewChecklist: ["Stop loop."],
      acceptanceRecommendation: "Stop.",
      findings: [],
      createdAt: now
    });
    calls = calls.map((call) => ({ ...call, taskRunId: "run_blocking" }));
  }
  for (const call of calls) {
    await runtime.roleCallRepository.create(call);
  }
  const model = await buildTuiCurrentContextModel(runtime, {
    projectId: "project_loop",
    threadId: "thread_1",
    iteration: options.iteration,
    maxIterations: options.maxIterations
  });
  return model.roleCalls.loop.stopReason;
}
