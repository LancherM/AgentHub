#!/usr/bin/env node
import path from "node:path";
import { parseAgentPrompt } from "./agent-parser";
import {
  buildContextArtifacts,
  exportContextToRepository,
  initContextStore,
  showContextStore,
  type ContextBuildResult
} from "./context-compiler";
import {
  createId,
  nowIso,
  parseAgentKind,
  validateProject,
  validateTask,
  type ContextDeliveryMode,
  type ContextStoreMode,
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

  if (command === "context" && rest[0] === "init") {
    return contextInit(rest.slice(1), io, cwd);
  }

  if (command === "context" && rest[0] === "show") {
    return contextShow(rest.slice(1), io, cwd);
  }

  if (command === "context" && rest[0] === "build") {
    return contextBuild(rest.slice(1), io, cwd);
  }

  if (command === "context" && rest[0] === "export") {
    return contextExport(rest.slice(1), io, cwd);
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
    "  agent-hub context init --project-root <path> --project-id <project-id>",
    "  agent-hub context show --project-root <path> --project-id <project-id>",
    "  agent-hub context build --project-root <path> --project-id <project-id> --task-id <task-id> --title <title> --prompt <prompt>",
    "  agent-hub context export --project-root <path> --project-id <project-id> --dry-run|--write",
    "  agent-hub [--db <path>] run --task <task-id> --agent fake|codex|claude-code [--workspace-base <path>]",
    "  agent-hub [--db <path>] run [--repo <path>] [--workspace-base <path>] [--retain-on-failure] \"@fake|@codex|@claude-code <task>\"",
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

async function contextInit(args: string[], io: CliIO, cwd: string): Promise<number> {
  try {
    const result = await initContextStore(parseContextStoreArgs(args, cwd));
    io.stdout.write(
      [
        "Initialized context store",
        `project_root: ${result.projectRoot}`,
        `project_id: ${result.projectId}`,
        `mode: ${result.mode}`,
        `store_root: ${result.storeRoot}`,
        ""
      ].join("\n")
    );
    return 0;
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function contextShow(args: string[], io: CliIO, cwd: string): Promise<number> {
  try {
    const result = await showContextStore(parseContextStoreArgs(args, cwd));
    io.stdout.write(
      [
        "Context store",
        `project_root: ${result.projectRoot}`,
        `project_id: ${result.projectId}`,
        `mode: ${result.mode}`,
        `store_root: ${result.storeRoot}`,
        "files:",
        ...(result.files.length === 0
          ? ["  - none"]
          : result.files.map((file) => `  - ${file}`)),
        ""
      ].join("\n")
    );
    return 0;
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function contextBuild(args: string[], io: CliIO, cwd: string): Promise<number> {
  try {
    const store = parseContextStoreArgs(args, cwd);
    const result = await buildContextArtifacts({
      ...store,
      taskId: requiredFlag(args, "--task-id"),
      title: requiredFlag(args, "--title"),
      prompt: requiredFlag(args, "--prompt"),
      selectedAgentId: parseAgentKind(optionalFlag(args, "--agent") ?? "fake"),
      deliveryMode: parseDeliveryMode(optionalFlag(args, "--delivery-mode"))
    });
    io.stdout.write(renderContextBuildResult(result));
    return 0;
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function contextExport(args: string[], io: CliIO, cwd: string): Promise<number> {
  try {
    const store = parseContextStoreArgs(args, cwd);
    const result = await exportContextToRepository({
      ...store,
      includeAgentsMd: args.includes("--include-agents-md") || !args.includes("--include-claude-md"),
      includeClaudeMd: args.includes("--include-claude-md"),
      includeSkills: args.includes("--include-skills"),
      includeApprovedMemory: args.includes("--include-approved-memory"),
      dryRun: args.includes("--dry-run") || !args.includes("--write"),
      write: args.includes("--write")
    });
    io.stdout.write(
      [
        `${result.dryRun ? "Previewed" : "Wrote"} repo context export`,
        `project_root: ${result.config.projectRoot}`,
        `project_id: ${result.config.projectId}`,
        "target: repo",
        `dry_run: ${result.dryRun}`,
        "changed_files:",
        ...(result.changedFiles.length === 0
          ? ["  - none"]
          : result.changedFiles.map((file) => `  - ${file}`)),
        "warnings:",
        ...(result.warnings.length === 0
          ? ["  - none"]
          : result.warnings.map((warning) => `  - ${warning}`)),
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

    const result = await runtime.taskRunner.run({
      ...runInput,
      workspaceBasePath: options.workspaceBasePath,
      workspaceCleanupPolicy: options.retainOnFailure ? "retain_on_failure" : undefined,
      dryRun: options.dryRun,
      verificationCommands: options.verificationCommands,
      deliveryMode: options.deliveryMode,
      contextStoreRoot: options.contextStoreRoot
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
  deliveryMode?: ContextDeliveryMode;
  contextStoreRoot?: string;
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
  let deliveryMode: ContextDeliveryMode | undefined;
  let contextStoreRoot: string | undefined;
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
    if (parsingFlags && arg === "--delivery-mode") {
      deliveryMode = parseDeliveryMode(args[index + 1]);
      index += 1;
      continue;
    }
    if (parsingFlags && arg === "--context-store-root") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--context-store-root requires a path");
      }
      contextStoreRoot = path.resolve(cwd, value);
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
    deliveryMode,
    contextStoreRoot,
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

function parseContextStoreArgs(args: string[], cwd: string): {
  projectRoot: string;
  projectId: string;
  mode?: ContextStoreMode;
  agentHubHome?: string;
} {
  return {
    projectRoot: path.resolve(cwd, requiredFlag(args, "--project-root")),
    projectId: requiredFlag(args, "--project-id"),
    mode: parseContextStoreMode(optionalFlag(args, "--mode")),
    agentHubHome: optionalFlag(args, "--agent-hub-home")
      ? path.resolve(cwd, requiredFlag(args, "--agent-hub-home"))
      : undefined
  };
}

function parseContextStoreMode(value: string | undefined): ContextStoreMode | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "external" || value === "repo_local") {
    return value;
  }
  throw new Error("--mode must be external or repo_local");
}

function parseDeliveryMode(value: string | undefined): ContextDeliveryMode | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    value === "runtime_injection" ||
    value === "worktree_overlay" ||
    value === "repo_export"
  ) {
    return value;
  }
  throw new Error("--delivery-mode must be runtime_injection, worktree_overlay, or repo_export");
}

function renderContextBuildResult(result: ContextBuildResult): string {
  return [
    "Built context artifacts",
    `project_root: ${result.config.projectRoot}`,
    `project_id: ${result.config.projectId}`,
    `task_id: ${result.contextPack.taskId}`,
    `delivery_mode: ${result.contextPack.deliveryMode}`,
    `context_pack_path: ${result.contextPackPath}`,
    `task_brief_path: ${result.taskBriefPath}`,
    `warnings: ${result.warnings.length === 0 ? "none" : result.warnings.join(", ")}`,
    ""
  ].join("\n");
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
