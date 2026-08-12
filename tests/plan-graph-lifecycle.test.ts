import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createCliRuntime, main } from "@agent-hub/cli";
import {
  DefaultAgentRegistry,
  FakeAgentAdapter
} from "@agent-hub/agent-adapters";
import {
  buildExecutionTraceGraph,
  buildTuiCurrentContextModel,
  conservativeDelegationPolicy,
  conservativePermissionSet,
  defaultRoleExecutionPolicy,
  deterministicRoleCallIntake,
  RoleCallOrchestrator,
  type PlanGraph,
  type RoleDefinition,
  type RoleIntent
} from "@agent-hub/core";
import { validateRoleCallPolicy } from "@agent-hub/safety";
import {
  FixedClock,
  SequenceIdGenerator,
  VerificationRunner,
  type DiffCollectionResult,
  type DiffCollectorService,
  type WorkspaceConfig,
  type WorkspaceManager,
  type WorkspaceSession
} from "@agent-hub/task-runner";
import { createTestDirectory, MockShellExecutor } from "./helpers";

const now = "2026-06-16T04:30:00.000Z";

describe("PlanGraph lifecycle acceptance", () => {
  it("projects a local PlanGraph lifecycle from planning through CLI and TUI inspection", async () => {
    const projectRoot = await createTestDirectory("plan-graph-lifecycle-project");
    const runRoot = await createTestDirectory("plan-graph-lifecycle-runs");
    await fs.writeFile(path.join(projectRoot, "README.md"), "original\n", "utf8");

    const runtime = createCliRuntime({
      storageMode: "memory",
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector(),
      verificationRunner: new VerificationRunner(
        new MockShellExecutor([{ exitCode: 0, stdout: "ok\n" }])
      ),
      agentRegistry: new DefaultAgentRegistry([new FakeAgentAdapter()]),
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock(now)
    });

    await runtime.projectRepository.create({
      id: "project_lifecycle",
      name: "Lifecycle Project",
      rootPath: projectRoot,
      createdAt: now,
      updatedAt: now
    });
    await runtime.conversationThreadRepository.create({
      id: "thread_lifecycle",
      projectId: "project_lifecycle",
      title: "Lifecycle",
      createdAt: now,
      updatedAt: now
    });
    await runtime.conversationMessageRepository.create({
      id: "message_lifecycle",
      threadId: "thread_lifecycle",
      sequence: 1,
      role: "user",
      kind: "text",
      content: "Implement and verify the lifecycle fixture.",
      createdAt: now
    });
    await runtime.taskRepository.create({
      id: "task_lifecycle",
      projectId: "project_lifecycle",
      title: "Lifecycle acceptance",
      status: "open",
      metadata: { threadId: "thread_lifecycle" },
      createdAt: now,
      updatedAt: now
    });

    const graph = lifecycleGraph();
    await runtime.planGraphRepository.create(graph);

    const scheduled = await runtime.taskRunner.runPlanGraph({
      projectRoot,
      projectId: "project_lifecycle",
      taskId: "task_lifecycle",
      taskPrompt: "Implement and verify the lifecycle fixture.",
      agentKind: "fake",
      threadId: "thread_lifecycle",
      verificationCommands: [
        {
          id: "unit",
          command: "pnpm",
          args: ["test", "--", "lifecycle"],
          timeoutMs: 1_000
        }
      ]
    });

    expect(scheduled.status).toBe("completed");
    expect(scheduled.scheduledRuns).toHaveLength(2);
    const [implementRun, verifyRun] = scheduled.scheduledRuns;
    await expect(runtime.runMetadataRepository.get(implementRun.run.id))
      .resolves.toMatchObject({
        planBinding: {
          planGraphId: graph.id,
          planNodeId: "plan_node_implement"
        }
      });
    await expect(runtime.runMetadataRepository.get(verifyRun.run.id))
      .resolves.toMatchObject({
        planBinding: {
          planGraphId: graph.id,
          planNodeId: "plan_node_verify"
        }
      });
    await expect(runtime.runArtifactRepository.listByRunId(implementRun.run.id))
      .resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "task_brief" }),
        expect.objectContaining({ kind: "git_diff" })
      ]));

    const implementMetadata = await runtime.runMetadataRepository.get(implementRun.run.id);
    if (!implementMetadata?.planBinding) {
      throw new Error("implement run was not bound to the PlanGraph");
    }
    await createRoleCallTrace(runtime, {
      sourceRunId: implementRun.run.id,
      planGraphId: graph.id,
      planGraphVersion: graph.version,
      planNodeId: "plan_node_implement",
      traceNodeId: implementMetadata.planBinding.traceNodeId,
      allowedNextPlanNodeIds: implementMetadata.planBinding.allowedNextPlanNodeIds
    });

    await runtime.runArtifactRepository.create({
      id: "review_decision_lifecycle",
      taskRunId: verifyRun.run.id,
      kind: "review_decision",
      content: "accepted: lifecycle fixture is inspectable.",
      metadata: { summary: "Review accepted the lifecycle fixture." },
      createdAt: now
    });
    await runtime.comparisonReportRepository.create({
      id: "comparison_lifecycle",
      taskId: "task_lifecycle",
      baselineRunId: implementRun.run.id,
      candidateRunId: verifyRun.run.id,
      summary: "Verification run has the best evidence.",
      details: {
        score: {
          baseline: 70,
          candidate: 95,
          winner: "candidate"
        }
      },
      createdAt: now
    });

    const trace = await buildExecutionTraceGraph(
      {
        planGraphRepository: runtime.planGraphRepository,
        traceLinkRepository: runtime.traceLinkRepository,
        taskRunRepository: runtime.taskRunRepository,
        runMetadataRepository: runtime.runMetadataRepository,
        runArtifactRepository: runtime.runArtifactRepository,
        comparisonReportRepository: runtime.comparisonReportRepository,
        roleCallRepository: runtime.roleCallRepository
      },
      { planGraphId: graph.id, now }
    );

    expect(trace.baseNodes.map((node) => node.id)).toEqual([
      "plan_node_planner",
      "plan_node_implement",
      "plan_node_verify"
    ]);
    expect(trace.dynamicNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "task_run",
        sourceId: implementRun.run.id,
        sourcePlanNodeId: "plan_node_implement"
      }),
      expect.objectContaining({
        kind: "task_run",
        sourceId: verifyRun.run.id,
        sourcePlanNodeId: "plan_node_verify"
      }),
      expect.objectContaining({
        kind: "role_call",
        sourceType: "role_call",
        sourcePlanNodeId: "plan_node_implement"
      }),
      expect.objectContaining({
        kind: "review",
        sourceType: "comparison_report",
        sourceId: "comparison_lifecycle"
      })
    ]));
    expect([...new Set(trace.evidence.map((evidence) => evidence.sourceType))])
      .toEqual(expect.arrayContaining([
        "task_run",
        "verification",
        "risk",
        "diff",
        "run_artifact",
        "review_decision",
        "role_call",
        "comparison_report"
      ]));

    const cliOutput: string[] = [];
    const cliErrors: string[] = [];
    await expect(
      main(
        ["execution-trace", "show", "--plan-graph-id", graph.id, "--json"],
        {
          stdout: { write: (chunk: string) => { cliOutput.push(chunk); return true; } },
          stderr: { write: (chunk: string) => { cliErrors.push(chunk); return true; } }
        },
        projectRoot,
        runtime
      )
    ).resolves.toBe(0);
    expect(cliErrors).toEqual([]);
    const cliJson = JSON.parse(cliOutput.join("")) as { executionTrace: typeof trace };
    expect(cliJson.executionTrace.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceType: "review_decision" }),
      expect.objectContaining({ sourceType: "comparison_report" })
    ]));

    const tuiModel = await buildTuiCurrentContextModel(runtime, {
      projectId: "project_lifecycle",
      threadId: "thread_lifecycle"
    });
    expect(tuiModel.executionTrace).toEqual(
      expect.objectContaining({
        planGraphId: graph.id,
        dynamicNodes: expect.arrayContaining([
          expect.objectContaining({ sourceType: "comparison_report" }),
          expect.objectContaining({ sourceType: "role_call" })
        ])
      })
    );
    expect(tuiModel.selectionDetails.graph.overlay).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "plan_node_implement" }),
      expect.objectContaining({ id: "trace_node:comparison:comparison_lifecycle" })
    ]));
  });
});

function lifecycleGraph(): PlanGraph {
  return {
    id: "plan_graph_lifecycle",
    taskId: "task_lifecycle",
    version: 1,
    status: "active",
    plannerNodeId: "plan_node_planner",
    createdByRole: "planner",
    createdAt: now,
    nodes: [
      {
        id: "plan_node_planner",
        kind: "planner",
        role: "planner",
        title: "Create lifecycle plan",
        instructions: "Create a deterministic lifecycle plan.",
        acceptanceCriteria: ["Plan is valid."],
        riskLevel: "low",
        required: true,
        execution: { mode: "system" },
        outputPlanGraphId: "plan_graph_lifecycle"
      },
      {
        id: "plan_node_implement",
        kind: "implement",
        role: "engineer",
        title: "Implement fixture",
        instructions: "Run the fake implementation step.",
        acceptanceCriteria: ["Implementation run is linked."],
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
        title: "Verify fixture",
        instructions: "Run the fake verification step.",
        acceptanceCriteria: ["Verification evidence is linked."],
        riskLevel: "medium",
        required: true,
        execution: {
          mode: "primary_run",
          expectedAdapter: "fake",
          worktreePolicy: "isolated"
        }
      }
    ],
    edges: [
      { from: "plan_node_planner", to: "plan_node_implement", type: "primary" },
      { from: "plan_node_implement", to: "plan_node_verify", type: "primary" }
    ]
  };
}

async function createRoleCallTrace(
  runtime: ReturnType<typeof createCliRuntime>,
  binding: {
    sourceRunId: string;
    planGraphId: string;
    planGraphVersion: number;
    planNodeId: string;
    traceNodeId?: string;
    allowedNextPlanNodeIds: readonly string[];
  }
): Promise<void> {
  const orchestrator = new RoleCallOrchestrator({
    repositories: {
      roleCallRepository: runtime.roleCallRepository,
      roleCallEventRepository: runtime.roleCallEventRepository,
      roleTodoRepository: runtime.roleTodoRepository,
      traceLinkRepository: runtime.traceLinkRepository
    },
    roles: [
      role("engineer", {
        canInitiateRoleCalls: true,
        allowedIntentTypes: ["request_review"],
        allowedTargetRoles: ["reviewer"]
      }),
      role("reviewer", {})
    ],
    idFactory: roleCallIdFactory(),
    now: () => now,
    intakeDecider: deterministicRoleCallIntake({}),
    policyValidator: (policyInput) =>
      validateRoleCallPolicy({
        ...policyInput,
        executionPolicy: {
          ...defaultRoleExecutionPolicy,
          maxDepth: 2,
          allowedDelegations: { engineer: ["reviewer"] }
        }
      })
  });

  await orchestrator.processRoleIntents({
    threadId: "thread_lifecycle",
    callerRole: "engineer",
    userGoal: "Review the lifecycle implementation evidence.",
    intents: [reviewIntent()],
    sourcePlanBinding: binding
  });
}

function role(
  handle: "engineer" | "reviewer",
  delegation: Partial<RoleDefinition["delegationPolicy"]>
): RoleDefinition {
  return {
    id: `role_${handle}`,
    handle,
    displayName: handle === "engineer" ? "Engineer" : "Reviewer",
    purpose: "Exercise the local RoleCall trace path.",
    defaultInstructions: "Stay local and bounded.",
    capabilities: ["review"],
    permissions: { ...conservativePermissionSet },
    contextPolicy: {
      scope: "current_thread_and_project_context",
      includeApprovedMemory: true,
      includeThreadSummary: true,
      instructions: ["Use runtime context."]
    },
    approvalPolicy: {
      requiredFor: [],
      summary: "No automatic side effects."
    },
    delegationPolicy: {
      ...conservativeDelegationPolicy,
      ...delegation
    },
    intakePolicy: {
      acceptsRoleCalls: true,
      acceptedIntentTypes: ["request_review"],
      canReject: true,
      canDefer: true
    },
    executor: { kind: "agent_adapter", adapter: "fake" },
    trustLevel: "preset",
    enabled: true
  };
}

function reviewIntent(): RoleIntent {
  return {
    type: "request_review",
    targetRole: "reviewer",
    task: "Review the lifecycle fixture evidence.",
    reason: "The implementation step needs reviewer evidence."
  };
}

function roleCallIdFactory(): (prefix: string) => string {
  const counts = new Map<string, number>();
  return (prefix: string) => {
    const next = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, next);
    return `${prefix}_${next}`;
  };
}

class TestWorkspaceManager implements WorkspaceManager {
  constructor(private readonly runRoot: string) {}

  async createSession(config: WorkspaceConfig): Promise<WorkspaceSession> {
    const workspacePath = path.join(
      this.runRoot,
      `${config.taskId}-${config.agentKind}-${config.runId}`
    );
    await fs.mkdir(workspacePath, { recursive: true });
    return {
      workspace: {
        path: workspacePath,
        branchName: config.branchName ?? `agent-hub/${config.taskId}/${config.agentKind}`,
        sourceRepositoryPath: config.sourceRepositoryPath,
        workspaceBasePath: this.runRoot,
        taskId: config.taskId,
        runId: config.runId,
        agentKind: config.agentKind,
        startPoint: config.startPoint,
        dryRun: config.dryRun ?? false,
        sourceRepositoryDirty: false,
        cleanupPolicy: config.cleanupPolicy ?? "never"
      },
      creationCommands: [],
      cleanup: async () => ({
        cleaned: true,
        retained: false,
        reason: "test cleanup",
        commands: []
      })
    };
  }
}

class StaticDiffCollector implements DiffCollectorService {
  async collect(input: { workspacePath: string }): Promise<DiffCollectionResult> {
    return {
      ok: true,
      workspacePath: input.workspacePath,
      isClean: false,
      changedFiles: [{ path: "fake-agent-output.md", status: "untracked" }],
      stat: {
        filesChanged: 1,
        insertions: 1,
        deletions: 0,
        text: "1 file changed, 1 insertion(+)"
      },
      diff: "",
      fileSummaries: ["fake-agent-output.md: untracked"],
      commands: []
    };
  }
}
