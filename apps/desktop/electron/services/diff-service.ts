import fs from "node:fs/promises";
import path from "node:path";
import {
  DiffCollector,
  NodeShellExecutor,
  isWorkspacePathInside,
  type ChangedFile as CollectedChangedFile,
  type DiffCollectionResult
} from "@agent-hub/task-runner";
import type {
  RunArtifact,
  RunArtifactRepository,
  RunMetadataRepository,
  TaskRun,
  TaskRunRepository
} from "@agent-hub/core";
import type { DiffSummary, ChangedFile } from "../../src/lib/types";
import type { DesktopServiceContext } from "./project-service";

const MAX_PATCH_CHARS = 120_000;

export interface DiffService {
  getDiff(runId: string): Promise<DiffSummary>;
}

export function createDiffService(context: DesktopServiceContext): DiffService {
  return new RepositoryDiffService({
    taskRunRepository: context.repositories.taskRunRepository,
    runArtifactRepository: context.repositories.runArtifactRepository,
    runMetadataRepository: context.repositories.runMetadataRepository
  });
}

class RepositoryDiffService implements DiffService {
  private readonly collector = new DiffCollector(new NodeShellExecutor());

  constructor(
    private readonly repositories: {
      taskRunRepository: TaskRunRepository;
      runArtifactRepository: RunArtifactRepository;
      runMetadataRepository: RunMetadataRepository;
    }
  ) {}

  async getDiff(runId: string): Promise<DiffSummary> {
    const run = await requireRun(this.repositories.taskRunRepository, runId);
    const metadata = await this.repositories.runMetadataRepository.get(runId);
    if (run.worktreePath && await directoryExists(run.worktreePath)) {
      const validationMessage = validateWorktreePath(run, metadata?.workspace);
      if (validationMessage) {
        return emptyDiff(runId, validationMessage);
      }
      try {
        const collected = await this.collector.collect({
          workspacePath: run.worktreePath
        });
        if (!collected.ok) {
          return emptyDiff(
            runId,
            `Unable to read worktree diff: ${collected.error ?? "git diff failed"}`
          );
        }
        return fromCollectedDiff(runId, collected, {
          baseRef: "HEAD",
          headRef: run.branchName
        });
      } catch (error) {
        return emptyDiff(runId, `Unable to read worktree diff: ${errorMessage(error)}`);
      }
    }

    if (metadata?.diff) {
      return fromCollectedDiff(runId, metadata.diff, {
        baseRef: "HEAD",
        headRef: run.branchName
      });
    }

    const artifact =
      await this.repositories.runArtifactRepository.getLatestByRunIdAndKind(
        runId,
        "git_diff"
      );
    if (artifact) {
      return fromArtifact(runId, run, artifact);
    }

    return emptyDiff(runId, noWorktreeMessage(run));
  }
}

async function requireRun(
  repository: TaskRunRepository,
  runId: string
): Promise<TaskRun> {
  const run = await repository.get(runId);
  if (!run) {
    throw new Error(`run ${runId} not found`);
  }
  return run;
}

function validateWorktreePath(
  run: TaskRun,
  workspace: { workspaceBasePath?: string; path?: string } | undefined
): string | undefined {
  const worktreePath = run.worktreePath;
  if (!worktreePath || !path.isAbsolute(worktreePath)) {
    return "Run has no absolute retained worktree path.";
  }
  if (workspace?.path && path.resolve(worktreePath) !== path.resolve(workspace.path)) {
    return "Run worktree metadata does not match the retained worktree path.";
  }
  if (
    workspace?.workspaceBasePath &&
    !isWorkspacePathInside(worktreePath, workspace.workspaceBasePath)
  ) {
    return "Run worktree path is outside the recorded Agent Hub workspace base.";
  }
  return undefined;
}

function fromCollectedDiff(
  runId: string,
  diff: DiffCollectionResult,
  refs: { baseRef?: string; headRef?: string }
): DiffSummary {
  const summaryByPath = new Map(
    diff.fileSummaries.map((summary) => [pathFromSummary(summary), summary])
  );
  const files = diff.changedFiles.map((file) =>
    fromCollectedFile(file, summaryByPath.get(file.path))
  );
  const patch = preparePatch(diff.diff, files.map((file) => file.path));
  const message =
    files.length === 0
      ? "No real repository files were modified."
      : diff.error;
  return {
    runId,
    baseRef: refs.baseRef,
    headRef: refs.headRef,
    files,
    patch: patch.value,
    empty: files.length === 0 && patch.value.trim().length === 0,
    message,
    truncated: patch.truncated,
    originalPatchBytes: diff.diff.length,
    patchBytes: patch.value.length
  };
}

function fromArtifact(
  runId: string,
  run: TaskRun,
  artifact: RunArtifact
): DiffSummary {
  const metadata = artifact.metadata;
  const summaries = stringArray(metadata.fileSummaries) ?? [];
  const files = changedFiles(metadata.changedFiles, summaries);
  const patch = preparePatch(artifact.content, files.map((file) => file.path));
  const source = typeof metadata.source === "string" ? metadata.source : undefined;
  const placeholder = metadata.placeholder === true;
  const message =
    placeholder && source === "desktop_fake_run" && run.agentKind === "fake"
      ? "No real repository files were modified in fake mode."
      : placeholder
        ? "No real repository files were modified."
        : files.length === 0
          ? noWorktreeMessage(run)
          : undefined;
  return {
    runId,
    baseRef: "HEAD",
    headRef: run.branchName,
    files,
    patch: placeholder ? "" : patch.value,
    empty: files.length === 0 && (placeholder || patch.value.trim().length === 0),
    message,
    truncated: placeholder ? false : patch.truncated,
    originalPatchBytes: artifact.content.length,
    patchBytes: placeholder ? 0 : patch.value.length
  };
}

function changedFiles(value: unknown, summaries: string[]): ChangedFile[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry, index) => {
    if (typeof entry === "string") {
      return [changedFileFromParts(entry, "unknown", summaries[index])];
    }
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const filePath = typeof record.path === "string" ? record.path : undefined;
    if (!filePath) {
      return [];
    }
    return [
      changedFileFromParts(
        filePath,
        mapChangedFileStatus(record.status),
        summaries.find((summary) => pathFromSummary(summary) === filePath)
      )
    ];
  });
}

function fromCollectedFile(
  file: CollectedChangedFile,
  summary: string | undefined
): ChangedFile {
  return changedFileFromParts(file.path, mapChangedFileStatus(file.status), summary);
}

function changedFileFromParts(
  filePath: string,
  status: ChangedFile["status"],
  summary: string | undefined
): ChangedFile {
  const stats = statsFromSummary(summary);
  return {
    path: filePath,
    status,
    additions: stats.additions,
    deletions: stats.deletions,
    isGenerated: isGeneratedPath(filePath),
    isTest: isTestPath(filePath),
    isConfig: isConfigPath(filePath),
    isMigration: isMigrationPath(filePath)
  };
}

function mapChangedFileStatus(value: unknown): ChangedFile["status"] {
  switch (value) {
    case "added":
    case "untracked":
    case "copied":
      return "added";
    case "modified":
      return "modified";
    case "deleted":
      return "deleted";
    case "renamed":
      return "renamed";
    default:
      return "unknown";
  }
}

function pathFromSummary(summary: string): string {
  return summary.split(": ", 1)[0] ?? summary;
}

function statsFromSummary(
  summary: string | undefined
): { additions: number; deletions: number } {
  if (!summary) {
    return { additions: 0, deletions: 0 };
  }
  const match = summary.match(/\+(\d+)\/-(\d+)/);
  return {
    additions: match ? Number.parseInt(match[1], 10) : 0,
    deletions: match ? Number.parseInt(match[2], 10) : 0
  };
}

function truncatePatch(value: string): { value: string; truncated: boolean } {
  if (value.length <= MAX_PATCH_CHARS) {
    return { value, truncated: false };
  }
  return {
    value: `${value.slice(0, MAX_PATCH_CHARS)}\n\n[Diff truncated after ${MAX_PATCH_CHARS} characters.]`,
    truncated: true
  };
}

function preparePatch(
  value: string,
  changedPaths: string[]
): { value: string; truncated: boolean } {
  const sensitivePaths = sensitivePatchPaths(value, changedPaths);
  if (sensitivePaths.length > 0) {
    return {
      value: `Patch redacted because sensitive file path changed: ${sensitivePaths.join(", ")}`,
      truncated: false
    };
  }
  return truncatePatch(value);
}

function sensitivePatchPaths(patch: string, changedPaths: string[]): string[] {
  const paths = new Set<string>();
  for (const filePath of changedPaths) {
    if (isSensitiveFilePath(filePath)) {
      paths.add(filePath);
    }
  }

  for (const line of patch.split(/\r?\n/)) {
    const pathFromHeader = diffPathFromHeader(line);
    if (pathFromHeader && isSensitiveFilePath(pathFromHeader)) {
      paths.add(pathFromHeader);
    }
  }

  return [...paths].sort();
}

function diffPathFromHeader(line: string): string | undefined {
  const gitMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
  if (gitMatch) {
    return gitMatch[2];
  }
  const markerMatch = line.match(/^(?:---|\+\+\+) [ab]\/(.+)$/);
  return markerMatch?.[1];
}

function isSensitiveFilePath(filePath: string): boolean {
  return /(^|\/)\.env(?:\.|$)/i.test(filePath) ||
    /\.pem$/i.test(filePath) ||
    /\.key$/i.test(filePath) ||
    /(^|\/)id_rsa$/i.test(filePath) ||
    /(^|\/)id_ed25519$/i.test(filePath) ||
    /(^|\/)secrets?\./i.test(filePath) ||
    /(^|\/)credentials?\./i.test(filePath) ||
    /(^|\/)tokens?\./i.test(filePath);
}

function emptyDiff(runId: string, message: string): DiffSummary {
  return {
    runId,
    files: [],
    patch: "",
    empty: true,
    message,
    truncated: false,
    originalPatchBytes: 0,
    patchBytes: 0
  };
}

async function directoryExists(directoryPath: string): Promise<boolean> {
  try {
    return (await fs.stat(directoryPath)).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function noWorktreeMessage(run: TaskRun): string {
  return run.agentKind === "fake"
    ? "No real repository files were modified in fake mode."
    : "No retained worktree or persisted real diff is available for this run.";
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    return undefined;
  }
  return value;
}

function isGeneratedPath(filePath: string): boolean {
  return /(^|\/)(dist|build|coverage|generated|__generated__)\//.test(filePath);
}

function isTestPath(filePath: string): boolean {
  return /(^|\/)(__tests__|tests?)\//.test(filePath) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(filePath);
}

function isConfigPath(filePath: string): boolean {
  return /(^|\/)(package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|tsconfig[^/]*\.json|vite\.config\.[jt]s|electron\.vite\.config\.ts|\.github\/workflows\/)/.test(filePath);
}

function isMigrationPath(filePath: string): boolean {
  return /(^|\/)(migrations?|schema|db)\//i.test(filePath) || /migration/i.test(filePath);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
