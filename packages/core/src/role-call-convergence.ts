import {
  type RoleCall,
  type RoleCallEvent,
  type RoleTodo
} from "./domain";
import {
  summarizeRoleCallDecision,
  summarizeRoleResult
} from "./role-call-context";
import type {
  RoleCallEventRepository,
  RoleCallRepository,
  RoleTodoRepository
} from "./storage";

export interface CallerReinjectionRepositories {
  roleCallRepository: RoleCallRepository;
  roleCallEventRepository: RoleCallEventRepository;
  roleTodoRepository: RoleTodoRepository;
}

export interface CallerReinjectionInput {
  threadId: string;
  callerRole: string;
  maxEvents?: number;
}

export interface CallerReinjectionContext {
  decisionSummaries: string[];
  resultSummaries: string[];
  todoSummaries: string[];
  eventSummaries: string[];
  pendingRoleCallIds: string[];
  blockingApprovalRoleCallIds: string[];
}

export async function buildCallerReinjectionContext(
  repositories: CallerReinjectionRepositories,
  input: CallerReinjectionInput
): Promise<CallerReinjectionContext> {
  const [calls, todos, events] = await Promise.all([
    repositories.roleCallRepository.list({ threadId: input.threadId }),
    repositories.roleTodoRepository.list({ threadId: input.threadId }),
    repositories.roleCallEventRepository.listByThreadId(input.threadId)
  ]);
  const relatedCalls = calls.filter(
    (call) =>
      call.callerRole === input.callerRole || call.calleeRole === input.callerRole
  );
  const relatedCallIds = new Set(relatedCalls.map((call) => call.id));
  const relatedTodos = todos.filter(
    (todo) =>
      todo.role === input.callerRole ||
      (todo.sourceRoleCallId && relatedCallIds.has(todo.sourceRoleCallId))
  );
  const relatedEvents = events
    .filter((event) => relatedCallIds.has(event.roleCallId))
    .slice(-(input.maxEvents ?? 8));

  return {
    decisionSummaries: relatedCalls
      .filter((call) => call.decision)
      .map((call) =>
        `@${call.callerRole} -> @${call.calleeRole}: ${summarizeRoleCallDecision(
          call.decision as NonNullable<RoleCall["decision"]>
        )}`
      ),
    resultSummaries: relatedCalls
      .filter((call) => call.result)
      .map((call) =>
        `@${call.calleeRole}: ${summarizeRoleResult(
          call.result as NonNullable<RoleCall["result"]>
        )}`
      ),
    todoSummaries: relatedTodos.map(summarizeTodo),
    eventSummaries: relatedEvents.map(summarizeEvent),
    pendingRoleCallIds: relatedCalls.filter(isPendingRoleCall).map((call) => call.id),
    blockingApprovalRoleCallIds: relatedCalls
      .filter((call) => call.status === "waiting_approval")
      .map((call) => call.id)
  };
}

export type RoleCallGraphConvergenceReason =
  | "final_answer"
  | "idle"
  | "pending_role_calls"
  | "blocking_approval"
  | "continuation_limit";

export interface RoleCallGraphConvergenceInput {
  roleCalls: readonly RoleCall[];
  finalAnswer?: string;
  continuationCount?: number;
  maxContinuations?: number;
}

export interface RoleCallGraphConvergence {
  converged: boolean;
  reason: RoleCallGraphConvergenceReason;
  pendingRoleCallIds: string[];
  blockingApprovalRoleCallIds: string[];
}

export function evaluateRoleCallGraphConvergence(
  input: RoleCallGraphConvergenceInput
): RoleCallGraphConvergence {
  if (input.finalAnswer && input.finalAnswer.trim().length > 0) {
    return {
      converged: true,
      reason: "final_answer",
      pendingRoleCallIds: [],
      blockingApprovalRoleCallIds: []
    };
  }
  if (
    input.maxContinuations !== undefined &&
    (input.continuationCount ?? 0) >= input.maxContinuations
  ) {
    return {
      converged: true,
      reason: "continuation_limit",
      pendingRoleCallIds: [],
      blockingApprovalRoleCallIds: []
    };
  }

  const pendingRoleCallIds = input.roleCalls
    .filter(isPendingRoleCall)
    .map((call) => call.id);
  if (pendingRoleCallIds.length > 0) {
    return {
      converged: false,
      reason: "pending_role_calls",
      pendingRoleCallIds,
      blockingApprovalRoleCallIds: []
    };
  }
  const blockingApprovalRoleCallIds = input.roleCalls
    .filter((call) => call.status === "waiting_approval")
    .map((call) => call.id);
  if (blockingApprovalRoleCallIds.length > 0) {
    return {
      converged: false,
      reason: "blocking_approval",
      pendingRoleCallIds: [],
      blockingApprovalRoleCallIds
    };
  }
  return {
    converged: true,
    reason: "idle",
    pendingRoleCallIds: [],
    blockingApprovalRoleCallIds: []
  };
}

export interface CallerContinuationDecision {
  continueCaller: boolean;
  reason: RoleCallGraphConvergenceReason;
}

export function decideCallerContinuation(input: {
  convergence: RoleCallGraphConvergence;
  continuationCount: number;
  maxContinuations: number;
}): CallerContinuationDecision {
  if (input.continuationCount >= input.maxContinuations) {
    return { continueCaller: false, reason: "continuation_limit" };
  }
  if (!input.convergence.converged) {
    return { continueCaller: false, reason: input.convergence.reason };
  }
  if (input.convergence.reason === "final_answer") {
    return { continueCaller: false, reason: "final_answer" };
  }
  return { continueCaller: true, reason: "idle" };
}

function isPendingRoleCall(call: RoleCall): boolean {
  return ["proposed", "assessing", "accepted", "queued", "running", "waiting_context"]
    .includes(call.status);
}

function summarizeTodo(todo: RoleTodo): string {
  return `@${todo.role} todo ${todo.status}: ${todo.title}`;
}

function summarizeEvent(event: RoleCallEvent): string {
  return `${event.type}: ${event.message}`;
}
