import {
  validateComparisonReport,
  type ComparisonReport as CoreComparisonReport,
  type ComparisonReportRepository,
  type ConversationMessage,
  type ConversationMessageRepository,
  type ConversationThreadRepository,
  type TaskRepository,
  type TaskRun,
  type TaskRunRepository
} from "@agent-hub/core";
import { buildComparisonReport } from "@agent-hub/task-runner";
import type {
  AgentKind,
  JsonObject,
  TaskRunStatus as CoreRunStatus
} from "@agent-hub/shared";
import type {
  AgentId,
  ComparisonCandidate,
  ComparisonCreateInput,
  ComparisonReport,
  ComparisonScopeKind,
  ComparisonStructuredSignals,
  RunStatus
} from "../../src/lib/types";
import type { DesktopServiceContext } from "./project-service";

export interface ComparisonService {
  listCandidates(runId: string): Promise<ComparisonCandidate[]>;
  listForRun(runId: string): Promise<ComparisonReport[]>;
  createComparison(input: ComparisonCreateInput): Promise<ComparisonReport>;
}

interface ComparisonScope {
  kind: ComparisonScopeKind;
  threadId?: string;
  userMessageId?: string;
  runIds?: string[];
}

export function createComparisonService(
  context: DesktopServiceContext
): ComparisonService {
  return new RepositoryComparisonService(context);
}

class RepositoryComparisonService implements ComparisonService {
  private readonly tasks: TaskRepository;
  private readonly runs: TaskRunRepository;
  private readonly reports: ComparisonReportRepository;
  private readonly threads: ConversationThreadRepository;
  private readonly messages: ConversationMessageRepository;

  constructor(private readonly context: DesktopServiceContext) {
    this.tasks = context.repositories.taskRepository;
    this.runs = context.repositories.taskRunRepository;
    this.reports = context.repositories.comparisonReportRepository;
    this.threads = context.repositories.conversationThreadRepository;
    this.messages = context.repositories.conversationMessageRepository;
  }

  async listCandidates(runId: string): Promise<ComparisonCandidate[]> {
    const source = await this.requireRun(runId);
    if (!isTerminalCoreStatus(source.status)) {
      return [];
    }

    const candidates = new Map<string, ComparisonCandidate>();
    const sameTaskRuns = await this.runs.listByTaskId(source.taskId);
    for (const run of sameTaskRuns) {
      if (run.id === source.id || !isTerminalCoreStatus(run.status)) {
        continue;
      }
      const candidate = await this.toCandidate(run, "task");
      if (candidate) {
        candidates.set(candidate.runId, candidate);
      }
    }

    const turn = await this.findConversationTurnContaining([source.id]);
    if (turn) {
      for (const turnRunId of turn.runIds ?? []) {
        if (turnRunId === source.id || candidates.has(turnRunId)) {
          continue;
        }
        const run = await this.runs.get(turnRunId);
        if (!run || !isTerminalCoreStatus(run.status)) {
          continue;
        }
        const candidate = await this.toCandidate(run, "conversation_turn");
        if (candidate) {
          candidates.set(candidate.runId, candidate);
        }
      }
    }

    return [...candidates.values()].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt)
    );
  }

  async listForRun(runId: string): Promise<ComparisonReport[]> {
    await this.requireRun(runId);
    const reports = await this.reports.listByRunId(runId);
    return reports.map(toDesktopComparisonReport);
  }

  async createComparison(input: ComparisonCreateInput): Promise<ComparisonReport> {
    const baselineRunId = parseId(input.baselineRunId, "baselineRunId");
    const candidateRunId = parseId(input.candidateRunId, "candidateRunId");
    if (baselineRunId === candidateRunId) {
      throw new Error("candidateRunId must be different from baselineRunId");
    }

    const baseline = await this.requireRun(baselineRunId);
    const candidate = await this.requireRun(candidateRunId);
    const scope = await this.resolveScope(baseline, candidate);
    const comparison = await buildComparisonReport(
      {
        taskRepository: this.context.repositories.taskRepository,
        taskRunRepository: this.context.repositories.taskRunRepository,
        runArtifactRepository: this.context.repositories.runArtifactRepository,
        runMetadataRepository: this.context.repositories.runMetadataRepository,
        verificationResultRepository:
          this.context.repositories.verificationResultRepository,
        riskReportRepository: this.context.repositories.riskReportRepository
      },
      {
        taskId: baseline.taskId,
        baselineRunId,
        candidateRunId,
        allowRunTaskMismatch: scope.kind === "conversation_turn"
      }
    );
    const report = await this.reports.create(
      validateComparisonReport({
        id: this.context.nextId("comparison"),
        taskId: baseline.taskId,
        baselineRunId,
        candidateRunId,
        summary: comparison.summary,
        details: withDesktopScope(comparison.details, scope, baseline, candidate),
        createdAt: this.context.now()
      })
    );
    return toDesktopComparisonReport(report);
  }

  private async requireRun(runId: string): Promise<TaskRun> {
    const run = await this.runs.get(runId);
    if (!run) {
      throw new Error(`run ${runId} not found`);
    }
    return run;
  }

  private async resolveScope(
    baseline: TaskRun,
    candidate: TaskRun
  ): Promise<ComparisonScope> {
    if (!isTerminalCoreStatus(baseline.status)) {
      throw new Error(`baseline run ${baseline.id} must be terminal before comparison`);
    }
    if (!isTerminalCoreStatus(candidate.status)) {
      throw new Error(`candidate run ${candidate.id} must be terminal before comparison`);
    }
    if (baseline.taskId === candidate.taskId) {
      return { kind: "task" };
    }
    const turn = await this.findConversationTurnContaining([
      baseline.id,
      candidate.id
    ]);
    if (turn) {
      return turn;
    }
    throw new Error(
      "runs must belong to the same task or the same multi-agent desktop turn"
    );
  }

  private async findConversationTurnContaining(
    requiredRunIds: string[]
  ): Promise<ComparisonScope | undefined> {
    const required = new Set(requiredRunIds);
    for (const thread of await this.threads.list()) {
      const messages = await this.messages.listByThreadId(thread.id);
      let userMessageId: string | undefined;
      let runIds: string[] = [];

      const maybeMatch = (): ComparisonScope | undefined => {
        if (!userMessageId) {
          return undefined;
        }
        return [...required].every((runId) => runIds.includes(runId))
          ? {
              kind: "conversation_turn",
              threadId: thread.id,
              userMessageId,
              runIds: [...runIds]
            }
          : undefined;
      };

      for (const message of messages) {
        if (message.role === "user") {
          const found = maybeMatch();
          if (found) {
            return found;
          }
          userMessageId = message.id;
          runIds = [];
          continue;
        }
        if (isRunCardMessage(message) && userMessageId) {
          runIds.push(message.runId);
        }
      }

      const found = maybeMatch();
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  private async toCandidate(
    run: TaskRun,
    scope: ComparisonScopeKind
  ): Promise<ComparisonCandidate | undefined> {
    const task = await this.tasks.get(run.taskId);
    if (!task) {
      return undefined;
    }
    return {
      runId: run.id,
      taskId: run.taskId,
      agentId: toAgentId(run.agentKind),
      status: toDesktopRunStatus(run.status),
      title: task.title,
      scope,
      createdAt: run.createdAt
    };
  }
}

function isRunCardMessage(
  message: ConversationMessage
): message is ConversationMessage & { runId: string } {
  return message.kind === "run_card" && typeof message.runId === "string";
}

function withDesktopScope(
  details: JsonObject,
  scope: ComparisonScope,
  baseline: TaskRun,
  candidate: TaskRun
): JsonObject {
  return {
    ...details,
    desktopScope: {
      kind: scope.kind,
      threadId: scope.threadId,
      userMessageId: scope.userMessageId,
      runIds: scope.runIds,
      baselineTaskId: baseline.taskId,
      candidateTaskId: candidate.taskId
    }
  };
}

function toDesktopComparisonReport(
  report: CoreComparisonReport
): ComparisonReport {
  const details = report.details as ComparisonStructuredSignals | undefined;
  return {
    id: report.id,
    taskId: report.taskId,
    baselineRunId: report.baselineRunId,
    candidateRunId: report.candidateRunId,
    summary: report.summary,
    details,
    scope: scopeFromDetails(report.details),
    createdAt: report.createdAt
  };
}

function scopeFromDetails(details: JsonObject | undefined): ComparisonScopeKind {
  const scope = details?.desktopScope;
  if (
    scope &&
    typeof scope === "object" &&
    !Array.isArray(scope) &&
    (scope as { kind?: unknown }).kind === "conversation_turn"
  ) {
    return "conversation_turn";
  }
  return "task";
}

function parseId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function isTerminalCoreStatus(status: CoreRunStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function toDesktopRunStatus(status: CoreRunStatus): RunStatus {
  if (status === "succeeded") {
    return "completed";
  }
  return status;
}

function toAgentId(agentKind: AgentKind): AgentId {
  return agentKind === "claude-code" ? "claude" : agentKind;
}
