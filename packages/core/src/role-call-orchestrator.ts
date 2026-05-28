import {
  createId,
  nowIso,
  type RoleCall,
  type RoleCallDecision,
  type RoleCallEvent,
  type RoleDefinition,
  type RoleIntent,
  type RoleResult,
  type RoleTodo
} from "./domain";
import type {
  RoleCallEventRepository,
  RoleCallRepository,
  RoleTodoRepository
} from "./storage";

export type RoleCallLedgerSummaryStatus =
  | "accepted"
  | "deferred"
  | "rejected"
  | "waiting_context"
  | "waiting_approval"
  | "blocked"
  | "ignored";

export interface RoleCallLedgerSummary {
  roleCallId?: string;
  targetRole?: string;
  status: RoleCallLedgerSummaryStatus;
  message: string;
  decision?: RoleCallDecision;
  reasons?: string[];
}

export interface RoleCallPolicyValidationResult {
  allowed: boolean;
  status: "allowed" | "approval_required" | "blocked";
  reasons: string[];
  warnings?: string[];
  approvalReasons?: string[];
}

export type RoleCallPolicyValidator = (input: {
  callerRole: RoleDefinition;
  calleeRole: RoleDefinition;
  intent: RoleIntent;
  currentDepth: number;
  activeRoleCalls: readonly RoleCall[];
  existingRoleCalls: readonly RoleCall[];
  roleTodos: readonly RoleTodo[];
}) => RoleCallPolicyValidationResult;

export type RoleCallIntakeDecider = (input: {
  roleCall: RoleCall;
  callerRole: RoleDefinition;
  calleeRole: RoleDefinition;
  intent: RoleIntent;
}) => RoleCallDecision;

export interface RoleCallOrchestratorRepositories {
  roleCallRepository: RoleCallRepository;
  roleCallEventRepository: RoleCallEventRepository;
  roleTodoRepository: RoleTodoRepository;
}

export interface RoleCallOrchestratorOptions {
  repositories: RoleCallOrchestratorRepositories;
  roles: readonly RoleDefinition[];
  policyValidator?: RoleCallPolicyValidator;
  intakeDecider?: RoleCallIntakeDecider;
  idFactory?: (prefix: string) => string;
  now?: () => string;
}

export interface ProcessRoleIntentsInput {
  threadId: string;
  callerRole: string;
  intents: readonly RoleIntent[];
  userGoal: string;
  parentMessageId?: string;
  parentRoleCallId?: string;
  currentPlan?: string;
}

export class RoleCallOrchestrator {
  private readonly repositories: RoleCallOrchestratorRepositories;
  private readonly roles: readonly RoleDefinition[];
  private readonly policyValidator: RoleCallPolicyValidator;
  private readonly intakeDecider: RoleCallIntakeDecider;
  private readonly idFactory: (prefix: string) => string;
  private readonly now: () => string;

  constructor(options: RoleCallOrchestratorOptions) {
    this.repositories = options.repositories;
    this.roles = options.roles;
    this.policyValidator = options.policyValidator ?? allowRoleCallPolicy;
    this.intakeDecider = options.intakeDecider ?? acceptRoleCallIntake;
    this.idFactory = options.idFactory ?? createId;
    this.now = options.now ?? nowIso;
  }

  async processRoleIntents(
    input: ProcessRoleIntentsInput
  ): Promise<RoleCallLedgerSummary[]> {
    const callerRole = this.findRole(input.callerRole);
    if (!callerRole) {
      return [
        {
          status: "ignored",
          message: `Caller role @${input.callerRole} is not registered.`,
          reasons: [`caller role @${input.callerRole} not found`]
        }
      ];
    }

    const summaries: RoleCallLedgerSummary[] = [];
    for (const intent of input.intents) {
      summaries.push(await this.processIntent(input, callerRole, intent));
    }
    return summaries;
  }

  async markRoleCallSucceeded(
    roleCallId: string,
    result: RoleResult,
    at = this.now()
  ): Promise<RoleCallLedgerSummary> {
    let call = await this.requireRoleCall(roleCallId);
    if (call.status !== "running") {
      call = await this.repositories.roleCallRepository.updateStatus(
        roleCallId,
        "running",
        at
      );
    }
    const updated = await this.repositories.roleCallRepository.update({
      ...call,
      result,
      status: "succeeded",
      completedAt: at
    });
    await this.createEvent({
      roleCallId,
      threadId: updated.threadId,
      type: "result_reported",
      actorRole: updated.calleeRole,
      message: `Role call to @${updated.calleeRole} succeeded.`,
      metadata: { resultSummary: result.summary },
      createdAt: at
    });
    await this.updateLinkedTodo(updated, "done", at);
    return {
      roleCallId,
      targetRole: updated.calleeRole,
      status: "accepted",
      message: `@${updated.calleeRole} completed the role call.`
    };
  }

  async cancelRoleCall(
    roleCallId: string,
    reason: string,
    at = this.now()
  ): Promise<RoleCallLedgerSummary> {
    const call = await this.repositories.roleCallRepository.updateStatus(
      roleCallId,
      "cancelled",
      at
    );
    await this.createEvent({
      roleCallId,
      threadId: call.threadId,
      type: "cancelled",
      actorRole: call.calleeRole,
      message: reason,
      createdAt: at
    });
    await this.updateLinkedTodo(call, "cancelled", at);
    return {
      roleCallId,
      targetRole: call.calleeRole,
      status: "ignored",
      message: `Role call to @${call.calleeRole} was cancelled.`
    };
  }

  async retryRoleCall(
    roleCallId: string,
    reason: string,
    at = this.now()
  ): Promise<RoleCallLedgerSummary> {
    const call = await this.requireRoleCall(roleCallId);
    if (call.status !== "deferred" && call.status !== "waiting_approval") {
      return {
        roleCallId,
        targetRole: call.calleeRole,
        status: "blocked",
        message: `Role call to @${call.calleeRole} cannot be retried from ${call.status}.`,
        reasons: [
          "Only deferred or waiting-approval role calls can be retried."
        ]
      };
    }

    const decision: RoleCallDecision = {
      disposition: "accepted",
      reason
    };
    const todo = call.todoId
      ? undefined
      : await this.createTodoForDecision(call, decision, "in_progress", at);
    const updated = await this.repositories.roleCallRepository.update({
      ...call,
      status: "accepted",
      decision,
      todoId: call.todoId ?? todo?.id
    });
    await this.createEvent({
      roleCallId,
      threadId: updated.threadId,
      type: "accepted",
      actorRole: updated.calleeRole,
      message: reason,
      metadata: {
        retry: true,
        previousStatus: call.status
      },
      createdAt: at
    });
    if (call.todoId) {
      await this.updateLinkedTodo(updated, "in_progress", at);
    }
    return {
      roleCallId,
      targetRole: updated.calleeRole,
      status: "accepted",
      decision,
      message: `Role call to @${updated.calleeRole} was retried and accepted.`
    };
  }

  async blockRoleCallTodo(
    roleCallId: string,
    reason: string,
    at = this.now()
  ): Promise<RoleCallLedgerSummary> {
    const call = await this.requireRoleCall(roleCallId);
    await this.updateLinkedTodo(call, "blocked", at);
    await this.createEvent({
      roleCallId,
      threadId: call.threadId,
      type: "todo_updated",
      actorRole: call.calleeRole,
      message: reason,
      createdAt: at
    });
    return {
      roleCallId,
      targetRole: call.calleeRole,
      status: "blocked",
      message: `Role call to @${call.calleeRole} is blocked: ${reason}`
    };
  }

  private async processIntent(
    input: ProcessRoleIntentsInput,
    callerRole: RoleDefinition,
    intent: RoleIntent
  ): Promise<RoleCallLedgerSummary> {
    const targetRole = roleIntentTargetRole(intent);
    if (!targetRole) {
      return {
        status: "ignored",
        message: `Role intent ${intent.type} does not target another role.`
      };
    }

    const calleeRole = this.findRole(targetRole);
    if (!calleeRole) {
      return {
        targetRole,
        status: "ignored",
        message: `Target role @${targetRole} is not registered.`,
        reasons: [`target role @${targetRole} not found`]
      };
    }

    const existingRoleCalls = await this.repositories.roleCallRepository.list({
      threadId: input.threadId
    });
    const parentCall = input.parentRoleCallId
      ? await this.repositories.roleCallRepository.get(input.parentRoleCallId)
      : undefined;
    const currentDepth = parentCall?.depth ?? 0;
    const roleTodos = await this.repositories.roleTodoRepository.list({
      threadId: input.threadId
    });
    const policy = this.policyValidator({
      callerRole,
      calleeRole,
      intent,
      currentDepth,
      activeRoleCalls: existingRoleCalls,
      existingRoleCalls,
      roleTodos
    });
    if (!policy.allowed && policy.status === "blocked") {
      return {
        targetRole,
        status: "blocked",
        message: `Role call to @${targetRole} was blocked by policy.`,
        reasons: policy.reasons
      };
    }

    const createdAt = this.now();
    const roleCall = await this.repositories.roleCallRepository.create({
      id: this.idFactory("role_call"),
      threadId: input.threadId,
      parentMessageId: input.parentMessageId,
      parentRoleCallId: input.parentRoleCallId,
      callerRole: callerRole.handle,
      calleeRole: calleeRole.handle,
      task: roleIntentTaskText(intent),
      reason: roleIntentReason(intent),
      context: {
        userGoal: input.userGoal,
        currentPlan: input.currentPlan
      },
      permissions: calleeRole.permissions,
      expectedOutput: roleIntentExpectedOutput(intent),
      priority: roleIntentPriority(intent),
      depth: currentDepth + 1,
      status: policy.status === "approval_required" ? "waiting_approval" : "proposed",
      decision: policy.status === "approval_required"
        ? {
            disposition: "needs_approval",
            reason: policy.approvalReasons?.join("; ") || "Approval is required."
          }
        : undefined,
      createdAt
    });

    await this.createEvent({
      roleCallId: roleCall.id,
      threadId: roleCall.threadId,
      type: "created",
      actorRole: callerRole.handle,
      message: `Created role call from @${callerRole.handle} to @${calleeRole.handle}.`,
      metadata: { intentType: intent.type },
      createdAt
    });

    if (policy.status === "approval_required") {
      await this.createEvent({
        roleCallId: roleCall.id,
        threadId: roleCall.threadId,
        type: "approval_requested",
        actorRole: calleeRole.handle,
        message: `Approval required for @${calleeRole.handle}: ${
          policy.approvalReasons?.join("; ") || "approval required"
        }.`,
        metadata: { approvalReasons: policy.approvalReasons ?? [] },
        createdAt
      });
      return {
        roleCallId: roleCall.id,
        targetRole,
        status: "waiting_approval",
        decision: roleCall.decision,
        message: `Role call to @${targetRole} is waiting for approval.`
      };
    }

    await this.createEvent({
      roleCallId: roleCall.id,
      threadId: roleCall.threadId,
      type: "assessment_started",
      actorRole: calleeRole.handle,
      message: `@${calleeRole.handle} started intake assessment.`,
      createdAt
    });
    const assessingRoleCall =
      await this.repositories.roleCallRepository.updateStatus(
        roleCall.id,
        "assessing",
        createdAt
      );

    const decision = this.intakeDecider({
      roleCall: assessingRoleCall,
      callerRole,
      calleeRole,
      intent
    });
    return this.applyIntakeDecision(assessingRoleCall, decision, calleeRole);
  }

  private async applyIntakeDecision(
    roleCall: RoleCall,
    decision: RoleCallDecision,
    calleeRole: RoleDefinition
  ): Promise<RoleCallLedgerSummary> {
    const at = this.now();
    const status = roleCallStatusForDecision(decision);
    const updated = await this.repositories.roleCallRepository.update({
      ...roleCall,
      status,
      decision,
      completedAt:
        status === "rejected" || status === "cancelled" ? at : roleCall.completedAt
    });
    await this.createEvent({
      roleCallId: updated.id,
      threadId: updated.threadId,
      type: eventTypeForDecision(decision),
      actorRole: calleeRole.handle,
      message: decision.reason,
      metadata: { disposition: decision.disposition },
      createdAt: at
    });

    if (decision.disposition === "accepted") {
      const todo = await this.createTodoForDecision(updated, decision, "in_progress", at);
      await this.repositories.roleCallRepository.update({ ...updated, todoId: todo.id });
      return {
        roleCallId: updated.id,
        targetRole: updated.calleeRole,
        status: "accepted",
        decision,
        message: `@${updated.calleeRole} accepted the role call.`
      };
    }
    if (decision.disposition === "deferred") {
      const todo = await this.createTodoForDecision(updated, decision, "deferred", at);
      await this.repositories.roleCallRepository.update({ ...updated, todoId: todo.id });
      return {
        roleCallId: updated.id,
        targetRole: updated.calleeRole,
        status: "deferred",
        decision,
        message: `Role call to @${updated.calleeRole} was deferred: ${decision.reason}`
      };
    }
    if (decision.disposition === "rejected") {
      const todo = await this.createTodoForDecision(updated, decision, "rejected", at);
      await this.repositories.roleCallRepository.update({ ...updated, todoId: todo.id });
      return {
        roleCallId: updated.id,
        targetRole: updated.calleeRole,
        status: "rejected",
        decision,
        message: `Role call to @${updated.calleeRole} was rejected, not failed: ${decision.reason}`
      };
    }
    if (decision.disposition === "needs_context") {
      return {
        roleCallId: updated.id,
        targetRole: updated.calleeRole,
        status: "waiting_context",
        decision,
        message: `Role call to @${updated.calleeRole} is waiting for context.`
      };
    }
    return {
      roleCallId: updated.id,
      targetRole: updated.calleeRole,
      status: "waiting_approval",
      decision,
      message: `Role call to @${updated.calleeRole} is waiting for approval.`
    };
  }

  private async createTodoForDecision(
    roleCall: RoleCall,
    decision: RoleCallDecision,
    status: RoleTodo["status"],
    at: string
  ): Promise<RoleTodo> {
    const todo = await this.repositories.roleTodoRepository.create({
      id: this.idFactory("role_todo"),
      threadId: roleCall.threadId,
      role: roleCall.calleeRole,
      sourceRoleCallId: roleCall.id,
      title: decision.todo?.title ?? roleCall.task,
      description: decision.alternativeTask,
      status,
      priority: decision.todo?.priority ?? roleCall.priority,
      reason: decision.reason,
      relatedRoleCallIds: [roleCall.id],
      createdAt: at,
      updatedAt: at,
      completedAt: status === "rejected" || status === "done" ? at : undefined
    });
    await this.createEvent({
      roleCallId: roleCall.id,
      threadId: roleCall.threadId,
      type: "todo_created",
      actorRole: roleCall.calleeRole,
      message: `Created ${status} todo for @${roleCall.calleeRole}.`,
      metadata: { todoId: todo.id, todoStatus: status },
      createdAt: at
    });
    return todo;
  }

  private async updateLinkedTodo(
    roleCall: RoleCall,
    status: RoleTodo["status"],
    at: string
  ): Promise<void> {
    if (!roleCall.todoId) {
      return;
    }
    await this.repositories.roleTodoRepository.updateStatus(roleCall.todoId, status, at);
    await this.createEvent({
      roleCallId: roleCall.id,
      threadId: roleCall.threadId,
      type: "todo_updated",
      actorRole: roleCall.calleeRole,
      message: `Updated linked todo ${roleCall.todoId} to ${status}.`,
      metadata: { todoId: roleCall.todoId, todoStatus: status },
      createdAt: at
    });
  }

  private async createEvent(
    event: Omit<RoleCallEvent, "id">
  ): Promise<RoleCallEvent> {
    return this.repositories.roleCallEventRepository.create({
      ...event,
      id: this.idFactory("role_call_event")
    });
  }

  private findRole(handle: string): RoleDefinition | undefined {
    const normalized = handle.replace(/^@/, "").trim().toLowerCase();
    return this.roles.find((role) => role.handle === normalized);
  }

  private async requireRoleCall(roleCallId: string): Promise<RoleCall> {
    const roleCall = await this.repositories.roleCallRepository.get(roleCallId);
    if (!roleCall) {
      throw new Error(`role call ${roleCallId} not found`);
    }
    return roleCall;
  }
}

export function deterministicRoleCallIntake(
  decisionsByRole: Record<string, RoleCallDecision>
): RoleCallIntakeDecider {
  return ({ calleeRole }) =>
    decisionsByRole[calleeRole.handle] ?? {
      disposition: "accepted",
      reason: `@${calleeRole.handle} accepted the role call.`
    };
}

function allowRoleCallPolicy(): RoleCallPolicyValidationResult {
  return {
    allowed: true,
    status: "allowed",
    reasons: []
  };
}

function acceptRoleCallIntake(input: {
  calleeRole: RoleDefinition;
}): RoleCallDecision {
  return {
    disposition: "accepted",
    reason: `@${input.calleeRole.handle} accepted the role call.`
  };
}

function roleIntentTargetRole(intent: RoleIntent): string | undefined {
  if ("targetRole" in intent) {
    return intent.targetRole;
  }
  return undefined;
}

function roleIntentTaskText(intent: RoleIntent): string {
  if ("task" in intent) {
    return intent.task;
  }
  if ("question" in intent) {
    return intent.question;
  }
  if ("requestedAction" in intent) {
    return intent.requestedAction;
  }
  if ("risk" in intent) {
    return intent.risk;
  }
  if ("note" in intent) {
    return intent.note;
  }
  if ("result" in intent) {
    return intent.result.summary;
  }
  return "role intent";
}

function roleIntentReason(intent: RoleIntent): string | undefined {
  if ("reason" in intent) {
    return intent.reason;
  }
  return undefined;
}

function roleIntentExpectedOutput(intent: RoleIntent): RoleCall["expectedOutput"] {
  if ("expectedOutput" in intent && intent.expectedOutput) {
    return intent.expectedOutput;
  }
  return { format: "summary" };
}

function roleIntentPriority(intent: RoleIntent): RoleCall["priority"] {
  if ("priority" in intent && intent.priority) {
    return intent.priority;
  }
  return "normal";
}

function roleCallStatusForDecision(
  decision: RoleCallDecision
): RoleCall["status"] {
  if (decision.disposition === "accepted") {
    return "accepted";
  }
  if (decision.disposition === "rejected") {
    return "rejected";
  }
  if (decision.disposition === "deferred") {
    return "deferred";
  }
  if (decision.disposition === "needs_context") {
    return "waiting_context";
  }
  return "waiting_approval";
}

function eventTypeForDecision(
  decision: RoleCallDecision
): RoleCallEvent["type"] {
  if (decision.disposition === "accepted") {
    return "accepted";
  }
  if (decision.disposition === "rejected") {
    return "rejected";
  }
  if (decision.disposition === "deferred") {
    return "deferred";
  }
  if (decision.disposition === "needs_context") {
    return "context_requested";
  }
  return "approval_requested";
}
