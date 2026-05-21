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
  type AgentRunEvent,
  type Clock,
  type IdGenerator,
  type TaskRunnerDependencies
} from "@agent-hub/task-runner";
import type {
  AgentKind as CoreAgentKind,
  JsonObject,
  RunEventType as CoreRunEventType,
  TaskRunStatus as CoreRunStatus
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

export interface RunService {
  createRun(input: CreateDesktopRunInput): Promise<RunSummary>;
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
  taskRunnerDependencies?: TaskRunnerDependencies;
  workspaceBasePath?: string;
}

export interface CreateDesktopRunInput extends CreateRunInput {
  conversationBrief?: string | ConversationContextBrief;
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
    "continueFromRunId" | "continueFromMessageId"
  > {
  conversationBrief?: string | ConversationContextBrief;
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
    const [events, diff, verification, risk, memoryProposals] =
      await Promise.all([
        this.events.listByRunId(runId),
        this.dependencies.reviewService.getDiff(runId),
        this.dependencies.reviewService.getVerification(runId),
        this.dependencies.reviewService.getRisk(runId),
        this.dependencies.memoryService.listProposals(runId)
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
    const parsed = parseCreateRunInput(input);
    const project = await this.projects.get(parsed.projectId);
    if (!project) {
      throw new Error(`project ${parsed.projectId} not found`);
    }
    if (parsed.continueFromRunId) {
      await this.requireContinuableParentRun(parsed.continueFromRunId);
    }

    const createdAt = this.context.now();
    const task = await this.tasks.create(
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
    this.runInputs.set(run.id, parsed);

    queueMicrotask(() => {
      void this.startRun(run.id).catch((error) => {
        void this.failActiveRun(run.id, error);
      });
    });

    return await this.toRunSummary(run, task, project);
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
    const result = await runner.run({
      projectRoot: project.rootPath,
      taskPrompt: input.prompt,
      agentKind: run.agentKind,
      taskId: task.id,
      projectId: task.projectId,
      title: task.title,
      deliveryMode: input.deliveryMode,
      conversationBrief: input.conversationBrief,
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

    await this.emitPersistedEvents(run.id);
    active.status = toDesktopRunStatus(result.run.status);
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
    if (nextStatus === "running") {
      await this.tasks.updateStatus(task.id, "running", updatedAt);
      await this.runs.updateStatus(runId, "running", updatedAt);
    } else if (nextStatus === "verifying") {
      await this.runs.updateStatus(runId, "running", updatedAt);
    } else if (nextStatus === "completed") {
      await this.runs.updateStatus(runId, "succeeded", updatedAt);
      await this.tasks.updateStatus(task.id, "completed", updatedAt);
    } else if (nextStatus === "failed") {
      await this.runs.updateStatus(runId, "failed", updatedAt);
      if (task.status === "running") {
        await this.tasks.updateStatus(task.id, "open", updatedAt);
      }
    } else if (nextStatus === "cancelled") {
      await this.runs.updateStatus(runId, "cancelled", updatedAt);
      if (task.status === "running") {
        await this.tasks.updateStatus(task.id, "open", updatedAt);
      }
    }

    if (active) {
      active.status = nextStatus;
    }
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
    return this.activeRuns.get(run.id)?.status ?? toDesktopRunStatus(run.status);
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

function parseCreateRunInput(input: CreateDesktopRunInput): ParsedCreateRunInput {
  if (!input || typeof input !== "object") {
    throw new Error("run input is required");
  }
  const prompt = input.prompt?.trim();
  if (!prompt) {
    throw new Error("run prompt is required");
  }
  const agentId = parseAgentId(input.agentId);
  const contextMode = parseContextMode(input.contextMode);
  const deliveryMode = input.deliveryMode ?? "runtime_injection";
  if (deliveryMode !== "runtime_injection" && deliveryMode !== "worktree_overlay") {
    throw new Error("deliveryMode must be runtime_injection or worktree_overlay");
  }
  if (!input.projectId || typeof input.projectId !== "string") {
    throw new Error("projectId is required");
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
  return {
    projectId: input.projectId,
    prompt,
    title: input.title?.trim() || titleFromPrompt(prompt),
    agentId,
    contextMode,
    deliveryMode,
    conversationBrief: input.conversationBrief,
    continueFromRunId: input.continueFromRunId,
    continueFromMessageId: input.continueFromMessageId
  };
}

function parseNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function parseAgentId(value: unknown): AgentId {
  if (value === "fake" || value === "codex" || value === "claude") {
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
