#!/usr/bin/env node
import { createHash } from "node:crypto";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { parseAgentPrompt } from "@agent-hub/agent-adapters";
import {
  appendApprovedMemory,
  buildContextArtifacts,
  exportContextToRepository,
  initContextStore,
  showContextStore,
  type ContextBuildResult
} from "@agent-hub/context-compiler";
import {
  createId,
  nowIso,
  agentKinds,
  memoryCategories,
  runEventTypes,
  parseAgentKind,
  validateComparisonReport,
  validateMemoryItem,
  validateProject,
  validateRunEvent,
  validateTask,
  type ContextDeliveryMode,
  type ContextStoreMode,
  type AgentKind,
  type MemoryCategory,
  type RunEventType,
  type VerificationResult
} from "@agent-hub/core";
import {
  formatShellCommand,
  TaskRunner,
  type RunTaskInput,
  type TaskRunnerDependencies
} from "@agent-hub/task-runner";
import { createSqliteRepositories } from "@agent-hub/db";
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
} from "@agent-hub/core";

export interface CliIO {
  stdin?: NodeJS.ReadableStream;
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
  const debug = global.debug || isEnvironmentDebugEnabled();

  if (!command) {
    return runInteractive({
      io,
      cwd,
      runtime: activeRuntime,
      projectRoot: global.projectRoot ?? cwd,
      selectedAgent: global.agentKind ?? "fake",
      debug
    });
  }

  if (command === "--help" || command === "-h") {
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

  if (command === "run" && rest[0] === "event" && rest[1] === "add") {
    return addRunEvent(rest.slice(2), io, activeRuntime);
  }

  if (command === "run") {
    return runCommand(rest, io, cwd, activeRuntime, debug);
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

  if (command === "memory" && rest[0] === "list") {
    return listMemory(rest.slice(1), io, activeRuntime);
  }

  if (command === "memory" && rest[0] === "propose") {
    return proposeMemory(rest.slice(1), io, activeRuntime);
  }

  if (command === "memory" && rest[0] === "approve") {
    return approveMemory(rest.slice(1), io, cwd, activeRuntime);
  }

  if (command === "memory" && rest[0] === "reject") {
    return rejectMemory(rest.slice(1), io, activeRuntime);
  }

  if (command === "compare") {
    return compareRuns(rest, io, activeRuntime);
  }

  io.stderr.write(`error: unknown command ${[command, ...rest].join(" ")}\n`);
  return 1;
}

export function helpText(): string {
  return [
    "agent-hub",
    "",
    "Usage:",
    "  agent-hub [--project <path>] [--agent fake|codex|claude-code]",
    "  agent-hub [--debug] run ...",
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
    "  agent-hub [--db <path>] run event add --run-id <run-id> --type <type> --message <message>",
    "  agent-hub runs list",
    "  agent-hub runs show <run-id>",
    "  agent-hub risks show <run-id>",
    "  agent-hub memory list --project-id <project-id>",
    "  agent-hub memory propose --project-id <project-id> --category <category> --content <text>",
    "  agent-hub memory approve --memory-id <memory-id>",
    "  agent-hub memory reject --memory-id <memory-id>",
    "  agent-hub compare --task-id <task-id> --baseline <run-id> --candidate <run-id>",
    ""
  ].join("\n");
}

export interface InteractiveOptions {
  io?: CliIO;
  cwd?: string;
  runtime?: CliRuntime;
  projectRoot?: string;
  selectedAgent?: AgentKind;
  debug?: boolean;
  input?: AsyncIterable<string>;
}

interface InteractiveState {
  projectRoot: string;
  selectedAgent: AgentKind;
  debug: boolean;
}

export async function runInteractive(
  options: InteractiveOptions = {}
): Promise<number> {
  const io = options.io ?? {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr
  };
  const cwd = options.cwd ?? process.cwd();
  const runtime = options.runtime ?? getDefaultRuntime();
  const state: InteractiveState = {
    projectRoot: path.resolve(cwd, options.projectRoot ?? cwd),
    selectedAgent: options.selectedAgent ?? "fake",
    debug: options.debug ?? false
  };
  const input = options.input ?? readInteractiveLines(io.stdin ?? process.stdin);

  io.stdout.write(renderInteractiveBanner(state));
  io.stdout.write(interactivePrompt(state));
  for await (const rawLine of input) {
    const line = rawLine.trim();
    if (!line) {
      io.stdout.write(interactivePrompt(state));
      continue;
    }
    if (line.startsWith("/")) {
      const action = await handleInteractiveSlash(line, io, cwd, runtime, state);
      if (action === "exit") {
        return 0;
      }
      io.stdout.write(interactivePrompt(state));
      continue;
    }

    io.stdout.write(`run: ${line}\n`);
    const runArgs = line.startsWith("@")
      ? ["--repo", state.projectRoot, line]
      : ["--repo", state.projectRoot, "--agent", state.selectedAgent, "--prompt", line];
    const exitCode = await runCommand(runArgs, io, cwd, runtime, state.debug);
    if (exitCode !== 0) {
      io.stderr.write(`interactive run failed with exit code ${exitCode}\n`);
    }
    io.stdout.write(interactivePrompt(state));
  }
  return 0;
}

async function* readInteractiveLines(
  input: NodeJS.ReadableStream
): AsyncIterable<string> {
  const reader = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of reader) {
      yield line;
    }
  } finally {
    reader.close();
  }
}

function renderInteractiveBanner(state: InteractiveState): string {
  return [
    "Agent Hub interactive",
    `project: ${state.projectRoot}`,
    `agent: ${state.selectedAgent}`,
    "type /help for commands",
    ""
  ].join("\n");
}

function interactivePrompt(state: InteractiveState): string {
  return `agent-hub[${state.selectedAgent}]> `;
}

function interactiveHelpText(): string {
  return [
    "Interactive commands:",
    "  /help",
    "  /agents",
    "  /use <agent>",
    "  /context",
    "  /context init",
    "  /clear",
    "  /exit",
    "  /quit",
    "",
    "Prompts:",
    "  describe the task in natural language",
    "  @fake simulate the task",
    "  @codex implement the task",
    "  @claude-code review the task",
    ""
  ].join("\n");
}

async function handleInteractiveSlash(
  line: string,
  io: CliIO,
  cwd: string,
  runtime: CliRuntime,
  state: InteractiveState
): Promise<"continue" | "exit"> {
  const [command, ...rest] = line.split(/\s+/);
  if (command === "/help") {
    io.stdout.write(interactiveHelpText());
    return "continue";
  }
  if (command === "/agents") {
    io.stdout.write(renderInteractiveAgents(state.selectedAgent));
    return "continue";
  }
  if (command === "/use") {
    const agent = rest[0];
    if (!agent) {
      io.stderr.write("error: /use requires an agent\n");
      return "continue";
    }
    try {
      state.selectedAgent = parseInteractiveAgent(agent);
      io.stdout.write(`using agent: ${state.selectedAgent}\n`);
    } catch (error) {
      io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    return "continue";
  }
  if (command === "/context") {
    await renderInteractiveContext(rest, io, cwd, runtime, state);
    return "continue";
  }
  if (command === "/clear") {
    io.stdout.write("\x1b[2J\x1b[H");
    return "continue";
  }
  if (command === "/exit" || command === "/quit") {
    io.stdout.write("Exiting Agent Hub.\n");
    return "exit";
  }
  io.stderr.write(`error: unknown interactive command ${command}\n`);
  return "continue";
}

function renderInteractiveAgents(selectedAgent: AgentKind): string {
  return [
    "agents:",
    ...agentKinds.map((agent) => `${agent === selectedAgent ? "*" : " "} ${agent}`),
    ""
  ].join("\n");
}

function parseInteractiveAgent(value: string): AgentKind {
  return parseAgentKind(value.replace(/^@/, ""));
}

async function renderInteractiveContext(
  args: string[],
  io: CliIO,
  cwd: string,
  runtime: CliRuntime,
  state: InteractiveState
): Promise<void> {
  try {
    const projectId = await resolveInteractiveProjectId(runtime, state.projectRoot);
    const input = {
      projectRoot: state.projectRoot,
      projectId
    };
    const result =
      args[0] === "init"
        ? await initContextStore(input)
        : await showContextStore(input);
    io.stdout.write(
      [
        args[0] === "init" ? "Initialized context store" : "Context store",
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
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

async function resolveInteractiveProjectId(
  runtime: CliRuntime,
  projectRoot: string
): Promise<string> {
  const project = await runtime.projectRepository.getByRootPath(path.resolve(projectRoot));
  return project?.id ?? "adhoc_project";
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
  runtime: CliRuntime,
  inheritedDebug = false
): Promise<number> {
  try {
    const options = parseRunArgs(args, cwd);
    const runInput = await resolveRunInput(options, runtime);
    const effectiveRunInput = await withAdhocProject(runInput, runtime);

    const result = await runtime.taskRunner.run({
      ...effectiveRunInput,
      workspaceBasePath: options.workspaceBasePath,
      workspaceCleanupPolicy: options.retainOnFailure ? "retain_on_failure" : undefined,
      dryRun: options.dryRun,
      verificationCommands: options.verificationCommands,
      deliveryMode: options.deliveryMode,
      contextStoreRoot: options.contextStoreRoot
    });

    io.stdout.write(renderRunSummary(result, options.deliveryMode ?? "runtime_injection"));
    if (inheritedDebug || options.debug) {
      io.stdout.write(renderRunDebug(result, effectiveRunInput));
    }
    return result.ok ? 0 : 1;
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function withAdhocProject(
  runInput: RunTaskInput,
  runtime: CliRuntime
): Promise<RunTaskInput> {
  if (runInput.projectId !== undefined) {
    return runInput;
  }

  const projectRoot = path.resolve(runInput.projectRoot);
  const existingForRoot = await runtime.projectRepository.getByRootPath(projectRoot);
  if (existingForRoot) {
    return { ...runInput, projectId: existingForRoot.id };
  }

  let projectId = "adhoc_project";
  const existingProject = await runtime.projectRepository.get(projectId);
  if (existingProject && existingProject.rootPath !== projectRoot) {
    projectId = adhocProjectIdForRoot(projectRoot);
  }

  const now = nowIso();
  await runtime.projectRepository.create(
    validateProject({
      id: projectId,
      name: path.basename(projectRoot) || projectId,
      rootPath: projectRoot,
      createdAt: now,
      updatedAt: now
    })
  );
  return { ...runInput, projectId };
}

function adhocProjectIdForRoot(projectRoot: string): string {
  return `adhoc_project_${createHash("sha256")
    .update(projectRoot)
    .digest("hex")
    .slice(0, 12)}`;
}

async function addRunEvent(
  args: string[],
  io: CliIO,
  runtime: CliRuntime
): Promise<number> {
  try {
    const runId = requiredFlag(args, "--run-id");
    const type = parseRunEventType(requiredFlag(args, "--type"));
    const message = requiredFlag(args, "--message");
    const run = await runtime.taskRunRepository.get(runId);
    if (!run) {
      throw new Error(`run ${runId} not found`);
    }
    const existingEvents = await runtime.runEventRepository.listByRunId(runId);
    const nextSequence =
      existingEvents.length === 0
        ? 0
        : Math.max(...existingEvents.map((event) => event.sequence)) + 1;
    const event = await runtime.runEventRepository.create(
      validateRunEvent({
        id: createId("event"),
        taskRunId: runId,
        sequence: nextSequence,
        type,
        message,
        metadata: { source: "manual_cli" },
        createdAt: nowIso()
      })
    );
    io.stdout.write(
      [
        "Recorded run event",
        `id: ${event.id}`,
        `run_id: ${event.taskRunId}`,
        `sequence: ${event.sequence}`,
        `type: ${event.type}`,
        ""
      ].join("\n")
    );
    return 0;
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

async function listMemory(
  args: string[],
  io: CliIO,
  runtime: CliRuntime
): Promise<number> {
  try {
    const projectId = requiredFlag(args, "--project-id");
    const items = await runtime.memoryItemRepository.listByProjectId(projectId);
    if (items.length === 0) {
      io.stdout.write("No memory items found.\n");
      return 0;
    }
    for (const item of items) {
      io.stdout.write(
        `${item.id}\t${item.status}\t${item.category}\t${firstLine(item.content)}\n`
      );
    }
    return 0;
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function proposeMemory(
  args: string[],
  io: CliIO,
  runtime: CliRuntime
): Promise<number> {
  try {
    const projectId = requiredFlag(args, "--project-id");
    const project = await runtime.projectRepository.get(projectId);
    if (!project) {
      throw new Error(`project ${projectId} not found`);
    }
    const category = parseMemoryCategory(requiredFlag(args, "--category"));
    const content = requiredFlag(args, "--content").trim();
    if (!content) {
      throw new Error("--content must not be empty");
    }
    const now = nowIso();
    const item = await runtime.memoryItemRepository.create(
      validateMemoryItem({
        id: createId("memory"),
        projectId,
        taskId: optionalFlag(args, "--task-id"),
        category,
        status: "proposed",
        content,
        createdAt: now,
        updatedAt: now
      })
    );
    io.stdout.write(
      [
        "Proposed memory",
        `id: ${item.id}`,
        `project_id: ${item.projectId}`,
        `status: ${item.status}`,
        `category: ${item.category}`,
        ""
      ].join("\n")
    );
    return 0;
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function approveMemory(
  args: string[],
  io: CliIO,
  cwd: string,
  runtime: CliRuntime
): Promise<number> {
  try {
    const memoryId = requiredFlag(args, "--memory-id");
    const existing = await runtime.memoryItemRepository.get(memoryId);
    if (!existing) {
      throw new Error(`memory item ${memoryId} not found`);
    }
    const project = await runtime.projectRepository.get(existing.projectId);
    if (!project) {
      throw new Error(`project ${existing.projectId} not found`);
    }
    const approvedAt = nowIso();
    const item = await runtime.memoryItemRepository.updateStatus(
      memoryId,
      "approved",
      approvedAt
    );
    const writeback = await appendApprovedMemory({
      projectRoot: project.rootPath,
      projectId: project.id,
      memoryId: item.id,
      content: item.content,
      approvedAt,
      agentHubHome: optionalFlag(args, "--agent-hub-home")
        ? path.resolve(cwd, requiredFlag(args, "--agent-hub-home"))
        : undefined
    });
    io.stdout.write(
      [
        "Approved memory",
        `id: ${item.id}`,
        `status: ${item.status}`,
        `approved_memory_path: ${writeback.path}`,
        `writeback: ${writeback.written ? "written" : "already_present"}`,
        ""
      ].join("\n")
    );
    return 0;
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function rejectMemory(
  args: string[],
  io: CliIO,
  runtime: CliRuntime
): Promise<number> {
  try {
    const memoryId = requiredFlag(args, "--memory-id");
    const item = await runtime.memoryItemRepository.updateStatus(
      memoryId,
      "rejected",
      nowIso()
    );
    io.stdout.write(
      [
        "Rejected memory",
        `id: ${item.id}`,
        `status: ${item.status}`,
        ""
      ].join("\n")
    );
    return 0;
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function compareRuns(
  args: string[],
  io: CliIO,
  runtime: CliRuntime
): Promise<number> {
  try {
    const taskId = requiredFlag(args, "--task-id");
    const baselineRunId = requiredFlag(args, "--baseline");
    const candidateRunId = requiredFlag(args, "--candidate");
    const task = await runtime.taskRepository.get(taskId);
    if (!task) {
      throw new Error(`task ${taskId} not found`);
    }
    const baseline = await loadComparisonRun(runtime, baselineRunId);
    const candidate = await loadComparisonRun(runtime, candidateRunId);
    if (baseline.taskId !== taskId) {
      throw new Error(`baseline run ${baselineRunId} does not belong to task ${taskId}`);
    }
    if (candidate.taskId !== taskId) {
      throw new Error(`candidate run ${candidateRunId} does not belong to task ${taskId}`);
    }
    const summary = renderComparisonSummary(taskId, baseline, candidate);
    const report = await runtime.comparisonReportRepository.create(
      validateComparisonReport({
        id: createId("comparison"),
        taskId,
        baselineRunId,
        candidateRunId,
        summary,
        createdAt: nowIso()
      })
    );
    io.stdout.write(
      [
        "Created comparison report",
        `id: ${report.id}`,
        report.summary,
        ""
      ].join("\n")
    );
    return 0;
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

interface ComparisonRunSnapshot {
  runId: string;
  taskId: string;
  agent: string;
  status: string;
  changedFiles: string[];
  stat: { filesChanged: number; insertions: number; deletions: number };
  verification: string;
  verificationOutcomes: string[];
  risk: string;
  riskFactors: string[];
  failedChecks: string[];
}

async function loadComparisonRun(
  runtime: CliRuntime,
  runId: string
): Promise<ComparisonRunSnapshot> {
  const run = await runtime.taskRunRepository.get(runId);
  if (!run) {
    throw new Error(`run ${runId} not found`);
  }
  const metadata = await runtime.runMetadataRepository.get(runId);
  const diffArtifact = await runtime.runArtifactRepository.getLatestByRunIdAndKind(
    runId,
    "git_diff"
  );
  const artifactMetadata = diffArtifact?.metadata ?? {};
  const verificationRows = await runtime.verificationResultRepository.listByRunId(runId);
  const risk = await runtime.riskReportRepository.getLatestByRunId(runId);
  const riskReport = risk ?? metadata?.riskReport;
  const changedFiles =
    metadata?.diff?.changedFiles.map((file) => file.path) ??
    changedFilePaths(artifactMetadata.changedFiles);
  const stat =
    metadata?.diff?.stat ??
    diffStat(artifactMetadata.stat, changedFiles.length);
  const failedChecks =
    verificationRows.length > 0
      ? verificationRows
          .filter((result) => result.status === "failed")
          .map((result) => result.command)
      : metadata?.verification?.failedCommands.map((result) => result.label) ?? [];
  const verificationOutcomes =
    verificationRows.length > 0
      ? verificationRows.map((result) => formatVerificationOutcome(
          result.command,
          result.status,
          result.exitCode
        ))
      : metadata?.verification?.results.map((result) => formatVerificationOutcome(
          result.label,
          result.status,
          result.exitCode ?? undefined
        )) ?? [];

  return {
    runId: run.id,
    taskId: run.taskId,
    agent: run.agentKind,
    status: run.status,
    changedFiles,
    stat: {
      filesChanged: stat.filesChanged,
      insertions: stat.insertions,
      deletions: stat.deletions
    },
    verification:
      verificationRows.length > 0
        ? summarizeVerificationResults(verificationRows)
        : metadata?.verification?.summary ?? "not available",
    verificationOutcomes,
    risk: riskReport?.level ?? "not available",
    riskFactors: riskReport?.riskFactors ?? [],
    failedChecks
  };
}

function renderComparisonSummary(
  taskId: string,
  baseline: ComparisonRunSnapshot,
  candidate: ComparisonRunSnapshot
): string {
  const baselineOnly = difference(baseline.changedFiles, candidate.changedFiles);
  const candidateOnly = difference(candidate.changedFiles, baseline.changedFiles);
  const shared = intersection(baseline.changedFiles, candidate.changedFiles);
  return [
    `task_id: ${taskId}`,
    `baseline: ${formatComparisonRun(baseline)}`,
    `candidate: ${formatComparisonRun(candidate)}`,
    `baseline_diff_stats: ${formatDiffStat(baseline.stat)}`,
    `candidate_diff_stats: ${formatDiffStat(candidate.stat)}`,
    `baseline_only_files: ${formatList(baselineOnly)}`,
    `candidate_only_files: ${formatList(candidateOnly)}`,
    `shared_files: ${formatList(shared)}`,
    `baseline_verification_outcomes: ${formatList(baseline.verificationOutcomes)}`,
    `candidate_verification_outcomes: ${formatList(candidate.verificationOutcomes)}`,
    `baseline_risk_factors: ${formatList(baseline.riskFactors)}`,
    `candidate_risk_factors: ${formatList(candidate.riskFactors)}`,
    `baseline_failed_checks: ${formatList(baseline.failedChecks)}`,
    `candidate_failed_checks: ${formatList(candidate.failedChecks)}`,
    `summary_tradeoffs: ${comparisonTradeoffs(baseline, candidate)}`
  ].join("\n");
}

function formatComparisonRun(run: ComparisonRunSnapshot): string {
  return [
    run.runId,
    `agent=${run.agent}`,
    `status=${run.status}`,
    `changed_files=${run.changedFiles.length}`,
    `stat=+${run.stat.insertions}/-${run.stat.deletions}`,
    `verification=${run.verification}`,
    `risk=${run.risk}`
  ].join(" ");
}

function formatDiffStat(stat: ComparisonRunSnapshot["stat"]): string {
  return `${stat.filesChanged} files, +${stat.insertions}/-${stat.deletions}`;
}

function formatVerificationOutcome(
  label: string,
  status: string,
  exitCode: number | undefined
): string {
  return exitCode === undefined
    ? `${label}: ${status}`
    : `${label}: ${status} (${exitCode})`;
}

function comparisonTradeoffs(
  baseline: ComparisonRunSnapshot,
  candidate: ComparisonRunSnapshot
): string {
  const notes: string[] = [];
  if (candidate.failedChecks.length > baseline.failedChecks.length) {
    notes.push("candidate has more failed checks");
  } else if (candidate.failedChecks.length < baseline.failedChecks.length) {
    notes.push("candidate has fewer failed checks");
  }
  if (riskRank(candidate.risk) > riskRank(baseline.risk)) {
    notes.push("candidate has higher risk");
  } else if (riskRank(candidate.risk) < riskRank(baseline.risk)) {
    notes.push("candidate has lower risk");
  }
  if (candidate.stat.filesChanged > baseline.stat.filesChanged) {
    notes.push("candidate changes more files");
  } else if (candidate.stat.filesChanged < baseline.stat.filesChanged) {
    notes.push("candidate changes fewer files");
  }
  return notes.length === 0
    ? "no material tradeoff detected from stored run data"
    : notes.join("; ");
}

function riskRank(risk: string): number {
  switch (risk) {
    case "low":
      return 1;
    case "medium":
      return 2;
    case "high":
      return 3;
    case "blocking":
      return 4;
    default:
      return 0;
  }
}

function changedFilePaths(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (typeof entry === "string") {
      return [entry];
    }
    if (entry && typeof entry === "object" && "path" in entry) {
      const filePath = (entry as { path?: unknown }).path;
      return typeof filePath === "string" ? [filePath] : [];
    }
    return [];
  });
}

function diffStat(
  value: unknown,
  fallbackFilesChanged: number
): { filesChanged: number; insertions: number; deletions: number } {
  if (!value || typeof value !== "object") {
    return { filesChanged: fallbackFilesChanged, insertions: 0, deletions: 0 };
  }
  const stat = value as Record<string, unknown>;
  return {
    filesChanged: numeric(stat.filesChanged) ?? fallbackFilesChanged,
    insertions: numeric(stat.insertions) ?? 0,
    deletions: numeric(stat.deletions) ?? 0
  };
}

function difference(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return [...new Set(left.filter((entry) => !rightSet.has(entry)))].sort();
}

function intersection(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return [...new Set(left.filter((entry) => rightSet.has(entry)))].sort();
}

function formatList(values: string[]): string {
  return values.length === 0 ? "none" : values.join(", ");
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? "";
}

function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function renderRunSummary(
  result: Awaited<ReturnType<TaskRunner["run"]>>,
  deliveryMode: ContextDeliveryMode
): string {
  return [
    "Task run completed",
    `task_id: ${result.task.id}`,
    `run_id: ${result.run.id}`,
    `agent: ${result.run.agentKind}`,
    `status: ${result.status}`,
    `context_delivery: ${deliveryMode}`,
    `worktree_path: ${result.worktreePath ?? "none"}`,
    `branch_name: ${result.run.branchName ?? "none"}`,
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

function renderRunDebug(
  result: Awaited<ReturnType<TaskRunner["run"]>>,
  input: RunTaskInput
): string {
  const lines = [
    "debug:",
    "run_boundary:",
    `- project_root: ${input.projectRoot}`,
    `- task_id: ${result.task.id}`,
    `- run_id: ${result.run.id}`,
    `- agent: ${result.run.agentKind}`,
    `- status: ${result.status}`,
    `- worktree_path: ${result.worktreePath ?? "none"}`,
    `- task_brief_path: ${result.taskBriefPath ?? "none"}`,
    `- context_pack: ${result.contextBundle.id}`,
    `- prompt_chars: ${input.taskPrompt?.length ?? input.rawPrompt?.length ?? 0}`,
    "verification_output:"
  ];

  if (!result.verification || result.verification.results.length === 0) {
    lines.push("- none");
  } else {
    for (const verification of result.verification.results) {
      lines.push(
        `- command: ${formatShellCommand(verification.command)}`,
        `  status: ${verification.status}`,
        `  exit_code: ${verification.exitCode ?? "none"}`,
        "  stdout:",
        indentBlock(truncateText(verification.stdout) || "(empty)", 4),
        "  stderr:",
        indentBlock(truncateText(verification.stderr) || "(empty)", 4)
      );
    }
  }

  lines.push("diff_summary:");
  if (!result.diff) {
    lines.push("- none");
  } else {
    lines.push(
      `- ok: ${result.diff.ok}`,
      `- files_changed: ${result.diff.stat.filesChanged}`,
      `- insertions: ${result.diff.stat.insertions}`,
      `- deletions: ${result.diff.stat.deletions}`,
      "  files:",
      ...(result.diff.changedFiles.length === 0
        ? ["    - none"]
        : result.diff.changedFiles.map((file) =>
            `    - ${file.path} ${file.status}${file.binary ? " binary" : ""}${
              file.sizeBytes === undefined ? "" : ` ${file.sizeBytes} bytes`
            }`
          )),
      "  file_summaries:",
      ...(result.diff.fileSummaries.length === 0
        ? ["    - none"]
        : result.diff.fileSummaries.map((summary) => `    - ${summary}`)),
      "  diff_preview:",
      indentBlock(truncateText(result.diff.diff) || "(empty)", 4)
    );
  }

  lines.push("");
  return lines.join("\n");
}

function truncateText(value: string, maxLength = 2_000): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}\n... truncated ${value.length - maxLength} chars`;
}

function indentBlock(value: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return value
    .split(/\r?\n/)
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function isEnvironmentDebugEnabled(): boolean {
  const value = process.env.AGENT_HUB_DEBUG;
  return value === "1" || value?.toLowerCase() === "true";
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
  debug: boolean;
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
  let debug = false;
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
    if (parsingFlags && arg === "--debug") {
      debug = true;
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
    debug,
    verificationCommands
  };
}

interface ParsedGlobalArgs {
  args: string[];
  databasePath?: string;
  debug: boolean;
  projectRoot?: string;
  agentKind?: AgentKind;
}

function parseGlobalArgs(argv: string[], cwd: string): ParsedGlobalArgs {
  const args: string[] = [];
  let databasePath: string | undefined;
  let debug = false;
  let projectRoot: string | undefined;
  let agentKind: AgentKind | undefined;
  let commandSeen = false;
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
    if (!commandSeen && arg === "--debug") {
      debug = true;
      continue;
    }
    if (!commandSeen && arg === "--project") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--project requires a path");
      }
      projectRoot = path.resolve(cwd, value);
      index += 1;
      continue;
    }
    if (!commandSeen && arg === "--agent") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--agent requires an agent kind");
      }
      agentKind = parseInteractiveAgent(value);
      index += 1;
      continue;
    }
    args.push(arg);
    if (!commandSeen && !arg.startsWith("-")) {
      commandSeen = true;
    }
  }
  return { args, databasePath, debug, projectRoot, agentKind };
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

function parseMemoryCategory(value: string): MemoryCategory {
  if ((memoryCategories as readonly string[]).includes(value)) {
    return value as MemoryCategory;
  }
  throw new Error(`--category must be one of ${memoryCategories.join(", ")}`);
}

function parseRunEventType(value: string): RunEventType {
  if ((runEventTypes as readonly string[]).includes(value)) {
    return value as RunEventType;
  }
  throw new Error(`--type must be one of ${runEventTypes.join(", ")}`);
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
