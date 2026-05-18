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

interface ComparisonRunSnapshot {
  runId: string;
  taskId: string;
  agent: string;
  status: string;
  changedFiles: string[];
  stat: { filesChanged: number; insertions: number; deletions: number };
  verification: string;
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
  return renderComparisonSummary(input.taskId, baseline, candidate);
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
    verificationOutcomes,
    risk: riskReport?.level ?? "not available",
    riskFactors: riskReport?.riskFactors ?? [],
    failedChecks
  };
}

function renderComparisonSummary(
  taskId: string,
  baseline: ComparisonRunSnapshot,
  candidate: ComparisonRunSnapshot
): string {
  const baselineOnly = difference(baseline.changedFiles, candidate.changedFiles);
  const candidateOnly = difference(candidate.changedFiles, baseline.changedFiles);
  const shared = intersection(baseline.changedFiles, candidate.changedFiles);
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
    `summary_tradeoffs: ${comparisonTradeoffs(baseline, candidate)}`
  ].join("\n");
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

function comparisonTradeoffs(
  baseline: ComparisonRunSnapshot,
  candidate: ComparisonRunSnapshot
): string {
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
  return notes.length === 0
    ? "no material tradeoff detected from stored run data"
    : notes.join("; ");
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
      return 0;
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
