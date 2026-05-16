import type { AgentAdapter } from "./agent-adapters";
import type { DiffCollectionResult } from "./diff-collector";
import type { AgentKind, Task, TaskRun, TaskRunStatus, TaskStatus } from "./domain";
import type { RiskReport } from "./domain";
import type { VerificationSuiteResult } from "./verification";
import type { WorkspaceCleanupResult, Workspace } from "./workspace";

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

export interface RunMetadata {
  runId: string;
  workspace?: Workspace;
  workspaceCleanup?: WorkspaceCleanupResult;
  diff?: DiffCollectionResult;
  verification?: VerificationSuiteResult;
  riskReport?: RiskReport;
}

export interface RunMetadataRepository {
  save(metadata: RunMetadata): Promise<RunMetadata>;
  get(runId: string): Promise<RunMetadata | undefined>;
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

export class InMemoryRunMetadataRepository implements RunMetadataRepository {
  private readonly metadata = new Map<string, RunMetadata>();

  async save(metadata: RunMetadata): Promise<RunMetadata> {
    const existing = this.metadata.get(metadata.runId);
    const updated = { ...existing, ...metadata };
    this.metadata.set(metadata.runId, cloneRunMetadata(updated));
    return cloneRunMetadata(updated);
  }

  async get(runId: string): Promise<RunMetadata | undefined> {
    const metadata = this.metadata.get(runId);
    return metadata ? cloneRunMetadata(metadata) : undefined;
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

export function cloneRunMetadata(metadata: RunMetadata): RunMetadata {
  return {
    ...metadata,
    workspace: metadata.workspace ? { ...metadata.workspace } : undefined,
    workspaceCleanup: metadata.workspaceCleanup
      ? {
          ...metadata.workspaceCleanup,
          commands: metadata.workspaceCleanup.commands.map((command) => ({ ...command }))
        }
      : undefined,
    diff: metadata.diff
      ? {
          ...metadata.diff,
          changedFiles: metadata.diff.changedFiles.map((file) => ({ ...file })),
          stat: { ...metadata.diff.stat },
          fileSummaries: [...metadata.diff.fileSummaries],
          commands: metadata.diff.commands.map((command) => ({ ...command }))
        }
      : undefined,
    verification: metadata.verification
      ? {
          ...metadata.verification,
          results: metadata.verification.results.map((result) => ({ ...result })),
          failedCommands: metadata.verification.failedCommands.map((result) => ({
            ...result
          }))
        }
      : undefined,
    riskReport: metadata.riskReport
      ? {
          ...metadata.riskReport,
          changedFiles: [...metadata.riskReport.changedFiles],
          failedChecks: [...metadata.riskReport.failedChecks],
          riskFactors: [...metadata.riskReport.riskFactors],
          manualReviewChecklist: [...metadata.riskReport.manualReviewChecklist],
          findings: metadata.riskReport.findings.map((finding) => ({ ...finding }))
        }
      : undefined
  };
}
