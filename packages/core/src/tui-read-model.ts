import {
  evaluateRoleCallGraphConvergence,
  type RoleCallGraphConvergenceReason
} from "./role-call-convergence";
import { extractAgentFacingOutput } from "./run-output";
import {
  isAgentKindEnabled,
  presetWorkgroupRoles,
  validateWorkgroupRole,
  type WorkgroupExecutor,
  type WorkgroupRole
} from "./domain";
import type {
  AgentKind,
  ConversationMessage,
  ConversationThread,
  JsonObject,
  MemoryStatus,
  Project,
  RiskLevel,
  RoleCall,
  RoleCallEvent,
  RoleCallStatus,
  RoleTodo,
  RoleTodoStatus,
  RunArtifact,
  RunEvent,
  Skill,
  Task,
  TaskRun,
  TaskRunStatus,
  VerificationResult,
  VerificationStatus,
  WorkgroupTaskAssignmentMetadata
} from "./domain";
import type {
  ConversationMessageRepository,
  ConversationThreadRepository,
  MemoryItemRepository,
  ProjectRepository,
  RiskReportRepository,
  RoleCallEventRepository,
  RoleCallRepository,
  RoleTodoRepository,
  RunArtifactRepository,
  RunMetadataRepository,
  SkillRepository,
  SettingsRepository,
  TaskRepository,
  TaskRunRepository,
  VerificationResultRepository
} from "./storage";

export interface TuiReadModelRepositories {
  projectRepository: ProjectRepository;
  conversationThreadRepository: ConversationThreadRepository;
  conversationMessageRepository: ConversationMessageRepository;
  taskRepository: TaskRepository;
  taskRunRepository: TaskRunRepository;
  runEventRepository: {
    listByRunId(runId: string): Promise<RunEvent[]>;
  };
  runArtifactRepository: RunArtifactRepository;
  verificationResultRepository: VerificationResultRepository;
  riskReportRepository: RiskReportRepository;
  runMetadataRepository: RunMetadataRepository;
  memoryItemRepository: MemoryItemRepository;
  skillRepository: SkillRepository;
  roleCallRepository: RoleCallRepository;
  roleCallEventRepository: RoleCallEventRepository;
  roleTodoRepository: RoleTodoRepository;
  settingsRepository?: SettingsRepository;
}

export interface TuiCurrentContextInput {
  projectId?: string;
  threadId?: string;
  selectedRunId?: string;
  selectedRoleCallId?: string;
  selectedAgent?: AgentKind;
  selectedSkillReferences?: string[];
  contextMode?: "auto" | "runtime_injection" | "worktree_overlay" | "repo_export";
  iteration?: number;
  maxIterations?: number;
  hideCompletedRoleCalls?: boolean;
  maxMessages?: number;
  maxRuns?: number;
  maxRoleCalls?: number;
  maxTodos?: number;
  maxTasks?: number;
  maxSkills?: number;
}

export interface TuiCurrentContextModel {
  context: TuiContextSummary;
  conversation: TuiConversationEntry[];
  activeRuns: TuiActiveRunBox[];
  transcript: TuiTranscriptMessage[];
  runs: TuiRunSummary[];
  roleCalls: TuiRoleCallGraphSummary;
  review: TuiReviewSelectionSummary;
  tasks: TuiTaskSummary[];
  team: TuiTeamSummary;
  memory: TuiMemorySummary;
  skills: TuiSkillsSummary;
  warnings: string[];
}

export type TuiConversationEntryType =
  | "user_message"
  | "agent_completed"
  | "agent_failed"
  | "review_pending"
  | "delegation";

export interface TuiConversationEntry {
  id: string;
  type: TuiConversationEntryType;
  timestamp: string;
  author: string;
  displayHandle?: string;
  content?: string;
  agent?: string;
  runId?: string;
  roleCallId?: string;
  outputLines?: string[];
  statusLabel?: string;
  verificationLine?: string;
  riskLine?: string;
  elapsedLabel?: string;
  usageLabel?: string;
  delegatedTo?: string;
  delegationTask?: string;
}

export interface TuiActiveRunBox {
  runId: string;
  agent: string;
  displayHandle?: string;
  title: string;
  startedAt?: string;
  elapsedLabel?: string;
  usageLabel?: string;
  usage?: TuiRunUsageSummary;
  outputLines: string[];
}

export interface TuiContextSummary {
  projectId?: string;
  projectName?: string;
  projectRoot?: string;
  threadId?: string;
  threadTitle?: string;
  roomHandle?: string;
  selectedAgent?: AgentKind;
  contextMode: string;
}

export interface TuiTranscriptMessage {
  id: string;
  sequence: number;
  role: ConversationMessage["role"];
  kind: ConversationMessage["kind"];
  author: string;
  content: string;
  agentKind?: AgentKind;
  runId?: string;
  status?: TaskRunStatus;
  createdAt: string;
}

export interface TuiRunSummary {
  id: string;
  taskId: string;
  taskTitle?: string;
  agentKind: AgentKind;
  roleHandle?: string;
  status: TaskRunStatus;
  stage: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
  elapsedLabel?: string;
  usageLabel?: string;
  usage?: TuiRunUsageSummary;
  parentRunId?: string;
  parentMessageId?: string;
  retainedWorktree: boolean;
  evidence: TuiEvidenceSummary;
  reviewDecision: TuiRunReviewDecisionSummary;
  commands: string[];
}

export interface TuiRunUsageSummary {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

export interface TuiRunReviewDecisionSummary {
  status: "pending" | "accepted" | "rejected";
  acceptedAt?: string;
  rejectedAt?: string;
  reason?: string;
  message?: string;
}

export interface TuiRoleCallGraphSummary {
  nodes: TuiRoleCallNodeSummary[];
  todos: TuiRoleTodoSummary[];
  counts: {
    total: number;
    visible: number;
    active: number;
    pending: number;
    waiting: number;
    failed: number;
    terminal: number;
  };
  loop: TuiLoopSummary;
}

export interface TuiLoopSummary {
  iteration: number;
  maxIterations?: number;
  pendingRoleCallIds: string[];
  waitingRoleCallIds: string[];
  activeRoleCallIds: string[];
  stopReason: TuiLoopStopReason;
  convergenceReason: RoleCallGraphConvergenceReason;
}

export type TuiLoopStopReason =
  | "none"
  | "terminal"
  | "pending_role_calls"
  | "waiting_approval"
  | "waiting_context"
  | "blocking_risk"
  | "max_iterations";

export interface TuiRoleCallNodeSummary {
  id: string;
  threadId: string;
  parentRoleCallId?: string;
  callerRole: string;
  calleeRole: string;
  task: string;
  status: RoleCallStatus;
  statusLabel: string;
  priority: RoleCall["priority"];
  depth: number;
  linkedRunId?: string;
  todoId?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  hidden: boolean;
  evidence: TuiEvidenceSummary;
}

export interface TuiRoleTodoSummary {
  id: string;
  role: string;
  title: string;
  status: RoleTodoStatus;
  priority: RoleTodo["priority"];
  sourceRoleCallId?: string;
  relatedRoleCallIds: string[];
  updatedAt: string;
}

export interface TuiReviewSelectionSummary {
  kind: "none" | "run" | "role_call";
  selectedId?: string;
  title: string;
  summary: string;
  evidence: TuiEvidenceSummary;
  commands: string[];
}

export interface TuiTaskSummary {
  id: string;
  title: string;
  status: Task["status"];
  updatedAt: string;
  assignmentCount: number;
  executableAssignmentCount: number;
  assignments: TuiAssignmentSummary[];
  roleTodos: TuiRoleTodoSummary[];
  followUps: string[];
  nextAction?: string;
}

export interface TuiAssignmentSummary {
  id: string;
  label: string;
  role?: string;
  agent?: string;
  executable: boolean;
  status: WorkgroupTaskAssignmentMetadata["status"];
  runId?: string;
}

export type TuiTeamRoleSource = "preset" | "preset_override" | "custom";

export interface TuiTeamSummary {
  projectId?: string;
  roles: TuiTeamRoleSummary[];
  counts: {
    total: number;
    enabled: number;
    runnable: number;
    reserved: number;
    custom: number;
    presetOverrides: number;
  };
  command?: string;
}

export interface TuiTeamRoleSummary {
  id: string;
  handle: string;
  displayName: string;
  source: TuiTeamRoleSource;
  enabled: boolean;
  executorKind: WorkgroupExecutor["kind"];
  executorLabel: string;
  executorRunnable: boolean;
  defaultRoom?: string;
  capabilitySummary: string;
  defaultSkillReferences: NonNullable<WorkgroupRole["defaultSkillReferences"]>;
  unavailableReason?: string;
}

export interface TuiMemorySummary {
  projectId?: string;
  counts: Record<MemoryStatus, number>;
  command?: string;
  approvalCommands: string[];
  approvedSource: string;
  approvalReminder: string;
}

export interface TuiSkillsSummary {
  contextMode: string;
  runtimeSource: string;
  selected: TuiSkillSummary[];
  available: TuiSkillSummary[];
}

export interface TuiSkillSummary {
  id: string;
  name: string;
  description: string;
  scope: "project" | "global" | "unknown";
  selected: boolean;
}

export interface TuiEvidenceSummary {
  linkedRunId?: string;
  latestEvent?: string;
  resultSummary?: string;
  waitingReason?: string;
  checks?: {
    passed: number;
    failed: number;
    skipped: number;
    failedNames: string[];
  };
  risk?: {
    level: RiskLevel;
    primaryReason?: string;
  };
  diff?: {
    changedFiles: number;
    insertions?: number;
    deletions?: number;
  };
}

const defaultLimits = {
  messages: 12,
  runs: 8,
  roleCalls: 24,
  todos: 12,
  tasks: 8,
  skills: 12,
  contentChars: 180,
  agentOutputChars: 1_200
};

const activeRunStatuses = new Set<TaskRunStatus>(["running"]);
const terminalRunStatuses = new Set<TaskRunStatus>([
  "succeeded",
  "failed",
  "cancelled"
]);
const activeRoleCallStatuses = new Set<RoleCallStatus>([
  "proposed",
  "assessing",
  "accepted",
  "queued",
  "running"
]);
const pendingRoleCallStatuses = new Set<RoleCallStatus>([
  "proposed",
  "assessing",
  "accepted",
  "queued",
  "running",
  "waiting_context"
]);
const waitingRoleCallStatuses = new Set<RoleCallStatus>([
  "waiting_approval",
  "waiting_context"
]);
const terminalRoleCallStatuses = new Set<RoleCallStatus>([
  "succeeded",
  "failed",
  "cancelled"
]);
const roleSettingsPrefix = "desktop.project.";
const roleSettingsSuffix = ".workgroupRoles";
const maxStoredRoles = 32;

export async function buildTuiCurrentContextModel(
  repositories: TuiReadModelRepositories,
  input: TuiCurrentContextInput
): Promise<TuiCurrentContextModel> {
  const warnings: string[] = [];
  const thread = input.threadId
    ? await repositories.conversationThreadRepository.get(input.threadId)
    : await latestThreadForProject(repositories, input.projectId);
  if (input.threadId && !thread) {
    warnings.push(`thread ${input.threadId} not found`);
  }

  const projectId = input.projectId ?? thread?.projectId;
  const project = projectId
    ? await repositories.projectRepository.get(projectId)
    : undefined;
  if (projectId && !project) {
    warnings.push(`project ${projectId} not found`);
  }

  const [messages, tasks, roleCalls, roleTodos, roleEvents, memory, skills] =
    await Promise.all([
      thread
        ? repositories.conversationMessageRepository.listByThreadId(thread.id)
        : Promise.resolve([]),
      projectId
        ? repositories.taskRepository.listByProjectId(projectId)
        : repositories.taskRepository.list(),
      thread
        ? repositories.roleCallRepository.list({ threadId: thread.id })
        : Promise.resolve([]),
      thread
        ? repositories.roleTodoRepository.list({ threadId: thread.id })
        : Promise.resolve([]),
      thread
        ? repositories.roleCallEventRepository.listByThreadId(thread.id)
        : Promise.resolve([]),
      projectId
        ? repositories.memoryItemRepository.listByProjectId(projectId)
        : Promise.resolve([]),
      repositories.skillRepository.list()
    ]);
  const teamResult = await summarizeTeam(repositories, projectId);
  if (teamResult.warning) {
    warnings.push(teamResult.warning);
  }

  const contextTasks = filterTasksForThread(tasks, thread?.id);
  const runs = await runsForTasks(repositories, contextTasks);
  const runSummaries = await Promise.all(
    runs.map((run) => summarizeRun(repositories, run, taskById(contextTasks, run.taskId)))
  );
  const boundedRuns = sortRuns(runSummaries).slice(0, input.maxRuns ?? defaultLimits.runs);
  const runDisplayHandles = displayHandlesForRuns({
    runs: boundedRuns,
    messages,
    tasks: contextTasks,
    roleCalls
  });
  const activeRuns = await summarizeActiveRunBoxes(repositories, boundedRuns, runDisplayHandles);
  const roleCallNodes = await Promise.all(
    sortRoleCalls(roleCalls).map((call) =>
      summarizeRoleCall(repositories, call, roleEvents, input.hideCompletedRoleCalls === true)
    )
  );
  const visibleRoleCallNodes = roleCallNodes
    .filter((node) => !node.hidden)
    .slice(0, input.maxRoleCalls ?? defaultLimits.roleCalls);

  const conversation = await summarizeConversation(repositories, {
    messages,
    runs: boundedRuns,
    roleCalls,
    activeRuns,
    runDisplayHandles,
    limit: Math.max(input.maxMessages ?? defaultLimits.messages, defaultLimits.messages)
  });

  return {
    context: {
      projectId: project?.id ?? projectId,
      projectName: project?.name,
      projectRoot: project?.rootPath,
      threadId: thread?.id,
      threadTitle: thread?.title,
      roomHandle: thread ? roomHandleForThread(thread) : undefined,
      selectedAgent: input.selectedAgent,
      contextMode: input.contextMode ?? "runtime_injection"
    },
    conversation,
    activeRuns,
    transcript: summarizeTranscript(messages, input.maxMessages ?? defaultLimits.messages),
    runs: boundedRuns,
    roleCalls: {
      nodes: visibleRoleCallNodes,
      todos: summarizeTodos(roleTodos, input.maxTodos ?? defaultLimits.todos),
      counts: countRoleCalls(roleCallNodes, visibleRoleCallNodes.length),
      loop: summarizeLoop(roleCalls, boundedRuns, {
        iteration: input.iteration ?? 0,
        maxIterations: input.maxIterations
      })
    },
    review: selectReviewSummary(
      input,
      boundedRuns,
      visibleRoleCallNodes,
      input.selectedRoleCallId,
      input.selectedRunId
    ),
    tasks: summarizeTasks(
      contextTasks,
      roleTodos,
      roleCalls,
      input.maxTasks ?? defaultLimits.tasks
    ),
    team: teamResult.summary,
    memory: summarizeMemory(projectId, memory),
    skills: summarizeSkills({
      skills,
      projectId,
      selectedSkillReferences: input.selectedSkillReferences ?? [],
      maxSkills: input.maxSkills ?? defaultLimits.skills,
      contextMode: input.contextMode ?? "runtime_injection"
    }),
    warnings
  };
}

function summarizeTranscript(
  messages: ConversationMessage[],
  limit: number
): TuiTranscriptMessage[] {
  return [...messages]
    .sort((left, right) => left.sequence - right.sequence)
    .slice(-limit)
    .map((message) => ({
      id: message.id,
      sequence: message.sequence,
      role: message.role,
      kind: message.kind,
      author: messageAuthor(message),
      content: truncate(message.content, defaultLimits.contentChars),
      agentKind: message.agentKind,
      runId: message.runId,
      status: message.status,
      createdAt: message.createdAt
    }));
}

async function summarizeActiveRunBoxes(
  repositories: TuiReadModelRepositories,
  runs: TuiRunSummary[],
  runDisplayHandles: Map<string, string>
): Promise<TuiActiveRunBox[]> {
  const sorted = runs
    .filter((run) => activeRunStatuses.has(run.status))
    .sort((left, right) => activeRunCreatedAt(left).localeCompare(activeRunCreatedAt(right)));
  return Promise.all(sorted.map((run) => summarizeActiveRunBox(repositories, run, runDisplayHandles)));
}

async function summarizeActiveRunBox(
  repositories: TuiReadModelRepositories,
  run: TuiRunSummary,
  runDisplayHandles: Map<string, string>
): Promise<TuiActiveRunBox> {
  const events = await repositories.runEventRepository.listByRunId(run.id);
  const displayHandle = runDisplayHandles.get(run.id) ?? run.roleHandle;
  const renderedHandle = displayHandle ?? run.agentKind;
  return {
    runId: run.id,
    agent: run.agentKind,
    displayHandle,
    title: `@${renderedHandle} ${run.id} ● running`,
    startedAt: run.startedAt,
    elapsedLabel: run.elapsedLabel,
    usageLabel: run.usageLabel,
    usage: run.usage,
    outputLines: recentAgentRunOutputLines(events, run)
  };
}

async function summarizeConversation(
  repositories: TuiReadModelRepositories,
  input: {
  messages: ConversationMessage[];
  runs: TuiRunSummary[];
  roleCalls: RoleCall[];
  activeRuns: TuiActiveRunBox[];
  runDisplayHandles: Map<string, string>;
  limit: number;
}
): Promise<TuiConversationEntry[]> {
  const activeRunIds = new Set(input.activeRuns.map((run) => run.runId));
  const runLinkedMessages = new Map(
    input.messages
      .filter((message) => message.runId && message.role === "assistant")
      .map((message) => [message.runId as string, message.content])
  );
  const entries: Array<TuiConversationEntry & { sortRank: number }> = [];

  for (const message of input.messages) {
    const linkedRun = message.runId
      ? input.runs.find((run) => run.id === message.runId)
      : undefined;
    if (message.kind === "run_card" || message.role === "tool") {
      continue;
    }
    if (message.runId && activeRunIds.has(message.runId)) {
      continue;
    }
    if (linkedRun && terminalRunStatuses.has(linkedRun.status)) {
      continue;
    }
    if (message.role === "user") {
      entries.push({
        id: `message:${message.id}`,
        type: "user_message",
        timestamp: message.createdAt,
        author: messageAuthor(message),
        content: truncate(message.content, defaultLimits.contentChars),
        agent: message.agentKind,
        runId: message.runId,
        statusLabel: message.status,
        sortRank: 10 + message.sequence
      });
      continue;
    }
    entries.push({
      id: `message:${message.id}`,
      type: "agent_completed",
      timestamp: message.createdAt,
      author: messageAuthor(message),
      displayHandle: displayHandleFromMessage(message),
      outputLines: outputTextLines(message.content),
      agent: message.agentKind,
      runId: message.runId,
      statusLabel: "completed",
      sortRank: 10 + message.sequence
    });
  }

  const terminalRunEntries = await Promise.all(input.runs.map(async (run) => {
    if (!terminalRunStatuses.has(run.status) || activeRunIds.has(run.id)) {
      return [];
    }
    const displayHandle = input.runDisplayHandles.get(run.id) ?? run.roleHandle;
    const renderedHandle = displayHandle ?? run.agentKind;
    const outputLines = await terminalRunOutputLines(
      repositories,
      run,
      runLinkedMessages.get(run.id)
    );
    if (
      run.status === "succeeded" &&
      run.reviewDecision.status === "pending" &&
      runHasChangedFiles(run)
    ) {
      return [{
        id: `review-pending:${run.id}`,
        type: "review_pending" as const,
        timestamp: run.completedAt ?? run.updatedAt,
        author: `@${renderedHandle}`,
        displayHandle,
        content: "awaiting review — 切换到 [V]iew 查看详情",
        outputLines,
        agent: run.agentKind,
        runId: run.id,
        statusLabel: "awaiting review",
        verificationLine: conversationVerificationLine(run.evidence),
        riskLine: conversationRiskLine(run.evidence),
        elapsedLabel: run.elapsedLabel,
        usageLabel: run.usageLabel,
        sortRank: 30
      }];
    }
    const entryType = run.status === "succeeded" ? "agent_completed" : "agent_failed";
    return [{
      id: `run:${run.id}`,
      type: entryType as "agent_completed" | "agent_failed",
      timestamp: run.completedAt ?? run.updatedAt,
      author: `@${renderedHandle}`,
      displayHandle,
      outputLines,
      agent: run.agentKind,
      runId: run.id,
      statusLabel: terminalRunStatusLabel(run),
      verificationLine: conversationVerificationLine(run.evidence),
      riskLine: conversationRiskLine(run.evidence),
      elapsedLabel: run.elapsedLabel,
      usageLabel: run.usageLabel,
      sortRank: 30
    }];
  }));
  entries.push(...terminalRunEntries.flat());

  for (const call of input.roleCalls) {
    entries.push({
      id: `delegation:${call.id}`,
      type: "delegation",
      timestamp: call.createdAt,
      author: `@${call.callerRole}`,
      content: `delegated to @${call.calleeRole}: ${truncate(call.task, defaultLimits.contentChars)}`,
      roleCallId: call.id,
      delegatedTo: call.calleeRole,
      delegationTask: truncate(call.task, defaultLimits.contentChars),
      statusLabel: call.status,
      sortRank: 20
    });
  }

  return entries
    .sort(compareConversationEntries)
    .slice(-input.limit)
    .map(({ sortRank: _sortRank, ...entry }) => entry);
}

async function summarizeRun(
  repositories: TuiReadModelRepositories,
  run: TaskRun,
  task: Task | undefined
): Promise<TuiRunSummary> {
  const [evidence, reviewDecision, metadata, events] = await Promise.all([
    summarizeRunEvidence(repositories, run),
    summarizeRunReviewDecision(repositories, run.id),
    repositories.runMetadataRepository.get(run.id),
    repositories.runEventRepository.listByRunId(run.id)
  ]);
  const usage = summarizeRunUsage(events);
  return {
    id: run.id,
    taskId: run.taskId,
    taskTitle: task?.title,
    agentKind: run.agentKind,
    roleHandle: metadata?.role?.roleHandle,
    status: run.status,
    stage: runStage(run, evidence.latestEvent),
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    updatedAt: run.updatedAt,
    elapsedLabel: elapsedRunLabel(run),
    usageLabel: formatRunUsageLabel(usage),
    usage,
    parentRunId: run.parentRunId,
    parentMessageId: run.parentMessageId,
    retainedWorktree: Boolean(metadata?.workspaceCleanup?.retained),
    evidence,
    reviewDecision,
    commands: [
      `agent-hub runs show ${run.id}`,
      `agent-hub runs diff ${run.id} --stat`,
      `agent-hub risks show ${run.id}`
    ]
  };
}

async function summarizeRunReviewDecision(
  repositories: TuiReadModelRepositories,
  runId: string
): Promise<TuiRunReviewDecisionSummary> {
  const artifact = await repositories.runArtifactRepository.getLatestByRunIdAndKind(
    runId,
    "review_decision"
  );
  const metadata = artifact?.metadata;
  if (artifact && metadata?.reviewStatus === "accepted") {
    return {
      status: "accepted",
      acceptedAt:
        typeof metadata.acceptedAt === "string" ? metadata.acceptedAt : artifact.createdAt,
      reason: typeof metadata.reason === "string" ? metadata.reason : undefined,
      message: artifact.content
    };
  }
  if (artifact && metadata?.reviewStatus === "rejected") {
    return {
      status: "rejected",
      rejectedAt:
        typeof metadata.rejectedAt === "string" ? metadata.rejectedAt : artifact.createdAt,
      reason: typeof metadata.reason === "string" ? metadata.reason : undefined,
      message: artifact.content
    };
  }
  return { status: "pending" };
}

async function summarizeRunEvidence(
  repositories: TuiReadModelRepositories,
  run: TaskRun
): Promise<TuiEvidenceSummary> {
  const [events, verification, riskReport, metadata, diffArtifact] = await Promise.all([
    repositories.runEventRepository.listByRunId(run.id),
    repositories.verificationResultRepository.listByRunId(run.id),
    repositories.riskReportRepository.getLatestByRunId(run.id),
    repositories.runMetadataRepository.get(run.id),
    repositories.runArtifactRepository.getLatestByRunIdAndKind(run.id, "git_diff")
  ]);
  const latestEvent = [...events].sort((left, right) => left.sequence - right.sequence).at(-1);
  const risk = riskReport ?? metadata?.riskReport;
  const diff = diffSummary(diffArtifact, metadata?.diff);
  return {
    linkedRunId: run.id,
    latestEvent: latestEvent ? truncate(latestEvent.message, defaultLimits.contentChars) : undefined,
    resultSummary: resultSummary(events, run),
    checks: verification.length > 0 ? summarizeChecks(verification) : undefined,
    risk: risk
      ? {
          level: risk.level,
          primaryReason: risk.riskFactors[0] ?? risk.summary
        }
      : undefined,
    diff
  };
}

async function terminalRunOutputLines(
  repositories: TuiReadModelRepositories,
  run: TuiRunSummary,
  linkedMessageContent: string | undefined
): Promise<string[]> {
  const events = await repositories.runEventRepository.listByRunId(run.id);
  const agentOutput = extractAgentFacingOutput(
    { events: events.map(toAgentOutputEvent) },
    { includeTerminalSummaries: false }
  );
  const outputLines = outputTextLines(agentOutput);
  if (outputLines.length > 0) {
    return outputLines;
  }
  if (linkedMessageContent) {
    const linkedLines = outputTextLines(linkedMessageContent);
    if (linkedLines.length > 0) {
      return linkedLines;
    }
  }
  if (run.evidence.resultSummary) {
    return [run.evidence.resultSummary];
  }
  return [`${run.agentKind} ${run.status}`];
}

function recentAgentRunOutputLines(events: RunEvent[], run: TuiRunSummary): string[] {
  const agentOutput = extractAgentFacingOutput(
    { events: events.map(toAgentOutputEvent) },
    { includeRawStreams: false, includeTerminalSummaries: false }
  );
  const outputLines = outputTextLines(agentOutput);
  if (outputLines.length > 0) {
    return outputLines.slice(-6);
  }
  const activityLines = events
    .sort((left, right) => left.sequence - right.sequence)
    .flatMap(activeRunEventLines)
    .map((line) => truncate(line, 120))
    .slice(-6);
  return activityLines.length > 0
    ? activityLines
    : [`${run.agentKind} ${run.status}`, "waiting for observable output..."];
}

function outputTextLines(value: string): string[] {
  return visibleTuiOutputLines(value)
    .map((line) => truncate(line, 120));
}

function visibleTuiOutputLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !isTuiOutputNoiseLine(line));
}

function toAgentOutputEvent(event: RunEvent): {
  type: string;
  message: string;
  metadata?: JsonObject;
} {
  return {
    type: event.type,
    message: event.message,
    metadata: event.metadata
  };
}

function activeRunEventLines(event: RunEvent): string[] {
  const phase = typeof event.metadata?.phase === "string" ? event.metadata.phase : undefined;
  if (phase === "context") {
    return [];
  }
  const desktopEventType =
    typeof event.metadata?.desktopEventType === "string"
      ? event.metadata.desktopEventType
      : undefined;
  if (desktopEventType === "context_compiled") {
    return [];
  }
  if (event.type === "stdout" || event.type === "stderr") {
    const prefix = event.type === "stderr" ? "stderr: " : "";
    return humanReadableStreamLines(event.message).map((line) => `${prefix}${line}`);
  }
  if (
    event.type !== "message" &&
    event.type !== "status" &&
    event.type !== "error" &&
    event.type !== "exit"
  ) {
    return [];
  }
  const prefix = event.type === "error" ? "error: " : event.type === "exit" ? "exit: " : "";
  return visibleTuiOutputLines(runEventDisplayText(event)).map((line) => `${prefix}${line}`);
}

function runEventDisplayText(event: RunEvent): string {
  const metadataMessage = event.metadata?.message;
  const metadataSummary = event.metadata?.summary;
  if (typeof metadataMessage === "string" && metadataMessage.trim().length > 0) {
    return metadataMessage.trim();
  }
  if (typeof metadataSummary === "string" && metadataSummary.trim().length > 0) {
    return metadataSummary.trim();
  }
  return event.message.trim();
}

function humanReadableStreamLines(value: string): string[] {
  return visibleTuiOutputLines(value);
}

function isTuiOutputNoiseLine(value: string): boolean {
  return (
    isJsonObjectLine(value) ||
    /^Context compiled/i.test(value) ||
    /^TaskRunner execution started\.?$/i.test(value) ||
    /^Isolated worktree is ready\.?$/i.test(value) ||
    /^starting (Codex|Claude Code|Claude|Fake Agent)/i.test(value) ||
    /^(Codex|Claude Code|Claude) preflight passed/i.test(value) ||
    /^(Codex|Claude Code|Claude) (thread|turn|session|item)\.[A-Za-z_]+/i.test(value) ||
    /^Using [`'"].+[`'"] to satisfy/i.test(value) ||
    /\bExperimentalWarning\b/.test(value) ||
    /Unsupported engine: wanted:/i.test(value) ||
    /Vite's Node API is deprecated/i.test(value)
  );
}

function isJsonObjectLine(value: string): boolean {
  if (!value.startsWith("{") || !value.endsWith("}")) {
    return false;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

function activeRunEvidenceLines(run: TuiRunSummary): string[] {
  return [
    conversationVerificationLine(run.evidence),
    conversationRiskLine(run.evidence),
    run.evidence.diff
      ? `files ${run.evidence.diff.changedFiles} +${run.evidence.diff.insertions ?? 0} -${run.evidence.diff.deletions ?? 0}`
      : undefined
  ].filter((line): line is string => line !== undefined);
}

function activeRunCreatedAt(run: TuiRunSummary): string {
  return run.startedAt ?? run.completedAt ?? run.updatedAt;
}

function elapsedRunLabel(run: TaskRun): string | undefined {
  if (!run.startedAt) {
    return undefined;
  }
  const startedAt = Date.parse(run.startedAt);
  const endedAt = Date.parse(run.completedAt ?? run.updatedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) {
    return undefined;
  }
  return formatElapsedDuration(endedAt - startedAt);
}

function formatElapsedDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds === 0 ? `${minutes}m` : `${minutes}m${remainingSeconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0 ? `${hours}h` : `${hours}h${remainingMinutes}m`;
}

function summarizeRunUsage(events: RunEvent[]): TuiRunUsageSummary | undefined {
  const usage: TuiRunUsageSummary = {};
  for (const event of events) {
    collectUsageValues(event.metadata, usage);
    collectUsageValues(parseJsonObject(event.message), usage);
  }
  const derivedTotal =
    usage.totalTokens ??
    (usage.inputTokens !== undefined || usage.outputTokens !== undefined
      ? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
      : undefined);
  if (derivedTotal !== undefined) {
    usage.totalTokens = derivedTotal;
  }
  return usage.inputTokens !== undefined ||
    usage.outputTokens !== undefined ||
    usage.totalTokens !== undefined ||
    usage.costUsd !== undefined
    ? usage
    : undefined;
}

function collectUsageValues(value: unknown, usage: TuiRunUsageSummary): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectUsageValues(item, usage);
    }
    return;
  }
  if (!isPlainRecord(value)) {
    return;
  }
  for (const [key, rawValue] of Object.entries(value)) {
    const numericValue = numericScalarValue(rawValue);
    if (numericValue !== undefined) {
      collectUsageNumber(key, numericValue, usage);
    }
    if (isPlainRecord(rawValue) || Array.isArray(rawValue)) {
      collectUsageValues(rawValue, usage);
    }
  }
}

function collectUsageNumber(
  key: string,
  value: number,
  usage: TuiRunUsageSummary
): void {
  if (value < 0 || !Number.isFinite(value)) {
    return;
  }
  const normalizedKey = key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  if (normalizedKey.includes("cost")) {
    usage.costUsd = maxDefined(usage.costUsd, value);
    return;
  }
  if (!normalizedKey.includes("token")) {
    return;
  }
  if (normalizedKey.includes("input") || normalizedKey.includes("prompt")) {
    usage.inputTokens = maxDefined(usage.inputTokens, Math.round(value));
    return;
  }
  if (normalizedKey.includes("output") || normalizedKey.includes("completion")) {
    usage.outputTokens = maxDefined(usage.outputTokens, Math.round(value));
    return;
  }
  if (
    normalizedKey.includes("total") ||
    normalizedKey === "tokens" ||
    normalizedKey === "tokencount" ||
    normalizedKey === "usageTokens".toLowerCase()
  ) {
    usage.totalTokens = maxDefined(usage.totalTokens, Math.round(value));
  }
}

function formatRunUsageLabel(usage: TuiRunUsageSummary | undefined): string | undefined {
  if (!usage) {
    return undefined;
  }
  const tokenTotal =
    usage.totalTokens ??
    (usage.inputTokens !== undefined || usage.outputTokens !== undefined
      ? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
      : undefined);
  const parts: string[] = [];
  if (tokenTotal !== undefined) {
    parts.push(`${formatTokenCount(tokenTotal)} tok`);
  } else {
    if (usage.inputTokens !== undefined) {
      parts.push(`${formatTokenCount(usage.inputTokens)} in`);
    }
    if (usage.outputTokens !== undefined) {
      parts.push(`${formatTokenCount(usage.outputTokens)} out`);
    }
  }
  if (usage.costUsd !== undefined) {
    parts.push(formatUsd(usage.costUsd));
  }
  return parts.length > 0 ? parts.join(" / ") : undefined;
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${trimTrailingZeroes(value / 1_000_000)}m`;
  }
  if (value >= 1_000) {
    return `${trimTrailingZeroes(value / 1_000)}k`;
  }
  return String(value);
}

function formatUsd(value: number): string {
  if (value === 0) {
    return "$0";
  }
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

function trimTrailingZeroes(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

function maxDefined(current: number | undefined, next: number): number {
  return current === undefined ? next : Math.max(current, next);
}

function numericScalarValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseJsonObject(value: string): JsonObject | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return isPlainRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function runHasChangedFiles(run: TuiRunSummary): boolean {
  return (run.evidence.diff?.changedFiles ?? 0) > 0;
}

function terminalRunStatusLabel(run: TuiRunSummary): string {
  return run.status === "succeeded" ? "completed" : "failed";
}

function conversationVerificationLine(
  evidence: TuiEvidenceSummary
): string | undefined {
  if (!evidence.checks) {
    return undefined;
  }
  const total = evidence.checks.passed + evidence.checks.failed + evidence.checks.skipped;
  if (evidence.checks.failed > 0) {
    const failedNames = evidence.checks.failedNames.length > 0
      ? `: ${evidence.checks.failedNames.join(", ")}`
      : "";
    return `verification failed (${total} checks${failedNames})`;
  }
  return `verification passed (${total} checks)`;
}

function conversationRiskLine(evidence: TuiEvidenceSummary): string | undefined {
  if (!evidence.risk) {
    return undefined;
  }
  return `risk ${evidence.risk.level}${evidence.risk.primaryReason ? `: ${evidence.risk.primaryReason}` : ""}`;
}

function reviewDecisionContent(run: TuiRunSummary): string {
  const status = run.reviewDecision.status;
  const reason = run.reviewDecision.reason
    ? `: ${run.reviewDecision.reason}`
    : "";
  return `${status}${reason}`;
}

function compareConversationEntries(
  left: TuiConversationEntry & { sortRank: number },
  right: TuiConversationEntry & { sortRank: number }
): number {
  const time = left.timestamp.localeCompare(right.timestamp);
  if (time !== 0) {
    return time;
  }
  if (left.sortRank !== right.sortRank) {
    return left.sortRank - right.sortRank;
  }
  return left.id.localeCompare(right.id);
}

async function summarizeRoleCall(
  repositories: TuiReadModelRepositories,
  call: RoleCall,
  threadEvents: RoleCallEvent[],
  hideCompleted: boolean
): Promise<TuiRoleCallNodeSummary> {
  const linkedRunEvidence: TuiEvidenceSummary = call.taskRunId
    ? await summarizeLinkedRunEvidence(repositories, call.taskRunId)
    : {};
  const callEvents = threadEvents
    .filter((event) => event.roleCallId === call.id)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const latestCallEvent = callEvents.at(-1);
  return {
    id: call.id,
    threadId: call.threadId,
    parentRoleCallId: call.parentRoleCallId,
    callerRole: call.callerRole,
    calleeRole: call.calleeRole,
    task: truncate(call.task, defaultLimits.contentChars),
    status: call.status,
    statusLabel: roleCallStatusLabel(call.status),
    priority: call.priority,
    depth: call.depth,
    linkedRunId: call.taskRunId,
    todoId: call.todoId,
    createdAt: call.createdAt,
    startedAt: call.startedAt,
    completedAt: call.completedAt,
    hidden: hideCompleted && call.status === "succeeded",
    evidence: {
      ...linkedRunEvidence,
      latestEvent:
        latestCallEvent?.message ??
        linkedRunEvidence.latestEvent,
      resultSummary:
        call.result?.summary ??
        call.decision?.reason ??
        call.error ??
        linkedRunEvidence.resultSummary,
      waitingReason:
        call.status === "waiting_approval" || call.status === "waiting_context"
          ? call.decision?.reason ?? call.error ?? latestCallEvent?.message
          : undefined
    }
  };
}

async function summarizeLinkedRunEvidence(
  repositories: TuiReadModelRepositories,
  runId: string
): Promise<TuiEvidenceSummary> {
  try {
    return await summarizeRunEvidence(
      repositories,
      await requiredRunForEvidence(repositories, runId)
    );
  } catch {
    return {
      linkedRunId: runId,
      latestEvent: "linked run evidence unavailable",
      resultSummary: "Linked run no longer exists or could not be read."
    };
  }
}

function summarizeTodos(todos: RoleTodo[], limit: number): TuiRoleTodoSummary[] {
  return [...todos]
    .sort(compareTodos)
    .slice(0, limit)
    .map((todo) => ({
      id: todo.id,
      role: todo.role,
      title: truncate(todo.title, defaultLimits.contentChars),
      status: todo.status,
      priority: todo.priority,
      sourceRoleCallId: todo.sourceRoleCallId,
      relatedRoleCallIds: [...todo.relatedRoleCallIds],
      updatedAt: todo.updatedAt
    }));
}

async function summarizeTeam(
  repositories: TuiReadModelRepositories,
  projectId: string | undefined
): Promise<{ summary: TuiTeamSummary; warning?: string }> {
  if (!projectId) {
    return { summary: emptyTeamSummary(undefined) };
  }
  try {
    const roles = await resolvedTeamRoles(repositories, projectId);
    const summaries = roles.map((entry) => toTuiTeamRoleSummary(entry.role, entry.source));
    return { summary: teamSummaryFromRoles(projectId, summaries) };
  } catch (error) {
    const summaries = presetWorkgroupRoles.map((role) =>
      toTuiTeamRoleSummary(role, "preset")
    );
    return {
      summary: teamSummaryFromRoles(projectId, summaries),
      warning: `team roles unavailable: ${errorMessage(error)}`
    };
  }
}

async function resolvedTeamRoles(
  repositories: TuiReadModelRepositories,
  projectId: string
): Promise<Array<{ role: WorkgroupRole; source: TuiTeamRoleSource }>> {
  const stored = await storedTeamRoles(repositories, projectId);
  const storedByHandle = new Map(stored.map((role) => [role.handle, role]));
  const presetHandles = new Set(presetWorkgroupRoles.map((role) => role.handle));
  const resolved: Array<{ role: WorkgroupRole; source: TuiTeamRoleSource }> =
    presetWorkgroupRoles.map((preset) => {
      const override = storedByHandle.get(preset.handle);
      return override
        ? { role: override, source: "preset_override" }
        : { role: preset, source: "preset" };
    });
  for (const role of stored) {
    if (presetHandles.has(role.handle)) {
      continue;
    }
    resolved.push({ role, source: "custom" });
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

async function storedTeamRoles(
  repositories: TuiReadModelRepositories,
  projectId: string
): Promise<WorkgroupRole[]> {
  if (!repositories.settingsRepository) {
    return [];
  }
  const setting = await repositories.settingsRepository.get(roleSettingsKey(projectId));
  if (!setting) {
    return [];
  }
  const roles = settingValueRoles(setting.value);
  return roles.map((role) => validateWorkgroupRole(role as WorkgroupRole));
}

function toTuiTeamRoleSummary(
  role: WorkgroupRole,
  source: TuiTeamRoleSource
): TuiTeamRoleSummary {
  const executorRunnable =
    role.executor.kind === "agent_adapter" &&
    isAgentKindEnabled(role.executor.adapterKind);
  return {
    id: role.id,
    handle: role.handle,
    displayName: role.displayName,
    source,
    enabled: role.enabled,
    executorKind: role.executor.kind,
    executorLabel: executorLabel(role.executor, executorRunnable),
    executorRunnable,
    defaultRoom: role.defaultRoom,
    capabilitySummary: truncate(role.capabilitySummary, defaultLimits.contentChars),
    defaultSkillReferences: role.defaultSkillReferences ?? [],
    unavailableReason:
      role.executor.kind === "agent_adapter"
        ? undefined
        : role.executor.unavailableReason
  };
}

function teamSummaryFromRoles(
  projectId: string,
  roles: TuiTeamRoleSummary[]
): TuiTeamSummary {
  return {
    projectId,
    roles,
    counts: {
      total: roles.length,
      enabled: roles.filter((role) => role.enabled).length,
      runnable: roles.filter((role) => role.enabled && role.executorRunnable).length,
      reserved: roles.filter((role) => role.executorKind !== "agent_adapter").length,
      custom: roles.filter((role) => role.source === "custom").length,
      presetOverrides: roles.filter((role) => role.source === "preset_override").length
    },
    command: `agent-hub team roles list --project-id ${projectId}`
  };
}

function emptyTeamSummary(projectId: string | undefined): TuiTeamSummary {
  return {
    projectId,
    roles: [],
    counts: {
      total: 0,
      enabled: 0,
      runnable: 0,
      reserved: 0,
      custom: 0,
      presetOverrides: 0
    },
    command: projectId ? `agent-hub team roles list --project-id ${projectId}` : undefined
  };
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

function executorLabel(executor: WorkgroupExecutor, runnable: boolean): string {
  if (executor.kind === "agent_adapter") {
    return runnable ? `agent_adapter / ${executor.adapterKind}` : "agent_adapter disabled";
  }
  return `${executor.kind} reserved`;
}

function selectReviewSummary(
  input: TuiCurrentContextInput,
  runs: TuiRunSummary[],
  calls: TuiRoleCallNodeSummary[],
  selectedRoleCallId?: string,
  selectedRunId?: string
): TuiReviewSelectionSummary {
  if (selectedRunId !== undefined && selectedRoleCallId === undefined) {
    const selectedRun = runs.find((run) => run.id === selectedRunId);
    if (selectedRun) {
      return {
        kind: "run",
        selectedId: selectedRun.id,
        title: selectedRun.taskTitle ?? selectedRun.taskId,
        summary: selectedRun.evidence.resultSummary ?? `${selectedRun.agentKind} ${selectedRun.status}`,
        evidence: selectedRun.evidence,
        commands: selectedRun.commands
      };
    }
  }
  const selectedCall =
    selectedRoleCallId !== undefined
      ? calls.find((call) => call.id === selectedRoleCallId)
      : calls.find((call) => call.status === "failed" || waitingRoleCallStatuses.has(call.status));
  if (selectedCall) {
    return {
      kind: "role_call",
      selectedId: selectedCall.id,
      title: `@${selectedCall.callerRole} -> @${selectedCall.calleeRole}`,
      summary: selectedCall.evidence.resultSummary ?? selectedCall.task,
      evidence: selectedCall.evidence,
      commands: [
        `agent-hub role-calls show ${selectedCall.id}`,
        ...(selectedCall.linkedRunId
          ? [`agent-hub runs show ${selectedCall.linkedRunId}`]
          : [])
      ]
    };
  }
  const selectedRun =
    selectedRunId !== undefined
      ? runs.find((run) => run.id === selectedRunId)
      : runs[0];
  if (selectedRun) {
    return {
      kind: "run",
      selectedId: selectedRun.id,
      title: selectedRun.taskTitle ?? selectedRun.taskId,
      summary: selectedRun.evidence.resultSummary ?? `${selectedRun.agentKind} ${selectedRun.status}`,
      evidence: selectedRun.evidence,
      commands: selectedRun.commands
    };
  }
  return {
    kind: "none",
    title: input.threadId ? "No run or RoleCall selected" : "No current context",
    summary: "No local review evidence is available yet.",
    evidence: {},
    commands: []
  };
}

function summarizeTasks(
  tasks: Task[],
  roleTodos: RoleTodo[],
  roleCalls: RoleCall[],
  limit: number
): TuiTaskSummary[] {
  const todos = summarizeTodos(roleTodos, defaultLimits.todos);
  const followUps = roleCalls
    .filter((call) => call.status === "deferred" || call.status === "rejected")
    .map((call) => `${call.status} @${call.calleeRole}: ${truncate(call.task, 96)}`);
  return [...tasks]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit)
    .map((task) => {
      const assignments = taskAssignments(task);
      return {
        id: task.id,
        title: truncate(task.title, defaultLimits.contentChars),
        status: task.status,
        updatedAt: task.updatedAt,
        assignmentCount: assignments.length,
        executableAssignmentCount: assignments.filter((assignment) => assignment.executable).length,
        assignments: assignments.map((assignment) => ({
          id: assignment.assignmentId,
          label: assignment.displayName,
          role: assignment.roleHandle,
          agent: assignment.agentId ?? assignment.adapterKind,
          executable: assignment.executable,
          status: assignment.status,
          runId: assignment.runId
        })),
        roleTodos: todos,
        followUps,
        nextAction: nextTaskAction(task, assignments)
      };
    });
}

function summarizeMemory(
  projectId: string | undefined,
  items: { status: MemoryStatus }[]
): TuiMemorySummary {
  const counts: Record<MemoryStatus, number> = {
    proposed: 0,
    approved: 0,
    rejected: 0
  };
  for (const item of items) {
    counts[item.status] += 1;
  }
  return {
    projectId,
    counts,
    command: projectId ? `agent-hub memory list --project-id ${projectId}` : undefined,
    approvalCommands: projectId
      ? [
          `agent-hub memory list --project-id ${projectId}`,
          "agent-hub memory approve <memory-id>",
          "agent-hub memory reject <memory-id>"
        ]
      : [],
    approvedSource: "Agent Hub context store; approved memory is injected at runtime.",
    approvalReminder: "Memory approval remains an explicit CLI action."
  };
}

function summarizeSkills(input: {
  skills: Skill[];
  projectId?: string;
  selectedSkillReferences: string[];
  maxSkills: number;
  contextMode: string;
}): TuiSkillsSummary {
  const selectedIds = new Set(input.selectedSkillReferences.map(normalizeSkillReference));
  const summaries = input.skills
    .map((skill) => {
      const scope = skill.projectId
        ? skill.projectId === input.projectId
          ? "project"
          : "unknown"
        : "global";
      return {
        id: skill.id,
        name: skill.name,
        description: truncate(skill.description, defaultLimits.contentChars),
        scope,
        selected: selectedIds.has(skill.id) || selectedIds.has(`${scope}:${skill.id}`)
      } satisfies TuiSkillSummary;
    })
    .sort((left, right) => Number(right.selected) - Number(left.selected) || left.id.localeCompare(right.id));
  return {
    contextMode: input.contextMode,
    runtimeSource: "Agent Hub context store; injected at runtime unless explicitly exported.",
    selected: summaries.filter((skill) => skill.selected).slice(0, input.maxSkills),
    available: summaries.slice(0, input.maxSkills)
  };
}

function summarizeLoop(
  calls: RoleCall[],
  runs: TuiRunSummary[],
  input: { iteration: number; maxIterations?: number }
): TuiLoopSummary {
  const convergence = evaluateRoleCallGraphConvergence({
    roleCalls: calls,
    continuationCount: input.iteration,
    maxContinuations: input.maxIterations
  });
  const activeRoleCallIds = calls
    .filter((call) => activeRoleCallStatuses.has(call.status))
    .map((call) => call.id);
  const waitingRoleCallIds = calls
    .filter((call) => waitingRoleCallStatuses.has(call.status))
    .map((call) => call.id);
  return {
    iteration: input.iteration,
    maxIterations: input.maxIterations,
    pendingRoleCallIds: convergence.pendingRoleCallIds,
    waitingRoleCallIds,
    activeRoleCallIds,
    stopReason: loopStopReason(calls, runs, input, convergence.reason),
    convergenceReason: convergence.reason
  };
}

function loopStopReason(
  calls: RoleCall[],
  runs: TuiRunSummary[],
  input: { iteration: number; maxIterations?: number },
  convergenceReason: RoleCallGraphConvergenceReason
): TuiLoopStopReason {
  if (input.maxIterations !== undefined && input.iteration >= input.maxIterations) {
    return "max_iterations";
  }
  if (runs.some((run) => run.evidence.risk?.level === "blocking")) {
    return "blocking_risk";
  }
  if (calls.some((call) => call.status === "waiting_approval")) {
    return "waiting_approval";
  }
  if (calls.some((call) => call.status === "waiting_context")) {
    return "waiting_context";
  }
  if (calls.some((call) => pendingRoleCallStatuses.has(call.status))) {
    return "pending_role_calls";
  }
  if (convergenceReason === "idle" || calls.length === 0) {
    return "terminal";
  }
  return "none";
}

function countRoleCalls(
  nodes: TuiRoleCallNodeSummary[],
  visible: number
): TuiRoleCallGraphSummary["counts"] {
  return {
    total: nodes.length,
    visible,
    active: nodes.filter((node) => activeRoleCallStatuses.has(node.status)).length,
    pending: nodes.filter((node) => pendingRoleCallStatuses.has(node.status)).length,
    waiting: nodes.filter((node) => waitingRoleCallStatuses.has(node.status)).length,
    failed: nodes.filter((node) => node.status === "failed").length,
    terminal: nodes.filter((node) => terminalRoleCallStatuses.has(node.status)).length
  };
}

async function latestThreadForProject(
  repositories: TuiReadModelRepositories,
  projectId: string | undefined
): Promise<ConversationThread | undefined> {
  const threads = await repositories.conversationThreadRepository.list(projectId);
  return [...threads].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

async function runsForTasks(
  repositories: TuiReadModelRepositories,
  tasks: Task[]
): Promise<TaskRun[]> {
  const runs = await Promise.all(
    tasks.map((task) => repositories.taskRunRepository.listByTaskId(task.id))
  );
  return runs.flat();
}

function filterTasksForThread(tasks: Task[], threadId: string | undefined): Task[] {
  if (!threadId) {
    return tasks;
  }
  return tasks.filter((task) => {
    if (metadataString(task.metadata, "threadId") === threadId) {
      return true;
    }
    return taskAssignments(task).some((assignment) => assignment.threadId === threadId);
  });
}

function taskById(tasks: Task[], taskId: string): Task | undefined {
  return tasks.find((task) => task.id === taskId);
}

function sortRuns(runs: TuiRunSummary[]): TuiRunSummary[] {
  return [...runs].sort((left, right) => {
    const activeDelta =
      Number(activeRunStatuses.has(right.status)) - Number(activeRunStatuses.has(left.status));
    if (activeDelta !== 0) {
      return activeDelta;
    }
    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

function sortRoleCalls(calls: RoleCall[]): RoleCall[] {
  return [...calls].sort((left, right) => {
    const rankDelta = roleCallStatusRank(left.status) - roleCallStatusRank(right.status);
    if (rankDelta !== 0) {
      return rankDelta;
    }
    return left.createdAt.localeCompare(right.createdAt);
  });
}

function compareTodos(left: RoleTodo, right: RoleTodo): number {
  const rankDelta = roleTodoStatusRank(left.status) - roleTodoStatusRank(right.status);
  if (rankDelta !== 0) {
    return rankDelta;
  }
  return right.updatedAt.localeCompare(left.updatedAt);
}

function roleCallStatusRank(status: RoleCallStatus): number {
  const order: RoleCallStatus[] = [
    "running",
    "queued",
    "accepted",
    "assessing",
    "proposed",
    "waiting_approval",
    "waiting_context",
    "failed",
    "deferred",
    "rejected",
    "succeeded",
    "cancelled"
  ];
  const index = order.indexOf(status);
  return index === -1 ? order.length : index;
}

function roleTodoStatusRank(status: RoleTodoStatus): number {
  if (status === "in_progress" || status === "open") {
    return 0;
  }
  if (status === "blocked" || status === "deferred") {
    return 1;
  }
  if (status === "rejected") {
    return 2;
  }
  return 3;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function runStage(run: TaskRun, latestEvent: string | undefined): string {
  if (terminalRunStatuses.has(run.status)) {
    return run.status;
  }
  if (latestEvent) {
    return latestEvent;
  }
  return run.status;
}

function resultSummary(events: RunEvent[], run: TaskRun): string {
  const agentOutput = extractAgentFacingOutput(
    { events: events.map(toAgentOutputEvent) },
    {
      includeRawStreams: false,
      includeTerminalSummaries: false
    }
  ).trim();
  if (agentOutput) {
    return agentOutput;
  }
  const finalMessage = [...events]
    .sort((left, right) => left.sequence - right.sequence)
    .reverse()
    .find((event) =>
      (event.type === "message" || event.type === "exit") &&
      event.metadata?.assistantOutput !== false
    );
  return finalMessage?.message ?? `${run.agentKind} ${run.status}`;
}

function summarizeChecks(
  results: VerificationResult[]
): NonNullable<TuiEvidenceSummary["checks"]> {
  const counts: Record<VerificationStatus, number> = {
    passed: 0,
    failed: 0,
    skipped: 0
  };
  const failedNames: string[] = [];
  for (const result of results) {
    counts[result.status] += 1;
    if (result.status === "failed") {
      failedNames.push(result.command);
    }
  }
  return { ...counts, failedNames };
}

function diffSummary(
  artifact: RunArtifact | undefined,
  diff: unknown
): TuiEvidenceSummary["diff"] {
  const stat = objectValue(objectValue(artifact?.metadata, "stat") ?? objectValue(diff, "stat"));
  const changedFiles =
    arrayValue(artifact?.metadata, "changedFiles")?.length ??
    arrayValue(diff, "changedFiles")?.length;
  const statFiles = numberValue(stat, "filesChanged");
  const insertions = numberValue(stat, "insertions");
  const deletions = numberValue(stat, "deletions");
  if (changedFiles === undefined && statFiles === undefined) {
    return undefined;
  }
  return {
    changedFiles: changedFiles ?? statFiles ?? 0,
    insertions,
    deletions
  };
}

async function requiredRunForEvidence(
  repositories: TuiReadModelRepositories,
  runId: string
): Promise<TaskRun> {
  const run = await repositories.taskRunRepository.get(runId);
  if (!run) {
    throw new Error(`run ${runId} not found`);
  }
  return run;
}

function taskAssignments(task: Task): WorkgroupTaskAssignmentMetadata[] {
  const assignments = Array.isArray(task.metadata?.assignments)
    ? task.metadata.assignments
    : [];
  return assignments.filter(isTaskAssignment);
}

function displayHandlesForRuns(input: {
  runs: TuiRunSummary[];
  messages: ConversationMessage[];
  tasks: Task[];
  roleCalls: RoleCall[];
}): Map<string, string> {
  const handles = new Map<string, string>();
  for (const task of input.tasks) {
    for (const assignment of taskAssignments(task)) {
      if (assignment.runId && assignment.roleHandle) {
        handles.set(assignment.runId, assignment.roleHandle);
      }
    }
  }
  for (const message of input.messages) {
    const displayHandle = displayHandleFromMessage(message);
    if (message.runId && displayHandle) {
      handles.set(message.runId, displayHandle);
    }
  }
  for (const run of input.runs) {
    if (run.roleHandle) {
      handles.set(run.id, run.roleHandle);
    }
  }
  for (const call of input.roleCalls) {
    if (call.taskRunId) {
      handles.set(call.taskRunId, call.calleeRole);
    }
  }
  return handles;
}

function isTaskAssignment(value: unknown): value is WorkgroupTaskAssignmentMetadata {
  if (!isObject(value)) {
    return false;
  }
  return (
    typeof value.assignmentId === "string" &&
    typeof value.taskId === "string" &&
    typeof value.threadId === "string" &&
    typeof value.sourceMessageId === "string" &&
    (value.assignmentRole === "agent" || value.assignmentRole === "role") &&
    typeof value.displayName === "string" &&
    typeof value.executorKind === "string" &&
    typeof value.executable === "boolean" &&
    typeof value.status === "string"
  );
}

function nextTaskAction(
  task: Task,
  assignments: WorkgroupTaskAssignmentMetadata[]
): string | undefined {
  const failed = assignments.find((assignment) => assignment.status === "failed");
  if (failed) {
    return `inspect ${failed.runId ?? failed.assignmentId}`;
  }
  const runnable = assignments.find(
    (assignment) => assignment.executable && assignment.status === "queued"
  );
  if (runnable) {
    return `run ${runnable.displayName}`;
  }
  const unavailable = assignments.find(
    (assignment) => !assignment.executable && assignment.status !== "completed"
  );
  if (unavailable) {
    return `configure executor for ${unavailable.displayName}`;
  }
  if (task.status === "open") {
    return "continue";
  }
  return undefined;
}

function messageAuthor(message: ConversationMessage): string {
  const displayHandle = displayHandleFromMessage(message);
  if (displayHandle) {
    return `@${displayHandle}`;
  }
  if (message.agentKind) {
    return `@${message.agentKind}`;
  }
  return message.role;
}

function displayHandleFromMessage(message: ConversationMessage): string | undefined {
  if (message.metadata?.role && isObject(message.metadata.role)) {
    const roleHandle = message.metadata.role.roleHandle;
    if (typeof roleHandle === "string") {
      return roleHandle;
    }
  }
  return undefined;
}

function roleCallStatusLabel(status: RoleCallStatus): string {
  if (status === "proposed" || status === "assessing") {
    return "new";
  }
  if (status === "accepted" || status === "queued") {
    return "queued";
  }
  if (status === "waiting_approval" || status === "waiting_context") {
    return "waiting";
  }
  if (status === "succeeded") {
    return "ok";
  }
  return status;
}

function roomHandleForThread(thread: ConversationThread): string | undefined {
  return metadataString(thread.metadata, "roomHandle");
}

function metadataString(metadata: JsonObject | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

function normalizeSkillReference(reference: string): string {
  return reference.trim().replace(/^project:/, "").replace(/^global:/, "global:");
}

function objectValue(value: unknown, key?: string): Record<string, unknown> | undefined {
  const candidate = key && isObject(value) ? value[key] : value;
  return isObject(candidate) ? candidate : undefined;
}

function arrayValue(value: unknown, key: string): unknown[] | undefined {
  if (!isObject(value)) {
    return undefined;
  }
  const candidate = value[key];
  return Array.isArray(candidate) ? candidate : undefined;
}

function numberValue(value: unknown, key: string): number | undefined {
  if (!isObject(value)) {
    return undefined;
  }
  const candidate = value[key];
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? candidate
    : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncate(value: string, maxChars: number): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  if (oneLine.length <= maxChars) {
    return oneLine;
  }
  return `${oneLine.slice(0, Math.max(0, maxChars - 3))}...`;
}
