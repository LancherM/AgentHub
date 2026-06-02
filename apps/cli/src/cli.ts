#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { dump as dumpYaml, load as loadYaml } from "js-yaml";
import { z } from "zod";
import { parseAgentPrompt } from "@agent-hub/agent-adapters";
import {
  appendApprovedMemory,
  buildContextArtifacts,
  ConversationContextBuilder,
  ConversationThreadSummaryBuilder,
  createGlobalSkill,
  exportContextToRepository,
  initContextStore,
  listGlobalSkills,
  showContextStore,
  type ContextBuildResult,
  type ConversationContextMessage
} from "@agent-hub/context-compiler";
import {
  createId,
  nowIso,
  agentKinds,
  assertAgentKindEnabled,
  availableAgentKinds,
  defaultAgentKind,
  isAgentKindEnabled,
  memoryCategories,
  runEventTypes,
  roleCallStatuses,
  roleTodoStatuses,
  processAssistantRoleCallOutput,
  roleDefinitionsForWorkgroupRoles,
  roleDelegationPolicy,
  roleDelegationPolicyAllowsTarget,
  findWorkgroupRoleByHandle,
  normalizeWorkgroupRoleHandle,
  parseAgentKindAlias,
  presetWorkgroupRoles,
  extractAgentFacingOutput,
  validateComparisonReport,
  validateConversationMessage,
  validateConversationThread,
  validateConversationThreadSummary,
  validateMemoryItem,
  validateProject,
  validateRunEvent,
  validateTask,
  validateWorkgroupRole,
  toWorkgroupRoleRunMetadata,
  type ContextDeliveryMode,
  type ContextStoreMode,
  type AgentAvailabilityOptions,
  type AgentKind,
  type ConversationMessage,
  type ConversationThread,
  type ConversationThreadSummary,
  type JsonObject,
  type MemoryCategory,
  type Project,
  type RunContextDeliveryMode,
  type RunEventType,
  type RoleCall,
  type RoleCallEvent,
  type RoleCallStatus,
  type RoleDefinition,
  type RoleTodo,
  type RoleTodoStatus,
  type SkillReference,
  type TaskRunStatus,
  type VerificationResult,
  type WorkgroupExecutor,
  type WorkgroupRole,
  type WorkgroupRoleRunMetadata,
  type WorkgroupTaskAssignmentMetadata
} from "@agent-hub/core";
import {
  buildComparisonReport,
  formatShellCommand,
  getRunReviewDecision,
  loadRunDiffReview,
  loadRunEventsReview,
  recordRunReviewDecision,
  RoleCallTaskRunnerExecutor,
  TaskRunner,
  type RunDiffReview,
  type RunContinuationInput,
  type RunTaskInput,
  type TaskRunnerDependencies
} from "@agent-hub/task-runner";
import { scanSensitivePaths, validateRoleCallPolicy } from "@agent-hub/safety";
import { createSqliteRepositories } from "@agent-hub/db";
import { runTuiCommand, type TuiPromptSubmissionInput } from "./tui";
import {
  InMemoryAgentProfileRepository,
  InMemoryComparisonReportRepository,
  InMemoryConversationMessageRepository,
  InMemoryConversationThreadSummaryRepository,
  InMemoryConversationThreadRepository,
  InMemoryMemoryItemRepository,
  InMemoryProjectRepository,
  InMemoryRiskReportRepository,
  InMemoryRunArtifactRepository,
  InMemoryRunEventRepository,
  InMemoryRunMetadataRepository,
  InMemorySettingsRepository,
  InMemorySkillRepository,
  InMemoryRoleCallEventRepository,
  InMemoryRoleCallRepository,
  InMemoryRoleTodoRepository,
  InMemoryTaskRepository,
  InMemoryTaskRunRepository,
  InMemoryVerificationResultRepository,
  type AgentProfileRepository,
  type ComparisonReportRepository,
  type ConversationMessageRepository,
  type ConversationThreadSummaryRepository,
  type ConversationThreadRepository,
  type MemoryItemRepository,
  type ProjectRepository,
  type RiskReportRepository,
  type RunArtifactRepository,
  type RunEventRepository,
  type RunMetadataRepository,
  type SettingsRepository,
  type SkillRepository,
  type RoleCallEventRepository,
  type RoleCallRepository,
  type RoleTodoRepository,
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
  conversationThreadRepository: ConversationThreadRepository;
  conversationMessageRepository: ConversationMessageRepository;
  conversationThreadSummaryRepository: ConversationThreadSummaryRepository;
  verificationResultRepository: VerificationResultRepository;
  riskReportRepository: RiskReportRepository;
  runMetadataRepository: RunMetadataRepository;
  memoryItemRepository: MemoryItemRepository;
  comparisonReportRepository: ComparisonReportRepository;
  skillRepository: SkillRepository;
  settingsRepository: SettingsRepository;
  roleCallRepository: RoleCallRepository;
  roleCallEventRepository: RoleCallEventRepository;
  roleTodoRepository: RoleTodoRepository;
  taskRunner: TaskRunner;
}

export interface CliRuntimeDependencies extends TaskRunnerDependencies {
  sqliteDatabasePath?: string;
  storageMode?: "sqlite" | "memory";
  projectRepository?: ProjectRepository;
  agentProfileRepository?: AgentProfileRepository;
  conversationThreadRepository?: ConversationThreadRepository;
  conversationMessageRepository?: ConversationMessageRepository;
  conversationThreadSummaryRepository?: ConversationThreadSummaryRepository;
  memoryItemRepository?: MemoryItemRepository;
  comparisonReportRepository?: ComparisonReportRepository;
  skillRepository?: SkillRepository;
  settingsRepository?: SettingsRepository;
  roleCallRepository?: RoleCallRepository;
  roleCallEventRepository?: RoleCallEventRepository;
  roleTodoRepository?: RoleTodoRepository;
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
    dependencies.conversationThreadRepository !== undefined ||
    dependencies.conversationMessageRepository !== undefined ||
    dependencies.conversationThreadSummaryRepository !== undefined ||
    dependencies.verificationResultRepository !== undefined ||
    dependencies.riskReportRepository !== undefined ||
    dependencies.runMetadataRepository !== undefined ||
    dependencies.memoryItemRepository !== undefined ||
    dependencies.comparisonReportRepository !== undefined ||
    dependencies.skillRepository !== undefined ||
    dependencies.settingsRepository !== undefined ||
    dependencies.roleCallRepository !== undefined ||
    dependencies.roleCallEventRepository !== undefined ||
    dependencies.roleTodoRepository !== undefined;
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
  const conversationThreadRepository =
    dependencies.conversationThreadRepository ??
    sqliteRepositories?.conversationThreadRepository ??
    new InMemoryConversationThreadRepository();
  const conversationMessageRepository =
    dependencies.conversationMessageRepository ??
    sqliteRepositories?.conversationMessageRepository ??
    new InMemoryConversationMessageRepository();
  const conversationThreadSummaryRepository =
    dependencies.conversationThreadSummaryRepository ??
    sqliteRepositories?.conversationThreadSummaryRepository ??
    new InMemoryConversationThreadSummaryRepository();
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
  const roleTodoRepository =
    dependencies.roleTodoRepository ??
    sqliteRepositories?.roleTodoRepository ??
    new InMemoryRoleTodoRepository();
  const roleCallRepository =
    dependencies.roleCallRepository ??
    sqliteRepositories?.roleCallRepository ??
    new InMemoryRoleCallRepository(roleTodoRepository);
  const roleCallEventRepository =
    dependencies.roleCallEventRepository ??
    sqliteRepositories?.roleCallEventRepository ??
    new InMemoryRoleCallEventRepository();
  const taskRunner = new TaskRunner({
    ...dependencies,
    taskRepository,
    taskRunRepository,
    runEventRepository,
    runArtifactRepository,
    verificationResultRepository,
    riskReportRepository,
    memoryItemRepository,
    runMetadataRepository
  });

  return {
    projectRepository,
    agentProfileRepository,
    taskRepository,
    taskRunRepository,
    runEventRepository,
    runArtifactRepository,
    conversationThreadRepository,
    conversationMessageRepository,
    conversationThreadSummaryRepository,
    verificationResultRepository,
    riskReportRepository,
    runMetadataRepository,
    memoryItemRepository,
    comparisonReportRepository,
    skillRepository,
    settingsRepository,
    roleCallRepository,
    roleCallEventRepository,
    roleTodoRepository,
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
  io: CliIO = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr },
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
  try {
    if (global.agentKind) {
      requireAgentEnabled(global.agentKind, debug);
    }
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  if (!command) {
    return runInteractive({
      io,
      cwd,
      runtime: activeRuntime,
      projectRoot: global.projectRoot ?? cwd,
      selectedAgent: global.agentKind ?? defaultCliAgent(debug),
      debug
    });
  }

  if (command === "--help" || command === "-h") {
    io.stdout.write(helpText(debug));
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
    return contextBuild(rest.slice(1), io, cwd, debug);
  }

  if (command === "context" && rest[0] === "export") {
    return contextExport(rest.slice(1), io, cwd);
  }

  if (command === "skills" && rest[0] === "global" && rest[1] === "create") {
    return createGlobalSkillCommand(rest.slice(2), io, cwd);
  }

  if (command === "skills" && rest[0] === "global" && rest[1] === "list") {
    return listGlobalSkillsCommand(rest.slice(2), io, cwd);
  }

  if (command === "run" && rest[0] === "event" && rest[1] === "add") {
    return addRunEvent(rest.slice(2), io, activeRuntime);
  }

  if (command === "run") {
    return runCommand(rest, io, cwd, activeRuntime, debug);
  }

  if (command === "threads" && rest[0] === "list") {
    return listThreads(io, activeRuntime);
  }

  if (command === "threads" && rest[0] === "show") {
    return showThread(rest.slice(1), io, activeRuntime);
  }

  if (command === "rooms" && rest[0] === "list") {
    return listRooms(rest.slice(1), io, activeRuntime);
  }

  if (command === "rooms" && rest[0] === "create") {
    return createRoom(rest.slice(1), io, activeRuntime);
  }

  if (command === "rooms" && rest[0] === "use") {
    return useRoom(rest.slice(1), io, activeRuntime);
  }

  if (command === "rooms" && rest[0] === "send") {
    return sendRoomMessage(rest.slice(1), io, cwd, activeRuntime, debug);
  }

  if (command === "rooms" && rest[0] === "timeline") {
    return showRoomTimeline(rest.slice(1), io, activeRuntime);
  }

  if (command === "chat") {
    return runChat({
      io,
      cwd,
      runtime: activeRuntime,
      projectRoot: global.projectRoot ?? cwd,
      selectedAgent: global.agentKind ?? defaultCliAgent(debug),
      debug,
      args: rest
    });
  }

  if (command === "tui") {
    return runTuiCommand({
      args: rest,
      io,
      cwd,
      runtime: activeRuntime,
      projectRoot: global.projectRoot ?? cwd,
      selectedAgent: global.agentKind ?? defaultCliAgent(debug),
      debug,
      submitPrompt: (input) => submitTuiPrompt(input, io, cwd, activeRuntime),
      recordReviewDecision: (input) => recordTuiReviewDecision(input, activeRuntime)
    });
  }

  if (
    (command === "team" && rest[0] === "roles" && rest[1] === "list") ||
    (command === "roles" && rest[0] === "list")
  ) {
    return listTeamRoles(command === "roles" ? rest.slice(1) : rest.slice(2), io, activeRuntime);
  }

  if (
    (command === "team" && rest[0] === "roles" && rest[1] === "show") ||
    (command === "roles" && rest[0] === "show")
  ) {
    return showTeamRole(command === "roles" ? rest.slice(1) : rest.slice(2), io, activeRuntime);
  }

  if (
    (command === "team" && rest[0] === "roles" && rest[1] === "save") ||
    (command === "roles" && rest[0] === "save")
  ) {
    return saveTeamRole(command === "roles" ? rest.slice(1) : rest.slice(2), io, activeRuntime);
  }

  if (
    (command === "team" && rest[0] === "roles" && rest[1] === "import") ||
    (command === "roles" && rest[0] === "import")
  ) {
    return importTeamRoles(
      command === "roles" ? rest.slice(1) : rest.slice(2),
      io,
      activeRuntime
    );
  }

  if (
    (command === "team" && rest[0] === "roles" && rest[1] === "export") ||
    (command === "roles" && rest[0] === "export")
  ) {
    return exportTeamRoles(
      command === "roles" ? rest.slice(1) : rest.slice(2),
      io,
      activeRuntime
    );
  }

  if (
    (command === "team" && rest[0] === "roles" && rest[1] === "executor") ||
    (command === "roles" && rest[0] === "executor")
  ) {
    return showTeamRoleExecutor(
      command === "roles" ? rest.slice(1) : rest.slice(2),
      io,
      activeRuntime
    );
  }

  if (command === "tasks" && rest[0] === "list") {
    return listTasks(rest.slice(1), io, activeRuntime);
  }

  if (command === "runs" && rest[0] === "list") {
    return listRuns(io, activeRuntime);
  }

  if (command === "runs" && rest[0] === "events") {
    return showRunEvents(rest.slice(1), io, activeRuntime);
  }

  if (command === "runs" && rest[0] === "diff") {
    return showRunDiff(rest.slice(1), io, activeRuntime);
  }

  if (command === "runs" && rest[0] === "show") {
    return showRun(rest.slice(1), io, activeRuntime);
  }

  if (command === "risks" && rest[0] === "show") {
    return showRisk(rest.slice(1), io, activeRuntime);
  }

  if (command === "reviews" && rest[0] === "show") {
    return showReviewDecision(rest.slice(1), io, activeRuntime);
  }

  if (command === "reviews" && rest[0] === "accept") {
    return recordReviewDecisionCommand("accepted", rest.slice(1), io, activeRuntime);
  }

  if (command === "reviews" && rest[0] === "reject") {
    return recordReviewDecisionCommand("rejected", rest.slice(1), io, activeRuntime);
  }

  if (command === "role-calls" && rest[0] === "list") {
    return listRoleCalls(rest.slice(1), io, activeRuntime);
  }

  if (command === "role-calls" && rest[0] === "show") {
    return showRoleCall(rest.slice(1), io, activeRuntime);
  }

  if (command === "role-todos" && rest[0] === "list") {
    return listRoleTodos(rest.slice(1), io, activeRuntime);
  }

  if (command === "role-events" && rest[0] === "list") {
    return listRoleEvents(rest.slice(1), io, activeRuntime);
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

export function helpText(debug = isEnvironmentDebugEnabled()): string {
  const agentChoices = availableCliAgents(debug).join("|");
  const promptAgentChoices = availableCliAgents(debug)
    .map((agent) => `@${agent}`)
    .join("|");
  return [
    "agent-hub",
    "",
    "Usage:",
    `  agent-hub [--project <path>] [--agent ${agentChoices}]`,
    "  agent-hub [--debug] run ...",
    "  agent-hub [--db <path>] project add --name <name> --root <path>",
    "  agent-hub [--db <path>] project list",
    "  agent-hub [--db <path>] task create --project-id <project-id> --title <title> [--description <text>]",
    "  agent-hub [--db <path>] task list [--project-id <project-id>]",
    "  agent-hub [--db <path>] task history --task-id <task-id>",
    "  agent-hub context init --project-root <path> --project-id <project-id>",
    "  agent-hub context show --project-root <path> --project-id <project-id>",
    "  agent-hub context build --project-root <path> --project-id <project-id> --task-id <task-id> --title <title> --prompt <prompt>",
    "  agent-hub context export --project-root <path> --project-id <project-id> [--target repo] --dry-run|--write",
    "  agent-hub skills global create --id <id> --name <name> --description <text> [--body <markdown>] [--agent-hub-home <path>]",
    "  agent-hub skills global list [--agent-hub-home <path>]",
    `  agent-hub [--db <path>] run --task <task-id> --agent ${agentChoices} [--workspace-base <path>] [--skill [scope:]id]`,
    `  agent-hub [--db <path>] run [--repo <path>] [--workspace-base <path>] [--retain-on-failure] [--continue-from-run <run-id>|--continue-from-message <message-id>] [--skill [scope:]id] "${promptAgentChoices} <task>"`,
    "  agent-hub [--db <path>] run event add --run-id <run-id> --type <type> --message <message>",
    "  agent-hub [--db <path>] threads list",
    "  agent-hub [--db <path>] threads show <thread-id>",
    "  agent-hub [--db <path>] rooms list --project-id <project-id>",
    "  agent-hub [--db <path>] rooms create --project-id <project-id> --handle <handle> --title <title> [--description <text>]",
    "  agent-hub [--db <path>] rooms use --project-id <project-id> --room <handle-or-thread-id>",
    "  agent-hub [--db <path>] rooms send --project-id <project-id> --room <handle-or-thread-id> --message <text>",
    "  agent-hub [--db <path>] rooms timeline --project-id <project-id> --room <handle-or-thread-id>",
    "  agent-hub [--db <path>] chat [--thread <thread-id>|--room <handle-or-thread-id>]",
    "  agent-hub [--db <path>] tui [--thread <thread-id>|--room <handle-or-thread-id>] [--agent codex|claude-code] [--max-iterations <n>]",
    "  agent-hub [--db <path>] team roles list --project-id <project-id>",
    "  agent-hub [--db <path>] team roles show --project-id <project-id> --role <handle>",
    `  agent-hub [--db <path>] team roles save --project-id <project-id> --handle <handle> [--display-name <name>] [--executor ${agentChoices}|human|llm_api|workflow] [--skill [scope:]id]`,
    "  agent-hub [--db <path>] team roles import --project-id <project-id> [--path .agent-hub/team.yaml] [--preview|--write]",
    "  agent-hub [--db <path>] team roles export --project-id <project-id> [--path .agent-hub/team.yaml] [--preview|--write]",
    "  agent-hub [--db <path>] team roles executor --project-id <project-id> --role <handle>",
    "  agent-hub runs list",
    "  agent-hub runs events <run-id>",
    "  agent-hub runs diff <run-id> [--stat|--patch] [--full]",
    "  agent-hub runs show <run-id>",
    "  agent-hub risks show <run-id>",
    "  agent-hub reviews show <run-id>",
    "  agent-hub reviews accept <run-id>",
    "  agent-hub reviews reject <run-id> [--reason <text>]",
    "  agent-hub role-calls list [--thread-id <thread-id>] [--role <role>] [--status <status>] [--json]",
    "  agent-hub role-calls show <role-call-id> [--json]",
    "  agent-hub role-todos list [--thread-id <thread-id>] [--role <role>] [--status <status>] [--json]",
    "  agent-hub role-events list --role-call-id <role-call-id>|--thread-id <thread-id> [--json]",
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
  const debug = options.debug ?? false;
  const state: InteractiveState = {
    projectRoot: path.resolve(cwd, options.projectRoot ?? cwd),
    selectedAgent: options.selectedAgent ?? defaultCliAgent(debug),
    debug
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

    if (state.debug) {
      io.stdout.write(`run: ${line}\n`);
    }
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

function interactiveHelpText(state: InteractiveState): string {
  const promptExamples = [
    ...(isAgentKindEnabled("fake", cliAgentAvailability(state.debug))
      ? ["  @fake simulate the task"]
      : []),
    ...(isAgentKindEnabled("codex", cliAgentAvailability(state.debug))
      ? ["  @codex implement the task"]
      : []),
    ...(isAgentKindEnabled("claude-code", cliAgentAvailability(state.debug))
      ? ["  @claude-code review the task"]
      : [])
  ];
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
    ...promptExamples,
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
    io.stdout.write(interactiveHelpText(state));
    return "continue";
  }
  if (command === "/agents") {
    io.stdout.write(renderInteractiveAgents(state.selectedAgent, state.debug));
    return "continue";
  }
  if (command === "/use") {
    const agent = rest[0];
    if (!agent) {
      io.stderr.write("error: /use requires an agent\n");
      return "continue";
    }
    try {
      state.selectedAgent = parseInteractiveAgent(agent, state.debug);
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

function renderInteractiveAgents(selectedAgent: AgentKind, debug: boolean): string {
  return [
    "agents:",
    ...availableCliAgents(debug).map((agent) => `${agent === selectedAgent ? "*" : " "} ${agent}`),
    ""
  ].join("\n");
}

function parseInteractiveAgent(value: string, debug: boolean): AgentKind {
  return parseAvailableAgent(value, debug);
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

const roleSettingsPrefix = "desktop.project.";
const roleSettingsSuffix = ".workgroupRoles";
const maxStoredRoles = 32;
const reservedExecutorReason = "Reserved executor is not runnable in this phase.";
const defaultTeamYamlPath = ".agent-hub/team.yaml";

const teamYamlSkillReferenceSchema = z.object({
  id: z.string().min(1),
  scope: z.enum(["task", "role", "project", "global"]).optional()
}).strict();

const teamYamlContextPolicySchema = z.object({
  scope: z.string().min(1),
  includeApprovedMemory: z.boolean(),
  includeThreadSummary: z.boolean(),
  instructions: z.array(z.string())
}).strict();

const teamYamlApprovalPolicySchema = z.object({
  requiredFor: z.array(z.string()),
  summary: z.string().min(1)
}).strict();

const teamYamlExecutorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("agent_adapter"),
    adapterKind: z.enum(agentKinds),
    configRef: z.string().optional()
  }).strict(),
  z.object({
    kind: z.enum(["human", "llm_api", "workflow"]),
    configRef: z.string().optional(),
    unavailableReason: z.string().optional()
  }).strict()
]);

const teamYamlRoleSchema = z.object({
  id: z.string().min(1),
  handle: z.string().min(1),
  displayName: z.string().min(1),
  purpose: z.string().min(1),
  capabilitySummary: z.string().min(1),
  persona: z.string().min(1),
  defaultInstructions: z.string().min(1),
  permissions: z.array(z.string()),
  contextPolicy: teamYamlContextPolicySchema,
  approvalPolicy: teamYamlApprovalPolicySchema,
  executor: teamYamlExecutorSchema,
  enabled: z.boolean(),
  defaultSkillReferences: z.array(teamYamlSkillReferenceSchema).optional(),
  defaultRoom: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
}).strict();

const teamYamlSchema = z.object({
  roles: z.array(teamYamlRoleSchema).max(maxStoredRoles)
}).strict();

const defaultRoomDefinitions = [
  {
    handle: "general",
    title: "#general",
    description: "Project-wide coordination and agent prompts."
  },
  {
    handle: "planning",
    title: "#planning",
    description: "Plans, milestones, priorities, and scoped work."
  },
  {
    handle: "research",
    title: "#research",
    description: "Investigation notes, source gathering, and context questions."
  },
  {
    handle: "review",
    title: "#review",
    description: "Review requests, checks, risks, and acceptance decisions."
  },
  {
    handle: "knowledge",
    title: "#knowledge",
    description: "Memory proposals, decisions, summaries, and reusable context."
  }
] as const;

type RoomType = "default" | "custom";

interface CliRoomMetadata extends JsonObject {
  source: string;
  roomType: RoomType;
  roomHandle: string;
  description: string;
}

interface ResolvedRole {
  role: WorkgroupRole;
  source: "preset" | "preset_override" | "custom" | "yaml_override" | "yaml_custom";
}

interface CliMentionParticipant {
  agentKind: AgentKind;
  role?: WorkgroupRoleRunMetadata;
  source: "adapter_mention" | "role_mention";
}

interface CliMentionParseResult {
  agentMentions: AgentKind[];
  roleMentions: WorkgroupRoleRunMetadata[];
  participants: CliMentionParticipant[];
  cleanedPrompt: string;
}

interface ParsedCliChatTurn extends CliMentionParseResult {
  prompt: string;
  teamRoles: WorkgroupRoleRunMetadata[];
  workgroupRoles: readonly WorkgroupRole[];
}

export interface ChatOptions {
  io?: CliIO;
  cwd?: string;
  runtime?: CliRuntime;
  projectRoot?: string;
  selectedAgent?: AgentKind;
  debug?: boolean;
  args?: string[];
  input?: AsyncIterable<string>;
}

interface ParsedChatArgs {
  threadId?: string;
  roomRef?: string;
  workspaceBasePath?: string;
  retainOnFailure: boolean;
  dryRun: boolean;
  debug: boolean;
}

interface ChatState {
  projectRoot: string;
  project: Project;
  selectedAgent: AgentKind;
  threadId?: string;
  roomHandle?: string;
  workspaceBasePath?: string;
  retainOnFailure: boolean;
  dryRun: boolean;
  debug: boolean;
  pendingContinueFrom?: RunContinuationInput;
}

export async function runChat(options: ChatOptions = {}): Promise<number> {
  const io = options.io ?? {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr
  };
  const cwd = options.cwd ?? process.cwd();
  const runtime = options.runtime ?? getDefaultRuntime();
  let parsed: ParsedChatArgs;
  let state: ChatState;

  try {
    parsed = parseChatArgs(options.args ?? [], cwd);
    const projectRoot = path.resolve(cwd, options.projectRoot ?? cwd);
    const project = parsed.threadId
      ? await projectForThread(runtime, parsed.threadId)
      : await ensureProjectForRoot(runtime, projectRoot);
    const roomThread = parsed.roomRef
      ? await resolveRoomThread(runtime, project.id, parsed.roomRef)
      : undefined;
    const debug = options.debug === true || parsed.debug;
    state = {
      projectRoot: project.rootPath,
      project,
      selectedAgent: options.selectedAgent ?? defaultCliAgent(debug),
      threadId: parsed.threadId ?? roomThread?.id,
      roomHandle: roomThread ? roomHandleForThread(roomThread) : undefined,
      workspaceBasePath: parsed.workspaceBasePath,
      retainOnFailure: parsed.retainOnFailure,
      dryRun: parsed.dryRun,
      debug
    };
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  const input = options.input ?? readInteractiveLines(io.stdin ?? process.stdin);
  io.stdout.write(renderChatBanner(state));
  io.stdout.write(chatPrompt(state));

  for await (const rawLine of input) {
    const line = rawLine.trim();
    if (!line) {
      io.stdout.write(chatPrompt(state));
      continue;
    }
    if (line.startsWith("/")) {
      const action = await handleChatSlash(line, io, runtime, state);
      if (action === "exit") {
        return 0;
      }
      io.stdout.write(chatPrompt(state));
      continue;
    }

    try {
      const exitCode = await runChatTurn(line, io, runtime, state);
      if (exitCode !== 0) {
        io.stderr.write(`chat run failed with exit code ${exitCode}\n`);
      }
    } catch (error) {
      io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    io.stdout.write(chatPrompt(state));
  }

  return 0;
}

async function projectForThread(
  runtime: CliRuntime,
  threadId: string
): Promise<Project> {
  const thread = await requireChatThread(runtime, threadId);
  const project = await runtime.projectRepository.get(thread.projectId);
  if (!project) {
    throw new Error(`project ${thread.projectId} for thread ${threadId} not found`);
  }
  return project;
}

function parseChatArgs(args: string[], cwd: string): ParsedChatArgs {
  let threadId: string | undefined;
  let roomRef: string | undefined;
  let workspaceBasePath: string | undefined;
  let retainOnFailure = false;
  let dryRun = false;
  let debug = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--thread") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--thread requires an id");
      }
      threadId = value;
      index += 1;
      continue;
    }
    if (arg === "--room") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--room requires a handle or thread id");
      }
      roomRef = value;
      index += 1;
      continue;
    }
    if (arg === "--workspace-base") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--workspace-base requires a path");
      }
      workspaceBasePath = path.resolve(cwd, value);
      index += 1;
      continue;
    }
    if (arg === "--retain-on-failure") {
      retainOnFailure = true;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--debug") {
      debug = true;
      continue;
    }
    throw new Error(`unknown chat argument ${arg}`);
  }

  if (threadId && roomRef) {
    throw new Error("chat accepts only one of --thread or --room");
  }

  return { threadId, roomRef, workspaceBasePath, retainOnFailure, dryRun, debug };
}

function renderChatBanner(state: ChatState): string {
  return [
    "Agent Hub chat",
    `project: ${state.projectRoot}`,
    `thread: ${state.threadId ?? "new"}`,
    `room: ${state.roomHandle ? `#${state.roomHandle}` : "none"}`,
    `agent: ${state.selectedAgent}`,
    "use /rooms, /room use <handle>, /roles, or mention @role handles in prompts",
    "use /continue run <id> or /continue message <id> for one-shot code-state continuation",
    "type /exit to quit",
    ""
  ].join("\n");
}

function chatPrompt(state: ChatState): string {
  const room = state.roomHandle ? `#${state.roomHandle}` : state.threadId ?? "new";
  return `agent-hub-chat[${state.selectedAgent}][${room}]> `;
}

async function handleChatSlash(
  line: string,
  io: CliIO,
  runtime: CliRuntime,
  state: ChatState
): Promise<"continue" | "exit"> {
  const [command, ...rest] = line.split(/\s+/);
  if (command === "/thread" && rest[0] === "new") {
    const title = rest.slice(1).join(" ").trim();
    const thread = await createChatThread(runtime, state.project, title || "New Chat");
    state.threadId = thread.id;
    state.roomHandle = undefined;
    io.stdout.write(`created thread: ${thread.id}\n`);
    return "continue";
  }
  if (command === "/thread" && rest[0] === "use") {
    const threadId = rest[1];
    if (!threadId) {
      io.stderr.write("error: /thread use requires an id\n");
      return "continue";
    }
    try {
      const thread = await selectChatThread(runtime, state, threadId);
      io.stdout.write(`using thread: ${thread.id}\n`);
    } catch (error) {
      io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    return "continue";
  }
  if (command === "/threads") {
    await renderChatThreads(io, runtime);
    return "continue";
  }
  if (command === "/rooms") {
    await renderRooms(io, runtime, state.project.id);
    return "continue";
  }
  if (command === "/room" && rest[0] === "use") {
    const roomRef = rest[1];
    if (!roomRef) {
      io.stderr.write("error: /room use requires a handle or thread id\n");
      return "continue";
    }
    try {
      const thread = await resolveRoomThread(runtime, state.project.id, roomRef);
      await selectChatThread(runtime, state, thread.id);
      state.roomHandle = roomHandleForThread(thread);
      io.stdout.write(
        `using room: ${state.roomHandle ? `#${state.roomHandle}` : thread.id}\n`
      );
    } catch (error) {
      io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    return "continue";
  }
  if (command === "/room" && rest[0] === "create") {
    const handle = rest[1];
    const title = rest.slice(2).join(" ").trim();
    if (!handle) {
      io.stderr.write("error: /room create requires a handle\n");
      return "continue";
    }
    try {
      const thread = await createRoomThread(runtime, {
        projectId: state.project.id,
        handle,
        title: title || handle,
        description: "Created from CLI chat."
      });
      state.threadId = thread.id;
      state.roomHandle = roomHandleForThread(thread);
      io.stdout.write(`created room: #${state.roomHandle} (${thread.id})\n`);
    } catch (error) {
      io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    return "continue";
  }
  if (command === "/room" && rest[0] === "timeline") {
    if (!state.threadId) {
      io.stdout.write("No active room.\n");
      return "continue";
    }
    await renderRoomTimeline(io, runtime, state.threadId);
    return "continue";
  }
  if (command === "/roles") {
    await renderTeamRoles(io, runtime, state.project.id);
    return "continue";
  }
  if (command === "/role") {
    const roleHandle = rest[0];
    if (!roleHandle) {
      io.stderr.write("error: /role requires a handle\n");
      return "continue";
    }
    try {
      await renderTeamRole(io, runtime, state.project.id, roleHandle);
    } catch (error) {
      io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    return "continue";
  }
  if (command === "/history") {
    if (!state.threadId) {
      io.stdout.write("No active thread.\n");
      return "continue";
    }
    await renderChatThreadDetail(io, runtime, state.threadId);
    return "continue";
  }
  if (command === "/continue") {
    const mode = rest[0];
    const value = rest[1];
    if (mode === "clear") {
      state.pendingContinueFrom = undefined;
      io.stdout.write("cleared pending code-state continuation\n");
      return "continue";
    }
    if (mode !== "run" && mode !== "message") {
      io.stderr.write("error: /continue requires run <id>, message <id>, or clear\n");
      return "continue";
    }
    if (!value) {
      io.stderr.write(`error: /continue ${mode} requires an id\n`);
      return "continue";
    }
    try {
      state.pendingContinueFrom = await resolveRunContinuation(
        mode === "run"
          ? { continueFromRunId: value }
          : { continueFromMessageId: value },
        runtime
      );
      io.stdout.write(
        `next turn will continue from run: ${state.pendingContinueFrom?.parentRunId}\n`
      );
    } catch (error) {
      io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    return "continue";
  }
  if (command === "/exit") {
    io.stdout.write("Exiting Agent Hub chat.\n");
    return "exit";
  }
  io.stderr.write(`error: unknown chat command ${command}\n`);
  return "continue";
}

async function runChatTurn(
  rawLine: string,
  io: CliIO,
  runtime: CliRuntime,
  state: ChatState
): Promise<number> {
  const parsed = await parseCliChatTurn(runtime, state, rawLine);
  const prompt = parsed.prompt.trim();
  if (!prompt) {
    throw new Error("chat prompt is required");
  }

  const thread = state.threadId
    ? await requireChatThread(runtime, state.threadId)
    : await createChatThread(runtime, state.project, titleFromPrompt(prompt));
  state.threadId = thread.id;
  state.roomHandle = roomHandleForThread(thread) ?? state.roomHandle;
  const priorMessages = await runtime.conversationMessageRepository.listByThreadId(thread.id);
  const userMessage = await appendChatMessage(runtime, thread.id, {
    role: "user",
    kind: "text",
    content: prompt,
    metadata: {
      source: "cli_chat",
      mentions: parsed.agentMentions,
      roleMentions: parsed.roleMentions.map((role) => role.roleHandle)
    }
  });
  const currentThread = await retitleThreadFromPrompt(runtime, thread, prompt);
  const taskId = createId("task");
  let assignments = createCliTaskAssignments({
    taskId,
    threadId: currentThread.id,
    sourceMessageId: userMessage.id,
    participants: parsed.participants,
    roleMentions: parsed.roleMentions
  });
  await runtime.taskRepository.create(
    validateTask({
      id: taskId,
      projectId: state.project.id,
      title: titleFromPrompt(prompt),
      description: prompt,
      metadata: cliTaskMetadata({
        thread: currentThread,
        sourceMessageId: userMessage.id,
        assignments
      }),
      status: "open",
      createdAt: userMessage.createdAt,
      updatedAt: userMessage.createdAt
    })
  );

  const executableParticipants = parsed.participants.filter((participant) =>
    Boolean(assignmentForCliParticipant(assignments, participant)?.executable)
  );
  if (executableParticipants.length === 0) {
    await appendChatMessage(runtime, currentThread.id, {
      role: "system",
      kind: "text",
      content: "No executable participants are available for this room message.",
      metadata: {
        source: "cli_chat",
        taskId,
        assignments
      }
    });
    await refreshChatThreadSummary(runtime, currentThread.id);
    io.stdout.write("No executable participants are available for this room message.\n");
    return 0;
  }

  let ok = true;
  let pendingContinueFrom = state.pendingContinueFrom;
  state.pendingContinueFrom = undefined;
  for (const participant of executableParticipants) {
    const assignment = assignmentForCliParticipant(assignments, participant);
    if (!assignment) {
      continue;
    }
    const conversationBrief = await buildChatConversationBrief({
      runtime,
      thread: currentThread,
      currentTurn: prompt,
      currentMessageCreatedAt: userMessage.createdAt,
      agentKind: participant.agentKind,
      role: participant.role,
      workgroupRoles: parsed.workgroupRoles,
      priorMessages
    });
    const runInput: RunTaskInput = {
      projectRoot: state.projectRoot,
      projectId: state.project.id,
      taskId,
      taskStatusMode: "shared_task",
      title: titleFromPrompt(prompt),
      taskPrompt: prompt,
      agentKind: participant.agentKind,
      agentAvailability: cliAgentAvailability(state.debug),
      deliveryMode: "runtime_injection",
      conversationBrief,
      roleSkillReferences: participant.role?.defaultSkillReferences,
      role: participant.role,
      teamRoles: participant.role ? parsed.teamRoles : undefined,
      workspaceBasePath: state.workspaceBasePath,
      workspaceCleanupPolicy: state.retainOnFailure ? "retain_on_failure" : undefined,
      dryRun: state.dryRun,
      continueFrom: pendingContinueFrom
    };
    pendingContinueFrom = undefined;

    let result: CliRunResult | undefined;
    try {
      result = await runtime.taskRunner.run(runInput);
    } catch (error) {
      assignments = updateCliAssignment(assignments, assignment.assignmentId, {
        status: "failed"
      });
      await saveCliTaskAssignments(runtime, taskId, assignments);
      await appendChatMessage(runtime, currentThread.id, {
        role: "system",
        kind: "text",
        content: `${cliParticipantLabel(participant)} could not start: ${errorMessage(error)}`,
        metadata: { source: "cli_chat", taskId, assignment }
      });
      ok = false;
      continue;
    }

    assignments = updateCliAssignment(assignments, assignment.assignmentId, {
      runId: result.run.id,
      status: assignmentStatusFromRunStatus(result.run.status)
    });
    await saveCliTaskAssignments(runtime, taskId, assignments);
    const linkedAssignment =
      assignments.find((entry) => entry.assignmentId === assignment.assignmentId) ??
      assignment;
    await appendChatMessage(runtime, currentThread.id, {
      role: "tool",
      kind: "run_card",
      content: `${cliParticipantLabel(participant)} ${result.run.status}`,
      agentKind: result.run.agentKind,
      runId: result.run.id,
      status: result.run.status,
      metadata: {
        source: "cli_chat",
        agentKind: participant.agentKind,
        role: participant.role,
        taskId,
        assignment: linkedAssignment
      }
    });
    const assistantMessage = await appendChatMessage(runtime, currentThread.id, {
      role: "assistant",
      kind: "text",
      content: chatAssistantContent(result),
      agentKind: result.run.agentKind,
      runId: result.run.id,
      status: result.run.status,
      metadata: {
        source: "cli_chat",
        assistantOutput: true,
        terminalStatus: result.run.status,
        role: participant.role,
        taskId,
        assignment: linkedAssignment
      }
    });
    io.stdout.write(renderAgentOutput(result));
    if (state.debug) {
      io.stdout.write(renderRunDebug(result, runInput, "runtime_injection"));
    }
    const roleCallOk = await processCliRoleCallOutput({
      runtime,
      state,
      thread: currentThread,
      message: assistantMessage,
      workgroupRoles: parsed.workgroupRoles,
      io
    });
    ok &&= result.ok;
    ok &&= roleCallOk;
  }

  await refreshChatThreadSummary(runtime, currentThread.id);
  return ok ? 0 : 1;
}

async function processCliRoleCallOutput(input: {
  runtime: CliRuntime;
  state: ChatState;
  thread: ConversationThread;
  message: ConversationMessage;
  workgroupRoles: readonly WorkgroupRole[];
  io: CliIO;
}): Promise<boolean> {
  const role = metadataRoleRun(input.message.metadata);
  if (!role) {
    return true;
  }
  const roleDefinitions = roleDefinitionsForWorkgroupRoles(input.workgroupRoles);
  const result = await processAssistantRoleCallOutput({
    repositories: {
      conversationMessageRepository: input.runtime.conversationMessageRepository,
      roleCallRepository: input.runtime.roleCallRepository,
      roleCallEventRepository: input.runtime.roleCallEventRepository,
      roleTodoRepository: input.runtime.roleTodoRepository
    },
    threadId: input.thread.id,
    callerRole: role.roleHandle,
    message: input.message,
    roles: roleDefinitions,
    userGoal: await cliRoleCallUserGoal(input.runtime, input.message),
    currentPlan: input.message.content,
    policyValidator: (request) =>
      validateRoleCallPolicy({
        callerRole: request.callerRole,
        calleeRole: request.calleeRole,
        intent: request.intent,
        currentDepth: request.currentDepth,
        activeRoleCalls: request.activeRoleCalls,
        existingRoleCalls: request.existingRoleCalls,
        roleTodos: request.roleTodos
      }),
    idFactory: createId,
    now: nowIso,
    executeAcceptedRoleCalls: ({ parentMessageId, roleDefinitions: definitions }) =>
      executeAcceptedCliRoleCalls({
        runtime: input.runtime,
        state: input.state,
        thread: input.thread,
        parentMessageId,
        workgroupRoles: input.workgroupRoles,
        roleDefinitions: definitions,
        io: input.io
      })
  });
  return result.ok;
}

async function executeAcceptedCliRoleCalls(input: {
  runtime: CliRuntime;
  state: ChatState;
  thread: ConversationThread;
  parentMessageId: string;
  workgroupRoles: readonly WorkgroupRole[];
  roleDefinitions: readonly RoleDefinition[];
  io: CliIO;
}): Promise<{ ok: boolean; warnings: string[] }> {
  const warnings: string[] = [];
  let ok = true;
  const executableRoles = new Set(
    input.roleDefinitions
      .filter((role) => role.executor.kind === "agent_adapter")
      .map((role) => role.handle)
  );
  const calls = (await input.runtime.roleCallRepository.list({
    threadId: input.thread.id
  })).filter(
    (call) =>
      call.parentMessageId === input.parentMessageId &&
      call.status === "accepted" &&
      !call.taskRunId &&
      executableRoles.has(call.calleeRole)
  );
  const executor = new RoleCallTaskRunnerExecutor({
    taskRunner: input.runtime.taskRunner,
    repositories: {
      roleCallRepository: input.runtime.roleCallRepository,
      roleCallEventRepository: input.runtime.roleCallEventRepository,
      roleTodoRepository: input.runtime.roleTodoRepository
    },
    roles: input.roleDefinitions,
    idFactory: createId,
    now: nowIso
  });

  for (const call of calls) {
    const role = input.workgroupRoles.find((entry) => entry.handle === call.calleeRole);
    const roleMetadata = role ? toWorkgroupRoleRunMetadata(role) : undefined;
    try {
      const executed = await executor.execute({
        roleCallId: call.id,
        projectId: input.thread.projectId,
        projectRoot: input.state.projectRoot,
        taskRunnerOptions: {
          agentAvailability: cliAgentAvailability(input.state.debug),
          deliveryMode: "runtime_injection",
          workspaceBasePath: input.state.workspaceBasePath,
          workspaceCleanupPolicy: input.state.retainOnFailure
            ? "retain_on_failure"
            : undefined,
          dryRun: input.state.dryRun
        }
      });
      if (!executed.run) {
        ok = false;
        if (executed.error) {
          warnings.push(`@${call.calleeRole} execution failed: ${executed.error}`);
        }
        continue;
      }
      const assignment = cliRoleCallAssignment({
        roleCall: executed.roleCall,
        role: roleMetadata,
        runId: executed.run.run.id
      });
      await appendChatMessage(input.runtime, input.thread.id, {
        role: "tool",
        kind: "run_card",
        content: `@${executed.roleCall.calleeRole} ${executed.run.run.status}`,
        agentKind: executed.run.run.agentKind,
        runId: executed.run.run.id,
        status: executed.run.run.status,
        metadata: {
          source: "cli_chat",
          agentKind: executed.run.run.agentKind,
          role: roleMetadata,
          taskId: executed.roleCall.id,
          roleCallId: executed.roleCall.id,
          assignment
        }
      });
      const assistantMessage = await appendChatMessage(input.runtime, input.thread.id, {
        role: "assistant",
        kind: "text",
        content: chatAssistantContent(executed.run),
        agentKind: executed.run.run.agentKind,
        runId: executed.run.run.id,
        status: executed.run.run.status,
        metadata: {
          source: "cli_chat",
          assistantOutput: true,
          terminalStatus: executed.run.run.status,
          role: roleMetadata,
          taskId: executed.roleCall.id,
          roleCallId: executed.roleCall.id,
          assignment
        }
      });
      input.io.stdout.write(renderAgentOutput(executed.run));
      if (input.state.debug) {
        input.io.stdout.write(renderRunDebug(executed.run, {
          projectRoot: input.state.projectRoot,
          projectId: input.thread.projectId,
          taskId: executed.roleCall.id,
          title: `Role call: @${executed.roleCall.calleeRole} ${executed.roleCall.task}`,
          taskPrompt: executed.roleCall.task,
          agentKind: executed.run.run.agentKind
        }, "runtime_injection"));
      }
      ok &&= executed.ok;
      ok &&= await processCliRoleCallOutput({
        runtime: input.runtime,
        state: input.state,
        thread: input.thread,
        message: assistantMessage,
        workgroupRoles: input.workgroupRoles,
        io: input.io
      });
    } catch (error) {
      ok = false;
      warnings.push(`@${call.calleeRole} execution failed: ${errorMessage(error)}`);
    }
  }
  return { ok, warnings };
}

async function cliRoleCallUserGoal(
  runtime: CliRuntime,
  message: ConversationMessage
): Promise<string> {
  const assignment = metadataAssignment(message.metadata);
  if (assignment?.sourceMessageId) {
    const sourceMessage = await runtime.conversationMessageRepository.get(
      assignment.sourceMessageId
    );
    if (sourceMessage?.content.trim()) {
      return sourceMessage.content;
    }
  }
  const taskId = metadataString(message.metadata, "taskId") ?? assignment?.taskId;
  if (taskId) {
    const task = await runtime.taskRepository.get(taskId);
    if (task?.description?.trim()) {
      return task.description;
    }
    if (task?.title.trim()) {
      return task.title;
    }
  }
  return message.content;
}

function cliRoleCallAssignment(input: {
  roleCall: RoleCall;
  role?: WorkgroupRoleRunMetadata;
  runId: string;
}): WorkgroupTaskAssignmentMetadata {
  const adapterKind =
    input.role?.executorKind === "agent_adapter" ? input.role.adapterKind : undefined;
  return {
    assignmentId: createId("assignment"),
    taskId: input.roleCall.id,
    threadId: input.roleCall.threadId,
    sourceMessageId: input.roleCall.parentMessageId ?? input.roleCall.id,
    assignmentRole: "role",
    agentId: adapterKind === "claude-code" ? "claude" : adapterKind,
    roleHandle: input.roleCall.calleeRole,
    displayName: input.role?.displayName ?? `@${input.roleCall.calleeRole}`,
    executorKind: input.role?.executorKind ?? "agent_adapter",
    adapterKind,
    executable: true,
    runId: input.runId,
    status: roleCallAssignmentStatus(input.roleCall)
  };
}

function roleCallAssignmentStatus(
  roleCall: RoleCall
): WorkgroupTaskAssignmentMetadata["status"] {
  if (roleCall.status === "succeeded") {
    return "completed";
  }
  if (roleCall.status === "failed") {
    return "failed";
  }
  if (roleCall.status === "cancelled") {
    return "cancelled";
  }
  if (roleCall.status === "running") {
    return "running";
  }
  return "queued";
}

async function buildChatConversationBrief(input: {
  runtime: CliRuntime;
  thread: ConversationThread;
  currentTurn: string;
  currentMessageCreatedAt: string;
  agentKind: AgentKind;
  role?: WorkgroupRoleRunMetadata;
  workgroupRoles: readonly WorkgroupRole[];
  priorMessages: ConversationMessage[];
}) {
  const contextSourceMessages = chatContextSourceMessagesForAgent(
    input.priorMessages,
    input.agentKind
  );
  const messages = await Promise.all(
    contextSourceMessages.map((message) =>
      toChatConversationContextMessage(input.runtime, message)
    )
  );
  return new ConversationContextBuilder().build({
    thread: {
      id: input.thread.id,
      title: input.thread.title,
      projectId: input.thread.projectId
    },
    currentTurn: {
      content: input.currentTurn,
      agentId: input.agentKind,
      contextMode: "auto",
      deliveryMode: "runtime_injection",
      createdAt: input.currentMessageCreatedAt
    },
    messages,
    threadSummary: await input.runtime.conversationThreadSummaryRepository.getByThreadId(
      input.thread.id
    ),
    projectContextReferences: [
      `project:${input.thread.projectId}`,
      "Agent Hub-owned project context store",
      "Approved memory only; thread context is not promoted automatically",
      ...roleContextReferences(input.role),
      ...roleProtocolReferences(input.role, input.workgroupRoles)
    ]
  });
}

function chatContextSourceMessagesForAgent(
  messages: ConversationMessage[],
  agentKind: AgentKind
): ConversationMessage[] {
  const assistantRunIds = new Set(
    messages
      .filter((message) => isChatAssistantContextMessage(message) && message.runId)
      .map((message) => message.runId as string)
  );
  return messages.filter((message) => {
    if (isPendingChatAssistantMessage(message) || isInternalChatTimelineMessage(message)) {
      return false;
    }
    if (
      message.kind === "run_card" &&
      message.runId &&
      assistantRunIds.has(message.runId)
    ) {
      return false;
    }
    if (message.role === "assistant" || message.kind === "run_card") {
      return message.agentKind ? message.agentKind === agentKind : true;
    }
    return true;
  });
}

function isChatAssistantContextMessage(message: ConversationMessage): boolean {
  return message.role === "assistant" && !isPendingChatAssistantMessage(message);
}

function isPendingChatAssistantMessage(message: ConversationMessage): boolean {
  return message.role === "assistant" && message.metadata?.pending === true;
}

function isInternalChatTimelineMessage(message: ConversationMessage): boolean {
  return (
    message.role === "system" &&
    (typeof message.metadata?.taskEvent === "string" ||
      typeof message.metadata?.workflowEvent === "string")
  );
}

async function toChatConversationContextMessage(
  runtime: CliRuntime,
  message: ConversationMessage
): Promise<ConversationContextMessage> {
  if (message.kind === "run_card") {
    return {
      id: message.id,
      role: "tool",
      kind: "run_summary",
      content: message.content,
      summary: message.runId
        ? await chatRunSummaryForConversation(runtime, message.runId)
        : undefined,
      agentId: message.agentKind,
      runId: message.runId,
      status: message.status,
      createdAt: message.createdAt,
      metadata: message.metadata
    };
  }
  return {
    id: message.id,
    role: message.role,
    kind: message.kind,
    content: message.content,
    agentId: message.agentKind,
    runId: message.runId,
    status: message.status,
    createdAt: message.createdAt,
    metadata: message.metadata
  };
}

async function chatRunSummaryForConversation(
  runtime: CliRuntime,
  runId: string
): Promise<string | undefined> {
  const run = await runtime.taskRunRepository.get(runId);
  if (!run) {
    return undefined;
  }
  const task = await runtime.taskRepository.get(run.taskId);
  return `@${run.agentKind} ${run.status}: ${task?.title ?? run.taskId}`;
}

async function appendChatMessage(
  runtime: CliRuntime,
  threadId: string,
  input: Omit<ConversationMessage, "id" | "threadId" | "sequence" | "createdAt">
): Promise<ConversationMessage> {
  const message = await runtime.conversationMessageRepository.create(
    validateConversationMessage({
      id: createId("message"),
      threadId,
      sequence: await runtime.conversationMessageRepository.countByThreadId(threadId),
      createdAt: nowIso(),
      ...input
    })
  );
  const thread = await runtime.conversationThreadRepository.get(threadId);
  if (thread) {
    await runtime.conversationThreadRepository.update(
      validateConversationThread({
        ...thread,
        updatedAt: message.createdAt
      })
    );
  }
  return message;
}

async function refreshChatThreadSummary(
  runtime: CliRuntime,
  threadId: string
): Promise<ConversationThreadSummary> {
  const messages = await runtime.conversationMessageRepository.listByThreadId(threadId);
  const summaryInputMessages = await Promise.all(
    messages
      .filter((message) => message.kind !== "run_card")
      .map((message) => toChatConversationContextMessage(runtime, message))
  );
  const built = new ConversationThreadSummaryBuilder().build({
    messages: summaryInputMessages
  });
  const existing =
    await runtime.conversationThreadSummaryRepository.getByThreadId(threadId);
  const now = nowIso();
  return runtime.conversationThreadSummaryRepository.upsert(
    validateConversationThreadSummary({
      id: existing?.id ?? createId("thread_summary"),
      threadId,
      summary: built.summary,
      decisions: built.decisions,
      openItems: built.openItems,
      constraints: built.constraints,
      lastKnownUserGoal: built.lastKnownUserGoal,
      sourceMessageCount: built.sourceMessageCount,
      sourceLatestMessageId: built.sourceLatestMessageId,
      metadata: built.metadata,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    })
  );
}

async function createChatThread(
  runtime: CliRuntime,
  project: Project,
  title: string
): Promise<ConversationThread> {
  const now = nowIso();
  return runtime.conversationThreadRepository.create(
    validateConversationThread({
      id: createId("thread"),
      projectId: project.id,
      title: titleFromPrompt(title) || "New Chat",
      metadata: { source: "cli_chat" },
      createdAt: now,
      updatedAt: now
    })
  );
}

async function retitleThreadFromPrompt(
  runtime: CliRuntime,
  thread: ConversationThread,
  prompt: string
): Promise<ConversationThread> {
  if (thread.title !== "New Chat") {
    return thread;
  }
  const title = titleFromPrompt(prompt);
  if (!title || title === thread.title) {
    return thread;
  }
  return runtime.conversationThreadRepository.update(
    validateConversationThread({
      ...thread,
      title,
      updatedAt: nowIso()
    })
  );
}

async function selectChatThread(
  runtime: CliRuntime,
  state: ChatState,
  threadId: string
): Promise<ConversationThread> {
  const thread = await requireChatThread(runtime, threadId);
  const project = await runtime.projectRepository.get(thread.projectId);
  if (!project) {
    throw new Error(`project ${thread.projectId} for thread ${threadId} not found`);
  }
  state.threadId = thread.id;
  state.project = project;
  state.projectRoot = project.rootPath;
  state.roomHandle = roomHandleForThread(thread);
  return thread;
}

async function requireChatThread(
  runtime: CliRuntime,
  threadId: string
): Promise<ConversationThread> {
  const thread = await runtime.conversationThreadRepository.get(threadId);
  if (!thread) {
    throw new Error(`thread ${threadId} not found`);
  }
  return thread;
}

async function listThreads(
  io: CliIO,
  runtime: CliRuntime
): Promise<number> {
  await renderChatThreads(io, runtime);
  return 0;
}

async function showThread(
  args: string[],
  io: CliIO,
  runtime: CliRuntime
): Promise<number> {
  const threadId = args[0];
  if (!threadId) {
    io.stderr.write("error: thread id is required\n");
    return 1;
  }
  try {
    await renderChatThreadDetail(io, runtime, threadId);
    return 0;
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function listRooms(
  args: string[],
  io: CliIO,
  runtime: CliRuntime
): Promise<number> {
  try {
    const projectId = requiredFlag(args, "--project-id");
    await requireProject(runtime, projectId);
    await renderRooms(io, runtime, projectId);
    return 0;
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function createRoom(
  args: string[],
  io: CliIO,
  runtime: CliRuntime
): Promise<number> {
  try {
    const projectId = requiredFlag(args, "--project-id");
    await requireProject(runtime, projectId);
    const thread = await createRoomThread(runtime, {
      projectId,
      handle: requiredFlag(args, "--handle"),
      title: requiredFlag(args, "--title"),
      description: optionalFlag(args, "--description") ?? "Custom CLI room."
    });
    const roomHandle = roomHandleForThread(thread);
    io.stdout.write(
      [
        "Created room",
        `thread_id: ${thread.id}`,
        `room: ${roomHandle ? `#${roomHandle}` : thread.id}`,
        `title: ${thread.title}`,
        ""
      ].join("\n")
    );
    return 0;
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function useRoom(
  args: string[],
  io: CliIO,
  runtime: CliRuntime
): Promise<number> {
  try {
    const projectId = requiredFlag(args, "--project-id");
    await requireProject(runtime, projectId);
    const thread = await resolveRoomThread(runtime, projectId, requiredFlag(args, "--room"));
    const roomHandle = roomHandleForThread(thread);
    io.stdout.write(
      [
        "Using room",
        `thread_id: ${thread.id}`,
        `room: ${roomHandle ? `#${roomHandle}` : thread.id}`,
        `command: agent-hub chat --thread ${thread.id}`,
        ""
      ].join("\n")
    );
    return 0;
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function sendRoomMessage(
  args: string[],
  io: CliIO,
  cwd: string,
  runtime: CliRuntime,
  inheritedDebug: boolean
): Promise<number> {
  try {
    const projectId = requiredFlag(args, "--project-id");
    const project = await requireProject(runtime, projectId);
    const thread = await resolveRoomThread(runtime, projectId, requiredFlag(args, "--room"));
    const message = requiredFlag(args, "--message");
    const state: ChatState = {
      projectRoot: project.rootPath,
      project,
      selectedAgent: parseInteractiveAgent(
        optionalFlag(args, "--agent") ?? defaultCliAgent(inheritedDebug || args.includes("--debug")),
        inheritedDebug || args.includes("--debug")
      ),
      threadId: thread.id,
      roomHandle: roomHandleForThread(thread),
      workspaceBasePath: optionalFlag(args, "--workspace-base")
        ? path.resolve(cwd, requiredFlag(args, "--workspace-base"))
        : undefined,
      retainOnFailure: args.includes("--retain-on-failure"),
      dryRun: args.includes("--dry-run"),
      debug: inheritedDebug || args.includes("--debug")
    };
    return runChatTurn(message, io, runtime, state);
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function submitTuiPrompt(
  input: TuiPromptSubmissionInput,
  io: CliIO,
  cwd: string,
  runtime: CliRuntime
): Promise<{
  ok: boolean;
  exitCode: number;
  projectId?: string;
  threadId?: string;
  message: string;
}> {
  try {
    const project = input.threadId
      ? await projectForThread(runtime, input.threadId)
      : input.projectId
        ? await requireProject(runtime, input.projectId)
        : await ensureProjectForRoot(runtime, input.projectRoot);
    const roomThread = input.roomRef
      ? await resolveRoomThread(runtime, project.id, input.roomRef)
      : undefined;
    const state: ChatState = {
      projectRoot: project.rootPath,
      project,
      selectedAgent: input.selectedAgent,
      threadId: input.threadId ?? roomThread?.id,
      roomHandle: roomThread ? roomHandleForThread(roomThread) : undefined,
      workspaceBasePath: input.workspaceBasePath
        ? path.resolve(cwd, input.workspaceBasePath)
        : undefined,
      retainOnFailure: input.retainOnFailure,
      dryRun: input.dryRun,
      debug: input.debug
    };
    const capturedIo = createBufferedCliIO(io);
    const exitCode = await runChatTurn(input.prompt, capturedIo.io, runtime, state);
    const capturedError = firstLine(capturedIo.stderr.join(""));
    return {
      ok: exitCode === 0,
      exitCode,
      projectId: state.project.id,
      threadId: state.threadId,
      message:
        exitCode === 0
          ? `Submitted prompt to ${state.roomHandle ? `#${state.roomHandle}` : state.threadId ?? "new thread"}.`
          : `Submitted prompt failed with exit code ${exitCode}${capturedError ? `: ${capturedError}` : ""}.`
    };
  } catch (error) {
    return {
      ok: false,
      exitCode: 1,
      projectId: input.projectId,
      threadId: input.threadId,
      message: errorMessage(error)
    };
  }
}

function createBufferedCliIO(source: CliIO): {
  io: CliIO;
  stdout: string[];
  stderr: string[];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdin: source.stdin,
      stdout: { write: bufferedWrite(stdout) },
      stderr: { write: bufferedWrite(stderr) }
    },
    stdout,
    stderr
  };
}

function bufferedWrite(buffer: string[]): (chunk: string) => boolean {
  return (chunk: string) => {
    buffer.push(String(chunk));
    return true;
  };
}

async function recordTuiReviewDecision(
  input: { runId: string; status: "accepted" | "rejected"; reason?: string },
  runtime: CliRuntime
): Promise<{ ok: boolean; message: string }> {
  try {
    const decision = await recordRunReviewDecision(
      {
        taskRunRepository: runtime.taskRunRepository,
        runArtifactRepository: runtime.runArtifactRepository
      },
      {
        runId: input.runId,
        status: input.status,
        reason: input.reason,
        idFactory: createId,
        now: nowIso
      }
    );
    return {
      ok: true,
      message: `Review ${decision.reviewStatus} for ${decision.runId}. No repository action was performed.`
    };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

async function showRoomTimeline(
  args: string[],
  io: CliIO,
  runtime: CliRuntime
): Promise<number> {
  try {
    const projectId = optionalFlag(args, "--project-id");
    const roomRef = optionalFlag(args, "--room") ?? args[0];
    if (!roomRef) {
      throw new Error("--room or thread id is required");
    }
    const thread = projectId
      ? await resolveRoomThread(runtime, projectId, roomRef)
      : await requireChatThread(runtime, roomRef);
    await renderRoomTimeline(io, runtime, thread.id);
    return 0;
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function listTeamRoles(
  args: string[],
  io: CliIO,
  runtime: CliRuntime
): Promise<number> {
  try {
    const projectId = requiredFlag(args, "--project-id");
    await requireProject(runtime, projectId);
    await renderTeamRoles(io, runtime, projectId);
    return 0;
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function showTeamRole(
  args: string[],
  io: CliIO,
  runtime: CliRuntime
): Promise<number> {
  try {
    const projectId = requiredFlag(args, "--project-id");
    await renderTeamRole(io, runtime, projectId, requiredFlag(args, "--role"));
    return 0;
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function showTeamRoleExecutor(
  args: string[],
  io: CliIO,
  runtime: CliRuntime
): Promise<number> {
  try {
    const projectId = requiredFlag(args, "--project-id");
    const role = await requireResolvedRole(runtime, projectId, requiredFlag(args, "--role"));
    io.stdout.write(
      [
        `role: @${role.role.handle}`,
        `executor: ${executorLabel(role.role.executor)}`,
        `runnable: ${role.role.executor.kind === "agent_adapter"}`,
        role.role.executor.kind === "agent_adapter"
          ? `adapter: ${role.role.executor.adapterKind}`
          : `reserved_reason: ${role.role.executor.unavailableReason ?? reservedExecutorReason}`,
        ""
      ].join("\n")
    );
    return 0;
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function saveTeamRole(
  args: string[],
  io: CliIO,
  runtime: CliRuntime
): Promise<number> {
  try {
    const projectId = requiredFlag(args, "--project-id");
    await requireProject(runtime, projectId);
    const role = await roleFromSaveArgs(runtime, projectId, args);
    const existing = await storedWorkgroupRoles(runtime, projectId);
    const next = upsertStoredRole(existing, role);
    await saveStoredWorkgroupRoles(runtime, projectId, next);
    const saved = await requireResolvedRole(runtime, projectId, role.handle);
    io.stdout.write(
      [
        "Saved role",
        `project_id: ${projectId}`,
        `role: @${saved.role.handle}`,
        `source: ${saved.source}`,
        `executor: ${executorLabel(saved.role.executor)}`,
        `enabled: ${saved.role.enabled}`,
        ""
      ].join("\n")
    );
    return 0;
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function importTeamRoles(
  args: string[],
  io: CliIO,
  runtime: CliRuntime
): Promise<number> {
  try {
    const projectId = requiredFlag(args, "--project-id");
    const project = await requireProject(runtime, projectId);
    const filePath = resolveTeamYamlPath(project, optionalFlag(args, "--path"));
    const roles = await readTeamYamlRoles(filePath, { optional: false });
    const write = teamYamlWriteMode(args);
    if (write) {
      const existing = await storedWorkgroupRoles(runtime, projectId);
      const next = roles.reduce(upsertStoredRole, existing);
      await saveStoredWorkgroupRoles(runtime, projectId, next);
      io.stdout.write(
        [
          "Imported team roles",
          `project_id: ${projectId}`,
          `path: ${filePath}`,
          `roles: ${roles.length}`,
          "mode: write",
          ""
        ].join("\n")
      );
      return 0;
    }
    io.stdout.write(
      [
        "Team roles import preview",
        `project_id: ${projectId}`,
        `path: ${filePath}`,
        `roles: ${roles.length}`,
        "mode: preview",
        ...roles.map((role) => `@${role.handle}\t${executorLabel(role.executor)}`),
        ""
      ].join("\n")
    );
    return 0;
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function exportTeamRoles(
  args: string[],
  io: CliIO,
  runtime: CliRuntime
): Promise<number> {
  try {
    const projectId = requiredFlag(args, "--project-id");
    const project = await requireProject(runtime, projectId);
    const filePath = resolveTeamYamlPath(project, optionalFlag(args, "--path"));
    const write = teamYamlWriteMode(args);
    const roles = exportableTeamRoles(await resolvedWorkgroupRoles(runtime, projectId));
    const content = renderTeamYaml(roles);
    if (write) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, "utf8");
      io.stdout.write(
        [
          "Exported team roles",
          `project_id: ${projectId}`,
          `path: ${filePath}`,
          `roles: ${roles.length}`,
          "mode: write",
          ""
        ].join("\n")
      );
      return 0;
    }
    io.stdout.write(
      [
        "Team roles export preview",
        `project_id: ${projectId}`,
        `path: ${filePath}`,
        `roles: ${roles.length}`,
        "mode: preview",
        "---",
        content.trimEnd(),
        ""
      ].join("\n")
    );
    return 0;
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function renderChatThreads(
  io: CliIO,
  runtime: CliRuntime
): Promise<void> {
  const threads = (await runtime.conversationThreadRepository.list()).sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  );
  if (threads.length === 0) {
    io.stdout.write("No threads found.\n");
    return;
  }
  for (const thread of threads) {
    io.stdout.write(
      `${thread.id}\t${thread.projectId}\t${thread.updatedAt}\t${thread.title}\n`
    );
  }
}

async function renderChatThreadDetail(
  io: CliIO,
  runtime: CliRuntime,
  threadId: string
): Promise<void> {
  const thread = await requireChatThread(runtime, threadId);
  const [messages, summary] = await Promise.all([
    runtime.conversationMessageRepository.listByThreadId(threadId),
    runtime.conversationThreadSummaryRepository.getByThreadId(threadId)
  ]);
  io.stdout.write(
    [
      `Thread ${thread.id}`,
      `title: ${thread.title}`,
      `project_id: ${thread.projectId}`,
      `created_at: ${thread.createdAt}`,
      `updated_at: ${thread.updatedAt}`,
      ...formatThreadSummaryLines(summary),
      `messages: ${messages.length}`,
      ...messages.map(formatThreadMessageLine),
      ""
    ].join("\n")
  );
}

async function renderRooms(
  io: CliIO,
  runtime: CliRuntime,
  projectId: string
): Promise<void> {
  await ensureDefaultRooms(runtime, projectId);
  const rooms = (await runtime.conversationThreadRepository.list(projectId))
    .filter((thread) => roomMetadataForThread(thread))
    .sort(compareRooms);
  if (rooms.length === 0) {
    io.stdout.write("No rooms found.\n");
    return;
  }
  for (const room of rooms) {
    const metadata = roomMetadataForThread(room);
    io.stdout.write(
      [
        `#${metadata?.roomHandle ?? room.id}`,
        room.id,
        metadata?.roomType ?? "custom",
        room.updatedAt,
        room.title,
        metadata?.description ?? ""
      ].join("\t") + "\n"
    );
  }
}

async function renderRoomTimeline(
  io: CliIO,
  runtime: CliRuntime,
  threadId: string
): Promise<void> {
  const thread = await requireChatThread(runtime, threadId);
  const metadata = roomMetadataForThread(thread);
  const messages = await runtime.conversationMessageRepository.listByThreadId(threadId);
  io.stdout.write(
    [
      `Room ${metadata ? `#${metadata.roomHandle}` : thread.title}`,
      `thread_id: ${thread.id}`,
      `project_id: ${thread.projectId}`,
      `description: ${metadata?.description ?? "none"}`,
      `messages: ${messages.length}`,
      ...messages.map(formatRoomTimelineMessage),
      ""
    ].join("\n")
  );
}

async function renderTeamRoles(
  io: CliIO,
  runtime: CliRuntime,
  projectId: string
): Promise<void> {
  const roles = await resolvedWorkgroupRoles(runtime, projectId);
  if (roles.length === 0) {
    io.stdout.write("No roles found.\n");
    return;
  }
  for (const entry of roles) {
    io.stdout.write(
      [
        `@${entry.role.handle}`,
        entry.source,
        entry.role.enabled ? "enabled" : "disabled",
        executorLabel(entry.role.executor),
        entry.role.defaultRoom ? `#${entry.role.defaultRoom}` : "-",
        entry.role.capabilitySummary
      ].join("\t") + "\n"
    );
  }
}

async function renderTeamRole(
  io: CliIO,
  runtime: CliRuntime,
  projectId: string,
  roleHandle: string
): Promise<void> {
  const entry = await requireResolvedRole(runtime, projectId, roleHandle);
  const role = entry.role;
  io.stdout.write(
    [
      `Role @${role.handle}`,
      `source: ${entry.source}`,
      `display_name: ${role.displayName}`,
      `enabled: ${role.enabled}`,
      `purpose: ${role.purpose}`,
      `capability: ${role.capabilitySummary}`,
      `executor: ${executorLabel(role.executor)}`,
      `default_room: ${role.defaultRoom ? `#${role.defaultRoom}` : "none"}`,
      `permissions: ${role.permissions.length === 0 ? "none" : role.permissions.join(", ")}`,
      `context: ${role.contextPolicy.scope}`,
      `approved_memory: ${role.contextPolicy.includeApprovedMemory}`,
      `thread_summary: ${role.contextPolicy.includeThreadSummary}`,
      `approval: ${role.approvalPolicy.summary}`,
      `instructions: ${inlineText(role.defaultInstructions)}`,
      ""
    ].join("\n")
  );
}

function formatThreadSummaryLines(
  summary: ConversationThreadSummary | undefined
): string[] {
  if (!summary) {
    return ["thread_summary: none"];
  }
  return [
    "thread_summary:",
    `summary: ${inlineText(summary.summary)}`,
    summary.lastKnownUserGoal
      ? `last_known_user_goal: ${inlineText(summary.lastKnownUserGoal)}`
      : undefined,
    ...formatThreadSummaryItems("decisions", summary.decisions),
    ...formatThreadSummaryItems("open_items", summary.openItems),
    ...formatThreadSummaryItems("constraints", summary.constraints),
    `summary_source_messages: ${summary.sourceMessageCount}`,
    `summary_updated_at: ${summary.updatedAt}`
  ].filter((line): line is string => line !== undefined);
}

function formatThreadSummaryItems(label: string, items: string[]): string[] {
  return items.map((item) => `${label}: ${inlineText(item)}`);
}

function formatThreadMessageLine(message: ConversationMessage): string {
  const base = [
    message.id,
    message.sequence,
    message.role,
    message.kind,
    message.agentKind ?? "-",
    message.runId ?? "-",
    message.status ?? "-"
  ].join("\t");
  return `${base}\t${inlineText(firstLine(message.content))}`;
}

function formatRoomTimelineMessage(message: ConversationMessage): string {
  const assignment = metadataAssignment(message.metadata);
  const role = assignment?.roleHandle ? `@${assignment.roleHandle}` : "-";
  const taskId = metadataString(message.metadata, "taskId") ?? "-";
  return [
    message.sequence,
    message.createdAt,
    message.role,
    message.kind,
    role,
    message.agentKind ?? "-",
    message.runId ?? "-",
    message.status ?? "-",
    taskId,
    inlineText(firstLine(message.content))
  ].join("\t");
}

async function parseCliChatTurn(
  runtime: CliRuntime,
  state: ChatState,
  rawLine: string
): Promise<ParsedCliChatTurn> {
  const roles = await resolvedRoleValues(runtime, state.project.id);
  const teamRoles = roles
    .filter((role) => role.enabled)
    .map((role) => toWorkgroupRoleRunMetadata(role));
  const parsedMentions = parseCliWorkgroupMentions(rawLine, roles, state.debug);
  if (parsedMentions.participants.length > 0 || parsedMentions.roleMentions.length > 0) {
    return {
      ...parsedMentions,
      teamRoles,
      workgroupRoles: roles,
      prompt: parsedMentions.cleanedPrompt
    };
  }
  const parsedAgent = parseAgentPrompt(
    rawLine,
    state.selectedAgent,
    cliAgentAvailability(state.debug)
  );
  return {
    agentMentions: [parsedAgent.agentKind],
    roleMentions: [],
    participants: [
      {
        agentKind: parsedAgent.agentKind,
        source: "adapter_mention"
      }
    ],
    cleanedPrompt: parsedAgent.prompt,
    teamRoles,
    workgroupRoles: roles,
    prompt: parsedAgent.prompt
  };
}

function parseCliWorkgroupMentions(
  input: string,
  roles: readonly WorkgroupRole[],
  debug: boolean
): CliMentionParseResult {
  const agentMentions: AgentKind[] = [];
  const roleMentions: WorkgroupRoleRunMetadata[] = [];
  const participants: CliMentionParticipant[] = [];
  const participantKeys = new Set<string>();
  const cleanedPrompt = input
    .replace(/(^|[\s([{])@([a-z][a-z0-9_-]*)\b/gi, (match, prefix: string, rawMention: string) => {
      const agentKind = normalizeMentionAgentKind(rawMention, debug);
      if (agentKind) {
        addCliAgentMention(agentMentions, participants, participantKeys, agentKind);
        return prefix.length > 0 ? prefix : "";
      }
      const role = findWorkgroupRoleByHandle(roles, rawMention);
      if (role?.enabled) {
        const metadata = toWorkgroupRoleRunMetadata(role);
        if (!roleMentions.some((mention) => mention.roleHandle === metadata.roleHandle)) {
          roleMentions.push(metadata);
        }
        const adapter = adapterKindForRole(role, debug);
        if (adapter) {
          addCliRoleMention(participants, participantKeys, adapter, metadata);
        }
        return prefix.length > 0 ? prefix : "";
      }
      return match;
    })
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .trim();

  return {
    agentMentions,
    roleMentions,
    participants,
    cleanedPrompt
  };
}

function addCliAgentMention(
  agentMentions: AgentKind[],
  participants: CliMentionParticipant[],
  participantKeys: Set<string>,
  agentKind: AgentKind
): void {
  if (!agentMentions.includes(agentKind)) {
    agentMentions.push(agentKind);
  }
  const key = `adapter:${agentKind}`;
  if (participantKeys.has(key)) {
    return;
  }
  participantKeys.add(key);
  participants.push({ agentKind, source: "adapter_mention" });
}

function addCliRoleMention(
  participants: CliMentionParticipant[],
  participantKeys: Set<string>,
  agentKind: AgentKind,
  role: WorkgroupRoleRunMetadata
): void {
  const key = `role:${role.roleHandle}`;
  if (participantKeys.has(key)) {
    return;
  }
  participantKeys.add(key);
  participants.push({ agentKind, role, source: "role_mention" });
}

function normalizeMentionAgentKind(value: string, debug: boolean): AgentKind | undefined {
  try {
    const agent = parseAgentKindAlias(value);
    return isAgentKindEnabled(agent, cliAgentAvailability(debug)) ? agent : undefined;
  } catch {
    return undefined;
  }
}

function adapterKindForRole(role: WorkgroupRole, debug: boolean): AgentKind | undefined {
  if (role.executor.kind !== "agent_adapter") {
    return undefined;
  }
  return isAgentKindEnabled(role.executor.adapterKind, cliAgentAvailability(debug))
    ? role.executor.adapterKind
    : undefined;
}

function createCliTaskAssignments(input: {
  taskId: string;
  threadId: string;
  sourceMessageId: string;
  participants: CliMentionParticipant[];
  roleMentions: WorkgroupRoleRunMetadata[];
}): WorkgroupTaskAssignmentMetadata[] {
  const assignments: WorkgroupTaskAssignmentMetadata[] = [];
  const roleHandles = new Set<string>();
  for (const role of input.roleMentions) {
    if (roleHandles.has(role.roleHandle)) {
      continue;
    }
    roleHandles.add(role.roleHandle);
    assignments.push({
      assignmentId: createId("assignment"),
      taskId: input.taskId,
      threadId: input.threadId,
      sourceMessageId: input.sourceMessageId,
      assignmentRole: "role",
      agentId: role.adapterKind === "claude-code" ? "claude" : role.adapterKind,
      roleHandle: role.roleHandle,
      displayName: role.displayName,
      executorKind: role.executorKind,
      adapterKind: role.adapterKind,
      executable: role.executorKind === "agent_adapter" && role.adapterKind !== undefined,
      status: role.adapterKind ? "queued" : "assigned"
    });
  }

  const agentKindsSeen = new Set<string>();
  for (const participant of input.participants) {
    if (participant.role) {
      continue;
    }
    if (agentKindsSeen.has(participant.agentKind)) {
      continue;
    }
    agentKindsSeen.add(participant.agentKind);
    assignments.push({
      assignmentId: createId("assignment"),
      taskId: input.taskId,
      threadId: input.threadId,
      sourceMessageId: input.sourceMessageId,
      assignmentRole: "agent",
      agentId: participant.agentKind === "claude-code" ? "claude" : participant.agentKind,
      displayName: `@${participant.agentKind}`,
      executorKind: "agent_adapter",
      adapterKind: participant.agentKind,
      executable: true,
      status: "queued"
    });
  }
  return assignments;
}

function assignmentForCliParticipant(
  assignments: WorkgroupTaskAssignmentMetadata[],
  participant: CliMentionParticipant
): WorkgroupTaskAssignmentMetadata | undefined {
  if (participant.role) {
    return assignments.find(
      (assignment) =>
        assignment.assignmentRole === "role" &&
        assignment.roleHandle === participant.role?.roleHandle
    );
  }
  const agentId = participant.agentKind === "claude-code" ? "claude" : participant.agentKind;
  return assignments.find(
    (assignment) => assignment.assignmentRole === "agent" && assignment.agentId === agentId
  );
}

function updateCliAssignment(
  assignments: WorkgroupTaskAssignmentMetadata[],
  assignmentId: string,
  patch: Partial<Pick<WorkgroupTaskAssignmentMetadata, "runId" | "status">>
): WorkgroupTaskAssignmentMetadata[] {
  return assignments.map((assignment) =>
    assignment.assignmentId === assignmentId ? { ...assignment, ...patch } : assignment
  );
}

async function saveCliTaskAssignments(
  runtime: CliRuntime,
  taskId: string,
  assignments: WorkgroupTaskAssignmentMetadata[]
): Promise<void> {
  const task = await runtime.taskRepository.get(taskId);
  if (!task) {
    return;
  }
  await runtime.taskRepository.create(
    validateTask({
      ...task,
      metadata: {
        ...(task.metadata ?? {}),
        assignmentCount: assignments.length,
        executableAssignmentCount: assignments.filter((assignment) => assignment.executable).length,
        assignments
      },
      updatedAt: nowIso()
    })
  );
}

function cliTaskMetadata(input: {
  thread: ConversationThread;
  sourceMessageId: string;
  assignments: WorkgroupTaskAssignmentMetadata[];
}): JsonObject {
  return {
    source: "cli_chat",
    threadId: input.thread.id,
    room: roomHandleForThread(input.thread),
    sourceMessageId: input.sourceMessageId,
    assignmentCount: input.assignments.length,
    executableAssignmentCount: input.assignments.filter((assignment) => assignment.executable).length,
    assignments: input.assignments
  };
}

function assignmentStatusFromRunStatus(
  status: TaskRunStatus
): WorkgroupTaskAssignmentMetadata["status"] {
  if (status === "succeeded") {
    return "completed";
  }
  if (status === "failed") {
    return "failed";
  }
  if (status === "cancelled") {
    return "cancelled";
  }
  return status;
}

function cliParticipantLabel(participant: CliMentionParticipant): string {
  return participant.role ? `@${participant.role.roleHandle}` : `@${participant.agentKind}`;
}

function roleContextReferences(role: WorkgroupRoleRunMetadata | undefined): string[] {
  if (!role) {
    return [];
  }
  return [
    `role:${role.roleHandle}`,
    `role_executor:${role.executorKind}${role.adapterKind ? `/${role.adapterKind}` : ""}`,
    `role_persona:${role.persona}`,
    `role_instructions:${role.defaultInstructions}`,
    `role_skills:${
      role.defaultSkillReferences
        ?.map((reference) =>
          reference.scope ? `${reference.scope}:${reference.id}` : reference.id
        )
        .join(", ") ?? "none"
    }`
  ];
}

function roleProtocolReferences(
  role: WorkgroupRoleRunMetadata | undefined,
  roles: readonly WorkgroupRole[]
): string[] {
  if (!role) {
    return [];
  }
  const caller = roles.find((entry) => entry.handle === role.roleHandle);
  const callerPolicy = caller ? roleDelegationPolicy(caller) : undefined;
  const available = roles
    .filter(
      (entry) =>
        entry.enabled &&
        entry.handle !== role.roleHandle &&
        callerPolicy !== undefined &&
        roleDelegationPolicyAllowsTarget(callerPolicy, entry)
    )
    .slice(0, 12)
    .map((entry) =>
      `@${entry.handle}: ${entry.purpose}; executor=${roleExecutorReference(entry)}; capability=${entry.capabilitySummary}`
    );
  return [
    "role_call_protocol: Agent Hub owns delegation. Do not simulate subagents, worker roles, or hidden role chats inside your own response.",
    "role_call_protocol: To request another role, emit a line-start role call exactly as '@role bounded task'. Agent Hub will parse it into a RoleCall.",
    "role_call_protocol: Delegation-only requests do not require repository reconnaissance. Emit the role call first and let Agent Hub schedule the callee.",
    "role_call_protocol: Do not inspect the repository merely to discover available roles or delegation syntax; use the role directory below.",
    "role_call_protocol: Mentions inside prose or code blocks are not delegation requests. Use separate line-start calls only.",
    `available_role_calls: ${available.length > 0 ? available.join(" | ") : "none"}`
  ];
}

function roleExecutorReference(role: WorkgroupRole): string {
  return role.executor.kind === "agent_adapter"
    ? `agent_adapter/${role.executor.adapterKind}`
    : `${role.executor.kind}/reserved`;
}

async function requireProject(
  runtime: CliRuntime,
  projectId: string
): Promise<Project> {
  const project = await runtime.projectRepository.get(projectId);
  if (!project) {
    throw new Error(`project ${projectId} not found`);
  }
  return project;
}

async function ensureDefaultRooms(
  runtime: CliRuntime,
  projectId: string
): Promise<void> {
  await requireProject(runtime, projectId);
  const threads = await runtime.conversationThreadRepository.list(projectId);
  const existingHandles = new Set(
    threads.flatMap((thread) => {
      const metadata = roomMetadataForThread(thread);
      return metadata ? [metadata.roomHandle] : [];
    })
  );
  for (const definition of defaultRoomDefinitions) {
    if (existingHandles.has(definition.handle)) {
      continue;
    }
    await createRoomThread(runtime, {
      projectId,
      handle: definition.handle,
      title: definition.title,
      description: definition.description,
      type: "default"
    });
  }
}

async function createRoomThread(
  runtime: CliRuntime,
  input: {
    projectId: string;
    handle: string;
    title: string;
    description: string;
    type?: RoomType;
  }
): Promise<ConversationThread> {
  const handle = normalizeRoomHandle(input.handle);
  if (!handle) {
    throw new Error("room handle must start with a letter and contain only letters, numbers, underscores, or hyphens");
  }
  await requireProject(runtime, input.projectId);
  const existing = (await runtime.conversationThreadRepository.list(input.projectId)).find(
    (thread) => roomMetadataForThread(thread)?.roomHandle === handle
  );
  if (existing) {
    throw new Error(`room #${handle} already exists`);
  }
  const now = nowIso();
  return runtime.conversationThreadRepository.create(
    validateConversationThread({
      id: createId("thread"),
      projectId: input.projectId,
      title: titleFromPrompt(input.title) || `#${handle}`,
      metadata: roomMetadata({
        handle,
        description: input.description,
        type: input.type ?? "custom"
      }),
      createdAt: now,
      updatedAt: now
    })
  );
}

async function resolveRoomThread(
  runtime: CliRuntime,
  projectId: string,
  roomRef: string
): Promise<ConversationThread> {
  await ensureDefaultRooms(runtime, projectId);
  const normalized = normalizeRoomHandle(roomRef);
  const threads = await runtime.conversationThreadRepository.list(projectId);
  const byHandle = normalized
    ? threads.find((thread) => roomMetadataForThread(thread)?.roomHandle === normalized)
    : undefined;
  if (byHandle) {
    return byHandle;
  }
  const byId = threads.find((thread) => thread.id === roomRef);
  if (byId) {
    return byId;
  }
  throw new Error(`room ${roomRef} not found`);
}

function roomMetadata(input: {
  handle: string;
  description: string;
  type: RoomType;
}): CliRoomMetadata {
  return {
    source: "cli_room",
    roomType: input.type,
    roomHandle: input.handle,
    description: input.description
  };
}

function roomMetadataForThread(
  thread: ConversationThread
): CliRoomMetadata | undefined {
  const value = thread.metadata;
  if (!value || typeof value.roomHandle !== "string") {
    return undefined;
  }
  const handle = normalizeRoomHandle(value.roomHandle);
  if (!handle) {
    return undefined;
  }
  return {
    source: typeof value.source === "string" ? value.source : "cli_room",
    roomType: value.roomType === "default" ? "default" : "custom",
    roomHandle: handle,
    description:
      typeof value.description === "string" && value.description.trim().length > 0
        ? value.description
        : "No description."
  };
}

function roomHandleForThread(thread: ConversationThread): string | undefined {
  return roomMetadataForThread(thread)?.roomHandle;
}

function normalizeRoomHandle(value: string): string | undefined {
  return normalizeWorkgroupRoleHandle(value.replace(/^#/, ""));
}

function compareRooms(left: ConversationThread, right: ConversationThread): number {
  const leftMetadata = roomMetadataForThread(left);
  const rightMetadata = roomMetadataForThread(right);
  const leftDefaultIndex = defaultRoomDefinitions.findIndex(
    (room) => room.handle === leftMetadata?.roomHandle
  );
  const rightDefaultIndex = defaultRoomDefinitions.findIndex(
    (room) => room.handle === rightMetadata?.roomHandle
  );
  const leftRank = leftDefaultIndex === -1 ? 10_000 : leftDefaultIndex;
  const rightRank = rightDefaultIndex === -1 ? 10_000 : rightDefaultIndex;
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }
  return (leftMetadata?.roomHandle ?? left.title).localeCompare(
    rightMetadata?.roomHandle ?? right.title
  );
}

async function resolvedRoleValues(
  runtime: CliRuntime,
  projectId: string
): Promise<readonly WorkgroupRole[]> {
  return (await resolvedWorkgroupRoles(runtime, projectId)).map((entry) => entry.role);
}

async function resolvedWorkgroupRoles(
  runtime: CliRuntime,
  projectId: string
): Promise<ResolvedRole[]> {
  const project = await requireProject(runtime, projectId);
  const stored = await storedWorkgroupRoles(runtime, projectId);
  const yaml = await projectTeamYamlRoles(project);
  const storedByHandle = new Map(stored.map((role) => [role.handle, role]));
  const yamlByHandle = new Map(yaml.map((role) => [role.handle, role]));
  const presetHandles = new Set(presetWorkgroupRoles.map((role) => role.handle));
  const resolved: ResolvedRole[] = presetWorkgroupRoles.map((preset) => {
    const yamlOverride = yamlByHandle.get(preset.handle);
    if (yamlOverride) {
      return { role: yamlOverride, source: "yaml_override" };
    }
    const override = storedByHandle.get(preset.handle);
    return override
      ? { role: override, source: "preset_override" }
      : { role: preset, source: "preset" };
  });
  for (const role of stored) {
    if (presetHandles.has(role.handle) || yamlByHandle.has(role.handle)) {
      continue;
    }
    resolved.push({ role, source: "custom" });
  }
  for (const role of yaml) {
    if (presetHandles.has(role.handle)) {
      continue;
    }
    resolved.push({ role, source: "yaml_custom" });
  }
  return resolved.sort((left, right) => {
    const leftPreset = presetHandles.has(left.role.handle) ? 0 : 1;
    const rightPreset = presetHandles.has(right.role.handle) ? 0 : 1;
    if (leftPreset !== rightPreset) {
      return leftPreset - rightPreset;
    }
    return left.role.handle.localeCompare(right.role.handle);
  });
}

async function requireResolvedRole(
  runtime: CliRuntime,
  projectId: string,
  handle: string
): Promise<ResolvedRole> {
  const normalized = normalizeWorkgroupRoleHandle(handle);
  if (!normalized) {
    throw new Error("role handle must start with a letter and contain only letters, numbers, underscores, or hyphens");
  }
  const role = (await resolvedWorkgroupRoles(runtime, projectId)).find(
    (entry) => entry.role.handle === normalized
  );
  if (!role) {
    throw new Error(`role @${normalized} not found`);
  }
  return role;
}

async function storedWorkgroupRoles(
  runtime: CliRuntime,
  projectId: string
): Promise<WorkgroupRole[]> {
  const setting = await runtime.settingsRepository.get(roleSettingsKey(projectId));
  if (!setting) {
    return [];
  }
  const roles = settingValueRoles(setting.value);
  return roles.map((role) => validateWorkgroupRole(role as WorkgroupRole));
}

async function projectTeamYamlRoles(project: Project): Promise<WorkgroupRole[]> {
  return readTeamYamlRoles(resolveTeamYamlPath(project), { optional: true });
}

async function readTeamYamlRoles(
  filePath: string,
  options: { optional: boolean }
): Promise<WorkgroupRole[]> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (
      options.optional &&
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
  return parseTeamYamlRoles(content, filePath);
}

function parseTeamYamlRoles(content: string, filePath: string): WorkgroupRole[] {
  let parsed: unknown;
  try {
    parsed = loadYaml(content);
  } catch (error) {
    throw new Error(
      `invalid team.yaml at ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  const result = teamYamlSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `invalid team.yaml at ${filePath}: ${result.error.issues
        .map((issue) => `${issue.path.join(".") || "root"} ${issue.message}`)
        .join("; ")}`
    );
  }
  const seen = new Set<string>();
  return result.data.roles.map((role) => {
    const normalizedHandle = normalizeWorkgroupRoleHandle(role.handle);
    if (!normalizedHandle || normalizedHandle !== role.handle) {
      throw new Error(
        `invalid team.yaml at ${filePath}: role handle ${role.handle} must be normalized`
      );
    }
    if (seen.has(role.handle)) {
      throw new Error(
        `invalid team.yaml at ${filePath}: duplicate role @${role.handle}`
      );
    }
    seen.add(role.handle);
    return validateWorkgroupRole(role as WorkgroupRole);
  });
}

function resolveTeamYamlPath(
  project: Project,
  inputPath = defaultTeamYamlPath
): string {
  if (path.isAbsolute(inputPath)) {
    return path.resolve(inputPath);
  }
  return path.resolve(project.rootPath, inputPath);
}

async function saveStoredWorkgroupRoles(
  runtime: CliRuntime,
  projectId: string,
  roles: WorkgroupRole[]
): Promise<void> {
  await runtime.settingsRepository.set({
    key: roleSettingsKey(projectId),
    value: { roles },
    updatedAt: nowIso()
  });
}

function roleSettingsKey(projectId: string): string {
  return `${roleSettingsPrefix}${projectId}${roleSettingsSuffix}`;
}

function settingValueRoles(value: unknown): unknown[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("stored team roles must be an object");
  }
  const roles = (value as { roles?: unknown }).roles;
  if (!Array.isArray(roles)) {
    throw new Error("stored team roles must contain a roles array");
  }
  if (roles.length > maxStoredRoles) {
    throw new Error(`team roles must contain ${maxStoredRoles} or fewer entries`);
  }
  return roles;
}

async function roleFromSaveArgs(
  runtime: CliRuntime,
  projectId: string,
  args: string[]
): Promise<WorkgroupRole> {
  const handle = normalizeWorkgroupRoleHandle(requiredFlag(args, "--handle"));
  if (!handle) {
    throw new Error("role handle must start with a letter and contain only letters, numbers, underscores, or hyphens");
  }
  const existing = (await resolvedWorkgroupRoles(runtime, projectId)).find(
    (entry) => entry.role.handle === handle
  )?.role;
  const preset = presetWorkgroupRoles.find((role) => role.handle === handle);
  const base = existing ?? preset;
  const debug = isEnvironmentDebugEnabled();
  const baseExecutor =
    base?.executor.kind === "agent_adapter" &&
    !isAgentKindEnabled(base.executor.adapterKind, cliAgentAvailability(debug))
      ? undefined
      : base?.executor;
  const executor = optionalFlag(args, "--executor")
    ? parseRoleExecutor(requiredFlag(args, "--executor"), debug)
    : baseExecutor ?? parseRoleExecutor(defaultCliAgent(debug), debug);
  return validateWorkgroupRole({
    id: preset ? `preset:${handle}` : `custom:${handle}`,
    handle,
    displayName:
      optionalFlag(args, "--display-name") ?? base?.displayName ?? titleCaseHandle(handle),
    purpose:
      optionalFlag(args, "--purpose") ??
      base?.purpose ??
      `Custom local workgroup role @${handle}.`,
    capabilitySummary:
      optionalFlag(args, "--capability") ??
      base?.capabilitySummary ??
      "Local project assistance.",
    persona:
      optionalFlag(args, "--persona") ??
      base?.persona ??
      "Local Agent Hub participant with bounded project context.",
    defaultInstructions:
      optionalFlag(args, "--instructions") ??
      base?.defaultInstructions ??
      "Use Agent Hub runtime-injected context only and avoid unapproved side effects.",
    permissions:
      repeatedFlag(args, "--permission").length > 0
        ? repeatedFlag(args, "--permission")
        : base?.permissions ?? ["read_project_context", "read_thread_context"],
    defaultSkillReferences:
      repeatedFlag(args, "--skill").length > 0
        ? repeatedFlag(args, "--skill").map(parseSkillReferenceFlag)
        : base?.defaultSkillReferences,
    contextPolicy: {
      scope: optionalFlag(args, "--context-scope") ?? base?.contextPolicy.scope ?? "current_thread_and_project_context",
      includeApprovedMemory: !args.includes("--no-approved-memory") && (base?.contextPolicy.includeApprovedMemory ?? true),
      includeThreadSummary: !args.includes("--no-thread-summary") && (base?.contextPolicy.includeThreadSummary ?? true),
      instructions:
        repeatedFlag(args, "--context-instruction").length > 0
          ? repeatedFlag(args, "--context-instruction")
          : base?.contextPolicy.instructions ?? [
              "Use Agent Hub runtime-injected context only.",
              "Do not read secrets or credential files."
            ]
    },
    approvalPolicy: {
      requiredFor:
        repeatedFlag(args, "--approval-required-for").length > 0
          ? repeatedFlag(args, "--approval-required-for")
          : base?.approvalPolicy.requiredFor ?? [
              "memory_approval",
              "external_side_effects"
            ],
      summary:
        optionalFlag(args, "--approval") ??
        base?.approvalPolicy.summary ??
        "User approval is required for memory approval and external effects."
    },
    executor,
    enabled: args.includes("--disabled") ? false : base?.enabled ?? true,
    defaultRoom: optionalFlag(args, "--default-room") ?? base?.defaultRoom,
    tags: repeatedFlag(args, "--tag").length > 0 ? repeatedFlag(args, "--tag") : base?.tags,
    metadata: {
      ...(base?.metadata ?? {}),
      source: preset ? "preset_override" : "custom",
      persistedBy: "cli_team_roles"
    }
  });
}

function parseRoleExecutor(value: string, debug = isEnvironmentDebugEnabled()): WorkgroupExecutor {
  const normalized = value.replace(/^@/, "").toLowerCase();
  if (normalized === "fake" || normalized === "codex" || normalized === "claude-code") {
    return { kind: "agent_adapter", adapterKind: parseAvailableAgent(normalized, debug) };
  }
  if (normalized === "claude") {
    return { kind: "agent_adapter", adapterKind: parseAvailableAgent("claude-code", debug) };
  }
  if (normalized === "human" || normalized === "llm_api" || normalized === "workflow") {
    return {
      kind: normalized,
      unavailableReason: reservedExecutorReason
    };
  }
  throw new Error("--executor must be fake, codex, claude-code, human, llm_api, or workflow");
}

function parseSkillReferenceFlag(value: string): {
  id: string;
  scope?: "task" | "role" | "project" | "global";
} {
  const trimmed = value.trim();
  const scoped = /^(task|role|project|global):(.+)$/.exec(trimmed);
  if (scoped) {
    const id = scoped[2].trim();
    if (!id) {
      throw new Error("--skill requires a skill id");
    }
    return { scope: scoped[1] as "task" | "role" | "project" | "global", id };
  }
  if (!trimmed) {
    throw new Error("--skill requires a skill id");
  }
  return { id: trimmed };
}

function upsertStoredRole(
  existing: WorkgroupRole[],
  role: WorkgroupRole
): WorkgroupRole[] {
  const next = existing.filter((entry) => entry.handle !== role.handle);
  next.push(role);
  if (next.length > maxStoredRoles) {
    throw new Error(`team roles must contain ${maxStoredRoles} or fewer entries`);
  }
  return next.sort((left, right) => left.handle.localeCompare(right.handle));
}

function teamYamlWriteMode(args: string[]): boolean {
  const write = args.includes("--write");
  const preview = args.includes("--preview");
  if (write && preview) {
    throw new Error("--write and --preview are mutually exclusive");
  }
  return write;
}

function exportableTeamRoles(entries: ResolvedRole[]): WorkgroupRole[] {
  return entries
    .filter((entry) => entry.source !== "preset")
    .map((entry) => entry.role);
}

function renderTeamYaml(roles: WorkgroupRole[]): string {
  return dumpYaml(
    {
      roles: roles.map((role) =>
        JSON.parse(JSON.stringify(role)) as Record<string, unknown>
      )
    },
    {
      lineWidth: 100,
      noRefs: true,
      sortKeys: false
    }
  );
}

function executorLabel(executor: WorkgroupExecutor): string {
  if (executor.kind === "agent_adapter") {
    if (
      !isAgentKindEnabled(
        executor.adapterKind,
        cliAgentAvailability(isEnvironmentDebugEnabled())
      )
    ) {
      return "agent_adapter disabled";
    }
    return `agent_adapter / ${executor.adapterKind}`;
  }
  return `${executor.kind} reserved`;
}

function titleCaseHandle(handle: string): string {
  return handle
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function metadataAssignment(
  metadata: JsonObject | undefined
): WorkgroupTaskAssignmentMetadata | undefined {
  const value = metadata?.assignment;
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const assignment = value as WorkgroupTaskAssignmentMetadata;
  if (typeof assignment.assignmentId !== "string") {
    return undefined;
  }
  return assignment;
}

function metadataRoleRun(
  metadata: JsonObject | undefined
): WorkgroupRoleRunMetadata | undefined {
  const value = metadata?.role;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const role = value as WorkgroupRoleRunMetadata;
  if (
    typeof role.roleId !== "string" ||
    typeof role.roleHandle !== "string" ||
    typeof role.displayName !== "string" ||
    typeof role.executorKind !== "string"
  ) {
    return undefined;
  }
  return role;
}

function metadataString(metadata: JsonObject | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

function chatAssistantContent(result: CliRunResult): string {
  const extracted = extractAgentOutput(result).trim();
  const content = extracted || terminalChatAssistantSummary(result);
  return truncateText(content, 2_000);
}

function terminalChatAssistantSummary(result: CliRunResult): string {
  const agent = `@${result.run.agentKind}`;
  if (result.ok) {
    return `${agent} completed without agent-facing output. Run evidence is available through the run review commands.`;
  }
  if (result.run.status === "cancelled") {
    return `${agent} was cancelled before producing agent-facing output. Run evidence is available through the run review commands.`;
  }
  return `${agent} failed before producing agent-facing output. Run evidence is available through the run review commands.`;
}

function titleFromPrompt(prompt: string): string {
  const firstPromptLine = firstLine(prompt);
  if (!firstPromptLine) {
    return "New Chat";
  }
  return firstPromptLine.length > 60
    ? `${firstPromptLine.slice(0, 57)}...`
    : firstPromptLine;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

async function contextBuild(
  args: string[],
  io: CliIO,
  cwd: string,
  debug: boolean
): Promise<number> {
  try {
    const store = parseContextStoreArgs(args, cwd);
    const result = await buildContextArtifacts({
      ...store,
      taskId: requiredFlag(args, "--task-id"),
      title: requiredFlag(args, "--title"),
      prompt: requiredFlag(args, "--prompt"),
      selectedAgentId: parseAvailableAgent(
        optionalFlag(args, "--agent") ?? defaultCliAgent(debug),
        debug
      ),
      deliveryMode: parseContextBuildDeliveryMode(optionalFlag(args, "--delivery-mode"))
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
      target: parseContextExportTarget(args),
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
        `target: ${result.target}`,
        `approved_memory: ${result.approvedMemoryPolicy}`,
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

async function createGlobalSkillCommand(
  args: string[],
  io: CliIO,
  cwd: string
): Promise<number> {
  try {
    const skill = await createGlobalSkill({
      id: optionalFlag(args, "--id"),
      name: requiredFlag(args, "--name"),
      description: requiredFlag(args, "--description"),
      body: optionalFlag(args, "--body"),
      agentHubHome: optionalFlag(args, "--agent-hub-home")
        ? path.resolve(cwd, requiredFlag(args, "--agent-hub-home"))
        : undefined,
      overwrite: args.includes("--overwrite")
    });
    io.stdout.write(
      [
        "Created global skill",
        `id: ${skill.id}`,
        `scope: ${skill.scope}`,
        `name: ${skill.name}`,
        `path: ${skill.path}`,
        `content_sha256: ${skill.contentHash}`,
        ""
      ].join("\n")
    );
    return 0;
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function listGlobalSkillsCommand(
  args: string[],
  io: CliIO,
  cwd: string
): Promise<number> {
  try {
    const skills = await listGlobalSkills({
      agentHubHome: optionalFlag(args, "--agent-hub-home")
        ? path.resolve(cwd, requiredFlag(args, "--agent-hub-home"))
        : undefined
    });
    io.stdout.write(
      [
        "Global skills",
        ...(skills.length === 0
          ? ["  - none"]
          : skills.map(
              (skill) =>
                `  - ${skill.id} (${skill.name}) ${skill.contentHash}`
            )),
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
    const debug = inheritedDebug || options.debug;
    const runInput = await resolveRunInput(options, runtime, debug);
    const effectiveRunInput = await withAdhocProject(runInput, runtime);

    const result = await runtime.taskRunner.run({
      ...effectiveRunInput,
      agentAvailability: cliAgentAvailability(debug),
      workspaceBasePath: options.workspaceBasePath,
      workspaceCleanupPolicy: options.retainOnFailure ? "retain_on_failure" : undefined,
      dryRun: options.dryRun,
      verificationCommands: options.verificationCommands,
      deliveryMode: options.deliveryMode,
      contextStoreRoot: options.contextStoreRoot
    });

    const deliveryMode = options.deliveryMode ?? "runtime_injection";
    io.stdout.write(renderAgentOutput(result));
    if (debug) {
      io.stdout.write(renderRunDebug(result, effectiveRunInput, deliveryMode));
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

  const project = await ensureProjectForRoot(runtime, runInput.projectRoot);
  return { ...runInput, projectId: project.id };
}

async function ensureProjectForRoot(
  runtime: CliRuntime,
  rootPath: string
): Promise<Project> {
  const projectRoot = path.resolve(rootPath);
  const existingForRoot = await runtime.projectRepository.getByRootPath(projectRoot);
  if (existingForRoot) {
    return existingForRoot;
  }

  let projectId = "adhoc_project";
  const existingProject = await runtime.projectRepository.get(projectId);
  if (existingProject && existingProject.rootPath !== projectRoot) {
    projectId = adhocProjectIdForRoot(projectRoot);
  }

  const now = nowIso();
  return runtime.projectRepository.create(
    validateProject({
      id: projectId,
      name: path.basename(projectRoot) || projectId,
      rootPath: projectRoot,
      createdAt: now,
      updatedAt: now
    })
  );
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

async function showRunEvents(
  args: string[],
  io: CliIO,
  runtime: CliRuntime
): Promise<number> {
  const runId = args[0];
  if (!runId) {
    io.stderr.write("error: run id is required\n");
    return 1;
  }

  try {
    const review = await loadRunEventsReview(
      {
        taskRunRepository: runtime.taskRunRepository,
        runEventRepository: runtime.runEventRepository
      },
      runId
    );
    io.stdout.write(
      [
        `run_id: ${review.run.id}`,
        `events: ${review.events.length}`,
        ...review.events.map((event) =>
          [
            event.sequence,
            event.createdAt,
            event.type,
            inlineText(event.message)
          ].join("\t")
        ),
        ""
      ].join("\n")
    );
    return 0;
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function showRunDiff(
  args: string[],
  io: CliIO,
  runtime: CliRuntime
): Promise<number> {
  let parsed: { runId: string; mode: "stat" | "patch"; fullPatch: boolean };
  try {
    parsed = parseRunDiffArgs(args);
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  try {
    const review = await loadRunDiffReview(
      {
        taskRunRepository: runtime.taskRunRepository,
        runArtifactRepository: runtime.runArtifactRepository,
        runMetadataRepository: runtime.runMetadataRepository
      },
      parsed.runId,
      { fullPatch: parsed.fullPatch }
    );
    io.stdout.write(
      parsed.mode === "patch"
        ? renderRunDiffPatch(review)
        : renderRunDiffStat(review)
    );
    return 0;
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
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
      `parent_run_id: ${run.parentRunId ?? "none"}`,
      `parent_message_id: ${run.parentMessageId ?? "none"}`,
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

async function showReviewDecision(
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
  const decision = await getRunReviewDecision(
    { runArtifactRepository: runtime.runArtifactRepository },
    runId
  );
  io.stdout.write(renderReviewDecision(decision));
  return 0;
}

async function recordReviewDecisionCommand(
  status: "accepted" | "rejected",
  args: string[],
  io: CliIO,
  runtime: CliRuntime
): Promise<number> {
  const runId = args[0];
  if (!runId) {
    io.stderr.write("error: run id is required\n");
    return 1;
  }
  try {
    const decision = await recordRunReviewDecision(
      {
        taskRunRepository: runtime.taskRunRepository,
        runArtifactRepository: runtime.runArtifactRepository
      },
      {
        runId,
        status,
        reason: optionalFlag(args.slice(1), "--reason"),
        idFactory: createId,
        now: nowIso
      }
    );
    io.stdout.write(renderReviewDecision(decision));
    return 0;
  } catch (error) {
    io.stderr.write(`error: ${errorMessage(error)}\n`);
    return 1;
  }
}

function renderReviewDecision(decision: {
  runId: string;
  reviewStatus: string;
  acceptedAt?: string;
  rejectedAt?: string;
  reason?: string;
  message?: string;
}): string {
  return [
    `run_id: ${decision.runId}`,
    `review_status: ${decision.reviewStatus}`,
    `accepted_at: ${decision.acceptedAt ?? "none"}`,
    `rejected_at: ${decision.rejectedAt ?? "none"}`,
    `reason: ${decision.reason ?? "none"}`,
    `message: ${decision.message ?? "none"}`,
    ""
  ].join("\n");
}

async function listRoleCalls(
  args: string[],
  io: CliIO,
  runtime: CliRuntime
): Promise<number> {
  let parsed: ParsedRoleCallListArgs;
  try {
    parsed = parseRoleCallListArgs(args);
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  const calls = await runtime.roleCallRepository.list({
    threadId: parsed.threadId,
    role: parsed.role,
    callerRole: parsed.callerRole,
    calleeRole: parsed.calleeRole,
    status: parsed.status,
    todoStatus: parsed.todoStatus
  });
  if (parsed.json) {
    io.stdout.write(`${JSON.stringify({ roleCalls: calls }, null, 2)}\n`);
    return 0;
  }
  if (calls.length === 0) {
    io.stdout.write("No role calls found.\n");
    return 0;
  }
  io.stdout.write(
    [
      "role_call_id\tstatus\tcaller\tcallee\tthread_id\tlinked_run\ttask",
      ...calls.map((call) =>
        [
          call.id,
          roleCallStatusLabel(call),
          formatRoleHandle(call.callerRole),
          formatRoleHandle(call.calleeRole),
          call.threadId,
          call.taskRunId ?? "none",
          inlineText(call.task)
        ].join("\t")
      ),
      ""
    ].join("\n")
  );
  return 0;
}

async function showRoleCall(
  args: string[],
  io: CliIO,
  runtime: CliRuntime
): Promise<number> {
  let parsed: ParsedRoleCallShowArgs;
  try {
    parsed = parseRoleCallShowArgs(args);
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  const call = await runtime.roleCallRepository.get(parsed.roleCallId);
  if (!call) {
    io.stderr.write(`error: role call ${parsed.roleCallId} not found\n`);
    return 1;
  }
  const [events, todo, linkedRun] = await Promise.all([
    runtime.roleCallEventRepository.listByRoleCallId(call.id),
    call.todoId ? runtime.roleTodoRepository.get(call.todoId) : undefined,
    call.taskRunId ? runtime.taskRunRepository.get(call.taskRunId) : undefined
  ]);
  if (parsed.json) {
    io.stdout.write(
      `${JSON.stringify({ roleCall: call, todo, events, linkedRun }, null, 2)}\n`
    );
    return 0;
  }
  io.stdout.write(renderRoleCallDetail(call, events, todo, linkedRun !== undefined));
  return 0;
}

async function listRoleTodos(
  args: string[],
  io: CliIO,
  runtime: CliRuntime
): Promise<number> {
  let parsed: ParsedRoleTodoListArgs;
  try {
    parsed = parseRoleTodoListArgs(args);
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  const todos = await runtime.roleTodoRepository.list({
    threadId: parsed.threadId,
    role: parsed.role,
    sourceRoleCallId: parsed.sourceRoleCallId,
    status: parsed.status
  });
  if (parsed.json) {
    io.stdout.write(`${JSON.stringify({ roleTodos: todos }, null, 2)}\n`);
    return 0;
  }
  if (todos.length === 0) {
    io.stdout.write("No role todos found.\n");
    return 0;
  }
  io.stdout.write(
    [
      "role_todo_id\tstatus\trole\tthread_id\tsource_role_call\ttitle",
      ...todos.map((todo) =>
        [
          todo.id,
          todo.status,
          formatRoleHandle(todo.role),
          todo.threadId,
          todo.sourceRoleCallId ?? "none",
          inlineText(todo.title)
        ].join("\t")
      ),
      ""
    ].join("\n")
  );
  return 0;
}

async function listRoleEvents(
  args: string[],
  io: CliIO,
  runtime: CliRuntime
): Promise<number> {
  let parsed: ParsedRoleEventListArgs;
  try {
    parsed = parseRoleEventListArgs(args);
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  const events = parsed.roleCallId
    ? await runtime.roleCallEventRepository.listByRoleCallId(parsed.roleCallId)
    : await runtime.roleCallEventRepository.listByThreadId(parsed.threadId);
  if (parsed.json) {
    io.stdout.write(`${JSON.stringify({ roleCallEvents: events }, null, 2)}\n`);
    return 0;
  }
  if (events.length === 0) {
    io.stdout.write("No role events found.\n");
    return 0;
  }
  io.stdout.write(
    [
      "role_event_id\trole_call_id\ttype\tactor\tcreated_at\tmessage",
      ...events.map((event) =>
        [
          event.id,
          event.roleCallId,
          event.type,
          event.actorRole ? formatRoleHandle(event.actorRole) : "system",
          event.createdAt,
          inlineText(event.message)
        ].join("\t")
      ),
      ""
    ].join("\n")
  );
  return 0;
}

function renderRoleCallDetail(
  call: RoleCall,
  events: RoleCallEvent[],
  todo: RoleTodo | undefined,
  linkedRunExists: boolean
): string {
  return [
    `role_call_id: ${call.id}`,
    `thread_id: ${call.threadId}`,
    `status: ${roleCallStatusLabel(call)}`,
    `caller: ${formatRoleHandle(call.callerRole)}`,
    `callee: ${formatRoleHandle(call.calleeRole)}`,
    `task: ${call.task}`,
    `priority: ${call.priority}`,
    `todo_id: ${todo?.id ?? call.todoId ?? "none"}`,
    `linked_run: ${call.taskRunId ?? "none"}`,
    ...(call.taskRunId
      ? [
          `linked_run_exists: ${linkedRunExists}`,
          "review_commands:",
          `  agent-hub runs show ${call.taskRunId}`,
          `  agent-hub runs events ${call.taskRunId}`,
          `  agent-hub runs diff ${call.taskRunId} --stat`,
          `  agent-hub risks show ${call.taskRunId}`
        ]
      : []),
    `decision: ${
      call.decision
        ? `${call.decision.disposition} - ${inlineText(call.decision.reason)}`
        : "none"
    }`,
    `result: ${call.result ? inlineText(call.result.summary) : "none"}`,
    `error: ${call.error ? inlineText(call.error) : "none"}`,
    `events: ${events.length}`,
    ...(events.length === 0
      ? []
      : events.map((event) =>
          `  - ${event.createdAt} ${event.type} ${inlineText(event.message)}`
        )),
    ""
  ].join("\n");
}

interface ParsedRoleCallListArgs {
  threadId?: string;
  role?: string;
  callerRole?: string;
  calleeRole?: string;
  status?: RoleCallStatus;
  todoStatus?: RoleTodoStatus;
  json: boolean;
}

interface ParsedRoleCallShowArgs {
  roleCallId: string;
  json: boolean;
}

interface ParsedRoleTodoListArgs {
  threadId?: string;
  role?: string;
  sourceRoleCallId?: string;
  status?: RoleTodoStatus;
  json: boolean;
}

interface ParsedRoleEventListArgs {
  roleCallId?: string;
  threadId: string;
  json: boolean;
}

function parseRoleCallListArgs(args: string[]): ParsedRoleCallListArgs {
  const parsed: ParsedRoleCallListArgs = { json: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--thread-id") {
      parsed.threadId = requiredValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--role") {
      parsed.role = normalizeRoleFilter(requiredValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--caller-role") {
      parsed.callerRole = normalizeRoleFilter(requiredValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--callee-role") {
      parsed.calleeRole = normalizeRoleFilter(requiredValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--status") {
      parsed.status = parseRoleCallStatus(requiredValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--todo-status") {
      parsed.todoStatus = parseRoleTodoStatus(requiredValue(args, index, arg));
      index += 1;
      continue;
    }
    throw new Error(`unknown role-calls list flag ${arg}`);
  }
  return parsed;
}

function parseRoleCallShowArgs(args: string[]): ParsedRoleCallShowArgs {
  const roleCallId = args[0];
  if (!roleCallId) {
    throw new Error("role call id is required");
  }
  const flags = args.slice(1);
  const unknownFlag = flags.find((flag) => flag !== "--json");
  if (unknownFlag) {
    throw new Error(`unknown role-calls show flag ${unknownFlag}`);
  }
  return { roleCallId, json: flags.includes("--json") };
}

function parseRoleTodoListArgs(args: string[]): ParsedRoleTodoListArgs {
  const parsed: ParsedRoleTodoListArgs = { json: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--thread-id") {
      parsed.threadId = requiredValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--role") {
      parsed.role = normalizeRoleFilter(requiredValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--source-role-call-id") {
      parsed.sourceRoleCallId = requiredValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--status") {
      parsed.status = parseRoleTodoStatus(requiredValue(args, index, arg));
      index += 1;
      continue;
    }
    throw new Error(`unknown role-todos list flag ${arg}`);
  }
  return parsed;
}

function parseRoleEventListArgs(args: string[]): ParsedRoleEventListArgs {
  let roleCallId: string | undefined;
  let threadId: string | undefined;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--role-call-id") {
      roleCallId = requiredValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--thread-id") {
      threadId = requiredValue(args, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`unknown role-events list flag ${arg}`);
  }
  if (roleCallId && threadId) {
    throw new Error("role-events list accepts only one of --role-call-id or --thread-id");
  }
  if (!roleCallId && !threadId) {
    throw new Error("role-events list requires --role-call-id or --thread-id");
  }
  return { roleCallId, threadId: threadId ?? "", json };
}

function parseRoleCallStatus(value: string): RoleCallStatus {
  if ((roleCallStatuses as readonly string[]).includes(value)) {
    return value as RoleCallStatus;
  }
  throw new Error(`unknown role call status ${value}`);
}

function parseRoleTodoStatus(value: string): RoleTodoStatus {
  if ((roleTodoStatuses as readonly string[]).includes(value)) {
    return value as RoleTodoStatus;
  }
  throw new Error(`unknown role todo status ${value}`);
}

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function normalizeRoleFilter(value: string): string {
  return value.replace(/^@/, "").trim();
}

function formatRoleHandle(value: string): string {
  return `@${normalizeRoleFilter(value)}`;
}

function roleCallStatusLabel(call: RoleCall): string {
  if (call.status === "deferred" || call.status === "rejected") {
    return `${call.status} (decision)`;
  }
  if (call.status === "failed") {
    return "failed (execution)";
  }
  return call.status;
}

function renderRunDiffStat(review: RunDiffReview): string {
  return [
    `run_id: ${review.run.id}`,
    `files_changed: ${review.stat.filesChanged}`,
    `insertions: ${review.stat.insertions}`,
    `deletions: ${review.stat.deletions}`,
    `stat: ${review.stat.text ?? `${review.stat.filesChanged} files changed`}`,
    "changed_files:",
    ...(review.changedFiles.length === 0
      ? ["- none"]
      : review.changedFiles.map((file) => `- ${file}`)),
    "file_summaries:",
    ...(review.fileSummaries.length === 0
      ? ["- none"]
      : review.fileSummaries.map((summary) => `- ${summary}`)),
    ""
  ].join("\n");
}

function renderRunDiffPatch(review: RunDiffReview): string {
  return [
    `run_id: ${review.run.id}`,
    `patch_bytes: ${review.originalPatchLength}`,
    `truncated: ${review.truncated}`,
    review.patch,
    ...(review.truncated
      ? [
          `... truncated at ${review.limit} characters; rerun with --full to print the complete persisted patch.`
        ]
      : []),
    ""
  ].join("\n");
}

function parseRunDiffArgs(args: string[]): {
  runId: string;
  mode: "stat" | "patch";
  fullPatch: boolean;
} {
  const runId = args[0];
  if (!runId) {
    throw new Error("run id is required");
  }
  const flags = args.slice(1);
  const unknownFlag = flags.find((flag) => !["--stat", "--patch", "--full"].includes(flag));
  if (unknownFlag) {
    throw new Error(`unknown runs diff flag ${unknownFlag}`);
  }
  const stat = flags.includes("--stat");
  const patch = flags.includes("--patch");
  if (stat && patch) {
    throw new Error("runs diff accepts only one of --stat or --patch");
  }
  if (flags.includes("--full") && !patch) {
    throw new Error("--full requires --patch");
  }
  return {
    runId,
    mode: patch ? "patch" : "stat",
    fullPatch: flags.includes("--full")
  };
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
    const comparison = await buildComparisonReport(
      {
        taskRepository: runtime.taskRepository,
        taskRunRepository: runtime.taskRunRepository,
        runArtifactRepository: runtime.runArtifactRepository,
        runMetadataRepository: runtime.runMetadataRepository,
        verificationResultRepository: runtime.verificationResultRepository,
        riskReportRepository: runtime.riskReportRepository
      },
      { taskId, baselineRunId, candidateRunId }
    );
    const report = await runtime.comparisonReportRepository.create(
      validateComparisonReport({
        id: createId("comparison"),
        taskId,
        baselineRunId,
        candidateRunId,
        summary: comparison.summary,
        details: comparison.details,
        createdAt: nowIso()
      })
    );
    io.stdout.write(
      [
        "Created comparison report",
        `id: ${report.id}`,
        report.summary,
        report.details
          ? `structured_signals:\n${JSON.stringify(report.details, null, 2)}`
          : "structured_signals: none",
        ""
      ].join("\n")
    );
    return 0;
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? "";
}

function inlineText(value: string): string {
  return value.replace(/\r?\n/g, "\\n");
}

type CliRunResult = Awaited<ReturnType<TaskRunner["run"]>>;

function renderAgentOutput(result: CliRunResult): string {
  return `${extractAgentOutput(result).trimEnd() || "(no agent output)"}\n`;
}

function extractAgentOutput(result: CliRunResult): string {
  return extractAgentFacingOutput(
    { events: result.events },
    { preferExplicitOutput: true }
  );
}

function renderRunDebug(
  result: CliRunResult,
  input: RunTaskInput,
  deliveryMode: RunContextDeliveryMode
): string {
  const lines = [
    "debug:",
    "run_summary:",
    `- task_id: ${result.task.id}`,
    `- run_id: ${result.run.id}`,
    `- agent: ${result.run.agentKind}`,
    `- status: ${result.status}`,
    `- context_delivery: ${deliveryMode}`,
    `- worktree_path: ${result.worktreePath ?? "none"}`,
    `- branch_name: ${result.run.branchName ?? "none"}`,
    `- parent_run_id: ${result.run.parentRunId ?? "none"}`,
    `- parent_message_id: ${result.run.parentMessageId ?? "none"}`,
    `- task_brief_path: ${result.taskBriefPath ?? "none"}`,
    `- changed_files: ${result.diff?.changedFiles.length ?? 0}`,
    `- verification: ${result.verification?.summary ?? "not available"}`,
    `- risk: ${result.riskReport?.level ?? "not available"}`,
    `- retained_workspace: ${result.workspaceCleanup?.retained ? result.worktreePath ?? "unknown" : "none"}`,
    `- events: ${result.events.length}`,
    `- warnings: ${result.warnings.length === 0 ? "none" : result.warnings.join(", ")}`,
    "agent_output:",
    indentBlock(extractAgentOutput(result) || "(none)", 2),
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
      indentBlock(renderDebugDiffPreview(result), 4)
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

function renderDebugDiffPreview(result: CliRunResult): string {
  if (hasBlockingSensitivePathFinding(result) || hasSensitiveChangedFile(result)) {
    return "(redacted: sensitive file path changed; review run artifacts with care)";
  }
  return truncateText(result.diff?.diff ?? "") || "(empty)";
}

function hasBlockingSensitivePathFinding(result: CliRunResult): boolean {
  return result.riskReport?.findings.some((finding) => {
    const category = (finding as { category?: unknown }).category;
    return (
      finding.level === "blocking" &&
      (category === "sensitive_path" ||
        finding.summary.toLowerCase().includes("sensitive file path"))
    );
  }) ?? false;
}

function hasSensitiveChangedFile(result: CliRunResult): boolean {
  return scanSensitivePaths(result.diff?.changedFiles ?? []).length > 0;
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

function cliAgentAvailability(debug: boolean): AgentAvailabilityOptions {
  return { env: process.env, debug };
}

function defaultCliAgent(debug: boolean): AgentKind {
  return defaultAgentKind(cliAgentAvailability(debug));
}

function availableCliAgents(debug: boolean): AgentKind[] {
  return availableAgentKinds(cliAgentAvailability(debug));
}

function parseAvailableAgent(value: string, debug: boolean): AgentKind {
  const agent = parseAgentKindAlias(value);
  requireAgentEnabled(agent, debug);
  return agent;
}

function requireAgentEnabled(agentKind: AgentKind, debug: boolean): void {
  try {
    assertAgentKindEnabled(agentKind, cliAgentAvailability(debug));
  } catch {
    throw new Error(disabledAgentMessage(agentKind));
  }
}

function disabledAgentMessage(agentKind: AgentKind): string {
  if (agentKind === "fake") {
    return "fake agent is disabled outside Agent Hub debug/development mode";
  }
  return `${agentKind} agent is disabled by Agent Hub agent availability config`;
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
  deliveryMode?: RunContextDeliveryMode;
  contextStoreRoot?: string;
  agentHubHome?: string;
  selectedSkillReferences: SkillReference[];
  continueFromRunId?: string;
  continueFromMessageId?: string;
  retainOnFailure: boolean;
  dryRun: boolean;
  debug: boolean;
  verificationCommands: Array<{ id: string; command: string; args: string[] }>;
}

async function resolveRunInput(
  options: ParsedRunArgs,
  runtime: CliRuntime,
  debug = false
): Promise<RunTaskInput> {
  const continueFrom = await resolveRunContinuation(options, runtime);
  const selectedSkillReferences =
    options.selectedSkillReferences.length > 0
      ? options.selectedSkillReferences
      : undefined;
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
    const agentKind = parseAvailableAgent(
      options.agentKind ?? defaultCliAgent(debug),
      debug
    );
    return {
      projectRoot: project.rootPath,
      taskId: task.id,
      projectId: task.projectId,
      title: task.title,
      taskPrompt: task.description ?? task.title,
      agentKind,
      agentHubHome: options.agentHubHome,
      selectedSkillReferences,
      continueFrom
    };
  }

  if (options.prompt !== undefined || options.agentKind !== undefined) {
    const agentKind = parseAvailableAgent(
      options.agentKind ?? defaultCliAgent(debug),
      debug
    );
    const taskPrompt = options.prompt ?? options.rawPrompt;
    if (!taskPrompt.trim()) {
      throw new Error("task prompt is required");
    }
    return {
      projectRoot: options.projectRoot,
      taskId: options.taskId,
      title: options.title,
      taskPrompt,
      agentKind,
      agentHubHome: options.agentHubHome,
      selectedSkillReferences,
      continueFrom
    };
  }

  if (!options.rawPrompt.trim()) {
    throw new Error("task prompt is required");
  }
  const parsed = parseAgentPrompt(
    options.rawPrompt,
    defaultCliAgent(debug),
    cliAgentAvailability(debug)
  );
  return {
    projectRoot: options.projectRoot,
    taskPrompt: parsed.prompt,
    agentKind: parsed.agentKind,
    agentHubHome: options.agentHubHome,
    selectedSkillReferences,
    continueFrom
  };
}

async function resolveRunContinuation(
  options: Pick<ParsedRunArgs, "continueFromRunId" | "continueFromMessageId">,
  runtime: CliRuntime
): Promise<RunContinuationInput | undefined> {
  if (options.continueFromRunId && options.continueFromMessageId) {
    throw new Error("--continue-from-run and --continue-from-message are mutually exclusive");
  }
  if (options.continueFromRunId) {
    return { parentRunId: options.continueFromRunId };
  }
  if (!options.continueFromMessageId) {
    return undefined;
  }
  const message = await runtime.conversationMessageRepository.get(
    options.continueFromMessageId
  );
  if (!message) {
    throw new Error(`message ${options.continueFromMessageId} not found`);
  }
  if (!message.runId) {
    throw new Error(`message ${message.id} is not linked to a run`);
  }
  return {
    parentRunId: message.runId,
    parentMessageId: message.id
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
  let deliveryMode: RunContextDeliveryMode | undefined;
  let contextStoreRoot: string | undefined;
  let agentHubHome: string | undefined;
  const selectedSkillReferences: SkillReference[] = [];
  let continueFromRunId: string | undefined;
  let continueFromMessageId: string | undefined;
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
      deliveryMode = parseRunDeliveryMode(args[index + 1]);
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
    if (parsingFlags && arg === "--agent-hub-home") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--agent-hub-home requires a path");
      }
      agentHubHome = path.resolve(cwd, value);
      index += 1;
      continue;
    }
    if (parsingFlags && arg === "--skill") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--skill requires a skill id");
      }
      selectedSkillReferences.push(parseSkillReferenceFlag(value));
      index += 1;
      continue;
    }
    if (parsingFlags && arg === "--continue-from-run") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--continue-from-run requires a run id");
      }
      continueFromRunId = value;
      index += 1;
      continue;
    }
    if (parsingFlags && arg === "--continue-from-message") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--continue-from-message requires a message id");
      }
      continueFromMessageId = value;
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
    agentHubHome,
    selectedSkillReferences,
    continueFromRunId,
    continueFromMessageId,
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
      agentKind = parseAgentKindAlias(value);
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

function repeatedFlag(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== flag) {
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value`);
    }
    values.push(value);
    index += 1;
  }
  return values;
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

function parseContextExportTarget(args: string[]): "repo" {
  const indexes = args
    .map((arg, index) => (arg === "--target" ? index : -1))
    .filter((index) => index !== -1);
  if (indexes.length === 0) {
    return "repo";
  }
  if (indexes.length > 1) {
    throw new Error("--target may only be provided once");
  }
  const index = indexes[0];
  if (index === undefined) {
    return "repo";
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error("--target requires a value");
  }
  if (value !== "repo") {
    throw new Error("--target must be repo");
  }
  return "repo";
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

function parseContextBuildDeliveryMode(
  value: string | undefined
): RunContextDeliveryMode | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "runtime_injection" || value === "worktree_overlay") {
    return value;
  }
  throw new Error(
    "--delivery-mode must be runtime_injection or worktree_overlay for context build"
  );
}

function parseRunDeliveryMode(value: string | undefined): RunContextDeliveryMode | undefined {
  if (value === undefined) {
    throw new Error("--delivery-mode requires a value");
  }
  if (value === "runtime_injection" || value === "worktree_overlay") {
    return value;
  }
  throw new Error(
    "--delivery-mode must be runtime_injection or worktree_overlay for task runs"
  );
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
    process.exit(exitCode);
  });
}
