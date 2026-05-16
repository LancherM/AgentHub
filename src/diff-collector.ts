import path from "node:path";
import { isWorkspacePathInside } from "./workspace";
import { type ShellExecutor, type ShellResult } from "./shell-executor";

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
    if (!path.isAbsolute(input.workspacePath)) {
      throw new Error("diff collection workspace path must be absolute");
    }

    const commands: ShellResult[] = [];
    const statusResult = await this.shellExecutor.execute(
      { executable: "git", args: ["status", "--porcelain"] },
      { cwd: workspacePath, dryRun: input.dryRun }
    );
    commands.push(statusResult);
    if (statusResult.exitCode !== 0) {
      return failedDiffResult(workspacePath, commands, statusResult);
    }

    const statResult = await this.shellExecutor.execute(
      { executable: "git", args: ["diff", "--stat", "--shortstat"] },
      { cwd: workspacePath, dryRun: input.dryRun }
    );
    commands.push(statResult);
    if (statResult.exitCode !== 0) {
      return failedDiffResult(workspacePath, commands, statResult);
    }

    const numstatResult = await this.shellExecutor.execute(
      { executable: "git", args: ["diff", "--numstat"] },
      { cwd: workspacePath, dryRun: input.dryRun }
    );
    commands.push(numstatResult);
    if (numstatResult.exitCode !== 0) {
      return failedDiffResult(workspacePath, commands, numstatResult);
    }

    const diffResult = await this.shellExecutor.execute(
      { executable: "git", args: ["diff", "--"] },
      { cwd: workspacePath, dryRun: input.dryRun }
    );
    commands.push(diffResult);
    if (diffResult.exitCode !== 0) {
      return failedDiffResult(workspacePath, commands, diffResult);
    }

    const changedFiles = parsePorcelainStatus(statusResult.stdout)
      .filter((file) => !isExcludedPath(file.path, excludePathPrefixes))
      .sort((left, right) => left.path.localeCompare(right.path));
    const numericStats = parseNumstat(numstatResult.stdout);
    const stat = {
      ...parseShortStat(statResult.stdout),
      filesChanged: Math.max(
        parseShortStat(statResult.stdout).filesChanged,
        changedFiles.length
      ),
      text: statResult.stdout.trim()
    };
    const fileSummaries = changedFiles.map((file) =>
      summarizeFile(file, numericStats.get(file.path))
    );

    return {
      ok: true,
      workspacePath,
      isClean: changedFiles.length === 0,
      changedFiles,
      stat,
      diff: diffResult.stdout,
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

function parseShortStat(output: string): Omit<DiffStat, "text"> {
  const filesChanged = numberBefore(output, /(\d+)\s+files?\s+changed/);
  const insertions = numberBefore(output, /(\d+)\s+insertions?\(\+\)/);
  const deletions = numberBefore(output, /(\d+)\s+deletions?\(-\)/);
  return { filesChanged, insertions, deletions };
}

function parseNumstat(output: string): Map<string, { insertions: number; deletions: number }> {
  const stats = new Map<string, { insertions: number; deletions: number }>();
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
      deletions: numericStat(deletions)
    });
  }
  return stats;
}

function summarizeFile(
  file: ChangedFile,
  stats: { insertions: number; deletions: number } | undefined
): string {
  if (!stats) {
    return `${file.path}: ${file.status}`;
  }
  return `${file.path}: ${file.status}, +${stats.insertions}/-${stats.deletions}`;
}

function numberBefore(output: string, pattern: RegExp): number {
  const match = output.match(pattern);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function numericStat(value: string): number {
  return /^\d+$/.test(value) ? Number.parseInt(value, 10) : 0;
}

function isExcludedPath(filePath: string, excludePathPrefixes: string[]): boolean {
  return excludePathPrefixes.some((prefix) => {
    const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
    return filePath === prefix || filePath.startsWith(normalizedPrefix);
  });
}

export function assertDiffWorkspaceInside(
  workspacePath: string,
  workspaceBasePath: string
): void {
  if (!isWorkspacePathInside(workspacePath, workspaceBasePath)) {
    throw new Error("diff workspace path must stay inside workspace base path");
  }
}
