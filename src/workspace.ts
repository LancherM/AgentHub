import fs from "node:fs/promises";
import path from "node:path";
import type { AgentKind } from "./domain";
import {
  formatShellCommand,
  type ShellExecutor,
  type ShellResult
} from "./shell-executor";
import {
  assertSafeLocalGitConfig,
  safeGitCommand,
  safeGitExecutionOptions
} from "./git-safety";

export type WorkspaceCleanupPolicy =
  | "always"
  | "on_success"
  | "retain_on_failure"
  | "never";

export interface WorkspaceConfig {
  sourceRepositoryPath: string;
  workspaceBasePath: string;
  taskId: string;
  runId: string;
  agentKind: AgentKind;
  cleanupPolicy?: WorkspaceCleanupPolicy;
  dryRun?: boolean;
}

export interface Workspace {
  path: string;
  branchName: string;
  sourceRepositoryPath: string;
  workspaceBasePath: string;
  taskId: string;
  runId: string;
  agentKind: AgentKind;
  dryRun: boolean;
  sourceRepositoryDirty: boolean;
  cleanupPolicy: WorkspaceCleanupPolicy;
}

export interface WorkspaceCleanupInput {
  successful: boolean;
}

export interface WorkspaceCleanupResult {
  cleaned: boolean;
  retained: boolean;
  reason: string;
  commands: ShellResult[];
}

export interface WorkspaceSession {
  workspace: Workspace;
  creationCommands: ShellResult[];
  cleanup(input: WorkspaceCleanupInput): Promise<WorkspaceCleanupResult>;
}

export interface WorkspaceManager {
  createSession(config: WorkspaceConfig): Promise<WorkspaceSession>;
}

export class WorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceError";
  }
}

export class GitWorktreeWorkspaceManager implements WorkspaceManager {
  constructor(private readonly shellExecutor: ShellExecutor) {}

  async createSession(config: WorkspaceConfig): Promise<WorkspaceSession> {
    const normalized = normalizeWorkspaceConfig(config);
    const workspacePath = buildWorkspacePath(normalized);
    const branchName = buildBranchName(normalized.taskId, normalized.agentKind);
    const creationCommands: ShellResult[] = [];

    if (!normalized.dryRun) {
      await fs.mkdir(path.dirname(workspacePath), { recursive: true });
      if (await pathExists(workspacePath)) {
        throw new WorkspaceError(`worktree path already exists: ${workspacePath}`);
      }
    }

    if (!normalized.dryRun) {
      await assertSafeLocalGitConfig(normalized.sourceRepositoryPath);
    }

    const insideCheck = await this.shellExecutor.execute(
      safeGitCommand(["rev-parse", "--is-inside-work-tree"]),
      safeGitExecutionOptions({
        cwd: normalized.sourceRepositoryPath,
        dryRun: normalized.dryRun
      })
    );
    creationCommands.push(insideCheck);
    ensureCommandSucceeded(insideCheck, "validate source repository");

    const statusResult = await this.shellExecutor.execute(
      safeGitCommand(["status", "--porcelain"]),
      safeGitExecutionOptions({
        cwd: normalized.sourceRepositoryPath,
        dryRun: normalized.dryRun
      })
    );
    creationCommands.push(statusResult);
    ensureCommandSucceeded(statusResult, "check source repository status");
    const sourceRepositoryDirty = statusResult.stdout.trim().length > 0;

    if (!normalized.dryRun) {
      const branchCheck = await this.shellExecutor.execute(
        safeGitCommand([
          "show-ref",
          "--verify",
          "--quiet",
          `refs/heads/${branchName}`
        ]),
        safeGitExecutionOptions({ cwd: normalized.sourceRepositoryPath })
      );
      creationCommands.push(branchCheck);
      if (branchCheck.exitCode === 0) {
        throw new WorkspaceError(`worktree branch already exists: ${branchName}`);
      }
      if (branchCheck.exitCode !== 1) {
        ensureCommandSucceeded(branchCheck, "check worktree branch availability");
      }
    }

    const addResult = await this.shellExecutor.execute(
      safeGitCommand(["worktree", "add", "-b", branchName, workspacePath, "HEAD"]),
      safeGitExecutionOptions({
        cwd: normalized.sourceRepositoryPath,
        dryRun: normalized.dryRun
      })
    );
    creationCommands.push(addResult);
    ensureCommandSucceeded(addResult, "create git worktree");

    const workspace: Workspace = {
      path: workspacePath,
      branchName,
      sourceRepositoryPath: normalized.sourceRepositoryPath,
      workspaceBasePath: normalized.workspaceBasePath,
      taskId: normalized.taskId,
      runId: normalized.runId,
      agentKind: normalized.agentKind,
      dryRun: normalized.dryRun,
      sourceRepositoryDirty,
      cleanupPolicy: normalized.cleanupPolicy
    };

    return new GitWorktreeWorkspaceSession(
      workspace,
      creationCommands,
      normalized.cleanupPolicy,
      this.shellExecutor
    );
  }
}

class GitWorktreeWorkspaceSession implements WorkspaceSession {
  constructor(
    readonly workspace: Workspace,
    readonly creationCommands: ShellResult[],
    private readonly cleanupPolicy: WorkspaceCleanupPolicy,
    private readonly shellExecutor: ShellExecutor
  ) {}

  async cleanup(input: WorkspaceCleanupInput): Promise<WorkspaceCleanupResult> {
    assertWorkspacePathOwned(this.workspace.path, this.workspace.workspaceBasePath);

    if (this.workspace.dryRun) {
      return {
        cleaned: false,
        retained: true,
        reason: "dry-run workspace was not created",
        commands: []
      };
    }

    if (this.cleanupPolicy === "never") {
      return {
        cleaned: false,
        retained: true,
        reason: "cleanup policy retains workspaces",
        commands: []
      };
    }

    if (this.cleanupPolicy === "retain_on_failure" && !input.successful) {
      return {
        cleaned: false,
        retained: true,
        reason: "retain-on-failure policy retained the workspace",
        commands: []
      };
    }

    if (this.cleanupPolicy === "on_success" && !input.successful) {
      return {
        cleaned: false,
        retained: true,
        reason: "on-success cleanup policy retained a failed workspace",
        commands: []
      };
    }

    await assertSafeLocalGitConfig(this.workspace.sourceRepositoryPath);
    const removeResult = await this.shellExecutor.execute(
      safeGitCommand(["worktree", "remove", "--force", this.workspace.path]),
      safeGitExecutionOptions({ cwd: this.workspace.sourceRepositoryPath })
    );
    ensureCommandSucceeded(removeResult, "remove git worktree");
    return {
      cleaned: true,
      retained: false,
      reason: "workspace cleaned up",
      commands: [removeResult]
    };
  }
}

interface NormalizedWorkspaceConfig extends WorkspaceConfig {
  cleanupPolicy: WorkspaceCleanupPolicy;
  dryRun: boolean;
}

function normalizeWorkspaceConfig(config: WorkspaceConfig): NormalizedWorkspaceConfig {
  const sourceRepositoryPath = path.resolve(config.sourceRepositoryPath);
  const workspaceBasePath = path.resolve(config.workspaceBasePath);

  if (!path.isAbsolute(config.sourceRepositoryPath)) {
    throw new WorkspaceError("source repository path must be absolute");
  }
  if (!path.isAbsolute(config.workspaceBasePath)) {
    throw new WorkspaceError("workspace base path must be absolute");
  }
  if (isWorkspacePathInside(workspaceBasePath, sourceRepositoryPath)) {
    throw new WorkspaceError(
      "workspace base path must not be inside the source repository"
    );
  }

  return {
    ...config,
    sourceRepositoryPath,
    workspaceBasePath,
    cleanupPolicy: config.cleanupPolicy ?? "never",
    dryRun: config.dryRun ?? false
  };
}

function buildWorkspacePath(config: NormalizedWorkspaceConfig): string {
  const repositoryName = sanitizePathSegment(path.basename(config.sourceRepositoryPath));
  const workspaceName = [
    sanitizePathSegment(config.taskId),
    sanitizePathSegment(config.agentKind),
    sanitizePathSegment(config.runId)
  ].join("-");
  const workspacePath = path.join(config.workspaceBasePath, repositoryName, workspaceName);
  assertWorkspacePathOwned(workspacePath, config.workspaceBasePath);
  return workspacePath;
}

function buildBranchName(taskId: string, agentKind: AgentKind): string {
  return `agent-hub/${sanitizeBranchSegment(taskId)}/${sanitizeBranchSegment(agentKind)}`;
}

function ensureCommandSucceeded(result: ShellResult, action: string): void {
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || result.error;
    throw new WorkspaceError(
      `${action} failed: ${detail ?? formatShellCommand(result.command)}`
    );
  }
}

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await fs.lstat(candidatePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export function assertWorkspacePathOwned(
  workspacePath: string,
  workspaceBasePath: string
): void {
  const resolvedWorkspacePath = path.resolve(workspacePath);
  const resolvedBasePath = path.resolve(workspaceBasePath);
  if (
    resolvedWorkspacePath === resolvedBasePath ||
    !isWorkspacePathInside(resolvedWorkspacePath, resolvedBasePath)
  ) {
    throw new WorkspaceError("workspace path is outside the configured workspace base");
  }
}

export function isWorkspacePathInside(
  candidatePath: string,
  parentPath: string
): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return (
    relative === "" ||
    (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function sanitizePathSegment(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized.length > 0 ? sanitized : "workspace";
}

function sanitizeBranchSegment(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized.length > 0 ? sanitized : "run";
}
