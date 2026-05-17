import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ClaudeCodeAdapter,
  CodexAdapter,
  type AgentRunEvent
} from "@agent-hub/agent-adapters";
import { createTestDirectory, MockProcessRunner } from "./helpers";

describe("process-backed agent adapters", () => {
  it("detects Codex availability and unavailable reasons without crashing", async () => {
    const availableRunner = new MockProcessRunner([], [
      { available: true, version: "codex-cli 0.130.0" }
    ]);
    await expect(
      new CodexAdapter({ processRunner: availableRunner }).detect()
    ).resolves.toEqual({
      available: true,
      version: "codex-cli 0.130.0"
    });
    expect(availableRunner.detectCalls[0]).toMatchObject({
      executable: "codex",
      args: ["--version"]
    });

    const unavailableRunner = new MockProcessRunner([], [
      { available: false, reason: "not authenticated" }
    ]);
    await expect(
      new CodexAdapter({ processRunner: unavailableRunner }).detect()
    ).resolves.toEqual({
      available: false,
      reason: "Codex CLI unavailable: not authenticated"
    });
  });

  it("runs Codex in the worktree with stdin runtime injection and streams output", async () => {
    const runner = new MockProcessRunner([
      [
        { type: "stdout", data: "{\"type\":\"agent_message\",\"message\":\"done\"}\n" },
        { type: "stdout", data: "{malformed json\n" },
        { type: "stderr", data: "warning\n" },
        { type: "exit", exitCode: 0, signal: null }
      ]
    ]);
    const input = await createInput("codex-adapter");

    const events = await collect(new CodexAdapter({ processRunner: runner }).run(input));

    expect(runner.detectCalls[0]).toMatchObject({
      executable: "codex",
      args: ["--version"],
      cwd: input.worktreePath,
      env: input.environment
    });
    expect(runner.runCalls[0]).toMatchObject({
      executable: "codex",
      args: ["exec", "--json", "-"],
      cwd: input.worktreePath
    });
    expect(runner.runCalls[0].stdin).toContain("# Brief");
    expect(runner.runCalls[0].stdin).toContain("Context payload");
    expect(events).toEqual([
      expect.objectContaining({ type: "status", message: "Codex preflight passed" }),
      expect.objectContaining({ type: "status", message: "starting Codex" }),
      expect.objectContaining({ type: "stdout", message: expect.stringContaining("agent_message") }),
      expect.objectContaining({ type: "message", message: "done" }),
      expect.objectContaining({ type: "stdout", message: "{malformed json\n" }),
      expect.objectContaining({ type: "stderr", message: "warning\n" }),
      expect.objectContaining({ type: "exit", exitCode: 0, signal: null })
    ]);
  });

  it("runs Claude Code in print mode without repository-level context files", async () => {
    const runner = new MockProcessRunner([
      [
        { type: "stdout", data: "{\"type\":\"result\",\"result\":\"complete\"}\n" },
        { type: "exit", exitCode: 0, signal: null }
      ]
    ]);
    const input = await createInput("claude-adapter");

    const events = await collect(new ClaudeCodeAdapter({ processRunner: runner }).run(input));

    expect(runner.runCalls[0]).toMatchObject({
      executable: "claude",
      args: ["--print", "--output-format", "stream-json"],
      cwd: input.worktreePath
    });
    expect(runner.runCalls[0].stdin).toContain("Run inside the current isolated worktree");
    expect(events).toContainEqual(expect.objectContaining({
      type: "message",
      message: "complete"
    }));
  });

  it("preflights process-backed adapters and emits failed events when unavailable", async () => {
    const runner = new MockProcessRunner(
      [[{ type: "exit", exitCode: 0, signal: null }]],
      [{ available: false, reason: "not authenticated" }]
    );
    const input = await createInput("codex-unavailable");

    const events = await collect(new CodexAdapter({ processRunner: runner }).run(input));

    expect(runner.detectCalls).toHaveLength(1);
    expect(runner.runCalls).toHaveLength(0);
    expect(events).toEqual([
      expect.objectContaining({
        type: "error",
        message: "Codex preflight failed: Codex CLI unavailable: not authenticated"
      }),
      expect.objectContaining({ type: "exit", exitCode: 1 })
    ]);
  });

  it("emits non-zero and signal exits as failed adapter exits", async () => {
    const nonZeroRunner = new MockProcessRunner([
      [{ type: "exit", exitCode: 2, signal: null }]
    ]);
    const signaledRunner = new MockProcessRunner([
      [{ type: "exit", exitCode: null, signal: "SIGTERM" }]
    ]);
    const input = await createInput("adapter-exit");

    await expect(
      collect(new CodexAdapter({ processRunner: nonZeroRunner }).run(input))
    ).resolves.toContainEqual(expect.objectContaining({ type: "exit", exitCode: 2 }));
    await expect(
      collect(new CodexAdapter({ processRunner: signaledRunner }).run(input))
    ).resolves.toContainEqual(
      expect.objectContaining({ type: "exit", exitCode: 1, signal: "SIGTERM" })
    );
  });

  it("refuses unsafe cwd and dangerous permission flags", async () => {
    const root = await createTestDirectory("adapter-original-root");
    const briefPath = path.join(root, "brief.md");
    await fs.writeFile(briefPath, "# Brief\n", "utf8");
    const runner = new MockProcessRunner();

    await expect(
      collect(
        new CodexAdapter({ processRunner: runner }).run({
          originalProjectRoot: root,
          worktreePath: root,
          taskBriefPath: briefPath,
          taskId: "task_1",
          taskTitle: "Unsafe",
          taskPrompt: "Do not run here"
        })
      )
    ).resolves.toContainEqual(
      expect.objectContaining({
        type: "exit",
        exitCode: 1,
        message: expect.stringContaining("original project root")
      })
    );
    expect(runner.detectCalls).toHaveLength(0);
    expect(runner.runCalls).toHaveLength(0);
    expect(() =>
      new CodexAdapter({ runArgs: ["exec", "--dangerously-bypass-approvals-and-sandbox", "-"] })
    ).toThrow("unsafe permission flags");
    expect(() =>
      new CodexAdapter({ runArgs: ["exec", "--sandbox=danger-full-access", "-"] })
    ).toThrow("unsafe permission flags");
  });
});

async function createInput(name: string) {
  const root = await createTestDirectory(`${name}-root`);
  const worktree = await createTestDirectory(`${name}-worktree`);
  const taskBriefPath = path.join(worktree, ".agent-hub", "tasks", "task_1", "brief.md");
  await fs.mkdir(path.dirname(taskBriefPath), { recursive: true });
  await fs.writeFile(taskBriefPath, "# Brief\n\nDo the task.\n", "utf8");
  return {
    originalProjectRoot: root,
    worktreePath: worktree,
    taskBriefPath,
    taskId: "task_1",
    taskTitle: "Run real adapter",
    taskPrompt: "Do the task.",
    contextMarkdown: "Context payload",
    environment: { AGENT_HUB_TEST: "1" }
  };
}

async function collect(events: AsyncIterable<AgentRunEvent>): Promise<AgentRunEvent[]> {
  const collected: AgentRunEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}
