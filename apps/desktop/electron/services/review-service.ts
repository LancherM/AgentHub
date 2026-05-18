import type {
  RiskReport as CoreRiskReport,
  RiskReportRepository,
  RunArtifactRepository,
  RunMetadataRepository,
  TaskRunRepository,
  VerificationResultRepository
} from "@agent-hub/core";
import type {
  DiffSummary,
  RiskReport,
  VerificationReport
} from "../../src/lib/types";
import type { DesktopServiceContext } from "./project-service";

export interface ReviewService {
  getDiff(runId: string): Promise<DiffSummary>;
  getRisk(runId: string): Promise<RiskReport>;
  getVerification(runId: string): Promise<VerificationReport>;
}

export function createReviewService(context: DesktopServiceContext): ReviewService {
  return new RepositoryReviewService({
    taskRunRepository: context.repositories.taskRunRepository,
    runArtifactRepository: context.repositories.runArtifactRepository,
    runMetadataRepository: context.repositories.runMetadataRepository,
    riskReportRepository: context.repositories.riskReportRepository,
    verificationResultRepository: context.repositories.verificationResultRepository
  });
}

class RepositoryReviewService implements ReviewService {
  constructor(
    private readonly repositories: {
      taskRunRepository: TaskRunRepository;
      runArtifactRepository: RunArtifactRepository;
      runMetadataRepository: RunMetadataRepository;
      riskReportRepository: RiskReportRepository;
      verificationResultRepository: VerificationResultRepository;
    }
  ) {}

  async getDiff(runId: string): Promise<DiffSummary> {
    const run = await this.repositories.taskRunRepository.get(runId);
    if (!run) {
      throw new Error(`run ${runId} not found`);
    }
    const [metadata, artifact] = await Promise.all([
      this.repositories.runMetadataRepository.get(runId),
      this.repositories.runArtifactRepository.getLatestByRunIdAndKind(
        runId,
        "git_diff"
      )
    ]);
    const diff = metadata?.diff;
    if (!artifact && !diff) {
      return placeholderDiff(runId);
    }
    const artifactMetadata = artifact?.metadata ?? {};
    const changedFiles =
      stringArray(artifactMetadata.changedFiles) ??
      diff?.changedFiles.map((file) => file.path) ??
      [];
    const fileSummaries =
      stringArray(artifactMetadata.fileSummaries) ??
      diff?.fileSummaries ??
      changedFiles;
    const stat = diff?.stat ?? diffStat(artifactMetadata.stat, changedFiles.length);
    const unifiedDiff = artifact?.content ?? diff?.diff ?? "";
    return {
      runId,
      changedFiles,
      fileSummaries,
      stat,
      unifiedDiff,
      truncated: false,
      isPlaceholder:
        artifactMetadata.placeholder === true || unifiedDiff.trim().length === 0
    };
  }

  async getRisk(runId: string): Promise<RiskReport> {
    const run = await this.repositories.taskRunRepository.get(runId);
    if (!run) {
      throw new Error(`run ${runId} not found`);
    }
    const report =
      await this.repositories.riskReportRepository.getLatestByRunId(runId);
    return report ? toRiskReport(report) : placeholderRisk(runId);
  }

  async getVerification(runId: string): Promise<VerificationReport> {
    const run = await this.repositories.taskRunRepository.get(runId);
    if (!run) {
      throw new Error(`run ${runId} not found`);
    }
    const results =
      await this.repositories.verificationResultRepository.listByRunId(runId);
    if (results.length === 0) {
      return {
        runId,
        status: "skipped",
        summary: "No verification results were recorded for this run.",
        results: []
      };
    }

    const failed = results.filter((result) => result.status === "failed").length;
    const passed = results.filter((result) => result.status === "passed").length;
    const skipped = results.filter((result) => result.status === "skipped").length;
    return {
      runId,
      status: failed > 0 ? "failed" : passed > 0 ? "passed" : "skipped",
      summary: `${passed} passed, ${failed} failed, ${skipped} skipped`,
      results: results.map((result) => ({
        id: result.id,
        command: result.command,
        status: result.status,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        createdAt: result.createdAt
      }))
    };
  }
}

function placeholderDiff(runId: string): DiffSummary {
  return {
    runId,
    changedFiles: [],
    fileSummaries: [],
    stat: {
      filesChanged: 0,
      insertions: 0,
      deletions: 0
    },
    unifiedDiff: "",
    truncated: false,
    isPlaceholder: true
  };
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    return undefined;
  }
  return value;
}

function diffStat(
  value: unknown,
  fallbackFilesChanged: number
): DiffSummary["stat"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      filesChanged: fallbackFilesChanged,
      insertions: 0,
      deletions: 0
    };
  }
  const stat = value as Partial<DiffSummary["stat"]>;
  return {
    filesChanged:
      typeof stat.filesChanged === "number"
        ? stat.filesChanged
        : fallbackFilesChanged,
    insertions: typeof stat.insertions === "number" ? stat.insertions : 0,
    deletions: typeof stat.deletions === "number" ? stat.deletions : 0,
    text: typeof stat.text === "string" ? stat.text : undefined
  };
}

function toRiskReport(report: CoreRiskReport): RiskReport {
  return {
    id: report.id,
    runId: report.taskRunId,
    level: report.level,
    summary: report.summary,
    changedFiles: report.changedFiles,
    verificationSummary: report.verificationSummary,
    failedChecks: report.failedChecks,
    riskFactors: report.riskFactors,
    manualReviewChecklist: report.manualReviewChecklist,
    acceptanceRecommendation: report.acceptanceRecommendation,
    findings: report.findings,
    createdAt: report.createdAt
  };
}

function placeholderRisk(runId: string): RiskReport {
  const createdAt = new Date().toISOString();
  return {
    id: `risk_placeholder_${runId}`,
    runId,
    level: "low",
    summary: "No persisted risk report is available for this run.",
    changedFiles: [],
    verificationSummary: "not available",
    failedChecks: [],
    riskFactors: [],
    manualReviewChecklist: ["Review run output before applying any changes."],
    acceptanceRecommendation: "Manual review required.",
    findings: [],
    createdAt
  };
}
