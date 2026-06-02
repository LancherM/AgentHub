import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createCliRuntime, main } from "@agent-hub/cli";
import type {
  ProcessDetectionInput,
  ProcessDetectionResult,
  ProcessRunEvent,
  ProcessRunInput,
  ProcessRunner
} from "@agent-hub/agent-adapters";
import type {
  ChangedFile,
  DiffCollectionResult,
  DiffCollectorService
} from "@agent-hub/task-runner";
import { presetWorkgroupRoles, type RiskReport } from "@agent-hub/core";
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

  it("hides and rejects fake agent in normal production mode", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousDebug = process.env.AGENT_HUB_DEBUG;
    const previousFake = process.env.AGENT_HUB_AGENT_FAKE_ENABLED;
    process.env.NODE_ENV = "production";
    delete process.env.AGENT_HUB_DEBUG;
    delete process.env.AGENT_HUB_AGENT_FAKE_ENABLED;
    try {
      const projectRoot = await createTestDirectory("cli-fake-disabled-project");
      const runRoot = path.join(
        await createTestDirectory("cli-fake-disabled-runs"),
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
      const output: string[] = [];
      const errors: string[] = [];
      const io = {
        stdout: { write: (chunk: string) => { output.push(chunk); return true; } },
        stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
      };

      await expect(main(["--help"], io, projectRoot, runtime)).resolves.toBe(0);
      expect(output.join("")).not.toContain("@fake");
      expect(output.join("")).toContain("--agent codex|claude-code");

      await expect(
        main(["run", "@fake", "normal hidden"], io, projectRoot, runtime)
      ).resolves.toBe(1);
      expect(errors.join("")).toContain("fake agent is disabled");

      await expect(
        main(["--debug", "run", "@fake", "debug visible"], io, projectRoot, runtime)
      ).resolves.toBe(0);
      expect(output.join("")).toContain("# Fake Agent Output");
    } finally {
      restoreEnv("NODE_ENV", previousNodeEnv);
      restoreEnv("AGENT_HUB_DEBUG", previousDebug);
      restoreEnv("AGENT_HUB_AGENT_FAKE_ENABLED", previousFake);
    }
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

  it("continues code state from a message-linked retained run", async () => {
    const projectRoot = await createTestDirectory("cli-project");
    const runRoot = path.join(await createTestDirectory("cli-runs"), "runs");
    const parentWorktree = await createTestDirectory("cli-parent-worktree");
    await fs.mkdir(path.join(parentWorktree, "src"), { recursive: true });
    await fs.writeFile(path.join(parentWorktree, "src", "carry.ts"), "carry\n", "utf8");
    const runtime = createCliRuntime({
      storageMode: "memory",
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot, {
        "src/base.ts": "base\n"
      }),
      diffCollector: new ContinuationDiffCollector(parentWorktree, [
        { path: "src/carry.ts", status: "untracked" }
      ]),
      shellExecutor: new MockShellExecutor([{ stdout: "abc123\n" }]),
      verificationRunner: new VerificationRunner(new MockShellExecutor()),
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock("2026-01-01T00:00:00.000Z")
    });
    await seedRetainedParentRun(runtime, projectRoot, parentWorktree);
    await runtime.conversationThreadRepository.create({
      id: "thread_parent",
      projectId: "adhoc_project",
      title: "Parent thread",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    await runtime.conversationMessageRepository.create({
      id: "message_parent",
      threadId: "thread_parent",
      sequence: 0,
      role: "tool",
      kind: "run_card",
      content: "Parent run",
      agentKind: "fake",
      runId: "run_parent",
      status: "succeeded",
      createdAt: "2026-01-01T00:00:00.000Z"
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
        "--continue-from-message",
        "message_parent",
        "@fake",
        "continue from message"
      ], io, projectRoot, runtime)
    ).resolves.toBe(0);

    const childRun = (await runtime.taskRunRepository.list()).find(
      (run) => run.id !== "run_parent"
    );
    expect(childRun).toMatchObject({
      parentRunId: "run_parent",
      parentMessageId: "message_parent"
    });
    await expect(
      fs.readFile(path.join(childRun?.worktreePath ?? "", "src", "carry.ts"), "utf8")
    ).resolves.toBe("carry\n");
    await expect(
      runtime.runArtifactRepository.getLatestByRunIdAndKind(
        childRun?.id ?? "",
        "code_state_provenance"
      )
    ).resolves.toEqual(
      expect.objectContaining({
        content: expect.stringContaining("parent_message_id: message_parent")
      })
    );
    await expect(
      main(["runs", "show", childRun?.id ?? ""], io, projectRoot, runtime)
    ).resolves.toBe(0);
    expect(errors.join("")).toBe("");
    expect(output.join("")).toContain("parent_run_id: run_parent");
    expect(output.join("")).toContain("parent_message_id: message_parent");
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

  it("renders command-mode run output only after the task run completes", async () => {
    const projectRoot = await createTestDirectory("cli-post-run-render-project");
    const runRoot = path.join(
      await createTestDirectory("cli-post-run-render-runs"),
      "runs"
    );
    const processRunner = new ControlledProcessRunner([
      {
        type: "stdout",
        data: "{\"type\":\"item.completed\",\"item\":{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"delayed codex output\"}]}}\n"
      }
    ]);
    const runtime = createCliRuntime({
      storageMode: "memory",
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector(),
      verificationRunner: new VerificationRunner(new MockShellExecutor()),
      processRunner,
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock("2026-01-01T00:00:00.000Z")
    });
    const output: string[] = [];
    const errors: string[] = [];
    const io = {
      stdout: { write: (chunk: string) => { output.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
    };

    const runPromise = main(["run", "@codex", "streaming boundary"], io, projectRoot, runtime);
    await processRunner.firstRunEventYielded.promise;

    expect(output.join("")).toBe("");
    expect(errors.join("")).toBe("");

    processRunner.releaseExit();
    await expect(runPromise).resolves.toBe(0);

    const rendered = output.join("");
    expect(rendered).toContain("delayed codex output");
    expect(rendered).not.toContain("Codex preflight passed");
    expect(rendered).not.toContain("starting Codex");
    expect(rendered).not.toContain("context_delivery:");
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
    expect(queryOutput.join("")).toContain("events: 8");
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
        "tool_call",
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

  it("creates and lists global skills from Agent Hub-owned app data", async () => {
    const projectRoot = await createTestDirectory("cli-global-skill-project");
    const agentHubHome = await createTestDirectory("cli-global-skill-home");
    const output: string[] = [];
    const errors: string[] = [];
    const io = {
      stdout: { write: (chunk: string) => { output.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
    };

    await expect(
      main([
        "skills",
        "global",
        "create",
        "--id",
        "review",
        "--name",
        "review",
        "--description",
        "Review generated output.",
        "--body",
        "Check risks and tests.",
        "--agent-hub-home",
        agentHubHome
      ], io, projectRoot)
    ).resolves.toBe(0);
    await expect(
      main([
        "skills",
        "global",
        "list",
        "--agent-hub-home",
        agentHubHome
      ], io, projectRoot)
    ).resolves.toBe(0);

    const rendered = output.join("");
    expect(errors.join("")).toBe("");
    expect(rendered).toContain("Created global skill");
    expect(rendered).toContain("scope: global");
    expect(rendered).toContain("Global skills");
    expect(rendered).toContain("review (review)");
    await expect(
      fs.readFile(
        path.join(agentHubHome, "skills", "review", "SKILL.md"),
        "utf8"
      )
    ).resolves.toContain("Check risks and tests.");
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

  it("honors global debug availability for context build fake agents", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousDebug = process.env.AGENT_HUB_DEBUG;
    const previousFake = process.env.AGENT_HUB_AGENT_FAKE_ENABLED;
    process.env.NODE_ENV = "production";
    delete process.env.AGENT_HUB_DEBUG;
    delete process.env.AGENT_HUB_AGENT_FAKE_ENABLED;
    try {
      const projectRoot = await createTestDirectory("cli-context-debug-project");
      const agentHubHome = await createTestDirectory("cli-context-debug-home");
      const output: string[] = [];
      const errors: string[] = [];
      const io = {
        stdout: { write: (chunk: string) => { output.push(chunk); return true; } },
        stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
      };

      await expect(
        main([
          "--debug",
          "context",
          "build",
          "--project-root",
          projectRoot,
          "--project-id",
          "project_1",
          "--task-id",
          "task_1",
          "--title",
          "Build fake context",
          "--prompt",
          "Compile debug context",
          "--agent",
          "fake",
          "--agent-hub-home",
          agentHubHome
        ], io, projectRoot)
      ).resolves.toBe(0);

      expect(errors.join("")).toBe("");
      expect(output.join("")).toContain("Built context artifacts");
      expect(output.join("")).toContain("task_id: task_1");
    } finally {
      restoreEnv("NODE_ENV", previousNodeEnv);
      restoreEnv("AGENT_HUB_DEBUG", previousDebug);
      restoreEnv("AGENT_HUB_AGENT_FAKE_ENABLED", previousFake);
    }
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

  it("lists and shows persisted CLI conversation threads", async () => {
    const projectRoot = await createTestDirectory("cli-threads-project");
    const runtime = createCliRuntime({ storageMode: "memory" });
    await runtime.projectRepository.create({
      id: "project_threads",
      name: "Threads Project",
      rootPath: projectRoot,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    await runtime.conversationThreadRepository.create({
      id: "thread_cli",
      projectId: "project_threads",
      title: "CLI thread",
      createdAt: "2026-01-01T00:00:01.000Z",
      updatedAt: "2026-01-01T00:00:02.000Z"
    });
    await runtime.conversationMessageRepository.create({
      id: "message_cli_user",
      threadId: "thread_cli",
      sequence: 0,
      role: "user",
      kind: "text",
      content: "First CLI message",
      createdAt: "2026-01-01T00:00:02.000Z"
    });
    const output: string[] = [];
    const errors: string[] = [];
    const io = {
      stdout: { write: (chunk: string) => { output.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
    };

    await expect(main(["threads", "list"], io, projectRoot, runtime)).resolves.toBe(0);
    await expect(
      main(["threads", "show", "thread_cli"], io, projectRoot, runtime)
    ).resolves.toBe(0);

    const rendered = output.join("");
    expect(errors.join("")).toBe("");
    expect(rendered).toContain("thread_cli\tproject_threads");
    expect(rendered).toContain("CLI thread");
    expect(rendered).toContain("Thread thread_cli");
    expect(rendered).toContain("messages: 1");
    expect(rendered).toContain("0\tuser\ttext\t-\t-\t-\tFirst CLI message");
  });

  it("exposes rooms and team roles through CLI commands", async () => {
    const projectRoot = await createTestDirectory("cli-rooms-roles-project");
    const runtime = createCliRuntime({ storageMode: "memory" });
    await runtime.projectRepository.create({
      id: "project_workgroup",
      name: "Workgroup Project",
      rootPath: projectRoot,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    const output: string[] = [];
    const errors: string[] = [];
    const io = {
      stdout: { write: (chunk: string) => { output.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
    };

    await expect(
      main(["rooms", "list", "--project-id", "project_workgroup"], io, projectRoot, runtime)
    ).resolves.toBe(0);
    await expect(
      main([
        "rooms",
        "create",
        "--project-id",
        "project_workgroup",
        "--handle",
        "release",
        "--title",
        "Release",
        "--description",
        "Release coordination"
      ], io, projectRoot, runtime)
    ).resolves.toBe(0);
    await expect(
      main([
        "rooms",
        "use",
        "--project-id",
        "project_workgroup",
        "--room",
        "release"
      ], io, projectRoot, runtime)
    ).resolves.toBe(0);
    await expect(
      main(["team", "roles", "list", "--project-id", "project_workgroup"], io, projectRoot, runtime)
    ).resolves.toBe(0);
    await expect(
      main([
        "team",
        "roles",
        "save",
        "--project-id",
        "project_workgroup",
        "--handle",
        "qa",
        "--display-name",
        "QA",
        "--executor",
        "fake",
        "--default-room",
        "release",
        "--skill",
        "global:review"
      ], io, projectRoot, runtime)
    ).resolves.toBe(0);
    await expect(
      main([
        "team",
        "roles",
        "show",
        "--project-id",
        "project_workgroup",
        "--role",
        "qa"
      ], io, projectRoot, runtime)
    ).resolves.toBe(0);
    await expect(
      main([
        "team",
        "roles",
        "executor",
        "--project-id",
        "project_workgroup",
        "--role",
        "qa"
      ], io, projectRoot, runtime)
    ).resolves.toBe(0);

    const rendered = output.join("");
    expect(errors.join("")).toBe("");
    expect(rendered).toContain("#general");
    expect(rendered).toContain("Created room");
    expect(rendered).toContain("room: #release");
    expect(rendered).toContain("command: agent-hub chat --thread");
    expect(rendered).toContain("@researcher\tpreset");
    expect(rendered).toContain("Saved role");
    expect(rendered).toContain("Role @qa");
    expect(rendered).toContain("executor: agent_adapter / fake");
    expect(
      (await runtime.settingsRepository.get(
        "desktop.project.project_workgroup.workgroupRoles"
      ))?.value
    ).toMatchObject({
      roles: [
        expect.objectContaining({
          handle: "qa",
          defaultSkillReferences: [{ scope: "global", id: "review" }]
        })
      ]
    });
  });

  it("sends room messages with role mentions as shared task assignments", async () => {
    const projectRoot = await createTestDirectory("cli-room-send-project");
    const runRoot = path.join(await createTestDirectory("cli-room-send-runs"), "runs");
    const runtime = createCliRuntime({
      storageMode: "memory",
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector(),
      verificationRunner: new VerificationRunner(new MockShellExecutor()),
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock("2026-01-01T00:00:00.000Z")
    });
    await runtime.projectRepository.create({
      id: "project_room_send",
      name: "Room Send",
      rootPath: projectRoot,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    const output: string[] = [];
    const errors: string[] = [];
    const io = {
      stdout: { write: (chunk: string) => { output.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
    };

    await expect(
      main([
        "rooms",
        "send",
        "--project-id",
        "project_room_send",
        "--room",
        "general",
        "--message",
        "@researcher @writer summarize acceptance risks"
      ], io, projectRoot, runtime)
    ).resolves.toBe(0);

    const tasks = await runtime.taskRepository.listByProjectId("project_room_send");
    const runs = await runtime.taskRunRepository.listByTaskId(tasks[0]?.id ?? "");
    const assignments = tasks[0]?.metadata?.assignments as Array<{ roleHandle?: string; status?: string; runId?: string }> | undefined;
    expect(errors.join("")).toBe("");
    expect(output.join("")).toContain("# Fake Agent Output");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ status: "completed" });
    expect(runs).toHaveLength(2);
    expect(assignments?.map((assignment) => assignment.roleHandle)).toEqual([
      "researcher",
      "writer"
    ]);
    expect(assignments?.every((assignment) => assignment.status === "completed"))
      .toBe(true);
    expect(assignments?.every((assignment) => Boolean(assignment.runId))).toBe(true);

    await expect(
      main([
        "rooms",
        "timeline",
        "--project-id",
        "project_room_send",
        "--room",
        "general"
      ], io, projectRoot, runtime)
    ).resolves.toBe(0);
    expect(output.join("")).toContain("Room #general");
    expect(output.join("")).toContain("@researcher");
  });

  it("orchestrates RoleCalls emitted by CLI role output", async () => {
    const projectRoot = await createTestDirectory("cli-rolecall-chat-project");
    const runRoot = path.join(await createTestDirectory("cli-rolecall-chat-runs"), "runs");
    const roleResultJson = JSON.stringify({
      summary: "3",
      evidence: ["RoleCall.task asked for output exactly 3."],
      commandsRun: [],
      filesTouched: [],
      patchSummary: "No changes.",
      risks: [],
      nextSteps: ["none"]
    });
    const processRunner = new MockProcessRunner([
      [
        {
          type: "stdout",
          data:
            "{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"@researcher output exactly 3 @engineer output exactly 3\"}}\n"
        },
        { type: "exit", exitCode: 0, signal: null }
      ],
      [
        {
          type: "stdout",
          data: JSON.stringify({
            type: "item.completed",
            item: { type: "agent_message", text: roleResultJson }
          }) + "\n"
        },
        { type: "exit", exitCode: 0, signal: null }
      ],
      [
        {
          type: "stdout",
          data: JSON.stringify({
            type: "item.completed",
            item: { type: "agent_message", text: roleResultJson }
          }) + "\n"
        },
        { type: "exit", exitCode: 0, signal: null }
      ]
    ]);
    const runtime = createCliRuntime({
      storageMode: "memory",
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector(),
      verificationRunner: new VerificationRunner(new MockShellExecutor()),
      processRunner,
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock("2026-01-01T00:00:00.000Z")
    });
    await runtime.projectRepository.create({
      id: "project_cli_rolecall",
      name: "CLI RoleCall",
      rootPath: projectRoot,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    await runtime.settingsRepository.set({
      key: "desktop.project.project_cli_rolecall.workgroupRoles",
      value: {
        roles: presetWorkgroupRoles.map((role) =>
          role.handle === "analyst" ||
          role.handle === "researcher" ||
          role.handle === "engineer"
            ? {
                ...role,
                executor: { kind: "agent_adapter", adapterKind: "codex" }
              }
            : role
        )
      },
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    const output: string[] = [];
    const errors: string[] = [];
    const io = {
      stdout: { write: (chunk: string) => { output.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
    };

    await expect(
      main([
        "rooms",
        "send",
        "--project-id",
        "project_cli_rolecall",
        "--room",
        "general",
        "--message",
        "@analyst ask other roles for the number"
      ], io, projectRoot, runtime)
    ).resolves.toBe(0);

    const threads = await runtime.conversationThreadRepository.list("project_cli_rolecall");
    const thread = threads.find((entry) => entry.title.includes("#general")) ?? threads[0];
    const messages = await runtime.conversationMessageRepository.listByThreadId(
      thread?.id ?? ""
    );
    const roleCalls = await runtime.roleCallRepository.list({
      threadId: thread?.id ?? ""
    });
    const analystRunId = messages.find(
      (message) =>
        message.role === "assistant" &&
        message.metadata?.role &&
        (message.metadata.role as { roleHandle?: string }).roleHandle === "analyst"
    )?.runId;
    const analystBrief = await runtime.runArtifactRepository.getLatestByRunIdAndKind(
      analystRunId ?? "",
      "conversation_brief"
    );

    expect(errors.join("")).toBe("");
    expect(processRunner.runCalls).toHaveLength(3);
    expect(analystBrief?.content).toContain("role_call_protocol:");
    expect(analystBrief?.content).toContain("available_role_calls:");
    expect(roleCalls).toHaveLength(2);
    expect(roleCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        callerRole: "analyst",
        calleeRole: "researcher",
        task: "output exactly 3",
        status: "succeeded",
        taskRunId: expect.any(String),
        result: expect.objectContaining({ summary: "3" })
      }),
      expect.objectContaining({
        callerRole: "analyst",
        calleeRole: "engineer",
        task: "output exactly 3",
        status: "succeeded",
        taskRunId: expect.any(String),
        result: expect.objectContaining({ summary: "3" })
      })
    ]));
    expect(messages.filter((message) => message.kind === "run_card")).toHaveLength(3);
    expect(messages.filter((message) => message.role === "assistant")).toHaveLength(3);
    expect(
      messages.filter(
        (message) =>
          message.role === "assistant" &&
          message.metadata?.roleCallProcessed === true
      )
    ).toHaveLength(1);
    expect(
      messages.filter((message) => message.metadata?.roleCallId)
        .map((message) => (message.metadata?.assignment as { roleHandle?: string })?.roleHandle)
        .sort()
    ).toEqual(["engineer", "engineer", "researcher", "researcher"]);
    await expect(runtime.roleTodoRepository.list({ threadId: thread?.id ?? "" }))
      .resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ role: "researcher", status: "done" }),
        expect.objectContaining({ role: "engineer", status: "done" })
      ]));
    expect(output.join("")).toContain("3");
  });

  it("persists CLI chat turns and injects prior thread context", async () => {
    const projectRoot = await createTestDirectory("cli-chat-project");
    const runRoot = path.join(await createTestDirectory("cli-chat-runs"), "runs");
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
        "first thread-aware prompt\n",
        "second thread-aware prompt\n",
        "/history\n",
        "/exit\n"
      ]),
      stdout: { write: (chunk: string) => { output.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
    };

    await expect(main(["chat"], io, projectRoot, runtime)).resolves.toBe(0);

    const threads = await runtime.conversationThreadRepository.list();
    expect(threads).toHaveLength(1);
    const messages = await runtime.conversationMessageRepository.listByThreadId(
      threads[0]?.id ?? ""
    );
    expect(messages.map((message) => message.sequence)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(messages.filter((message) => message.role === "user").map((message) => message.content))
      .toEqual(["first thread-aware prompt", "second thread-aware prompt"]);
    expect(messages.filter((message) => message.kind === "run_card")).toHaveLength(2);
    expect(messages.filter((message) => message.role === "assistant")).toHaveLength(2);
    expect(messages.find((message) => message.role === "assistant")?.content)
      .toContain("# Fake Agent Output");
    await expect(
      runtime.conversationThreadSummaryRepository.getByThreadId(threads[0]?.id ?? "")
    ).resolves.toMatchObject({
      lastKnownUserGoal: "second thread-aware prompt",
      sourceMessageCount: 4
    });

    const secondRunId = messages.filter((message) => message.kind === "run_card")[1]?.runId;
    expect(secondRunId).toBeTruthy();
    const brief = await runtime.runArtifactRepository.getLatestByRunIdAndKind(
      secondRunId ?? "",
      "conversation_brief"
    );
    expect(brief?.content).toContain("second thread-aware prompt");
    expect(brief?.content).toContain("first thread-aware prompt");
    expect(brief?.content).toContain("## Thread Summary");
    expect(brief?.content).toContain("Last known user goal: first thread-aware prompt");
    expect(brief?.content).toContain("# Fake Agent Output");
    expect(errors.join("")).toBe("");
    expect(output.join("")).toContain("Agent Hub chat");
    expect(output.join("")).toContain("Thread ");
    expect(output.join("")).toContain("thread_summary:");
    expect(output.join("")).toContain("Exiting Agent Hub chat.");
  });

  it("resumes a CLI chat thread from a later runtime using the same SQLite database", async () => {
    const projectRoot = await createTestDirectory("cli-chat-resume-project");
    const runRoot = path.join(await createTestDirectory("cli-chat-resume-runs"), "runs");
    const databasePath = path.join(
      await createTestDirectory("cli-chat-resume-db"),
      "agent-hub.sqlite"
    );
    const createRuntime = () =>
      createCliRuntime({
        sqliteDatabasePath: databasePath,
        defaultRunRoot: runRoot,
        workspaceManager: new TestWorkspaceManager(runRoot),
        diffCollector: new StaticDiffCollector(),
        verificationRunner: new VerificationRunner(new MockShellExecutor())
      });
    const firstOutput: string[] = [];
    const firstErrors: string[] = [];
    const firstRuntime = createRuntime();
    const firstIo = {
      stdin: Readable.from(["resume seed prompt\n", "/exit\n"]),
      stdout: { write: (chunk: string) => { firstOutput.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { firstErrors.push(chunk); return true; } }
    };

    await expect(main(["chat"], firstIo, projectRoot, firstRuntime)).resolves.toBe(0);
    const firstThreads = await firstRuntime.conversationThreadRepository.list();
    const threadId = firstThreads[0]?.id ?? "";
    expect(threadId).toBeTruthy();

    const secondOutput: string[] = [];
    const secondErrors: string[] = [];
    const secondRuntime = createRuntime();
    const secondIo = {
      stdin: Readable.from(["resume follow-up prompt\n", "/exit\n"]),
      stdout: { write: (chunk: string) => { secondOutput.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { secondErrors.push(chunk); return true; } }
    };
    await expect(
      main(["chat", "--thread", threadId], secondIo, projectRoot, secondRuntime)
    ).resolves.toBe(0);

    const repositories = createSqliteRepositories({ databasePath });
    const messages = await repositories.conversationMessageRepository.listByThreadId(threadId);
    expect(messages.filter((message) => message.role === "user").map((message) => message.content))
      .toEqual(["resume seed prompt", "resume follow-up prompt"]);
    const secondRunId = messages.filter((message) => message.kind === "run_card")[1]?.runId;
    const brief = await repositories.runArtifactRepository.getLatestByRunIdAndKind(
      secondRunId ?? "",
      "conversation_brief"
    );
    expect(brief?.content).toContain("resume seed prompt");
    expect(brief?.content).toContain("resume follow-up prompt");
    expect(brief?.content).toContain("## Thread Summary");
    expect(brief?.content).toContain("Last known user goal: resume seed prompt");
    expect(firstErrors.join("")).toBe("");
    expect(secondErrors.join("")).toBe("");
    expect(secondOutput.join("")).toContain(`thread: ${threadId}`);
  });

  it("keeps stateless run commands out of the conversation thread store", async () => {
    const projectRoot = await createTestDirectory("cli-stateless-run-project");
    const runRoot = path.join(await createTestDirectory("cli-stateless-run-runs"), "runs");
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

    await expect(main(["run", "@fake", "stateless task"], io, projectRoot, runtime))
      .resolves.toBe(0);

    await expect(runtime.conversationThreadRepository.list()).resolves.toEqual([]);
    expect(errors.join("")).toBe("");
    expect(output.join("")).toContain("# Fake Agent Output");
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

  it("lists generated proposed memory without injecting it into context", async () => {
    const projectRoot = await createTestDirectory("cli-generated-memory-project");
    const runRoot = path.join(
      await createTestDirectory("cli-generated-memory-runs"),
      "runs"
    );
    const databasePath = path.join(
      await createTestDirectory("cli-generated-memory-db"),
      "agent-hub.sqlite"
    );
    const agentHubHome = await createTestDirectory("cli-generated-memory-home");
    const runtime = createCliRuntime({
      sqliteDatabasePath: databasePath,
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector(),
      verificationRunner: new VerificationRunner(
        new MockShellExecutor([{ exitCode: 0, stdout: "ok\n" }])
      ),
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
        "--verify",
        "pnpm test",
        "@fake",
        "capture verification memory"
      ], io, projectRoot, runtime)
    ).resolves.toBe(0);
    await expect(
      main(["memory", "list", "--project-id", "adhoc_project"], io, projectRoot, runtime)
    ).resolves.toBe(0);
    await expect(
      main([
        "context",
        "init",
        "--project-root",
        projectRoot,
        "--project-id",
        "adhoc_project",
        "--agent-hub-home",
        agentHubHome
      ], io, projectRoot, runtime)
    ).resolves.toBe(0);
    await expect(
      main([
        "context",
        "build",
        "--project-root",
        projectRoot,
        "--project-id",
        "adhoc_project",
        "--task-id",
        "task_generated_memory",
        "--title",
        "Use generated memory",
        "--prompt",
        "Build context without proposed generated memory",
        "--agent-hub-home",
        agentHubHome
      ], io, projectRoot, runtime)
    ).resolves.toBe(0);

    const renderedOutput = output.join("");
    const contextPackPath = extractLineValue(renderedOutput, "context_pack_path");
    const contextPack = JSON.parse(await fs.readFile(contextPackPath, "utf8")) as {
      approvedMemorySections: string[];
    };

    expect(errors.join("")).toBe("");
    expect(renderedOutput).toContain(
      "proposed\tworkflow_rule\tVerification command for this project is pnpm test."
    );
    expect(contextPack.approvedMemorySections.join("\n")).not.toContain(
      "Verification command for this project is pnpm test."
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
        summary: expect.stringContaining("candidate_failed_checks: pnpm lint"),
        details: expect.objectContaining({
          changedFiles: expect.objectContaining({
            candidateOnly: ["src/b.ts"],
            overlapCount: 1
          }),
          verification: expect.objectContaining({
            failedCheckDelta: 1
          }),
          risk: expect.objectContaining({
            rankDelta: 4
          }),
          score: expect.objectContaining({
            baseline: 97,
            candidate: 0,
            winner: "baseline"
          })
        })
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
    expect(output.join("")).toContain(
      "comparison_score: baseline=97 candidate=0 winner=baseline"
    );
    expect(output.join("")).toContain("structured_signals:");
    expect(output.join("")).toContain('"overlapCount": 1');
    expect(output.join("")).toContain('"failedCheckDelta": 1');
    expect(output.join("")).toContain('"winner": "baseline"');
  });

  it("treats low and medium risks as lower than missing comparison risk", async () => {
    const projectRoot = await createTestDirectory("cli-compare-risk-rank-project");
    const databasePath = path.join(
      await createTestDirectory("cli-compare-risk-rank-db"),
      "agent-hub.sqlite"
    );
    const repositories = createSqliteRepositories({ databasePath });
    await repositories.projectRepository.create({
      id: "project_compare_risk_rank",
      name: "Compare Risk Rank Project",
      rootPath: projectRoot,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    await repositories.taskRepository.create({
      id: "task_compare_risk_rank",
      projectId: "project_compare_risk_rank",
      title: "Compare risk ranks",
      status: "open",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    await repositories.taskRunRepository.create({
      id: "run_missing_risk",
      taskId: "task_compare_risk_rank",
      agentKind: "fake",
      status: "succeeded",
      createdAt: "2026-01-01T00:00:01.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z"
    });
    await repositories.taskRunRepository.create({
      id: "run_low_risk",
      taskId: "task_compare_risk_rank",
      agentKind: "codex",
      status: "succeeded",
      createdAt: "2026-01-01T00:00:02.000Z",
      updatedAt: "2026-01-01T00:00:02.000Z"
    });
    await repositories.taskRunRepository.create({
      id: "run_medium_risk",
      taskId: "task_compare_risk_rank",
      agentKind: "claude-code",
      status: "succeeded",
      createdAt: "2026-01-01T00:00:03.000Z",
      updatedAt: "2026-01-01T00:00:03.000Z"
    });
    await repositories.riskReportRepository.create(
      riskReportForRun("risk_low", "run_low_risk", "low")
    );
    await repositories.riskReportRepository.create(
      riskReportForRun("risk_medium", "run_medium_risk", "medium")
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
        "task_compare_risk_rank",
        "--baseline",
        "run_missing_risk",
        "--candidate",
        "run_low_risk"
      ], io, projectRoot)
    ).resolves.toBe(0);

    expect(errors.join("")).toBe("");
    expect(output.join("")).toContain("baseline_risk_factors: none");
    expect(output.join("")).toContain("risk=low");
    expect(output.join("")).toContain("summary_tradeoffs: candidate has lower risk");
    expect(output.join("")).toContain('"rankDelta": -2');
    expect(output.join("")).not.toContain("candidate has higher risk");

    output.length = 0;
    errors.length = 0;
    await expect(
      main([
        "--db",
        databasePath,
        "compare",
        "--task-id",
        "task_compare_risk_rank",
        "--baseline",
        "run_missing_risk",
        "--candidate",
        "run_medium_risk"
      ], io, projectRoot)
    ).resolves.toBe(0);

    expect(errors.join("")).toBe("");
    expect(output.join("")).toContain("risk=medium");
    expect(output.join("")).toContain("summary_tradeoffs: candidate has lower risk");
    expect(output.join("")).toContain('"rankDelta": -1');
    expect(output.join("")).not.toContain("candidate has higher risk");
  });

  it("rejects comparison when either run belongs to another task", async () => {
    const projectRoot = await createTestDirectory("cli-compare-mismatch-project");
    const databasePath = path.join(
      await createTestDirectory("cli-compare-mismatch-db"),
      "agent-hub.sqlite"
    );
    const repositories = createSqliteRepositories({ databasePath });
    await repositories.projectRepository.create({
      id: "project_compare_mismatch",
      name: "Compare Mismatch Project",
      rootPath: projectRoot,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    await repositories.taskRepository.create({
      id: "task_compare_a",
      projectId: "project_compare_mismatch",
      title: "Compare A",
      status: "open",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    await repositories.taskRepository.create({
      id: "task_compare_b",
      projectId: "project_compare_mismatch",
      title: "Compare B",
      status: "open",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    await repositories.taskRunRepository.create({
      id: "run_compare_a",
      taskId: "task_compare_a",
      agentKind: "fake",
      status: "succeeded",
      createdAt: "2026-01-01T00:00:01.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z"
    });
    await repositories.taskRunRepository.create({
      id: "run_compare_b",
      taskId: "task_compare_b",
      agentKind: "codex",
      status: "succeeded",
      createdAt: "2026-01-01T00:00:02.000Z",
      updatedAt: "2026-01-01T00:00:02.000Z"
    });

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
        "task_compare_a",
        "--baseline",
        "run_compare_a",
        "--candidate",
        "run_compare_b"
      ], io, projectRoot)
    ).resolves.toBe(1);

    expect(output.join("")).toBe("");
    expect(errors.join("")).toContain(
      "candidate run run_compare_b does not belong to task task_compare_a"
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

async function seedRetainedParentRun(
  runtime: ReturnType<typeof createCliRuntime>,
  projectRoot: string,
  parentWorktree: string
): Promise<void> {
  await runtime.taskRepository.create({
    id: "task_parent",
    projectId: "adhoc_project",
    title: "Parent",
    status: "completed",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  });
  await runtime.taskRunRepository.create({
    id: "run_parent",
    taskId: "task_parent",
    agentKind: "fake",
    status: "succeeded",
    worktreePath: parentWorktree,
    branchName: "agent-hub/task_parent/fake",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  });
  await runtime.runMetadataRepository.save({
    runId: "run_parent",
    workspace: {
      path: parentWorktree,
      branchName: "agent-hub/task_parent/fake",
      sourceRepositoryPath: projectRoot,
      workspaceBasePath: path.dirname(parentWorktree),
      taskId: "task_parent",
      runId: "run_parent",
      agentKind: "fake",
      dryRun: false,
      sourceRepositoryDirty: false,
      cleanupPolicy: "never"
    },
    workspaceCleanup: {
      cleaned: false,
      retained: true,
      reason: "test retained parent",
      commands: []
    }
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
  constructor(
    private readonly runRoot: string,
    private readonly baseFiles: Record<string, string> = {}
  ) {}

  async createSession(config: WorkspaceConfig): Promise<WorkspaceSession> {
    const workspacePath = path.join(
      this.runRoot,
      `${config.taskId}-${config.agentKind}-${config.runId}`
    );
    await fs.mkdir(workspacePath, { recursive: true });
    for (const [relativePath, content] of Object.entries(this.baseFiles)) {
      const filePath = path.join(workspacePath, relativePath);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, "utf8");
    }
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

class ContinuationDiffCollector extends StaticDiffCollector {
  constructor(
    private readonly parentWorktree: string,
    private readonly parentChangedFiles: ChangedFile[]
  ) {
    super();
  }

  async collect(input: { workspacePath: string }): Promise<DiffCollectionResult> {
    if (path.resolve(input.workspacePath) !== path.resolve(this.parentWorktree)) {
      return super.collect(input);
    }
    return {
      ok: true,
      workspacePath: input.workspacePath,
      isClean: this.parentChangedFiles.length === 0,
      changedFiles: this.parentChangedFiles,
      stat: {
        filesChanged: this.parentChangedFiles.length,
        insertions: this.parentChangedFiles.length,
        deletions: 0,
        text: `${this.parentChangedFiles.length} files changed`
      },
      diff: "",
      fileSummaries: this.parentChangedFiles.map(
        (file) => `${file.path}: ${file.status}`
      ),
      commands: []
    };
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(error?: unknown): void;
}

function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

class ControlledProcessRunner implements ProcessRunner {
  readonly runCalls: ProcessRunInput[] = [];
  readonly detectCalls: ProcessDetectionInput[] = [];
  readonly firstRunEventYielded = createDeferred<void>();
  private readonly exitReleased = createDeferred<void>();

  constructor(private readonly runEvents: ProcessRunEvent[]) {}

  async *run(input: ProcessRunInput): AsyncIterable<ProcessRunEvent> {
    this.runCalls.push(input);
    for (const event of this.runEvents) {
      this.firstRunEventYielded.resolve();
      yield event;
    }
    await this.exitReleased.promise;
    yield { type: "exit", exitCode: 0, signal: null };
  }

  async detect(input: ProcessDetectionInput): Promise<ProcessDetectionResult> {
    this.detectCalls.push(input);
    return {
      available: true,
      version: "mock"
    };
  }

  releaseExit(): void {
    this.exitReleased.resolve();
  }
}

class ThrowingRiskReportGenerator extends RiskReportGenerator {
  override generate(_input: RiskReportInput): never {
    throw new Error("risk backend unavailable");
  }
}
