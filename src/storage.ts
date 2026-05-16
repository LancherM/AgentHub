import type { AgentAdapter } from "./agent-adapters";
import type { AgentKind, Task, TaskRun, TaskRunStatus, TaskStatus } from "./domain";

export type RunStatus = TaskRunStatus;

export interface RunStatusTransition {
  runId: string;
  status: RunStatus;
  at: string;
}

export interface TaskRepository {
  create(task: Task): Promise<Task>;
  updateStatus(taskId: string, status: TaskStatus, updatedAt: string): Promise<Task>;
  get(taskId: string): Promise<Task | undefined>;
  list(): Promise<Task[]>;
}

export interface TaskRunRepository {
  create(run: TaskRun): Promise<TaskRun>;
  updateExecutionPaths(
    runId: string,
    paths: { worktreePath?: string; branchName?: string },
    updatedAt: string
  ): Promise<TaskRun>;
  updateStatus(runId: string, status: RunStatus, updatedAt: string): Promise<TaskRun>;
  get(runId: string): Promise<TaskRun | undefined>;
  list(): Promise<TaskRun[]>;
  listByTaskId(taskId: string): Promise<TaskRun[]>;
  getStatusTransitions(runId: string): Promise<RunStatusTransition[]>;
}

export class InMemoryTaskRepository implements TaskRepository {
  private readonly tasks = new Map<string, Task>();

  async create(task: Task): Promise<Task> {
    this.tasks.set(task.id, { ...task });
    return { ...task };
  }

  async updateStatus(
    taskId: string,
    status: TaskStatus,
    updatedAt: string
  ): Promise<Task> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`task ${taskId} not found`);
    }
    const updated = { ...task, status, updatedAt };
    this.tasks.set(taskId, updated);
    return { ...updated };
  }

  async get(taskId: string): Promise<Task | undefined> {
    const task = this.tasks.get(taskId);
    return task ? { ...task } : undefined;
  }

  async list(): Promise<Task[]> {
    return [...this.tasks.values()]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((task) => ({ ...task }));
  }
}

export class InMemoryTaskRunRepository implements TaskRunRepository {
  private readonly runs = new Map<string, TaskRun>();
  private readonly transitions = new Map<string, RunStatusTransition[]>();

  async create(run: TaskRun): Promise<TaskRun> {
    this.runs.set(run.id, { ...run });
    this.transitions.set(run.id, [
      { runId: run.id, status: run.status, at: run.createdAt }
    ]);
    return { ...run };
  }

  async updateExecutionPaths(
    runId: string,
    paths: { worktreePath?: string; branchName?: string },
    updatedAt: string
  ): Promise<TaskRun> {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`task run ${runId} not found`);
    }
    const updated: TaskRun = {
      ...run,
      ...paths,
      updatedAt
    };
    this.runs.set(runId, updated);
    return { ...updated };
  }

  async updateStatus(
    runId: string,
    status: RunStatus,
    updatedAt: string
  ): Promise<TaskRun> {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`task run ${runId} not found`);
    }
    const updated: TaskRun = {
      ...run,
      status,
      updatedAt,
      completedAt: isTerminalRunStatus(status) ? updatedAt : run.completedAt
    };
    this.runs.set(runId, updated);
    this.transitions.set(runId, [
      ...(this.transitions.get(runId) ?? []),
      { runId, status, at: updatedAt }
    ]);
    return { ...updated };
  }

  async get(runId: string): Promise<TaskRun | undefined> {
    const run = this.runs.get(runId);
    return run ? { ...run } : undefined;
  }

  async list(): Promise<TaskRun[]> {
    return [...this.runs.values()]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((run) => ({ ...run }));
  }

  async listByTaskId(taskId: string): Promise<TaskRun[]> {
    return (await this.list()).filter((run) => run.taskId === taskId);
  }

  async getStatusTransitions(runId: string): Promise<RunStatusTransition[]> {
    return [...(this.transitions.get(runId) ?? [])].map((transition) => ({
      ...transition
    }));
  }
}

export interface AgentRegistry {
  get(agentKind: AgentKind): AgentAdapter | undefined;
  list(): AgentAdapter[];
}

export class DefaultAgentRegistry implements AgentRegistry {
  private readonly adapters = new Map<AgentKind, AgentAdapter>();

  constructor(adapters: AgentAdapter[] = []) {
    for (const adapter of adapters) {
      this.adapters.set(adapter.kind, adapter);
    }
  }

  get(agentKind: AgentKind): AgentAdapter | undefined {
    return this.adapters.get(agentKind);
  }

  list(): AgentAdapter[] {
    return [...this.adapters.values()].sort((left, right) =>
      left.kind.localeCompare(right.kind)
    );
  }
}

function isTerminalRunStatus(status: RunStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}
