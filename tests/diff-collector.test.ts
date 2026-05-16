import { describe, expect, it } from "vitest";
import { DiffCollector } from "../src/diff-collector";
import { createTestDirectory, MockShellExecutor } from "./helpers";

describe("DiffCollector", () => {
  it("collects changed files, diff stats, and simple summaries", async () => {
    const workspacePath = await createTestDirectory("diff-workspace");
    const shell = new MockShellExecutor([
      { stdout: " M src/a.ts\n?? new.txt\n?? .agent-hub/tasks/task_1/brief.md\n" },
      { stdout: " 2 files changed, 10 insertions(+), 2 deletions(-)\n" },
      { stdout: "3\t1\tsrc/a.ts\n7\t1\tnew.txt\n" },
      { stdout: "diff --git a/src/a.ts b/src/a.ts\n" }
    ]);
    const collector = new DiffCollector(shell);

    const result = await collector.collect({ workspacePath });

    expect(result.ok).toBe(true);
    expect(result.isClean).toBe(false);
    expect(result.changedFiles).toEqual([
      { path: "new.txt", status: "untracked" },
      { path: "src/a.ts", status: "modified" }
    ]);
    expect(result.stat).toMatchObject({
      filesChanged: 2,
      insertions: 10,
      deletions: 2
    });
    expect(result.fileSummaries).toContain("src/a.ts: modified, +3/-1");
  });

  it("handles a clean worktree", async () => {
    const workspacePath = await createTestDirectory("diff-clean");
    const collector = new DiffCollector(new MockShellExecutor());

    const result = await collector.collect({ workspacePath });

    expect(result.ok).toBe(true);
    expect(result.isClean).toBe(true);
    expect(result.changedFiles).toEqual([]);
    expect(result.stat.filesChanged).toBe(0);
    expect(result.diff).toBe("");
  });

  it("reports git command failure clearly", async () => {
    const workspacePath = await createTestDirectory("diff-failure");
    const collector = new DiffCollector(
      new MockShellExecutor([{ exitCode: 128, stderr: "not a git repository\n" }])
    );

    const result = await collector.collect({ workspacePath });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("not a git repository");
    expect(result.commands).toHaveLength(1);
  });
});
