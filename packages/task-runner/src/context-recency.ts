import type {
  AgentKind,
  ConversationThreadSummary,
  JsonObject,
  RiskReport,
  RunArtifact,
  Task,
  TaskRepository,
  TaskRun,
  TaskRunRepository,
  VerificationResult,
  VerificationResultRepository,
  RiskReportRepository,
  RunArtifactRepository,
  ConversationThreadSummaryRepository
} from "@agent-hub/core";

export interface RecentRunEvidenceContextSource {
  runId: string;
  taskId: string;
  taskTitle: string;
  agentKind: AgentKind;
  status: TaskRun["status"];
  completedAt?: string;
  createdAt: string;
  summary: string;
  changedFiles: string[];
  verificationSummary?: string;
  riskSummary?: string;
  metadata: JsonObject;
}

export interface RecentRunEvidenceCollectionInput {
  projectId: string;
  taskRepository: TaskRepository;
  taskRunRepository: TaskRunRepository;
  runArtifactRepository: RunArtifactRepository;
  verificationResultRepository: VerificationResultRepository;
  riskReportRepository: RiskReportRepository;
  limit?: number;
}

export interface ThreadSummaryCollectionInput {
  threadId?: string;
  includeThreadSummary?: boolean;
  disabledReason?: string;
  conversationThreadSummaryRepository?: ConversationThreadSummaryRepository;
}

export async function collectRecentRunEvidence(
  input: RecentRunEvidenceCollectionInput
): Promise<RecentRunEvidenceContextSource[]> {
  const limit = Math.max(0, Math.min(input.limit ?? 4, 10));
  if (limit === 0) {
    return [];
  }
  const tasks = await input.taskRepository.listByProjectId(input.projectId);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const runs = (await input.taskRunRepository.list())
    .filter((run) => taskById.has(run.taskId))
    .filter((run) => isTerminalRunStatus(run.status))
    .sort(compareRunsByRecency)
    .slice(0, limit);

  const sources: RecentRunEvidenceContextSource[] = [];
  for (const run of runs) {
    const task = taskById.get(run.taskId);
    if (!task) {
      continue;
    }
    const verificationResults =
      await input.verificationResultRepository.listByRunId(run.id);
    const riskReport = await input.riskReportRepository.getLatestByRunId(run.id);
    const diffArtifact = await input.runArtifactRepository.getLatestByRunIdAndKind(
      run.id,
      "git_diff"
    );
    sources.push(recentRunEvidenceSource({
      run,
      task,
      verificationResults,
      riskReport,
      diffArtifact
    }));
  }
  return sources;
}

export async function collectThreadSummaryContext(
  input: ThreadSummaryCollectionInput
): Promise<{
  summary?: ConversationThreadSummary;
  diagnostics: Array<{
    severity: "info" | "warning" | "error";
    message: string;
    metadata?: Record<string, unknown>;
  }>;
}> {
  if (input.includeThreadSummary === false) {
    return {
      diagnostics: [
        {
          severity: "info",
          message: input.disabledReason ?? "thread summary context is disabled"
        }
      ]
    };
  }
  if (!input.threadId || !input.conversationThreadSummaryRepository) {
    return { diagnostics: [] };
  }
  const summary = await input.conversationThreadSummaryRepository.getByThreadId(
    input.threadId
  );
  return summary ? { summary, diagnostics: [] } : { diagnostics: [] };
}

function recentRunEvidenceSource(input: {
  run: TaskRun;
  task: Task;
  verificationResults: VerificationResult[];
  riskReport?: RiskReport;
  diffArtifact?: RunArtifact;
}): RecentRunEvidenceContextSource {
  const changedFiles = changedFilePaths(input.diffArtifact).slice(0, 12);
  const verificationSummary = summarizeVerification(input.verificationResults);
  const riskSummary = input.riskReport
    ? `${input.riskReport.level}: ${input.riskReport.summary}`
    : undefined;
  const summaryParts = [
    `Run ${input.run.id} ${input.run.status} for task "${input.task.title}".`,
    changedFiles.length > 0
      ? `Changed files: ${changedFiles.join(", ")}.`
      : undefined,
    verificationSummary ? `Verification: ${verificationSummary}.` : undefined,
    riskSummary ? `Risk: ${riskSummary}.` : undefined
  ].filter((part): part is string => part !== undefined);

  return {
    runId: input.run.id,
    taskId: input.task.id,
    taskTitle: input.task.title,
    agentKind: input.run.agentKind,
    status: input.run.status,
    completedAt: input.run.completedAt,
    createdAt: input.run.createdAt,
    summary: summaryParts.join("\n"),
    changedFiles,
    verificationSummary,
    riskSummary,
    metadata: {
      diffStat: metadataObject(input.diffArtifact?.metadata)?.stat,
      verificationStatuses: verificationStatusCounts(input.verificationResults),
      riskLevel: input.riskReport?.level
    }
  };
}

function changedFilePaths(diffArtifact: RunArtifact | undefined): string[] {
  const metadata = metadataObject(diffArtifact?.metadata);
  const changedFiles = metadata?.changedFiles;
  if (!Array.isArray(changedFiles)) {
    return [];
  }
  return changedFiles.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const path = (entry as Record<string, unknown>).path;
    return typeof path === "string" ? [path] : [];
  });
}

function summarizeVerification(results: VerificationResult[]): string | undefined {
  if (results.length === 0) {
    return undefined;
  }
  const counts = verificationStatusCounts(results);
  const failedCommands = results
    .filter((result) => result.status === "failed")
    .map((result) => result.command)
    .slice(0, 3);
  const summary = `${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped`;
  return failedCommands.length > 0
    ? `${summary}; failed commands: ${failedCommands.join(", ")}`
    : summary;
}

function verificationStatusCounts(results: VerificationResult[]): {
  passed: number;
  failed: number;
  skipped: number;
} {
  return {
    passed: results.filter((result) => result.status === "passed").length,
    failed: results.filter((result) => result.status === "failed").length,
    skipped: results.filter((result) => result.status === "skipped").length
  };
}

function metadataObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isTerminalRunStatus(status: TaskRun["status"]): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function compareRunsByRecency(left: TaskRun, right: TaskRun): number {
  const leftTime = left.completedAt ?? left.updatedAt ?? left.createdAt;
  const rightTime = right.completedAt ?? right.updatedAt ?? right.createdAt;
  return rightTime === leftTime
    ? right.id.localeCompare(left.id)
    : rightTime.localeCompare(leftTime);
}
