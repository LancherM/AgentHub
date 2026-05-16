import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CodexAdapter, FakeAgentAdapter } from "../src/agent-adapters";
import {
  DefaultContextCompiler,
  InMemoryMemoryProvider,
  MarkdownContextFormatter
} from "../src/context-compiler";
import type { DiffCollectionResult, DiffCollectorService } from "../src/diff-collector";
import {
  DefaultAgentRegistry,
  InMemoryRiskReportRepository,
  InMemoryRunArtifactRepository,
  InMemoryRunEventRepository,
  InMemoryTaskRepository,
  InMemoryTaskRunRepository,
  InMemoryVerificationResultRepository
} from "../src/storage";
import {
  FixedClock,
  SequenceIdGenerator,
  TaskRunner,
  TaskRunnerError
} from "../src/task-runner";
import { VerificationRunner } from "../src/verification";
import type {
  WorkspaceConfig,
  WorkspaceManager,
  WorkspaceSession
} from "../src/workspace";
import { createTestDirectory, MockProcessRunner, MockShellExecutor } from "./helpers";

describe("task runner", () => {
  it("runs the fake adapter in an isolated directory without modifying the project root", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");
    const runRoot = await createTestDirectory("agent-hub-runs");
    const projectMarker = path.join(projectRoot, "README.md");
    await fs.writeFile(projectMarker, "original\n", "utf8");
    const before = await fs.readdir(projectRoot);

    const runner = createTestRunner(runRoot);

    const result = await runner.run({
      projectRoot,
      taskPrompt: "Create a deterministic fake output",
      agentKind: "fake",
      taskId: "task_1"
    });

    expect(result.status).toBe("succeeded");
    expect(result.run.status).toBe("succeeded");
    expect(result.diff?.changedFiles).toEqual([
      { path: "fake-agent-output.md", status: "untracked" }
    ]);
    expect(result.verification?.status).toBe("skipped");
    expect(result.riskReport?.level).toBe("medium");
    expect(result.worktreePath?.startsWith(runRoot)).toBe(true);
    expect(result.taskBriefPath?.startsWith(result.worktreePath ?? "")).toBe(true);
    await expect(
      fs.readFile(path.join(result.worktreePath ?? "", "fake-agent-output.md"), "utf8")
    ).resolves.toContain("Create a deterministic fake output");
    await expect(fs.readFile(projectMarker, "utf8")).resolves.toBe("original\n");
    await expect(fs.readdir(projectRoot)).resolves.toEqual(before);
  });

  it("rejects run roots inside the original project root", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");

    await expect(
      createTestRunner(path.join(projectRoot, ".agent-hub", "runs")).run({
        projectRoot,
        taskPrompt: "This should fail",
        agentKind: "fake"
      })
    ).rejects.toThrow(TaskRunnerError);
  });

  it("rejects unimplemented agents", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");
    const runRoot = await createTestDirectory("agent-hub-runs");

    await expect(
      new TaskRunner({
        defaultRunRoot: runRoot,
        workspaceManager: new TestWorkspaceManager(runRoot),
        diffCollector: new StaticDiffCollector(),
        verificationRunner: new VerificationRunner(new MockShellExecutor()),
        agentRegistry: new DefaultAgentRegistry([new FakeAgentAdapter()])
      }).run({
        projectRoot,
        taskPrompt: "Run codex",
        agentKind: "codex"
      })
    ).resolves.toMatchObject({
      ok: false,
      error: "agent codex is not registered"
    });
  });

  it("persists tasks, runs, and status transitions", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");
    const runRoot = await createTestDirectory("agent-hub-runs");
    const taskRepository = new InMemoryTaskRepository();
    const taskRunRepository = new InMemoryTaskRunRepository();
    const runEventRepository = new InMemoryRunEventRepository();
    const runArtifactRepository = new InMemoryRunArtifactRepository();
    const verificationResultRepository = new InMemoryVerificationResultRepository();
    const riskReportRepository = new InMemoryRiskReportRepository();
    const runner = new TaskRunner({
      taskRepository,
      taskRunRepository,
      runEventRepository,
      runArtifactRepository,
      verificationResultRepository,
      riskReportRepository,
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector(),
      verificationRunner: new VerificationRunner(new MockShellExecutor()),
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock("2026-01-01T00:00:00.000Z")
    });

    const result = await runner.run({
      projectRoot,
      rawPrompt: "@fake persist this run"
    });

    await expect(taskRepository.list()).resolves.toEqual([result.task]);
    await expect(taskRunRepository.list()).resolves.toEqual([
      expect.objectContaining({
        id: "run_0002",
        taskId: "task_0001",
        status: "succeeded",
        worktreePath: result.worktreePath
      })
    ]);
    expect(result.statusTransitions.map((transition) => transition.status)).toEqual([
      "queued",
      "running",
      "succeeded"
    ]);
    await expect(runEventRepository.listByRunId("run_0002")).resolves.toEqual([
      expect.objectContaining({ sequence: 0, type: "stdout" }),
      expect.objectContaining({ sequence: 1, type: "exit" })
    ]);
    await expect(
      runArtifactRepository.getLatestByRunIdAndKind("run_0002", "git_diff")
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "git_diff",
        metadata: expect.objectContaining({
          changedFiles: [{ path: "fake-agent-output.md", status: "untracked" }]
        })
      })
    );
    await expect(verificationResultRepository.listByRunId("run_0002")).resolves.toEqual([
      expect.objectContaining({ command: "not configured", status: "skipped" })
    ]);
    await expect(riskReportRepository.getLatestByRunId("run_0002")).resolves.toEqual(
      expect.objectContaining({ level: "medium" })
    );
  });

  it("passes compiled context to the fake adapter", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");
    const runRoot = await createTestDirectory("agent-hub-runs");
    const runner = new TaskRunner({
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector(),
      verificationRunner: new VerificationRunner(new MockShellExecutor()),
      contextCompiler: new DefaultContextCompiler({
        memoryProvider: new InMemoryMemoryProvider([
          { id: "memory_1", content: "Use runtime injection." }
        ])
      }),
      contextFormatter: new MarkdownContextFormatter(),
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock("2026-01-01T00:00:00.000Z")
    });

    const result = await runner.run({
      projectRoot,
      rawPrompt: "@fake use context"
    });

    expect(result.contextMarkdown).toContain("Use runtime injection.");
    expect(result.fakeOutput).toContain("context_sections: 4");
    expect(result.fakeOutput).toContain("Use runtime injection.");
  });

  it("records failed fake adapter execution without crashing", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");
    const runRoot = await createTestDirectory("agent-hub-runs");
    const runner = new TaskRunner({
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector(),
      verificationRunner: new VerificationRunner(new MockShellExecutor()),
      agentRegistry: new DefaultAgentRegistry([
        new FakeAgentAdapter({ fail: true, failureMessage: "forced fake failure" })
      ]),
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock("2026-01-01T00:00:00.000Z")
    });

    const result = await runner.run({
      projectRoot,
      rawPrompt: "@fake fail this run"
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error).toBe("forced fake failure");
    expect(result.statusTransitions.map((transition) => transition.status)).toEqual([
      "queued",
      "running",
      "failed"
    ]);
  });

  it("persists failed Codex process exits as inspectable failed runs", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");
    const runRoot = await createTestDirectory("agent-hub-runs");
    const runEventRepository = new InMemoryRunEventRepository();
    const runner = new TaskRunner({
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector(),
      verificationRunner: new VerificationRunner(new MockShellExecutor()),
      runEventRepository,
      agentRegistry: new DefaultAgentRegistry([
        new CodexAdapter({
          processRunner: new MockProcessRunner([
            [
              { type: "stderr", data: "codex failed\n" },
              { type: "exit", exitCode: 2, signal: null }
            ]
          ])
        })
      ]),
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock("2026-01-01T00:00:00.000Z")
    });

    const result = await runner.run({
      projectRoot,
      rawPrompt: "@codex fail this run"
    });

    expect(result.status).toBe("failed");
    expect(result.run.status).toBe("failed");
    await expect(runEventRepository.listByRunId(result.run.id)).resolves.toEqual([
      expect.objectContaining({ type: "status", message: "starting Codex" }),
      expect.objectContaining({ type: "stderr", message: "codex failed\n" }),
      expect.objectContaining({
        type: "exit",
        metadata: expect.objectContaining({ exitCode: 2, signal: null })
      })
    ]);
  });

  it("marks the run failed when verification fails and retains on failure when configured", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");
    const runRoot = await createTestDirectory("agent-hub-runs");
    const runner = new TaskRunner({
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector(),
      verificationRunner: new VerificationRunner(
        new MockShellExecutor([{ exitCode: 1, stderr: "tests failed\n" }])
      ),
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock("2026-01-01T00:00:00.000Z")
    });

    const result = await runner.run({
      projectRoot,
      rawPrompt: "@fake verify this run",
      workspaceCleanupPolicy: "retain_on_failure",
      verificationCommands: [{ id: "test", command: "pnpm", args: ["test"] }]
    });

    expect(result.status).toBe("failed");
    expect(result.verification?.failedCommands.map((entry) => entry.commandId)).toEqual([
      "test"
    ]);
    expect(result.riskReport?.level).toBe("high");
    expect(result.workspaceCleanup?.retained).toBe(true);
  });
});

function createTestRunner(runRoot: string): TaskRunner {
  return new TaskRunner({
    defaultRunRoot: runRoot,
    workspaceManager: new TestWorkspaceManager(runRoot),
    diffCollector: new StaticDiffCollector(),
    verificationRunner: new VerificationRunner(new MockShellExecutor()),
    idGenerator: new SequenceIdGenerator(),
    clock: new FixedClock("2026-01-01T00:00:00.000Z")
  });
}

class TestWorkspaceManager implements WorkspaceManager {
  constructor(private readonly runRoot: string) {}

  async createSession(config: WorkspaceConfig): Promise<WorkspaceSession> {
    const workspacePath = path.join(this.runRoot, `${config.taskId}-${config.agentKind}`);
    await fs.mkdir(workspacePath, { recursive: true });
    return {
      workspace: {
        path: workspacePath,
        branchName: `agent-hub/${config.taskId}/${config.agentKind}`,
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
      cleanup: async ({ successful }) => {
        if (config.cleanupPolicy === "retain_on_failure" && !successful) {
          return {
            cleaned: false,
            retained: true,
            reason: "test retain on failure",
            commands: []
          };
        }
        return {
          cleaned: true,
          retained: false,
          reason: "test cleanup",
          commands: []
        };
      }
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
