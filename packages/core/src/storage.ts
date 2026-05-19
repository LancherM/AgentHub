import type {
  DiffCollectionResult,
  VerificationSuiteResult,
  Workspace,
  WorkspaceCleanupResult
} from "@agent-hub/shared";
import {
  validateAgentProfile,
  validateComparisonReport,
  validateConversationMessage,
  validateConversationThread,
  validateConversationThreadSummary,
  validateMemoryItem,
  validateProject,
  validateRiskReport,
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
  type ComparisonReport,
  type ConversationMessage,
  type ConversationThread,
  type ConversationThreadSummary,
  type MemoryItem,
  type Project,
  type RiskReport,
  type RunArtifact,
  type RunEvent,
  type Setting,
  type Skill,
  type Task,
  type TaskRun,
  type TaskRunStatus,
  type TaskStatus,
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
}

export interface SkillRepository {
  create(skill: Skill): Promise<Skill>;
  list(projectId?: string): Promise<Skill[]>;
}

export interface SettingsRepository {
  set(setting: Setting): Promise<Setting>;
  get(key: string): Promise<Setting | undefined>;
  list(): Promise<Setting[]>;
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
    this.tasks.set(validTask.id, { ...validTask });
    return { ...validTask };
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
    this.tasks.set(taskId, updated);
    return { ...updated };
  }

  async get(taskId: string): Promise<Task | undefined> {
    const task = this.tasks.get(taskId);
    return task ? { ...task } : undefined;
  }

  async list(): Promise<Task[]> {
    return [...this.tasks.values()]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((task) => ({ ...task }));
  }

  async listByProjectId(projectId: string): Promise<Task[]> {
    return (await this.list()).filter((task) => task.projectId === projectId);
  }
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
    this.items.set(validItem.id, { ...validItem });
    return { ...validItem };
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
    this.items.set(memoryId, updated);
    return { ...updated };
  }

  async get(memoryId: string): Promise<MemoryItem | undefined> {
    const item = this.items.get(memoryId);
    return item ? { ...item } : undefined;
  }

  async listByProjectId(projectId: string): Promise<MemoryItem[]> {
    return [...this.items.values()]
      .filter((item) => item.projectId === projectId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((item) => ({ ...item }));
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

function isTerminalRunStatus(status: RunStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
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
      : undefined
  };
}

function cloneRunEvent(event: RunEvent): RunEvent {
  return {
    ...event,
    metadata: cloneJsonObject(event.metadata)
  };
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

function cloneJsonObject<T extends Record<string, unknown>>(value: T): T {
  return cloneJsonValue(value) as T;
}

function cloneJsonValue(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}
