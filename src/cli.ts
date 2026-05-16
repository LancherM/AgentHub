#!/usr/bin/env node
import path from "node:path";
import { parseAgentPrompt } from "./agent-parser";
import { TaskRunner, type TaskRunnerDependencies } from "./task-runner";
import { createSqliteRepositories } from "./sqlite-storage";
import {
  InMemoryRunMetadataRepository,
  InMemoryTaskRepository,
  InMemoryTaskRunRepository,
  type RunMetadataRepository,
  type TaskRepository,
  type TaskRunRepository
} from "./storage";

export interface CliIO {
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
}

export interface CliRuntime {
  taskRepository: TaskRepository;
  taskRunRepository: TaskRunRepository;
  runMetadataRepository: RunMetadataRepository;
  taskRunner: TaskRunner;
}

export interface CliRuntimeDependencies extends TaskRunnerDependencies {
  sqliteDatabasePath?: string;
  storageMode?: "sqlite" | "memory";
}

export function createCliRuntime(
  dependencies: CliRuntimeDependencies = {}
): CliRuntime {
  const hasInjectedStorage =
    dependencies.taskRepository !== undefined ||
    dependencies.taskRunRepository !== undefined ||
    dependencies.runMetadataRepository !== undefined;
  const shouldUseSqlite =
    dependencies.storageMode === "sqlite" ||
    (dependencies.storageMode !== "memory" && !hasInjectedStorage);
  const sqliteRepositories =
    shouldUseSqlite
      ? createSqliteRepositories({ databasePath: dependencies.sqliteDatabasePath })
      : undefined;
  const taskRepository =
    dependencies.taskRepository ??
    sqliteRepositories?.taskRepository ??
    new InMemoryTaskRepository();
  const taskRunRepository =
    dependencies.taskRunRepository ??
    sqliteRepositories?.taskRunRepository ??
    new InMemoryTaskRunRepository();
  const runMetadataRepository =
    dependencies.runMetadataRepository ??
    sqliteRepositories?.runMetadataRepository ??
    new InMemoryRunMetadataRepository();
  const taskRunner = new TaskRunner({
    ...dependencies,
    taskRepository,
    taskRunRepository,
    runMetadataRepository
  });

  return { taskRepository, taskRunRepository, runMetadataRepository, taskRunner };
}

let defaultRuntime: CliRuntime | undefined;

function getDefaultRuntime(): CliRuntime {
  defaultRuntime ??= createCliRuntime();
  return defaultRuntime;
}

export async function main(
  argv = process.argv.slice(2),
  io: CliIO = { stdout: process.stdout, stderr: process.stderr },
  cwd = process.cwd(),
  runtime?: CliRuntime
): Promise<number> {
  const activeRuntime = runtime ?? getDefaultRuntime();
  const [command, ...rest] = argv;

  if (!command || command === "--help" || command === "-h") {
    io.stdout.write(helpText());
    return 0;
  }

  if (command === "run") {
    return runCommand(rest, io, cwd, activeRuntime);
  }

  if (command === "tasks" && rest[0] === "list") {
    return listTasks(io, activeRuntime);
  }

  if (command === "runs" && rest[0] === "list") {
    return listRuns(io, activeRuntime);
  }

  if (command === "runs" && rest[0] === "show") {
    return showRun(rest.slice(1), io, activeRuntime);
  }

  if (command === "risks" && rest[0] === "show") {
    return showRisk(rest.slice(1), io, activeRuntime);
  }

  io.stderr.write(`error: unknown command ${[command, ...rest].join(" ")}\n`);
  return 1;
}

export function helpText(): string {
  return [
    "agent-hub",
    "",
    "Usage:",
    "  agent-hub run [--repo <path>] [--workspace-base <path>] [--retain-on-failure] \"@fake <task>\"",
    "  agent-hub tasks list",
    "  agent-hub runs list",
    "  agent-hub runs show <run-id>",
    "  agent-hub risks show <run-id>",
    ""
  ].join("\n");
}

async function runCommand(
  args: string[],
  io: CliIO,
  cwd: string,
  runtime: CliRuntime
): Promise<number> {
  try {
    const options = parseRunArgs(args, cwd);
    const rawPrompt = options.rawPrompt;
    const parsed = parseAgentPrompt(rawPrompt);
    if (parsed.agentKind !== "fake") {
      io.stderr.write(`error: agent ${parsed.agentKind} is not implemented yet\n`);
      return 1;
    }

    const result = await runtime.taskRunner.run({
      projectRoot: options.projectRoot,
      rawPrompt,
      workspaceBasePath: options.workspaceBasePath,
      workspaceCleanupPolicy: options.retainOnFailure ? "retain_on_failure" : "always",
      dryRun: options.dryRun
    });

    io.stdout.write(renderRunSummary(result));
    return result.ok ? 0 : 1;
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function listTasks(io: CliIO, runtime: CliRuntime): Promise<number> {
  const tasks = await runtime.taskRepository.list();
  if (tasks.length === 0) {
    io.stdout.write("No tasks found.\n");
    return 0;
  }

  for (const task of tasks) {
    io.stdout.write(`${task.id}\t${task.status}\t${task.title}\n`);
  }
  return 0;
}

async function listRuns(io: CliIO, runtime: CliRuntime): Promise<number> {
  const runs = await runtime.taskRunRepository.list();
  if (runs.length === 0) {
    io.stdout.write("No runs found.\n");
    return 0;
  }

  for (const run of runs) {
    io.stdout.write(`${run.id}\t${run.status}\t${run.agentKind}\t${run.taskId}\n`);
  }
  return 0;
}

async function showRun(
  args: string[],
  io: CliIO,
  runtime: CliRuntime
): Promise<number> {
  const runId = args[0];
  if (!runId) {
    io.stderr.write("error: run id is required\n");
    return 1;
  }

  const run = await runtime.taskRunRepository.get(runId);
  if (!run) {
    io.stderr.write(`error: run ${runId} not found\n`);
    return 1;
  }
  const metadata = await runtime.runMetadataRepository.get(runId);
  io.stdout.write(
    [
      `run_id: ${run.id}`,
      `task_id: ${run.taskId}`,
      `agent: ${run.agentKind}`,
      `status: ${run.status}`,
      `branch: ${run.branchName ?? "none"}`,
      `worktree_path: ${run.worktreePath ?? "none"}`,
      `changed_files: ${metadata?.diff?.changedFiles.length ?? 0}`,
      `verification: ${metadata?.verification?.summary ?? "not available"}`,
      `risk: ${metadata?.riskReport?.level ?? "not available"}`,
      `retained_workspace: ${metadata?.workspaceCleanup?.retained ? run.worktreePath ?? "unknown" : "none"}`,
      ""
    ].join("\n")
  );
  return 0;
}

async function showRisk(
  args: string[],
  io: CliIO,
  runtime: CliRuntime
): Promise<number> {
  const runId = args[0];
  if (!runId) {
    io.stderr.write("error: run id is required\n");
    return 1;
  }
  const metadata = await runtime.runMetadataRepository.get(runId);
  if (!metadata?.riskReport) {
    io.stderr.write(`error: risk report for run ${runId} not found\n`);
    return 1;
  }
  const report = metadata.riskReport;
  io.stdout.write(
    [
      `run_id: ${runId}`,
      `risk: ${report.level}`,
      `summary: ${report.summary}`,
      `changed_files: ${report.changedFiles.length}`,
      `verification: ${report.verificationSummary}`,
      `failed_checks: ${report.failedChecks.length === 0 ? "none" : report.failedChecks.join(", ")}`,
      "risk_factors:",
      ...(report.riskFactors.length === 0
        ? ["- none"]
        : report.riskFactors.map((factor) => `- ${factor}`)),
      "manual_review:",
      ...report.manualReviewChecklist.map((item) => `- ${item}`),
      `acceptance: ${report.acceptanceRecommendation}`,
      ""
    ].join("\n")
  );
  return 0;
}

function renderRunSummary(result: Awaited<ReturnType<TaskRunner["run"]>>): string {
  return [
    "Task run completed",
    `task_id: ${result.task.id}`,
    `run_id: ${result.run.id}`,
    `agent: ${result.run.agentKind}`,
    `status: ${result.status}`,
    `worktree_path: ${result.worktreePath ?? "none"}`,
    `branch: ${result.run.branchName ?? "none"}`,
    `task_brief_path: ${result.taskBriefPath ?? "none"}`,
    `changed_files: ${result.diff?.changedFiles.length ?? 0}`,
    `verification: ${result.verification?.summary ?? "not available"}`,
    `risk: ${result.riskReport?.level ?? "not available"}`,
    `retained_workspace: ${result.workspaceCleanup?.retained ? result.worktreePath ?? "unknown" : "none"}`,
    `events: ${result.events.length}`,
    `warnings: ${result.warnings.length === 0 ? "none" : result.warnings.join(", ")}`,
    "fake_output:",
    result.fakeOutput?.trim() ?? "(none)",
    ""
  ].join("\n");
}

interface ParsedRunArgs {
  rawPrompt: string;
  projectRoot: string;
  workspaceBasePath?: string;
  retainOnFailure: boolean;
  dryRun: boolean;
}

function parseRunArgs(args: string[], cwd: string): ParsedRunArgs {
  const promptParts: string[] = [];
  let projectRoot = cwd;
  let workspaceBasePath: string | undefined;
  let retainOnFailure = false;
  let dryRun = false;
  let parsingFlags = true;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (parsingFlags && arg === "--") {
      parsingFlags = false;
      continue;
    }
    if (parsingFlags && arg === "--repo") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--repo requires a path");
      }
      projectRoot = path.resolve(cwd, value);
      index += 1;
      continue;
    }
    if (parsingFlags && arg === "--workspace-base") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--workspace-base requires a path");
      }
      workspaceBasePath = path.resolve(cwd, value);
      index += 1;
      continue;
    }
    if (parsingFlags && arg === "--retain-on-failure") {
      retainOnFailure = true;
      continue;
    }
    if (parsingFlags && arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    promptParts.push(arg);
  }

  return {
    rawPrompt: promptParts.join(" "),
    projectRoot,
    workspaceBasePath,
    retainOnFailure,
    dryRun
  };
}

if (require.main === module) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
