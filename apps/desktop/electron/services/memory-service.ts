import {
  type MemoryItem,
  type MemoryItemRepository,
  type ProjectRepository,
  type Project,
  type Task,
  type TaskRepository,
  type TaskRun,
  type TaskRunRepository
} from "@agent-hub/core";
import {
  appendApprovedMemory,
  resolveApprovedMemoryPath
} from "@agent-hub/context-compiler";
import {
  generateMemoryProposalsFromCompletedRun,
  normalizeMemoryContent
} from "@agent-hub/task-runner";
import type {
  MemoryApprovalResult,
  MemoryProposal,
  MemoryProposalSource
} from "../../src/lib/types";
import type { DesktopServiceContext } from "./project-service";

export interface MemoryService {
  listProposals(runId: string): Promise<MemoryProposal[]>;
  generateProposalsForRun(runId: string): Promise<MemoryProposal[]>;
  approve(ids: string[]): Promise<MemoryApprovalResult[]>;
  ignore(ids: string[]): Promise<void>;
}

export function createMemoryService(context: DesktopServiceContext): MemoryService {
  return new RepositoryMemoryService(
    context.repositories.taskRunRepository,
    context.repositories.taskRepository,
    context.repositories.projectRepository,
    context.repositories.memoryItemRepository,
    context
  );
}

class RepositoryMemoryService implements MemoryService {
  private readonly generationLocks = new Map<string, Promise<MemoryProposal[]>>();

  constructor(
    private readonly runs: TaskRunRepository,
    private readonly tasks: TaskRepository,
    private readonly projects: ProjectRepository,
    private readonly memory: MemoryItemRepository,
    private readonly context: DesktopServiceContext
  ) {}

  async listProposals(runId: string): Promise<MemoryProposal[]> {
    return this.listStoredProposalsForRun(runId);
  }

  async generateProposalsForRun(runId: string): Promise<MemoryProposal[]> {
    const activeGeneration = this.generationLocks.get(runId);
    if (activeGeneration) {
      return activeGeneration;
    }

    const generation = this.generateProposalsForRunLocked(runId);
    this.generationLocks.set(runId, generation);
    try {
      return await generation;
    } finally {
      if (this.generationLocks.get(runId) === generation) {
        this.generationLocks.delete(runId);
      }
    }
  }

  private async generateProposalsForRunLocked(
    runId: string
  ): Promise<MemoryProposal[]> {
    const { run } = await this.requireRunAndTask(runId);
    if (run.status === "succeeded") {
      await generateMemoryProposalsFromCompletedRun(
        {
          taskRunRepository: this.context.repositories.taskRunRepository,
          taskRepository: this.context.repositories.taskRepository,
          runArtifactRepository: this.context.repositories.runArtifactRepository,
          verificationResultRepository:
            this.context.repositories.verificationResultRepository,
          riskReportRepository: this.context.repositories.riskReportRepository,
          memoryItemRepository: this.context.repositories.memoryItemRepository
        },
        {
          runId,
          idGenerator: {
            nextId: (prefix) => this.context.nextId(prefix)
          },
          clock: {
            now: () => this.context.now()
          }
        }
      );
    }
    return this.listStoredProposalsForRun(runId);
  }

  private async listStoredProposalsForRun(runId: string): Promise<MemoryProposal[]> {
    const { task } = await this.requireRunAndTask(runId);
    const project = await this.projects.get(task.projectId);
    if (!project) {
      throw new Error(`project ${task.projectId} not found`);
    }
    const approvedMemoryPath = this.approvedMemoryPath(project);
    const projectItems = await this.memory.listByProjectId(project.id);
    return toMemoryProposalsForTask(
      runId,
      projectItems,
      task.id,
      approvedMemoryPath
    );
  }

  async approve(ids: string[]): Promise<MemoryApprovalResult[]> {
    const results: MemoryApprovalResult[] = [];
    for (const id of ids) {
      const existing = await this.memory.get(id);
      if (!existing) {
        results.push({
          id,
          status: "skipped",
          writeback: "skipped",
          message: `memory item ${id} not found`
        });
        continue;
      }
      if (existing.status === "rejected") {
        results.push({
          id,
          content: existing.content,
          status: "skipped",
          writeback: "skipped",
          message: "Rejected memory is not written to the approved context store."
        });
        continue;
      }
      const approvedAt =
        existing.status === "approved" ? existing.updatedAt : this.context.now();
      const item =
        existing.status === "approved"
          ? existing
          : await this.memory.updateStatus(id, "approved", approvedAt);
      const project = await this.projects.get(item.projectId);
      if (!project) {
        throw new Error(`project ${item.projectId} not found`);
      }
      const writeback = await appendApprovedMemory({
        projectRoot: project.rootPath,
        projectId: project.id,
        memoryId: item.id,
        content: item.content,
        approvedAt,
        agentHubHome: this.context.agentHubHome
      });
      results.push({
        id: item.id,
        content: item.content,
        status: "approved",
        approvedMemoryPath: writeback.path,
        writeback: writeback.written ? "written" : "already_present",
        message: writeback.written
          ? "Approved memory was written to the Agent Hub context store."
          : "Approved memory was already present in the Agent Hub context store."
      });
    }
    return results;
  }

  async ignore(ids: string[]): Promise<void> {
    for (const id of ids) {
      const item = await this.memory.get(id);
      if (item?.status === "proposed") {
        await this.memory.updateStatus(id, "rejected", this.context.now());
      }
    }
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

  private approvedMemoryPath(project: Project): string {
    return resolveApprovedMemoryPath({
      projectRoot: project.rootPath,
      projectId: project.id,
      agentHubHome: this.context.agentHubHome
    }).path;
  }
}

function toMemoryProposal(
  runId: string,
  item: MemoryItem,
  approvedMemoryPath?: string
): MemoryProposal {
  const status =
    item.status === "approved"
      ? "approved"
      : item.status === "rejected"
        ? "ignored"
        : "pending";
  return {
    id: item.id,
    runId,
    content: item.content,
    rationale: rationaleFor(item.content),
    source: sourceFor(item.content),
    status,
    createdAt: item.createdAt,
    decidedAt: status === "pending" ? undefined : item.updatedAt,
    approvedMemoryPath:
      status === "approved" ? approvedMemoryPath : undefined
  };
}

function toMemoryProposalsForTask(
  runId: string,
  items: MemoryItem[],
  taskId: string,
  approvedMemoryPath?: string
): MemoryProposal[] {
  return uniqueMemoryItemsForTask(items, taskId).map((item) =>
    toMemoryProposal(runId, item, approvedMemoryPath)
  );
}

function uniqueMemoryItemsForTask(
  items: MemoryItem[],
  taskId: string
): MemoryItem[] {
  const byContent = new Map<string, MemoryItem>();
  for (const item of items) {
    if (item.taskId !== taskId) {
      continue;
    }
    const normalizedContent = normalizeMemoryContent(item.content);
    const existing = byContent.get(normalizedContent);
    if (!existing || prefersMemoryItem(item, existing)) {
      byContent.set(normalizedContent, item);
    }
  }
  return [...byContent.values()].sort((left, right) =>
    left.createdAt === right.createdAt
      ? left.id.localeCompare(right.id)
      : left.createdAt.localeCompare(right.createdAt)
  );
}

function prefersMemoryItem(candidate: MemoryItem, current: MemoryItem): boolean {
  const candidateRank = memoryStatusRank(candidate.status);
  const currentRank = memoryStatusRank(current.status);
  if (candidateRank !== currentRank) {
    return candidateRank > currentRank;
  }
  if (candidate.createdAt !== current.createdAt) {
    return candidate.createdAt < current.createdAt;
  }
  return candidate.id < current.id;
}

function memoryStatusRank(status: MemoryItem["status"]): number {
  if (status === "approved") {
    return 3;
  }
  if (status === "rejected") {
    return 2;
  }
  return 1;
}

function rationaleFor(content: string): string {
  if (/pnpm/.test(content)) {
    return "Detected from the registered project's package manager files.";
  }
  if (/Verification command/.test(content)) {
    return "Detected from verification results captured for the run.";
  }
  if (/renderer/.test(content)) {
    return "Matches the desktop sandbox boundary enforced for this phase.";
  }
  return "Matches Agent Hub's local-first context delivery constraints.";
}

function sourceFor(content: string): MemoryProposalSource {
  if (/Verification command/.test(content)) {
    return "verification";
  }
  return "run";
}
