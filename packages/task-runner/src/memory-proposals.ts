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
  sourceKind: "run" | "verification" | "diff" | "risk";
  confidence: "low" | "medium" | "high";
}

const DEFAULT_MAX_PROPOSALS_PER_TASK = 2;
const sensitiveCommandTerms = new Set([
  "token",
  "secret",
  "password",
  "passwd",
  "credential",
  "credentials",
  "authorization",
  "bearer",
  "apikey",
  "privatekey"
]);

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
        metadata: {
          sourceRunId: run.id,
          sourceTaskId: task.id,
          sourceKind: candidate.sourceKind,
          generatedBy: "task_runner",
          confidence: candidate.confidence
        },
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
      content: `Verification command for this project is ${verificationCommand}.`,
      sourceKind: "verification",
      confidence: "high"
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
        "Agent Hub behavior changes should update docs/product.md and docs/architecture.md together.",
      sourceKind: "diff",
      confidence: "medium"
    });
  }

  if (touchesDesktopBoundary(input.task, changedPaths)) {
    candidates.push({
      category: "workflow_rule",
      content: "Desktop renderer must not access Node APIs directly.",
      sourceKind: "run",
      confidence: "medium"
    });
  }

  return uniqueCandidates(candidates);
}

function firstSafeVerificationCommand(
  results: VerificationResult[]
): string | undefined {
  return results
    .map((result) => result.command.trim())
    .find(isSafeMemoryVerificationCommand);
}

export function isSafeMemoryVerificationCommand(command: string): boolean {
  const trimmed = command.trim();
  return (
    trimmed.length > 0 &&
    trimmed !== "not configured" &&
    trimmed.length <= 160 &&
    !trimmed.includes("\n") &&
    !/simulated/i.test(trimmed) &&
    !containsSensitiveCommandTerm(trimmed)
  );
}

function containsSensitiveCommandTerm(command: string): boolean {
  const terms = splitCommandTerms(command);
  return terms.some((term, index) =>
    sensitiveCommandTerms.has(term) ||
    (term === "api" && terms[index + 1] === "key") ||
    (term === "private" && terms[index + 1] === "key")
  );
}

function splitCommandTerms(command: string): string[] {
  return command
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((term) => term.toLowerCase())
    .filter((term) => term.length > 0);
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
      .filter((item) => item.status !== "retired")
      .map((item) => normalizeMemoryContent(item.content))
  ).size;
}

function hasProjectMemoryContent(
  items: MemoryItem[],
  normalizedContent: string
): boolean {
  return items.some(
    (item) => item.status !== "rejected" &&
      item.status !== "retired" &&
      normalizeMemoryContent(item.content) === normalizedContent
  );
}

export function normalizeMemoryContent(content: string): string {
  return content.trim().replace(/\s+/g, " ").toLowerCase();
}
