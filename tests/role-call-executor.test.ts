import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CodexAdapter,
  DefaultAgentRegistry,
  FakeAgentAdapter
} from "@agent-hub/agent-adapters";
import {
  conservativePermissionSet,
  InMemoryRoleCallEventRepository,
  InMemoryRoleCallRepository,
  InMemoryRoleTodoRepository,
  InMemoryRunMetadataRepository,
  InMemoryTaskRunRepository,
  type RoleCall,
  type RoleDefinition,
  type RoleTodo
} from "@agent-hub/core";
import {
  FixedClock,
  RoleCallTaskRunnerExecutor,
  SequenceIdGenerator,
  TaskRunner,
  VerificationRunner,
  type DiffCollectionResult,
  type DiffCollectorService,
  type WorkspaceConfig,
  type WorkspaceManager,
  type WorkspaceSession
} from "@agent-hub/task-runner";
import { createTestDirectory, MockProcessRunner, MockShellExecutor } from "./helpers";

const createdAt = "2026-05-28T00:00:00.000Z";

function role(overrides: Partial<RoleDefinition>): RoleDefinition {
  return {
    id: "role_operator",
    handle: "operator",
    displayName: "Operator",
    purpose: "Execute local work.",
    defaultInstructions: "Use local evidence and avoid unapproved side effects.",
    capabilities: ["local_execution"],
    permissions: {
      ...conservativePermissionSet,
      canRunCommands: true
    },
    contextPolicy: {
      scope: "current_thread_and_project_context",
      includeApprovedMemory: true,
      includeThreadSummary: true,
      instructions: ["Use runtime context."]
    },
    approvalPolicy: {
      requiredFor: ["external_side_effects"],
      summary: "No external side effects."
    },
    delegationPolicy: {
      canInitiateRoleCalls: false,
      allowedIntentTypes: []
    },
    intakePolicy: {
      acceptsRoleCalls: true,
      acceptedIntentTypes: ["delegate"],
      canReject: true,
      canDefer: true
    },
    executor: { kind: "agent_adapter", adapter: "fake" },
    trustLevel: "preset",
    enabled: true,
    ...overrides
  };
}

function acceptedCall(overrides: Partial<RoleCall> = {}): RoleCall {
  return {
    id: "role_call_1",
    threadId: "thread_1",
    callerRole: "analyst",
    calleeRole: "operator",
    task: "Inspect failed run evidence.",
    reason: "The analyst needs local execution evidence.",
    context: {
      userGoal: "Fix failed run.",
      constraints: ["Stay local-first"]
    },
    permissions: { ...conservativePermissionSet },
    expectedOutput: { format: "json" },
    priority: "normal",
    depth: 1,
    status: "accepted",
    decision: {
      disposition: "accepted",
      reason: "Operator accepted the task."
    },
    createdAt,
    ...overrides
  };
}

function roleTodo(overrides: Partial<RoleTodo> = {}): RoleTodo {
  return {
    id: "role_todo_1",
    threadId: "thread_1",
    role: "operator",
    sourceRoleCallId: "role_call_1",
    title: "Inspect failed run evidence.",
    status: "in_progress",
    priority: "normal",
    reason: "Operator accepted the task.",
    relatedRoleCallIds: ["role_call_1"],
    createdAt,
    updatedAt: createdAt,
    ...overrides
  };
}

describe("role call TaskRunner executor", () => {
  it("executes accepted fake role calls through TaskRunner and links run evidence", async () => {
    const projectRoot = await createTestDirectory("role-call-project");
    const runRoot = await createTestDirectory("role-call-runs");
    await fs.writeFile(path.join(projectRoot, "README.md"), "original\n", "utf8");
    const roleTodoRepository = new InMemoryRoleTodoRepository();
    const roleCallRepository = new InMemoryRoleCallRepository(roleTodoRepository);
    const roleCallEventRepository = new InMemoryRoleCallEventRepository();
    const taskRunRepository = new InMemoryTaskRunRepository();
    const runMetadataRepository = new InMemoryRunMetadataRepository();
    await roleTodoRepository.create(roleTodo());
    await roleCallRepository.create(acceptedCall({ todoId: "role_todo_1" }));
    const runner = new TaskRunner({
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector(),
      verificationRunner: new VerificationRunner(new MockShellExecutor()),
      taskRunRepository,
      runMetadataRepository,
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock(createdAt)
    });
    const executor = new RoleCallTaskRunnerExecutor({
      taskRunner: runner,
      repositories: { roleCallRepository, roleCallEventRepository, roleTodoRepository },
      roles: [role({})],
      idFactory: createIdFactory(),
      now: () => createdAt
    });

    const result = await executor.execute({
      roleCallId: "role_call_1",
      projectRoot,
      taskRunnerOptions: { workspaceBasePath: runRoot }
    });

    expect(result.ok).toBe(true);
    expect(result.run?.status).toBe("succeeded");
    expect(result.result).toEqual(
      expect.objectContaining({
        summary: "fake agent completed",
        filesTouched: ["fake-agent-output.md"]
      })
    );
    await expect(roleCallRepository.get("role_call_1")).resolves.toEqual(
      expect.objectContaining({
        status: "succeeded",
        taskRunId: result.run?.run.id,
        result: expect.objectContaining({
          evidence: expect.arrayContaining([`task_run:${result.run?.run.id}`])
        })
      })
    );
    await expect(taskRunRepository.get(result.run?.run.id ?? "")).resolves.toEqual(
      expect.objectContaining({ status: "succeeded", agentKind: "fake" })
    );
    await expect(runMetadataRepository.get(result.run?.run.id ?? "")).resolves.toEqual(
      expect.objectContaining({
        workspace: expect.objectContaining({
          path: expect.stringContaining(runRoot)
        })
      })
    );
    await expect(
      roleCallEventRepository.listByRoleCallId("role_call_1")
    ).resolves.toEqual([
      expect.objectContaining({ type: "queued" }),
      expect.objectContaining({ type: "started" }),
      expect.objectContaining({ type: "result_reported" }),
      expect.objectContaining({ type: "todo_updated" })
    ]);
    await expect(roleTodoRepository.get("role_todo_1")).resolves.toEqual(
      expect.objectContaining({ status: "done", completedAt: createdAt })
    );
    const outputPath = path.join(result.run?.worktreePath ?? "", "fake-agent-output.md");
    await expect(fs.readFile(outputPath, "utf8")).resolves.toContain("RoleCallContext");
  });

  it("fails process-backed role calls inspectably when adapter preflight is unavailable", async () => {
    const projectRoot = await createTestDirectory("role-call-codex-project");
    const runRoot = await createTestDirectory("role-call-codex-runs");
    const roleTodoRepository = new InMemoryRoleTodoRepository();
    const roleCallRepository = new InMemoryRoleCallRepository(roleTodoRepository);
    const roleCallEventRepository = new InMemoryRoleCallEventRepository();
    const processRunner = new MockProcessRunner([], [
      { available: false, reason: "not authenticated" }
    ]);
    await roleCallRepository.create(
      acceptedCall({
        id: "role_call_codex",
        calleeRole: "engineer"
      })
    );
    const runner = new TaskRunner({
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector(),
      verificationRunner: new VerificationRunner(new MockShellExecutor()),
      agentRegistry: new DefaultAgentRegistry([
        new FakeAgentAdapter(),
        new CodexAdapter({ processRunner })
      ]),
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock(createdAt)
    });
    const executor = new RoleCallTaskRunnerExecutor({
      taskRunner: runner,
      repositories: { roleCallRepository, roleCallEventRepository },
      roles: [
        role({
          id: "role_engineer",
          handle: "engineer",
          displayName: "Engineer",
          executor: { kind: "agent_adapter", adapter: "codex" }
        })
      ],
      idFactory: createIdFactory(),
      now: () => createdAt
    });

    const result = await executor.execute({
      roleCallId: "role_call_codex",
      projectRoot,
      taskRunnerOptions: { workspaceBasePath: runRoot }
    });

    expect(result.ok).toBe(false);
    expect(processRunner.detectCalls).toHaveLength(1);
    expect(processRunner.runCalls).toHaveLength(0);
    await expect(roleCallRepository.get("role_call_codex")).resolves.toEqual(
      expect.objectContaining({
        status: "failed",
        taskRunId: result.run?.run.id,
        error: expect.any(String)
      })
    );
    await expect(
      roleCallEventRepository.listByRoleCallId("role_call_codex")
    ).resolves.toContainEqual(
      expect.objectContaining({
        type: "failed",
        message: expect.any(String)
      })
    );
  });
});

function createIdFactory(): (prefix: string) => string {
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
