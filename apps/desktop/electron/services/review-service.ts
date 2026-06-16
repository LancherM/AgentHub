import fs from "node:fs/promises";
import path from "node:path";
import {
  buildExecutionTraceGraph,
  validateRunArtifact,
  type ExecutionTraceGraph,
  type MemoryItemRepository,
  type RunArtifact,
  type RunArtifactRepository,
  type RunEvent as CoreRunEvent,
  type RiskReport as CoreRiskReport,
  type RiskReportRepository,
  type RunEventRepository,
  type RunMetadata,
  type RunMetadataRepository,
  type Task,
  type TaskRepository,
  type TaskRun,
  type TaskRunRepository,
  type VerificationResultRepository
} from "@agent-hub/core";
import type { JsonObject, TaskRunStatus } from "@agent-hub/shared";
import {
  applyMemoryAutomationForRun,
  isWorkspacePathInside
} from "@agent-hub/task-runner";
import type {
  AgentId,
  DiffSummary,
  HandoffCopyKind,
  ReviewArtifact,
  ReviewContext,
  ReviewHandoff,
  ReviewHandoffActionResult,
  ReviewStatus,
  ReviewSummary,
  RiskCategory,
  RiskReport,
  RiskSeverity,
  RunLog,
  RunLogLevel,
  RunStatus,
  VerificationReport
} from "../../src/lib/types";
import { createDiffService, type DiffService } from "./diff-service";
import { createRiskService, type RiskService } from "./risk-service";
import type { MemoryService } from "./memory-service";
import type { DesktopServiceContext } from "./project-service";

const REVIEW_DECISION_ARTIFACT_KIND = "review_decision";
const CONVERSATION_BRIEF_ARTIFACT_KIND = "conversation_brief";
const MAX_ARTIFACT_PREVIEW_CHARS = 4_000;
const MAX_LOG_ROWS = 1_000;
const MAX_LOG_MESSAGE_CHARS = 12_000;

export interface ReviewService {
  getSummary(runId: string): Promise<ReviewSummary>;
  getContext(runId: string): Promise<ReviewContext>;
  getArtifacts(runId: string): Promise<ReviewArtifact[]>;
  getDiff(runId: string): Promise<DiffSummary>;
  getRisk(runId: string): Promise<RiskReport>;
  getVerification(runId: string): Promise<VerificationReport>;
  getExecutionTrace(runId: string): Promise<ExecutionTraceGraph>;
  getLogs(runId: string): Promise<RunLog[]>;
  getHandoff(runId: string): Promise<ReviewHandoff>;
  openHandoffWorktree(runId: string): Promise<ReviewHandoffActionResult>;
  copyHandoffValue(
    runId: string,
    kind: HandoffCopyKind
  ): Promise<ReviewHandoffActionResult>;
  acceptRun(runId: string): Promise<ReviewSummary>;
  rejectRun(runId: string, reason?: string): Promise<ReviewSummary>;
  refreshReview(runId: string): Promise<ReviewSummary>;
}

export interface ReviewHandoffPlatform {
  openPath(worktreePath: string): Promise<string>;
  writeText(text: string): Promise<void> | void;
}

export function createReviewService(
  context: DesktopServiceContext,
  dependencies: {
    diffService?: DiffService;
    riskService?: RiskService;
    memoryService?: MemoryService;
    handoffPlatform?: ReviewHandoffPlatform;
  } = {}
): ReviewService {
  return new RepositoryReviewService(context, {
    diffService: dependencies.diffService ?? createDiffService(context),
    riskService: dependencies.riskService ?? createRiskService(),
    memoryService: dependencies.memoryService,
    handoffPlatform: dependencies.handoffPlatform
  });
}

class RepositoryReviewService implements ReviewService {
  private readonly runs: TaskRunRepository;
  private readonly tasks: TaskRepository;
  private readonly events: RunEventRepository;
  private readonly artifacts: RunArtifactRepository;
  private readonly verification: VerificationResultRepository;
  private readonly memory: MemoryItemRepository;
  private readonly risks: RiskReportRepository;
  private readonly metadata: RunMetadataRepository;

  constructor(
    private readonly context: DesktopServiceContext,
    private readonly dependencies: {
      diffService: DiffService;
      riskService: RiskService;
      memoryService?: MemoryService;
      handoffPlatform?: ReviewHandoffPlatform;
    }
  ) {
    this.runs = context.repositories.taskRunRepository;
    this.tasks = context.repositories.taskRepository;
    this.events = context.repositories.runEventRepository;
    this.artifacts = context.repositories.runArtifactRepository;
    this.verification = context.repositories.verificationResultRepository;
    this.memory = context.repositories.memoryItemRepository;
    this.risks = context.repositories.riskReportRepository;
    this.metadata = context.repositories.runMetadataRepository;
  }

  async getSummary(runId: string): Promise<ReviewSummary> {
    const { run, task } = await this.requireRunAndTask(runId);
    const [diff, verification, risk, events, decision, memoryProposalCount] =
      await Promise.all([
        this.getDiff(runId),
        this.getVerification(runId),
        this.getRisk(runId),
        this.events.listByRunId(runId),
        this.getReviewDecision(runId),
        this.countMemoryProposals(runId, task)
      ]);
    const additions = diff.files.reduce((sum, file) => sum + file.additions, 0);
    const deletions = diff.files.reduce((sum, file) => sum + file.deletions, 0);
    const finalMessage = finalSummary(events) ?? diff.message ?? statusSummary(run);
    return {
      runId,
      agentId: toAgentId(run.agentKind),
      status: toDesktopRunStatus(run.status),
      task: task.description ?? task.title,
      summary: finalMessage,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      durationMs: durationMs(run.startedAt, run.completedAt),
      changedFileCount: diff.files.length,
      additions,
      deletions,
      verificationStatus: verification.status,
      riskLevel: risk.level,
      memoryProposalCount,
      acceptedAt: decision.acceptedAt,
      rejectedAt: decision.rejectedAt,
      reviewStatus: decision.reviewStatus,
      parentRunId: run.parentRunId,
      parentMessageId: run.parentMessageId,
      message: decision.message ?? diff.message
    };
  }

  async getDiff(runId: string): Promise<DiffSummary> {
    await this.requireRunAndTask(runId);
    return this.dependencies.diffService.getDiff(runId);
  }

  async getContext(runId: string): Promise<ReviewContext> {
    await this.requireRunAndTask(runId);
    const artifact = await this.artifacts.getLatestByRunIdAndKind(
      runId,
      CONVERSATION_BRIEF_ARTIFACT_KIND
    );
    if (!artifact) {
      return {
        runId,
        available: false,
        message: "No persisted conversation brief is available for this run."
      };
    }
    return {
      runId,
      available: true,
      content: artifact.content,
      artifactId: artifact.id,
      createdAt: artifact.createdAt,
      message: "Conversation brief captured for runtime injection."
    };
  }

  async getArtifacts(runId: string): Promise<ReviewArtifact[]> {
    const { run, task } = await this.requireRunAndTask(runId);
    const [artifacts, metadata] = await Promise.all([
      this.artifacts.listByRunId(runId),
      this.metadata.get(runId)
    ]);
    return artifacts.map((artifact) =>
      toReviewArtifact({
        artifact,
        run,
        task,
        metadata
      })
    );
  }

  async getRisk(runId: string): Promise<RiskReport> {
    const { run } = await this.requireRunAndTask(runId);
    if (run.status !== "queued" && run.status !== "running") {
      const persistedRisk = await this.risks.getLatestByRunId(runId);
      if (persistedRisk && !isDesktopPlaceholderRisk(persistedRisk)) {
        return toDesktopRiskReport(persistedRisk);
      }
    }

    const [diff, verification] = await Promise.all([
      this.getDiff(runId),
      this.getVerification(runId)
    ]);
    return this.dependencies.riskService.getRisk({
      runId,
      diff,
      verification,
      generatedAt: this.context.now()
    });
  }

  async getVerification(runId: string): Promise<VerificationReport> {
    await this.requireRunAndTask(runId);
    const results = await this.verification.listByRunId(runId);
    if (results.length === 0) {
      return {
        runId,
        status: "skipped",
        commands: [],
        message: "No verification command was configured or recorded for this run."
      };
    }
    if (results.every(isMissingVerificationConfigResult)) {
      return {
        runId,
        status: "skipped",
        commands: [],
        message: "No verification commands were configured."
      };
    }

    const failed = results.filter((result) => result.status === "failed");
    const passed = results.filter((result) => result.status === "passed");
    const skipped = results.filter((result) => result.status === "skipped");
    return {
      runId,
      status: failed.length > 0 ? "failed" : passed.length > 0 ? "passed" : "skipped",
      commands: results.map((result) => ({
        command: result.command,
        status: result.status,
        exitCode: result.exitCode,
        durationMs: durationMs(result.startedAt, result.completedAt),
        stdout: result.stdout,
        stderr: result.stderr
      })),
      message: `${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped`
    };
  }

  async getExecutionTrace(runId: string): Promise<ExecutionTraceGraph> {
    await this.requireRunAndTask(runId);
    return buildExecutionTraceGraph(this.context.repositories, {
      runId
    });
  }

  async getLogs(runId: string): Promise<RunLog[]> {
    await this.requireRunAndTask(runId);
    const events = await this.events.listByRunId(runId);
    const logs = events.slice(-MAX_LOG_ROWS).map(toRunLog);
    if (events.length > MAX_LOG_ROWS) {
      return [
        {
          id: `log_truncated_${runId}`,
          runId,
          timestamp: events[events.length - MAX_LOG_ROWS]?.createdAt ?? new Date().toISOString(),
          level: "debug",
          message: `${events.length - MAX_LOG_ROWS} earlier log row(s) omitted from this bounded inspector view.`
        },
        ...logs
      ];
    }
    return logs;
  }

  async getHandoff(runId: string): Promise<ReviewHandoff> {
    const { run } = await this.requireRunAndTask(runId);
    const metadata = await this.metadata.get(runId);
    const unavailable = await validateHandoffAvailability(run, metadata);
    if (unavailable) {
      return unavailable;
    }

    const diff = await this.getDiff(runId);
    const worktreePath = resolvedWorktreePath(run, metadata);
    if (!worktreePath) {
      throw new Error(`run ${runId} has no retained worktree path`);
    }
    const branchName = run.branchName ?? metadata?.workspace?.branchName;
    const baseRef = metadata?.workspace?.startPoint ?? diff.baseRef ?? "HEAD";
    const headRef = branchName ?? diff.headRef;
    const commands = reviewCommands(worktreePath);
    return {
      runId,
      available: true,
      worktreePath,
      branchName,
      baseRef,
      headRef,
      cleanup: cleanupState(metadata),
      changedFiles: diff.files,
      commands,
      message:
        "Review this retained worktree manually. Agent Hub will not merge, push, apply, or delete it."
    };
  }

  async openHandoffWorktree(
    runId: string
  ): Promise<ReviewHandoffActionResult> {
    const handoff = await this.getHandoff(runId);
    if (!handoff.available || !handoff.worktreePath) {
      return {
        ok: false,
        message: handoff.message ?? "No retained worktree is available."
      };
    }
    if (!this.dependencies.handoffPlatform) {
      return {
        ok: false,
        message: "Opening retained worktrees is unavailable in this environment."
      };
    }

    const error = await this.dependencies.handoffPlatform.openPath(
      handoff.worktreePath
    );
    if (error.trim().length > 0) {
      return { ok: false, message: error };
    }
    return {
      ok: true,
      message: "Opened retained worktree. No merge, push, or cleanup was performed."
    };
  }

  async copyHandoffValue(
    runId: string,
    kind: HandoffCopyKind
  ): Promise<ReviewHandoffActionResult> {
    const handoff = await this.getHandoff(runId);
    if (!handoff.available) {
      return {
        ok: false,
        message: handoff.message ?? "No retained worktree is available."
      };
    }
    if (!this.dependencies.handoffPlatform) {
      return {
        ok: false,
        message: "Copying handoff values is unavailable in this environment."
      };
    }

    const value = handoffCopyValue(handoff, kind);
    if (!value) {
      return {
        ok: false,
        message: `No ${kind.replace(/_/g, " ")} is available for this run.`
      };
    }
    await this.dependencies.handoffPlatform.writeText(value);
    return {
      ok: true,
      message: `Copied ${kind.replace(/_/g, " ")}. No repository action was performed.`
    };
  }

  async acceptRun(runId: string): Promise<ReviewSummary> {
    await this.requireRunAndTask(runId);
    const acceptedAt = this.context.now();
    const automation = await applyMemoryAutomationForRun(
      {
        taskRunRepository: this.runs,
        taskRepository: this.tasks,
        projectRepository: this.context.repositories.projectRepository,
        settingsRepository: this.context.repositories.settingsRepository,
        memoryItemRepository: this.memory,
        verificationResultRepository: this.verification,
        riskReportRepository: this.risks
      },
      {
        runId,
        trigger: "review_accepted",
        now: () => acceptedAt,
        agentHubHome: this.context.agentHubHome
      }
    );
    const automationEnabled = automation.policy.mode === "auto_after_review_accept";
    await this.artifacts.create(
      validateRunArtifact({
        id: this.context.nextId("review"),
        taskRunId: runId,
        kind: REVIEW_DECISION_ARTIFACT_KIND,
        content: automationEnabled
          ? `Accepted for record. No merge was performed.\nMemory automation: auto-approved ${automation.autoApproved.length}; skipped ${automation.skipped.length}.`
          : "Accepted for record. No merge was performed.",
        metadata: {
          reviewStatus: "accepted",
          acceptedAt,
          ...(automationEnabled
            ? {
                memoryAutomation: {
                  policyMode: automation.policy.mode,
                  autoApproved: automation.autoApproved.length,
                  skipped: automation.skipped.length
                }
              }
            : {})
        },
        createdAt: acceptedAt
      })
    );
    return this.getSummary(runId);
  }

  async rejectRun(runId: string, reason?: string): Promise<ReviewSummary> {
    await this.requireRunAndTask(runId);
    const rejectedAt = this.context.now();
    await this.artifacts.create(
      validateRunArtifact({
        id: this.context.nextId("review"),
        taskRunId: runId,
        kind: REVIEW_DECISION_ARTIFACT_KIND,
        content: "Rejected for record. No files were deleted or reverted.",
        metadata: {
          reviewStatus: "rejected",
          rejectedAt,
          reason
        },
        createdAt: rejectedAt
      })
    );
    return this.getSummary(runId);
  }

  async refreshReview(runId: string): Promise<ReviewSummary> {
    return this.getSummary(runId);
  }

  private async requireRunAndTask(
    runId: string
  ): Promise<{ run: TaskRun; task: Task }> {
    const run = await this.runs.get(runId);
    if (!run) {
      throw new Error(`run ${runId} not found`);
    }
    const task = await this.tasks.get(run.taskId);
    if (!task) {
      throw new Error(`task ${run.taskId} not found`);
    }
    return { run, task };
  }

  private async countMemoryProposals(runId: string, task: Task): Promise<number> {
    if (this.dependencies.memoryService) {
      return (await this.dependencies.memoryService.listProposals(runId)).length;
    }
    const items = await this.memory.listByProjectId(task.projectId);
    return items.filter((item) => item.taskId === task.id).length;
  }

  private async getReviewDecision(runId: string): Promise<{
    reviewStatus: ReviewStatus;
    acceptedAt?: string;
    rejectedAt?: string;
    message?: string;
  }> {
    const artifact =
      await this.artifacts.getLatestByRunIdAndKind(
        runId,
        REVIEW_DECISION_ARTIFACT_KIND
      );
    const metadata = artifact?.metadata as JsonObject | undefined;
    if (metadata?.reviewStatus === "accepted") {
      return {
        reviewStatus: "accepted",
        acceptedAt:
          typeof metadata.acceptedAt === "string" ? metadata.acceptedAt : artifact?.createdAt,
        message: artifact?.content
      };
    }
    if (metadata?.reviewStatus === "rejected") {
      return {
        reviewStatus: "rejected",
        rejectedAt:
          typeof metadata.rejectedAt === "string" ? metadata.rejectedAt : artifact?.createdAt,
        message: artifact?.content
      };
    }
    return { reviewStatus: "pending" };
  }
}

function toReviewArtifact(input: {
  artifact: RunArtifact;
  run: TaskRun;
  task: Task;
  metadata: RunMetadata | undefined;
}): ReviewArtifact {
  const artifactMetadata = input.artifact.metadata as JsonObject;
  const preview = reviewArtifactPreview(input.artifact);
  const threadId =
    stringMetadata(artifactMetadata, "threadId") ??
    stringMetadata(artifactMetadata, "thread_id") ??
    parseArtifactLine(input.artifact.content, "thread_id");
  const createdBy =
    stringMetadata(artifactMetadata, "createdBy") ??
    roleHandle(input.metadata) ??
    `@${toAgentId(input.run.agentKind)}`;
  return {
    id: input.artifact.id,
    runId: input.run.id,
    taskId: input.task.id,
    kind: input.artifact.kind,
    artifactType: artifactType(input.artifact.kind),
    title: artifactTitle(input.artifact, input.task),
    sourceRunId: input.run.id,
    sourceTaskId: input.task.id,
    threadId,
    createdBy,
    summary: artifactSummary(input.artifact),
    createdAt: input.artifact.createdAt,
    availability: preview.truncated ? "bounded" : "local",
    contentPreview: preview.content,
    contentCharacters: input.artifact.content.length,
    previewCharacters: preview.content.length,
    truncated: preview.truncated
  };
}

function reviewArtifactPreview(artifact: RunArtifact): {
  content: string;
  truncated: boolean;
} {
  if (artifact.kind !== "git_diff") {
    return boundedArtifactPreview(artifact.content);
  }
  const sensitivePaths = sensitivePatchPaths(
    artifact.content,
    artifactChangedPaths(artifact.metadata as JsonObject)
  );
  if (sensitivePaths.length > 0) {
    return {
      content: `Patch redacted because sensitive file path changed: ${sensitivePaths.join(", ")}`,
      truncated: false
    };
  }
  return boundedArtifactPreview(artifact.content);
}

function boundedArtifactPreview(content: string): {
  content: string;
  truncated: boolean;
} {
  if (content.length <= MAX_ARTIFACT_PREVIEW_CHARS) {
    return { content, truncated: false };
  }
  return {
    content: `${content.slice(0, MAX_ARTIFACT_PREVIEW_CHARS)}\n[Artifact preview truncated after ${MAX_ARTIFACT_PREVIEW_CHARS} characters.]`,
    truncated: true
  };
}

function artifactChangedPaths(metadata: JsonObject): string[] {
  const changedFiles = metadata.changedFiles;
  if (!Array.isArray(changedFiles)) {
    return [];
  }
  return changedFiles.flatMap((entry) => {
    if (typeof entry === "string") {
      return [entry];
    }
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const filePath = (entry as Record<string, unknown>).path;
    return typeof filePath === "string" ? [filePath] : [];
  });
}

function sensitivePatchPaths(patch: string, changedPaths: string[]): string[] {
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

function artifactType(kind: string): string {
  switch (kind) {
    case CONVERSATION_BRIEF_ARTIFACT_KIND:
      return "context";
    case "git_diff":
      return "diff";
    case REVIEW_DECISION_ARTIFACT_KIND:
      return "review";
    case "task_brief":
      return "brief";
    case "code_state_provenance":
      return "provenance";
    default:
      return "artifact";
  }
}

function artifactTitle(artifact: RunArtifact, task: Task): string {
  const metadataTitle = stringMetadata(artifact.metadata as JsonObject, "title");
  if (metadataTitle) {
    return metadataTitle;
  }
  switch (artifact.kind) {
    case CONVERSATION_BRIEF_ARTIFACT_KIND:
      return `Conversation brief for ${task.title}`;
    case "git_diff":
      return `Bounded diff for ${task.title}`;
    case REVIEW_DECISION_ARTIFACT_KIND:
      return "Review decision record";
    case "task_brief":
      return `Task brief for ${task.title}`;
    case "code_state_provenance":
      return "Continuation provenance";
    default:
      return readableArtifactKind(artifact.kind);
  }
}

function artifactSummary(artifact: RunArtifact): string {
  const metadata = artifact.metadata as JsonObject;
  const metadataSummary = stringMetadata(metadata, "summary");
  if (metadataSummary) {
    return metadataSummary;
  }
  if (artifact.kind === "git_diff") {
    const changedFiles = Array.isArray(metadata.changedFiles)
      ? metadata.changedFiles.length
      : undefined;
    const stat = stringMetadata(metadata, "stat");
    if (changedFiles !== undefined) {
      return stat
        ? `${changedFiles} changed file(s). ${stat}`
        : `${changedFiles} changed file(s).`;
    }
    return "Bounded diff artifact for this run.";
  }
  if (artifact.kind === CONVERSATION_BRIEF_ARTIFACT_KIND) {
    return "Runtime context snapshot injected into the agent.";
  }
  if (artifact.kind === REVIEW_DECISION_ARTIFACT_KIND) {
    return firstContentLine(artifact.content) ?? "Audit-only review decision.";
  }
  if (artifact.kind === "task_brief") {
    return "Generated task brief for this run.";
  }
  if (artifact.kind === "code_state_provenance") {
    return "Continuation source and parent run metadata.";
  }
  return firstContentLine(artifact.content) ?? "Local run artifact.";
}

function readableArtifactKind(kind: string): string {
  return kind
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function firstContentLine(content: string): string | undefined {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
}

function stringMetadata(metadata: JsonObject, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function parseArtifactLine(content: string, key: string): string | undefined {
  const prefix = `${key}:`;
  const line = content
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith(prefix));
  const value = line?.trim().slice(prefix.length).trim();
  return value && value.length > 0 ? value : undefined;
}

function roleHandle(metadata: RunMetadata | undefined): string | undefined {
  return metadata?.role?.roleHandle ? `@${metadata.role.roleHandle}` : undefined;
}

function isMissingVerificationConfigResult(result: {
  command: string;
  status: string;
}): boolean {
  return result.command === "not configured" && result.status === "skipped";
}

async function validateHandoffAvailability(
  run: TaskRun,
  metadata: RunMetadata | undefined
): Promise<ReviewHandoff | undefined> {
  const cleanup = cleanupState(metadata);
  const unavailable = (message: string): ReviewHandoff => ({
    runId: run.id,
    available: false,
    branchName: run.branchName ?? metadata?.workspace?.branchName,
    cleanup,
    changedFiles: [],
    commands: [],
    message
  });

  if (cleanup.cleaned === true) {
    return unavailable("The retained worktree was already cleaned up.");
  }
  if (cleanup.retained !== true) {
    return unavailable("Run metadata does not record a retained worktree.");
  }

  const worktreePath = resolvedWorktreePath(run, metadata);
  if (!worktreePath || !path.isAbsolute(worktreePath)) {
    return unavailable("Run has no absolute retained worktree path.");
  }
  if (
    metadata?.workspace?.path &&
    path.resolve(worktreePath) !== path.resolve(metadata.workspace.path)
  ) {
    return unavailable(
      "Run worktree metadata does not match the retained worktree path."
    );
  }
  if (
    metadata?.workspace?.workspaceBasePath &&
    !isWorkspacePathInside(worktreePath, metadata.workspace.workspaceBasePath)
  ) {
    return unavailable(
      "Run worktree path is outside the recorded Agent Hub workspace base."
    );
  }
  if (!(await directoryExists(worktreePath))) {
    return unavailable("The retained worktree path no longer exists.");
  }
  return undefined;
}

function cleanupState(metadata: RunMetadata | undefined): ReviewHandoff["cleanup"] {
  return {
    retained: metadata?.workspaceCleanup?.retained,
    cleaned: metadata?.workspaceCleanup?.cleaned,
    reason: metadata?.workspaceCleanup?.reason
  };
}

function resolvedWorktreePath(
  run: TaskRun,
  metadata: RunMetadata | undefined
): string | undefined {
  return run.worktreePath ?? metadata?.workspace?.path;
}

function reviewCommands(
  worktreePath: string
): ReviewHandoff["commands"] {
  const cwd = quoteForShell(worktreePath);
  return [
    {
      label: "Show status",
      command: `git -C ${cwd} status --short`
    },
    {
      label: "Show diff stat",
      command: `git -C ${cwd} diff --stat HEAD`
    },
    {
      label: "Show full diff",
      command: `git -C ${cwd} diff HEAD`
    }
  ];
}

function quoteForShell(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function handoffCopyValue(
  handoff: ReviewHandoff,
  kind: HandoffCopyKind
): string | undefined {
  if (kind === "worktree_path") {
    return handoff.worktreePath;
  }
  if (kind === "branch_name") {
    return handoff.branchName;
  }
  if (kind === "review_commands") {
    return handoff.commands
      .map((command) => `${command.label}:\n${command.command}`)
      .join("\n\n");
  }
  return undefined;
}

async function directoryExists(directoryPath: string): Promise<boolean> {
  try {
    return (await fs.stat(directoryPath)).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function toDesktopRiskReport(report: CoreRiskReport): RiskReport {
  return {
    runId: report.taskRunId,
    level: report.level,
    findings: persistedRiskFindings(report),
    generatedAt: report.createdAt,
    message: [report.summary, report.acceptanceRecommendation]
      .filter((value) => value.trim().length > 0)
      .join(" ")
  };
}

function persistedRiskFindings(report: CoreRiskReport): RiskReport["findings"] {
  const findings = report.findings.map((finding, index) => ({
    id: `persisted_finding_${index + 1}`,
    severity: toDesktopRiskSeverity(finding.level),
    title: finding.summary,
    description: finding.details ?? finding.summary,
    evidence: finding.details,
    category: riskCategoryFromText(`${finding.summary} ${finding.details ?? ""}`)
  }));

  const existingEvidence = new Set(
    findings
      .flatMap((finding) => [
        finding.title,
        finding.description,
        finding.evidence
      ])
      .filter((value): value is string => typeof value === "string")
  );

  for (const [index, factor] of report.riskFactors.entries()) {
    if (existingEvidence.has(factor)) {
      continue;
    }
    findings.push({
      id: `persisted_risk_factor_${index + 1}`,
      severity: toDesktopRiskSeverity(report.level),
      title: "Persisted risk factor",
      description: factor,
      evidence: factor,
      category: riskCategoryFromText(factor)
    });
    existingEvidence.add(factor);
  }

  for (const [index, failedCheck] of report.failedChecks.entries()) {
    if (existingEvidence.has(failedCheck)) {
      continue;
    }
    findings.push({
      id: `persisted_failed_check_${index + 1}`,
      severity: report.level === "blocking" ? "blocking" : "high",
      title: "Persisted failed check",
      description: failedCheck,
      evidence: failedCheck,
      category: "test"
    });
    existingEvidence.add(failedCheck);
  }

  return findings;
}

function toDesktopRiskSeverity(level: CoreRiskReport["level"]): RiskSeverity {
  return level;
}

function riskCategoryFromText(text: string): RiskCategory {
  const lower = text.toLowerCase();
  if (lower.includes("auth")) {
    return "auth";
  }
  if (
    lower.includes("secret") ||
    lower.includes("token") ||
    lower.includes("key") ||
    lower.includes(".env") ||
    lower.includes("credential") ||
    lower.includes("dangerous")
  ) {
    return "security";
  }
  if (lower.includes("database") || lower.includes("data")) {
    return "data";
  }
  if (lower.includes("migration")) {
    return "migration";
  }
  if (
    lower.includes("dependency") ||
    lower.includes("lockfile") ||
    lower.includes("package")
  ) {
    return "dependency";
  }
  if (
    lower.includes("test") ||
    lower.includes("verification") ||
    lower.includes("check")
  ) {
    return "test";
  }
  if (lower.includes("config")) {
    return "config";
  }
  if (lower.includes("generated")) {
    return "generated";
  }
  if (lower.includes("large")) {
    return "large_change";
  }
  return "unknown";
}

function isDesktopPlaceholderRisk(report: CoreRiskReport): boolean {
  return (
    report.changedFiles.length === 0 &&
    report.findings.length === 0 &&
    report.riskFactors.includes(
      "This desktop execution path did not modify project files."
    )
  );
}

function toRunLog(event: CoreRunEvent): RunLog {
  const metadata = event.metadata as JsonObject;
  return {
    id: event.id,
    runId: event.taskRunId,
    timestamp: event.createdAt,
    level: toLogLevel(event.type, metadata),
    message: truncateLogMessage(
      typeof metadata.message === "string" ? metadata.message : event.message
    )
  };
}

function toLogLevel(type: CoreRunEvent["type"], metadata: JsonObject): RunLogLevel {
  if (type === "stdout") {
    return "stdout";
  }
  if (type === "stderr") {
    return "stderr";
  }
  if (type === "error") {
    return "error";
  }
  if (metadata.phase === "debug") {
    return "debug";
  }
  return "info";
}

function truncateLogMessage(message: string): string {
  if (message.length <= MAX_LOG_MESSAGE_CHARS) {
    return message;
  }
  return `${message.slice(0, MAX_LOG_MESSAGE_CHARS)}\n[Log message truncated after ${MAX_LOG_MESSAGE_CHARS} characters.]`;
}

function finalSummary(events: CoreRunEvent[]): string | undefined {
  return [...events]
    .reverse()
    .find((event) => event.type === "exit" || event.type === "error")
    ?.message;
}

function statusSummary(run: TaskRun): string {
  switch (toDesktopRunStatus(run.status)) {
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

function durationMs(
  startedAt: string | undefined,
  completedAt: string | undefined
): number | undefined {
  if (!startedAt || !completedAt) {
    return undefined;
  }
  const duration = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  return Number.isFinite(duration) && duration >= 0 ? duration : undefined;
}

function toDesktopRunStatus(status: TaskRunStatus): RunStatus {
  return status === "succeeded" ? "completed" : status;
}

function toAgentId(agentKind: TaskRun["agentKind"]): AgentId {
  return agentKind === "claude-code" ? "claude" : agentKind;
}
