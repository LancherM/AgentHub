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
    ).resolves.toEqual([{ version: 1 }]);
  });

  it("persists tasks, runs, status transitions, and run metadata across instances", async () => {
    const baseDirectory = await createTestDirectory("sqlite-storage");
    const databasePath = path.join(baseDirectory, "agent-hub.sqlite");
    const first = createSqliteRepositories({ databasePath });

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
    sourceRepositoryDirty: false
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
