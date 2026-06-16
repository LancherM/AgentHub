import {
  evaluateRoleCallGraphConvergence,
  type RoleCallGraphConvergenceReason
} from "./role-call-convergence";
import { buildExecutionTraceGraph } from "./execution-trace-read-model";
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
  ExecutionTraceGraph,
  JsonObject,
  MemoryItem,
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
  ComparisonReportRepository,
  PlanGraphRepository,
  RunMetadataRepository,
  SkillRepository,
  SettingsRepository,
  TaskRepository,
  TaskRunRepository,
  TraceLinkRepository,
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
  comparisonReportRepository: ComparisonReportRepository;
  memoryItemRepository: MemoryItemRepository;
  skillRepository: SkillRepository;
  roleCallRepository: RoleCallRepository;
  roleCallEventRepository: RoleCallEventRepository;
  roleTodoRepository: RoleTodoRepository;
  planGraphRepository?: PlanGraphRepository;
  traceLinkRepository?: TraceLinkRepository;
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
  workBlocks: TuiWorkBlock[];
  transcript: TuiTranscriptMessage[];
  runs: TuiRunSummary[];
  roleCalls: TuiRoleCallGraphSummary;
  executionTrace?: ExecutionTraceGraph;
  review: TuiReviewSelectionSummary;
  tasks: TuiTaskSummary[];
  team: TuiTeamSummary;
  memory: TuiMemorySummary;
  skills: TuiSkillsSummary;
  selectionDetails: TuiSelectionDetails;
  warnings: string[];
}

export interface TuiSelectionDetails {
  workBlocks: TuiSelectionDetail[];
  runs: TuiSelectionDetail[];
  roleCalls: TuiSelectionDetail[];
  graph: {
    overlay: TuiSelectionDetail[];
    plan: TuiSelectionDetail[];
    trace: TuiSelectionDetail[];
  };
  tasks: TuiSelectionDetail[];
  teamRoles: TuiSelectionDetail[];
  memoryRows: TuiSelectionDetail[];
  memory: TuiSelectionDetail;
}

export interface TuiSelectionDetail {
  id: string;
  kind: "work_block" | "run" | "role_call" | "graph_node" | "memory" | "team_role" | "task";
  title: string;
  subtitle?: string;
  sections: TuiDetailSection[];
  commands: string[];
  actions: TuiDetailAction[];
}

export interface TuiDetailSection {
  id: string;
  title: string;
  tone?: "normal" | "success" | "warning" | "danger" | "info";
  lines: string[];
  collapsedByDefault?: boolean;
}

export interface TuiDetailAction {
  key: string;
  label: string;
  kind: "focus" | "prepare_command" | "callback";
  disabledReason?: string;
}

export function emptyTuiSelectionDetails(): TuiSelectionDetails {
  return {
    workBlocks: [],
    runs: [],
    roleCalls: [],
    graph: {
      overlay: [],
      plan: [],
      trace: []
    },
    tasks: [],
    teamRoles: [],
    memoryRows: [],
    memory: {
      id: "memory:none",
      kind: "memory",
      title: "Memory Governance",
      sections: [
        {
          id: "unavailable",
          title: "Unavailable",
          tone: "warning",
          lines: ["not available in current read model"]
        }
      ],
      commands: [],
      actions: []
    }
  };
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
  inlineDiff?: TuiInlineDiffSummary;
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

export type TuiWorkBlockType = TuiConversationEntryType | "active_run";

export interface TuiWorkBlock {
  id: string;
  sourceId: string;
  sourceKind: "conversation" | "active_run";
  type: TuiWorkBlockType;
  runId?: string;
  roleCallId?: string;
  timestamp?: string;
  elapsedLabel?: string;
  usageLabel?: string;
  speaker: string;
  title: string;
  statusIcon: string;
  statusLabel?: string;
  statusTone: "normal" | "success" | "warning" | "danger" | "info";
  messageLines: string[];
  toolSummaryLines: string[];
  fileRefs: string[];
  commandLines: string[];
  artifactLines: string[];
  evidenceLines: string[];
  inlineDiff?: TuiInlineDiffSummary;
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

export interface TuiInlineDiffSummary {
  mode: "inline" | "summary";
  summary: string;
  lines: TuiInlineDiffLine[];
}

export interface TuiInlineDiffLine {
  kind: "file" | "add" | "delete" | "context";
  text: string;
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
  delegationMatrixRows: TuiTeamDelegationMatrixRow[];
  recentRoleCalls: TuiTeamRecentRoleCall[];
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
  purpose: string;
  capabilitySummary: string;
  persona: string;
  defaultInstructions: string;
  permissions: string[];
  contextPolicy: TuiTeamContextPolicySummary;
  approvalPolicy: TuiTeamApprovalPolicySummary;
  delegation: TuiTeamDelegationSummary;
  defaultSkillReferences: NonNullable<WorkgroupRole["defaultSkillReferences"]>;
  verificationCommands: string[];
  limits: string[];
  tags: string[];
  activeCallCount: number;
  recentCallCount: number;
  recentFailures: string[];
  nextAction: string;
  unavailableReason?: string;
}

export interface TuiTeamContextPolicySummary {
  scope: string;
  includeApprovedMemory: boolean;
  includeThreadSummary: boolean;
  instructions: string[];
}

export interface TuiTeamApprovalPolicySummary {
  requiredFor: string[];
  summary: string;
}

export interface TuiTeamDelegationSummary {
  canInitiate: boolean;
  allowedIntentTypes: string[];
  allowedTargets: string[];
  requiresApprovalForTargets: string[];
  summary: string;
  unavailableReason?: string;
}

export interface TuiTeamDelegationMatrixRow {
  id: string;
  callerRole: string;
  status: "enabled" | "unavailable";
  allowedTargets: string[];
  requiresApprovalForTargets: string[];
  allowedIntentTypes: string[];
  summary: string;
}

export interface TuiTeamRecentRoleCall {
  id: string;
  callerRole: string;
  calleeRole: string;
  status: RoleCallStatus;
  statusLabel: string;
  task: string;
  updatedAt: string;
  linkedRunId?: string;
}

export interface TuiMemorySummary {
  projectId?: string;
  counts: Record<MemoryStatus, number>;
  rows: TuiMemoryRow[];
  command?: string;
  approvalCommands: string[];
  approvedSource: string;
  approvalReminder: string;
}

export interface TuiMemoryRow {
  id: string;
  projectId: string;
  category: MemoryItem["category"];
  status: MemoryStatus;
  confidence?: string;
  sourceRunId?: string;
  sourceTaskId?: string;
  summary: string;
  updatedAt: string;
  recommendedAction: string;
  evidenceExcerptLines: string[];
  writebackTarget?: string;
  sourceCommands: string[];
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
  inlineDiff?: TuiInlineDiffSummary;
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
  const teamResult = await summarizeTeam(repositories, projectId, {
    roleCallNodes,
    runSummaries: boundedRuns
  });
  if (teamResult.warning) {
    warnings.push(teamResult.warning);
  }

  const conversation = await summarizeConversation(repositories, {
    messages,
    runs: boundedRuns,
    roleCalls,
    activeRuns,
    runDisplayHandles,
    limit: Math.max(input.maxMessages ?? defaultLimits.messages, defaultLimits.messages)
  });
  const workBlocks = buildWorkBlocks(conversation, activeRuns);
  const roleCallSummary: TuiRoleCallGraphSummary = {
    nodes: visibleRoleCallNodes,
    todos: summarizeTodos(roleTodos, input.maxTodos ?? defaultLimits.todos),
    counts: countRoleCalls(roleCallNodes, visibleRoleCallNodes.length),
    loop: summarizeLoop(roleCalls, boundedRuns, {
      iteration: input.iteration ?? 0,
      maxIterations: input.maxIterations
    })
  };
  const review = selectReviewSummary(
    input,
    boundedRuns,
    visibleRoleCallNodes,
    input.selectedRoleCallId,
    input.selectedRunId
  );
  const taskSummaries = summarizeTasks(
    contextTasks,
    roleTodos,
    roleCalls,
    input.maxTasks ?? defaultLimits.tasks
  );
  const memorySummary = summarizeMemory(projectId, memory);
  const skillsSummary = summarizeSkills({
    skills,
    projectId,
    selectedSkillReferences: input.selectedSkillReferences ?? [],
    maxSkills: input.maxSkills ?? defaultLimits.skills,
    contextMode: input.contextMode ?? "runtime_injection"
  });
  const executionTrace = await summarizeExecutionTraceForTui(
    repositories,
    contextTasks,
    warnings
  );

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
    workBlocks,
    transcript: summarizeTranscript(messages, input.maxMessages ?? defaultLimits.messages),
    runs: boundedRuns,
    roleCalls: roleCallSummary,
    executionTrace,
    review,
    tasks: taskSummaries,
    team: teamResult.summary,
    memory: memorySummary,
    skills: skillsSummary,
    selectionDetails: buildSelectionDetails({
      workBlocks,
      runs: boundedRuns,
      roleCalls: visibleRoleCallNodes,
      executionTrace,
      tasks: taskSummaries,
      team: teamResult.summary,
      memory: memorySummary,
      skills: skillsSummary
    }),
    warnings
  };
}

async function summarizeExecutionTraceForTui(
  repositories: TuiReadModelRepositories,
  tasks: readonly Task[],
  warnings: string[]
): Promise<ExecutionTraceGraph | undefined> {
  if (!repositories.planGraphRepository || !repositories.traceLinkRepository) {
    return undefined;
  }
  const task = [...tasks].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id)
  )[0];
  if (!task) {
    return undefined;
  }
  try {
    return await buildExecutionTraceGraph(
      {
        planGraphRepository: repositories.planGraphRepository,
        traceLinkRepository: repositories.traceLinkRepository,
        taskRunRepository: repositories.taskRunRepository,
        runMetadataRepository: repositories.runMetadataRepository,
        runArtifactRepository: repositories.runArtifactRepository,
        comparisonReportRepository: repositories.comparisonReportRepository,
        roleCallRepository: repositories.roleCallRepository
      },
      { taskId: task.id }
    );
  } catch (error) {
    warnings.push(
      `execution trace unavailable for task ${task.id}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return undefined;
  }
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
        content: message.content,
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
        content: "awaiting review - open [V]iew for details",
        outputLines,
        agent: run.agentKind,
        runId: run.id,
        statusLabel: "awaiting review",
        verificationLine: conversationVerificationLine(run.evidence),
        riskLine: conversationRiskLine(run.evidence),
        elapsedLabel: run.elapsedLabel,
        usageLabel: run.usageLabel,
        inlineDiff: run.evidence.inlineDiff,
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
      inlineDiff: run.evidence.inlineDiff,
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

  const visibleEntries = entries
    .sort(compareConversationEntries)
    .slice(-input.limit)
    .map(({ sortRank: _sortRank, ...entry }) => entry);
  return visibleEntries;
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
  const latestEventLine = latestTuiEventLine(events);
  const risk = riskReport ?? metadata?.riskReport;
  const diff = diffSummary(diffArtifact, metadata?.diff);
  const inlineDiff = inlineDiffSummary(diffArtifact, metadata?.diff, diff);
  return {
    linkedRunId: run.id,
    latestEvent: latestEventLine ? truncate(latestEventLine, defaultLimits.contentChars) : undefined,
    resultSummary: resultSummary(events, run),
    checks: verification.length > 0 ? summarizeChecks(verification) : undefined,
    risk: risk
      ? {
          level: risk.level,
          primaryReason: risk.riskFactors[0] ?? risk.summary
        }
      : undefined,
    diff,
    inlineDiff
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
    return outputLines;
  }
  const activityLines = events
    .sort((left, right) => left.sequence - right.sequence)
    .flatMap(activeRunEventLines)
    .slice(-6);
  return activityLines.length > 0
    ? activityLines
    : ["agent thinking..."];
}

function outputTextLines(value: string): string[] {
  return visibleTuiOutputLines(value);
}

function visibleTuiOutputLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0 && !isTuiOutputNoiseLine(line.trim()));
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

function latestTuiEventLine(events: RunEvent[]): string | undefined {
  return [...events]
    .sort((left, right) => right.sequence - left.sequence)
    .flatMap(activeRunEventLines)
    .find((line) => line.length > 0);
}

function isTuiOutputNoiseLine(value: string): boolean {
  return (
    isJsonObjectLine(value) ||
    /^Context compiled/i.test(value) ||
    /^TaskRunner execution started\.?$/i.test(value) ||
    /^Isolated worktree is ready\.?$/i.test(value) ||
    /^Agent adapter started\.?$/i.test(value) ||
    /^starting (Codex|Claude Code|Claude|Fake Agent)/i.test(value) ||
    /^(Codex|Claude Code|Claude) preflight passed/i.test(value) ||
    /^(Codex|Claude Code|Claude) (thread|turn|session|item)\.[A-Za-z_]+/i.test(value) ||
    /^Using [`'"].+[`'"] to satisfy/i.test(value) ||
    /\bcodex_[A-Za-z0-9_]+::/.test(value) ||
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

function buildWorkBlocks(
  conversation: TuiConversationEntry[],
  activeRuns: TuiActiveRunBox[]
): TuiWorkBlock[] {
  return [
    ...conversation.map(conversationWorkBlock),
    ...activeRuns.map(activeRunWorkBlock)
  ];
}

function conversationWorkBlock(entry: TuiConversationEntry): TuiWorkBlock {
  const messageLines = detailLines(entry.outputLines ?? entry.content);
  const fileRefs = extractFileRefs([
    ...messageLines,
    ...(entry.inlineDiff?.lines.map((line) => line.text) ?? [])
  ]);
  const commandLines = inferCommandLines(messageLines);
  const toolSummaryLines = inferToolSummaryLines(messageLines);
  const evidenceLines = [
    entry.verificationLine,
    entry.riskLine,
    entry.inlineDiff ? `diff ${entry.inlineDiff.summary}` : undefined
  ].filter((value): value is string => Boolean(value));
  const status = conversationWorkBlockStatus(entry);
  return {
    id: entry.id,
    sourceId: entry.id,
    sourceKind: "conversation",
    type: entry.type,
    runId: entry.runId,
    roleCallId: entry.roleCallId,
    timestamp: entry.timestamp,
    elapsedLabel: entry.elapsedLabel,
    usageLabel: entry.usageLabel,
    speaker: conversationEntrySpeaker(entry),
    title: conversationDetailTitle(entry),
    statusIcon: status.icon,
    statusLabel: entry.statusLabel,
    statusTone: status.tone,
    messageLines,
    toolSummaryLines,
    fileRefs,
    commandLines,
    artifactLines: [],
    evidenceLines,
    inlineDiff: entry.inlineDiff
  };
}

function activeRunWorkBlock(run: TuiActiveRunBox): TuiWorkBlock {
  const messageLines = detailLines(run.outputLines);
  return {
    id: `active-run:${run.runId}`,
    sourceId: run.runId,
    sourceKind: "active_run",
    type: "active_run",
    runId: run.runId,
    timestamp: run.startedAt,
    elapsedLabel: run.elapsedLabel,
    usageLabel: run.usageLabel,
    speaker: run.displayHandle ? `@${run.displayHandle}` : `@${run.agent}`,
    title: run.title,
    statusIcon: "●",
    statusLabel: "running",
    statusTone: "info",
    messageLines,
    toolSummaryLines: inferToolSummaryLines(messageLines),
    fileRefs: extractFileRefs(messageLines),
    commandLines: inferCommandLines(messageLines),
    artifactLines: [],
    evidenceLines: [
      run.elapsedLabel ? `elapsed ${run.elapsedLabel}` : undefined,
      run.usageLabel ? `usage ${run.usageLabel}` : undefined
    ].filter((value): value is string => Boolean(value))
  };
}

function conversationEntrySpeaker(entry: TuiConversationEntry): string {
  if (entry.displayHandle) {
    return `@${entry.displayHandle}`;
  }
  if (entry.agent) {
    return `@${entry.agent}`;
  }
  return entry.author;
}

function conversationWorkBlockStatus(entry: TuiConversationEntry): {
  icon: string;
  tone: TuiWorkBlock["statusTone"];
} {
  if (entry.type === "agent_completed") {
    return { icon: "✓", tone: "success" };
  }
  if (entry.type === "agent_failed") {
    return { icon: "✗", tone: "danger" };
  }
  if (entry.type === "review_pending") {
    return { icon: "△", tone: "warning" };
  }
  if (entry.type === "delegation") {
    return { icon: "→", tone: "info" };
  }
  return { icon: "●", tone: "normal" };
}

function extractFileRefs(lines: string[]): string[] {
  const refs = new Set<string>();
  const pathPattern = /((?:\.{1,2}\/|\/)?(?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9_-]+(?::\d+(?::\d+)?)?|[\w.-]+\.(?:[cm]?[tj]sx?|json|md|css|scss|html|py|rs|go|ya?ml|toml)(?::\d+(?::\d+)?)?)/g;
  for (const line of lines) {
    let match: RegExpExecArray | null;
    while ((match = pathPattern.exec(line)) !== null) {
      refs.add(normalizeFileRef(match[0]));
      if (refs.size >= 8) {
        return [...refs];
      }
    }
  }
  return [...refs];
}

function normalizeFileRef(value: string): string {
  return value.replace(/^[ab]\//, "");
}

function inferCommandLines(lines: string[]): string[] {
  return dedupeStrings(
    lines
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && isCommandLikeLine(line))
      .slice(0, 8)
  );
}

function inferToolSummaryLines(lines: string[]): string[] {
  return dedupeStrings(
    lines
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && isInferredToolLine(line))
      .map((line) => `inferred: ${truncate(line, defaultLimits.contentChars)}`)
      .slice(0, 8)
  );
}

function isCommandLikeLine(value: string): boolean {
  const trimmed = value.replace(/^[>$]\s*/, "");
  return /^(?:agent-hub|codex|claude|git|node|npm|npx|pnpm|tsx|tsc|vitest|rg|sed|cat)\b/.test(trimmed);
}

function isInferredToolLine(value: string): boolean {
  const normalized = value.replace(/^[>$]\s*/, "");
  return (
    isCommandLikeLine(normalized) ||
    /^(?:reading|read|editing|edited|writing|wrote|running|searching|inspecting|opened|applying|applied)\b/i.test(normalized) ||
    /^(?:read_file|write_file|grep|rg|sed|cat|apply_patch)\b/i.test(normalized)
  );
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
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
  projectId: string | undefined,
  evidence: {
    roleCallNodes: TuiRoleCallNodeSummary[];
    runSummaries: TuiRunSummary[];
  }
): Promise<{ summary: TuiTeamSummary; warning?: string }> {
  if (!projectId) {
    return { summary: emptyTeamSummary(undefined) };
  }
  try {
    const roles = await resolvedTeamRoles(repositories, projectId);
    const summaries = roles.map((entry) => toTuiTeamRoleSummary(entry.role, entry.source));
    return { summary: teamSummaryWithEvidence(teamSummaryFromRoles(projectId, summaries), evidence) };
  } catch (error) {
    const summaries = presetWorkgroupRoles.map((role) =>
      toTuiTeamRoleSummary(role, "preset")
    );
    return {
      summary: teamSummaryWithEvidence(teamSummaryFromRoles(projectId, summaries), evidence),
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
    purpose: truncate(role.purpose, defaultLimits.contentChars),
    capabilitySummary: truncate(role.capabilitySummary, defaultLimits.contentChars),
    persona: truncate(role.persona, defaultLimits.contentChars),
    defaultInstructions: truncate(role.defaultInstructions, defaultLimits.contentChars),
    permissions: [...role.permissions],
    contextPolicy: {
      scope: role.contextPolicy.scope,
      includeApprovedMemory: role.contextPolicy.includeApprovedMemory,
      includeThreadSummary: role.contextPolicy.includeThreadSummary,
      instructions: role.contextPolicy.instructions.map((line) =>
        truncate(line, defaultLimits.contentChars)
      )
    },
    approvalPolicy: {
      requiredFor: [...role.approvalPolicy.requiredFor],
      summary: truncate(role.approvalPolicy.summary, defaultLimits.contentChars)
    },
    delegation: roleDelegationSummary(role),
    defaultSkillReferences: role.defaultSkillReferences ?? [],
    verificationCommands: metadataStringArray(role.metadata, "verificationCommands"),
    limits: metadataStringArray(role.metadata, "limits"),
    tags: role.tags ?? [],
    activeCallCount: 0,
    recentCallCount: 0,
    recentFailures: [],
    nextAction: "ready for assignment",
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
    delegationMatrixRows: roles.map(roleDelegationMatrixRow),
    recentRoleCalls: [],
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
    delegationMatrixRows: [],
    recentRoleCalls: [],
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

function teamSummaryWithEvidence(
  summary: TuiTeamSummary,
  evidence: {
    roleCallNodes: TuiRoleCallNodeSummary[];
    runSummaries: TuiRunSummary[];
  }
): TuiTeamSummary {
  const callsByRole = new Map<string, TuiRoleCallNodeSummary[]>();
  for (const call of evidence.roleCallNodes) {
    appendRoleCall(callsByRole, call.callerRole, call);
    appendRoleCall(callsByRole, call.calleeRole, call);
  }
  const runsById = new Map(evidence.runSummaries.map((run) => [run.id, run]));
  const roles = summary.roles.map((role) => {
    const calls = callsByRole.get(role.handle) ?? [];
    const activeCallCount = calls.filter((call) => activeRoleCallStatuses.has(call.status)).length;
    const recentFailures = teamRecentFailures(calls, runsById);
    return {
      ...role,
      activeCallCount,
      recentCallCount: calls.length,
      recentFailures,
      nextAction: teamRoleNextAction(role, activeCallCount, recentFailures)
    };
  });
  return {
    ...summary,
    roles,
    delegationMatrixRows: roles.map(roleDelegationMatrixRow),
    recentRoleCalls: summarizeTeamRecentRoleCalls(evidence.roleCallNodes, 8)
  };
}

function appendRoleCall(
  callsByRole: Map<string, TuiRoleCallNodeSummary[]>,
  role: string,
  call: TuiRoleCallNodeSummary
): void {
  const existing = callsByRole.get(role) ?? [];
  existing.push(call);
  callsByRole.set(role, existing);
}

function summarizeTeamRecentRoleCalls(
  roleCallNodes: TuiRoleCallNodeSummary[],
  limit: number
): TuiTeamRecentRoleCall[] {
  return [...roleCallNodes]
    .sort((left, right) => roleCallUpdatedAt(right).localeCompare(roleCallUpdatedAt(left)))
    .slice(0, limit)
    .map((call) => ({
      id: call.id,
      callerRole: call.callerRole,
      calleeRole: call.calleeRole,
      status: call.status,
      statusLabel: call.statusLabel,
      task: call.task,
      updatedAt: roleCallUpdatedAt(call),
      linkedRunId: call.linkedRunId
    }));
}

function teamRecentFailures(
  calls: TuiRoleCallNodeSummary[],
  runsById: Map<string, TuiRunSummary>
): string[] {
  return [...calls]
    .filter((call) => {
      const linkedRun = call.linkedRunId ? runsById.get(call.linkedRunId) : undefined;
      return call.status === "failed" ||
        (call.evidence.checks?.failed ?? 0) > 0 ||
        call.evidence.risk?.level === "high" ||
        call.evidence.risk?.level === "blocking" ||
        linkedRun?.status === "failed";
    })
    .sort((left, right) => roleCallUpdatedAt(right).localeCompare(roleCallUpdatedAt(left)))
    .slice(0, 4)
    .map((call) => {
      const reason =
        call.evidence.resultSummary ??
        call.evidence.waitingReason ??
        call.evidence.risk?.primaryReason ??
        "failure evidence available";
      return `${call.id} ${call.statusLabel}: ${truncate(reason, 96)}`;
    });
}

function teamRoleNextAction(
  role: TuiTeamRoleSummary,
  activeCallCount: number,
  recentFailures: string[]
): string {
  if (!role.enabled) {
    return "enable or leave disabled";
  }
  if (activeCallCount > 0) {
    return `monitor ${activeCallCount} active call${activeCallCount === 1 ? "" : "s"}`;
  }
  if (!role.executorRunnable) {
    return role.executorKind === "agent_adapter"
      ? "configure local adapter"
      : "reserved/manual executor";
  }
  if (recentFailures.length > 0) {
    return "inspect recent failure";
  }
  if (role.delegation.canInitiate) {
    return "ready to delegate";
  }
  return "ready for assignment";
}

function roleDelegationMatrixRow(role: TuiTeamRoleSummary): TuiTeamDelegationMatrixRow {
  return {
    id: role.id,
    callerRole: role.handle,
    status: role.delegation.canInitiate ? "enabled" : "unavailable",
    allowedTargets: role.delegation.allowedTargets,
    requiresApprovalForTargets: role.delegation.requiresApprovalForTargets,
    allowedIntentTypes: role.delegation.allowedIntentTypes,
    summary: role.delegation.summary
  };
}

function roleDelegationSummary(role: WorkgroupRole): TuiTeamDelegationSummary {
  const policy = role.delegationPolicy;
  if (!policy?.canInitiateRoleCalls) {
    return {
      canInitiate: false,
      allowedIntentTypes: [],
      allowedTargets: [],
      requiresApprovalForTargets: [],
      summary: "role-call initiation policy not configured",
      unavailableReason: "role-call initiation policy not configured"
    };
  }
  const allowedTargets = [
    ...(policy.allowedTargetRoles?.map(formatDelegationTargetRole) ?? []),
    ...(policy.allowedTargetCapabilities?.map((capability) => `capability:${capability}`) ?? [])
  ];
  const approvalTargets = policy.requiresApprovalForTargets?.map(formatDelegationTargetRole) ?? [];
  return {
    canInitiate: true,
    allowedIntentTypes: [...policy.allowedIntentTypes],
    allowedTargets,
    requiresApprovalForTargets: approvalTargets,
    summary: [
      `enabled intents ${policy.allowedIntentTypes.join(",") || "none"}`,
      `targets ${allowedTargets.join(",") || "none"}`,
      approvalTargets.length > 0 ? `approval ${approvalTargets.join(",")}` : undefined
    ].filter((value): value is string => Boolean(value)).join("; ")
  };
}

function formatDelegationTargetRole(target: string): string {
  return target === "*" ? "*" : `@${target}`;
}

function roleCallUpdatedAt(call: TuiRoleCallNodeSummary): string {
  return call.completedAt ?? call.startedAt ?? call.createdAt;
}

function metadataStringArray(metadata: Record<string, unknown> | undefined, key: string): string[] {
  return (arrayValue(metadata, key) ?? [])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => truncate(value, defaultLimits.contentChars));
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
  items: MemoryItem[]
): TuiMemorySummary {
  const counts: Record<MemoryStatus, number> = {
    proposed: 0,
    approved: 0,
    rejected: 0,
    retired: 0
  };
  for (const item of items) {
    counts[item.status] += 1;
  }
  return {
    projectId,
    counts,
    rows: summarizeMemoryRows(items, 12),
    command: projectId ? `agent-hub memory list --project-id ${projectId}` : undefined,
    approvalCommands: projectId
      ? [
          `agent-hub memory list --project-id ${projectId}`,
          "agent-hub memory approve --memory-id <memory-id>",
          "agent-hub memory reject --memory-id <memory-id>"
        ]
      : [],
    approvedSource: "Agent Hub context store; approved memory is injected at runtime.",
    approvalReminder: "Memory approval remains an explicit CLI action."
  };
}

function summarizeMemoryRows(items: MemoryItem[], limit: number): TuiMemoryRow[] {
  return [...items]
    .sort(compareMemoryItems)
    .slice(0, limit)
    .map(memoryRow);
}

function compareMemoryItems(left: MemoryItem, right: MemoryItem): number {
  const statusDelta = memoryStatusRank(left.status) - memoryStatusRank(right.status);
  if (statusDelta !== 0) {
    return statusDelta;
  }
  return right.updatedAt.localeCompare(left.updatedAt);
}

function memoryStatusRank(status: MemoryStatus): number {
  const order: MemoryStatus[] = ["proposed", "approved", "rejected", "retired"];
  const index = order.indexOf(status);
  return index === -1 ? order.length : index;
}

function memoryRow(item: MemoryItem): TuiMemoryRow {
  const sourceRunId = metadataString(item.metadata, "sourceRunId");
  const sourceTaskId = metadataString(item.metadata, "sourceTaskId") ?? item.taskId;
  const sourceCommands = [
    sourceRunId ? `agent-hub runs show ${sourceRunId}` : undefined,
    sourceTaskId ? `agent-hub task history --task-id ${sourceTaskId}` : undefined
  ].filter((value): value is string => Boolean(value));
  return {
    id: item.id,
    projectId: item.projectId,
    category: item.category,
    status: item.status,
    confidence: metadataString(item.metadata, "confidence"),
    sourceRunId,
    sourceTaskId,
    summary: truncate(firstMeaningfulLine(item.content), defaultLimits.contentChars),
    updatedAt: item.updatedAt,
    recommendedAction: recommendedMemoryAction(item.status),
    evidenceExcerptLines: memoryEvidenceExcerptLines(item.metadata),
    writebackTarget:
      metadataString(item.metadata, "writebackPath") ??
      stringValue(objectValue(item.metadata, "autoApproval"), "writebackPath"),
    sourceCommands
  };
}

function firstMeaningfulLine(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? "(empty memory)";
}

function recommendedMemoryAction(status: MemoryStatus): string {
  if (status === "proposed") {
    return "review explicitly";
  }
  if (status === "approved") {
    return "injected at runtime";
  }
  if (status === "rejected") {
    return "ignored";
  }
  return "retained for audit";
}

function memoryEvidenceExcerptLines(metadata: JsonObject | undefined): string[] {
  const evidence = arrayValue(metadata, "evidence")
    ?? arrayValue(metadata, "evidenceExcerpts")
    ?? arrayValue(metadata, "evidenceLines");
  const lines = evidence
    ? evidence
        .filter((value): value is string => typeof value === "string")
        .map((line) => truncate(line.trim(), defaultLimits.contentChars))
        .filter(Boolean)
    : [];
  const singleEvidence =
    metadataString(metadata, "evidence") ??
    metadataString(metadata, "why") ??
    metadataString(metadata, "reason");
  if (singleEvidence) {
    lines.unshift(truncate(singleEvidence, defaultLimits.contentChars));
  }
  return dedupeStrings(lines).slice(0, 6);
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

function buildSelectionDetails(input: {
  workBlocks: TuiWorkBlock[];
  runs: TuiRunSummary[];
  roleCalls: TuiRoleCallNodeSummary[];
  executionTrace?: ExecutionTraceGraph;
  tasks: TuiTaskSummary[];
  team: TuiTeamSummary;
  memory: TuiMemorySummary;
  skills: TuiSkillsSummary;
}): TuiSelectionDetails {
  return {
    workBlocks: input.workBlocks.map((block) => workBlockDetail(block)),
    runs: input.runs.map((run) => runSelectionDetail(run)),
    roleCalls: input.roleCalls.map((call) => roleCallSelectionDetail(call)),
    graph: graphSelectionDetails(input.executionTrace),
    tasks: input.tasks.map((task) => taskSelectionDetail(input.team.projectId, task)),
    teamRoles: input.team.roles.map((role) => teamRoleSelectionDetail(input.team, role)),
    memoryRows: input.memory.rows.map((row) => memoryRowSelectionDetail(row)),
    memory: memorySelectionDetail(input.memory, input.skills)
  };
}

function graphSelectionDetails(trace: ExecutionTraceGraph | undefined): {
  overlay: TuiSelectionDetail[];
  plan: TuiSelectionDetail[];
  trace: TuiSelectionDetail[];
} {
  if (!trace) {
    return { overlay: [], plan: [], trace: [] };
  }
  const traceCommand = `agent-hub execution-trace show --plan-graph-id ${trace.planGraphId}`;
  const planDetails = trace.baseNodes.map((node) => {
    const commands = graphPlanNodeCommands(trace, node.id, traceCommand);
    return {
      id: node.id,
      kind: "graph_node" as const,
      title: node.title,
      subtitle: `${node.kind} @${node.role} ${node.execution.mode}`,
      sections: [
        {
          id: "plan-node",
          title: "Plan Node",
          lines: [
            `title: ${node.title}`,
            `id: ${compactGraphNodeId(node.id)}`,
            `kind: ${node.kind}`,
            `role: ${node.role}`,
            `mode: ${node.execution.mode}`,
            `required: ${node.required}`,
            `risk: ${node.riskLevel}`
          ]
        },
        {
          id: "incoming",
          title: "Incoming",
          lines: graphIncomingLines(trace, node.id)
        },
        {
          id: "outgoing",
          title: "Outgoing",
          lines: graphOutgoingLines(trace, node.id)
        },
        {
          id: "evidence",
          title: "Evidence",
          lines: graphEvidenceLines(trace, { planNodeId: node.id })
        },
        {
          id: "deviations",
          title: "Deviations",
          tone: graphDeviationLines(trace, { planNodeId: node.id }).length > 0
            ? "warning" as const
            : undefined,
          lines: graphDeviationLines(trace, { planNodeId: node.id })
        },
        {
          id: "actions",
          title: "Actions",
          lines: graphPlanNodeActionLines(trace, node.id, traceCommand)
        },
        {
          id: "instructions",
          title: "Instructions",
          lines: [node.instructions],
          collapsedByDefault: true
        },
        {
          id: "acceptance",
          title: "Acceptance",
          lines: node.acceptanceCriteria,
          collapsedByDefault: true
        }
      ],
      commands,
      actions: detailActions(commands)
    };
  });
  const traceDetails = trace.dynamicNodes.map((node) => {
    const commands = graphTraceNodeCommands(trace, node.id, traceCommand);
    return {
      id: node.id,
      kind: "graph_node" as const,
      title: node.title,
      subtitle: `${node.kind} ${node.status}`,
      sections: [
        {
          id: "trace-node",
          title: "Trace Node",
          lines: [
            `title: ${node.title}`,
            `id: ${compactGraphNodeId(node.id)}`,
            `kind: ${node.kind}`,
            `status: ${node.status}`,
            `source_plan_node: ${node.sourcePlanNodeId ? graphNodeLabel(trace, node.sourcePlanNodeId) : "none"}`,
            `role: ${node.role ?? "none"}`,
            `source: ${node.sourceType ?? "event"}:${node.sourceId ?? "none"}`
          ]
        },
        {
          id: "incoming",
          title: "Incoming",
          lines: graphIncomingLines(trace, node.id)
        },
        {
          id: "outgoing",
          title: "Outgoing",
          lines: graphOutgoingLines(trace, node.id)
        },
        {
          id: "evidence",
          title: "Evidence",
          lines: graphEvidenceLines(trace, { traceNodeId: node.id })
        },
        {
          id: "deviations",
          title: "Deviations",
          tone: graphDeviationLines(trace, { traceNodeId: node.id }).length > 0
            ? "warning" as const
            : undefined,
          lines: graphDeviationLines(trace, { traceNodeId: node.id })
        },
        {
          id: "actions",
          title: "Actions",
          lines: graphTraceNodeActionLines(trace, node.id, traceCommand)
        }
      ],
      commands,
      actions: detailActions(commands)
    };
  });
  return {
    overlay: [...planDetails, ...traceDetails],
    plan: planDetails,
    trace: traceDetails
  };
}

function graphPlanNodeCommands(
  trace: ExecutionTraceGraph,
  nodeId: string,
  traceCommand: string
): string[] {
  const commands = [
    traceCommand,
    `agent-hub plan-graphs show ${trace.planGraphId}`,
    `/graph focus ${nodeId}`
  ];
  const groupId = graphPlanNodeGroupId(trace, nodeId);
  if (groupId) {
    commands.push(`/graph fold ${groupId}`);
  }
  return commands;
}

function graphTraceNodeCommands(
  trace: ExecutionTraceGraph,
  nodeId: string,
  traceCommand: string
): string[] {
  const node = trace.dynamicNodes.find((candidate) => candidate.id === nodeId);
  const commands = [
    traceCommand,
    `/graph focus ${nodeId}`
  ];
  if (node?.sourceType === "task_run" && node.sourceId) {
    commands.push(`agent-hub runs show ${node.sourceId}`);
    commands.push(`agent-hub runs diff ${node.sourceId} --stat`);
  } else if ((node?.sourceType === "role_call" || node?.sourceType === "role_call_event") && node.sourceId) {
    commands.push(`agent-hub role-calls show ${node.sourceId}`);
  }
  const groupId = graphTraceNodeGroupId(node);
  if (groupId) {
    commands.push(`/graph fold ${groupId}`);
  }
  return commands;
}

function graphPlanNodeActionLines(
  trace: ExecutionTraceGraph,
  nodeId: string,
  traceCommand: string
): string[] {
  const lines = [
    `open trace: ${traceCommand}`,
    `focus node: /graph focus ${nodeId}`
  ];
  const groupId = graphPlanNodeGroupId(trace, nodeId);
  if (groupId) {
    lines.push(`fold subgraph: /graph fold ${groupId}`);
  }
  lines.push(`prepare rerun-from-here prompt: ${graphRerunPrompt(trace, nodeId)}`);
  return lines;
}

function graphTraceNodeActionLines(
  trace: ExecutionTraceGraph,
  nodeId: string,
  traceCommand: string
): string[] {
  const node = trace.dynamicNodes.find((candidate) => candidate.id === nodeId);
  const lines = [
    `open trace: ${traceCommand}`,
    `focus node: /graph focus ${nodeId}`
  ];
  if (node?.sourceType === "task_run" && node.sourceId) {
    lines.push(`open run: agent-hub runs show ${node.sourceId}`);
  } else if ((node?.sourceType === "role_call" || node?.sourceType === "role_call_event") && node.sourceId) {
    lines.push(`open RoleCall: agent-hub role-calls show ${node.sourceId}`);
  } else if (node?.sourceType === "comparison_report" && node.sourceId) {
    lines.push(`open comparison evidence: ${traceCommand}`);
  }
  const groupId = graphTraceNodeGroupId(node);
  if (groupId) {
    lines.push(`fold subgraph: /graph fold ${groupId}`);
  }
  lines.push(`prepare rerun-from-here prompt: ${graphRerunPrompt(trace, node?.sourcePlanNodeId ?? nodeId)}`);
  return lines;
}

function graphPlanNodeGroupId(trace: ExecutionTraceGraph, nodeId: string): string | undefined {
  const incoming = trace.baseEdges.find((edge) => edge.to === nodeId);
  if (incoming?.type === "parallel") {
    return "parallel";
  }
  if (incoming?.type === "fallback") {
    return "fallback";
  }
  return undefined;
}

function graphTraceNodeGroupId(
  node: ExecutionTraceGraph["dynamicNodes"][number] | undefined
): string | undefined {
  if (!node) {
    return undefined;
  }
  if (node.sourceType === "role_call" || node.sourceType === "role_call_event") {
    return "role-call";
  }
  if (node.sourceType === "comparison_report") {
    return "comparison";
  }
  return undefined;
}

function graphRerunPrompt(trace: ExecutionTraceGraph, nodeId: string): string {
  return `Rerun from graph node ${nodeId} for task ${trace.taskId}. Do not apply, merge, push, approve memory, or create PRs automatically.`;
}

function graphNodeLabel(trace: ExecutionTraceGraph, nodeId: string): string {
  const planNode = trace.baseNodes.find((node) => node.id === nodeId);
  if (planNode) {
    return planNode.title;
  }
  const traceNode = trace.dynamicNodes.find((node) => node.id === nodeId);
  if (traceNode) {
    return traceNode.title;
  }
  return compactGraphNodeId(nodeId);
}

function compactGraphNodeId(nodeId: string): string {
  const planNodeMatch = /^plan_graph:[^:]+:v\d+:([^:]+):(\d+)$/.exec(nodeId);
  if (planNodeMatch) {
    return `${planNodeMatch[1]}:${planNodeMatch[2]}`;
  }
  const plannerMatch = /^plan_graph:[^:]+:v\d+:planner$/.exec(nodeId);
  if (plannerMatch) {
    return "planner";
  }
  const traceMatch = /^trace_node:([^:]+):(.+)$/.exec(nodeId);
  if (traceMatch) {
    return `${traceMatch[1]}:${shortGraphToken(traceMatch[2])}`;
  }
  return shortGraphToken(nodeId);
}

function shortGraphToken(value: string): string {
  if (value.length <= 24) {
    return value;
  }
  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function graphIncomingLines(trace: ExecutionTraceGraph, nodeId: string): string[] {
  const lines = [
    ...trace.baseEdges
      .filter((edge) => edge.to === nodeId)
      .map((edge) => `plan ${graphNodeLabel(trace, edge.from)} -> ${graphNodeLabel(trace, edge.to)} ${edge.type}${edge.label ? ` ${edge.label}` : ""}`),
    ...trace.dynamicEdges
      .filter((edge) => edge.to === nodeId)
      .map((edge) => `trace ${graphNodeLabel(trace, edge.from)} -> ${graphNodeLabel(trace, edge.to)} ${edge.type}${edge.label ? ` ${edge.label}` : ""}`),
    ...trace.dynamicNodes
      .filter((node) => node.id === nodeId && node.sourcePlanNodeId)
      .map((node) => `runtime ${graphNodeLabel(trace, node.sourcePlanNodeId ?? "")} -> ${node.title} ${node.kind}`)
  ];
  return lines.length > 0 ? lines : ["root or not linked in current trace"];
}

function graphOutgoingLines(trace: ExecutionTraceGraph, nodeId: string): string[] {
  const lines = [
    ...trace.baseEdges
      .filter((edge) => edge.from === nodeId)
      .map((edge) => `plan ${graphNodeLabel(trace, edge.from)} -> ${graphNodeLabel(trace, edge.to)} ${edge.type}${edge.label ? ` ${edge.label}` : ""}`),
    ...trace.dynamicEdges
      .filter((edge) => edge.from === nodeId)
      .map((edge) => `trace ${graphNodeLabel(trace, edge.from)} -> ${graphNodeLabel(trace, edge.to)} ${edge.type}${edge.label ? ` ${edge.label}` : ""}`),
    ...trace.dynamicNodes
      .filter((node) => node.sourcePlanNodeId === nodeId)
      .map((node) => `runtime ${graphNodeLabel(trace, nodeId)} -> ${node.title} ${node.kind} ${node.status}`)
  ];
  return lines.length > 0 ? lines : ["leaf or no outgoing links in current trace"];
}

function graphEvidenceLines(
  trace: ExecutionTraceGraph,
  filter: { planNodeId?: string; traceNodeId?: string }
): string[] {
  const lines = trace.evidence
    .filter((evidence) =>
      (filter.planNodeId !== undefined && evidence.planNodeId === filter.planNodeId) ||
      (filter.traceNodeId !== undefined && evidence.traceNodeId === filter.traceNodeId)
    )
    .map((evidence) => `${evidence.sourceType}:${evidence.sourceId} ${evidence.summary ?? ""}`.trim());
  return lines.length > 0 ? lines : ["no evidence linked to this graph node"];
}

function graphDeviationLines(
  trace: ExecutionTraceGraph,
  filter: { planNodeId?: string; traceNodeId?: string }
): string[] {
  return trace.deviations
    .filter((deviation) =>
      (filter.planNodeId !== undefined && deviation.planNodeId === filter.planNodeId) ||
      (filter.traceNodeId !== undefined && deviation.traceNodeId === filter.traceNodeId)
    )
    .map((deviation) => `${deviation.severity} ${deviation.type}: ${deviation.description}`);
}

function workBlockDetail(block: TuiWorkBlock): TuiSelectionDetail {
  const commands = [
    ...(block.runId
      ? [
          `agent-hub runs show ${block.runId}`,
          ...(block.sourceKind === "active_run"
            ? []
            : [`agent-hub runs diff ${block.runId} --stat`])
        ]
      : []),
    ...(block.roleCallId ? [`agent-hub role-calls show ${block.roleCallId}`] : [])
  ];
  return {
    id: block.id,
    kind: "work_block",
    title: block.title,
    subtitle: block.statusLabel,
    sections: [
      ...(block.sourceKind === "active_run"
        ? [liveRunDetailSection(block)]
        : []),
      {
        id: block.sourceKind === "active_run" ? "streaming-output" : "message",
        title: block.sourceKind === "active_run" ? "Streaming Output Tail" : "Message",
        tone: block.sourceKind === "active_run" ? "info" as const : undefined,
        lines: block.messageLines
      },
      ...(block.toolSummaryLines.length > 0
        ? [
            {
              id: "tool-calls",
              title: "Tool Calls",
              tone: "info" as const,
              lines: [
                "structured durations/status are not available; these rows are inferred from visible output",
                ...block.toolSummaryLines
              ],
              collapsedByDefault: true
            }
          ]
        : [unavailableDetailSection("tool-calls", "Tool Calls", "structured tool-call rows")]),
      ...(block.commandLines.length > 0
        ? [
            {
              id: block.sourceKind === "active_run" ? "active-commands" : "commands",
              title: block.sourceKind === "active_run" ? "Active Commands" : "Commands",
              tone: "info" as const,
              lines: block.sourceKind === "active_run"
                ? [
                    "queued/running command status is not available; commands are inferred from visible output",
                    ...block.commandLines
                  ]
                : block.commandLines,
              collapsedByDefault: true
            }
          ]
        : block.sourceKind === "active_run"
          ? [unavailableDetailSection("active-commands", "Active Commands", "queued/running command status")]
          : []),
      ...(block.fileRefs.length > 0
        ? [
            {
              id: "file-refs",
              title: "File Refs",
              lines: block.fileRefs,
              collapsedByDefault: true
            }
          ]
        : []),
      ...(block.evidenceLines.length > 0
        ? [
            {
              id: "evidence",
              title: "Evidence",
              tone: block.statusTone === "danger" || block.statusTone === "warning"
                ? block.statusTone
                : "success" as const,
              lines: block.evidenceLines
            }
          ]
        : []),
      ...(block.inlineDiff
        ? [
            {
              id: "inline-diff",
              title: "Inline Diff",
              tone: "info" as const,
              lines: inlineDiffDetailLines(block.inlineDiff),
              collapsedByDefault: block.inlineDiff.mode === "summary"
            },
            ...(block.inlineDiff.mode === "inline"
              ? [
                  {
                    id: "fix-snippet",
                    title: "Fix Snippet",
                    tone: "info" as const,
                    lines: block.inlineDiff.lines
                      .filter((line) => line.kind === "add" || line.kind === "delete")
                      .map((line) => line.text),
                    collapsedByDefault: true
                  }
                ]
              : [])
          ]
        : []),
      ...(block.artifactLines.length > 0
        ? [
            {
              id: block.sourceKind === "active_run" ? "pending-artifacts" : "artifacts",
              title: block.sourceKind === "active_run" ? "Pending Artifacts" : "Artifacts",
              lines: block.artifactLines,
              collapsedByDefault: true
            }
          ]
        : [
            unavailableDetailSection(
              block.sourceKind === "active_run" ? "pending-artifacts" : "artifacts",
              block.sourceKind === "active_run" ? "Pending Artifacts" : "Artifacts",
              block.sourceKind === "active_run" ? "pending artifact rows" : "artifact rows"
            )
          ])
    ],
    commands,
    actions: detailActions(commands)
  };
}

function liveRunDetailSection(block: TuiWorkBlock): TuiDetailSection {
  return {
    id: "live-run",
    title: "Live Run",
    tone: "info",
    lines: [
      `speaker ${block.speaker}`,
      `state ${block.statusLabel ?? "running"}`,
      block.timestamp ? `started ${block.timestamp}` : "started not available in current read model",
      block.elapsedLabel ? `elapsed ${block.elapsedLabel}` : "elapsed not available in current read model",
      "spinner active",
      block.usageLabel ? `usage ${block.usageLabel}` : undefined
    ].filter((value): value is string => Boolean(value))
  };
}

function runSelectionDetail(run: TuiRunSummary): TuiSelectionDetail {
  return {
    id: run.id,
    kind: "run",
    title: run.taskTitle ?? run.taskId,
    subtitle: `@${run.roleHandle ?? run.agentKind} ${run.status}`,
    sections: [
      {
        id: "run",
        title: "Run",
        tone: run.status === "failed" ? "danger" : run.status === "succeeded" ? "success" : "info",
        lines: [
          `id ${run.id}`,
          `agent ${run.agentKind}`,
          run.roleHandle ? `role @${run.roleHandle}` : undefined,
          `status ${run.status}`,
          `stage ${run.stage}`,
          run.startedAt ? `started ${run.startedAt}` : undefined,
          run.completedAt ? `completed ${run.completedAt}` : undefined,
          `updated ${run.updatedAt}`,
          `retained worktree ${run.retainedWorktree ? "yes" : "no"}`,
          run.usageLabel ? `usage ${run.usageLabel}` : undefined
        ].filter((value): value is string => Boolean(value))
      },
      evidenceDetailSection(run.evidence),
      {
        id: "review",
        title: "Review",
        tone: run.reviewDecision.status === "rejected"
          ? "danger"
          : run.reviewDecision.status === "accepted"
            ? "success"
            : "warning",
        lines: [
          `status ${run.reviewDecision.status}`,
          run.reviewDecision.reason ? `reason ${run.reviewDecision.reason}` : undefined,
          run.reviewDecision.acceptedAt ? `accepted ${run.reviewDecision.acceptedAt}` : undefined,
          run.reviewDecision.rejectedAt ? `rejected ${run.reviewDecision.rejectedAt}` : undefined
        ].filter((value): value is string => Boolean(value))
      }
    ],
    commands: run.commands,
    actions: [
      { key: "V", label: "Open Review", kind: "focus" },
      ...detailActions(run.commands)
    ]
  };
}

function roleCallSelectionDetail(call: TuiRoleCallNodeSummary): TuiSelectionDetail {
  const commands = [
    `agent-hub role-calls show ${call.id}`,
    ...(call.linkedRunId ? [`agent-hub runs show ${call.linkedRunId}`] : [])
  ];
  return {
    id: call.id,
    kind: "role_call",
    title: `@${call.callerRole} -> @${call.calleeRole}`,
    subtitle: call.statusLabel,
    sections: [
      {
        id: "role-call",
        title: "RoleCall",
        tone: call.status === "failed" ? "danger" : terminalRoleCallStatuses.has(call.status) ? "success" : "info",
        lines: [
          `id ${call.id}`,
          `task ${call.task}`,
          `status ${call.statusLabel}`,
          `priority ${call.priority}`,
          `depth ${call.depth}`,
          call.parentRoleCallId ? `parent ${call.parentRoleCallId}` : undefined,
          call.linkedRunId ? `linked run ${call.linkedRunId}` : undefined,
          call.todoId ? `todo ${call.todoId}` : undefined
        ].filter((value): value is string => Boolean(value))
      },
      evidenceDetailSection(call.evidence)
    ],
    commands,
    actions: [
      { key: "G", label: "Open Execution Trace", kind: "focus" },
      ...detailActions(commands)
    ]
  };
}

function taskSelectionDetail(
  projectId: string | undefined,
  task: TuiTaskSummary
): TuiSelectionDetail {
  const recoveryCommands = unavailableRoleExecutorCommandsForTask(projectId, task);
  const commands = [
    `agent-hub task history --task-id ${task.id}`,
    ...recoveryCommands
  ];
  return {
    id: task.id,
    kind: "task",
    title: task.title,
    subtitle: task.status,
    sections: [
      {
        id: "task",
        title: "Task",
        lines: [
          `id ${task.id}`,
          `status ${task.status}`,
          `updated ${task.updatedAt}`,
          `assignments ${task.executableAssignmentCount}/${task.assignmentCount} executable`,
          task.nextAction ? `next ${task.nextAction}` : undefined
        ].filter((value): value is string => Boolean(value))
      },
      {
        id: "assignments",
        title: "Assignments",
        lines: task.assignments.length > 0
          ? task.assignments.map((assignment) =>
              `${assignment.label} ${assignment.status}${assignment.runId ? ` run ${assignment.runId}` : ""}`
            )
          : ["not available in current read model"]
      },
      {
        id: "follow-ups",
        title: "Follow-ups",
        lines: task.followUps.length > 0 ? task.followUps : ["not available in current read model"],
        collapsedByDefault: task.followUps.length === 0
      }
    ],
    commands,
    actions: detailActions(commands)
  };
}

function teamRoleSelectionDetail(
  team: TuiTeamSummary,
  role: TuiTeamRoleSummary
): TuiSelectionDetail {
  const roleCalls = team.recentRoleCalls.filter((call) =>
    call.callerRole === role.handle || call.calleeRole === role.handle
  );
  const commands = [
    team.command,
    team.projectId ? `agent-hub team roles executor --project-id ${team.projectId} --role ${role.handle}` : undefined
  ].filter((value): value is string => Boolean(value));
  return {
    id: role.id,
    kind: "team_role",
    title: `@${role.handle}`,
    subtitle: role.displayName,
    sections: [
      {
        id: "role",
        title: "Role",
        tone: role.enabled ? "success" : "warning",
        lines: [
          `display ${role.displayName}`,
          `source ${role.source}`,
          `enabled ${role.enabled ? "yes" : "no"}`,
          `mission ${role.purpose}`,
          role.defaultRoom ? `default room ${role.defaultRoom}` : undefined,
          `capabilities ${role.capabilitySummary}`,
          `next action ${role.nextAction}`
        ].filter((value): value is string => Boolean(value))
      },
      {
        id: "executor",
        title: "Executor",
        tone: role.executorRunnable ? "success" : "warning",
        lines: [
          `kind ${role.executorKind}`,
          `label ${role.executorLabel}`,
          `runnable ${role.executorRunnable ? "yes" : "no"}`,
          `active calls ${role.activeCallCount}`,
          `recent calls ${role.recentCallCount}`,
          role.unavailableReason ? `unavailable ${role.unavailableReason}` : undefined
        ].filter((value): value is string => Boolean(value))
      },
      {
        id: "mission-boundaries",
        title: "Mission And Boundaries",
        lines: [
          `persona ${role.persona}`,
          `instructions ${role.defaultInstructions}`,
          `approval ${role.approvalPolicy.summary}`,
          role.approvalPolicy.requiredFor.length > 0
            ? `approval required for ${role.approvalPolicy.requiredFor.join(", ")}`
            : undefined
        ].filter((value): value is string => Boolean(value))
      },
      {
        id: "allowed-tools",
        title: "Allowed Tools And Permissions",
        lines: role.permissions.length > 0
          ? role.permissions
          : ["not available in current read model"]
      },
      {
        id: "context-policy",
        title: "Context Policy",
        lines: [
          `scope ${role.contextPolicy.scope}`,
          `approved memory ${role.contextPolicy.includeApprovedMemory ? "yes" : "no"}`,
          `thread summary ${role.contextPolicy.includeThreadSummary ? "yes" : "no"}`,
          ...role.contextPolicy.instructions.map((instruction) => `instruction ${instruction}`)
        ]
      },
      {
        id: "delegation",
        title: "Delegation Matrix",
        tone: role.delegation.canInitiate ? "success" : "warning",
        lines: role.delegation.canInitiate
          ? [
              role.delegation.summary,
              `intents ${role.delegation.allowedIntentTypes.join(",") || "none"}`,
              `targets ${role.delegation.allowedTargets.join(",") || "none"}`,
              `approval targets ${role.delegation.requiresApprovalForTargets.join(",") || "none"}`
            ]
          : [role.delegation.unavailableReason ?? "normalized policy matrix not available"],
        collapsedByDefault: !role.delegation.canInitiate
      },
      {
        id: "verification-profile",
        title: "Verification Profile",
        lines: role.verificationCommands.length > 0
          ? role.verificationCommands
          : ["role-specific verification commands not available in current read model"],
        collapsedByDefault: role.verificationCommands.length === 0
      },
      {
        id: "limits",
        title: "Limits",
        lines: role.limits.length > 0
          ? role.limits
          : ["role-specific limits not available in current read model"],
        collapsedByDefault: role.limits.length === 0
      },
      {
        id: "recent-failures",
        title: "Recent Failures",
        tone: role.recentFailures.length > 0 ? "danger" : "success",
        lines: role.recentFailures.length > 0
          ? role.recentFailures
          : ["none in current read model"],
        collapsedByDefault: role.recentFailures.length === 0
      },
      {
        id: "recent-role-calls",
        title: "Recent RoleCalls",
        lines: roleCalls.length > 0
          ? roleCalls.map((call) =>
              `${call.id} @${call.callerRole}->@${call.calleeRole} ${call.statusLabel}: ${call.task}`
            )
          : ["not available in current read model"],
        collapsedByDefault: roleCalls.length === 0
      },
      {
        id: "skills",
        title: "Default Skills",
        lines: role.defaultSkillReferences.length > 0
          ? role.defaultSkillReferences.map(formatSkillReference)
          : ["not available in current read model"],
        collapsedByDefault: role.defaultSkillReferences.length === 0
      },
    ],
    commands,
    actions: detailActions(commands)
  };
}

function formatSkillReference(reference: TuiTeamRoleSummary["defaultSkillReferences"][number]): string {
  return reference.scope ? `${reference.scope}:${reference.id}` : reference.id;
}

function memorySelectionDetail(
  memory: TuiMemorySummary,
  skills: TuiSkillsSummary
): TuiSelectionDetail {
  const commands = memory.approvalCommands.length > 0
    ? memory.approvalCommands
    : memory.command
      ? [memory.command]
      : [];
  return {
    id: memory.projectId ? `memory:${memory.projectId}` : "memory:none",
    kind: "memory",
    title: "Memory Governance",
    subtitle: memory.projectId,
    sections: [
      {
        id: "counts",
        title: "Counts",
        lines: [
          `proposed ${memory.counts.proposed}`,
          `approved ${memory.counts.approved}`,
          `rejected ${memory.counts.rejected}`,
          `retired ${memory.counts.retired}`
        ]
      },
      {
        id: "source",
        title: "Approved Source",
        lines: [
          memory.approvedSource,
          memory.approvalReminder,
          `runtime ${skills.contextMode}`
        ]
      },
      {
        id: "proposal-rows",
        title: "Proposal Rows",
        lines: memory.rows.length > 0
          ? memory.rows.map((row) => memoryRowLine(row))
          : ["not available in current read model"]
      },
      {
        id: "selected-proposal",
        title: "Selected Proposal",
        lines: memory.rows[0] ? memoryRowDetailLines(memory.rows[0]) : ["not available in current read model"]
      },
      {
        id: "evidence",
        title: "Evidence Excerpts",
        lines: memory.rows[0]?.evidenceExcerptLines.length
          ? memory.rows[0].evidenceExcerptLines
          : ["proposal evidence rows not available in current read model"],
        collapsedByDefault: memory.rows[0]?.evidenceExcerptLines.length === 0
      },
      {
        id: "writeback",
        title: "Writeback Target",
        lines: memory.rows[0]?.writebackTarget
          ? [memory.rows[0].writebackTarget]
          : ["context-store target path not available in current read model"],
        collapsedByDefault: !memory.rows[0]?.writebackTarget
      },
      unavailableDetailSection("related", "Related Skills And Memory", "related skills/memory joins")
    ],
    commands,
    actions: [
      {
        key: "a",
        label: "Approve",
        kind: "callback",
        disabledReason: "not available in TUI; use the listed CLI command"
      },
      {
        key: "R",
        label: "Reject",
        kind: "callback",
        disabledReason: "not available in TUI; use the listed CLI command"
      },
      {
        key: "e",
        label: "Edit",
        kind: "callback",
        disabledReason: "not available in TUI; editing requires a separate audited callback"
      },
      {
        key: "o",
        label: "Open Source",
        kind: "callback",
        disabledReason: "not available in TUI; use the listed CLI command"
      }
    ]
  };
}

function memoryRowSelectionDetail(row: TuiMemoryRow): TuiSelectionDetail {
  const commands = [
    `agent-hub memory list --project-id ${row.projectId}`,
    `agent-hub memory approve --memory-id ${row.id}`,
    `agent-hub memory reject --memory-id ${row.id}`,
    ...row.sourceCommands
  ];
  return {
    id: row.id,
    kind: "memory",
    title: row.summary,
    subtitle: `${row.status} ${row.category}`,
    sections: [
      {
        id: "memory",
        title: "Memory Text",
        lines: [
          row.summary,
          `category ${row.category}`,
          `status ${row.status}`,
          row.confidence ? `confidence ${row.confidence}` : undefined,
          `updated ${row.updatedAt}`
        ].filter((value): value is string => Boolean(value))
      },
      {
        id: "why",
        title: "Why It Matters",
        lines: [`recommended action ${row.recommendedAction}`]
      },
      {
        id: "evidence",
        title: "Evidence Excerpts",
        lines: row.evidenceExcerptLines.length > 0
          ? row.evidenceExcerptLines
          : ["proposal evidence rows not available in current read model"],
        collapsedByDefault: row.evidenceExcerptLines.length === 0
      },
      {
        id: "writeback",
        title: "Writeback Target",
        lines: row.writebackTarget
          ? [row.writebackTarget]
          : ["context-store target path not available in current read model"],
        collapsedByDefault: !row.writebackTarget
      },
      unavailableDetailSection("related", "Related Skills And Memory", "related skills/memory joins"),
      {
        id: "source-commands",
        title: "Source Commands",
        lines: row.sourceCommands.length > 0 ? row.sourceCommands : ["not available in current read model"],
        collapsedByDefault: true
      }
    ],
    commands,
    actions: [
      {
        key: "a",
        label: "Approve",
        kind: "callback",
        disabledReason: "not available in TUI; use the listed CLI command"
      },
      {
        key: "R",
        label: "Reject",
        kind: "callback",
        disabledReason: "not available in TUI; use the listed CLI command"
      },
      {
        key: "e",
        label: "Edit",
        kind: "callback",
        disabledReason: "not available in TUI; editing requires a separate audited callback"
      },
      {
        key: "o",
        label: "Open Source",
        kind: "callback",
        disabledReason: "not available in TUI; use the listed CLI command"
      }
    ]
  };
}

function memoryRowLine(row: TuiMemoryRow): string {
  const confidence = row.confidence ? ` conf ${row.confidence}` : "";
  const source = row.sourceRunId ? ` run ${row.sourceRunId}` : row.sourceTaskId ? ` task ${row.sourceTaskId}` : "";
  return `${row.status} ${row.category}${confidence}${source} ${row.summary}`;
}

function memoryRowDetailLines(row: TuiMemoryRow): string[] {
  return [
    `id ${row.id}`,
    `category ${row.category}`,
    `status ${row.status}`,
    row.confidence ? `confidence ${row.confidence}` : undefined,
    row.sourceRunId ? `source run ${row.sourceRunId}` : undefined,
    row.sourceTaskId ? `source task ${row.sourceTaskId}` : undefined,
    `updated ${row.updatedAt}`,
    `recommended action ${row.recommendedAction}`,
    `memory ${row.summary}`,
    ...row.sourceCommands.map((command) => `command ${command}`)
  ].filter((value): value is string => Boolean(value));
}

function conversationDetailTitle(entry: TuiConversationEntry): string {
  if (entry.type === "user_message") {
    return `${entry.author} message`;
  }
  if (entry.type === "delegation") {
    return `Delegation to @${entry.delegatedTo ?? "role"}`;
  }
  return `${entry.author} ${entry.runId ?? entry.type}`;
}

function evidenceDetailSection(evidence: TuiEvidenceSummary): TuiDetailSection {
  const lines = evidenceDetailLines(evidence);
  return {
    id: "evidence",
    title: "Evidence",
    tone: evidence.risk?.level === "blocking" || evidence.risk?.level === "high"
      ? "danger"
      : evidence.risk?.level === "medium"
        ? "warning"
        : "info",
    lines: lines.length > 0 ? lines : ["not available in current read model"]
  };
}

function evidenceDetailLines(evidence: TuiEvidenceSummary): string[] {
  return [
    evidence.linkedRunId ? `linked run ${evidence.linkedRunId}` : undefined,
    evidence.latestEvent ? `latest ${evidence.latestEvent}` : undefined,
    evidence.resultSummary ? `result ${evidence.resultSummary}` : undefined,
    evidence.waitingReason ? `waiting ${evidence.waitingReason}` : undefined,
    evidence.checks
      ? `checks passed ${evidence.checks.passed} failed ${evidence.checks.failed} skipped ${evidence.checks.skipped}`
      : undefined,
    evidence.checks && evidence.checks.failedNames.length > 0
      ? `failed checks ${evidence.checks.failedNames.join(", ")}`
      : undefined,
    evidence.risk
      ? `risk ${evidence.risk.level}${evidence.risk.primaryReason ? `: ${evidence.risk.primaryReason}` : ""}`
      : undefined,
    evidence.diff
      ? `diff files ${evidence.diff.changedFiles} +${evidence.diff.insertions ?? 0} -${evidence.diff.deletions ?? 0}`
      : undefined
  ].filter((value): value is string => Boolean(value));
}

function unavailableDetailSection(
  id: string,
  title: string,
  missing: string
): TuiDetailSection {
  return {
    id,
    title,
    tone: "warning",
    lines: [`${missing} not available in current read model`],
    collapsedByDefault: true
  };
}

function detailActions(commands: string[]): TuiDetailAction[] {
  if (commands.length === 0) {
    return [];
  }
  return [
    {
      key: "p",
      label: "Prepare Command",
      kind: "prepare_command"
    }
  ];
}

function detailLines(value: string[] | string | undefined): string[] {
  const sourceLines = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\r?\n/)
      : [];
  const lines = sourceLines
    .map((line) => line.replace(/\r/g, "").trimEnd())
    .filter((line) => line.trim().length > 0);
  return lines.length > 0 ? lines : ["(empty)"];
}

function inlineDiffDetailLines(diff: TuiInlineDiffSummary): string[] {
  if (diff.mode === "summary") {
    return [diff.summary];
  }
  return [
    diff.summary,
    ...diff.lines.map((line) => line.text)
  ];
}

function unavailableRoleExecutorCommandsForTask(
  projectId: string | undefined,
  task: TuiTaskSummary
): string[] {
  if (!projectId) {
    return [];
  }
  return task.assignments
    .filter((assignment) => !assignment.executable && assignment.role)
    .map((assignment) => `agent-hub team roles executor --project-id ${projectId} --role ${assignment.role}`);
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

function inlineDiffSummary(
  artifact: RunArtifact | undefined,
  diff: unknown,
  summary: TuiEvidenceSummary["diff"]
): TuiInlineDiffSummary | undefined {
  const diffText = typeof artifact?.content === "string" && artifact.content.trim().length > 0
    ? artifact.content
    : stringValue(diff, "diff");
  const sensitivePaths = sensitiveDiffPaths(
    diffText ?? "",
    changedPathValues(artifact, diff)
  );
  if (sensitivePaths.length > 0) {
    return {
      mode: "summary",
      summary: `Patch redacted because sensitive file path changed: ${sensitivePaths.join(", ")}`,
      lines: []
    };
  }
  if (!diffText) {
    return summary && summary.changedFiles > 0
      ? {
          mode: "summary",
          summary: diffSummaryText(summary),
          lines: []
        }
      : undefined;
  }
  const rawLines = diffText.split(/\r?\n/);
  const changedLines = rawLines.filter(isChangedDiffLine);
  if (changedLines.length === 0) {
    return summary && summary.changedFiles > 0
      ? {
          mode: "summary",
          summary: diffSummaryText(summary),
          lines: []
        }
      : undefined;
  }
  if (changedLines.length > 5) {
    return {
      mode: "summary",
      summary: diffSummaryText(summary, changedLines),
      lines: []
    };
  }
  const lines: TuiInlineDiffLine[] = [];
  for (const rawLine of rawLines) {
    const projected = projectDiffLine(rawLine);
    if (!projected) {
      continue;
    }
    lines.push(projected);
    if (lines.length >= 16) {
      break;
    }
  }
  return {
    mode: "inline",
    summary: diffSummaryText(summary, changedLines),
    lines
  };
}

function isChangedDiffLine(value: string): boolean {
  return (
    (value.startsWith("+") && !value.startsWith("+++")) ||
    (value.startsWith("-") && !value.startsWith("---"))
  );
}

function projectDiffLine(value: string): TuiInlineDiffLine | undefined {
  if (value.startsWith("diff --git") || value.startsWith("@@")) {
    return { kind: "file", text: truncate(value, 100) };
  }
  if (value.startsWith("+++") || value.startsWith("---") || value.startsWith("index ")) {
    return undefined;
  }
  if (value.startsWith("+")) {
    return { kind: "add", text: truncate(value, 100) };
  }
  if (value.startsWith("-")) {
    return { kind: "delete", text: truncate(value, 100) };
  }
  if (value.startsWith(" ") && value.trim().length > 0) {
    return { kind: "context", text: truncate(value, 100) };
  }
  return undefined;
}

function changedPathValues(
  artifact: RunArtifact | undefined,
  diff: unknown
): string[] {
  return [
    ...(arrayValue(artifact?.metadata, "changedFiles") ?? []),
    ...(arrayValue(diff, "changedFiles") ?? [])
  ].flatMap(pathFromChangedFileValue);
}

function pathFromChangedFileValue(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (isObject(value) && typeof value.path === "string") {
    return [value.path];
  }
  return [];
}

function sensitiveDiffPaths(patch: string, changedPaths: string[]): string[] {
  const paths = new Set<string>();
  for (const filePath of changedPaths) {
    if (isSensitiveFilePath(filePath)) {
      paths.add(filePath);
    }
  }
  for (const line of patch.split(/\r?\n/)) {
    const filePath = diffPathFromHeader(line);
    if (filePath && isSensitiveFilePath(filePath)) {
      paths.add(filePath);
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

function diffSummaryText(
  summary: TuiEvidenceSummary["diff"],
  changedLines: string[] = []
): string {
  const additions =
    summary?.insertions ??
    changedLines.filter((line) => line.startsWith("+")).length;
  const deletions =
    summary?.deletions ??
    changedLines.filter((line) => line.startsWith("-")).length;
  const files = summary?.changedFiles ?? 0;
  return `(+${additions}/-${deletions}${files > 0 ? ` in ${files} files` : ""})`;
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

function stringValue(value: unknown, key: string): string | undefined {
  if (!isObject(value)) {
    return undefined;
  }
  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim().length > 0
    ? candidate
    : undefined;
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
