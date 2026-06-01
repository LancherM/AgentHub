import {
  evaluateRoleCallGraphConvergence,
  type RoleCallGraphConvergenceReason
} from "./role-call-convergence";
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
  transcript: TuiTranscriptMessage[];
  runs: TuiRunSummary[];
  roleCalls: TuiRoleCallGraphSummary;
  review: TuiReviewSelectionSummary;
  tasks: TuiTaskSummary[];
  memory: TuiMemorySummary;
  skills: TuiSkillsSummary;
  warnings: string[];
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
  status: TaskRunStatus;
  stage: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
  parentRunId?: string;
  parentMessageId?: string;
  retainedWorktree: boolean;
  evidence: TuiEvidenceSummary;
  commands: string[];
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

export interface TuiMemorySummary {
  projectId?: string;
  counts: Record<MemoryStatus, number>;
  command?: string;
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
  contentChars: 180
};

const activeRunStatuses = new Set<TaskRunStatus>(["queued", "running"]);
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
  const roleCallNodes = await Promise.all(
    sortRoleCalls(roleCalls).map((call) =>
      summarizeRoleCall(repositories, call, roleEvents, input.hideCompletedRoleCalls === true)
    )
  );
  const visibleRoleCallNodes = roleCallNodes
    .filter((node) => !node.hidden)
    .slice(0, input.maxRoleCalls ?? defaultLimits.roleCalls);

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
    transcript: summarizeTranscript(messages, input.maxMessages ?? defaultLimits.messages),
    runs: boundedRuns,
    roleCalls: {
      nodes: visibleRoleCallNodes,
      todos: summarizeTodos(roleTodos, input.maxTodos ?? defaultLimits.todos),
      counts: countRoleCalls(roleCallNodes, visibleRoleCallNodes.length),
      loop: summarizeLoop(roleCalls, {
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

async function summarizeRun(
  repositories: TuiReadModelRepositories,
  run: TaskRun,
  task: Task | undefined
): Promise<TuiRunSummary> {
  const evidence = await summarizeRunEvidence(repositories, run);
  return {
    id: run.id,
    taskId: run.taskId,
    taskTitle: task?.title,
    agentKind: run.agentKind,
    status: run.status,
    stage: runStage(run, evidence.latestEvent),
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    updatedAt: run.updatedAt,
    parentRunId: run.parentRunId,
    parentMessageId: run.parentMessageId,
    retainedWorktree: Boolean((await repositories.runMetadataRepository.get(run.id))?.workspaceCleanup?.retained),
    evidence,
    commands: [
      `agent-hub runs show ${run.id}`,
      `agent-hub runs diff ${run.id} --stat`,
      `agent-hub risks show ${run.id}`
    ]
  };
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

async function summarizeRoleCall(
  repositories: TuiReadModelRepositories,
  call: RoleCall,
  threadEvents: RoleCallEvent[],
  hideCompleted: boolean
): Promise<TuiRoleCallNodeSummary> {
  const linkedRunEvidence: TuiEvidenceSummary = call.taskRunId
    ? await summarizeRunEvidence(
        repositories,
        await requiredRunForEvidence(repositories, call.taskRunId)
      ).catch(() => ({ linkedRunId: call.taskRunId }) satisfies TuiEvidenceSummary)
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
    stopReason: loopStopReason(calls, input, convergence.reason),
    convergenceReason: convergence.reason
  };
}

function loopStopReason(
  calls: RoleCall[],
  input: { iteration: number; maxIterations?: number },
  convergenceReason: RoleCallGraphConvergenceReason
): TuiLoopStopReason {
  if (input.maxIterations !== undefined && input.iteration >= input.maxIterations) {
    return "max_iterations";
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
  const finalMessage = [...events]
    .sort((left, right) => left.sequence - right.sequence)
    .reverse()
    .find((event) => event.type === "message" || event.type === "exit");
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
  if (task.status === "open") {
    return "continue";
  }
  return undefined;
}

function messageAuthor(message: ConversationMessage): string {
  if (message.metadata?.role && isObject(message.metadata.role)) {
    const roleHandle = message.metadata.role.roleHandle;
    if (typeof roleHandle === "string") {
      return `@${roleHandle}`;
    }
  }
  if (message.agentKind) {
    return `@${message.agentKind}`;
  }
  return message.role;
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
