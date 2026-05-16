#!/usr/bin/env node
import path from "node:path";
import { parseAgentPrompt } from "./agent-parser";
import {
  createId,
  nowIso,
  parseAgentKind,
  validateProject,
  validateTask,
  type VerificationResult
} from "./domain";
import { TaskRunner, type RunTaskInput, type TaskRunnerDependencies } from "./task-runner";
import { createSqliteRepositories } from "./sqlite-storage";
import {
  InMemoryAgentProfileRepository,
  InMemoryComparisonReportRepository,
  InMemoryMemoryItemRepository,
  InMemoryProjectRepository,
  InMemoryRiskReportRepository,
  InMemoryRunArtifactRepository,
  InMemoryRunEventRepository,
  InMemoryRunMetadataRepository,
  InMemorySettingsRepository,
  InMemorySkillRepository,
  InMemoryTaskRepository,
  InMemoryTaskRunRepository,
  InMemoryVerificationResultRepository,
  type AgentProfileRepository,
  type ComparisonReportRepository,
  type MemoryItemRepository,
  type ProjectRepository,
  type RiskReportRepository,
  type RunArtifactRepository,
  type RunEventRepository,
  type RunMetadataRepository,
  type SettingsRepository,
  type SkillRepository,
  type TaskRepository,
  type TaskRunRepository,
  type VerificationResultRepository
} from "./storage";

export interface CliIO {
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
}

export interface CliRuntime {
  projectRepository: ProjectRepository;
  agentProfileRepository: AgentProfileRepository;
  taskRepository: TaskRepository;
  taskRunRepository: TaskRunRepository;
  runEventRepository: RunEventRepository;
  runArtifactRepository: RunArtifactRepository;
  verificationResultRepository: VerificationResultRepository;
  riskReportRepository: RiskReportRepository;
  runMetadataRepository: RunMetadataRepository;
  memoryItemRepository: MemoryItemRepository;
  comparisonReportRepository: ComparisonReportRepository;
  skillRepository: SkillRepository;
  settingsRepository: SettingsRepository;
  taskRunner: TaskRunner;
}

export interface CliRuntimeDependencies extends TaskRunnerDependencies {
  sqliteDatabasePath?: string;
  storageMode?: "sqlite" | "memory";
  projectRepository?: ProjectRepository;
  agentProfileRepository?: AgentProfileRepository;
  memoryItemRepository?: MemoryItemRepository;
  comparisonReportRepository?: ComparisonReportRepository;
  skillRepository?: SkillRepository;
  settingsRepository?: SettingsRepository;
}

export function createCliRuntime(
  dependencies: CliRuntimeDependencies = {}
): CliRuntime {
  const hasInjectedStorage =
    dependencies.projectRepository !== undefined ||
    dependencies.agentProfileRepository !== undefined ||
    dependencies.taskRepository !== undefined ||
    dependencies.taskRunRepository !== undefined ||
    dependencies.runEventRepository !== undefined ||
    dependencies.runArtifactRepository !== undefined ||
    dependencies.verificationResultRepository !== undefined ||
    dependencies.riskReportRepository !== undefined ||
    dependencies.runMetadataRepository !== undefined ||
    dependencies.memoryItemRepository !== undefined ||
    dependencies.comparisonReportRepository !== undefined ||
    dependencies.skillRepository !== undefined ||
    dependencies.settingsRepository !== undefined;
  const shouldUseSqlite =
    dependencies.storageMode === "sqlite" ||
    (dependencies.storageMode !== "memory" && !hasInjectedStorage);
  const sqliteRepositories =
    shouldUseSqlite
      ? createSqliteRepositories({ databasePath: dependencies.sqliteDatabasePath })
      : undefined;
  const projectRepository =
    dependencies.projectRepository ??
    sqliteRepositories?.projectRepository ??
    new InMemoryProjectRepository();
  const agentProfileRepository =
    dependencies.agentProfileRepository ??
    sqliteRepositories?.agentProfileRepository ??
    new InMemoryAgentProfileRepository();
  const taskRepository =
    dependencies.taskRepository ??
    sqliteRepositories?.taskRepository ??
    new InMemoryTaskRepository();
  const taskRunRepository =
    dependencies.taskRunRepository ??
    sqliteRepositories?.taskRunRepository ??
    new InMemoryTaskRunRepository();
  const runEventRepository =
    dependencies.runEventRepository ??
    sqliteRepositories?.runEventRepository ??
    new InMemoryRunEventRepository();
  const runArtifactRepository =
    dependencies.runArtifactRepository ??
    sqliteRepositories?.runArtifactRepository ??
    new InMemoryRunArtifactRepository();
  const verificationResultRepository =
    dependencies.verificationResultRepository ??
    sqliteRepositories?.verificationResultRepository ??
    new InMemoryVerificationResultRepository();
  const riskReportRepository =
    dependencies.riskReportRepository ??
    sqliteRepositories?.riskReportRepository ??
    new InMemoryRiskReportRepository();
  const runMetadataRepository =
    dependencies.runMetadataRepository ??
    sqliteRepositories?.runMetadataRepository ??
    new InMemoryRunMetadataRepository();
  const memoryItemRepository =
    dependencies.memoryItemRepository ??
    sqliteRepositories?.memoryItemRepository ??
    new InMemoryMemoryItemRepository();
  const comparisonReportRepository =
    dependencies.comparisonReportRepository ??
    sqliteRepositories?.comparisonReportRepository ??
    new InMemoryComparisonReportRepository();
  const skillRepository =
    dependencies.skillRepository ??
    sqliteRepositories?.skillRepository ??
    new InMemorySkillRepository();
  const settingsRepository =
    dependencies.settingsRepository ??
    sqliteRepositories?.settingsRepository ??
    new InMemorySettingsRepository();
  const taskRunner = new TaskRunner({
    ...dependencies,
    taskRepository,
    taskRunRepository,
    runEventRepository,
    runArtifactRepository,
    verificationResultRepository,
    riskReportRepository,
    runMetadataRepository
  });

  return {
    projectRepository,
    agentProfileRepository,
    taskRepository,
    taskRunRepository,
    runEventRepository,
    runArtifactRepository,
    verificationResultRepository,
    riskReportRepository,
    runMetadataRepository,
    memoryItemRepository,
    comparisonReportRepository,
    skillRepository,
    settingsRepository,
    taskRunner
  };
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
  let global: ParsedGlobalArgs;
  try {
    global = parseGlobalArgs(argv, cwd);
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  const activeRuntime =
    runtime ??
    (global.databasePath
      ? createCliRuntime({ sqliteDatabasePath: global.databasePath })
      : getDefaultRuntime());
  const [command, ...rest] = global.args;

  if (!command || command === "--help" || command === "-h") {
    io.stdout.write(helpText());
    return 0;
  }

  if (command === "project" && rest[0] === "add") {
    return addProject(rest.slice(1), io, cwd, activeRuntime);
  }

  if (command === "project" && rest[0] === "list") {
    return listProjects(io, activeRuntime);
  }

  if (command === "task" && rest[0] === "create") {
    return createTask(rest.slice(1), io, activeRuntime);
  }

  if (command === "task" && rest[0] === "list") {
    return listTasks(rest.slice(1), io, activeRuntime);
  }

  if (command === "task" && rest[0] === "history") {
    return taskHistory(rest.slice(1), io, activeRuntime);
  }

  if (command === "run") {
    return runCommand(rest, io, cwd, activeRuntime);
  }

  if (command === "tasks" && rest[0] === "list") {
    return listTasks(rest.slice(1), io, activeRuntime);
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
    "  agent-hub [--db <path>] project add --name <name> --root <path>",
    "  agent-hub [--db <path>] project list",
    "  agent-hub [--db <path>] task create --project-id <project-id> --title <title> [--description <text>]",
    "  agent-hub [--db <path>] task list [--project-id <project-id>]",
    "  agent-hub [--db <path>] task history --task-id <task-id>",
    "  agent-hub [--db <path>] run --task <task-id> --agent fake [--workspace-base <path>]",
    "  agent-hub [--db <path>] run [--repo <path>] [--workspace-base <path>] [--retain-on-failure] \"@fake <task>\"",
    "  agent-hub runs list",
    "  agent-hub runs show <run-id>",
    "  agent-hub risks show <run-id>",
    ""
  ].join("\n");
}

async function addProject(
  args: string[],
  io: CliIO,
  cwd: string,
  runtime: CliRuntime
): Promise<number> {
  try {
    const name = requiredFlag(args, "--name");
    const root = path.resolve(cwd, requiredFlag(args, "--root"));
    const now = nowIso();
    const project = await runtime.projectRepository.create(
      validateProject({
        id: createId("project"),
        name,
        rootPath: root,
        createdAt: now,
        updatedAt: now
      })
    );
    io.stdout.write(
      [
        "Added project",
        `id: ${project.id}`,
        `name: ${project.name}`,
        `root: ${project.rootPath}`,
        ""
      ].join("\n")
    );
    return 0;
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function listProjects(io: CliIO, runtime: CliRuntime): Promise<number> {
  const projects = await runtime.projectRepository.list();
  if (projects.length === 0) {
    io.stdout.write("No projects found.\n");
    return 0;
  }

  for (const project of projects) {
    io.stdout.write(`${project.id}\t${project.name}\t${project.rootPath}\n`);
  }
  return 0;
}

async function createTask(
  args: string[],
  io: CliIO,
  runtime: CliRuntime
): Promise<number> {
  try {
    const projectId = requiredFlag(args, "--project-id");
    const title = requiredFlag(args, "--title");
    const description = optionalFlag(args, "--description");
    const project = await runtime.projectRepository.get(projectId);
    if (!project) {
      throw new Error(`project ${projectId} not found`);
    }
    const now = nowIso();
    const task = await runtime.taskRepository.create(
      validateTask({
        id: createId("task"),
        projectId,
        title,
        description,
        status: "open",
        createdAt: now,
        updatedAt: now
      })
    );
    io.stdout.write(
      [
        "Created task",
        `id: ${task.id}`,
        `project_id: ${task.projectId}`,
        `title: ${task.title}`,
        ""
      ].join("\n")
    );
    return 0;
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function runCommand(
  args: string[],
  io: CliIO,
  cwd: string,
  runtime: CliRuntime
): Promise<number> {
  try {
    const options = parseRunArgs(args, cwd);
    const runInput = await resolveRunInput(options, runtime);
    if (runInput.agentKind !== "fake") {
      io.stderr.write(`error: agent ${runInput.agentKind} is not implemented yet\n`);
      return 1;
    }

    const result = await runtime.taskRunner.run({
      ...runInput,
      workspaceBasePath: options.workspaceBasePath,
      workspaceCleanupPolicy: options.retainOnFailure ? "retain_on_failure" : "always",
      dryRun: options.dryRun,
      verificationCommands: options.verificationCommands
    });

    io.stdout.write(renderRunSummary(result));
    return result.ok ? 0 : 1;
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function listTasks(
  args: string[],
  io: CliIO,
  runtime: CliRuntime
): Promise<number> {
  const projectId = optionalFlag(args, "--project-id");
  const tasks = projectId
    ? await runtime.taskRepository.listByProjectId(projectId)
    : await runtime.taskRepository.list();
  if (tasks.length === 0) {
    io.stdout.write("No tasks found.\n");
    return 0;
  }

  for (const task of tasks) {
    io.stdout.write(`${task.id}\t${task.status}\t${task.projectId}\t${task.title}\n`);
  }
  return 0;
}

async function taskHistory(
  args: string[],
  io: CliIO,
  runtime: CliRuntime
): Promise<number> {
  const taskId = optionalFlag(args, "--task-id") ?? args[0];
  if (!taskId) {
    io.stderr.write("error: task id is required\n");
    return 1;
  }
  const task = await runtime.taskRepository.get(taskId);
  if (!task) {
    io.stderr.write(`error: task ${taskId} not found\n`);
    return 1;
  }
  const runs = await runtime.taskRunRepository.listByTaskId(taskId);
  const lines = [
    `Task ${task.id}`,
    `title: ${task.title}`,
    `status: ${task.status}`,
    `runs: ${runs.length}`,
    ""
  ];
  for (const run of runs) {
    const events = await runtime.runEventRepository.countByRunId(run.id);
    const risk = await runtime.riskReportRepository.getLatestByRunId(run.id);
    const verification = await runtime.verificationResultRepository.listByRunId(run.id);
    lines.push(
      `Run ${run.id}`,
      `agent: ${run.agentKind}`,
      `status: ${run.status}`,
      `events: ${events}`,
      `verification_results: ${verification.length}`,
      `risk: ${risk?.level ?? "not available"}`,
      ""
    );
  }
  io.stdout.write(lines.join("\n"));
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
  const diffArtifact = await runtime.runArtifactRepository.getLatestByRunIdAndKind(
    runId,
    "git_diff"
  );
  const verificationResults =
    await runtime.verificationResultRepository.listByRunId(runId);
  const riskReport = await runtime.riskReportRepository.getLatestByRunId(runId);
  const changedFiles = Array.isArray(diffArtifact?.metadata.changedFiles)
    ? diffArtifact.metadata.changedFiles.length
    : metadata?.diff?.changedFiles.length ?? 0;
  const verificationSummary =
    verificationResults.length === 0
      ? metadata?.verification?.summary ?? "not available"
      : summarizeVerificationResults(verificationResults);
  io.stdout.write(
    [
      `run_id: ${run.id}`,
      `task_id: ${run.taskId}`,
      `agent: ${run.agentKind}`,
      `status: ${run.status}`,
      `branch: ${run.branchName ?? "none"}`,
      `worktree_path: ${run.worktreePath ?? "none"}`,
      `changed_files: ${changedFiles}`,
      `verification: ${verificationSummary}`,
      `risk: ${riskReport?.level ?? metadata?.riskReport?.level ?? "not available"}`,
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
  const persistedReport = await runtime.riskReportRepository.getLatestByRunId(runId);
  const metadata = await runtime.runMetadataRepository.get(runId);
  const report = persistedReport ?? metadata?.riskReport;
  if (!report) {
    io.stderr.write(`error: risk report for run ${runId} not found\n`);
    return 1;
  }
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
  taskId?: string;
  registeredTask: boolean;
  agentKind?: string;
  projectPath?: string;
  title?: string;
  prompt?: string;
  workspaceBasePath?: string;
  retainOnFailure: boolean;
  dryRun: boolean;
  verificationCommands: Array<{ id: string; command: string; args: string[] }>;
}

async function resolveRunInput(
  options: ParsedRunArgs,
  runtime: CliRuntime
): Promise<RunTaskInput> {
  if (options.registeredTask) {
    if (!options.taskId) {
      throw new Error("--task requires an id");
    }
    const task = await runtime.taskRepository.get(options.taskId);
    if (!task) {
      throw new Error(`task ${options.taskId} not found`);
    }
    const project = await runtime.projectRepository.get(task.projectId);
    if (!project) {
      throw new Error(`project ${task.projectId} not found`);
    }
    const agentKind = parseAgentKind(options.agentKind ?? "fake");
    return {
      projectRoot: project.rootPath,
      taskId: task.id,
      projectId: task.projectId,
      title: task.title,
      taskPrompt: task.description ?? task.title,
      agentKind
    };
  }

  if (options.prompt !== undefined || options.agentKind !== undefined) {
    const agentKind = parseAgentKind(options.agentKind ?? "fake");
    const taskPrompt = options.prompt ?? options.rawPrompt;
    if (!taskPrompt.trim()) {
      throw new Error("task prompt is required");
    }
    return {
      projectRoot: options.projectRoot,
      taskId: options.taskId,
      title: options.title,
      taskPrompt,
      agentKind
    };
  }

  if (!options.rawPrompt.trim()) {
    throw new Error("task prompt is required");
  }
  const parsed = parseAgentPrompt(options.rawPrompt);
  return {
    projectRoot: options.projectRoot,
    rawPrompt: options.rawPrompt,
    agentKind: parsed.agentKind
  };
}

function parseRunArgs(args: string[], cwd: string): ParsedRunArgs {
  const promptParts: string[] = [];
  let projectRoot = cwd;
  let taskId: string | undefined;
  let registeredTask = false;
  let agentKind: string | undefined;
  let projectPath: string | undefined;
  let title: string | undefined;
  let prompt: string | undefined;
  let workspaceBasePath: string | undefined;
  let retainOnFailure = false;
  let dryRun = false;
  const verificationCommands: Array<{ id: string; command: string; args: string[] }> = [];
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
    if (parsingFlags && arg === "--project") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--project requires a path");
      }
      projectPath = path.resolve(cwd, value);
      projectRoot = projectPath;
      index += 1;
      continue;
    }
    if (parsingFlags && arg === "--task") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--task requires an id");
      }
      taskId = value;
      registeredTask = true;
      index += 1;
      continue;
    }
    if (parsingFlags && arg === "--task-id") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--task-id requires an id");
      }
      taskId = value;
      registeredTask = false;
      index += 1;
      continue;
    }
    if (parsingFlags && arg === "--agent") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--agent requires an agent kind");
      }
      agentKind = value;
      index += 1;
      continue;
    }
    if (parsingFlags && arg === "--title") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--title requires text");
      }
      title = value;
      index += 1;
      continue;
    }
    if (parsingFlags && arg === "--prompt") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--prompt requires text");
      }
      prompt = value;
      index += 1;
      continue;
    }
    if (parsingFlags && arg === "--verify") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--verify requires a command");
      }
      verificationCommands.push(parseVerificationCommand(value, verificationCommands.length));
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
    taskId,
    registeredTask,
    agentKind,
    projectPath,
    title,
    prompt,
    workspaceBasePath,
    retainOnFailure,
    dryRun,
    verificationCommands
  };
}

interface ParsedGlobalArgs {
  args: string[];
  databasePath?: string;
}

function parseGlobalArgs(argv: string[], cwd: string): ParsedGlobalArgs {
  const args: string[] = [];
  let databasePath: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--db") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--db requires a path");
      }
      databasePath = path.resolve(cwd, value);
      index += 1;
      continue;
    }
    args.push(arg);
  }
  return { args, databasePath };
}

function requiredFlag(args: string[], flag: string): string {
  const value = optionalFlag(args, flag);
  if (!value) {
    throw new Error(`${flag} is required`);
  }
  return value;
}

function optionalFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseVerificationCommand(
  value: string,
  index: number
): { id: string; command: string; args: string[] } {
  const parts = value.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) =>
    part.replace(/^"|"$/g, "")
  ) ?? [];
  const [command, ...args] = parts;
  if (!command) {
    throw new Error("--verify requires a command");
  }
  return { id: `verify_${index + 1}`, command, args };
}

function summarizeVerificationResults(results: VerificationResult[]): string {
  const passed = results.filter((result) => result.status === "passed").length;
  const failed = results.filter((result) => result.status === "failed").length;
  const skipped = results.filter((result) => result.status === "skipped").length;
  return `${passed} passed, ${failed} failed, ${skipped} skipped`;
}

if (require.main === module) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
