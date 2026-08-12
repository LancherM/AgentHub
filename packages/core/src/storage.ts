import type {
  DiffCollectionResult,
  WorkgroupRoleRunMetadata,
  VerificationSuiteResult,
  Workspace,
  WorkspaceCleanupResult
} from "@agent-hub/shared";
import {
  validateAgentProfile,
  validateCodeGraphEntry,
  validateComparisonReport,
  validateConversationMessage,
  validateConversationThread,
  validateConversationThreadSummary,
  validateContextEvalEvent,
  validateContextIndexEntry,
  validatePlanGraph,
  validateMemoryItem,
  validateProject,
  validateRiskReport,
  validateRoleCall,
  validateRoleCallEvent,
  validateRoleCallToolEvent,
  validateRoleCallStatusTransition,
  validateRoleTodo,
  validateRoleTodoStatusTransition,
  validateRunArtifact,
  validateRunEvent,
  validateSetting,
  validateSkill,
  validateTask,
  validateTaskRun,
  validateVerificationResult,
  validateMemoryStatusTransition,
  validateTaskRunStatusTransition,
  validateTaskStatusTransition,
  type AgentProfile,
  type CodeGraphEntry,
  type CodeGraphRebuildResult,
  type CodeGraphSearchInput,
  type CodeGraphSearchResult,
  type ComparisonReport,
  type ConversationMessage,
  type ConversationThread,
  type ConversationThreadSummary,
  type ContextEvalEvent,
  type ContextIndexEntry,
  type ContextIndexRebuildResult,
  type ContextIndexSearchInput,
  type ContextIndexSearchResult,
  type MemoryItem,
  type PlanGraph,
  type Project,
  type RiskReport,
  type RoleCall,
  type RoleCallEvent,
  type RoleCallStatus,
  type RoleCallToolEvent,
  type RoleTodo,
  type RoleTodoStatus,
  type RunArtifact,
  type RunEvent,
  type Setting,
  type Skill,
  type Task,
  type TaskRun,
  type TaskRunStatus,
  type TaskStatus,
  type TraceEdge,
  type TraceEvidence,
  type TraceNode,
  type VerificationResult
} from "./domain";

export type RunStatus = TaskRunStatus;

export interface RunStatusTransition {
  runId: string;
  status: RunStatus;
  at: string;
}

export interface ProjectRepository {
  create(project: Project): Promise<Project>;
  get(projectId: string): Promise<Project | undefined>;
  getByRootPath(rootPath: string): Promise<Project | undefined>;
  list(): Promise<Project[]>;
}

export interface AgentProfileRepository {
  create(profile: AgentProfile): Promise<AgentProfile>;
  get(profileId: string): Promise<AgentProfile | undefined>;
  list(): Promise<AgentProfile[]>;
}

export interface TaskRepository {
  create(task: Task): Promise<Task>;
  updateStatus(taskId: string, status: TaskStatus, updatedAt: string): Promise<Task>;
  get(taskId: string): Promise<Task | undefined>;
  list(): Promise<Task[]>;
  listByProjectId(projectId: string): Promise<Task[]>;
}

export interface TaskRunRepository {
  create(run: TaskRun): Promise<TaskRun>;
  updateExecutionPaths(
    runId: string,
    paths: { worktreePath?: string; branchName?: string },
    updatedAt: string
  ): Promise<TaskRun>;
  updateStatus(runId: string, status: RunStatus, updatedAt: string): Promise<TaskRun>;
  get(runId: string): Promise<TaskRun | undefined>;
  list(): Promise<TaskRun[]>;
  listByTaskId(taskId: string): Promise<TaskRun[]>;
  getStatusTransitions(runId: string): Promise<RunStatusTransition[]>;
}

export interface RunMetadata {
  runId: string;
  workspace?: Workspace;
  workspaceCleanup?: WorkspaceCleanupResult;
  diff?: DiffCollectionResult;
  verification?: VerificationSuiteResult;
  riskReport?: RiskReport;
  role?: WorkgroupRoleRunMetadata;
  planBinding?: RunPlanBindingMetadata;
}

export interface RunPlanBindingMetadata {
  planGraphId: string;
  planGraphVersion: number;
  planNodeId: string;
  traceNodeId?: string;
  allowedNextPlanNodeIds: string[];
}

export interface RunMetadataRepository {
  save(metadata: RunMetadata): Promise<RunMetadata>;
  get(runId: string): Promise<RunMetadata | undefined>;
}

export interface RunEventRepository {
  create(event: RunEvent): Promise<RunEvent>;
  createMany(events: RunEvent[]): Promise<RunEvent[]>;
  listByRunId(runId: string): Promise<RunEvent[]>;
  countByRunId(runId: string): Promise<number>;
}

export interface RunArtifactRepository {
  create(artifact: RunArtifact): Promise<RunArtifact>;
  listByRunId(runId: string): Promise<RunArtifact[]>;
  getLatestByRunIdAndKind(
    runId: string,
    kind: string
  ): Promise<RunArtifact | undefined>;
}

export interface ConversationThreadRepository {
  create(thread: ConversationThread): Promise<ConversationThread>;
  update(thread: ConversationThread): Promise<ConversationThread>;
  get(threadId: string): Promise<ConversationThread | undefined>;
  list(projectId?: string): Promise<ConversationThread[]>;
}

export interface ConversationMessageRepository {
  create(message: ConversationMessage): Promise<ConversationMessage>;
  update(message: ConversationMessage): Promise<ConversationMessage>;
  createMany(messages: ConversationMessage[]): Promise<ConversationMessage[]>;
  get(messageId: string): Promise<ConversationMessage | undefined>;
  listByThreadId(threadId: string): Promise<ConversationMessage[]>;
  countByThreadId(threadId: string): Promise<number>;
}

export interface ConversationThreadSummaryRepository {
  upsert(summary: ConversationThreadSummary): Promise<ConversationThreadSummary>;
  getByThreadId(threadId: string): Promise<ConversationThreadSummary | undefined>;
}

export interface VerificationResultRepository {
  create(result: VerificationResult): Promise<VerificationResult>;
  createMany(results: VerificationResult[]): Promise<VerificationResult[]>;
  listByRunId(runId: string): Promise<VerificationResult[]>;
}

export interface RiskReportRepository {
  create(report: RiskReport): Promise<RiskReport>;
  listByRunId(runId: string): Promise<RiskReport[]>;
  getLatestByRunId(runId: string): Promise<RiskReport | undefined>;
}

export interface MemoryItemRepository {
  create(item: MemoryItem): Promise<MemoryItem>;
  updateStatus(
    memoryId: string,
    status: MemoryItem["status"],
    updatedAt: string
  ): Promise<MemoryItem>;
  get(memoryId: string): Promise<MemoryItem | undefined>;
  listByProjectId(projectId: string): Promise<MemoryItem[]>;
}

export interface ComparisonReportRepository {
  create(report: ComparisonReport): Promise<ComparisonReport>;
  listByTaskId(taskId: string): Promise<ComparisonReport[]>;
  listByRunId(runId: string): Promise<ComparisonReport[]>;
}

export interface SkillRepository {
  create(skill: Skill): Promise<Skill>;
  list(projectId?: string): Promise<Skill[]>;
}

export interface ContextIndexRepository {
  rebuildProject(
    projectId: string,
    entries: ContextIndexEntry[],
    indexedAt: string
  ): Promise<ContextIndexRebuildResult>;
  listByProjectId(projectId: string): Promise<ContextIndexEntry[]>;
  get(entryId: string): Promise<ContextIndexEntry | undefined>;
  search(input: ContextIndexSearchInput): Promise<ContextIndexSearchResult[]>;
}

export interface CodeGraphRepository {
  rebuildProject(
    projectId: string,
    entries: CodeGraphEntry[],
    indexedAt: string
  ): Promise<CodeGraphRebuildResult>;
  listByProjectId(projectId: string): Promise<CodeGraphEntry[]>;
  search(input: CodeGraphSearchInput): Promise<CodeGraphSearchResult[]>;
}

export interface ContextEvalEventRepository {
  create(event: ContextEvalEvent): Promise<ContextEvalEvent>;
  createMany(events: ContextEvalEvent[]): Promise<ContextEvalEvent[]>;
  listByRunId(runId: string): Promise<ContextEvalEvent[]>;
  listByProjectId(projectId: string): Promise<ContextEvalEvent[]>;
}

export interface SettingsRepository {
  set(setting: Setting): Promise<Setting>;
  get(key: string): Promise<Setting | undefined>;
  list(): Promise<Setting[]>;
}

export interface RoleCallListFilter {
  threadId?: string;
  role?: string;
  callerRole?: string;
  calleeRole?: string;
  parentRoleCallId?: string;
  status?: RoleCallStatus;
  todoStatus?: RoleTodoStatus;
}

export interface RoleTodoListFilter {
  threadId?: string;
  role?: string;
  sourceRoleCallId?: string;
  status?: RoleTodoStatus;
}

export interface RoleCallRepository {
  create(call: RoleCall): Promise<RoleCall>;
  update(call: RoleCall): Promise<RoleCall>;
  updateStatus(
    roleCallId: string,
    status: RoleCallStatus,
    at: string
  ): Promise<RoleCall>;
  linkTaskRun(roleCallId: string, taskRunId: string | undefined): Promise<RoleCall>;
  get(roleCallId: string): Promise<RoleCall | undefined>;
  list(filter?: RoleCallListFilter): Promise<RoleCall[]>;
}

export interface RoleCallEventRepository {
  create(event: RoleCallEvent): Promise<RoleCallEvent>;
  createMany(events: RoleCallEvent[]): Promise<RoleCallEvent[]>;
  listByRoleCallId(roleCallId: string): Promise<RoleCallEvent[]>;
  listByThreadId(threadId: string): Promise<RoleCallEvent[]>;
}

export interface RoleTodoRepository {
  create(todo: RoleTodo): Promise<RoleTodo>;
  update(todo: RoleTodo): Promise<RoleTodo>;
  updateStatus(
    todoId: string,
    status: RoleTodoStatus,
    updatedAt: string
  ): Promise<RoleTodo>;
  get(todoId: string): Promise<RoleTodo | undefined>;
  list(filter?: RoleTodoListFilter): Promise<RoleTodo[]>;
}

export interface PlanGraphRepository {
  create(graph: PlanGraph): Promise<PlanGraph>;
  get(id: string): Promise<PlanGraph | undefined>;
  getActiveByTaskId(taskId: string): Promise<PlanGraph | undefined>;
  listByTaskId(taskId: string): Promise<PlanGraph[]>;
  supersede(id: string, nextGraphId: string): Promise<PlanGraph>;
}

export interface TraceProjectionRows {
  nodes: TraceNode[];
  edges: TraceEdge[];
  evidence: TraceEvidence[];
  roleCallToolEvents: RoleCallToolEvent[];
}

export interface TraceLinkRepository {
  createNode(node: TraceNode): Promise<TraceNode>;
  createEdge(edge: TraceEdge): Promise<TraceEdge>;
  linkEvidence(link: TraceEvidence): Promise<TraceEvidence>;
  createRoleCallToolEvent(event: RoleCallToolEvent): Promise<RoleCallToolEvent>;
  listByPlanGraphId(planGraphId: string): Promise<TraceProjectionRows>;
}

export class InMemoryProjectRepository implements ProjectRepository {
  private readonly projects = new Map<string, Project>();

  async create(project: Project): Promise<Project> {
    const validProject = validateProject(project);
    for (const existing of this.projects.values()) {
      if (existing.rootPath === validProject.rootPath && existing.id !== validProject.id) {
        throw new Error(`project root ${validProject.rootPath} is already registered`);
      }
    }
    this.projects.set(validProject.id, { ...validProject });
    return { ...validProject };
  }

  async get(projectId: string): Promise<Project | undefined> {
    const project = this.projects.get(projectId);
    return project ? { ...project } : undefined;
  }

  async getByRootPath(rootPath: string): Promise<Project | undefined> {
    const project = [...this.projects.values()].find((entry) => entry.rootPath === rootPath);
    return project ? { ...project } : undefined;
  }

  async list(): Promise<Project[]> {
    return [...this.projects.values()]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((project) => ({ ...project }));
  }
}

export class InMemoryAgentProfileRepository implements AgentProfileRepository {
  private readonly profiles = new Map<string, AgentProfile>();

  async create(profile: AgentProfile): Promise<AgentProfile> {
    const validProfile = validateAgentProfile(profile);
    this.profiles.set(validProfile.id, { ...validProfile });
    return { ...validProfile };
  }

  async get(profileId: string): Promise<AgentProfile | undefined> {
    const profile = this.profiles.get(profileId);
    return profile ? { ...profile } : undefined;
  }

  async list(): Promise<AgentProfile[]> {
    return [...this.profiles.values()]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((profile) => ({ ...profile }));
  }
}

export class InMemoryTaskRepository implements TaskRepository {
  private readonly tasks = new Map<string, Task>();

  async create(task: Task): Promise<Task> {
    const validTask = validateTask(task);
    const existing = this.tasks.get(validTask.id);
    if (existing) {
      validateTaskStatusTransition(existing.status, validTask.status);
    }
    this.tasks.set(validTask.id, cloneTask(validTask));
    return cloneTask(validTask);
  }

  async updateStatus(
    taskId: string,
    status: TaskStatus,
    updatedAt: string
  ): Promise<Task> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`task ${taskId} not found`);
    }
    validateTaskStatusTransition(task.status, status);
    const updated = { ...task, status, updatedAt };
    this.tasks.set(taskId, cloneTask(updated));
    return cloneTask(updated);
  }

  async get(taskId: string): Promise<Task | undefined> {
    const task = this.tasks.get(taskId);
    return task ? cloneTask(task) : undefined;
  }

  async list(): Promise<Task[]> {
    return [...this.tasks.values()]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map(cloneTask);
  }

  async listByProjectId(projectId: string): Promise<Task[]> {
    return (await this.list()).filter((task) => task.projectId === projectId);
  }
}

function cloneTask(task: Task): Task {
  return {
    ...task,
    metadata: task.metadata
      ? JSON.parse(JSON.stringify(task.metadata)) as Task["metadata"]
      : undefined
  };
}

export class InMemoryTaskRunRepository implements TaskRunRepository {
  private readonly runs = new Map<string, TaskRun>();
  private readonly transitions = new Map<string, RunStatusTransition[]>();

  async create(run: TaskRun): Promise<TaskRun> {
    const validRun = validateTaskRun(run);
    const existing = this.runs.get(validRun.id);
    if (existing) {
      validateTaskRunStatusTransition(existing.status, validRun.status);
    }
    this.runs.set(validRun.id, { ...validRun });
    this.transitions.set(validRun.id, [
      { runId: validRun.id, status: validRun.status, at: validRun.createdAt }
    ]);
    return { ...validRun };
  }

  async updateExecutionPaths(
    runId: string,
    paths: { worktreePath?: string; branchName?: string },
    updatedAt: string
  ): Promise<TaskRun> {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`task run ${runId} not found`);
    }
    const updated: TaskRun = {
      ...run,
      ...paths,
      updatedAt
    };
    this.runs.set(runId, updated);
    return { ...updated };
  }

  async updateStatus(
    runId: string,
    status: RunStatus,
    updatedAt: string
  ): Promise<TaskRun> {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`task run ${runId} not found`);
    }
    validateTaskRunStatusTransition(run.status, status);
    const updated: TaskRun = {
      ...run,
      status,
      updatedAt,
      startedAt: status === "running" ? run.startedAt ?? updatedAt : run.startedAt,
      completedAt: isTerminalRunStatus(status) ? updatedAt : run.completedAt
    };
    this.runs.set(runId, updated);
    if (run.status !== status) {
      this.transitions.set(runId, [
        ...(this.transitions.get(runId) ?? []),
        { runId, status, at: updatedAt }
      ]);
    }
    return { ...updated };
  }

  async get(runId: string): Promise<TaskRun | undefined> {
    const run = this.runs.get(runId);
    return run ? { ...run } : undefined;
  }

  async list(): Promise<TaskRun[]> {
    return [...this.runs.values()]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((run) => ({ ...run }));
  }

  async listByTaskId(taskId: string): Promise<TaskRun[]> {
    return (await this.list()).filter((run) => run.taskId === taskId);
  }

  async getStatusTransitions(runId: string): Promise<RunStatusTransition[]> {
    return [...(this.transitions.get(runId) ?? [])].map((transition) => ({
      ...transition
    }));
  }
}

export class InMemoryRunMetadataRepository implements RunMetadataRepository {
  private readonly metadata = new Map<string, RunMetadata>();

  async save(metadata: RunMetadata): Promise<RunMetadata> {
    const existing = this.metadata.get(metadata.runId);
    const updated = { ...existing, ...metadata };
    this.metadata.set(metadata.runId, cloneRunMetadata(updated));
    return cloneRunMetadata(updated);
  }

  async get(runId: string): Promise<RunMetadata | undefined> {
    const metadata = this.metadata.get(runId);
    return metadata ? cloneRunMetadata(metadata) : undefined;
  }
}

export class InMemoryRunEventRepository implements RunEventRepository {
  private readonly events = new Map<string, RunEvent>();

  async create(event: RunEvent): Promise<RunEvent> {
    const validEvent = validateRunEvent(event);
    const existingSequence = [...this.events.values()].find(
      (entry) =>
        entry.taskRunId === validEvent.taskRunId &&
        entry.sequence === validEvent.sequence &&
        entry.id !== validEvent.id
    );
    if (existingSequence) {
      throw new Error(
        `run event sequence ${validEvent.sequence} already exists for run ${validEvent.taskRunId}`
      );
    }
    this.events.set(validEvent.id, cloneRunEvent(validEvent));
    return cloneRunEvent(validEvent);
  }

  async createMany(events: RunEvent[]): Promise<RunEvent[]> {
    const created: RunEvent[] = [];
    for (const event of events) {
      created.push(await this.create(event));
    }
    return created;
  }

  async listByRunId(runId: string): Promise<RunEvent[]> {
    return [...this.events.values()]
      .filter((event) => event.taskRunId === runId)
      .sort((left, right) => left.sequence - right.sequence)
      .map(cloneRunEvent);
  }

  async countByRunId(runId: string): Promise<number> {
    return (await this.listByRunId(runId)).length;
  }
}

export class InMemoryRunArtifactRepository implements RunArtifactRepository {
  private readonly artifacts = new Map<string, RunArtifact>();

  async create(artifact: RunArtifact): Promise<RunArtifact> {
    const validArtifact = validateRunArtifact(artifact);
    this.artifacts.set(validArtifact.id, cloneRunArtifact(validArtifact));
    return cloneRunArtifact(validArtifact);
  }

  async listByRunId(runId: string): Promise<RunArtifact[]> {
    return [...this.artifacts.values()]
      .filter((artifact) => artifact.taskRunId === runId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map(cloneRunArtifact);
  }

  async getLatestByRunIdAndKind(
    runId: string,
    kind: string
  ): Promise<RunArtifact | undefined> {
    const artifacts = (await this.listByRunId(runId)).filter(
      (artifact) => artifact.kind === kind
    );
    return artifacts.at(-1);
  }
}

export class InMemoryConversationThreadRepository
  implements ConversationThreadRepository
{
  private readonly threads = new Map<string, ConversationThread>();

  async create(thread: ConversationThread): Promise<ConversationThread> {
    const validThread = validateConversationThread(thread);
    if (this.threads.has(validThread.id)) {
      throw new Error(`conversation thread ${validThread.id} already exists`);
    }
    this.threads.set(validThread.id, cloneConversationThread(validThread));
    return cloneConversationThread(validThread);
  }

  async update(thread: ConversationThread): Promise<ConversationThread> {
    const validThread = validateConversationThread(thread);
    if (!this.threads.has(validThread.id)) {
      throw new Error(`conversation thread ${validThread.id} not found`);
    }
    this.threads.set(validThread.id, cloneConversationThread(validThread));
    return cloneConversationThread(validThread);
  }

  async get(threadId: string): Promise<ConversationThread | undefined> {
    const thread = this.threads.get(threadId);
    return thread ? cloneConversationThread(thread) : undefined;
  }

  async list(projectId?: string): Promise<ConversationThread[]> {
    return [...this.threads.values()]
      .filter((thread) => projectId === undefined || thread.projectId === projectId)
      .sort((left, right) =>
        left.createdAt === right.createdAt
          ? left.id.localeCompare(right.id)
          : left.createdAt.localeCompare(right.createdAt)
      )
      .map(cloneConversationThread);
  }
}

export class InMemoryConversationMessageRepository
  implements ConversationMessageRepository
{
  private readonly messages = new Map<string, ConversationMessage>();

  async create(message: ConversationMessage): Promise<ConversationMessage> {
    const validMessage = validateConversationMessage(message);
    if (this.messages.has(validMessage.id)) {
      throw new Error(`conversation message ${validMessage.id} already exists`);
    }
    const existingSequence = [...this.messages.values()].find(
      (entry) =>
        entry.threadId === validMessage.threadId &&
        entry.sequence === validMessage.sequence
    );
    if (existingSequence) {
      throw new Error(
        `conversation message sequence ${validMessage.sequence} already exists for thread ${validMessage.threadId}`
      );
    }
    this.messages.set(validMessage.id, cloneConversationMessage(validMessage));
    return cloneConversationMessage(validMessage);
  }

  async update(message: ConversationMessage): Promise<ConversationMessage> {
    const validMessage = validateConversationMessage(message);
    if (!this.messages.has(validMessage.id)) {
      throw new Error(`conversation message ${validMessage.id} not found`);
    }
    const existingSequence = [...this.messages.values()].find(
      (entry) =>
        entry.id !== validMessage.id &&
        entry.threadId === validMessage.threadId &&
        entry.sequence === validMessage.sequence
    );
    if (existingSequence) {
      throw new Error(
        `conversation message sequence ${validMessage.sequence} already exists for thread ${validMessage.threadId}`
      );
    }
    this.messages.set(validMessage.id, cloneConversationMessage(validMessage));
    return cloneConversationMessage(validMessage);
  }

  async createMany(
    messages: ConversationMessage[]
  ): Promise<ConversationMessage[]> {
    const created: ConversationMessage[] = [];
    for (const message of messages) {
      created.push(await this.create(message));
    }
    return created;
  }

  async get(messageId: string): Promise<ConversationMessage | undefined> {
    const message = this.messages.get(messageId);
    return message ? cloneConversationMessage(message) : undefined;
  }

  async listByThreadId(threadId: string): Promise<ConversationMessage[]> {
    return [...this.messages.values()]
      .filter((message) => message.threadId === threadId)
      .sort((left, right) =>
        left.sequence === right.sequence
          ? left.id.localeCompare(right.id)
          : left.sequence - right.sequence
      )
      .map(cloneConversationMessage);
  }

  async countByThreadId(threadId: string): Promise<number> {
    return (await this.listByThreadId(threadId)).length;
  }
}

export class InMemoryConversationThreadSummaryRepository
  implements ConversationThreadSummaryRepository
{
  private readonly summaries = new Map<string, ConversationThreadSummary>();

  async upsert(
    summary: ConversationThreadSummary
  ): Promise<ConversationThreadSummary> {
    const validSummary = validateConversationThreadSummary(summary);
    const existing = [...this.summaries.values()].find(
      (entry) => entry.threadId === validSummary.threadId && entry.id !== validSummary.id
    );
    if (existing) {
      this.summaries.delete(existing.id);
    }
    this.summaries.set(validSummary.id, cloneConversationThreadSummary(validSummary));
    return cloneConversationThreadSummary(validSummary);
  }

  async getByThreadId(
    threadId: string
  ): Promise<ConversationThreadSummary | undefined> {
    const summary = [...this.summaries.values()].find(
      (entry) => entry.threadId === threadId
    );
    return summary ? cloneConversationThreadSummary(summary) : undefined;
  }
}

export class InMemoryVerificationResultRepository
  implements VerificationResultRepository
{
  private readonly results = new Map<string, VerificationResult>();

  async create(result: VerificationResult): Promise<VerificationResult> {
    const validResult = validateVerificationResult(result);
    this.results.set(validResult.id, { ...validResult });
    return { ...validResult };
  }

  async createMany(results: VerificationResult[]): Promise<VerificationResult[]> {
    const created: VerificationResult[] = [];
    for (const result of results) {
      created.push(await this.create(result));
    }
    return created;
  }

  async listByRunId(runId: string): Promise<VerificationResult[]> {
    return [...this.results.values()]
      .filter((result) => result.taskRunId === runId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((result) => ({ ...result }));
  }
}

export class InMemoryRiskReportRepository implements RiskReportRepository {
  private readonly reports = new Map<string, RiskReport>();

  async create(report: RiskReport): Promise<RiskReport> {
    const validReport = validateRiskReport(report);
    this.reports.set(validReport.id, cloneRiskReport(validReport));
    return cloneRiskReport(validReport);
  }

  async listByRunId(runId: string): Promise<RiskReport[]> {
    return [...this.reports.values()]
      .filter((report) => report.taskRunId === runId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map(cloneRiskReport);
  }

  async getLatestByRunId(runId: string): Promise<RiskReport | undefined> {
    return (await this.listByRunId(runId)).at(-1);
  }
}

export class InMemoryMemoryItemRepository implements MemoryItemRepository {
  private readonly items = new Map<string, MemoryItem>();

  async create(item: MemoryItem): Promise<MemoryItem> {
    const validItem = validateMemoryItem(item);
    const existing = this.items.get(validItem.id);
    if (existing) {
      validateMemoryStatusTransition(existing.status, validItem.status);
    }
    const cloned = cloneMemoryItem(validItem);
    this.items.set(validItem.id, cloned);
    return cloneMemoryItem(cloned);
  }

  async updateStatus(
    memoryId: string,
    status: MemoryItem["status"],
    updatedAt: string
  ): Promise<MemoryItem> {
    const item = this.items.get(memoryId);
    if (!item) {
      throw new Error(`memory item ${memoryId} not found`);
    }
    validateMemoryStatusTransition(item.status, status);
    const updated = validateMemoryItem({ ...item, status, updatedAt });
    const cloned = cloneMemoryItem(updated);
    this.items.set(memoryId, cloned);
    return cloneMemoryItem(cloned);
  }

  async get(memoryId: string): Promise<MemoryItem | undefined> {
    const item = this.items.get(memoryId);
    return item ? cloneMemoryItem(item) : undefined;
  }

  async listByProjectId(projectId: string): Promise<MemoryItem[]> {
    return [...this.items.values()]
      .filter((item) => item.projectId === projectId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map(cloneMemoryItem);
  }
}

export class InMemoryComparisonReportRepository
  implements ComparisonReportRepository
{
  private readonly reports = new Map<string, ComparisonReport>();

  async create(report: ComparisonReport): Promise<ComparisonReport> {
    const validReport = validateComparisonReport(report);
    this.reports.set(validReport.id, cloneComparisonReport(validReport));
    return cloneComparisonReport(validReport);
  }

  async listByTaskId(taskId: string): Promise<ComparisonReport[]> {
    return [...this.reports.values()]
      .filter((report) => report.taskId === taskId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((report) => cloneComparisonReport(report));
  }

  async listByRunId(runId: string): Promise<ComparisonReport[]> {
    return [...this.reports.values()]
      .filter(
        (report) =>
          report.baselineRunId === runId || report.candidateRunId === runId
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((report) => cloneComparisonReport(report));
  }
}

export class InMemorySkillRepository implements SkillRepository {
  private readonly skills = new Map<string, Skill>();

  async create(skill: Skill): Promise<Skill> {
    const validSkill = validateSkill(skill);
    this.skills.set(validSkill.id, { ...validSkill });
    return { ...validSkill };
  }

  async list(projectId?: string): Promise<Skill[]> {
    return [...this.skills.values()]
      .filter((skill) => projectId === undefined || skill.projectId === projectId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((skill) => ({ ...skill }));
  }
}

export class InMemoryContextIndexRepository implements ContextIndexRepository {
  private readonly entries = new Map<string, ContextIndexEntry>();

  async rebuildProject(
    projectId: string,
    entries: ContextIndexEntry[],
    indexedAt: string
  ): Promise<ContextIndexRebuildResult> {
    const validEntries = entries.map(validateContextIndexEntry);
    const existingEntries = [...this.entries.values()].filter(
      (entry) => entry.projectId === projectId
    );
    const incomingIds = new Set(validEntries.map((entry) => entry.id));
    let createdCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;
    let deletedCount = 0;

    for (const entry of validEntries) {
      if (entry.projectId !== projectId) {
        throw new Error(`context index entry ${entry.id} belongs to project ${entry.projectId}, not ${projectId}`);
      }
      const existing = this.entries.get(entry.id);
      if (existing && contextIndexEntryUnchanged(existing, entry)) {
        unchangedCount += 1;
        continue;
      }
      if (existing) {
        updatedCount += 1;
      } else {
        createdCount += 1;
      }
      this.entries.set(entry.id, cloneContextIndexEntry({ ...entry, indexedAt }));
    }

    for (const entry of existingEntries) {
      if (!incomingIds.has(entry.id)) {
        this.entries.delete(entry.id);
        deletedCount += 1;
      }
    }

    return {
      projectId,
      indexedAt,
      createdCount,
      updatedCount,
      unchangedCount,
      deletedCount,
      skippedCount: 0,
      indexedIds: validEntries.map((entry) => entry.id).sort(),
      skipped: []
    };
  }

  async listByProjectId(projectId: string): Promise<ContextIndexEntry[]> {
    return [...this.entries.values()]
      .filter((entry) => entry.projectId === projectId)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(cloneContextIndexEntry);
  }

  async get(entryId: string): Promise<ContextIndexEntry | undefined> {
    const entry = this.entries.get(entryId);
    return entry ? cloneContextIndexEntry(entry) : undefined;
  }

  async search(input: ContextIndexSearchInput): Promise<ContextIndexSearchResult[]> {
    const terms = normalizeSearchTerms(input.terms ?? input.query);
    if (terms.length === 0) {
      return [];
    }
    const scored = (await this.listByProjectId(input.projectId))
      .map((entry) => {
        const haystack = `${entry.title}\n${entry.content}\n${entry.sourcePath ?? ""}`.toLowerCase();
        const matchedTerms = terms.filter((term) => haystack.includes(term));
        return { entry, matchedTerms };
      })
      .filter((result) => result.matchedTerms.length > 0)
      .sort((left, right) =>
        right.matchedTerms.length === left.matchedTerms.length
          ? left.entry.id.localeCompare(right.entry.id)
          : right.matchedTerms.length - left.matchedTerms.length
      )
      .slice(0, input.limit ?? 10);
    return scored.map((result, index) => ({
      entry: result.entry,
      lexicalScore: result.matchedTerms.length / terms.length,
      rank: index + 1,
      diagnostics: {
        query: input.query,
        terms,
        matchedTerms: result.matchedTerms
      }
    }));
  }
}

export class InMemoryCodeGraphRepository implements CodeGraphRepository {
  private readonly entries = new Map<string, CodeGraphEntry>();

  async rebuildProject(
    projectId: string,
    entries: CodeGraphEntry[],
    indexedAt: string
  ): Promise<CodeGraphRebuildResult> {
    const validEntries = entries.map(validateCodeGraphEntry);
    const existingEntries = [...this.entries.values()].filter(
      (entry) => entry.projectId === projectId
    );
    const incomingIds = new Set(validEntries.map((entry) => entry.id));
    let createdCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;
    let deletedCount = 0;

    for (const entry of validEntries) {
      if (entry.projectId !== projectId) {
        throw new Error(`code graph entry ${entry.id} belongs to project ${entry.projectId}, not ${projectId}`);
      }
      const storedEntry = { ...entry, indexedAt };
      const existing = this.entries.get(entry.id);
      if (existing && codeGraphEntryUnchanged(existing, storedEntry)) {
        unchangedCount += 1;
        continue;
      }
      if (existing) {
        updatedCount += 1;
      } else {
        createdCount += 1;
      }
      this.entries.set(entry.id, cloneCodeGraphEntry(storedEntry));
    }

    for (const entry of existingEntries) {
      if (!incomingIds.has(entry.id)) {
        this.entries.delete(entry.id);
        deletedCount += 1;
      }
    }

    return {
      projectId,
      indexedAt,
      createdCount,
      updatedCount,
      unchangedCount,
      deletedCount,
      indexedIds: validEntries.map((entry) => entry.id).sort()
    };
  }

  async listByProjectId(projectId: string): Promise<CodeGraphEntry[]> {
    return [...this.entries.values()]
      .filter((entry) => entry.projectId === projectId)
      .sort((left, right) => left.filePath.localeCompare(right.filePath))
      .map(cloneCodeGraphEntry);
  }

  async search(input: CodeGraphSearchInput): Promise<CodeGraphSearchResult[]> {
    const terms = normalizeSearchTerms(input.queryTerms);
    const seedPaths = normalizePathSet(input.seedPaths ?? []);
    const changedFiles = normalizePathSet(input.changedFiles ?? []);
    if (terms.length === 0 && seedPaths.size === 0 && changedFiles.size === 0) {
      return [];
    }
    const scored = (await this.listByProjectId(input.projectId))
      .map((entry) =>
        scoreCodeGraphEntry(entry, {
          terms,
          seedPaths,
          changedFiles
        })
      )
      .filter((result) => result.score > 0)
      .sort((left, right) =>
        right.score === left.score
          ? left.entry.filePath.localeCompare(right.entry.filePath)
          : right.score - left.score
      )
      .slice(0, input.limit ?? 8);
    return scored.map((result, index) => ({
      entry: result.entry,
      score: Math.min(1, result.score),
      rank: index + 1,
      matchedTerms: result.matchedTerms,
      matchedSymbols: result.matchedSymbols,
      matchedImports: result.matchedImports,
      relatedFiles: result.relatedFiles,
      diagnostics: {
        queryTerms: terms,
        seedPaths: [...seedPaths],
        changedFiles: [...changedFiles],
        packageName: result.entry.packageName,
        isTest: result.entry.isTest
      }
    }));
  }
}

export class InMemoryContextEvalEventRepository
  implements ContextEvalEventRepository
{
  private readonly events = new Map<string, ContextEvalEvent>();

  async create(event: ContextEvalEvent): Promise<ContextEvalEvent> {
    const validEvent = validateContextEvalEvent(event);
    this.events.set(validEvent.id, cloneContextEvalEvent(validEvent));
    return cloneContextEvalEvent(validEvent);
  }

  async createMany(events: ContextEvalEvent[]): Promise<ContextEvalEvent[]> {
    const created: ContextEvalEvent[] = [];
    for (const event of events) {
      created.push(await this.create(event));
    }
    return created;
  }

  async listByRunId(runId: string): Promise<ContextEvalEvent[]> {
    return this.sortedEvents((event) => event.runId === runId);
  }

  async listByProjectId(projectId: string): Promise<ContextEvalEvent[]> {
    return this.sortedEvents((event) => event.projectId === projectId);
  }

  private sortedEvents(
    predicate: (event: ContextEvalEvent) => boolean
  ): ContextEvalEvent[] {
    return [...this.events.values()]
      .filter(predicate)
      .sort((left, right) =>
        left.createdAt === right.createdAt
          ? left.id.localeCompare(right.id)
          : left.createdAt.localeCompare(right.createdAt)
      )
      .map(cloneContextEvalEvent);
  }
}

export class InMemorySettingsRepository implements SettingsRepository {
  private readonly settings = new Map<string, Setting>();

  async set(setting: Setting): Promise<Setting> {
    const validSetting = validateSetting(setting);
    const cloned = cloneSetting(validSetting);
    this.settings.set(validSetting.key, cloned);
    return cloneSetting(cloned);
  }

  async get(key: string): Promise<Setting | undefined> {
    const setting = this.settings.get(key);
    return setting ? cloneSetting(setting) : undefined;
  }

  async list(): Promise<Setting[]> {
    return [...this.settings.values()]
      .sort((left, right) => left.key.localeCompare(right.key))
      .map(cloneSetting);
  }
}

export class InMemoryRoleCallRepository implements RoleCallRepository {
  private readonly calls = new Map<string, RoleCall>();

  constructor(private readonly todoRepository?: RoleTodoRepository) {}

  async create(call: RoleCall): Promise<RoleCall> {
    const validCall = validateRoleCall(call);
    const existing = this.calls.get(validCall.id);
    if (existing) {
      validateRoleCallStatusTransition(existing.status, validCall.status);
    }
    this.calls.set(validCall.id, cloneRoleCall(validCall));
    return cloneRoleCall(validCall);
  }

  async update(call: RoleCall): Promise<RoleCall> {
    const validCall = validateRoleCall(call);
    const existing = this.calls.get(validCall.id);
    if (!existing) {
      throw new Error(`role call ${validCall.id} not found`);
    }
    validateRoleCallStatusTransition(existing.status, validCall.status);
    this.calls.set(validCall.id, cloneRoleCall(validCall));
    return cloneRoleCall(validCall);
  }

  async updateStatus(
    roleCallId: string,
    status: RoleCallStatus,
    at: string
  ): Promise<RoleCall> {
    const call = this.calls.get(roleCallId);
    if (!call) {
      throw new Error(`role call ${roleCallId} not found`);
    }
    validateRoleCallStatusTransition(call.status, status);
    const updated = validateRoleCall({
      ...call,
      status,
      startedAt: status === "running" ? call.startedAt ?? at : call.startedAt,
      completedAt: isTerminalRoleCallStatus(status) ? at : call.completedAt
    });
    this.calls.set(roleCallId, cloneRoleCall(updated));
    return cloneRoleCall(updated);
  }

  async linkTaskRun(
    roleCallId: string,
    taskRunId: string | undefined
  ): Promise<RoleCall> {
    const call = this.calls.get(roleCallId);
    if (!call) {
      throw new Error(`role call ${roleCallId} not found`);
    }
    const updated = validateRoleCall({ ...call, taskRunId });
    this.calls.set(roleCallId, cloneRoleCall(updated));
    return cloneRoleCall(updated);
  }

  async get(roleCallId: string): Promise<RoleCall | undefined> {
    const call = this.calls.get(roleCallId);
    return call ? cloneRoleCall(call) : undefined;
  }

  async list(filter: RoleCallListFilter = {}): Promise<RoleCall[]> {
    const matches: RoleCall[] = [];
    for (const call of this.calls.values()) {
      const linkedTodo =
        filter.todoStatus !== undefined && call.todoId && this.todoRepository
          ? await this.todoRepository.get(call.todoId)
          : undefined;
      if (roleCallMatchesFilter(call, filter, linkedTodo)) {
        matches.push(call);
      }
    }
    return matches
      .sort((left, right) =>
        left.createdAt === right.createdAt
          ? left.id.localeCompare(right.id)
          : left.createdAt.localeCompare(right.createdAt)
      )
      .map(cloneRoleCall);
  }
}

export class InMemoryRoleCallEventRepository
  implements RoleCallEventRepository
{
  private readonly events = new Map<string, RoleCallEvent>();

  async create(event: RoleCallEvent): Promise<RoleCallEvent> {
    const validEvent = validateRoleCallEvent(event);
    this.events.set(validEvent.id, cloneRoleCallEvent(validEvent));
    return cloneRoleCallEvent(validEvent);
  }

  async createMany(events: RoleCallEvent[]): Promise<RoleCallEvent[]> {
    const created: RoleCallEvent[] = [];
    for (const event of events) {
      created.push(await this.create(event));
    }
    return created;
  }

  async listByRoleCallId(roleCallId: string): Promise<RoleCallEvent[]> {
    return [...this.events.values()]
      .filter((event) => event.roleCallId === roleCallId)
      .sort((left, right) =>
        left.createdAt === right.createdAt
          ? left.id.localeCompare(right.id)
          : left.createdAt.localeCompare(right.createdAt)
      )
      .map(cloneRoleCallEvent);
  }

  async listByThreadId(threadId: string): Promise<RoleCallEvent[]> {
    return [...this.events.values()]
      .filter((event) => event.threadId === threadId)
      .sort((left, right) =>
        left.createdAt === right.createdAt
          ? left.id.localeCompare(right.id)
          : left.createdAt.localeCompare(right.createdAt)
      )
      .map(cloneRoleCallEvent);
  }
}

export class InMemoryRoleTodoRepository implements RoleTodoRepository {
  private readonly todos = new Map<string, RoleTodo>();

  async create(todo: RoleTodo): Promise<RoleTodo> {
    const validTodo = validateRoleTodo(todo);
    const existing = this.todos.get(validTodo.id);
    if (existing) {
      validateRoleTodoStatusTransition(existing.status, validTodo.status);
    }
    this.todos.set(validTodo.id, cloneRoleTodo(validTodo));
    return cloneRoleTodo(validTodo);
  }

  async update(todo: RoleTodo): Promise<RoleTodo> {
    const validTodo = validateRoleTodo(todo);
    const existing = this.todos.get(validTodo.id);
    if (!existing) {
      throw new Error(`role todo ${validTodo.id} not found`);
    }
    validateRoleTodoStatusTransition(existing.status, validTodo.status);
    this.todos.set(validTodo.id, cloneRoleTodo(validTodo));
    return cloneRoleTodo(validTodo);
  }

  async updateStatus(
    todoId: string,
    status: RoleTodoStatus,
    updatedAt: string
  ): Promise<RoleTodo> {
    const todo = this.todos.get(todoId);
    if (!todo) {
      throw new Error(`role todo ${todoId} not found`);
    }
    validateRoleTodoStatusTransition(todo.status, status);
    const updated = validateRoleTodo({
      ...todo,
      status,
      updatedAt,
      completedAt: isTerminalRoleTodoStatus(status) ? updatedAt : todo.completedAt
    });
    this.todos.set(todoId, cloneRoleTodo(updated));
    return cloneRoleTodo(updated);
  }

  async get(todoId: string): Promise<RoleTodo | undefined> {
    const todo = this.todos.get(todoId);
    return todo ? cloneRoleTodo(todo) : undefined;
  }

  async list(filter: RoleTodoListFilter = {}): Promise<RoleTodo[]> {
    return [...this.todos.values()]
      .filter((todo) => roleTodoMatchesFilter(todo, filter))
      .sort((left, right) =>
        left.createdAt === right.createdAt
          ? left.id.localeCompare(right.id)
          : left.createdAt.localeCompare(right.createdAt)
      )
      .map(cloneRoleTodo);
  }
}

export class InMemoryPlanGraphRepository implements PlanGraphRepository {
  private readonly graphs = new Map<string, PlanGraph>();

  async create(graph: PlanGraph): Promise<PlanGraph> {
    const validGraph = validatePlanGraph(graph);
    if (validGraph.status === "active") {
      this.supersedeActiveGraphsForTask(validGraph.taskId, validGraph.id);
    }
    this.graphs.set(validGraph.id, clonePlanGraph(validGraph));
    return clonePlanGraph(validGraph);
  }

  async get(id: string): Promise<PlanGraph | undefined> {
    const graph = this.graphs.get(id);
    return graph ? clonePlanGraph(graph) : undefined;
  }

  async getActiveByTaskId(taskId: string): Promise<PlanGraph | undefined> {
    const graph = [...this.graphs.values()].find(
      (candidate) => candidate.taskId === taskId && candidate.status === "active"
    );
    return graph ? clonePlanGraph(graph) : undefined;
  }

  async listByTaskId(taskId: string): Promise<PlanGraph[]> {
    return [...this.graphs.values()]
      .filter((graph) => graph.taskId === taskId)
      .sort((left, right) =>
        left.version === right.version
          ? left.createdAt.localeCompare(right.createdAt)
          : left.version - right.version
      )
      .map(clonePlanGraph);
  }

  async supersede(id: string, nextGraphId: string): Promise<PlanGraph> {
    const graph = this.graphs.get(id);
    if (!graph) {
      throw new Error(`plan graph ${id} not found`);
    }
    const nextGraph = this.graphs.get(nextGraphId);
    const superseded = validatePlanGraph({
      ...graph,
      status: "superseded"
    });
    this.graphs.set(id, clonePlanGraph(superseded));
    if (nextGraph) {
      this.supersedeActiveGraphsForTask(nextGraph.taskId, nextGraph.id);
      const activated = validatePlanGraph({
        ...nextGraph,
        status: "active"
      });
      this.graphs.set(nextGraph.id, clonePlanGraph(activated));
    }
    return clonePlanGraph(superseded);
  }

  private supersedeActiveGraphsForTask(taskId: string, exceptId: string): void {
    for (const [id, graph] of this.graphs.entries()) {
      if (id !== exceptId && graph.taskId === taskId && graph.status === "active") {
        this.graphs.set(id, clonePlanGraph({ ...graph, status: "superseded" }));
      }
    }
  }
}

export class InMemoryTraceLinkRepository implements TraceLinkRepository {
  private readonly nodes = new Map<string, TraceNode>();
  private readonly edges = new Map<string, TraceEdge>();
  private readonly evidence = new Map<string, TraceEvidence>();
  private readonly roleCallToolEvents = new Map<string, RoleCallToolEvent>();

  async createNode(node: TraceNode): Promise<TraceNode> {
    this.nodes.set(node.id, cloneTraceNode(node));
    return cloneTraceNode(node);
  }

  async createEdge(edge: TraceEdge): Promise<TraceEdge> {
    this.edges.set(edge.id, cloneTraceEdge(edge));
    return cloneTraceEdge(edge);
  }

  async linkEvidence(link: TraceEvidence): Promise<TraceEvidence> {
    this.evidence.set(link.id, cloneTraceEvidence(link));
    return cloneTraceEvidence(link);
  }

  async createRoleCallToolEvent(
    event: RoleCallToolEvent
  ): Promise<RoleCallToolEvent> {
    const validEvent = validateRoleCallToolEvent(event);
    this.roleCallToolEvents.set(validEvent.id, cloneRoleCallToolEvent(validEvent));
    return cloneRoleCallToolEvent(validEvent);
  }

  async listByPlanGraphId(planGraphId: string): Promise<TraceProjectionRows> {
    return {
      nodes: [...this.nodes.values()]
        .filter((node) => node.planGraphId === planGraphId)
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(cloneTraceNode),
      edges: [...this.edges.values()]
        .filter((edge) => traceEdgeBelongsToPlanGraph(edge, this.nodes, planGraphId))
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(cloneTraceEdge),
      evidence: [...this.evidence.values()]
        .filter((link) => link.planGraphId === planGraphId)
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(cloneTraceEvidence),
      roleCallToolEvents: [...this.roleCallToolEvents.values()]
        .filter((event) => event.planGraphId === planGraphId)
        .sort((left, right) => left.createdAt === right.createdAt
          ? left.id.localeCompare(right.id)
          : left.createdAt.localeCompare(right.createdAt))
        .map(cloneRoleCallToolEvent)
    };
  }
}

function isTerminalRunStatus(status: RunStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function isTerminalRoleCallStatus(status: RoleCallStatus): boolean {
  return (
    status === "succeeded" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "rejected"
  );
}

function isTerminalRoleTodoStatus(status: RoleTodoStatus): boolean {
  return status === "done" || status === "cancelled" || status === "rejected";
}

export function cloneRunMetadata(metadata: RunMetadata): RunMetadata {
  return {
    ...metadata,
    workspace: metadata.workspace ? { ...metadata.workspace } : undefined,
    workspaceCleanup: metadata.workspaceCleanup
      ? {
          ...metadata.workspaceCleanup,
          commands: metadata.workspaceCleanup.commands.map((command) => ({ ...command }))
        }
      : undefined,
    diff: metadata.diff
      ? {
          ...metadata.diff,
          changedFiles: metadata.diff.changedFiles.map((file) => ({ ...file })),
          stat: { ...metadata.diff.stat },
          fileSummaries: [...metadata.diff.fileSummaries],
          commands: metadata.diff.commands.map((command) => ({ ...command }))
        }
      : undefined,
    verification: metadata.verification
      ? {
          ...metadata.verification,
          results: metadata.verification.results.map((result) => ({ ...result })),
          failedCommands: metadata.verification.failedCommands.map((result) => ({
            ...result
          }))
        }
      : undefined,
    riskReport: metadata.riskReport
      ? {
          ...metadata.riskReport,
          changedFiles: [...metadata.riskReport.changedFiles],
          failedChecks: [...metadata.riskReport.failedChecks],
          riskFactors: [...metadata.riskReport.riskFactors],
          manualReviewChecklist: [...metadata.riskReport.manualReviewChecklist],
          findings: metadata.riskReport.findings.map((finding) => ({ ...finding }))
        }
      : undefined,
    role: metadata.role
      ? {
          ...metadata.role,
          permissions: [...metadata.role.permissions],
          contextPolicy: {
            ...metadata.role.contextPolicy,
            instructions: [...metadata.role.contextPolicy.instructions]
          },
          approvalPolicy: {
            ...metadata.role.approvalPolicy,
            requiredFor: [...metadata.role.approvalPolicy.requiredFor]
          }
        }
      : undefined,
    planBinding: metadata.planBinding
      ? {
          ...metadata.planBinding,
          allowedNextPlanNodeIds: [...metadata.planBinding.allowedNextPlanNodeIds]
        }
      : undefined
  };
}

function cloneRunEvent(event: RunEvent): RunEvent {
  return {
    ...event,
    metadata: cloneJsonObject(event.metadata)
  };
}

function cloneContextIndexEntry(entry: ContextIndexEntry): ContextIndexEntry {
  return {
    ...entry,
    metadata: cloneJsonObject(entry.metadata)
  };
}

function cloneCodeGraphEntry(entry: CodeGraphEntry): CodeGraphEntry {
  return {
    ...entry,
    imports: [...entry.imports],
    exports: [...entry.exports],
    symbols: [...entry.symbols],
    relatedTests: [...entry.relatedTests],
    metadata: cloneJsonObject(entry.metadata)
  };
}

function cloneContextEvalEvent(event: ContextEvalEvent): ContextEvalEvent {
  return {
    ...event,
    selectedItemIds: [...event.selectedItemIds],
    omittedItemIds: [...event.omittedItemIds],
    metadata: cloneJsonObject(event.metadata)
  };
}

function contextIndexEntryUnchanged(
  existing: ContextIndexEntry,
  incoming: ContextIndexEntry
): boolean {
  return (
    existing.projectId === incoming.projectId &&
    existing.layer === incoming.layer &&
    existing.sourceKind === incoming.sourceKind &&
    existing.sourceId === incoming.sourceId &&
    existing.scope === incoming.scope &&
    existing.trustLevel === incoming.trustLevel &&
    existing.lifetime === incoming.lifetime &&
    existing.title === incoming.title &&
    existing.contentHash === incoming.contentHash &&
    existing.sourcePath === incoming.sourcePath &&
    JSON.stringify(existing.metadata) === JSON.stringify(incoming.metadata)
  );
}

function codeGraphEntryUnchanged(
  existing: CodeGraphEntry,
  incoming: CodeGraphEntry
): boolean {
  return (
    existing.projectId === incoming.projectId &&
    existing.filePath === incoming.filePath &&
    existing.packageName === incoming.packageName &&
    existing.isTest === incoming.isTest &&
    existing.contentHash === incoming.contentHash &&
    arraysEqual(existing.imports, incoming.imports) &&
    arraysEqual(existing.exports, incoming.exports) &&
    arraysEqual(existing.symbols, incoming.symbols) &&
    arraysEqual(existing.relatedTests, incoming.relatedTests) &&
    JSON.stringify(existing.metadata) === JSON.stringify(incoming.metadata)
  );
}

export function scoreCodeGraphEntry(
  entry: CodeGraphEntry,
  input: {
    terms: string[];
    seedPaths: Set<string>;
    changedFiles: Set<string>;
  }
): {
  entry: CodeGraphEntry;
  score: number;
  matchedTerms: string[];
  matchedSymbols: string[];
  matchedImports: string[];
  relatedFiles: string[];
} {
  const searchableText = [
    entry.filePath,
    entry.packageName,
    ...entry.symbols,
    ...entry.exports,
    ...entry.imports,
    ...entry.relatedTests
  ].join("\n").toLowerCase();
  const matchedTerms = input.terms.filter((term) => searchableText.includes(term));
  const matchedSymbols = entry.symbols.filter((symbol) =>
    input.terms.includes(symbol.toLowerCase())
  );
  const matchedImports = entry.imports.filter((importPath) =>
    input.seedPaths.has(importPath) || input.changedFiles.has(importPath)
  );
  const relatedFiles = entry.relatedTests.filter((testPath) =>
    input.seedPaths.has(testPath) || input.changedFiles.has(testPath)
  );
  const directPathMatch =
    input.seedPaths.has(entry.filePath) || input.changedFiles.has(entry.filePath);
  const relatedSeedMatch = entry.relatedTests.some(
    (testPath) => input.seedPaths.has(testPath) || input.changedFiles.has(testPath)
  );
  const score =
    matchedTerms.length * 0.16 +
    matchedSymbols.length * 0.18 +
    matchedImports.length * 0.2 +
    relatedFiles.length * 0.18 +
    (directPathMatch ? 0.45 : 0) +
    (relatedSeedMatch ? 0.22 : 0) +
    (entry.isTest && (matchedTerms.length > 0 || relatedSeedMatch) ? 0.08 : 0);
  return {
    entry,
    score,
    matchedTerms,
    matchedSymbols,
    matchedImports,
    relatedFiles
  };
}

export function normalizePathSet(values: string[]): Set<string> {
  return new Set(values.map(normalizeGraphPath).filter(Boolean));
}

function normalizeGraphPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

export function normalizeSearchTerms(value: string | string[]): string[] {
  const rawTerms = Array.isArray(value)
    ? value
    : value.split(/[^A-Za-z0-9_./-]+/);
  return [
    ...new Set(
      rawTerms
        .flatMap((term) => term.split(/[^A-Za-z0-9_]+/))
        .map((term) => term.trim().toLowerCase())
        .filter((term) => term.length >= 2)
    )
  ];
}

function cloneRunArtifact(artifact: RunArtifact): RunArtifact {
  return {
    ...artifact,
    metadata: cloneJsonObject(artifact.metadata)
  };
}

function cloneConversationThread(thread: ConversationThread): ConversationThread {
  return {
    ...thread,
    metadata: thread.metadata ? cloneJsonObject(thread.metadata) : undefined
  };
}

function cloneConversationMessage(
  message: ConversationMessage
): ConversationMessage {
  return {
    ...message,
    metadata: message.metadata ? cloneJsonObject(message.metadata) : undefined
  };
}

function cloneConversationThreadSummary(
  summary: ConversationThreadSummary
): ConversationThreadSummary {
  return {
    ...summary,
    decisions: [...summary.decisions],
    openItems: [...summary.openItems],
    constraints: [...summary.constraints],
    metadata: summary.metadata ? cloneJsonObject(summary.metadata) : undefined
  };
}

function cloneRiskReport(report: RiskReport): RiskReport {
  return {
    ...report,
    changedFiles: [...report.changedFiles],
    failedChecks: [...report.failedChecks],
    riskFactors: [...report.riskFactors],
    manualReviewChecklist: [...report.manualReviewChecklist],
    findings: report.findings.map((finding) => ({ ...finding }))
  };
}

function cloneMemoryItem(item: MemoryItem): MemoryItem {
  return {
    ...item,
    metadata: item.metadata ? cloneJsonObject(item.metadata) : undefined
  };
}

function cloneComparisonReport(report: ComparisonReport): ComparisonReport {
  return {
    ...report,
    details: report.details ? cloneJsonObject(report.details) : undefined
  };
}

function cloneSetting(setting: Setting): Setting {
  return {
    ...setting,
    value: cloneJsonValue(setting.value)
  };
}

function cloneRoleCall(call: RoleCall): RoleCall {
  return cloneJsonValue(call) as RoleCall;
}

function cloneRoleCallEvent(event: RoleCallEvent): RoleCallEvent {
  return cloneJsonValue(event) as RoleCallEvent;
}

function cloneRoleTodo(todo: RoleTodo): RoleTodo {
  return cloneJsonValue(todo) as RoleTodo;
}

function clonePlanGraph(graph: PlanGraph): PlanGraph {
  return cloneJsonValue(graph) as PlanGraph;
}

function cloneTraceNode(node: TraceNode): TraceNode {
  return cloneJsonValue(node) as TraceNode;
}

function cloneTraceEdge(edge: TraceEdge): TraceEdge {
  return cloneJsonValue(edge) as TraceEdge;
}

function cloneTraceEvidence(evidence: TraceEvidence): TraceEvidence {
  return cloneJsonValue(evidence) as TraceEvidence;
}

function cloneRoleCallToolEvent(event: RoleCallToolEvent): RoleCallToolEvent {
  return cloneJsonValue(event) as RoleCallToolEvent;
}

function traceEdgeBelongsToPlanGraph(
  edge: TraceEdge,
  nodes: Map<string, TraceNode>,
  planGraphId: string
): boolean {
  if (edge.planGraphId === planGraphId) {
    return true;
  }
  const fromNode = nodes.get(edge.from);
  const toNode = nodes.get(edge.to);
  return fromNode?.planGraphId === planGraphId || toNode?.planGraphId === planGraphId;
}

function roleCallMatchesFilter(
  call: RoleCall,
  filter: RoleCallListFilter,
  linkedTodo?: RoleTodo
): boolean {
  return (
    (filter.threadId === undefined || call.threadId === filter.threadId) &&
    (filter.role === undefined ||
      call.callerRole === filter.role ||
      call.calleeRole === filter.role) &&
    (filter.callerRole === undefined || call.callerRole === filter.callerRole) &&
    (filter.calleeRole === undefined || call.calleeRole === filter.calleeRole) &&
    (filter.parentRoleCallId === undefined ||
      call.parentRoleCallId === filter.parentRoleCallId) &&
    (filter.status === undefined || call.status === filter.status) &&
    (filter.todoStatus === undefined || linkedTodo?.status === filter.todoStatus)
  );
}

function roleTodoMatchesFilter(
  todo: RoleTodo,
  filter: RoleTodoListFilter
): boolean {
  return (
    (filter.threadId === undefined || todo.threadId === filter.threadId) &&
    (filter.role === undefined || todo.role === filter.role) &&
    (filter.sourceRoleCallId === undefined ||
      todo.sourceRoleCallId === filter.sourceRoleCallId) &&
    (filter.status === undefined || todo.status === filter.status)
  );
}

function cloneJsonObject<T extends Record<string, unknown>>(value: T): T {
  return cloneJsonValue(value) as T;
}

function cloneJsonValue(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}
