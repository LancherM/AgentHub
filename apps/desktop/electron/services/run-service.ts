import {
  createId,
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
  type TaskRepository,
  type TaskRunRepository,
  type VerificationResultRepository
} from "@agent-hub/core";
import type { AgentKind, JsonObject } from "@agent-hub/shared";
import type {
  CreateRunInput,
  RunDetail,
  RunEvent,
  RunSummary
} from "../../src/lib/types";
import type { DesktopServiceContext } from "./project-service";
import type { MemoryService } from "./memory-service";
import type { ReviewService } from "./review-service";

export interface RunService {
  list(projectId?: string): Promise<RunSummary[]>;
  get(runId: string): Promise<RunDetail>;
  create(input: CreateRunInput): Promise<RunSummary>;
  cancel(runId: string): Promise<void>;
}

export interface RunServiceDependencies {
  reviewService: ReviewService;
  memoryService: MemoryService;
}

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

  async list(projectId?: string): Promise<RunSummary[]> {
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
        return toRunSummary(run, task, project);
      })
    );
    return summaries
      .filter((summary): summary is RunSummary => summary !== undefined)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async get(runId: string): Promise<RunDetail> {
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
    const summary = finalSummary(events) ?? risk.summary;
    return {
      ...toRunSummary(run, task, project),
      events: events.map(toRunEvent),
      changedFiles: diff.changedFiles,
      verification,
      risk,
      memoryProposals,
      summary
    };
  }

  async create(input: CreateRunInput): Promise<RunSummary> {
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
        title: parsed.title ?? titleFromPrompt(parsed.prompt),
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
        agentKind: parsed.agentKind,
        status: "queued",
        createdAt,
        updatedAt: createdAt
      })
    );

    await this.tasks.updateStatus(task.id, "running", this.context.now());
    await this.runs.updateStatus(run.id, "running", this.context.now());

    const persistedEvents = await this.events.createMany(
      desktopRunEvents({
        runId: run.id,
        taskId: task.id,
        agentKind: parsed.agentKind,
        prompt: parsed.prompt,
        contextMode: parsed.contextMode,
        deliveryMode: parsed.deliveryMode,
        now: () => this.context.now(),
        nextId: (prefix) => this.context.nextId(prefix)
      })
    );

    await this.artifacts.create(
      validateRunArtifact({
        id: this.context.nextId("artifact"),
        taskRunId: run.id,
        kind: "git_diff",
        content: "Unified diff is not available for the desktop fake run.\n",
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
          source: "desktop_fake_run"
        },
        createdAt: this.context.now()
      })
    );

    await this.verification.create(
      validateVerificationResult({
        id: this.context.nextId("verification"),
        taskRunId: run.id,
        command: "desktop fake run",
        status: "skipped",
        stdout: "No verification command was configured for the first desktop shell.",
        createdAt: this.context.now()
      })
    );

    await this.risks.create(
      validateRiskReport({
        id: this.context.nextId("risk"),
        taskRunId: run.id,
        level: "low",
        summary: "Desktop fake run recorded no repository changes.",
        changedFiles: [],
        verificationSummary: "Verification was skipped.",
        failedChecks: [],
        riskFactors: ["Real adapter execution is not wired in this desktop slice."],
        manualReviewChecklist: [
          "Inspect run events before acting on any future generated changes."
        ],
        acceptanceRecommendation:
          "Review only. This desktop slice does not accept, merge, push, or export repository context.",
        findings: [],
        createdAt: this.context.now()
      })
    );

    const completedAt = this.context.now();
    const completedRun = await this.runs.updateStatus(
      run.id,
      "succeeded",
      completedAt
    );
    const completedTask = await this.tasks.updateStatus(
      task.id,
      "completed",
      completedAt
    );
    return toRunSummary(completedRun, completedTask, project, persistedEvents);
  }

  async cancel(runId: string): Promise<void> {
    const run = await this.runs.get(runId);
    if (!run) {
      throw new Error(`run ${runId} not found`);
    }
    if (["succeeded", "failed", "cancelled"].includes(run.status)) {
      return;
    }
    const cancelledAt = this.context.now();
    await this.runs.updateStatus(run.id, "cancelled", cancelledAt);
    const task = await this.tasks.get(run.taskId);
    if (task?.status === "running") {
      await this.tasks.updateStatus(task.id, "open", cancelledAt);
    }
    const sequence = await this.events.countByRunId(run.id);
    await this.events.create(
      validateRunEvent({
        id: this.context.nextId("event"),
        taskRunId: run.id,
        sequence,
        type: "status",
        message: "Run cancelled from Agent Hub Desktop.",
        metadata: { phase: "final" },
        createdAt: cancelledAt
      })
    );
  }
}

interface DesktopRunEventInput {
  runId: string;
  taskId: string;
  agentKind: AgentKind;
  prompt: string;
  contextMode: string;
  deliveryMode: "runtime_injection" | "worktree_overlay";
  now(): string;
  nextId(prefix: string): string;
}

function desktopRunEvents(input: DesktopRunEventInput): CoreRunEvent[] {
  const base: Array<{
    type: CoreRunEvent["type"];
    message: string;
    metadata: JsonObject;
  }> = [
    {
      type: "status",
      message: `Context prepared with ${input.deliveryMode}.`,
      metadata: { phase: "context", contextMode: input.contextMode }
    },
    {
      type: "message",
      message: agentPlan(input.agentKind),
      metadata: { phase: "plan" }
    },
    {
      type: "stdout",
      message: "Desktop fake run completed without modifying repository files.",
      metadata: { phase: "logs", adapter: "desktop-fake" }
    },
    {
      type: "status",
      message: "Verification skipped because no command was configured.",
      metadata: { phase: "verification" }
    },
    {
      type: "message",
      message:
        "Final summary: first desktop shell recorded a local run review record and left the target repository unchanged.",
      metadata: { phase: "final" }
    },
    {
      type: "exit",
      message: "desktop fake run completed",
      metadata: { phase: "final", exitCode: 0 }
    }
  ];

  return base.map((event, sequence) =>
    validateRunEvent({
      id: input.nextId("event"),
      taskRunId: input.runId,
      sequence,
      type: event.type,
      message: event.message,
      metadata: {
        ...event.metadata,
        taskId: input.taskId,
        promptPreview: input.prompt.slice(0, 160)
      },
      createdAt: input.now()
    })
  );
}

function agentPlan(agentKind: AgentKind): string {
  if (agentKind === "fake") {
    return "Use the local fake path to validate Desktop review surfaces without changing the repository.";
  }
  return `${agentLabel(agentKind)} process execution is intentionally deferred in Desktop; this first shell records the request through the fake local path.`;
}

function parseCreateRunInput(input: CreateRunInput): Required<CreateRunInput> {
  if (!input || typeof input !== "object") {
    throw new Error("run input is required");
  }
  const prompt = input.prompt?.trim();
  if (!prompt) {
    throw new Error("run prompt is required");
  }
  const agentKind = parseAgentKind(input.agentKind);
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
    agentKind,
    contextMode,
    deliveryMode
  };
}

function parseAgentKind(value: unknown): AgentKind {
  if (value === "fake" || value === "codex" || value === "claude-code") {
    return value;
  }
  throw new Error("agentKind must be fake, codex, or claude-code");
}

function parseContextMode(value: unknown): "auto" | "minimal" | "full" {
  if (value === "auto" || value === "minimal" || value === "full") {
    return value;
  }
  throw new Error("contextMode must be auto, minimal, or full");
}

function toRunSummary(
  run: {
    id: string;
    taskId: string;
    agentKind: AgentKind;
    status: RunSummary["status"];
    createdAt: string;
    updatedAt: string;
  },
  task: {
    id: string;
    projectId: string;
    title: string;
    description?: string;
  },
  project: {
    id: string;
    name: string;
  },
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
    agentKind: run.agentKind,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: eventUpdatedAt ?? run.updatedAt
  };
}

function toRunEvent(event: CoreRunEvent): RunEvent {
  return {
    id: event.id,
    runId: event.taskRunId,
    sequence: event.sequence,
    type: event.type,
    message: event.message,
    metadata: event.metadata,
    createdAt: event.createdAt
  };
}

function titleFromPrompt(prompt: string): string {
  const firstLine = prompt.trim().split(/\r?\n/, 1)[0] ?? "";
  return firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;
}

function finalSummary(events: CoreRunEvent[]): string | undefined {
  return [...events]
    .reverse()
    .find((event) => event.metadata.phase === "final" && event.type === "message")
    ?.message.replace(/^Final summary:\s*/, "");
}

function agentLabel(agentKind: AgentKind): string {
  switch (agentKind) {
    case "codex":
      return "Codex";
    case "claude-code":
      return "Claude Code";
    case "fake":
      return "Fake";
    default:
      return String(agentKind);
  }
}
