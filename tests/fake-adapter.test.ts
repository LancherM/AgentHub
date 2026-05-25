import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FakeAgentAdapter, type AgentRunEvent } from "@agent-hub/agent-adapters";
import { createTestDirectory } from "./helpers";

describe("FakeAgentAdapter", () => {
  it("detects as available", async () => {
    await expect(new FakeAgentAdapter().detect()).resolves.toMatchObject({
      available: true
    });
  });

  it("reads the task brief, writes output inside the worktree, and emits assistant output before exit", async () => {
    const root = await createTestDirectory("fake-root");
    const worktree = await createTestDirectory("fake-worktree");
    const briefPath = path.join(worktree, ".agent-hub", "tasks", "task_1", "brief.md");
    await fs.mkdir(path.dirname(briefPath), { recursive: true });
    await fs.writeFile(briefPath, "# Brief\n", "utf8");

    const events = await collect(
      new FakeAgentAdapter().run({
        originalProjectRoot: root,
        worktreePath: worktree,
        taskBriefPath: briefPath,
        taskId: "task_1",
        taskTitle: "Test task",
        taskPrompt: "Write a fake output"
      })
    );

    const outputPath = path.join(worktree, "fake-agent-output.md");
    await expect(fs.readFile(outputPath, "utf8")).resolves.toContain("task_id: task_1");
    expect(events.map((event) => event.type)).toEqual(["stdout", "message", "exit"]);
    expect(events[1]).toMatchObject({
      type: "message",
      message: "fake agent completed",
      metadata: { assistantOutput: true }
    });
    expect(events.at(-1)).toMatchObject({ type: "exit", exitCode: 0 });
  });

  it("refuses to run in the original project root", async () => {
    const root = await createTestDirectory("fake-root");
    const briefPath = path.join(root, "brief.md");
    await fs.writeFile(briefPath, "# Brief\n", "utf8");

    const events = await collect(
      new FakeAgentAdapter().run({
        originalProjectRoot: root,
        worktreePath: root,
        taskBriefPath: briefPath,
        taskId: "task_1",
        taskTitle: "Test task",
        taskPrompt: "Write a fake output"
      })
    );

    expect(events).toEqual([
      expect.objectContaining({
        type: "error",
        message: expect.stringContaining("original project root")
      }),
      expect.objectContaining({
        type: "exit",
        exitCode: 1,
        message: expect.stringContaining("original project root")
      })
    ]);
  });

  it("refuses task briefs outside the worktree", async () => {
    const root = await createTestDirectory("fake-root");
    const worktree = await createTestDirectory("fake-worktree");
    const briefPath = path.join(root, "brief.md");
    await fs.writeFile(briefPath, "# Brief\n", "utf8");

    const events = await collect(
      new FakeAgentAdapter().run({
        originalProjectRoot: root,
        worktreePath: worktree,
        taskBriefPath: briefPath,
        taskId: "task_1",
        taskTitle: "Test task",
        taskPrompt: "Write a fake output"
      })
    );

    expect(events.at(-1)).toMatchObject({ type: "exit", exitCode: 1 });
  });

  it("emits an error and non-zero exit for a missing task brief", async () => {
    const root = await createTestDirectory("fake-root");
    const worktree = await createTestDirectory("fake-worktree");

    const events = await collect(
      new FakeAgentAdapter().run({
        originalProjectRoot: root,
        worktreePath: worktree,
        taskBriefPath: path.join(worktree, "missing.md"),
        taskId: "task_1",
        taskTitle: "Test task",
        taskPrompt: "Write a fake output"
      })
    );

    expect(events.map((event) => event.type)).toEqual(["error", "exit"]);
    expect(events.at(-1)).toMatchObject({ type: "exit", exitCode: 1 });
  });

  it("can be configured to fail for runner tests", async () => {
    const root = await createTestDirectory("fake-root");
    const worktree = await createTestDirectory("fake-worktree");
    const briefPath = path.join(worktree, "brief.md");
    await fs.writeFile(briefPath, "# Brief\n", "utf8");

    const events = await collect(
      new FakeAgentAdapter({ fail: true, failureMessage: "forced failure" }).run({
        originalProjectRoot: root,
        worktreePath: worktree,
        taskBriefPath: briefPath,
        taskId: "task_1",
        taskTitle: "Test task",
        taskPrompt: "Write a fake output"
      })
    );

    expect(events).toEqual([
      expect.objectContaining({ type: "error", message: "forced failure" }),
      expect.objectContaining({ type: "exit", exitCode: 1 })
    ]);
  });
});

async function collect(events: AsyncIterable<AgentRunEvent>): Promise<AgentRunEvent[]> {
  const collected: AgentRunEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}
