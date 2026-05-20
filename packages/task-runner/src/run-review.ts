import type {
  RunArtifact,
  RunArtifactRepository,
  RunEvent,
  RunEventRepository,
  RunMetadataRepository,
  TaskRepository,
  TaskRun,
  TaskRunRepository,
  VerificationResult,
  VerificationResultRepository,
  RiskReportRepository
} from "@agent-hub/core";

export const DEFAULT_DIFF_PATCH_LIMIT = 12_000;

export interface RunEventReviewRepositories {
  taskRunRepository: TaskRunRepository;
  runEventRepository: RunEventRepository;
}

export interface RunDiffReviewRepositories {
  taskRunRepository: TaskRunRepository;
  runArtifactRepository: RunArtifactRepository;
  runMetadataRepository: RunMetadataRepository;
}

export interface ComparisonReviewRepositories extends RunDiffReviewRepositories {
  taskRepository: TaskRepository;
  verificationResultRepository: VerificationResultRepository;
  riskReportRepository: RiskReportRepository;
}

export interface RunEventsReview {
  run: TaskRun;
  events: RunEvent[];
}

export interface RunDiffReview {
  run: TaskRun;
  artifact?: RunArtifact;
  changedFiles: string[];
  fileSummaries: string[];
  stat: { filesChanged: number; insertions: number; deletions: number; text?: string };
  patch: string;
  originalPatchLength: number;
  truncated: boolean;
  limit: number;
  redacted: boolean;
  redactedPaths: string[];
}

export interface ComparisonSummaryInput {
  taskId: string;
  baselineRunId: string;
  candidateRunId: string;
}

export interface ComparisonBuildResult {
  summary: string;
  details: ComparisonReportDetails;
}

export type ComparisonReportDetails = Record<string, unknown> & {
  version: 1;
  taskId: string;
  runs: {
    baseline: ComparisonRunSignal;
    candidate: ComparisonRunSignal;
  };
  changedFiles: {
    baselineOnly: string[];
    candidateOnly: string[];
    shared: string[];
    baselineCount: number;
    candidateCount: number;
    overlapCount: number;
    overlapRatio: number;
  };
  diffSize: {
    baseline: ComparisonDiffSizeSignal;
    candidate: ComparisonDiffSizeSignal;
    fileDelta: number;
    insertionDelta: number;
    deletionDelta: number;
    totalLineDelta: number;
  };
  verification: {
    baseline: VerificationCounts;
    candidate: VerificationCounts;
    failedCheckDelta: number;
    failedChecks: {
      baseline: string[];
      candidate: string[];
    };
  };
  risk: {
    baseline: ComparisonRiskSignal;
    candidate: ComparisonRiskSignal;
    rankDelta: number;
  };
  score: {
    baseline: number;
    candidate: number;
    winner: ComparisonWinner;
    reasons: string[];
    breakdown: {
      baseline: ComparisonScoreBreakdown;
      candidate: ComparisonScoreBreakdown;
    };
  };
  tradeoffs: string[];
};

interface ComparisonRunSignal {
  runId: string;
  agent: string;
  status: string;
  changedFiles: number;
  verification: string;
  risk: string;
}

interface ComparisonDiffSizeSignal {
  filesChanged: number;
  insertions: number;
  deletions: number;
  totalLineChanges: number;
}

interface ComparisonRiskSignal {
  level: string;
  rank: number;
  factors: string[];
}

interface VerificationCounts {
  passed: number;
  failed: number;
  skipped: number;
}

type ComparisonWinner = "baseline" | "candidate" | "tie";

interface ComparisonScoreBreakdown {
  statusPenalty: number;
  riskPenalty: number;
  failedCheckPenalty: number;
  skippedVerificationPenalty: number;
  diffSizePenalty: number;
}

interface ComparisonScore {
  total: number;
  breakdown: ComparisonScoreBreakdown;
}

interface ComparisonRunSnapshot {
  runId: string;
  taskId: string;
  agent: string;
  status: string;
  changedFiles: string[];
  stat: { filesChanged: number; insertions: number; deletions: number };
  verification: string;
  verificationCounts: VerificationCounts;
  verificationOutcomes: string[];
  risk: string;
  riskFactors: string[];
  failedChecks: string[];
}

export async function loadRunEventsReview(
  repositories: RunEventReviewRepositories,
  runId: string
): Promise<RunEventsReview> {
  const run = await requireRun(repositories.taskRunRepository, runId);
  const events = await repositories.runEventRepository.listByRunId(runId);
  return {
    run,
    events: [...events].sort((left, right) => left.sequence - right.sequence)
  };
}

export async function loadRunDiffReview(
  repositories: RunDiffReviewRepositories,
  runId: string,
  options: { fullPatch?: boolean; patchLimit?: number } = {}
): Promise<RunDiffReview> {
  const run = await requireRun(repositories.taskRunRepository, runId);
  const metadata = await repositories.runMetadataRepository.get(runId);
  const artifact = await repositories.runArtifactRepository.getLatestByRunIdAndKind(
    runId,
    "git_diff"
  );
  const diff = metadata?.diff;
  if (!artifact && !diff) {
    throw new Error(`diff artifact for run ${runId} not found`);
  }

  const artifactMetadata = artifact?.metadata ?? {};
  const changedFiles =
    changedFilePaths(artifactMetadata.changedFiles) ??
    diff?.changedFiles.map((file) => file.path) ??
    [];
  const stat =
    diff?.stat ??
    diffStat(artifactMetadata.stat, changedFiles.length);
  const fileSummaries =
    stringArray(artifactMetadata.fileSummaries) ??
    diff?.fileSummaries ??
    changedFiles;
  const rawPatch = artifact?.content ?? diff?.diff ?? "";
  const limit = options.patchLimit ?? DEFAULT_DIFF_PATCH_LIMIT;
  const redactedPaths = sensitivePatchPaths(rawPatch, changedFiles);
  const redacted = redactedPaths.length > 0;
  const patch = redacted
    ? `Patch redacted because sensitive file path changed: ${redactedPaths.join(", ")}`
    : options.fullPatch
      ? rawPatch
      : truncate(rawPatch, limit);

  return {
    run,
    artifact,
    changedFiles,
    fileSummaries,
    stat,
    patch,
    originalPatchLength: rawPatch.length,
    truncated: !redacted && patch.length < rawPatch.length,
    limit,
    redacted,
    redactedPaths
  };
}

export async function buildComparisonSummary(
  repositories: ComparisonReviewRepositories,
  input: ComparisonSummaryInput
): Promise<string> {
  return (await buildComparisonReport(repositories, input)).summary;
}

export async function buildComparisonReport(
  repositories: ComparisonReviewRepositories,
  input: ComparisonSummaryInput
): Promise<ComparisonBuildResult> {
  const task = await repositories.taskRepository.get(input.taskId);
  if (!task) {
    throw new Error(`task ${input.taskId} not found`);
  }
  const baseline = await loadComparisonRun(repositories, input.baselineRunId);
  const candidate = await loadComparisonRun(repositories, input.candidateRunId);
  if (baseline.taskId !== input.taskId) {
    throw new Error(
      `baseline run ${input.baselineRunId} does not belong to task ${input.taskId}`
    );
  }
  if (candidate.taskId !== input.taskId) {
    throw new Error(
      `candidate run ${input.candidateRunId} does not belong to task ${input.taskId}`
    );
  }
  const details = buildComparisonDetails(input.taskId, baseline, candidate);
  return {
    summary: renderComparisonSummary(input.taskId, baseline, candidate, details),
    details
  };
}

async function requireRun(
  repository: TaskRunRepository,
  runId: string
): Promise<TaskRun> {
  const run = await repository.get(runId);
  if (!run) {
    throw new Error(`run ${runId} not found`);
  }
  return run;
}

async function loadComparisonRun(
  repositories: ComparisonReviewRepositories,
  runId: string
): Promise<ComparisonRunSnapshot> {
  const run = await requireRun(repositories.taskRunRepository, runId);
  const metadata = await repositories.runMetadataRepository.get(runId);
  const diffArtifact = await repositories.runArtifactRepository.getLatestByRunIdAndKind(
    runId,
    "git_diff"
  );
  const artifactMetadata = diffArtifact?.metadata ?? {};
  const verificationRows =
    await repositories.verificationResultRepository.listByRunId(runId);
  const risk = await repositories.riskReportRepository.getLatestByRunId(runId);
  const riskReport = risk ?? metadata?.riskReport;
  const changedFiles =
    metadata?.diff?.changedFiles.map((file) => file.path) ??
    changedFilePaths(artifactMetadata.changedFiles) ??
    [];
  const stat =
    metadata?.diff?.stat ??
    diffStat(artifactMetadata.stat, changedFiles.length);
  const failedChecks =
    verificationRows.length > 0
      ? verificationRows
          .filter((result) => result.status === "failed")
          .map((result) => result.command)
      : metadata?.verification?.failedCommands.map((result) => result.label) ?? [];
  const verificationOutcomes =
    verificationRows.length > 0
      ? verificationRows.map((result) => formatVerificationOutcome(
          result.command,
          result.status,
          result.exitCode
        ))
      : metadata?.verification?.results.map((result) => formatVerificationOutcome(
          result.label,
          result.status,
          result.exitCode ?? undefined
        )) ?? [];
  const verificationCounts =
    verificationRows.length > 0
      ? countVerificationStatuses(verificationRows)
      : countVerificationStatuses(metadata?.verification?.results ?? []);

  return {
    runId: run.id,
    taskId: run.taskId,
    agent: run.agentKind,
    status: run.status,
    changedFiles,
    stat: {
      filesChanged: stat.filesChanged,
      insertions: stat.insertions,
      deletions: stat.deletions
    },
    verification:
      verificationRows.length > 0
        ? summarizeVerificationResults(verificationRows)
        : metadata?.verification?.summary ?? "not available",
    verificationCounts,
    verificationOutcomes,
    risk: riskReport?.level ?? "not available",
    riskFactors: riskReport?.riskFactors ?? [],
    failedChecks
  };
}

function renderComparisonSummary(
  taskId: string,
  baseline: ComparisonRunSnapshot,
  candidate: ComparisonRunSnapshot,
  details: ComparisonReportDetails
): string {
  const baselineOnly = difference(baseline.changedFiles, candidate.changedFiles);
  const candidateOnly = difference(candidate.changedFiles, baseline.changedFiles);
  const shared = intersection(baseline.changedFiles, candidate.changedFiles);
  const score = details.score;
  return [
    `task_id: ${taskId}`,
    `baseline: ${formatComparisonRun(baseline)}`,
    `candidate: ${formatComparisonRun(candidate)}`,
    `baseline_diff_stats: ${formatDiffStat(baseline.stat)}`,
    `candidate_diff_stats: ${formatDiffStat(candidate.stat)}`,
    `baseline_only_files: ${formatList(baselineOnly)}`,
    `candidate_only_files: ${formatList(candidateOnly)}`,
    `shared_files: ${formatList(shared)}`,
    `baseline_verification_outcomes: ${formatList(baseline.verificationOutcomes)}`,
    `candidate_verification_outcomes: ${formatList(candidate.verificationOutcomes)}`,
    `baseline_risk_factors: ${formatList(baseline.riskFactors)}`,
    `candidate_risk_factors: ${formatList(candidate.riskFactors)}`,
    `baseline_failed_checks: ${formatList(baseline.failedChecks)}`,
    `candidate_failed_checks: ${formatList(candidate.failedChecks)}`,
    `comparison_score: baseline=${score.baseline} candidate=${score.candidate} winner=${score.winner}`,
    `score_reasons: ${formatList(score.reasons)}`,
    `summary_tradeoffs: ${comparisonTradeoffs(baseline, candidate)}`
  ].join("\n");
}

function buildComparisonDetails(
  taskId: string,
  baseline: ComparisonRunSnapshot,
  candidate: ComparisonRunSnapshot
): ComparisonReportDetails {
  const baselineOnly = difference(baseline.changedFiles, candidate.changedFiles);
  const candidateOnly = difference(candidate.changedFiles, baseline.changedFiles);
  const shared = intersection(baseline.changedFiles, candidate.changedFiles);
  const uniqueFileCount = new Set([
    ...baseline.changedFiles,
    ...candidate.changedFiles
  ]).size;
  const baselineDiffSize = diffSizeSignal(baseline.stat);
  const candidateDiffSize = diffSizeSignal(candidate.stat);
  const score = scoreComparison(baseline, candidate);

  return {
    version: 1,
    taskId,
    runs: {
      baseline: runSignal(baseline),
      candidate: runSignal(candidate)
    },
    changedFiles: {
      baselineOnly,
      candidateOnly,
      shared,
      baselineCount: baseline.changedFiles.length,
      candidateCount: candidate.changedFiles.length,
      overlapCount: shared.length,
      overlapRatio: ratio(shared.length, uniqueFileCount)
    },
    diffSize: {
      baseline: baselineDiffSize,
      candidate: candidateDiffSize,
      fileDelta: candidate.stat.filesChanged - baseline.stat.filesChanged,
      insertionDelta: candidate.stat.insertions - baseline.stat.insertions,
      deletionDelta: candidate.stat.deletions - baseline.stat.deletions,
      totalLineDelta:
        candidateDiffSize.totalLineChanges - baselineDiffSize.totalLineChanges
    },
    verification: {
      baseline: baseline.verificationCounts,
      candidate: candidate.verificationCounts,
      failedCheckDelta: candidate.failedChecks.length - baseline.failedChecks.length,
      failedChecks: {
        baseline: baseline.failedChecks,
        candidate: candidate.failedChecks
      }
    },
    risk: {
      baseline: riskSignal(baseline),
      candidate: riskSignal(candidate),
      rankDelta: riskRank(candidate.risk) - riskRank(baseline.risk)
    },
    score: {
      baseline: score.baseline.total,
      candidate: score.candidate.total,
      winner: score.winner,
      reasons: score.reasons,
      breakdown: {
        baseline: score.baseline.breakdown,
        candidate: score.candidate.breakdown
      }
    },
    tradeoffs: comparisonTradeoffNotes(baseline, candidate)
  };
}

function formatComparisonRun(run: ComparisonRunSnapshot): string {
  return [
    run.runId,
    `agent=${run.agent}`,
    `status=${run.status}`,
    `changed_files=${run.changedFiles.length}`,
    `stat=+${run.stat.insertions}/-${run.stat.deletions}`,
    `verification=${run.verification}`,
    `risk=${run.risk}`
  ].join(" ");
}

function formatDiffStat(stat: ComparisonRunSnapshot["stat"]): string {
  return `${stat.filesChanged} files, +${stat.insertions}/-${stat.deletions}`;
}

function formatVerificationOutcome(
  label: string,
  status: string,
  exitCode: number | undefined
): string {
  return exitCode === undefined
    ? `${label}: ${status}`
    : `${label}: ${status} (${exitCode})`;
}

function summarizeVerificationResults(results: VerificationResult[]): string {
  const passed = results.filter((result) => result.status === "passed").length;
  const failed = results.filter((result) => result.status === "failed").length;
  const skipped = results.filter((result) => result.status === "skipped").length;
  return `${passed} passed, ${failed} failed, ${skipped} skipped`;
}

function countVerificationStatuses(
  results: Array<{ status: string }>
): VerificationCounts {
  return {
    passed: results.filter((result) => result.status === "passed").length,
    failed: results.filter((result) => result.status === "failed").length,
    skipped: results.filter((result) => result.status === "skipped").length
  };
}

function runSignal(run: ComparisonRunSnapshot): ComparisonRunSignal {
  return {
    runId: run.runId,
    agent: run.agent,
    status: run.status,
    changedFiles: run.changedFiles.length,
    verification: run.verification,
    risk: run.risk
  };
}

function diffSizeSignal(
  stat: ComparisonRunSnapshot["stat"]
): ComparisonDiffSizeSignal {
  return {
    filesChanged: stat.filesChanged,
    insertions: stat.insertions,
    deletions: stat.deletions,
    totalLineChanges: stat.insertions + stat.deletions
  };
}

function riskSignal(run: ComparisonRunSnapshot): ComparisonRiskSignal {
  return {
    level: run.risk,
    rank: riskRank(run.risk),
    factors: run.riskFactors
  };
}

function ratio(value: number, total: number): number {
  return total === 0 ? 0 : Number((value / total).toFixed(3));
}

function scoreComparison(
  baseline: ComparisonRunSnapshot,
  candidate: ComparisonRunSnapshot
): {
  baseline: ComparisonScore;
  candidate: ComparisonScore;
  winner: ComparisonWinner;
  reasons: string[];
} {
  const baselineScore = scoreRun(baseline);
  const candidateScore = scoreRun(candidate);
  const winner =
    baselineScore.total > candidateScore.total
      ? "baseline"
      : candidateScore.total > baselineScore.total
        ? "candidate"
        : "tie";
  const reasons = [
    winner === "tie"
      ? "baseline and candidate scores are tied"
      : `${winner} has higher deterministic review score`,
    ...comparisonTradeoffNotes(baseline, candidate)
  ];

  return {
    baseline: baselineScore,
    candidate: candidateScore,
    winner,
    reasons: [...new Set(reasons)]
  };
}

function scoreRun(run: ComparisonRunSnapshot): ComparisonScore {
  const breakdown = {
    statusPenalty: statusPenalty(run.status),
    riskPenalty: riskPenalty(run.risk),
    failedCheckPenalty: Math.min(45, run.failedChecks.length * 15),
    skippedVerificationPenalty: Math.min(15, run.verificationCounts.skipped * 5),
    diffSizePenalty: diffSizePenalty(run.stat)
  };
  const penalty = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  return {
    total: Math.max(0, 100 - penalty),
    breakdown
  };
}

function statusPenalty(status: string): number {
  switch (status) {
    case "succeeded":
      return 0;
    case "failed":
    case "cancelled":
      return 30;
    case "queued":
    case "running":
      return 20;
    default:
      return 20;
  }
}

function riskPenalty(risk: string): number {
  switch (risk) {
    case "low":
      return 0;
    case "medium":
      return 10;
    case "high":
      return 25;
    case "blocking":
      return 50;
    default:
      return 15;
  }
}

function diffSizePenalty(stat: ComparisonRunSnapshot["stat"]): number {
  return Math.min(20, Math.ceil(stat.filesChanged * 2 + (
    stat.insertions + stat.deletions
  ) / 100));
}

function comparisonTradeoffs(
  baseline: ComparisonRunSnapshot,
  candidate: ComparisonRunSnapshot
): string {
  const notes = comparisonTradeoffNotes(baseline, candidate);
  return notes.length === 0
    ? "no material tradeoff detected from stored run data"
    : notes.join("; ");
}

function comparisonTradeoffNotes(
  baseline: ComparisonRunSnapshot,
  candidate: ComparisonRunSnapshot
): string[] {
  const notes: string[] = [];
  if (candidate.failedChecks.length > baseline.failedChecks.length) {
    notes.push("candidate has more failed checks");
  } else if (candidate.failedChecks.length < baseline.failedChecks.length) {
    notes.push("candidate has fewer failed checks");
  }
  if (riskRank(candidate.risk) > riskRank(baseline.risk)) {
    notes.push("candidate has higher risk");
  } else if (riskRank(candidate.risk) < riskRank(baseline.risk)) {
    notes.push("candidate has lower risk");
  }
  if (candidate.stat.filesChanged > baseline.stat.filesChanged) {
    notes.push("candidate changes more files");
  } else if (candidate.stat.filesChanged < baseline.stat.filesChanged) {
    notes.push("candidate changes fewer files");
  }
  return notes;
}

function riskRank(risk: string): number {
  switch (risk) {
    case "low":
      return 1;
    case "medium":
      return 2;
    case "high":
      return 3;
    case "blocking":
      return 4;
    default:
      return 2;
  }
}

function changedFilePaths(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.flatMap((entry) => {
    if (typeof entry === "string") {
      return [entry];
    }
    if (entry && typeof entry === "object" && "path" in entry) {
      const filePath = (entry as { path?: unknown }).path;
      return typeof filePath === "string" ? [filePath] : [];
    }
    return [];
  });
}

function diffStat(
  value: unknown,
  fallbackFilesChanged: number
): { filesChanged: number; insertions: number; deletions: number; text?: string } {
  if (!value || typeof value !== "object") {
    return { filesChanged: fallbackFilesChanged, insertions: 0, deletions: 0 };
  }
  const stat = value as Record<string, unknown>;
  return {
    filesChanged: numeric(stat.filesChanged) ?? fallbackFilesChanged,
    insertions: numeric(stat.insertions) ?? 0,
    deletions: numeric(stat.deletions) ?? 0,
    text: typeof stat.text === "string" ? stat.text : undefined
  };
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const values = value.filter((entry): entry is string => typeof entry === "string");
  return values.length === value.length ? values : undefined;
}

function difference(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return [...new Set(left.filter((entry) => !rightSet.has(entry)))].sort();
}

function intersection(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return [...new Set(left.filter((entry) => rightSet.has(entry)))].sort();
}

function formatList(values: string[]): string {
  return values.length === 0 ? "none" : values.join(", ");
}

function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function truncate(value: string, limit: number): string {
  if (limit < 0) {
    return value;
  }
  return value.length > limit ? value.slice(0, limit) : value;
}

function sensitivePatchPaths(patch: string, changedPaths: string[]): string[] {
  const paths = new Set<string>();
  for (const filePath of changedPaths) {
    if (isSensitiveFilePath(filePath)) {
      paths.add(filePath);
    }
  }

  for (const line of patch.split(/\r?\n/)) {
    const pathFromHeader = diffPathFromHeader(line);
    if (pathFromHeader && isSensitiveFilePath(pathFromHeader)) {
      paths.add(pathFromHeader);
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
