import { EventEmitter } from "node:events";
import type { ConversationContextBrief } from "@agent-hub/context-compiler";
import {
  validateRiskReport,
  validateRunArtifact,
  validateRunEvent,
  validateTask,
  validateTaskRun,
  validateVerificationResult,
  type ProjectRepository,
  type RiskReportRepository,
  type RunArtifactRepository,
  type RunEvent as CoreRunEvent,
  type RunEventRepository,
  type Task,
  type TaskRepository,
  type TaskRun,
  type TaskRunRepository,
  type VerificationResultRepository
} from "@agent-hub/core";
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
import {
  runFakeAgent,
  type FakeAgentRunnerEvent
} from "./fake-agent-runner";
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
  fakeDelayMs?: number;
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
  controller: AbortController;
  status: RunStatus;
  promise: Promise<void>;
}

interface ParsedCreateRunInput extends Required<CreateRunInput> {
  conversationBrief?: string | ConversationContextBrief;
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
  private readonly artifacts: RunArtifactRepository;
  private readonly verification: VerificationResultRepository;
  private readonly risks: RiskReportRepository;
  private readonly emitter = new EventEmitter();
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly runInputs = new Map<
    string,
    { prompt: string; contextMode: CreateRunInput["contextMode"] }
  >();

  constructor(
    private readonly context: DesktopServiceContext,
    private readonly dependencies: RunServiceDependencies
  ) {
    this.projects = context.repositories.projectRepository;
    this.tasks = context.repositories.taskRepository;
    this.runs = context.repositories.taskRunRepository;
    this.events = context.repositories.runEventRepository;
    this.artifacts = context.repositories.runArtifactRepository;
    this.verification = context.repositories.verificationResultRepository;
    this.risks = context.repositories.riskReportRepository;
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
        return this.toRunSummary(run, task, project, events);
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
      ...this.toRunSummary(run, task, project, events),
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
        createdAt,
        updatedAt: createdAt
      })
    );
    this.runInputs.set(run.id, {
      prompt: parsed.prompt,
      contextMode: parsed.contextMode
    });
    await this.persistConversationBrief(run.id, parsed.conversationBrief);

    queueMicrotask(() => {
      void this.startRun(run.id).catch((error) => {
        void this.failActiveRun(run.id, error);
      });
    });

    return this.toRunSummary(run, task, project);
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
    const agentId = toAgentId(run.agentKind);

    const controller = new AbortController();
    const active: ActiveRun = {
      controller,
      status: "queued",
      promise: Promise.resolve()
    };
    this.activeRuns.set(runId, active);

    active.promise = (agentId === "fake"
      ? this.executeFakeRun(run, task, active)
      : this.executeUnavailableAgentRun(run.id, agentId, active))
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
      const event = await this.persistRunnerEvent(runId, {
        type: "run_cancelled",
        payload: {
          phase: "final",
          status: "cancelled",
          message: "Run cancelled before the fake agent started."
        }
      });
      this.emitLiveEvent(event);
      await this.persistTerminalReview(runId, "cancelled");
      return;
    }

    active.controller.abort();
    await active.promise;
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

  private async executeFakeRun(
    run: TaskRun,
    task: Task,
    active: ActiveRun
  ): Promise<void> {
    await runFakeAgent(
      {
        prompt: task.description ?? task.title,
        contextMode: this.runInputs.get(run.id)?.contextMode ?? "auto",
        signal: active.controller.signal,
        delayMs: this.dependencies.fakeDelayMs
      },
      async (event) => {
        if (isTerminalStatus(active.status)) {
          return;
        }
        await this.applyRunnerEvent(run.id, event);
      }
    );
  }

  private async executeUnavailableAgentRun(
    runId: string,
    agentId: Exclude<AgentId, "fake">,
    active: ActiveRun
  ): Promise<void> {
    if (active.controller.signal.aborted) {
      await this.applyRunnerEvent(runId, {
        type: "run_cancelled",
        payload: {
          phase: "final",
          status: "cancelled",
          message: `@${agentId} was cancelled before desktop execution started.`
        }
      });
      return;
    }

    await this.applyRunnerEvent(runId, {
      type: "run_started",
      payload: {
        phase: "lifecycle",
        status: "running",
        message: `Desktop received @${agentId}, but real adapter execution is not wired yet.`
      }
    });
    await this.applyRunnerEvent(runId, {
      type: "run_failed",
      payload: {
        phase: "final",
        status: "failed",
        message: `@${agentId} desktop execution is not wired yet. No repository files were modified.`
      }
    });
  }

  private async applyRunnerEvent(
    runId: string,
    event: FakeAgentRunnerEvent
  ): Promise<void> {
    if (isTerminalEvent(event.type)) {
      const persisted = await this.persistRunnerEvent(runId, event);
      if (event.type === "run_completed") {
        await this.transitionRunStatus(runId, "completed");
        await this.persistTerminalReview(runId, "completed");
      } else if (event.type === "run_failed") {
        await this.transitionRunStatus(runId, "failed");
        await this.persistTerminalReview(runId, "failed");
      } else {
        await this.transitionRunStatus(runId, "cancelled");
        await this.persistTerminalReview(runId, "cancelled");
      }
      this.emitLiveEvent(persisted);
      return;
    }

    if (event.type === "run_started") {
      await this.transitionRunStatus(runId, "running");
    } else if (event.type === "verification_started") {
      await this.transitionRunStatus(runId, "verifying");
    } else if (event.type === "verification_finished") {
      await this.persistVerification(runId, event.payload);
    }

    const persisted = await this.persistRunnerEvent(runId, event);
    this.emitLiveEvent(persisted);
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

  private async persistRunnerEvent(
    runId: string,
    event: FakeAgentRunnerEvent
  ): Promise<RunEvent> {
    const sequence = await this.events.countByRunId(runId);
    const createdAt = this.context.now();
    const message = eventMessage(event);
    const coreEvent = await this.events.create(
      validateRunEvent({
        id: this.context.nextId("event"),
        taskRunId: runId,
        sequence,
        type: toCoreRunEventType(event.type),
        message,
        metadata: {
          ...event.payload,
          desktopEventType: event.type
        },
        createdAt
      })
    );
    return toRunEvent(coreEvent);
  }

  private async persistVerification(
    runId: string,
    payload: RunEventPayload
  ): Promise<void> {
    const now = this.context.now();
    await this.verification.create(
      validateVerificationResult({
        id: this.context.nextId("verification"),
        taskRunId: runId,
        command:
          typeof payload.command === "string"
            ? payload.command
            : "pnpm test -- simulated",
        status: payload.passed === false ? "failed" : "passed",
        exitCode: payload.passed === false ? 1 : 0,
        stdout:
          typeof payload.message === "string"
            ? payload.message
            : "Simulated verification completed.",
        startedAt: now,
        completedAt: now,
        createdAt: now
      })
    );
  }

  private async persistConversationBrief(
    runId: string,
    brief: ParsedCreateRunInput["conversationBrief"]
  ): Promise<void> {
    const artifact = conversationBriefArtifact(brief);
    if (!artifact) {
      return;
    }
    await this.artifacts.create(
      validateRunArtifact({
        id: this.context.nextId("artifact"),
        taskRunId: runId,
        kind: "conversation_brief",
        content: artifact.content,
        metadata: artifact.metadata,
        createdAt: this.context.now()
      })
    );
  }

  private async persistTerminalReview(
    runId: string,
    status: "completed" | "failed" | "cancelled"
  ): Promise<void> {
    const now = this.context.now();
    await this.artifacts.create(
      validateRunArtifact({
        id: this.context.nextId("artifact"),
        taskRunId: runId,
        kind: "git_diff",
        content: "No real files were modified by this desktop run.\n",
        metadata: {
          changedFiles: [],
          fileSummaries: [],
          placeholder: true,
          stat: {
            filesChanged: 0,
            insertions: 0,
            deletions: 0,
            text: "0 files changed"
          },
          source: "desktop_fake_run",
          terminalStatus: status
        },
        createdAt: now
      })
    );

    await this.risks.create(
      validateRiskReport({
        id: this.context.nextId("risk"),
        taskRunId: runId,
        level: status === "failed" ? "medium" : "low",
        summary:
          status === "completed"
            ? "Desktop run completed without repository changes."
            : status === "cancelled"
              ? "Desktop run was cancelled without repository changes."
              : "Desktop run failed before making repository changes.",
        changedFiles: [],
        verificationSummary:
          status === "completed"
            ? "Simulated verification passed."
            : "No completed verification output is available.",
        failedChecks: status === "failed" ? ["desktop fake run failed"] : [],
        riskFactors: ["This desktop execution path did not modify project files."],
        manualReviewChecklist: [
          "No code was generated or applied by this desktop run."
        ],
        acceptanceRecommendation:
          "Review only. This desktop run did not produce changes to accept, merge, push, or export.",
        findings: [],
        createdAt: now
      })
    );
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
    await this.applyRunnerEvent(runId, {
      type: "run_failed",
      payload: {
        phase: "final",
        status: "failed",
        message: error instanceof Error ? error.message : String(error)
      }
    });
  }

  private toRunSummary(
    run: TaskRun,
    task: Task,
    project: { id: string; name: string },
    events: CoreRunEvent[] = []
  ): RunSummary {
    const eventUpdatedAt = events.at(-1)?.createdAt;
    return {
      id: run.id,
      projectId: project.id,
      projectName: project.name,
      taskId: task.id,
      title: task.title,
      taskPrompt: task.description ?? "",
      agentId: toAgentId(run.agentKind),
      status: this.currentDesktopStatus(run),
      createdAt: run.createdAt,
      updatedAt: eventUpdatedAt ?? run.updatedAt
    };
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
  return {
    projectId: input.projectId,
    prompt,
    title: input.title?.trim() || titleFromPrompt(prompt),
    agentId,
    contextMode,
    deliveryMode,
    conversationBrief: input.conversationBrief
  };
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
    return "run_completed";
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

function eventMessage(event: FakeAgentRunnerEvent): string {
  if (typeof event.payload.message === "string") {
    return event.payload.message;
  }
  if (typeof event.payload.summary === "string") {
    return event.payload.summary;
  }
  return event.type.replaceAll("_", " ");
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

function conversationBriefArtifact(
  brief: ParsedCreateRunInput["conversationBrief"]
): { content: string; metadata: JsonObject } | undefined {
  if (brief === undefined) {
    return undefined;
  }
  if (typeof brief === "string") {
    const content = brief.trim();
    return content.length > 0
      ? {
          content: `${content}\n`,
          metadata: {
            source: "desktop_thread_service",
            characterCount: content.length
          }
        }
      : undefined;
  }
  const content = brief.renderedContent.trim();
  return content.length > 0
    ? {
        content: `${content}\n`,
        metadata: {
          source: "desktop_thread_service",
          ...brief.metadata
        }
      }
    : undefined;
}

function isTerminalEvent(type: RunEventType): boolean {
  return type === "run_completed" || type === "run_failed" || type === "run_cancelled";
}

function eventChannel(runId: string): string {
  return `run:${runId}`;
}
