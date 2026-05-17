import path from "node:path";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { isWorkspacePathInside } from "./workspace";
import { type ShellExecutor, type ShellResult } from "./shell-executor";
import {
  assertSafeLocalGitConfig,
  safeGitCommand,
  safeGitExecutionOptions
} from "./git-safety";

const MAX_UNTRACKED_DIFF_BYTES = 1024 * 1024;

export type ChangedFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "unknown";

export interface ChangedFile {
  path: string;
  status: ChangedFileStatus;
  binary?: boolean;
  sizeBytes?: number;
  symlinkTarget?: string;
  omittedReason?: string;
}

export interface DiffStat {
  filesChanged: number;
  insertions: number;
  deletions: number;
  text: string;
}

export interface DiffCollectionInput {
  workspacePath: string;
  excludePathPrefixes?: string[];
  generatedFileBaselines?: Array<{ path: string; sha256: string }>;
  dryRun?: boolean;
}

export interface DiffCollectionResult {
  ok: boolean;
  workspacePath: string;
  isClean: boolean;
  changedFiles: ChangedFile[];
  stat: DiffStat;
  diff: string;
  fileSummaries: string[];
  commands: ShellResult[];
  error?: string;
}

export interface DiffCollectorService {
  collect(input: DiffCollectionInput): Promise<DiffCollectionResult>;
}

export class DiffCollector implements DiffCollectorService {
  constructor(private readonly shellExecutor: ShellExecutor) {}

  async collect(input: DiffCollectionInput): Promise<DiffCollectionResult> {
    const workspacePath = path.resolve(input.workspacePath);
    const excludePathPrefixes = input.excludePathPrefixes ?? [".agent-hub/"];
    const generatedBaselines = new Map(
      (input.generatedFileBaselines ?? []).map((entry) => [
        normalizeRelativePath(entry.path),
        entry.sha256
      ])
    );
    if (!path.isAbsolute(input.workspacePath)) {
      throw new Error("diff collection workspace path must be absolute");
    }

    if (!input.dryRun) {
      await assertSafeLocalGitConfig(workspacePath);
    }

    const commands: ShellResult[] = [];
    const statusResult = await this.shellExecutor.execute(
      safeGitCommand(["status", "--porcelain"]),
      safeGitExecutionOptions({ cwd: workspacePath, dryRun: input.dryRun })
    );
    commands.push(statusResult);
    if (statusResult.exitCode !== 0) {
      return failedDiffResult(workspacePath, commands, statusResult);
    }

    const statResult = await this.shellExecutor.execute(
      safeGitCommand([
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--stat",
        "--shortstat",
        "HEAD",
        "--"
      ]),
      safeGitExecutionOptions({ cwd: workspacePath, dryRun: input.dryRun })
    );
    commands.push(statResult);
    if (statResult.exitCode !== 0) {
      return failedDiffResult(workspacePath, commands, statResult);
    }

    const numstatResult = await this.shellExecutor.execute(
      safeGitCommand([
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--numstat",
        "HEAD",
        "--"
      ]),
      safeGitExecutionOptions({ cwd: workspacePath, dryRun: input.dryRun })
    );
    commands.push(numstatResult);
    if (numstatResult.exitCode !== 0) {
      return failedDiffResult(workspacePath, commands, numstatResult);
    }

    const numericStats = parseNumstat(numstatResult.stdout);
    const allChangedFiles = await enrichChangedFiles(
      parsePorcelainStatus(statusResult.stdout),
      numericStats,
      workspacePath
    );
    const changedFiles = (
      await filterGeneratedAndExcludedFiles(
        allChangedFiles,
        workspacePath,
        excludePathPrefixes,
        generatedBaselines
      )
    )
      .sort((left, right) => left.path.localeCompare(right.path));
    const trackedDiffPaths = changedFiles
      .filter((file) => file.status !== "untracked")
      .map((file) => file.path);
    const cachedDiffResult =
      trackedDiffPaths.length > 0
        ? await this.shellExecutor.execute(
            safeGitCommand([
              "diff",
              "--no-ext-diff",
              "--no-textconv",
              "--cached",
              "--",
              ...trackedDiffPaths
            ]),
            safeGitExecutionOptions({ cwd: workspacePath, dryRun: input.dryRun })
          )
        : undefined;
    if (cachedDiffResult) {
      commands.push(cachedDiffResult);
      if (cachedDiffResult.exitCode !== 0) {
        return failedDiffResult(workspacePath, commands, cachedDiffResult);
      }
    }

    const unstagedDiffResult =
      trackedDiffPaths.length > 0
        ? await this.shellExecutor.execute(
            safeGitCommand([
              "diff",
              "--no-ext-diff",
              "--no-textconv",
              "--",
              ...trackedDiffPaths
            ]),
            safeGitExecutionOptions({ cwd: workspacePath, dryRun: input.dryRun })
          )
        : undefined;
    if (unstagedDiffResult) {
      commands.push(unstagedDiffResult);
      if (unstagedDiffResult.exitCode !== 0) {
        return failedDiffResult(workspacePath, commands, unstagedDiffResult);
      }
    }

    const untrackedDiff = await buildUntrackedDiff(workspacePath, changedFiles);
    const fileSummaries = changedFiles.map((file) =>
      summarizeFile(file, numericStats.get(file.path) ?? untrackedDiff.stats.get(file.path))
    );
    const stat = summarizeChangedFiles(changedFiles, numericStats, untrackedDiff.stats);

    return {
      ok: true,
      workspacePath,
      isClean: changedFiles.length === 0,
      changedFiles,
      stat,
      diff: [
        cachedDiffResult?.stdout ?? "",
        unstagedDiffResult?.stdout ?? "",
        untrackedDiff.text
      ].filter((entry) => entry.trim().length > 0).join("\n"),
      fileSummaries,
      commands
    };
  }
}

function failedDiffResult(
  workspacePath: string,
  commands: ShellResult[],
  failedResult: ShellResult
): DiffCollectionResult {
  return {
    ok: false,
    workspacePath,
    isClean: false,
    changedFiles: [],
    stat: { filesChanged: 0, insertions: 0, deletions: 0, text: "" },
    diff: "",
    fileSummaries: [],
    commands,
    error:
      failedResult.stderr.trim() ||
      failedResult.stdout.trim() ||
      failedResult.error ||
      "git diff collection failed"
  };
}

function parsePorcelainStatus(output: string): ChangedFile[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const code = line.slice(0, 2);
      const rawPath = line.slice(3);
      return {
        path: normalizePorcelainPath(rawPath),
        status: mapStatus(code)
      };
    });
}

function normalizePorcelainPath(rawPath: string): string {
  const renameSeparator = " -> ";
  const pathText = rawPath.includes(renameSeparator)
    ? rawPath.split(renameSeparator).at(-1) ?? rawPath
    : rawPath;
  return pathText.replace(/^"|"$/g, "");
}

function mapStatus(code: string): ChangedFileStatus {
  if (code === "??") {
    return "untracked";
  }
  if (code.includes("R")) {
    return "renamed";
  }
  if (code.includes("C")) {
    return "copied";
  }
  if (code.includes("A")) {
    return "added";
  }
  if (code.includes("D")) {
    return "deleted";
  }
  if (code.includes("M")) {
    return "modified";
  }
  return "unknown";
}

function parseNumstat(output: string): Map<string, { insertions: number; deletions: number; binary?: boolean }> {
  const stats = new Map<string, { insertions: number; deletions: number; binary?: boolean }>();
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const [insertions, deletions, filePath] = line.split(/\t/);
    if (!filePath) {
      continue;
    }
    stats.set(filePath, {
      insertions: numericStat(insertions),
      deletions: numericStat(deletions),
      binary: insertions === "-" || deletions === "-"
    });
  }
  return stats;
}

function summarizeFile(
  file: ChangedFile,
  stats: { insertions: number; deletions: number } | undefined
): string {
  if (file.symlinkTarget !== undefined) {
    return `${file.path}: ${file.status}, symlink -> ${file.symlinkTarget}`;
  }
  if (file.omittedReason) {
    return `${file.path}: ${file.status}, content omitted (${file.omittedReason})`;
  }
  if (file.binary) {
    return `${file.path}: ${file.status}, binary${file.sizeBytes !== undefined ? `, ${file.sizeBytes} bytes` : ""}`;
  }
  if (!stats) {
    return `${file.path}: ${file.status}`;
  }
  return `${file.path}: ${file.status}, +${stats.insertions}/-${stats.deletions}`;
}

function numericStat(value: string): number {
  return /^\d+$/.test(value) ? Number.parseInt(value, 10) : 0;
}

async function enrichChangedFiles(
  files: ChangedFile[],
  numericStats: Map<string, { insertions: number; deletions: number; binary?: boolean }>,
  workspacePath: string
): Promise<ChangedFile[]> {
  const enriched: ChangedFile[] = [];
  for (const file of files) {
    const inspected = await inspectWorktreeFile(workspacePath, file.path);
    const stats = numericStats.get(file.path);
    const binary = stats?.binary || inspected.binary;
    const omittedReason =
      inspected.omittedReason ??
      (inspected.sizeBytes !== undefined && inspected.sizeBytes > MAX_UNTRACKED_DIFF_BYTES
        ? `larger than ${MAX_UNTRACKED_DIFF_BYTES} bytes`
        : undefined);
    enriched.push({
      ...file,
      binary: binary || undefined,
      sizeBytes: binary || omittedReason ? inspected.sizeBytes : undefined,
      symlinkTarget: inspected.symlinkTarget,
      omittedReason
    });
  }
  return enriched;
}

async function filterGeneratedAndExcludedFiles(
  files: ChangedFile[],
  workspacePath: string,
  excludePathPrefixes: string[],
  generatedBaselines: Map<string, string>
): Promise<ChangedFile[]> {
  const result: ChangedFile[] = [];
  for (const file of files) {
    const normalizedPath = normalizeRelativePath(file.path);
    const baseline = generatedBaselines.get(normalizedPath);
    if (baseline !== undefined) {
      const currentHash = await hashFileIfExists(workspacePath, normalizedPath);
      if (currentHash === baseline) {
        continue;
      }
      result.push(file);
      continue;
    }
    if (isExcludedPath(normalizedPath, excludePathPrefixes)) {
      continue;
    }
    result.push(file);
  }
  return result;
}

async function buildUntrackedDiff(
  workspacePath: string,
  changedFiles: ChangedFile[]
): Promise<{
  text: string;
  stats: Map<string, { insertions: number; deletions: number }>;
}> {
  const chunks: string[] = [];
  const stats = new Map<string, { insertions: number; deletions: number }>();
  for (const file of changedFiles.filter((entry) => entry.status === "untracked")) {
    if (file.symlinkTarget !== undefined) {
      chunks.push(`Untracked symlink ${file.path} -> ${file.symlinkTarget} added`);
      stats.set(file.path, { insertions: 0, deletions: 0 });
      continue;
    }
    if (file.omittedReason) {
      chunks.push(`Untracked file ${file.path} added (${file.omittedReason}; content omitted)`);
      stats.set(file.path, { insertions: 0, deletions: 0 });
      continue;
    }
    if (file.binary) {
      chunks.push(`Binary file ${file.path} added (${file.sizeBytes ?? 0} bytes)`);
      stats.set(file.path, { insertions: 0, deletions: 0 });
      continue;
    }
    try {
      const absolutePath = await safeReadablePath(workspacePath, file.path);
      const content = await fs.readFile(absolutePath, "utf8");
      const contentLines = content.split(/\r?\n/).filter((line, index, lines) =>
        index < lines.length - 1 || line.length > 0
      );
      stats.set(file.path, { insertions: contentLines.length, deletions: 0 });
      chunks.push(
        [
          `diff --git a/${file.path} b/${file.path}`,
          "new file mode 100644",
          "--- /dev/null",
          `+++ b/${file.path}`,
          ...contentLines.map((line) => `+${line}`)
        ].join("\n")
      );
    } catch {
      chunks.push(`Untracked file ${file.path} added`);
      stats.set(file.path, { insertions: 0, deletions: 0 });
    }
  }
  return { text: chunks.join("\n"), stats };
}

function summarizeChangedFiles(
  changedFiles: ChangedFile[],
  numericStats: Map<string, { insertions: number; deletions: number; binary?: boolean }>,
  untrackedStats: Map<string, { insertions: number; deletions: number }>
): DiffStat {
  let insertions = 0;
  let deletions = 0;
  for (const file of changedFiles) {
    const stats = numericStats.get(file.path) ?? untrackedStats.get(file.path);
    insertions += stats?.insertions ?? 0;
    deletions += stats?.deletions ?? 0;
  }
  const text =
    changedFiles.length === 0
      ? ""
      : `${changedFiles.length} ${changedFiles.length === 1 ? "file" : "files"} changed` +
        (insertions > 0 ? `, ${insertions} ${insertions === 1 ? "insertion" : "insertions"}(+)` : "") +
        (deletions > 0 ? `, ${deletions} ${deletions === 1 ? "deletion" : "deletions"}(-)` : "");
  return {
    filesChanged: changedFiles.length,
    insertions,
    deletions,
    text
  };
}

async function hashFileIfExists(workspacePath: string, relativePath: string): Promise<string | undefined> {
  try {
    const filePath = resolveWorkspacePath(workspacePath, relativePath);
    const stats = await fs.lstat(filePath);
    if (stats.isSymbolicLink()) {
      return undefined;
    }
    return createHash("sha256")
      .update(await fs.readFile(await safeReadablePath(workspacePath, relativePath)))
      .digest("hex");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function inspectWorktreeFile(
  workspacePath: string,
  relativePath: string
): Promise<{
  binary: boolean;
  sizeBytes?: number;
  symlinkTarget?: string;
  omittedReason?: string;
}> {
  try {
    const absolutePath = resolveWorkspacePath(workspacePath, relativePath);
    const stats = await fs.lstat(absolutePath);
    if (stats.isSymbolicLink()) {
      return {
        binary: false,
        symlinkTarget: await fs.readlink(absolutePath)
      };
    }
    if (!stats.isFile()) {
      return { binary: false, sizeBytes: stats.size };
    }
    if (stats.size > MAX_UNTRACKED_DIFF_BYTES) {
      return {
        binary: false,
        sizeBytes: stats.size,
        omittedReason: `larger than ${MAX_UNTRACKED_DIFF_BYTES} bytes`
      };
    }
    const safePath = await safeReadablePath(workspacePath, relativePath);
    return {
      binary: await isBinaryFile(safePath),
      sizeBytes: stats.size
    };
  } catch {
    return { binary: false };
  }
}

async function safeReadablePath(workspacePath: string, relativePath: string): Promise<string> {
  return realpathInside(workspacePath, resolveWorkspacePath(workspacePath, relativePath));
}

function resolveWorkspacePath(workspacePath: string, relativePath: string): string {
  const resolvedWorkspace = path.resolve(workspacePath);
  const resolvedCandidate = path.resolve(resolvedWorkspace, relativePath);
  if (!isPathInsideOrEqual(resolvedCandidate, resolvedWorkspace)) {
    throw new Error("diff file path must stay inside the workspace");
  }
  return resolvedCandidate;
}

async function realpathInside(basePath: string, candidatePath: string): Promise<string> {
  const resolvedBase = await fs.realpath(basePath);
  const resolvedCandidate = await fs.realpath(candidatePath);
  if (!isPathInsideOrEqual(resolvedCandidate, resolvedBase)) {
    throw new Error("diff file path must stay inside the workspace");
  }
  return resolvedCandidate;
}

async function isBinaryFile(filePath: string): Promise<boolean> {
  try {
    const handle = await fs.open(filePath, "r");
    try {
      const buffer = Buffer.alloc(512);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return buffer.subarray(0, bytesRead).includes(0);
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

function isPathInsideOrEqual(candidatePath: string, basePath: string): boolean {
  const relative = path.relative(basePath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isExcludedPath(filePath: string, excludePathPrefixes: string[]): boolean {
  return excludePathPrefixes.some((prefix) => {
    const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
    return filePath === prefix || filePath.startsWith(normalizedPrefix);
  });
}

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join("/");
}

export function assertDiffWorkspaceInside(
  workspacePath: string,
  workspaceBasePath: string
): void {
  if (!isWorkspacePathInside(workspacePath, workspaceBasePath)) {
    throw new Error("diff workspace path must stay inside workspace base path");
  }
}
