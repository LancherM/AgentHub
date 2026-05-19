import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createCliRuntime, main } from "@agent-hub/cli";
import type { DiffCollectionResult, DiffCollectorService } from "@agent-hub/task-runner";
import type { RiskReport } from "@agent-hub/core";
import { createSqliteRepositories } from "@agent-hub/db";
import { RiskReportGenerator, type RiskReportInput } from "@agent-hub/safety";
import { SequenceIdGenerator, FixedClock } from "@agent-hub/task-runner";
import { VerificationRunner } from "@agent-hub/task-runner";
import type {
  WorkspaceConfig,
  WorkspaceManager,
  WorkspaceSession
} from "@agent-hub/task-runner";
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
    expect(output.join("")).toContain("# Fake Agent Output");
    expect(output.join("")).not.toContain("Task run completed");
    expect(output.join("")).not.toContain("context_delivery: runtime_injection");
    expect(output.join("")).toContain("branch:");
    expect(output.join("")).not.toContain("branch_name:");
    expect(output.join("")).not.toContain("fake_output:");
    expect(output.join("")).toContain("changed_files: 1");
    expect(output.join("")).toContain("risk: medium");
    expect(output.join("")).toContain("task_0001\tcompleted\tadhoc_project\tcompile context");
    expect(output.join("")).toContain("run_0002\tsucceeded\tfake\ttask_0001");
    expect(output.join("")).toContain("acceptance:");
  });

  it("rejects repo_export delivery mode for task runs", async () => {
    const projectRoot = await createTestDirectory("cli-project");
    const runtime = createCliRuntime({ storageMode: "memory" });
    const output: string[] = [];
    const errors: string[] = [];
    const io = {
      stdout: { write: (chunk: string) => { output.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
    };

    await expect(
      main([
        "run",
        "--delivery-mode",
        "repo_export",
        "@fake",
        "compile context"
      ], io, projectRoot, runtime)
    ).resolves.toBe(1);

    expect(output.join("")).toBe("");
    expect(errors.join("")).toContain(
      "--delivery-mode must be runtime_injection or worktree_overlay for task runs"
    );
    await expect(runtime.taskRepository.list()).resolves.toEqual([]);
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
          { type: "stdout", data: "{\"type\":\"thread.started\"}\n" },
          { type: "stdout", data: "{\"type\":\"turn.started\"}\n" },
          {
            type: "stdout",
            data: "{\"type\":\"item.completed\",\"item\":{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"codex ok\"}]}}\n"
          },
          { type: "stdout", data: "{\"type\":\"turn.completed\"}\n" },
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
    expect(output.join("")).toContain("codex ok");
    expect(output.join("")).toContain("claude ok");
    expect(output.join("")).not.toContain("Codex thread.started");
    expect(output.join("")).not.toContain("Codex turn.started");
    expect(output.join("")).not.toContain("Codex item.completed");
    expect(output.join("")).not.toContain("Codex turn.completed");
    expect(output.join("")).not.toContain("agent: codex");
    expect(output.join("")).not.toContain("agent: claude-code");
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

  it("reviews persisted run events and diff artifacts across SQLite runtimes", async () => {
    const projectRoot = await createTestDirectory("cli-review-project");
    const databasePath = path.join(
      await createTestDirectory("cli-review-db"),
      "agent-hub.sqlite"
    );
    const repositories = createSqliteRepositories({ databasePath });
    const longPatch = `diff --git a/src/a.ts b/src/a.ts\n${"x".repeat(12_020)}`;
    await repositories.projectRepository.create({
      id: "project_review",
      name: "Review Project",
      rootPath: projectRoot,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    await repositories.taskRepository.create({
      id: "task_review",
      projectId: "project_review",
      title: "Review persisted evidence",
      status: "open",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    await repositories.taskRunRepository.create({
      id: "run_review",
      taskId: "task_review",
      agentKind: "fake",
      status: "succeeded",
      createdAt: "2026-01-01T00:00:01.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z"
    });
    await repositories.runEventRepository.createMany([
      {
        id: "event_review_1",
        taskRunId: "run_review",
        sequence: 1,
        type: "exit",
        message: "done",
        metadata: { exitCode: 0 },
        createdAt: "2026-01-01T00:00:03.000Z"
      },
      {
        id: "event_review_0",
        taskRunId: "run_review",
        sequence: 0,
        type: "message",
        message: "agent output\nsecond line",
        metadata: {},
        createdAt: "2026-01-01T00:00:02.000Z"
      }
    ]);
    await repositories.runArtifactRepository.create({
      id: "artifact_review_diff",
      taskRunId: "run_review",
      kind: "git_diff",
      content: longPatch,
      metadata: {
        changedFiles: [{ path: "src/a.ts", status: "modified" }],
        stat: {
          filesChanged: 1,
          insertions: 2,
          deletions: 1,
          text: "1 file changed, 2 insertions(+), 1 deletion(-)"
        },
        fileSummaries: ["src/a.ts: modified"]
      },
      createdAt: "2026-01-01T00:00:04.000Z"
    });
    await repositories.taskRunRepository.create({
      id: "run_sensitive_review",
      taskId: "task_review",
      agentKind: "codex",
      status: "succeeded",
      createdAt: "2026-01-01T00:00:05.000Z",
      updatedAt: "2026-01-01T00:00:05.000Z"
    });
    await repositories.runArtifactRepository.create({
      id: "artifact_sensitive_review_diff",
      taskRunId: "run_sensitive_review",
      kind: "git_diff",
      content: [
        "diff --git a/.env.local b/.env.local",
        "--- a/.env.local",
        "+++ b/.env.local",
        "+API_TOKEN=secret-value",
        ""
      ].join("\n"),
      metadata: {
        changedFiles: [{ path: ".env.local", status: "modified" }],
        stat: {
          filesChanged: 1,
          insertions: 1,
          deletions: 0,
          text: "1 file changed, 1 insertion(+)"
        },
        fileSummaries: [".env.local: modified"]
      },
      createdAt: "2026-01-01T00:00:06.000Z"
    });

    const eventOutput: string[] = [];
    const statOutput: string[] = [];
    const patchOutput: string[] = [];
    const sensitivePatchOutput: string[] = [];
    const errors: string[] = [];
    const eventIo = {
      stdout: { write: (chunk: string) => { eventOutput.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
    };
    const statIo = {
      stdout: { write: (chunk: string) => { statOutput.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
    };
    const patchIo = {
      stdout: { write: (chunk: string) => { patchOutput.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
    };
    const sensitivePatchIo = {
      stdout: { write: (chunk: string) => { sensitivePatchOutput.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
    };

    await expect(
      main(["--db", databasePath, "runs", "events", "run_review"], eventIo, projectRoot)
    ).resolves.toBe(0);
    await expect(
      main(["--db", databasePath, "runs", "diff", "run_review", "--stat"], statIo, projectRoot)
    ).resolves.toBe(0);
    await expect(
      main(["--db", databasePath, "runs", "diff", "run_review", "--patch"], patchIo, projectRoot)
    ).resolves.toBe(0);
    await expect(
      main([
        "--db",
        databasePath,
        "runs",
        "diff",
        "run_sensitive_review",
        "--patch",
        "--full"
      ], sensitivePatchIo, projectRoot)
    ).resolves.toBe(0);

    const events = eventOutput.join("");
    expect(errors.join("")).toBe("");
    expect(events).toContain("run_id: run_review");
    expect(events).toContain("events: 2");
    expect(events.indexOf("0\t2026-01-01T00:00:02.000Z\tmessage")).toBeLessThan(
      events.indexOf("1\t2026-01-01T00:00:03.000Z\texit")
    );
    expect(events).toContain("agent output\\nsecond line");
    expect(statOutput.join("")).toContain("files_changed: 1");
    expect(statOutput.join("")).toContain("insertions: 2");
    expect(statOutput.join("")).toContain("- src/a.ts");
    expect(statOutput.join("")).toContain("- src/a.ts: modified");
    expect(patchOutput.join("")).toContain("patch_bytes: ");
    expect(patchOutput.join("")).toContain("truncated: true");
    expect(patchOutput.join("")).toContain("diff --git a/src/a.ts b/src/a.ts");
    expect(patchOutput.join("")).toContain("rerun with --full");
    expect(sensitivePatchOutput.join("")).toContain("patch_bytes: ");
    expect(sensitivePatchOutput.join("")).toContain("truncated: false");
    expect(sensitivePatchOutput.join("")).toContain(
      "Patch redacted because sensitive file path changed: .env.local"
    );
    expect(sensitivePatchOutput.join("")).not.toContain("API_TOKEN=secret-value");
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

  it("keeps ad-hoc SQLite projects scoped to their repository roots", async () => {
    const firstProjectRoot = await createTestDirectory("cli-adhoc-project-a");
    const secondProjectRoot = await createTestDirectory("cli-adhoc-project-b");
    const runRoot = path.join(await createTestDirectory("cli-adhoc-runs"), "runs");
    const databasePath = path.join(
      await createTestDirectory("cli-adhoc-db"),
      "agent-hub.sqlite"
    );
    const runtime = createCliRuntime({
      sqliteDatabasePath: databasePath,
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
      main([
        "run",
        "--repo",
        firstProjectRoot,
        "@fake",
        "first ad-hoc run"
      ], io, firstProjectRoot, runtime)
    ).resolves.toBe(0);
    await expect(
      main([
        "run",
        "--repo",
        secondProjectRoot,
        "@fake",
        "second ad-hoc run"
      ], io, secondProjectRoot, runtime)
    ).resolves.toBe(0);

    const firstProject = await runtime.projectRepository.getByRootPath(firstProjectRoot);
    const secondProject = await runtime.projectRepository.getByRootPath(secondProjectRoot);
    const tasks = await runtime.taskRepository.list();

    expect(errors.join("")).toBe("");
    expect(firstProject).toEqual(
      expect.objectContaining({
        id: "adhoc_project",
        rootPath: firstProjectRoot
      })
    );
    expect(secondProject).toEqual(
      expect.objectContaining({
        rootPath: secondProjectRoot
      })
    );
    expect(secondProject?.id).not.toBe("adhoc_project");
    expect(tasks.map((task) => task.projectId)).toEqual([
      firstProject?.id,
      secondProject?.id
    ]);
  });

  it("records manual run events with the next sequence number", async () => {
    const projectRoot = await createTestDirectory("cli-run-event-project");
    const databasePath = path.join(
      await createTestDirectory("cli-run-event-db"),
      "agent-hub.sqlite"
    );
    const runtime = createCliRuntime({ sqliteDatabasePath: databasePath });
    await seedManualRun(runtime, projectRoot, "run_manual");
    await runtime.runEventRepository.createMany([
      {
        id: "event_existing_1",
        taskRunId: "run_manual",
        sequence: 0,
        type: "stdout",
        message: "first",
        metadata: {},
        createdAt: "2026-01-01T00:00:02.000Z"
      },
      {
        id: "event_existing_2",
        taskRunId: "run_manual",
        sequence: 1,
        type: "exit",
        message: "done",
        metadata: { exitCode: 0 },
        createdAt: "2026-01-01T00:00:03.000Z"
      }
    ]);
    const output: string[] = [];
    const errors: string[] = [];
    const io = {
      stdout: { write: (chunk: string) => { output.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
    };

    await expect(
      main([
        "run",
        "event",
        "add",
        "--run-id",
        "run_manual",
        "--type",
        "status",
        "--message",
        "manual review started"
      ], io, projectRoot, runtime)
    ).resolves.toBe(0);

    const events = await runtime.runEventRepository.listByRunId("run_manual");
    expect(errors.join("")).toBe("");
    expect(output.join("")).toContain("Recorded run event");
    expect(output.join("")).toContain("run_id: run_manual");
    expect(output.join("")).toContain("sequence: 2");
    expect(output.join("")).toContain("type: status");
    expect(events.map((event) => event.sequence)).toEqual([0, 1, 2]);
    expect(events[2]).toEqual(
      expect.objectContaining({
        type: "status",
        message: "manual review started",
        metadata: { source: "manual_cli" }
      })
    );
  });

  it("rejects manual run events for missing runs", async () => {
    const projectRoot = await createTestDirectory("cli-run-event-missing-project");
    const runtime = createCliRuntime({ storageMode: "memory" });
    const output: string[] = [];
    const errors: string[] = [];
    const io = {
      stdout: { write: (chunk: string) => { output.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
    };

    await expect(
      main([
        "run",
        "event",
        "add",
        "--run-id",
        "run_missing",
        "--type",
        "stdout",
        "--message",
        "missing run"
      ], io, projectRoot, runtime)
    ).resolves.toBe(1);

    expect(output.join("")).toBe("");
    expect(errors.join("")).toContain("error: run run_missing not found");
  });

  it("rejects invalid manual run event types", async () => {
    const projectRoot = await createTestDirectory("cli-run-event-invalid-project");
    const runtime = createCliRuntime({ storageMode: "memory" });
    await seedManualRun(runtime, projectRoot, "run_manual_invalid");
    const output: string[] = [];
    const errors: string[] = [];
    const io = {
      stdout: { write: (chunk: string) => { output.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
    };

    await expect(
      main([
        "run",
        "event",
        "add",
        "--run-id",
        "run_manual_invalid",
        "--type",
        "tool",
        "--message",
        "invalid type"
      ], io, projectRoot, runtime)
    ).resolves.toBe(1);

    expect(output.join("")).toBe("");
    expect(errors.join("")).toContain(
      "error: --type must be one of stdout, stderr, message, status, error, exit"
    );
  });

  it("persists manual run events across SQLite runtime instances", async () => {
    const projectRoot = await createTestDirectory("cli-run-event-persist-project");
    const databasePath = path.join(
      await createTestDirectory("cli-run-event-persist-db"),
      "agent-hub.sqlite"
    );
    const firstRuntime = createCliRuntime({ sqliteDatabasePath: databasePath });
    await seedManualRun(firstRuntime, projectRoot, "run_manual_persist");
    const output: string[] = [];
    const errors: string[] = [];
    const io = {
      stdout: { write: (chunk: string) => { output.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
    };

    await expect(
      main([
        "run",
        "event",
        "add",
        "--run-id",
        "run_manual_persist",
        "--type",
        "stderr",
        "--message",
        "manual stderr event"
      ], io, projectRoot, firstRuntime)
    ).resolves.toBe(0);

    const secondRuntime = createCliRuntime({ sqliteDatabasePath: databasePath });
    await expect(
      secondRuntime.runEventRepository.listByRunId("run_manual_persist")
    ).resolves.toEqual([
      expect.objectContaining({
        taskRunId: "run_manual_persist",
        sequence: 0,
        type: "stderr",
        message: "manual stderr event",
        metadata: { source: "manual_cli" }
      })
    ]);
    expect(errors.join("")).toBe("");
    expect(output.join("")).toContain("Recorded run event");
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
        "--target",
        "repo",
        "--include-approved-memory",
        "--dry-run"
      ], io, projectRoot)
    ).resolves.toBe(0);

    expect(errors.join("")).toBe("");
    expect(output.join("")).toContain("Initialized context store");
    expect(output.join("")).toContain("  - context/project.md");
    expect(output.join("")).toContain("Built context artifacts");
    expect(output.join("")).toContain("Previewed repo context export");
    expect(output.join("")).toContain("target: repo");
    expect(output.join("")).toContain("approved_memory: included_when_present");
    expect(output.join("")).toContain(
      "--include-approved-memory is already the default for repo context export"
    );
    await expect(fs.access(path.join(projectRoot, "AGENTS.md"))).rejects.toThrow();
  });

  it("rejects unsupported context export targets", async () => {
    const projectRoot = await createTestDirectory("cli-context-export-target-project");
    const agentHubHome = await createTestDirectory("cli-context-export-target-home");
    const output: string[] = [];
    const errors: string[] = [];
    const io = {
      stdout: { write: (chunk: string) => { output.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
    };

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
        "--target",
        "workspace",
        "--dry-run"
      ], io, projectRoot)
    ).resolves.toBe(1);

    expect(output.join("")).toBe("");
    expect(errors.join("")).toContain("--target must be repo");
  });

  it("rejects context export target without a value", async () => {
    const projectRoot = await createTestDirectory("cli-context-export-missing-target-project");
    const output: string[] = [];
    const errors: string[] = [];
    const io = {
      stdout: { write: (chunk: string) => { output.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
    };

    await expect(
      main([
        "context",
        "export",
        "--project-root",
        projectRoot,
        "--project-id",
        "project_1",
        "--target",
        "--dry-run"
      ], io, projectRoot)
    ).resolves.toBe(1);

    expect(output.join("")).toBe("");
    expect(errors.join("")).toContain("--target requires a value");
  });

  it("rejects repeated context export targets", async () => {
    const projectRoot = await createTestDirectory("cli-context-export-repeated-target-project");
    const output: string[] = [];
    const errors: string[] = [];
    const io = {
      stdout: { write: (chunk: string) => { output.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
    };

    await expect(
      main([
        "context",
        "export",
        "--project-root",
        projectRoot,
        "--project-id",
        "project_1",
        "--target",
        "repo",
        "--target",
        "workspace",
        "--dry-run"
      ], io, projectRoot)
    ).resolves.toBe(1);

    expect(output.join("")).toBe("");
    expect(errors.join("")).toContain("--target may only be provided once");
  });

  it("rejects repo_export delivery mode for context builds", async () => {
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
        agentHubHome,
        "--delivery-mode",
        "repo_export"
      ], io, projectRoot)
    ).resolves.toBe(1);

    expect(output.join("")).toBe("");
    expect(errors.join("")).toContain(
      "--delivery-mode must be runtime_injection or worktree_overlay for context build"
    );
  });

  it("enters interactive mode for bare CLI and routes prompts through the runner", async () => {
    const projectRoot = await createTestDirectory("cli-interactive-project");
    const runRoot = path.join(await createTestDirectory("cli-interactive-runs"), "runs");
    const agentHubHome = await createTestDirectory("cli-interactive-home");
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
      stdin: Readable.from([
        "/help\n",
        "/agents\n",
        "/use codex\n",
        "/use fake\n",
        "/context\n",
        "/context init\n",
        "summarize the project\n",
        "@fake simulate the task\n",
        "/clear\n",
        "/quit\n"
      ]),
      stdout: { write: (chunk: string) => { output.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
    };
    const previousHome = process.env.AGENT_HUB_HOME;
    process.env.AGENT_HUB_HOME = agentHubHome;
    try {
      await expect(main([], io, projectRoot, runtime)).resolves.toBe(0);
    } finally {
      restoreEnv("AGENT_HUB_HOME", previousHome);
    }

    expect(errors.join("")).toBe("");
    expect(output.join("")).toContain("Agent Hub interactive");
    expect(output.join("")).toContain("Interactive commands:");
    expect(output.join("")).toContain("agents:");
    expect(output.join("")).toContain("using agent: codex");
    expect(output.join("")).toContain("using agent: fake");
    expect(output.join("")).toContain("Context store");
    expect(output.join("")).toContain("Initialized context store");
    expect(output.join("")).not.toContain("run: summarize the project");
    expect(output.join("")).not.toContain("run: @fake simulate the task");
    expect(output.join("")).toContain("# Fake Agent Output");
    expect(output.join("")).toContain("\x1b[2J\x1b[H");
    expect(output.join("")).toContain("Exiting Agent Hub.");
  });

  it("renders opt-in debug output without changing run results", async () => {
    const projectRoot = await createTestDirectory("cli-debug-project");
    const runRoot = path.join(await createTestDirectory("cli-debug-runs"), "runs");
    const runtime = createCliRuntime({
      storageMode: "memory",
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector("diff --git a/fake-agent-output.md b/fake-agent-output.md\n" + "x".repeat(2100)),
      verificationRunner: new VerificationRunner(
        new MockShellExecutor([
          { stdout: "ok\n", stderr: "warn\n" },
          { stdout: "ok\n", stderr: "warn\n" },
          { stdout: "ok\n", stderr: "warn\n" }
        ])
      ),
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock("2026-01-01T00:00:00.000Z")
    });
    const normalOutput: string[] = [];
    const debugOutput: string[] = [];
    const envDebugOutput: string[] = [];
    const errors: string[] = [];
    const normalIo = {
      stdout: { write: (chunk: string) => { normalOutput.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
    };
    const debugIo = {
      stdout: { write: (chunk: string) => { debugOutput.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
    };
    const envDebugIo = {
      stdout: { write: (chunk: string) => { envDebugOutput.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
    };

    await expect(
      main([
        "run",
        "@fake",
        "debug task",
        "--verify",
        "pnpm test"
      ], normalIo, projectRoot, runtime)
    ).resolves.toBe(0);
    await expect(
      main([
        "--debug",
        "run",
        "@fake",
        "debug task",
        "--verify",
        "pnpm test"
      ], debugIo, projectRoot, runtime)
    ).resolves.toBe(0);

    const previousDebug = process.env.AGENT_HUB_DEBUG;
    process.env.AGENT_HUB_DEBUG = "1";
    try {
      await expect(
        main([
          "run",
          "@fake",
          "debug task",
          "--verify",
          "pnpm test"
        ], envDebugIo, projectRoot, runtime)
      ).resolves.toBe(0);
    } finally {
      restoreEnv("AGENT_HUB_DEBUG", previousDebug);
    }

    expect(errors.join("")).toBe("");
    expect(normalOutput.join("")).toContain("# Fake Agent Output");
    expect(normalOutput.join("")).not.toContain("status: succeeded");
    expect(debugOutput.join("")).toContain("status: succeeded");
    expect(envDebugOutput.join("")).toContain("status: succeeded");
    expect(normalOutput.join("")).not.toContain("debug:");
    expect(debugOutput.join("")).toContain("debug:");
    expect(debugOutput.join("")).toContain("run_summary:");
    expect(debugOutput.join("")).toContain("run_boundary:");
    expect(debugOutput.join("")).toContain("verification_output:");
    expect(debugOutput.join("")).toContain("stdout:\n    ok");
    expect(debugOutput.join("")).toContain("stderr:\n    warn");
    expect(debugOutput.join("")).toContain("diff_summary:");
    expect(debugOutput.join("")).toContain("truncated");
    expect(envDebugOutput.join("")).toContain("debug:");
  });

  it("keeps missing-verification warnings out of normal output and in debug output", async () => {
    const projectRoot = await createTestDirectory("cli-missing-verification-project");
    const runRoot = path.join(
      await createTestDirectory("cli-missing-verification-runs"),
      "runs"
    );
    const runtime = createCliRuntime({
      storageMode: "memory",
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector(),
      verificationRunner: new VerificationRunner(new MockShellExecutor()),
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock("2026-01-01T00:00:00.000Z")
    });
    const normalOutput: string[] = [];
    const debugOutput: string[] = [];
    const errors: string[] = [];
    const normalIo = {
      stdout: { write: (chunk: string) => { normalOutput.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
    };
    const debugIo = {
      stdout: { write: (chunk: string) => { debugOutput.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
    };

    await expect(
      main(["run", "@fake", "missing verification"], normalIo, projectRoot, runtime)
    ).resolves.toBe(0);
    await expect(
      main(["--debug", "run", "@fake", "missing verification"], debugIo, projectRoot, runtime)
    ).resolves.toBe(0);

    const warning = "No verification commands were configured; verification was skipped.";
    expect(errors.join("")).toBe("");
    expect(normalOutput.join("")).toContain("# Fake Agent Output");
    expect(normalOutput.join("")).not.toContain(warning);
    expect(debugOutput.join("")).toContain(`- warnings: ${warning}`);
  });

  it("redacts debug diff previews when sensitive paths are changed", async () => {
    const projectRoot = await createTestDirectory("cli-debug-sensitive-project");
    const runRoot = path.join(await createTestDirectory("cli-debug-sensitive-runs"), "runs");
    const runtime = createCliRuntime({
      storageMode: "memory",
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector(
        "diff --git a/.env.local b/.env.local\n+API_TOKEN=secret-value\n",
        [{ path: ".env.local", status: "untracked" }],
        [".env.local: untracked"]
      ),
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
      main(["--debug", "run", "@fake", "debug sensitive diff"], io, projectRoot, runtime)
    ).resolves.toBe(0);

    const rendered = output.join("");
    expect(errors.join("")).toBe("");
    expect(rendered).toContain("risk: blocking");
    expect(rendered).toContain("diff_preview:");
    expect(rendered).toContain("redacted: sensitive file path changed");
    expect(rendered).not.toContain("API_TOKEN=secret-value");
  });

  it("redacts debug diff previews when risk report generation fails", async () => {
    const projectRoot = await createTestDirectory("cli-debug-sensitive-risk-failure-project");
    const runRoot = path.join(
      await createTestDirectory("cli-debug-sensitive-risk-failure-runs"),
      "runs"
    );
    const runtime = createCliRuntime({
      storageMode: "memory",
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector(
        "diff --git a/.env.local b/.env.local\n+API_TOKEN=secret-value\n",
        [{ path: ".env.local", status: "untracked" }],
        [".env.local: untracked"]
      ),
      verificationRunner: new VerificationRunner(new MockShellExecutor()),
      riskReportGenerator: new ThrowingRiskReportGenerator(),
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
      main(["--debug", "run", "@fake", "debug sensitive diff"], io, projectRoot, runtime)
    ).resolves.toBe(1);

    const rendered = output.join("");
    expect(errors.join("")).toBe("");
    expect(rendered).toContain("risk: not available");
    expect(rendered).toContain("risk report generation failed: risk backend unavailable");
    expect(rendered).toContain("diff_preview:");
    expect(rendered).toContain("redacted: sensitive file path changed");
    expect(rendered).not.toContain("API_TOKEN=secret-value");
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
    expect(output.join("")).toContain("candidate_diff_stats: 2 files, +12/-0");
    expect(output.join("")).toContain("candidate_only_files: src/b.ts");
    expect(output.join("")).toContain("candidate_verification_outcomes: pnpm lint: failed (1)");
    expect(output.join("")).toContain("verification=0 passed, 1 failed, 0 skipped");
    expect(output.join("")).toContain("risk=blocking");
    expect(output.join("")).toContain(
      "candidate_risk_factors: Sensitive file path changed. .env"
    );
    expect(output.join("")).toContain(
      "summary_tradeoffs: candidate has more failed checks; candidate has higher risk; candidate changes more files"
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

function restoreEnv(key: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = previousValue;
}

async function seedManualRun(
  runtime: ReturnType<typeof createCliRuntime>,
  projectRoot: string,
  runId: string
): Promise<void> {
  await runtime.projectRepository.create({
    id: `project_${runId}`,
    name: "Manual Run Event Project",
    rootPath: projectRoot,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  });
  await runtime.taskRepository.create({
    id: `task_${runId}`,
    projectId: `project_${runId}`,
    title: "Manual run event task",
    status: "open",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  });
  await runtime.taskRunRepository.create({
    id: runId,
    taskId: `task_${runId}`,
    agentKind: "fake",
    status: "succeeded",
    createdAt: "2026-01-01T00:00:01.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z"
  });
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
  constructor(
    private readonly diffText = "",
    private readonly changedFiles: DiffCollectionResult["changedFiles"] = [
      { path: "fake-agent-output.md", status: "untracked" }
    ],
    private readonly fileSummaries = ["fake-agent-output.md: untracked"]
  ) {}

  async collect(input: { workspacePath: string }): Promise<DiffCollectionResult> {
    return {
      ok: true,
      workspacePath: input.workspacePath,
      isClean: false,
      changedFiles: this.changedFiles,
      stat: {
        filesChanged: this.changedFiles.length,
        insertions: 1,
        deletions: 0,
        text: `${this.changedFiles.length} file changed, 1 insertion(+)`
      },
      diff: this.diffText,
      fileSummaries: this.fileSummaries,
      commands: []
    };
  }
}

class ThrowingRiskReportGenerator extends RiskReportGenerator {
  override generate(_input: RiskReportInput): never {
    throw new Error("risk backend unavailable");
  }
}
