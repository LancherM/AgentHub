import {
  validateMemoryItem,
  type MemoryItem,
  type MemoryItemRepository,
  type RiskReport,
  type RiskReportRepository,
  type RunArtifact,
  type RunArtifactRepository,
  type Task,
  type TaskRepository,
  type TaskRunRepository,
  type VerificationResult,
  type VerificationResultRepository
} from "@agent-hub/core";

export interface MemoryProposalIdGenerator {
  nextId(prefix: string): string;
}

export interface MemoryProposalClock {
  now(): string;
}

export interface MemoryProposalGenerationRepositories {
  taskRunRepository: TaskRunRepository;
  taskRepository: TaskRepository;
  runArtifactRepository: RunArtifactRepository;
  verificationResultRepository: VerificationResultRepository;
  riskReportRepository: RiskReportRepository;
  memoryItemRepository: MemoryItemRepository;
}

export interface MemoryProposalGenerationInput {
  runId: string;
  idGenerator: MemoryProposalIdGenerator;
  clock: MemoryProposalClock;
  maxProposalsPerTask?: number;
}

interface ProposalCandidate {
  category: MemoryItem["category"];
  content: string;
}

const DEFAULT_MAX_PROPOSALS_PER_TASK = 2;
const SENSITIVE_COMMAND_MEMORY_PATTERN =
  /\b(api[_-]?key|token|secret|password|passwd|private[_-]?key|credential|authorization|bearer)\b/i;

export async function generateMemoryProposalsFromCompletedRun(
  repositories: MemoryProposalGenerationRepositories,
  input: MemoryProposalGenerationInput
): Promise<MemoryItem[]> {
  const run = await repositories.taskRunRepository.get(input.runId);
  if (!run) {
    throw new Error(`run ${input.runId} not found`);
  }
  if (run.status !== "succeeded") {
    return [];
  }
  const task = await repositories.taskRepository.get(run.taskId);
  if (!task) {
    throw new Error(`task ${run.taskId} not found`);
  }

  const [artifacts, verificationResults, latestRiskReport] = await Promise.all([
    repositories.runArtifactRepository.listByRunId(run.id),
    repositories.verificationResultRepository.listByRunId(run.id),
    repositories.riskReportRepository.getLatestByRunId(run.id)
  ]);

  const maxProposals =
    input.maxProposalsPerTask ?? DEFAULT_MAX_PROPOSALS_PER_TASK;
  let projectItems = await repositories.memoryItemRepository.listByProjectId(
    task.projectId
  );
  const created: MemoryItem[] = [];

  for (const candidate of buildCandidates({
    task,
    artifacts,
    verificationResults,
    riskReport: latestRiskReport
  })) {
    if (uniqueTaskMemoryCount(projectItems, task.id) >= maxProposals) {
      break;
    }

    const normalizedContent = normalizeMemoryContent(candidate.content);
    if (hasProjectMemoryContent(projectItems, normalizedContent)) {
      continue;
    }

    projectItems = await repositories.memoryItemRepository.listByProjectId(
      task.projectId
    );
    if (uniqueTaskMemoryCount(projectItems, task.id) >= maxProposals) {
      break;
    }
    if (hasProjectMemoryContent(projectItems, normalizedContent)) {
      continue;
    }

    const now = input.clock.now();
    const item = await repositories.memoryItemRepository.create(
      validateMemoryItem({
        id: input.idGenerator.nextId("memory"),
        projectId: task.projectId,
        taskId: task.id,
        category: candidate.category,
        status: "proposed",
        content: candidate.content,
        createdAt: now,
        updatedAt: now
      })
    );
    created.push(item);
    projectItems = [...projectItems, item];
  }

  return created;
}

function buildCandidates(input: {
  task: Task;
  artifacts: RunArtifact[];
  verificationResults: VerificationResult[];
  riskReport?: RiskReport;
}): ProposalCandidate[] {
  const candidates: ProposalCandidate[] = [];
  const verificationCommand = firstSafeVerificationCommand(
    input.verificationResults
  );
  if (verificationCommand) {
    candidates.push({
      category: "workflow_rule",
      content: `Verification command for this project is ${verificationCommand}.`
    });
  }

  const changedPaths = changedFilePaths(input.artifacts, input.riskReport);
  if (
    changedPaths.has("docs/product.md") &&
    changedPaths.has("docs/architecture.md")
  ) {
    candidates.push({
      category: "workflow_rule",
      content:
        "Agent Hub behavior changes should update docs/product.md and docs/architecture.md together."
    });
  }

  if (touchesDesktopBoundary(input.task, changedPaths)) {
    candidates.push({
      category: "workflow_rule",
      content: "Desktop renderer must not access Node APIs directly."
    });
  }

  return uniqueCandidates(candidates);
}

function firstSafeVerificationCommand(
  results: VerificationResult[]
): string | undefined {
  return results
    .map((result) => result.command.trim())
    .find(
      (command) =>
        command.length > 0 &&
        command !== "not configured" &&
        command.length <= 160 &&
        !command.includes("\n") &&
        !/simulated/i.test(command) &&
        !SENSITIVE_COMMAND_MEMORY_PATTERN.test(command)
    );
}

function changedFilePaths(
  artifacts: RunArtifact[],
  riskReport?: RiskReport
): Set<string> {
  const paths = new Set<string>(riskReport?.changedFiles ?? []);
  for (const artifact of artifacts) {
    if (artifact.kind !== "git_diff") {
      continue;
    }
    const changedFiles = artifact.metadata.changedFiles;
    if (!Array.isArray(changedFiles)) {
      continue;
    }
    for (const file of changedFiles) {
      if (typeof file === "string" && file.trim().length > 0) {
        paths.add(file);
      } else if (
        typeof file === "object" &&
        file !== null &&
        "path" in file &&
        typeof file.path === "string" &&
        file.path.trim().length > 0
      ) {
        paths.add(file.path);
      }
    }
  }
  return paths;
}

function touchesDesktopBoundary(task: Task, changedPaths: Set<string>): boolean {
  const taskText = `${task.title}\n${task.description ?? ""}`;
  return (
    /desktop|renderer|electron/i.test(taskText) ||
    [...changedPaths].some((filePath) => /^apps\/desktop\//.test(filePath))
  );
}

function uniqueCandidates(candidates: ProposalCandidate[]): ProposalCandidate[] {
  const seen = new Set<string>();
  const unique: ProposalCandidate[] = [];
  for (const candidate of candidates) {
    const key = normalizeMemoryContent(candidate.content);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(candidate);
  }
  return unique;
}

function uniqueTaskMemoryCount(items: MemoryItem[], taskId: string): number {
  return new Set(
    items
      .filter((item) => item.taskId === taskId)
      .map((item) => normalizeMemoryContent(item.content))
  ).size;
}

function hasProjectMemoryContent(
  items: MemoryItem[],
  normalizedContent: string
): boolean {
  return items.some(
    (item) => normalizeMemoryContent(item.content) === normalizedContent
  );
}

function normalizeMemoryContent(content: string): string {
  return content.trim().replace(/\s+/g, " ").toLowerCase();
}
