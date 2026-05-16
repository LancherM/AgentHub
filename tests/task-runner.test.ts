import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FakeAgentAdapter } from "../src/agent-adapters";
import {
  DefaultContextCompiler,
  InMemoryMemoryProvider,
  MarkdownContextFormatter
} from "../src/context-compiler";
import { DefaultAgentRegistry, InMemoryTaskRepository, InMemoryTaskRunRepository } from "../src/storage";
import {
  FixedClock,
  runTask,
  SequenceIdGenerator,
  TaskRunner,
  TaskRunnerError
} from "../src/task-runner";
import { createTestDirectory } from "./helpers";

describe("task runner", () => {
  it("runs the fake adapter in an isolated directory without modifying the project root", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");
    const runRoot = await createTestDirectory("agent-hub-runs");
    const projectMarker = path.join(projectRoot, "README.md");
    await fs.writeFile(projectMarker, "original\n", "utf8");
    const before = await fs.readdir(projectRoot);

    const result = await runTask({
      projectRoot,
      runRoot,
      taskPrompt: "Create a deterministic fake output",
      agentKind: "fake",
      taskId: "task_1"
    });

    expect(result.status).toBe("succeeded");
    expect(result.run.status).toBe("succeeded");
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
      runTask({
        projectRoot,
        runRoot: path.join(projectRoot, ".agent-hub", "runs"),
        taskPrompt: "This should fail",
        agentKind: "fake"
      })
    ).rejects.toThrow(TaskRunnerError);
  });

  it("rejects unimplemented agents", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");

    await expect(
      runTask({
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
    const runner = new TaskRunner({
      taskRepository,
      taskRunRepository,
      defaultRunRoot: runRoot,
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
  });

  it("passes compiled context to the fake adapter", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");
    const runRoot = await createTestDirectory("agent-hub-runs");
    const runner = new TaskRunner({
      defaultRunRoot: runRoot,
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
});
