import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DiffCollectionResult } from "../src/diff-collector";
import type { RiskReport } from "../src/domain";
import { createSqliteRepositories } from "../src/sqlite-storage";
import type { VerificationSuiteResult } from "../src/verification";
import type { Workspace, WorkspaceCleanupResult } from "../src/workspace";
import { createTestDirectory } from "./helpers";

const createdAt = "2026-01-01T00:00:00.000Z";
const updatedAt = "2026-01-01T00:00:01.000Z";

describe("SQLite storage", () => {
  it("initializes migrations in a temporary database", async () => {
    const databasePath = path.join(
      await createTestDirectory("sqlite-migrations"),
      "agent-hub.sqlite"
    );
    const { database } = createSqliteRepositories({ databasePath });

    await database.ensureInitialized();

    await expect(
      database.query<{ version: number }>(
        "SELECT version FROM schema_migrations ORDER BY version ASC;"
      )
    ).resolves.toEqual([{ version: 1 }, { version: 2 }]);
    await expect(
      database.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name ASC;"
      )
    ).resolves.toEqual(
      expect.arrayContaining([
        { name: "projects" },
        { name: "agent_profiles" },
        { name: "tasks" },
        { name: "task_runs" },
        { name: "run_events" },
        { name: "run_artifacts" },
        { name: "verification_results" },
        { name: "risk_reports" },
        { name: "memory_items" },
        { name: "comparison_reports" },
        { name: "skills" },
        { name: "settings" }
      ])
    );
  });

  it("persists tasks, runs, status transitions, and run metadata across instances", async () => {
    const baseDirectory = await createTestDirectory("sqlite-storage");
    const databasePath = path.join(baseDirectory, "agent-hub.sqlite");
    const first = createSqliteRepositories({ databasePath });

    await first.projectRepository.create({
      id: "project_1",
      name: "Project One",
      rootPath: path.join(baseDirectory, "source"),
      createdAt,
      updatedAt: createdAt
    });
    await expect(
      first.projectRepository.create({
        id: "project_duplicate",
        name: "Duplicate",
        rootPath: path.join(baseDirectory, "source"),
        createdAt,
        updatedAt: createdAt
      })
    ).rejects.toThrow();
    await first.agentProfileRepository.create({
      id: "agent_profile_1",
      kind: "fake",
      displayName: "Fake",
      enabled: true,
      createdAt,
      updatedAt: createdAt
    });
    await first.taskRepository.create({
      id: "task_1",
      projectId: "project_1",
      title: "Persist metadata",
      description: "Persist workspace, cleanup, diff, verification, and risk.",
      status: "open",
      createdAt,
      updatedAt: createdAt
    });
    await first.taskRunRepository.create({
      id: "run_1",
      taskId: "task_1",
      agentKind: "fake",
      status: "queued",
      createdAt,
      updatedAt: createdAt
    });
    await first.taskRunRepository.updateExecutionPaths(
      "run_1",
      {
        worktreePath: path.join(baseDirectory, "worktree"),
        branchName: "agent-hub/task_1/fake"
      },
      updatedAt
    );
    await first.taskRunRepository.updateStatus("run_1", "running", updatedAt);
    await first.runMetadataRepository.save({
      runId: "run_1",
      workspace: workspace(baseDirectory),
      workspaceCleanup: workspaceCleanup(),
      diff: diff(baseDirectory),
      verification: verification(),
      riskReport: riskReport()
    });
    await first.runEventRepository.createMany([
      {
        id: "event_1",
        taskRunId: "run_1",
        sequence: 0,
        type: "stdout",
        message: "hello",
        metadata: { stream: "stdout" },
        createdAt
      },
      {
        id: "event_2",
        taskRunId: "run_1",
        sequence: 1,
        type: "exit",
        message: "done",
        metadata: { exitCode: 0 },
        createdAt
      }
    ]);
    await first.runArtifactRepository.create({
      id: "artifact_1",
      taskRunId: "run_1",
      kind: "git_diff",
      content: "diff text",
      metadata: { changedFiles: [{ path: "fake-agent-output.md", status: "untracked" }] },
      createdAt
    });
    await first.verificationResultRepository.create({
      id: "verification_1",
      taskRunId: "run_1",
      command: "pnpm test",
      status: "passed",
      exitCode: 0,
      stdout: "ok\n",
      stderr: "",
      createdAt
    });
    await first.riskReportRepository.create(riskReport());
    await first.memoryItemRepository.create({
      id: "memory_1",
      projectId: "project_1",
      taskId: "task_1",
      category: "project_fact",
      status: "proposed",
      content: "Use fake agent in tests.",
      createdAt,
      updatedAt: createdAt
    });
    await first.comparisonReportRepository.create({
      id: "comparison_1",
      taskId: "task_1",
      baselineRunId: "run_1",
      candidateRunId: "run_1",
      summary: "Same run comparison.",
      createdAt
    });
    await first.skillRepository.create({
      id: "skill_1",
      projectId: "project_1",
      name: "fake-skill",
      description: "A fake test skill.",
      path: path.join(baseDirectory, "skill.md"),
      createdAt,
      updatedAt: createdAt
    });
    await first.settingsRepository.set({
      key: "ui.theme",
      value: { theme: "system" },
      updatedAt
    });
    await first.taskRunRepository.updateStatus(
      "run_1",
      "succeeded",
      "2026-01-01T00:00:02.000Z"
    );
    await first.taskRepository.updateStatus(
      "task_1",
      "completed",
      "2026-01-01T00:00:02.000Z"
    );

    const second = createSqliteRepositories({ databasePath });

    await expect(second.projectRepository.list()).resolves.toEqual([
      expect.objectContaining({ id: "project_1", name: "Project One" })
    ]);
    await expect(second.taskRepository.list()).resolves.toEqual([
      expect.objectContaining({ id: "task_1", status: "completed" })
    ]);
    await expect(second.taskRunRepository.get("run_1")).resolves.toEqual(
      expect.objectContaining({
        id: "run_1",
        status: "succeeded",
        branchName: "agent-hub/task_1/fake"
      })
    );
    await expect(second.taskRunRepository.getStatusTransitions("run_1")).resolves.toEqual([
      { runId: "run_1", status: "queued", at: createdAt },
      { runId: "run_1", status: "running", at: updatedAt },
      {
        runId: "run_1",
        status: "succeeded",
        at: "2026-01-01T00:00:02.000Z"
      }
    ]);
    await expect(second.runMetadataRepository.get("run_1")).resolves.toEqual(
      expect.objectContaining({
        workspace: expect.objectContaining({ runId: "run_1" }),
        workspaceCleanup: expect.objectContaining({ cleaned: true }),
        diff: expect.objectContaining({
          changedFiles: [{ path: "fake-agent-output.md", status: "untracked" }]
        }),
        verification: expect.objectContaining({ summary: "1 passed, 0 failed, 0 skipped" }),
        riskReport: expect.objectContaining({ level: "low" })
      })
    );
    await expect(second.runEventRepository.listByRunId("run_1")).resolves.toEqual([
      expect.objectContaining({ id: "event_1", sequence: 0, metadata: { stream: "stdout" } }),
      expect.objectContaining({ id: "event_2", sequence: 1, metadata: { exitCode: 0 } })
    ]);
    await expect(
      second.runArtifactRepository.getLatestByRunIdAndKind("run_1", "git_diff")
    ).resolves.toEqual(
      expect.objectContaining({
        content: "diff text",
        metadata: { changedFiles: [{ path: "fake-agent-output.md", status: "untracked" }] }
      })
    );
    await expect(second.verificationResultRepository.listByRunId("run_1")).resolves.toEqual([
      expect.objectContaining({ command: "pnpm test", status: "passed" })
    ]);
    await expect(second.riskReportRepository.getLatestByRunId("run_1")).resolves.toEqual(
      expect.objectContaining({ level: "low", changedFiles: ["fake-agent-output.md"] })
    );
    await expect(second.memoryItemRepository.listByProjectId("project_1")).resolves.toEqual([
      expect.objectContaining({ id: "memory_1", status: "proposed" })
    ]);
    await expect(second.comparisonReportRepository.listByTaskId("task_1")).resolves.toEqual([
      expect.objectContaining({ id: "comparison_1", summary: "Same run comparison." })
    ]);
    await expect(second.skillRepository.list("project_1")).resolves.toEqual([
      expect.objectContaining({ id: "skill_1", name: "fake-skill" })
    ]);
    await expect(second.settingsRepository.get("ui.theme")).resolves.toEqual(
      expect.objectContaining({ key: "ui.theme", value: { theme: "system" } })
    );
  });
});

function workspace(baseDirectory: string): Workspace {
  return {
    path: path.join(baseDirectory, "worktree"),
    branchName: "agent-hub/task_1/fake",
    sourceRepositoryPath: path.join(baseDirectory, "source"),
    workspaceBasePath: path.join(baseDirectory, "worktrees"),
    taskId: "task_1",
    runId: "run_1",
    agentKind: "fake",
    dryRun: false,
    sourceRepositoryDirty: false,
    cleanupPolicy: "never"
  };
}

function workspaceCleanup(): WorkspaceCleanupResult {
  return {
    cleaned: true,
    retained: false,
    reason: "workspace cleaned up",
    commands: []
  };
}

function diff(baseDirectory: string): DiffCollectionResult {
  return {
    ok: true,
    workspacePath: path.join(baseDirectory, "worktree"),
    isClean: false,
    changedFiles: [{ path: "fake-agent-output.md", status: "untracked" }],
    stat: {
      filesChanged: 1,
      insertions: 2,
      deletions: 0,
      text: "1 file changed, 2 insertions(+)"
    },
    diff: "diff --git a/fake-agent-output.md b/fake-agent-output.md\n",
    fileSummaries: ["fake-agent-output.md: untracked"],
    commands: []
  };
}

function verification(): VerificationSuiteResult {
  return {
    status: "passed",
    results: [
      {
        commandId: "test",
        label: "test",
        command: { executable: "pnpm", args: ["test"], displayName: "test" },
        status: "passed",
        stdout: "ok\n",
        stderr: "",
        exitCode: 0,
        durationMs: 10,
        timedOut: false,
        dryRun: false
      }
    ],
    failedCommands: [],
    missingCommandConfig: false,
    summary: "1 passed, 0 failed, 0 skipped",
    durationMs: 10
  };
}

function riskReport(): RiskReport {
  return {
    id: "risk_1",
    taskRunId: "run_1",
    level: "low",
    summary: "Risk is low.",
    changedFiles: ["fake-agent-output.md"],
    verificationSummary: "1 passed, 0 failed, 0 skipped",
    failedChecks: [],
    riskFactors: [],
    manualReviewChecklist: ["Review changed files."],
    acceptanceRecommendation: "Accept if the changed files match the task intent.",
    findings: [],
    createdAt
  };
}
