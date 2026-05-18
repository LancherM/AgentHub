import type {
  MemoryItemRepository,
  TaskRepository,
  TaskRunRepository
} from "@agent-hub/core";
import type { MemoryProposal } from "../../src/lib/types";
import type { DesktopServiceContext } from "./project-service";

export interface MemoryService {
  listProposals(runId: string): Promise<MemoryProposal[]>;
  approve(ids: string[]): Promise<void>;
  ignore(ids: string[]): Promise<void>;
}

export function createMemoryService(context: DesktopServiceContext): MemoryService {
  return new RepositoryMemoryService(
    context.repositories.taskRunRepository,
    context.repositories.taskRepository,
    context.repositories.memoryItemRepository,
    context
  );
}

class RepositoryMemoryService implements MemoryService {
  constructor(
    private readonly runs: TaskRunRepository,
    private readonly tasks: TaskRepository,
    private readonly memory: MemoryItemRepository,
    private readonly context: DesktopServiceContext
  ) {}

  async listProposals(runId: string): Promise<MemoryProposal[]> {
    const run = await this.runs.get(runId);
    if (!run) {
      throw new Error(`run ${runId} not found`);
    }
    const task = await this.tasks.get(run.taskId);
    if (!task) {
      throw new Error(`task ${run.taskId} not found`);
    }
    const items = await this.memory.listByProjectId(task.projectId);
    return items
      .filter((item) => item.status === "proposed")
      .filter((item) => item.taskId === undefined || item.taskId === task.id)
      .map((item) => ({
        id: item.id,
        projectId: item.projectId,
        taskId: item.taskId,
        category: item.category,
        content: item.content,
        createdAt: item.createdAt
      }));
  }

  async approve(ids: string[]): Promise<void> {
    for (const id of ids) {
      const item = await this.memory.get(id);
      if (item?.status === "proposed") {
        // TODO: Wire the desktop approval path to approved-memory writeback in
        // Agent Hub-owned context storage after the UI exposes a confirmation
        // surface for the exact long-term memory write.
        await this.memory.updateStatus(id, "approved", this.context.now());
      }
    }
  }

  async ignore(ids: string[]): Promise<void> {
    for (const id of ids) {
      const item = await this.memory.get(id);
      if (item?.status === "proposed") {
        await this.memory.updateStatus(id, "rejected", this.context.now());
      }
    }
  }
}
