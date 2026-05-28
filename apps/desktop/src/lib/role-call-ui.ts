import type {
  RoleCall,
  RoleCallEvent,
  RoleCallStatus,
  RoleResultCommand,
  RoleTodo,
  RoleTodoStatus
} from "@agent-hub/shared";
import type {
  RoleCallUiCall,
  RoleCallUiDecision,
  RoleCallUiEvidenceItem,
  RoleCallUiEvent,
  RoleCallUiSummary,
  RoleCallUiTodo,
  TimelineEventTone
} from "./types";

export interface RoleCallUiSummaryInput {
  threadId: string;
  sourceMessageId?: string;
  calls: readonly RoleCall[];
  todos: readonly RoleTodo[];
  events: readonly RoleCallEvent[];
  updatedAt?: string;
}

export interface RoleCallAffordance {
  label: string;
  tone: TimelineEventTone;
  needsReview: boolean;
}

const activeRoleCallStatuses = new Set<RoleCallStatus>([
  "proposed",
  "assessing",
  "accepted",
  "queued",
  "running",
  "waiting_context",
  "waiting_approval"
]);

export function buildRoleCallUiSummary(
  input: RoleCallUiSummaryInput
): RoleCallUiSummary {
  const sourceCallIds = new Set(input.calls.map((call) => call.id));
  const todos = input.todos
    .filter(
      (todo) =>
        !todo.sourceRoleCallId || sourceCallIds.has(todo.sourceRoleCallId)
    )
    .map(toUiTodo);
  const events = input.events
    .filter((event) => sourceCallIds.has(event.roleCallId))
    .map(toUiEvent);
  const calls = input.calls.map((call) => toUiCall(call));

  return {
    threadId: input.threadId,
    sourceMessageId: input.sourceMessageId,
    counts: {
      total: calls.length,
      running: calls.filter((call) => activeRoleCallStatuses.has(call.status)).length,
      deferred: calls.filter((call) => call.status === "deferred").length,
      rejected: calls.filter((call) => call.status === "rejected").length,
      waitingApproval: calls.filter(
        (call) => call.status === "waiting_approval"
      ).length,
      succeeded: calls.filter((call) => call.status === "succeeded").length,
      failed: calls.filter((call) => call.status === "failed").length,
      todosOpen: todos.filter((todo) =>
        ["open", "in_progress", "deferred"].includes(todo.status)
      ).length,
      todosBlocked: todos.filter((todo) => todo.status === "blocked").length
    },
    calls,
    todos,
    events,
    updatedAt: input.updatedAt
  };
}

export function roleCallAffordance(
  summary: RoleCallUiSummary
): RoleCallAffordance {
  const parts = [`${summary.counts.total} role call${summary.counts.total === 1 ? "" : "s"}`];
  if (summary.counts.running > 0) {
    parts.push(`${summary.counts.running} active`);
  }
  if (summary.counts.deferred > 0) {
    parts.push(`${summary.counts.deferred} deferred`);
  }
  if (summary.counts.rejected > 0) {
    parts.push(`${summary.counts.rejected} rejected`);
  }
  if (summary.counts.todosOpen > 0) {
    parts.push(`${summary.counts.todosOpen} todo${summary.counts.todosOpen === 1 ? "" : "s"}`);
  }
  const needsReview =
    summary.counts.waitingApproval > 0 ||
    summary.counts.deferred > 0 ||
    summary.counts.rejected > 0 ||
    summary.counts.failed > 0 ||
    summary.counts.todosBlocked > 0;
  if (needsReview) {
    parts.push("review needed");
  }
  return {
    label: parts.join(" · "),
    tone: roleCallSummaryTone(summary),
    needsReview
  };
}

export function roleCallSummaryFromMetadata(
  value: unknown
): RoleCallUiSummary | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const counts = value.counts;
  if (
    typeof value.threadId !== "string" ||
    !isRecord(counts) ||
    typeof counts.total !== "number" ||
    !Array.isArray(value.calls) ||
    !Array.isArray(value.todos) ||
    !Array.isArray(value.events)
  ) {
    return undefined;
  }
  return value as unknown as RoleCallUiSummary;
}

export function roleCallStatusTone(status: RoleCallStatus): TimelineEventTone {
  if (status === "succeeded") {
    return "success";
  }
  if (status === "failed" || status === "rejected" || status === "cancelled") {
    return "danger";
  }
  if (
    status === "deferred" ||
    status === "waiting_approval" ||
    status === "waiting_context"
  ) {
    return "warning";
  }
  if (status === "running" || status === "queued" || status === "accepted") {
    return "info";
  }
  return "neutral";
}

export function roleTodoStatusTone(status: RoleTodoStatus): TimelineEventTone {
  if (status === "done") {
    return "success";
  }
  if (status === "rejected" || status === "cancelled") {
    return "danger";
  }
  if (status === "blocked" || status === "deferred") {
    return "warning";
  }
  if (status === "in_progress") {
    return "info";
  }
  return "neutral";
}

function toUiCall(call: RoleCall): RoleCallUiCall {
  const decision = call.decision
    ? {
        disposition: call.decision.disposition,
        reason: call.decision.reason,
        evidence: call.decision.evidence ?? [],
        requiredContext: call.decision.requiredContext ?? [],
        risk: call.decision.risk
      } satisfies RoleCallUiDecision
    : undefined;

  return {
    id: call.id,
    callerRole: call.callerRole,
    calleeRole: call.calleeRole,
    task: call.task,
    status: call.status,
    priority: call.priority,
    depth: call.depth,
    taskRunId: call.taskRunId,
    todoId: call.todoId,
    decision,
    resultSummary: call.result?.summary,
    error: call.error,
    evidence: roleCallEvidence(call),
    rawJson: compactRawJson(call),
    createdAt: call.createdAt,
    startedAt: call.startedAt,
    completedAt: call.completedAt
  };
}

function toUiTodo(todo: RoleTodo): RoleCallUiTodo {
  return {
    id: todo.id,
    role: todo.role,
    title: todo.title,
    status: todo.status,
    priority: todo.priority,
    sourceRoleCallId: todo.sourceRoleCallId,
    reason: todo.reason,
    updatedAt: todo.updatedAt
  };
}

function toUiEvent(event: RoleCallEvent): RoleCallUiEvent {
  return {
    id: event.id,
    roleCallId: event.roleCallId,
    type: event.type,
    actorRole: event.actorRole,
    message: event.message,
    createdAt: event.createdAt
  };
}

function roleCallEvidence(call: RoleCall): RoleCallUiEvidenceItem[] {
  const evidence: RoleCallUiEvidenceItem[] = [];
  call.decision?.evidence?.forEach((entry, index) => {
    evidence.push({
      id: `${call.id}:decision-evidence:${index}`,
      kind: "evidence",
      label: entry,
      tone: "info",
      runId: call.taskRunId
    });
  });
  call.result?.evidence.forEach((entry, index) => {
    evidence.push({
      id: `${call.id}:result-evidence:${index}`,
      kind: "evidence",
      label: entry,
      tone: "info",
      runId: call.taskRunId
    });
  });
  call.result?.commandsRun?.forEach((command, index) => {
    evidence.push(commandEvidenceItem(call, command, index));
  });
  call.result?.filesRead?.forEach((file, index) => {
    evidence.push({
      id: `${call.id}:file-read:${index}`,
      kind: "file",
      label: file,
      summary: "read",
      tone: "neutral",
      path: file,
      runId: call.taskRunId
    });
  });
  call.result?.filesTouched?.forEach((file, index) => {
    evidence.push({
      id: `${call.id}:file-touched:${index}`,
      kind: "file",
      label: file,
      summary: "touched",
      tone: "warning",
      path: file,
      runId: call.taskRunId
    });
  });
  call.result?.risks?.forEach((risk, index) => {
    evidence.push({
      id: `${call.id}:risk:${index}`,
      kind: "risk",
      label: risk,
      tone: "warning",
      runId: call.taskRunId
    });
  });
  if (call.error) {
    evidence.push({
      id: `${call.id}:error`,
      kind: "risk",
      label: call.error,
      tone: "danger",
      runId: call.taskRunId
    });
  }
  if (call.result?.rawOutput) {
    evidence.push({
      id: `${call.id}:raw-output`,
      kind: "raw_json",
      label: "Bounded raw output available",
      summary: call.result.rawOutput.slice(0, 240),
      tone: "neutral",
      runId: call.taskRunId
    });
  }
  return evidence;
}

function commandEvidenceItem(
  call: RoleCall,
  command: RoleResultCommand,
  index: number
): RoleCallUiEvidenceItem {
  return {
    id: `${call.id}:command:${index}`,
    kind: "command",
    label: command.command,
    summary: `exit ${command.exitCode ?? "unknown"} · ${command.outputSummary}`,
    tone: command.exitCode === 0 ? "success" : "warning",
    command: command.command,
    runId: call.taskRunId
  };
}

function compactRawJson(call: RoleCall): string | undefined {
  if (!call.decision && !call.result && !call.error) {
    return undefined;
  }
  return JSON.stringify(
    {
      decision: call.decision,
      result: call.result,
      error: call.error
    },
    null,
    2
  );
}

function roleCallSummaryTone(summary: RoleCallUiSummary): TimelineEventTone {
  if (
    summary.counts.failed > 0 ||
    summary.counts.rejected > 0 ||
    summary.counts.todosBlocked > 0
  ) {
    return "danger";
  }
  if (summary.counts.deferred > 0 || summary.counts.waitingApproval > 0) {
    return "warning";
  }
  if (summary.counts.running > 0) {
    return "info";
  }
  if (summary.counts.total > 0 && summary.counts.total === summary.counts.succeeded) {
    return "success";
  }
  return "neutral";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
