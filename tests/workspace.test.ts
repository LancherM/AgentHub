import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GitWorktreeWorkspaceManager, WorkspaceError } from "../src/workspace";
import { createTestDirectory, MockShellExecutor } from "./helpers";

describe("GitWorktreeWorkspaceManager", () => {
  it("creates a git worktree session through the shell executor", async () => {
    const sourceRepositoryPath = await createTestDirectory("workspace-source");
    const workspaceBasePath = await createTestDirectory("workspace-base");
    const shell = new MockShellExecutor([
      { stdout: "true\n" },
      { stdout: "" },
      { stdout: "created worktree\n" }
    ]);
    const manager = new GitWorktreeWorkspaceManager(shell);

    const session = await manager.createSession({
      sourceRepositoryPath,
      workspaceBasePath,
      taskId: "task_1",
      runId: "run_1",
      agentKind: "fake"
    });

    expect(session.workspace.path.startsWith(workspaceBasePath)).toBe(true);
    expect(session.workspace.branchName).toBe("agent-hub/task_1/fake");
    expect(shell.calls.map((call) => call.command.args?.join(" "))).toEqual([
      expect.stringContaining("rev-parse --is-inside-work-tree"),
      expect.stringContaining("status --porcelain"),
      expect.stringContaining("worktree add")
    ]);
    expect(shell.calls[0].command.args).toContain("core.fsmonitor=false");
    expect(shell.calls[2].command.args).toContain("core.hooksPath=/dev/null");
  });

  it("rejects executable local git config before invoking git", async () => {
    const sourceRepositoryPath = await createTestDirectory(
      "workspace-malicious-config"
    );
    const workspaceBasePath = await createTestDirectory("workspace-base");
    await fs.mkdir(path.join(sourceRepositoryPath, ".git"));
    await fs.writeFile(
      path.join(sourceRepositoryPath, ".git", "config"),
      "[core]\n	fsmonitor = ./fsmonitor-poc.sh\n",
      "utf8"
    );
    const shell = new MockShellExecutor();
    const manager = new GitWorktreeWorkspaceManager(shell);

    await expect(
      manager.createSession({
        sourceRepositoryPath,
        workspaceBasePath,
        taskId: "task_1",
        runId: "run_1",
        agentKind: "fake"
      })
    ).rejects.toThrow(/executable local git config/);
    expect(shell.calls).toHaveLength(0);
  });

  it.each([
    {
      name: "dotted filter driver names",
      fileName: "config",
      config: '[filter "foo.bar"]\n	smudge = ./smudge-poc.sh\n'
    },
    {
      name: "section headers with inline comments",
      fileName: "config",
      config: '[filter "poc"] # inline comment\n	process = ./process-poc.sh\n'
    },
    {
      name: "worktree-local git config files",
      fileName: "config.worktree",
      config: '[filter "poc"]\n	clean = ./clean-poc.sh\n'
    }
  ])(
    "rejects executable local git config with $name",
    async ({ fileName, config }) => {
      const sourceRepositoryPath = await createTestDirectory(
        `workspace-malicious-${fileName}`
      );
      const workspaceBasePath = await createTestDirectory("workspace-base");
      await fs.mkdir(path.join(sourceRepositoryPath, ".git"));
      await fs.writeFile(
        path.join(sourceRepositoryPath, ".git", fileName),
        config,
        "utf8"
      );
      const shell = new MockShellExecutor();
      const manager = new GitWorktreeWorkspaceManager(shell);

      await expect(
        manager.createSession({
          sourceRepositoryPath,
          workspaceBasePath,
          taskId: "task_1",
          runId: "run_1",
          agentKind: "fake"
        })
      ).rejects.toThrow(/executable local git config/);
      expect(shell.calls).toHaveLength(0);
    }
  );

  it("rejects unsafe workspace base paths inside the source repository", async () => {
    const sourceRepositoryPath = await createTestDirectory("workspace-source");
    const workspaceBasePath = path.join(sourceRepositoryPath, ".agent-hub", "runs");
    const manager = new GitWorktreeWorkspaceManager(new MockShellExecutor());

    await expect(
      manager.createSession({
        sourceRepositoryPath,
        workspaceBasePath,
        taskId: "task_1",
        runId: "run_1",
        agentKind: "fake"
      })
    ).rejects.toThrow(WorkspaceError);
  });

  it("cleanup only targets workspace-owned paths", async () => {
    const sourceRepositoryPath = await createTestDirectory("workspace-source");
    const workspaceBasePath = await createTestDirectory("workspace-base");
    const shell = new MockShellExecutor();
    const manager = new GitWorktreeWorkspaceManager(shell);
    const session = await manager.createSession({
      sourceRepositoryPath,
      workspaceBasePath,
      taskId: "task_1",
      runId: "run_1",
      agentKind: "fake"
    });
    (session.workspace as { path: string }).path = sourceRepositoryPath;

    await expect(session.cleanup({ successful: true })).rejects.toThrow(
      WorkspaceError
    );
    expect(shell.calls).toHaveLength(3);
  });

  it("retain-on-failure does not clean up the workspace", async () => {
    const sourceRepositoryPath = await createTestDirectory("workspace-source");
    const workspaceBasePath = await createTestDirectory("workspace-base");
    const shell = new MockShellExecutor();
    const manager = new GitWorktreeWorkspaceManager(shell);
    const session = await manager.createSession({
      sourceRepositoryPath,
      workspaceBasePath,
      taskId: "task_1",
      runId: "run_1",
      agentKind: "fake",
      cleanupPolicy: "retain_on_failure"
    });

    const cleanup = await session.cleanup({ successful: false });

    expect(cleanup.retained).toBe(true);
    expect(cleanup.cleaned).toBe(false);
    expect(shell.calls).toHaveLength(3);
  });

  it("defaults to retaining workspaces instead of automatic cleanup", async () => {
    const sourceRepositoryPath = await createTestDirectory("workspace-source");
    const workspaceBasePath = await createTestDirectory("workspace-base");
    const shell = new MockShellExecutor();
    const manager = new GitWorktreeWorkspaceManager(shell);
    const session = await manager.createSession({
      sourceRepositoryPath,
      workspaceBasePath,
      taskId: "task_1",
      runId: "run_1",
      agentKind: "fake"
    });

    const cleanup = await session.cleanup({ successful: true });

    expect(session.workspace.cleanupPolicy).toBe("never");
    expect(cleanup.retained).toBe(true);
    expect(cleanup.cleaned).toBe(false);
    expect(shell.calls).toHaveLength(3);
  });

  it("uses on-success cleanup only when explicitly requested", async () => {
    const sourceRepositoryPath = await createTestDirectory("workspace-source");
    const workspaceBasePath = await createTestDirectory("workspace-base");
    const shell = new MockShellExecutor();
    const manager = new GitWorktreeWorkspaceManager(shell);
    const session = await manager.createSession({
      sourceRepositoryPath,
      workspaceBasePath,
      taskId: "task_1",
      runId: "run_1",
      agentKind: "fake",
      cleanupPolicy: "on_success"
    });

    const cleanup = await session.cleanup({ successful: true });

    expect(cleanup.cleaned).toBe(true);
    expect(shell.calls.at(-1)?.command.args?.join(" ")).toContain(
      "worktree remove"
    );
  });

  it("supports dry-run mode without cleanup commands", async () => {
    const sourceRepositoryPath = await createTestDirectory("workspace-source");
    const workspaceBasePath = await createTestDirectory("workspace-base");
    const shell = new MockShellExecutor();
    const manager = new GitWorktreeWorkspaceManager(shell);

    const session = await manager.createSession({
      sourceRepositoryPath,
      workspaceBasePath,
      taskId: "task_1",
      runId: "run_1",
      agentKind: "fake",
      dryRun: true
    });
    const cleanup = await session.cleanup({ successful: true });

    expect(shell.calls.every((call) => call.options.dryRun)).toBe(true);
    expect(cleanup.retained).toBe(true);
    expect(shell.calls).toHaveLength(3);
  });
});
