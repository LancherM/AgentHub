import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createCliRuntime, main } from "../src/cli";
import type { DiffCollectionResult, DiffCollectorService } from "../src/diff-collector";
import type { RiskReport } from "../src/domain";
import { createSqliteRepositories } from "../src/sqlite-storage";
import { SequenceIdGenerator, FixedClock } from "../src/task-runner";
import { VerificationRunner } from "../src/verification";
import type {
  WorkspaceConfig,
  WorkspaceManager,
  WorkspaceSession
} from "../src/workspace";
import { createTestDirectory, MockProcessRunner, MockShellExecutor } from "./helpers";

describe("CLI", () => {
  it("runs fake tasks and lists in-memory tasks and runs", async () => {
    const projectRoot = await createTestDirectory("cli-project");
    const runRoot = path.join(await createTestDirectory("cli-runs"), "runs");
    const runtime = createCliRuntime({
      storageMode: "memory",
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector(),
      verificationRunner: new VerificationRunner(new MockShellExecutor()),
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock("2026-01-01T00:00:00.000Z")
    });
    const output: string[] = [];
    const errors: string[] = [];
    const io = {
      stdout: { write: (chunk: string) => { output.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
    };

    await expect(
      main(["run", "@fake", "compile context"], io, projectRoot, runtime)
    ).resolves.toBe(0);
    await expect(main(["tasks", "list"], io, projectRoot, runtime)).resolves.toBe(0);
    await expect(main(["runs", "list"], io, projectRoot, runtime)).resolves.toBe(0);
    await expect(
      main(["runs", "show", "run_0002"], io, projectRoot, runtime)
    ).resolves.toBe(0);
    await expect(
      main(["risks", "show", "run_0002"], io, projectRoot, runtime)
    ).resolves.toBe(0);

    expect(errors.join("")).toBe("");
    expect(output.join("")).toContain("Task run completed");
    expect(output.join("")).toContain("fake_output:");
    expect(output.join("")).toContain("changed_files: 1");
    expect(output.join("")).toContain("risk: medium");
    expect(output.join("")).toContain("task_0001\tcompleted\tadhoc_project\tcompile context");
    expect(output.join("")).toContain("run_0002\tsucceeded\tfake\ttask_0001");
    expect(output.join("")).toContain("acceptance:");
  });

  it("routes @codex and --agent claude-code runs through process-backed adapters", async () => {
    const projectRoot = await createTestDirectory("cli-process-project");
    const runRoot = path.join(await createTestDirectory("cli-process-runs"), "runs");
    const runtime = createCliRuntime({
      storageMode: "memory",
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector(),
      verificationRunner: new VerificationRunner(new MockShellExecutor()),
      processRunner: new MockProcessRunner([
        [
          { type: "stdout", data: "{\"type\":\"agent_message\",\"message\":\"codex ok\"}\n" },
          { type: "exit", exitCode: 0, signal: null }
        ],
        [
          { type: "stdout", data: "{\"type\":\"result\",\"result\":\"claude ok\"}\n" },
          { type: "exit", exitCode: 0, signal: null }
        ]
      ]),
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock("2026-01-01T00:00:00.000Z")
    });
    const output: string[] = [];
    const errors: string[] = [];
    const io = {
      stdout: { write: (chunk: string) => { output.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
    };

    await expect(
      main(["run", "@codex", "compile context"], io, projectRoot, runtime)
    ).resolves.toBe(0);
    await expect(
      main([
        "run",
        "--agent",
        "claude-code",
        "--prompt",
        "review context"
      ], io, projectRoot, runtime)
    ).resolves.toBe(0);

    expect(errors.join("")).toBe("");
    expect(output.join("")).toContain("agent: codex");
    expect(output.join("")).toContain("agent: claude-code");
  });

  it("persists CLI task, run, and risk views through SQLite runtimes", async () => {
    const projectRoot = await createTestDirectory("cli-sqlite-project");
    const runRoot = path.join(await createTestDirectory("cli-sqlite-runs"), "runs");
    const databasePath = path.join(
      await createTestDirectory("cli-sqlite-db"),
      "agent-hub.sqlite"
    );
    const firstRuntime = createCliRuntime({
      sqliteDatabasePath: databasePath,
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector(),
      verificationRunner: new VerificationRunner(new MockShellExecutor()),
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock("2026-01-01T00:00:00.000Z")
    });
    const runOutput: string[] = [];
    const queryOutput: string[] = [];
    const errors: string[] = [];
    const runIo = {
      stdout: { write: (chunk: string) => { runOutput.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
    };
    const queryIo = {
      stdout: { write: (chunk: string) => { queryOutput.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
    };

    await expect(
      main(["run", "@fake", "persist sqlite views"], runIo, projectRoot, firstRuntime)
    ).resolves.toBe(0);

    const secondRuntime = createCliRuntime({ sqliteDatabasePath: databasePath });
    await expect(
      main(["tasks", "list"], queryIo, projectRoot, secondRuntime)
    ).resolves.toBe(0);
    await expect(
      main(["runs", "list"], queryIo, projectRoot, secondRuntime)
    ).resolves.toBe(0);
    await expect(
      main(["runs", "show", "run_0002"], queryIo, projectRoot, secondRuntime)
    ).resolves.toBe(0);
    await expect(
      main(["risks", "show", "run_0002"], queryIo, projectRoot, secondRuntime)
    ).resolves.toBe(0);

    expect(errors.join("")).toBe("");
    expect(queryOutput.join("")).toContain(
      "task_0001\tcompleted\tadhoc_project\tpersist sqlite views"
    );
    expect(queryOutput.join("")).toContain("run_0002\tsucceeded\tfake\ttask_0001");
    expect(queryOutput.join("")).toContain("changed_files: 1");
    expect(queryOutput.join("")).toContain("risk: medium");
    expect(queryOutput.join("")).toContain("acceptance:");
  });

  it("supports --db project, task, and registered fake run commands across runtimes", async () => {
    const projectRoot = await createTestDirectory("cli-registered-project");
    const runRoot = path.join(await createTestDirectory("cli-registered-runs"), "runs");
    const databasePath = path.join(
      await createTestDirectory("cli-registered-db"),
      "agent-hub.sqlite"
    );
    const output: string[] = [];
    const errors: string[] = [];
    const io = {
      stdout: { write: (chunk: string) => { output.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
    };

    await expect(
      main([
        "--db",
        databasePath,
        "project",
        "add",
        "--name",
        "registered",
        "--root",
        projectRoot
      ], io, projectRoot)
    ).resolves.toBe(0);
    const projectId = extractLineValue(output.join(""), "id");

    await expect(
      main([
        "--db",
        databasePath,
        "task",
        "create",
        "--project-id",
        projectId,
        "--title",
        "Registered fake task",
        "--description",
        "Run the registered fake task"
      ], io, projectRoot)
    ).resolves.toBe(0);
    const taskId = output.join("").match(/id: (task_[^\n]+)/)?.[1] ?? "";
    expect(taskId).toMatch(/^task_/);

    await expect(
      main([
        "--db",
        databasePath,
        "run",
        "--task",
        taskId,
        "--agent",
        "fake",
        "--workspace-base",
        runRoot,
        "--dry-run"
      ], io, projectRoot)
    ).resolves.toBe(0);

    const queryOutput: string[] = [];
    const queryIo = {
      stdout: { write: (chunk: string) => { queryOutput.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
    };
    await expect(
      main(["--db", databasePath, "project", "list"], queryIo, projectRoot)
    ).resolves.toBe(0);
    await expect(
      main(["--db", databasePath, "task", "list", "--project-id", projectId], queryIo, projectRoot)
    ).resolves.toBe(0);
    await expect(
      main(["--db", databasePath, "task", "history", "--task-id", taskId], queryIo, projectRoot)
    ).resolves.toBe(0);

    expect(errors.join("")).toBe("");
    expect(queryOutput.join("")).toContain(`${projectId}\tregistered\t${projectRoot}`);
    expect(queryOutput.join("")).toContain(`${taskId}\tcompleted\t${projectId}\tRegistered fake task`);
    expect(queryOutput.join("")).toContain(`Task ${taskId}`);
    expect(queryOutput.join("")).toContain("runs: 1");
    expect(queryOutput.join("")).toContain("events: 2");
  });

  it("supports context init, show, build, and export dry-run commands", async () => {
    const projectRoot = await createTestDirectory("cli-context-project");
    const agentHubHome = await createTestDirectory("cli-context-home");
    const output: string[] = [];
    const errors: string[] = [];
    const io = {
      stdout: { write: (chunk: string) => { output.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
    };

    await expect(
      main([
        "context",
        "init",
        "--project-root",
        projectRoot,
        "--project-id",
        "project_1",
        "--agent-hub-home",
        agentHubHome
      ], io, projectRoot)
    ).resolves.toBe(0);
    await expect(
      main([
        "context",
        "show",
        "--project-root",
        projectRoot,
        "--project-id",
        "project_1",
        "--agent-hub-home",
        agentHubHome
      ], io, projectRoot)
    ).resolves.toBe(0);
    await expect(
      main([
        "context",
        "build",
        "--project-root",
        projectRoot,
        "--project-id",
        "project_1",
        "--task-id",
        "task_1",
        "--title",
        "Build context",
        "--prompt",
        "Compile context",
        "--agent-hub-home",
        agentHubHome
      ], io, projectRoot)
    ).resolves.toBe(0);
    await expect(
      main([
        "context",
        "export",
        "--project-root",
        projectRoot,
        "--project-id",
        "project_1",
        "--agent-hub-home",
        agentHubHome,
        "--dry-run"
      ], io, projectRoot)
    ).resolves.toBe(0);

    expect(errors.join("")).toBe("");
    expect(output.join("")).toContain("Initialized context store");
    expect(output.join("")).toContain("  - context/project.md");
    expect(output.join("")).toContain("Built context artifacts");
    expect(output.join("")).toContain("Previewed repo context export");
    await expect(fs.access(path.join(projectRoot, "AGENTS.md"))).rejects.toThrow();
  });

  it("supports memory propose, list, approve, and reject without injecting rejected memory", async () => {
    const projectRoot = await createTestDirectory("cli-memory-project");
    const databasePath = path.join(
      await createTestDirectory("cli-memory-db"),
      "agent-hub.sqlite"
    );
    const agentHubHome = await createTestDirectory("cli-memory-home");
    const output: string[] = [];
    const errors: string[] = [];
    const io = {
      stdout: { write: (chunk: string) => { output.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
    };

    await expect(
      main([
        "--db",
        databasePath,
        "project",
        "add",
        "--name",
        "memory-project",
        "--root",
        projectRoot
      ], io, projectRoot)
    ).resolves.toBe(0);
    const projectId = extractLineValue(output.join(""), "id");

    await expect(
      main([
        "--db",
        databasePath,
        "memory",
        "propose",
        "--project-id",
        projectId,
        "--category",
        "workflow_rule",
        "--content",
        "Use isolated worktrees for review."
      ], io, projectRoot)
    ).resolves.toBe(0);
    const approvedMemoryId = extractLastId(output.join(""), "memory");

    await expect(
      main([
        "--db",
        databasePath,
        "memory",
        "propose",
        "--project-id",
        projectId,
        "--category",
        "temporary_note",
        "--content",
        "Rejected memory should stay out."
      ], io, projectRoot)
    ).resolves.toBe(0);
    const rejectedMemoryId = extractLastId(output.join(""), "memory");

    await expect(
      main([
        "--db",
        databasePath,
        "memory",
        "approve",
        "--memory-id",
        approvedMemoryId,
        "--agent-hub-home",
        agentHubHome
      ], io, projectRoot)
    ).resolves.toBe(0);
    await expect(
      main([
        "--db",
        databasePath,
        "memory",
        "reject",
        "--memory-id",
        rejectedMemoryId
      ], io, projectRoot)
    ).resolves.toBe(0);
    await expect(
      main([
        "--db",
        databasePath,
        "memory",
        "list",
        "--project-id",
        projectId
      ], io, projectRoot)
    ).resolves.toBe(0);
    await expect(
      main([
        "context",
        "build",
        "--project-root",
        projectRoot,
        "--project-id",
        projectId,
        "--task-id",
        "task_memory",
        "--title",
        "Use memory",
        "--prompt",
        "Build context with approved memory",
        "--agent-hub-home",
        agentHubHome
      ], io, projectRoot)
    ).resolves.toBe(0);

    const approvedPath = path.join(
      agentHubHome,
      "context-stores",
      projectId,
      "memory",
      "approved.md"
    );
    const approvedMemory = await fs.readFile(approvedPath, "utf8");
    const contextPackPath = extractLineValue(output.join(""), "context_pack_path");
    const contextPack = JSON.parse(await fs.readFile(contextPackPath, "utf8")) as {
      approvedMemorySections: string[];
    };

    expect(errors.join("")).toBe("");
    expect(output.join("")).toContain(`${approvedMemoryId}\tapproved\tworkflow_rule`);
    expect(output.join("")).toContain(`${rejectedMemoryId}\trejected\ttemporary_note`);
    expect(approvedMemory).toContain("Use isolated worktrees for review.");
    expect(approvedMemory).not.toContain("Rejected memory should stay out.");
    expect(contextPack.approvedMemorySections.join("\n")).toContain(
      "Use isolated worktrees for review."
    );
    expect(contextPack.approvedMemorySections.join("\n")).not.toContain(
      "Rejected memory should stay out."
    );
  });

  it("creates and persists comparison reports from SQLite run records", async () => {
    const projectRoot = await createTestDirectory("cli-compare-project");
    const databasePath = path.join(
      await createTestDirectory("cli-compare-db"),
      "agent-hub.sqlite"
    );
    const repositories = createSqliteRepositories({ databasePath });
    await repositories.projectRepository.create({
      id: "project_compare",
      name: "Compare Project",
      rootPath: projectRoot,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    await repositories.taskRepository.create({
      id: "task_compare",
      projectId: "project_compare",
      title: "Compare runs",
      status: "open",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    await repositories.taskRunRepository.create({
      id: "run_baseline",
      taskId: "task_compare",
      agentKind: "fake",
      status: "succeeded",
      createdAt: "2026-01-01T00:00:01.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z"
    });
    await repositories.taskRunRepository.create({
      id: "run_candidate",
      taskId: "task_compare",
      agentKind: "codex",
      status: "failed",
      createdAt: "2026-01-01T00:00:02.000Z",
      updatedAt: "2026-01-01T00:00:02.000Z"
    });
    await repositories.runArtifactRepository.create({
      id: "artifact_baseline_diff",
      taskRunId: "run_baseline",
      kind: "git_diff",
      content: "diff --git a/a.ts b/a.ts\n",
      metadata: {
        changedFiles: [{ path: "src/a.ts", status: "modified" }],
        stat: { filesChanged: 1, insertions: 3, deletions: 1 }
      },
      createdAt: "2026-01-01T00:00:03.000Z"
    });
    await repositories.runArtifactRepository.create({
      id: "artifact_candidate_diff",
      taskRunId: "run_candidate",
      kind: "git_diff",
      content: "diff --git a/b.ts b/b.ts\n",
      metadata: {
        changedFiles: [
          { path: "src/a.ts", status: "modified" },
          { path: "src/b.ts", status: "added" }
        ],
        stat: { filesChanged: 2, insertions: 12, deletions: 0 }
      },
      createdAt: "2026-01-01T00:00:04.000Z"
    });
    await repositories.verificationResultRepository.create({
      id: "verification_baseline",
      taskRunId: "run_baseline",
      command: "pnpm test",
      status: "passed",
      exitCode: 0,
      createdAt: "2026-01-01T00:00:05.000Z"
    });
    await repositories.verificationResultRepository.create({
      id: "verification_candidate",
      taskRunId: "run_candidate",
      command: "pnpm lint",
      status: "failed",
      exitCode: 1,
      createdAt: "2026-01-01T00:00:06.000Z"
    });
    await repositories.riskReportRepository.create(
      riskReportForRun("risk_baseline", "run_baseline", "low")
    );
    await repositories.riskReportRepository.create(
      riskReportForRun("risk_candidate", "run_candidate", "blocking", [
        "Sensitive file path changed. .env"
      ])
    );

    const output: string[] = [];
    const errors: string[] = [];
    const io = {
      stdout: { write: (chunk: string) => { output.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
    };

    await expect(
      main([
        "--db",
        databasePath,
        "compare",
        "--task-id",
        "task_compare",
        "--baseline",
        "run_baseline",
        "--candidate",
        "run_candidate"
      ], io, projectRoot)
    ).resolves.toBe(0);

    const second = createSqliteRepositories({ databasePath });
    await expect(
      second.comparisonReportRepository.listByTaskId("task_compare")
    ).resolves.toEqual([
      expect.objectContaining({
        taskId: "task_compare",
        baselineRunId: "run_baseline",
        candidateRunId: "run_candidate",
        summary: expect.stringContaining("candidate_failed_checks: pnpm lint")
      })
    ]);
    expect(errors.join("")).toBe("");
    expect(output.join("")).toContain("Created comparison report");
    expect(output.join("")).toContain("candidate_only_files: src/b.ts");
    expect(output.join("")).toContain("verification=0 passed, 1 failed, 0 skipped");
    expect(output.join("")).toContain("risk=blocking");
    expect(output.join("")).toContain(
      "candidate_risk_factors: Sensitive file path changed. .env"
    );
  });

  it("rejects unknown agent clearly", async () => {
    const projectRoot = await createTestDirectory("cli-project");
    const output: string[] = [];
    const errors: string[] = [];
    const io = {
      stdout: { write: (chunk: string) => { output.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
    };

    await expect(
      main(["run", "@unknown", "do something"], io, projectRoot)
    ).resolves.toBe(1);

    expect(output.join("")).toBe("");
    expect(errors.join("")).toContain("unknown agent unknown");
  });
});

function extractLineValue(output: string, label: string): string {
  const match = output.match(new RegExp(`^${label}: (.+)$`, "m"));
  expect(match?.[1]).toBeTruthy();
  return match?.[1] ?? "";
}

function extractLastId(output: string, prefix: string): string {
  const matches = [...output.matchAll(new RegExp(`id: (${prefix}_[^\\n]+)`, "g"))];
  expect(matches.at(-1)?.[1]).toBeTruthy();
  return matches.at(-1)?.[1] ?? "";
}

function riskReportForRun(
  id: string,
  taskRunId: string,
  level: RiskReport["level"],
  riskFactors: string[] = []
): RiskReport {
  return {
    id,
    taskRunId,
    level,
    summary: `Risk is ${level}.`,
    changedFiles: [],
    verificationSummary: "not available",
    failedChecks: [],
    riskFactors,
    manualReviewChecklist: ["Review changed files."],
    acceptanceRecommendation: "Review before accepting.",
    findings: [],
    createdAt: "2026-01-01T00:00:07.000Z"
  };
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
