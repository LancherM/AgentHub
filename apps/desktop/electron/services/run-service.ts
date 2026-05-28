import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import type { ConversationContextBrief } from "@agent-hub/context-compiler";
import {
  validateRunEvent,
  validateTask,
  validateTaskRun,
  type ProjectRepository,
  type RunEvent as CoreRunEvent,
  type RunEventRepository,
  type RunMetadataRepository,
  type Task,
  type TaskRepository,
  type TaskRun,
  type TaskRunRepository
} from "@agent-hub/core";
import {
  TaskRunner,
  RoleCallTaskRunnerExecutor,
  type AgentRunEvent,
  type Clock,
  type IdGenerator,
  type RoleCallExecutionResult,
  type TaskRunnerDependencies
} from "@agent-hub/task-runner";
import {
  isAgentKindEnabled,
  normalizeWorkgroupRoleHandle,
  workgroupExecutorKinds,
  type AgentAvailabilityOptions,
  type WorkgroupAgentAdapterKind,
  type AgentKind as CoreAgentKind,
  type JsonObject,
  type RoleDefinition,
  type RunEventType as CoreRunEventType,
  type TaskRunStatus as CoreRunStatus,
  type WorkgroupRoleRunMetadata,
  type WorkgroupTaskAssignmentMetadata
} from "@agent-hub/shared";
import type {
  AgentId,
  CreateRunInput,
  RunDetail,
  RunEvent,
  RunEventPayload,
  RunEventType,
  RunStatus,
  RunSummary
} from "../../src/lib/types";
import type { MemoryService } from "./memory-service";
import type { DesktopServiceContext } from "./project-service";
import type { ReviewService } from "./review-service";
import type { SettingsService } from "./settings-service";

export interface RunService {
  createRun(input: CreateDesktopRunInput): Promise<RunSummary>;
  executeRoleCall(input: ExecuteDesktopRoleCallInput): Promise<RoleCallExecutionResult>;
  getRun(runId: string): Promise<RunDetail>;
  getConversationRunSnapshot(runId: string): Promise<ConversationRunSnapshot>;
  listRuns(projectId?: string): Promise<RunSummary[]>;
  listRunStatuses(projectId?: string): Promise<Map<string, RunStatus>>;
  startRun(runId: string): Promise<void>;
  cancelRun(runId: string): Promise<void>;
  subscribe(runId: string, listener: (event: RunEvent) => void): () => void;
}

export interface RunServiceDependencies {
  reviewService: ReviewService;
  memoryService: MemoryService;
  settingsService?: SettingsService;
  taskRunnerDependencies?: TaskRunnerDependencies;
  workspaceBasePath?: string;
}

export interface CreateDesktopRunInput extends CreateRunInput {
  assignment?: WorkgroupTaskAssignmentMetadata;
  conversationBrief?: string | ConversationContextBrief;
  startImmediately?: boolean;
}

export interface ExecuteDesktopRoleCallInput {
  roleCallId: string;
  projectId: string;
  roles: readonly RoleDefinition[];
}

export interface ConversationRunSnapshot {
  id: string;
  agentId: AgentId;
  status: RunStatus;
  summary: string;
  events: RunEvent[];
}

interface ActiveRun {
  status: RunStatus;
  controller: AbortController;
  promise: Promise<void>;
}

interface ParsedCreateRunInput
  extends Omit<
    Required<CreateRunInput>,
    | "agentSessionId"
    | "continueFromRunId"
    | "continueFromMessageId"
    | "role"
    | "taskId"
  > {
  taskId?: string;
  assignment?: WorkgroupTaskAssignmentMetadata;
  conversationBrief?: string | ConversationContextBrief;
  role?: WorkgroupRoleRunMetadata;
  startImmediately: boolean;
  agentSessionId?: string;
  continueFromRunId?: string;
  continueFromMessageId?: string;
}

const desktopStatusTransitions: Record<RunStatus, readonly RunStatus[]> = {
  queued: ["running", "cancelled"],
  running: ["verifying", "failed", "cancelled"],
  verifying: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: []
};

const semanticRunEventTypes: readonly RunEventType[] = [
  "run_started",
  "context_compiled",
  "agent_step",
  "agent_output",
  "verification_started",
  "verification_finished",
  "run_completed",
  "run_failed",
  "run_cancelled"
] as const;

export function createRunService(
  context: DesktopServiceContext,
  dependencies: RunServiceDependencies
): RunService {
  return new RepositoryRunService(context, dependencies);
}

class RepositoryRunService implements RunService {
  private readonly projects: ProjectRepository;
  private readonly tasks: TaskRepository;
  private readonly runs: TaskRunRepository;
  private readonly events: RunEventRepository;
  private readonly metadata: RunMetadataRepository;
  private readonly emitter = new EventEmitter();
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly runInputs = new Map<string, ParsedCreateRunInput>();

  constructor(
    private readonly context: DesktopServiceContext,
    private readonly dependencies: RunServiceDependencies
  ) {
    this.projects = context.repositories.projectRepository;
    this.tasks = context.repositories.taskRepository;
    this.runs = context.repositories.taskRunRepository;
    this.events = context.repositories.runEventRepository;
    this.metadata = context.repositories.runMetadataRepository;
  }

  async listRuns(projectId?: string): Promise<RunSummary[]> {
    const tasks = projectId
      ? await this.tasks.listByProjectId(projectId)
      : await this.tasks.list();
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const projectById = new Map(
      (await this.projects.list()).map((project) => [project.id, project])
    );
    const runs = (await this.runs.list()).filter((run) => taskById.has(run.taskId));
    const summaries = await Promise.all(
      runs.map(async (run) => {
        const task = taskById.get(run.taskId) ?? await this.tasks.get(run.taskId);
        if (!task) {
          return undefined;
        }
        const project =
          projectById.get(task.projectId) ?? await this.projects.get(task.projectId);
        if (!project) {
          return undefined;
        }
        const events = await this.events.listByRunId(run.id);
        return await this.toRunSummary(run, task, project, events);
      })
    );
    return summaries
      .filter((summary): summary is RunSummary => summary !== undefined)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async listRunStatuses(projectId?: string): Promise<Map<string, RunStatus>> {
    const tasks = projectId
      ? await this.tasks.listByProjectId(projectId)
      : await this.tasks.list();
    const taskIds = new Set(tasks.map((task) => task.id));
    const runs = (await this.runs.list()).filter((run) => taskIds.has(run.taskId));
    return new Map(
      runs.map((run) => [run.id, this.currentDesktopStatus(run)])
    );
  }

  async getRun(runId: string): Promise<RunDetail> {
    const run = await this.runs.get(runId);
    if (!run) {
      throw new Error(`run ${runId} not found`);
    }
    const task = await this.tasks.get(run.taskId);
    if (!task) {
      throw new Error(`task ${run.taskId} not found`);
    }
    const project = await this.projects.get(task.projectId);
    if (!project) {
      throw new Error(`project ${task.projectId} not found`);
    }
    const status = this.currentDesktopStatus(run);
    const [events, diff, verification, risk, memoryProposals] =
      await Promise.all([
        this.events.listByRunId(runId),
        this.dependencies.reviewService.getDiff(runId),
        this.dependencies.reviewService.getVerification(runId),
        this.dependencies.reviewService.getRisk(runId),
        isTerminalStatus(status)
          ? this.dependencies.memoryService.listProposals(runId)
          : Promise.resolve([])
      ]);
    const summary = finalSummary(events) ?? statusSummary(run);
    return {
      ...(await this.toRunSummary(run, task, project, events)),
      events: events.map(toRunEvent),
      changedFiles: diff.files.map((file) => file.path),
      verification,
      risk,
      memoryProposals,
      summary
    };
  }

  async getConversationRunSnapshot(runId: string): Promise<ConversationRunSnapshot> {
    const run = await this.runs.get(runId);
    if (!run) {
      throw new Error(`run ${runId} not found`);
    }
    const events = await this.events.listByRunId(runId);
    return {
      id: run.id,
      agentId: toAgentId(run.agentKind),
      status: this.currentDesktopStatus(run),
      summary: finalSummary(events) ?? statusSummary(run),
      events: events.map(toRunEvent)
    };
  }

  async createRun(input: CreateDesktopRunInput): Promise<RunSummary> {
    const parsed = parseCreateRunInput(input, this.context.agentAvailability);
    const project = await this.projects.get(parsed.projectId);
    if (!project) {
      throw new Error(`project ${parsed.projectId} not found`);
    }
    if (parsed.continueFromRunId) {
      await this.requireContinuableParentRun(parsed.continueFromRunId);
    }

    const createdAt = this.context.now();
    const task = parsed.taskId
      ? await this.requireTaskForProject(parsed.taskId, project.id)
      : await this.tasks.create(
          validateTask({
            id: this.context.nextId("task"),
            projectId: project.id,
            title: parsed.title,
            description: parsed.prompt,
            status: "open",
            createdAt,
            updatedAt: createdAt
          })
        );
    const run = await this.runs.create(
      validateTaskRun({
        id: this.context.nextId("run"),
        taskId: task.id,
        agentKind: toCoreAgentKind(parsed.agentId),
        status: "queued",
        parentRunId: parsed.continueFromRunId,
        parentMessageId: parsed.continueFromMessageId,
        createdAt,
        updatedAt: createdAt
      })
    );
    if (parsed.role) {
      await this.metadata.save({
        runId: run.id,
        role: parsed.role
      });
    }
    this.runInputs.set(run.id, parsed);

    if (parsed.startImmediately) {
      queueMicrotask(() => {
        void this.startRun(run.id).catch((error) => {
          void this.failActiveRun(run.id, error);
        });
      });
    }

    return await this.toRunSummary(run, task, project);
  }

  async executeRoleCall(
    input: ExecuteDesktopRoleCallInput
  ): Promise<RoleCallExecutionResult> {
    const project = await this.projects.get(input.projectId);
    if (!project) {
      throw new Error(`project ${input.projectId} not found`);
    }
    const verificationCommands =
      await this.dependencies.settingsService?.verificationCommandsForProject(project.id);
    const runId = this.context.nextId("run");
    const executor = new RoleCallTaskRunnerExecutor({
      taskRunner: this.createTaskRunner(runId),
      repositories: {
        roleCallRepository: this.context.repositories.roleCallRepository,
        roleCallEventRepository: this.context.repositories.roleCallEventRepository,
        roleTodoRepository: this.context.repositories.roleTodoRepository
      },
      roles: input.roles,
      idFactory: (prefix) => this.context.nextId(prefix),
      now: () => this.context.now()
    });
    return executor.execute({
      roleCallId: input.roleCallId,
      projectId: project.id,
      projectRoot: project.rootPath,
      taskRunnerOptions: {
        agentAvailability: this.context.agentAvailability,
        agentHubHome: this.context.agentHubHome,
        deliveryMode: "runtime_injection",
        verificationCommands,
        workspaceBasePath: this.desktopWorkspaceBasePath(),
        workspaceCleanupPolicy: "never"
      }
    });
  }

  async startRun(runId: string): Promise<void> {
    if (this.activeRuns.has(runId)) {
      throw new Error(`run ${runId} is already running`);
    }

    const run = await this.runs.get(runId);
    if (!run) {
      throw new Error(`run ${runId} not found`);
    }
    if (run.status !== "queued") {
      throw new Error(`run ${runId} cannot be started from ${run.status}`);
    }
    const task = await this.tasks.get(run.taskId);
    if (!task) {
      throw new Error(`task ${run.taskId} not found`);
    }
    const project = await this.projects.get(task.projectId);
    if (!project) {
      throw new Error(`project ${task.projectId} not found`);
    }

    const active: ActiveRun = {
      status: "running",
      controller: new AbortController(),
      promise: Promise.resolve()
    };
    this.activeRuns.set(runId, active);

    active.promise = this.executeTaskRunnerRun(run, task, project, active)
      .catch((error) => this.failActiveRun(runId, error))
      .finally(() => {
        this.activeRuns.delete(runId);
        this.runInputs.delete(runId);
      });
  }

  async cancelRun(runId: string): Promise<void> {
    const run = await this.runs.get(runId);
    if (!run) {
      throw new Error(`run ${runId} not found`);
    }
    const currentStatus = this.currentDesktopStatus(run);
    if (isTerminalStatus(currentStatus)) {
      throw new Error(`run ${runId} is already ${currentStatus}`);
    }

    const active = this.activeRuns.get(runId);
    if (!active) {
      await this.transitionRunStatus(runId, "cancelled");
      const event = await this.persistDesktopEvent(runId, {
        type: "run_cancelled",
        message: "Run cancelled before TaskRunner execution started.",
        payload: {
          phase: "final",
          status: "cancelled",
          message: "Run cancelled before TaskRunner execution started."
        }
      });
      this.emitLiveEvent(event);
      return;
    }

    if (!active.controller.signal.aborted) {
      active.controller.abort();
    }
  }

  subscribe(runId: string, listener: (event: RunEvent) => void): () => void {
    const channel = eventChannel(runId);
    const deliveredEventIds = new Set<string>();
    let subscribed = true;
    const deliver = (event: RunEvent): void => {
      if (!subscribed || deliveredEventIds.has(event.id)) {
        return;
      }
      deliveredEventIds.add(event.id);
      listener(event);
    };
    this.emitter.on(channel, deliver);
    void this.replayPersistedEvents(runId, deliver).catch(() => undefined);
    return () => {
      subscribed = false;
      this.emitter.off(channel, deliver);
    };
  }

  private async replayPersistedEvents(
    runId: string,
    listener: (event: RunEvent) => void
  ): Promise<void> {
    const events = await this.events.listByRunId(runId);
    for (const event of events.map(toRunEvent)) {
      listener(event);
    }
  }

  private async requireContinuableParentRun(parentRunId: string): Promise<void> {
    const parentRun = await this.runs.get(parentRunId);
    if (!parentRun) {
      throw new Error(`parent run ${parentRunId} not found`);
    }
    if (
      parentRun.status !== "succeeded" &&
      parentRun.status !== "failed" &&
      parentRun.status !== "cancelled"
    ) {
      throw new Error(`parent run ${parentRunId} must be terminal before continuation`);
    }
    const parentMetadata = await this.metadata.get(parentRunId);
    if (parentMetadata?.workspaceCleanup?.retained !== true || !parentRun.worktreePath) {
      throw new Error(
        `parent run ${parentRunId} does not have a retained worktree for desktop continuation`
      );
    }
  }

  private async requireTaskForProject(
    taskId: string,
    projectId: string
  ): Promise<Task> {
    const task = await this.tasks.get(taskId);
    if (!task) {
      throw new Error(`task ${taskId} not found`);
    }
    if (task.projectId !== projectId) {
      throw new Error(`task ${taskId} belongs to project ${task.projectId}`);
    }
    return task;
  }

  private async executeTaskRunnerRun(
    run: TaskRun,
    task: Task,
    project: { id: string; rootPath: string },
    active: ActiveRun
  ): Promise<void> {
    const input = this.runInputs.get(run.id);
    if (!input) {
      throw new Error(`run ${run.id} is missing desktop execution input`);
    }

    const runner = this.createTaskRunner(run.id);
    const verificationCommands =
      await this.dependencies.settingsService?.verificationCommandsForProject(
        task.projectId
      );
    const result = await runner.run({
      projectRoot: project.rootPath,
      taskPrompt: input.prompt,
      agentKind: run.agentKind,
      agentAvailability: this.context.agentAvailability,
      taskId: task.id,
      projectId: task.projectId,
      title: task.title,
      taskStatusMode: input.assignment ? "shared_task" : "single_run",
      deliveryMode: input.deliveryMode,
      agentHubHome: this.context.agentHubHome,
      roleSkillReferences: input.role?.defaultSkillReferences,
      conversationBrief: input.conversationBrief,
      agentSessionId: input.agentSessionId,
      userConstraints: roleUserConstraints(input.role),
      executionHints: roleExecutionHints(input.role),
      verificationCommands,
      workspaceBasePath: this.desktopWorkspaceBasePath(),
      workspaceCleanupPolicy: "never",
      signal: active.controller.signal,
      onEvent: async (event) => {
        const persisted = await this.persistTaskRunnerEvent(run.id, event);
        this.applyLiveEventStatus(run.id, persisted);
        this.emitLiveEvent(persisted);
      },
      continueFrom: input.continueFromRunId
        ? {
            parentRunId: input.continueFromRunId,
            parentMessageId: input.continueFromMessageId
          }
        : undefined
    });

    active.status = toDesktopRunStatus(result.run.status);
    await this.updateTaskAssignmentStatus(run.id);
    await this.emitPersistedEvents(run.id);
  }

  private createTaskRunner(runId: string): TaskRunner {
    const defaultRunRoot = this.desktopWorkspaceBasePath();
    return new TaskRunner({
      ...this.dependencies.taskRunnerDependencies,
      defaultRunRoot,
      taskRepository: this.tasks,
      taskRunRepository: this.runs,
      runEventRepository: this.events,
      runArtifactRepository: this.context.repositories.runArtifactRepository,
      verificationResultRepository:
        this.context.repositories.verificationResultRepository,
      riskReportRepository: this.context.repositories.riskReportRepository,
      memoryItemRepository: this.context.repositories.memoryItemRepository,
      runMetadataRepository: this.metadata,
      idGenerator: new DesktopTaskRunnerIdGenerator(this.context, runId),
      clock: new DesktopTaskRunnerClock(this.context)
    });
  }

  private desktopWorkspaceBasePath(): string {
    return path.resolve(
      this.dependencies.workspaceBasePath ??
        this.dependencies.taskRunnerDependencies?.defaultRunRoot ??
        path.join(os.homedir(), ".agent-hub", "worktrees")
    );
  }

  private async emitPersistedEvents(runId: string): Promise<void> {
    const events = await this.events.listByRunId(runId);
    for (const event of events.map(toRunEvent)) {
      this.applyLiveEventStatus(runId, event);
      this.emitLiveEvent(event);
    }
  }

  private async transitionRunStatus(
    runId: string,
    nextStatus: RunStatus
  ): Promise<void> {
    const run = await this.runs.get(runId);
    if (!run) {
      throw new Error(`run ${runId} not found`);
    }
    const task = await this.tasks.get(run.taskId);
    if (!task) {
      throw new Error(`task ${run.taskId} not found`);
    }

    const active = this.activeRuns.get(runId);
    const currentStatus = active?.status ?? toDesktopRunStatus(run.status);
    if (currentStatus === nextStatus) {
      return;
    }
    if (!desktopStatusTransitions[currentStatus].includes(nextStatus)) {
      throw new Error(
        `invalid desktop run status transition ${currentStatus} -> ${nextStatus}`
      );
    }

    const updatedAt = this.context.now();
    const sharedTask = Boolean(this.runInputs.get(runId)?.assignment);
    if (nextStatus === "running") {
      if (task.status === "open") {
        await this.tasks.updateStatus(task.id, "running", updatedAt);
      }
      await this.runs.updateStatus(runId, "running", updatedAt);
      await this.updateTaskAssignmentStatus(runId);
    } else if (nextStatus === "verifying") {
      await this.runs.updateStatus(runId, "running", updatedAt);
    } else if (nextStatus === "completed") {
      await this.runs.updateStatus(runId, "succeeded", updatedAt);
      await this.updateTaskAssignmentStatus(runId);
      await this.updateTaskAfterDesktopRun(task, "completed", updatedAt, sharedTask);
    } else if (nextStatus === "failed") {
      await this.runs.updateStatus(runId, "failed", updatedAt);
      await this.updateTaskAssignmentStatus(runId);
      await this.updateTaskAfterDesktopRun(task, "failed", updatedAt, sharedTask);
    } else if (nextStatus === "cancelled") {
      await this.runs.updateStatus(runId, "cancelled", updatedAt);
      await this.updateTaskAssignmentStatus(runId);
      await this.updateTaskAfterDesktopRun(task, "cancelled", updatedAt, sharedTask);
    }

    if (active) {
      active.status = nextStatus;
    }
  }

  private async updateTaskAssignmentStatus(runId: string): Promise<void> {
    const run = await this.runs.get(runId);
    if (!run) {
      return;
    }
    const task = await this.tasks.get(run.taskId);
    const assignments = task?.metadata?.assignments;
    if (!task || !Array.isArray(assignments)) {
      return;
    }
    const statuses = new Map(
      (await this.runs.listByTaskId(task.id)).map((taskRun) => [
        taskRun.id,
        toTaskAssignmentStatus(taskRun.status)
      ])
    );
    let changed = false;
    const updatedAssignments = assignments.map((entry) => {
      const assignment = entry as WorkgroupTaskAssignmentMetadata;
      const nextStatus = assignment.runId
        ? statuses.get(assignment.runId)
        : undefined;
      if (
        !entry ||
        typeof entry !== "object" ||
        !nextStatus ||
        assignment.status === nextStatus
      ) {
        return entry;
      }
      changed = true;
      return {
        ...assignment,
        status: nextStatus
      };
    });
    if (!changed) {
      return;
    }
    await this.tasks.create(
      validateTask({
        ...task,
        metadata: {
          ...task.metadata,
          assignments: updatedAssignments
        },
        updatedAt: this.context.now()
      })
    );
  }

  private async updateTaskAfterDesktopRun(
    task: Task,
    runStatus: "completed" | "failed" | "cancelled",
    updatedAt: string,
    sharedTask: boolean
  ): Promise<void> {
    const nextStatus = sharedTask
      ? await this.sharedTaskStatus(task.id)
      : runStatus === "completed"
        ? "completed"
        : "open";
    const current = await this.tasks.get(task.id);
    if (!current || current.status === nextStatus) {
      return;
    }
    if (!sharedTask && current.status !== "running" && nextStatus === "open") {
      return;
    }
    await this.tasks.updateStatus(task.id, nextStatus, updatedAt);
  }

  private async sharedTaskStatus(taskId: string): Promise<Task["status"]> {
    const runs = await this.runs.listByTaskId(taskId);
    if (runs.some((run) => run.status === "queued" || run.status === "running")) {
      return "running";
    }
    if (runs.length > 0 && runs.every((run) => run.status === "succeeded")) {
      return "completed";
    }
    return "open";
  }

  private async persistDesktopEvent(
    runId: string,
    event: {
      type: RunEventType;
      message: string;
      payload: RunEventPayload;
    }
  ): Promise<RunEvent> {
    const sequence = await this.events.countByRunId(runId);
    const createdAt = this.context.now();
    const coreEvent = await this.events.create(
      validateRunEvent({
        id: this.context.nextId("event"),
        taskRunId: runId,
        sequence,
        type: toCoreRunEventType(event.type),
        message: event.message,
        metadata: {
          ...event.payload,
          desktopEventType: event.type
        },
        createdAt
      })
    );
    return toRunEvent(coreEvent);
  }

  private async persistTaskRunnerEvent(
    runId: string,
    event: AgentRunEvent
  ): Promise<RunEvent> {
    const sequence = await this.events.countByRunId(runId);
    const createdAt = this.context.now();
    const metadata: JsonObject = { ...(event.metadata ?? {}) };
    if (event.type === "exit") {
      metadata.exitCode = event.exitCode;
      if (event.signal !== undefined) {
        metadata.signal = event.signal;
      }
    }
    const coreEvent = await this.events.create(
      validateRunEvent({
        id: this.context.nextId("event"),
        taskRunId: runId,
        sequence,
        type: event.type,
        message: event.message,
        metadata,
        createdAt
      })
    );
    return toRunEvent(coreEvent);
  }

  private applyLiveEventStatus(runId: string, event: RunEvent): void {
    const status = event.payload.status;
    if (!status || isTerminalStatus(status)) {
      return;
    }
    const active = this.activeRuns.get(runId);
    if (active) {
      active.status = status;
    }
  }

  private emitLiveEvent(event: RunEvent): void {
    this.emitter.emit(eventChannel(event.runId), event);
  }

  private currentDesktopStatus(run: TaskRun): RunStatus {
    const persistedStatus = toDesktopRunStatus(run.status);
    if (isTerminalStatus(persistedStatus)) {
      return persistedStatus;
    }
    return this.activeRuns.get(run.id)?.status ?? persistedStatus;
  }

  private async failActiveRun(runId: string, error: unknown): Promise<void> {
    const run = await this.runs.get(runId);
    if (!run || isTerminalStatus(this.currentDesktopStatus(run))) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    await this.transitionRunStatus(runId, "failed");
    const event = await this.persistDesktopEvent(runId, {
      type: "run_failed",
      message,
      payload: {
        phase: "final",
        status: "failed",
        message
      }
    });
    this.emitLiveEvent(event);
  }

  private async toRunSummary(
    run: TaskRun,
    task: Task,
    project: { id: string; name: string },
    events: CoreRunEvent[] = []
  ): Promise<RunSummary> {
    const eventUpdatedAt = events.at(-1)?.createdAt;
    const metadata = await this.metadata.get(run.id);
    const canContinueCodeState =
      (run.status === "succeeded" || run.status === "failed" || run.status === "cancelled") &&
      metadata?.workspaceCleanup?.retained === true &&
      Boolean(run.worktreePath);
    return {
      id: run.id,
      projectId: project.id,
      projectName: project.name,
      taskId: task.id,
      title: task.title,
      taskPrompt: task.description ?? "",
      agentId: toAgentId(run.agentKind),
      status: this.currentDesktopStatus(run),
      parentRunId: run.parentRunId,
      parentMessageId: run.parentMessageId,
      canContinueCodeState,
      createdAt: run.createdAt,
      updatedAt: eventUpdatedAt ?? run.updatedAt
    };
  }
}

class DesktopTaskRunnerIdGenerator implements IdGenerator {
  private runIdClaimed = false;

  constructor(
    private readonly context: DesktopServiceContext,
    private readonly runId: string
  ) {}

  nextId(prefix: string): string {
    if (prefix === "run" && !this.runIdClaimed) {
      this.runIdClaimed = true;
      return this.runId;
    }
    return this.context.nextId(prefix);
  }
}

class DesktopTaskRunnerClock implements Clock {
  constructor(private readonly context: DesktopServiceContext) {}

  now(): string {
    return this.context.now();
  }
}

function parseCreateRunInput(
  input: CreateDesktopRunInput,
  availability: AgentAvailabilityOptions
): ParsedCreateRunInput {
  if (!input || typeof input !== "object") {
    throw new Error("run input is required");
  }
  const prompt = input.prompt?.trim();
  if (!prompt) {
    throw new Error("run prompt is required");
  }
  const agentId = parseAgentId(input.agentId, availability);
  const contextMode = parseContextMode(input.contextMode);
  const deliveryMode = input.deliveryMode ?? "runtime_injection";
  if (deliveryMode !== "runtime_injection" && deliveryMode !== "worktree_overlay") {
    throw new Error("deliveryMode must be runtime_injection or worktree_overlay");
  }
  if (!input.projectId || typeof input.projectId !== "string") {
    throw new Error("projectId is required");
  }
  if (input.taskId !== undefined) {
    parseNonEmptyString(input.taskId, "taskId");
  }
  if (input.continueFromRunId !== undefined) {
    parseNonEmptyString(input.continueFromRunId, "continueFromRunId");
  }
  if (input.continueFromMessageId !== undefined) {
    parseNonEmptyString(input.continueFromMessageId, "continueFromMessageId");
  }
  if (input.continueFromMessageId !== undefined && input.continueFromRunId === undefined) {
    throw new Error("continueFromRunId is required when continueFromMessageId is provided");
  }
  if (input.agentSessionId !== undefined) {
    parseNonEmptyString(input.agentSessionId, "agentSessionId");
  }
  return {
    taskId: input.taskId,
    projectId: input.projectId,
    prompt,
    title: input.title?.trim() || titleFromPrompt(prompt),
    agentId,
    contextMode,
    deliveryMode,
    conversationBrief: input.conversationBrief,
    agentSessionId: input.agentSessionId,
    role: parseRoleMetadata(input.role),
    assignment: parseTaskAssignmentMetadata(input.assignment),
    startImmediately: input.startImmediately !== false,
    continueFromRunId: input.continueFromRunId,
    continueFromMessageId: input.continueFromMessageId
  };
}

function parseTaskAssignmentMetadata(
  value: unknown
): WorkgroupTaskAssignmentMetadata | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object") {
    throw new Error("task assignment metadata must be an object when provided");
  }
  const assignment = value as WorkgroupTaskAssignmentMetadata;
  if (
    typeof assignment.assignmentId !== "string" ||
    typeof assignment.taskId !== "string" ||
    typeof assignment.threadId !== "string" ||
    typeof assignment.sourceMessageId !== "string" ||
    typeof assignment.displayName !== "string" ||
    typeof assignment.executorKind !== "string" ||
    typeof assignment.executable !== "boolean" ||
    typeof assignment.status !== "string"
  ) {
    throw new Error("task assignment metadata is missing required fields");
  }
  if (assignment.assignmentRole !== "agent" && assignment.assignmentRole !== "role") {
    throw new Error("task assignment role must be agent or role");
  }
  if (
    assignment.agentId !== undefined &&
    assignment.agentId !== "fake" &&
    assignment.agentId !== "codex" &&
    assignment.agentId !== "claude"
  ) {
    throw new Error("task assignment agentId must be fake, codex, or claude");
  }
  if (
    !workgroupExecutorKinds.includes(
      assignment.executorKind as WorkgroupTaskAssignmentMetadata["executorKind"]
    )
  ) {
    throw new Error("task assignment executorKind is not supported");
  }
  return assignment;
}

function parseRoleMetadata(
  value: unknown
): WorkgroupRoleRunMetadata | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object") {
    throw new Error("role metadata must be an object when provided");
  }
  const role = value as WorkgroupRoleRunMetadata;
  if (
    typeof role.roleId !== "string" ||
    typeof role.roleHandle !== "string" ||
    typeof role.displayName !== "string" ||
    typeof role.executorKind !== "string"
  ) {
    throw new Error("role metadata must include roleId, roleHandle, displayName, and executorKind");
  }
  const normalizedHandle = normalizeWorkgroupRoleHandle(role.roleHandle);
  if (
    role.roleId.trim().length === 0 ||
    !normalizedHandle ||
    normalizedHandle !== role.roleHandle ||
    role.displayName.trim().length === 0
  ) {
    throw new Error("role metadata contains invalid role identity values");
  }
  if (
    !workgroupExecutorKinds.includes(
      role.executorKind as WorkgroupRoleRunMetadata["executorKind"]
    )
  ) {
    throw new Error("role metadata executorKind is not supported");
  }
  if (role.executorKind !== "agent_adapter") {
    throw new Error("role metadata executorKind is not executable yet");
  }
  if (!isWorkgroupAgentAdapterKind(role.adapterKind)) {
    throw new Error("role metadata adapterKind is required for agent_adapter executors");
  }
  const contextPolicy = recordValue(role.contextPolicy);
  const approvalPolicy = recordValue(role.approvalPolicy);
  const contextScope =
    typeof contextPolicy?.scope === "string" &&
    contextPolicy.scope.trim().length > 0
      ? contextPolicy.scope
      : "current_thread_and_project_context";
  return {
    roleId: role.roleId,
    roleHandle: role.roleHandle,
    displayName: role.displayName,
    executorKind: role.executorKind,
    adapterKind: role.adapterKind,
    persona: typeof role.persona === "string" ? role.persona : "",
    defaultInstructions:
      typeof role.defaultInstructions === "string" ? role.defaultInstructions : "",
    permissions: stringArray(role.permissions),
    contextPolicy: {
      scope: contextScope,
      includeApprovedMemory: contextPolicy?.includeApprovedMemory === true,
      includeThreadSummary: contextPolicy?.includeThreadSummary !== false,
      instructions: stringArray(contextPolicy?.instructions)
    },
    approvalPolicy: {
      requiredFor: stringArray(approvalPolicy?.requiredFor),
      summary:
        typeof approvalPolicy?.summary === "string"
          ? approvalPolicy.summary
          : ""
    }
  };
}

function roleUserConstraints(role?: WorkgroupRoleRunMetadata): string[] | undefined {
  if (!role) {
    return undefined;
  }
  return [
    `Act as workgroup role @${role.roleHandle} (${role.displayName}).`,
    `Role persona: ${role.persona}`,
    `Role instructions: ${role.defaultInstructions}`,
    `Role permissions: ${role.permissions.join(", ") || "none"}`,
    `Role approval policy: ${role.approvalPolicy.summary}`,
    "Agent Hub owns role delegation. Do not simulate subagents, worker roles, or hidden role chats inside your response.",
    "To delegate to another Agent Hub role, emit a separate line-start role call in the form '@role bounded task'. Agent Hub will parse and orchestrate it.",
    "Delegation-only requests do not require repository reconnaissance; emit the role call first and let Agent Hub schedule the callee.",
    "Use the injected available_role_calls directory for role names; do not inspect the repository merely to discover roles or delegation syntax."
  ];
}

function roleExecutionHints(role?: WorkgroupRoleRunMetadata): string[] | undefined {
  if (!role) {
    return undefined;
  }
  return [
    `executor_kind=${role.executorKind}`,
    role.adapterKind ? `adapter_kind=${role.adapterKind}` : undefined,
    `context_policy=${role.contextPolicy.scope}`
  ].filter((hint): hint is string => hint !== undefined);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isWorkgroupAgentAdapterKind(
  value: unknown
): value is WorkgroupAgentAdapterKind {
  return value === "fake" || value === "codex" || value === "claude-code";
}

function parseNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function parseAgentId(value: unknown, availability: AgentAvailabilityOptions): AgentId {
  if (value === "fake" || value === "codex" || value === "claude") {
    if (!isAgentKindEnabled(toCoreAgentKind(value), availability)) {
      if (value === "fake") {
        throw new Error("fake agent is disabled outside Agent Hub debug/development mode");
      }
      throw new Error(`${value} agent is disabled by Agent Hub agent availability config`);
    }
    return value;
  }
  throw new Error("agentId must be fake, codex, or claude");
}

function parseContextMode(value: unknown): CreateRunInput["contextMode"] {
  if (
    value === "auto" ||
    value === "minimal" ||
    value === "full" ||
    value === "workspace"
  ) {
    return value;
  }
  throw new Error("contextMode must be auto, minimal, full, or workspace");
}

function toCoreAgentKind(agentId: AgentId): CoreAgentKind {
  return agentId === "claude" ? "claude-code" : agentId;
}

function toAgentId(agentKind: CoreAgentKind): AgentId {
  return agentKind === "claude-code" ? "claude" : agentKind;
}

function toDesktopRunStatus(status: CoreRunStatus): RunStatus {
  if (status === "succeeded") {
    return "completed";
  }
  return status;
}

function toTaskAssignmentStatus(
  status: RunStatus | CoreRunStatus
): WorkgroupTaskAssignmentMetadata["status"] {
  if (status === "succeeded") {
    return "completed";
  }
  if (status === "verifying") {
    return "running";
  }
  return status;
}

function toCoreRunEventType(type: RunEventType): CoreRunEventType {
  switch (type) {
    case "agent_output":
      return "stdout";
    case "agent_step":
      return "message";
    case "run_failed":
      return "error";
    case "run_completed":
      return "exit";
    default:
      return "status";
  }
}

function toRunEvent(event: CoreRunEvent): RunEvent {
  const metadata = event.metadata as JsonObject;
  const type = parseSemanticEventType(metadata.desktopEventType) ?? toSemanticType(event);
  const payload: RunEventPayload = {
    ...metadata,
    message:
      typeof metadata.message === "string" ? metadata.message : event.message
  };
  delete (payload as Record<string, unknown>).desktopEventType;
  return {
    id: event.id,
    runId: event.taskRunId,
    sequence: event.sequence,
    type,
    timestamp: event.createdAt,
    payload
  };
}

function parseSemanticEventType(value: unknown): RunEventType | undefined {
  return typeof value === "string" &&
    semanticRunEventTypes.includes(value as RunEventType)
    ? (value as RunEventType)
    : undefined;
}

function toSemanticType(event: CoreRunEvent): RunEventType {
  if (event.type === "stdout" || event.type === "stderr") {
    return "agent_output";
  }
  if (event.type === "error") {
    return "run_failed";
  }
  if (event.type === "exit") {
    return event.metadata.exitCode === 0 ? "run_completed" : "run_failed";
  }
  const phase =
    typeof event.metadata.phase === "string" ? event.metadata.phase : undefined;
  if (phase === "context") {
    return "context_compiled";
  }
  if (phase === "verification") {
    return "verification_finished";
  }
  return "agent_step";
}

function titleFromPrompt(prompt: string): string {
  const firstLine = prompt.trim().split(/\r?\n/, 1)[0] ?? "";
  return firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;
}

function finalSummary(events: CoreRunEvent[]): string | undefined {
  return [...events]
    .reverse()
    .map(toRunEvent)
    .find((event) =>
      ["run_completed", "run_failed", "run_cancelled"].includes(event.type)
    )?.payload.message;
}

function statusSummary(run: TaskRun): string {
  const status = toDesktopRunStatus(run.status);
  switch (status) {
    case "queued":
      return "Run is queued.";
    case "running":
      return "Run is in progress.";
    case "completed":
      return "Run completed.";
    case "failed":
      return "Run failed.";
    case "cancelled":
      return "Run was cancelled.";
    default:
      return "Run is being verified.";
  }
}

function isTerminalStatus(status: RunStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function eventChannel(runId: string): string {
  return `run:${runId}`;
}
