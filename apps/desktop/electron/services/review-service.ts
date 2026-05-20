import {
  validateRunArtifact,
  type MemoryItemRepository,
  type RunArtifactRepository,
  type RunEvent as CoreRunEvent,
  type RiskReport as CoreRiskReport,
  type RiskReportRepository,
  type RunEventRepository,
  type Task,
  type TaskRepository,
  type TaskRun,
  type TaskRunRepository,
  type VerificationResultRepository
} from "@agent-hub/core";
import type { JsonObject, TaskRunStatus } from "@agent-hub/shared";
import type {
  AgentId,
  DiffSummary,
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
const MAX_LOG_ROWS = 1_000;
const MAX_LOG_MESSAGE_CHARS = 12_000;

export interface ReviewService {
  getSummary(runId: string): Promise<ReviewSummary>;
  getDiff(runId: string): Promise<DiffSummary>;
  getRisk(runId: string): Promise<RiskReport>;
  getVerification(runId: string): Promise<VerificationReport>;
  getLogs(runId: string): Promise<RunLog[]>;
  acceptRun(runId: string): Promise<ReviewSummary>;
  rejectRun(runId: string, reason?: string): Promise<ReviewSummary>;
  refreshReview(runId: string): Promise<ReviewSummary>;
}

export function createReviewService(
  context: DesktopServiceContext,
  dependencies: {
    diffService?: DiffService;
    riskService?: RiskService;
    memoryService?: MemoryService;
  } = {}
): ReviewService {
  return new RepositoryReviewService(context, {
    diffService: dependencies.diffService ?? createDiffService(context),
    riskService: dependencies.riskService ?? createRiskService(),
    memoryService: dependencies.memoryService
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

  constructor(
    private readonly context: DesktopServiceContext,
    private readonly dependencies: {
      diffService: DiffService;
      riskService: RiskService;
      memoryService?: MemoryService;
    }
  ) {
    this.runs = context.repositories.taskRunRepository;
    this.tasks = context.repositories.taskRepository;
    this.events = context.repositories.runEventRepository;
    this.artifacts = context.repositories.runArtifactRepository;
    this.verification = context.repositories.verificationResultRepository;
    this.memory = context.repositories.memoryItemRepository;
    this.risks = context.repositories.riskReportRepository;
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

  async acceptRun(runId: string): Promise<ReviewSummary> {
    await this.requireRunAndTask(runId);
    const acceptedAt = this.context.now();
    await this.artifacts.create(
      validateRunArtifact({
        id: this.context.nextId("review"),
        taskRunId: runId,
        kind: REVIEW_DECISION_ARTIFACT_KIND,
        content: "Accepted for record. No merge was performed.",
        metadata: {
          reviewStatus: "accepted",
          acceptedAt
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
      return (await this.dependencies.memoryService.generateProposalsForRun(runId)).length;
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
