import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DiffCollector } from "@agent-hub/task-runner";
import { NodeShellExecutor } from "@agent-hub/task-runner";
import { createTestDirectory, MockShellExecutor } from "./helpers";

describe("DiffCollector", () => {
  it("collects changed files, diff stats, and simple summaries", async () => {
    const workspacePath = await createTestDirectory("diff-workspace");
    await fs.writeFile(path.join(workspacePath, "new.txt"), "new content\n", "utf8");
    const shell = new MockShellExecutor([
      { stdout: " M src/a.ts\n?? new.txt\n?? .agent-hub/tasks/task_1/brief.md\n" },
      { stdout: " 2 files changed, 10 insertions(+), 2 deletions(-)\n" },
      { stdout: "3\t1\tsrc/a.ts\n7\t1\tnew.txt\n" },
      { stdout: "diff --git a/src/a.ts b/src/a.ts\nstaged\n" },
      { stdout: "diff --git a/src/a.ts b/src/a.ts\nunstaged\n" }
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
    expect(result.diff).toContain("staged");
    expect(result.diff).toContain("unstaged");
    expect(result.diff).toContain("+++ b/new.txt");
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


  it("rejects executable local git config before collecting diffs", async () => {
    const workspacePath = await createTestDirectory("diff-malicious-config");
    await fs.mkdir(path.join(workspacePath, ".git"));
    await fs.writeFile(
      path.join(workspacePath, ".git", "config"),
      "[core]\n	hooksPath = .githooks\n",
      "utf8"
    );
    const shell = new MockShellExecutor();

    await expect(new DiffCollector(shell).collect({ workspacePath })).rejects.toThrow(
      /executable local git config/
    );
    expect(shell.calls).toHaveLength(0);
  });

  it("keeps modified generated overlays while excluding unchanged generated files", async () => {
    const workspacePath = await createTestDirectory("diff-overlay");
    const unchanged = path.join(workspacePath, ".agent-hub", "tasks", "task_1", "brief.md");
    const modified = path.join(workspacePath, "AGENTS.md");
    await fs.mkdir(path.dirname(unchanged), { recursive: true });
    await fs.writeFile(unchanged, "same\n", "utf8");
    await fs.writeFile(modified, "changed\n", "utf8");
    const shell = new MockShellExecutor([
      { stdout: " M AGENTS.md\n M .agent-hub/tasks/task_1/brief.md\n" },
      { stdout: " 2 files changed, 2 insertions(+)\n" },
      { stdout: "1\t0\tAGENTS.md\n1\t0\t.agent-hub/tasks/task_1/brief.md\n" },
      { stdout: "" },
      { stdout: "diff --git a/AGENTS.md b/AGENTS.md\n" }
    ]);

    const result = await new DiffCollector(shell).collect({
      workspacePath,
      generatedFileBaselines: [
        {
          path: ".agent-hub/tasks/task_1/brief.md",
          sha256: createHash("sha256").update("same\n").digest("hex")
        },
        {
          path: "AGENTS.md",
          sha256: createHash("sha256").update("original\n").digest("hex")
        }
      ]
    });

    expect(result.changedFiles).toEqual([{ path: "AGENTS.md", status: "modified" }]);
    expect(result.diff).not.toContain(".agent-hub/tasks/task_1/brief.md");
    expect(shell.calls.at(-1)?.command.args).toEqual(
      expect.arrayContaining(["diff", "--no-ext-diff", "--no-textconv", "--", "AGENTS.md"])
    );
  });

  it("excludes unchanged generated tracked overlay content from diff text and stats", async () => {
    const workspacePath = await createTestDirectory("diff-unchanged-overlay");
    await fs.writeFile(path.join(workspacePath, "AGENTS.md"), "generated\n", "utf8");
    const shell = new MockShellExecutor([
      { stdout: " M AGENTS.md\n" },
      { stdout: " 1 file changed, 1 insertion(+)\n" },
      { stdout: "1\t0\tAGENTS.md\n" }
    ]);

    const result = await new DiffCollector(shell).collect({
      workspacePath,
      generatedFileBaselines: [
        {
          path: "AGENTS.md",
          sha256: createHash("sha256").update("generated\n").digest("hex")
        }
      ]
    });

    expect(result.changedFiles).toEqual([]);
    expect(result.stat.filesChanged).toBe(0);
    expect(result.stat.insertions).toBe(0);
    expect(result.diff).toBe("");
  });

  it("excludes unchanged generated untracked overlays but includes agent-modified overlays", async () => {
    const workspacePath = await createTestDirectory("diff-untracked-overlay");
    await fs.writeFile(path.join(workspacePath, "AGENTS.md"), "generated\nagent edit\n", "utf8");
    await fs.writeFile(path.join(workspacePath, "CLAUDE.md"), "generated\n", "utf8");
    const shell = new MockShellExecutor([
      { stdout: "?? AGENTS.md\n?? CLAUDE.md\n" },
      { stdout: " 2 files changed, 3 insertions(+)\n" },
      { stdout: "" }
    ]);

    const result = await new DiffCollector(shell).collect({
      workspacePath,
      generatedFileBaselines: [
        {
          path: "AGENTS.md",
          sha256: createHash("sha256").update("generated\n").digest("hex")
        },
        {
          path: "CLAUDE.md",
          sha256: createHash("sha256").update("generated\n").digest("hex")
        }
      ]
    });

    expect(result.changedFiles).toEqual([{ path: "AGENTS.md", status: "untracked" }]);
    expect(result.diff).toContain("+++ b/AGENTS.md");
    expect(result.diff).not.toContain("+++ b/CLAUDE.md");
  });

  it("adds binary metadata for binary files", async () => {
    const workspacePath = await createTestDirectory("diff-binary");
    await fs.writeFile(path.join(workspacePath, "image.bin"), Buffer.from([0, 1, 2]));
    const shell = new MockShellExecutor([
      { stdout: "?? image.bin\n" },
      { stdout: " 1 file changed\n" },
      { stdout: "-\t-\timage.bin\n" },
      { stdout: "" },
      { stdout: "" }
    ]);

    const result = await new DiffCollector(shell).collect({ workspacePath });

    expect(result.changedFiles).toEqual([
      { path: "image.bin", status: "untracked", binary: true, sizeBytes: 3 }
    ]);
    expect(result.fileSummaries).toContain("image.bin: untracked, binary, 3 bytes");
  });

  it("records untracked symlinks without reading their targets", async () => {
    const workspacePath = await createTestDirectory("diff-symlink");
    const outsidePath = path.join(await createTestDirectory("diff-outside-secret"), "secret.txt");
    await fs.writeFile(outsidePath, "AGENTHUB_SECRET_MARKER\n", "utf8");
    await fs.symlink(outsidePath, path.join(workspacePath, "leak.txt"));
    const shell = new MockShellExecutor([
      { stdout: "?? leak.txt\n" },
      { stdout: " 1 file changed\n" },
      { stdout: "" }
    ]);

    const result = await new DiffCollector(shell).collect({ workspacePath });

    expect(result.ok).toBe(true);
    expect(result.changedFiles).toEqual([
      { path: "leak.txt", status: "untracked", symlinkTarget: outsidePath }
    ]);
    expect(result.diff).toContain(`Untracked symlink leak.txt -> ${outsidePath} added`);
    expect(result.diff).not.toContain("AGENTHUB_SECRET_MARKER");
    expect(result.fileSummaries).toContain(`leak.txt: untracked, symlink -> ${outsidePath}`);
    expect(result.stat.insertions).toBe(0);
  });

  it("omits synthetic diff content for oversized untracked files", async () => {
    const workspacePath = await createTestDirectory("diff-large-untracked");
    await fs.writeFile(path.join(workspacePath, "large.txt"), Buffer.alloc(1024 * 1024 + 1, "a"));
    const shell = new MockShellExecutor([
      { stdout: "?? large.txt\n" },
      { stdout: " 1 file changed\n" },
      { stdout: "" }
    ]);

    const result = await new DiffCollector(shell).collect({ workspacePath });

    expect(result.ok).toBe(true);
    expect(result.changedFiles).toEqual([
      {
        path: "large.txt",
        status: "untracked",
        sizeBytes: 1024 * 1024 + 1,
        omittedReason: "larger than 1048576 bytes"
      }
    ]);
    expect(result.diff).toContain("Untracked file large.txt added (larger than 1048576 bytes; content omitted)");
    expect(result.diff).not.toContain("+aaaaaaaaaa");
    expect(result.fileSummaries).toContain("large.txt: untracked, content omitted (larger than 1048576 bytes)");
    expect(result.stat.insertions).toBe(0);
  });

  it("omits synthetic diff content when untracked paths resolve outside the worktree", async () => {
    const workspacePath = await createTestDirectory("diff-symlink-parent");
    const outsideDirectory = await createTestDirectory("diff-outside-directory");
    await fs.writeFile(path.join(outsideDirectory, "secret.txt"), "AGENTHUB_SECRET_MARKER\n", "utf8");
    await fs.symlink(outsideDirectory, path.join(workspacePath, "linked-dir"));
    const shell = new MockShellExecutor([
      { stdout: "?? linked-dir/secret.txt\n" },
      { stdout: " 1 file changed\n" },
      { stdout: "" }
    ]);

    const result = await new DiffCollector(shell).collect({ workspacePath });

    expect(result.ok).toBe(true);
    expect(result.changedFiles).toEqual([
      {
        path: "linked-dir/secret.txt",
        status: "untracked",
        omittedReason: "unreadable or outside workspace"
      }
    ]);
    expect(result.diff).toContain(
      "Untracked file linked-dir/secret.txt added (unreadable or outside workspace; content omitted)"
    );
    expect(result.diff).not.toContain("AGENTHUB_SECRET_MARKER");
    expect(result.stat.insertions).toBe(0);
  });

  it("collects staged, unstaged, and untracked changes from a real git repository", async () => {
    const workspacePath = await createTestDirectory("diff-real-git");
    const shell = new NodeShellExecutor();
    await runGit(shell, workspacePath, ["init"]);
    await runGit(shell, workspacePath, ["config", "user.email", "test@example.com"]);
    await runGit(shell, workspacePath, ["config", "user.name", "Test User"]);
    await fs.writeFile(path.join(workspacePath, "tracked.txt"), "before\n", "utf8");
    await runGit(shell, workspacePath, ["add", "tracked.txt"]);
    await runGit(shell, workspacePath, ["commit", "-m", "initial"]);
    await fs.writeFile(path.join(workspacePath, "tracked.txt"), "before\nafter\n", "utf8");
    await fs.writeFile(path.join(workspacePath, "staged.txt"), "staged\n", "utf8");
    await runGit(shell, workspacePath, ["add", "staged.txt"]);
    await fs.writeFile(path.join(workspacePath, "untracked.txt"), "untracked\n", "utf8");

    const result = await new DiffCollector(shell).collect({ workspacePath });

    expect(result.ok).toBe(true);
    expect(result.changedFiles.map((file) => file.path)).toEqual([
      "staged.txt",
      "tracked.txt",
      "untracked.txt"
    ]);
    expect(result.diff).toContain("+++ b/staged.txt");
    expect(result.diff).toContain("+++ b/tracked.txt");
    expect(result.diff).toContain("+++ b/untracked.txt");
    expect(result.stat.filesChanged).toBe(3);
  });
});

async function runGit(
  shell: NodeShellExecutor,
  cwd: string,
  args: string[]
): Promise<void> {
  const result = await shell.execute({ executable: "git", args }, { cwd });
  expect(result.exitCode).toBe(0);
}
