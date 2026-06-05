import path from "node:path";
import {
  DomainValidationError,
  agentKinds,
  conversationMessageKinds,
  conversationMessageRoles,
  contextDeliveryModes,
  contextEvalEventKinds,
  contextEvalEventSeverities,
  contextIndexSourceKinds,
  contextLayers,
  contextLifetimes,
  contextPolicyDecisions,
  contextScopes,
  compressionModes,
  memoryCategories,
  memoryStatuses,
  normalizeWorkgroupRoleHandle,
  retrievalRoutes,
  riskLevels,
  roleCallDispositions,
  roleCallEventTypes,
  roleCallStatuses,
  roleExecutorKinds,
  roleIntentTypes,
  rolePriorities,
  roleTodoStatuses,
  roleTrustLevels,
  runEventTypes,
  skillScopes,
  taskTypes,
  taskRunStatuses,
  taskStatuses,
  trustLevels,
  verificationStatuses,
  workgroupExecutorKinds,
  type AgentProfile,
  type ComparisonReport,
  type ConversationMessage,
  type ConversationThread,
  type ConversationThreadSummary,
  type CodeGraphEntry,
  type ContextEvalEvent,
  type ContextItem,
  type ContextCandidate,
  type ContextIndexEntry,
  type ContextLayer,
  type ContextPack,
  type ContextPlan,
  type ContextRetrievalResult,
  type RuntimeContextPack,
  type MemoryItem,
  type MemoryStatus,
  type Project,
  type RiskReport,
  type RoleCall,
  type RoleCallDecision,
  type RoleCallEvent,
  type RoleCallStatus,
  type RoleDefinition,
  type RoleIntent,
  type RoleResult,
  type RoleTodo,
  type RoleTodoStatus,
  type RunArtifact,
  type RunEvent,
  type Setting,
  type Skill,
  type Task,
  type TaskBrief,
  type TaskRun,
  type TaskRunStatus,
  type TaskStatus,
  type VerificationResult,
  type WorkgroupRole
} from "@agent-hub/shared";

export * from "@agent-hub/shared";

export class DomainStateTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainStateTransitionError";
  }
}

export function validateTaskStatusTransition(
  from: TaskStatus,
  to: TaskStatus
): void {
  validateStatusTransition(from, to, taskStatusTransitions, "task");
}

export function validateTaskRunStatusTransition(
  from: TaskRunStatus,
  to: TaskRunStatus
): void {
  validateStatusTransition(from, to, taskRunStatusTransitions, "task run");
}

export function validateMemoryStatusTransition(
  from: MemoryStatus,
  to: MemoryStatus
): void {
  validateStatusTransition(from, to, memoryStatusTransitions, "memory item");
}

export function validateRoleCallStatusTransition(
  from: RoleCallStatus,
  to: RoleCallStatus
): void {
  validateStatusTransition(from, to, roleCallStatusTransitions, "role call");
}

export function validateRoleTodoStatusTransition(
  from: RoleTodoStatus,
  to: RoleTodoStatus
): void {
  validateStatusTransition(from, to, roleTodoStatusTransitions, "role todo");
}

export function validateProject(input: Project): Project {
  const issues: string[] = [];
  required(input.id, "project.id", issues);
  required(input.name, "project.name", issues);
  required(input.rootPath, "project.rootPath", issues);
  if (input.rootPath && !path.isAbsolute(input.rootPath)) {
    issues.push("project.rootPath must be absolute");
  }
  timestamp(input.createdAt, "project.createdAt", issues);
  timestamp(input.updatedAt, "project.updatedAt", issues);
  return finish(input, issues);
}

export function validateAgentProfile(input: AgentProfile): AgentProfile {
  const issues: string[] = [];
  required(input.id, "agentProfile.id", issues);
  enumValue(input.kind, agentKinds, "agentProfile.kind", issues);
  required(input.displayName, "agentProfile.displayName", issues);
  optionalString(input.command, "agentProfile.command", issues);
  if (typeof input.enabled !== "boolean") {
    issues.push("agentProfile.enabled must be a boolean");
  }
  timestamp(input.createdAt, "agentProfile.createdAt", issues);
  timestamp(input.updatedAt, "agentProfile.updatedAt", issues);
  return finish(input, issues);
}

export function validateTask(input: Task): Task {
  const issues: string[] = [];
  required(input.id, "task.id", issues);
  required(input.projectId, "task.projectId", issues);
  required(input.title, "task.title", issues);
  optionalString(input.description, "task.description", issues);
  optionalObject(input.metadata, "task.metadata", issues);
  enumValue(input.status, taskStatuses, "task.status", issues);
  timestamp(input.createdAt, "task.createdAt", issues);
  timestamp(input.updatedAt, "task.updatedAt", issues);
  return finish(input, issues);
}

export function validateTaskRun(input: TaskRun): TaskRun {
  const issues: string[] = [];
  required(input.id, "taskRun.id", issues);
  required(input.taskId, "taskRun.taskId", issues);
  optionalString(input.agentProfileId, "taskRun.agentProfileId", issues);
  enumValue(input.agentKind, agentKinds, "taskRun.agentKind", issues);
  enumValue(input.status, taskRunStatuses, "taskRun.status", issues);
  optionalString(input.worktreePath, "taskRun.worktreePath", issues);
  optionalString(input.branchName, "taskRun.branchName", issues);
  optionalString(input.parentRunId, "taskRun.parentRunId", issues);
  optionalString(input.parentMessageId, "taskRun.parentMessageId", issues);
  optionalTimestamp(input.startedAt, "taskRun.startedAt", issues);
  optionalTimestamp(input.completedAt, "taskRun.completedAt", issues);
  timestamp(input.createdAt, "taskRun.createdAt", issues);
  timestamp(input.updatedAt, "taskRun.updatedAt", issues);
  return finish(input, issues);
}

export function validateRunEvent(input: RunEvent): RunEvent {
  const issues: string[] = [];
  required(input.id, "runEvent.id", issues);
  required(input.taskRunId, "runEvent.taskRunId", issues);
  if (!Number.isInteger(input.sequence) || input.sequence < 0) {
    issues.push("runEvent.sequence must be a non-negative integer");
  }
  enumValue(input.type, runEventTypes, "runEvent.type", issues);
  required(input.message, "runEvent.message", issues);
  objectValue(input.metadata, "runEvent.metadata", issues);
  timestamp(input.createdAt, "runEvent.createdAt", issues);
  return finish(input, issues);
}

export function validateRunArtifact(input: RunArtifact): RunArtifact {
  const issues: string[] = [];
  required(input.id, "runArtifact.id", issues);
  required(input.taskRunId, "runArtifact.taskRunId", issues);
  required(input.kind, "runArtifact.kind", issues);
  required(input.content, "runArtifact.content", issues);
  objectValue(input.metadata, "runArtifact.metadata", issues);
  timestamp(input.createdAt, "runArtifact.createdAt", issues);
  return finish(input, issues);
}

export function validateConversationThread(
  input: ConversationThread
): ConversationThread {
  const issues: string[] = [];
  required(input.id, "conversationThread.id", issues);
  required(input.projectId, "conversationThread.projectId", issues);
  required(input.title, "conversationThread.title", issues);
  optionalObject(input.metadata, "conversationThread.metadata", issues);
  optionalTimestamp(input.archivedAt, "conversationThread.archivedAt", issues);
  timestamp(input.createdAt, "conversationThread.createdAt", issues);
  timestamp(input.updatedAt, "conversationThread.updatedAt", issues);
  return finish(input, issues);
}

export function validateConversationMessage(
  input: ConversationMessage
): ConversationMessage {
  const issues: string[] = [];
  required(input.id, "conversationMessage.id", issues);
  required(input.threadId, "conversationMessage.threadId", issues);
  if (!Number.isInteger(input.sequence) || input.sequence < 0) {
    issues.push("conversationMessage.sequence must be a non-negative integer");
  }
  enumValue(input.role, conversationMessageRoles, "conversationMessage.role", issues);
  enumValue(input.kind, conversationMessageKinds, "conversationMessage.kind", issues);
  required(input.content, "conversationMessage.content", issues);
  if (input.agentKind !== undefined) {
    enumValue(input.agentKind, agentKinds, "conversationMessage.agentKind", issues);
  }
  optionalString(input.runId, "conversationMessage.runId", issues);
  if (input.status !== undefined) {
    enumValue(input.status, taskRunStatuses, "conversationMessage.status", issues);
  }
  optionalObject(input.metadata, "conversationMessage.metadata", issues);
  timestamp(input.createdAt, "conversationMessage.createdAt", issues);
  return finish(input, issues);
}

export function validateConversationThreadSummary(
  input: ConversationThreadSummary
): ConversationThreadSummary {
  const issues: string[] = [];
  required(input.id, "conversationThreadSummary.id", issues);
  required(input.threadId, "conversationThreadSummary.threadId", issues);
  required(input.summary, "conversationThreadSummary.summary", issues);
  stringArray(input.decisions, "conversationThreadSummary.decisions", issues);
  stringArray(input.openItems, "conversationThreadSummary.openItems", issues);
  stringArray(input.constraints, "conversationThreadSummary.constraints", issues);
  optionalString(
    input.lastKnownUserGoal,
    "conversationThreadSummary.lastKnownUserGoal",
    issues
  );
  if (!Number.isInteger(input.sourceMessageCount) || input.sourceMessageCount < 0) {
    issues.push("conversationThreadSummary.sourceMessageCount must be a non-negative integer");
  }
  optionalString(
    input.sourceLatestMessageId,
    "conversationThreadSummary.sourceLatestMessageId",
    issues
  );
  optionalObject(input.metadata, "conversationThreadSummary.metadata", issues);
  timestamp(input.createdAt, "conversationThreadSummary.createdAt", issues);
  timestamp(input.updatedAt, "conversationThreadSummary.updatedAt", issues);
  return finish(input, issues);
}

export function validateVerificationResult(
  input: VerificationResult
): VerificationResult {
  const issues: string[] = [];
  required(input.id, "verificationResult.id", issues);
  required(input.taskRunId, "verificationResult.taskRunId", issues);
  required(input.command, "verificationResult.command", issues);
  enumValue(input.status, verificationStatuses, "verificationResult.status", issues);
  optionalInteger(input.exitCode, "verificationResult.exitCode", issues);
  optionalString(input.stdout, "verificationResult.stdout", issues);
  optionalString(input.stderr, "verificationResult.stderr", issues);
  optionalTimestamp(input.startedAt, "verificationResult.startedAt", issues);
  optionalTimestamp(input.completedAt, "verificationResult.completedAt", issues);
  timestamp(input.createdAt, "verificationResult.createdAt", issues);
  return finish(input, issues);
}

export function validateComparisonReport(input: ComparisonReport): ComparisonReport {
  const issues: string[] = [];
  required(input.id, "comparisonReport.id", issues);
  required(input.taskId, "comparisonReport.taskId", issues);
  optionalString(input.baselineRunId, "comparisonReport.baselineRunId", issues);
  optionalString(input.candidateRunId, "comparisonReport.candidateRunId", issues);
  required(input.summary, "comparisonReport.summary", issues);
  optionalObject(input.details, "comparisonReport.details", issues);
  timestamp(input.createdAt, "comparisonReport.createdAt", issues);
  return finish(input, issues);
}

export function validateMemoryItem(input: MemoryItem): MemoryItem {
  const issues: string[] = [];
  required(input.id, "memoryItem.id", issues);
  required(input.projectId, "memoryItem.projectId", issues);
  optionalString(input.taskId, "memoryItem.taskId", issues);
  enumValue(input.category, memoryCategories, "memoryItem.category", issues);
  enumValue(input.status, memoryStatuses, "memoryItem.status", issues);
  required(input.content, "memoryItem.content", issues);
  timestamp(input.createdAt, "memoryItem.createdAt", issues);
  timestamp(input.updatedAt, "memoryItem.updatedAt", issues);
  return finish(input, issues);
}

export function validateRiskReport(input: RiskReport): RiskReport {
  const issues: string[] = [];
  required(input.id, "riskReport.id", issues);
  required(input.taskRunId, "riskReport.taskRunId", issues);
  enumValue(input.level, riskLevels, "riskReport.level", issues);
  required(input.summary, "riskReport.summary", issues);
  stringArray(input.changedFiles, "riskReport.changedFiles", issues);
  required(input.verificationSummary, "riskReport.verificationSummary", issues);
  stringArray(input.failedChecks, "riskReport.failedChecks", issues);
  stringArray(input.riskFactors, "riskReport.riskFactors", issues);
  stringArray(input.manualReviewChecklist, "riskReport.manualReviewChecklist", issues);
  required(
    input.acceptanceRecommendation,
    "riskReport.acceptanceRecommendation",
    issues
  );
  if (!Array.isArray(input.findings)) {
    issues.push("riskReport.findings must be an array");
  } else {
    input.findings.forEach((finding, index) => {
      enumValue(finding.level, riskLevels, `riskReport.findings.${index}.level`, issues);
      required(finding.summary, `riskReport.findings.${index}.summary`, issues);
      optionalString(finding.details, `riskReport.findings.${index}.details`, issues);
    });
  }
  timestamp(input.createdAt, "riskReport.createdAt", issues);
  return finish(input, issues);
}

export function validateSkill(input: Skill): Skill {
  const issues: string[] = [];
  required(input.id, "skill.id", issues);
  optionalString(input.projectId, "skill.projectId", issues);
  required(input.name, "skill.name", issues);
  required(input.description, "skill.description", issues);
  required(input.path, "skill.path", issues);
  timestamp(input.createdAt, "skill.createdAt", issues);
  timestamp(input.updatedAt, "skill.updatedAt", issues);
  return finish(input, issues);
}

export function validateSetting(input: Setting): Setting {
  const issues: string[] = [];
  required(input.key, "setting.key", issues);
  secretFreeSettingKey(input.key, "setting.key", issues);
  if (input.value === undefined) {
    issues.push("setting.value is required");
  } else {
    secretFreeSettingValue(input.value, "setting.value", issues, new WeakSet<object>());
  }
  timestamp(input.updatedAt, "setting.updatedAt", issues);
  return finish(input, issues);
}

export function validateWorkgroupRole(input: WorkgroupRole): WorkgroupRole {
  const issues: string[] = [];
  required(input.id, "workgroupRole.id", issues);
  required(input.handle, "workgroupRole.handle", issues);
  if (input.handle && normalizeWorkgroupRoleHandle(input.handle) !== input.handle) {
    issues.push("workgroupRole.handle must be lowercase without @");
  }
  required(input.displayName, "workgroupRole.displayName", issues);
  required(input.purpose, "workgroupRole.purpose", issues);
  required(input.capabilitySummary, "workgroupRole.capabilitySummary", issues);
  required(input.persona, "workgroupRole.persona", issues);
  required(input.defaultInstructions, "workgroupRole.defaultInstructions", issues);
  stringArray(input.permissions, "workgroupRole.permissions", issues);
  if (typeof input.enabled !== "boolean") {
    issues.push("workgroupRole.enabled must be a boolean");
  }
  optionalSkillReferences(
    input.defaultSkillReferences,
    "workgroupRole.defaultSkillReferences",
    issues
  );
  optionalString(input.defaultRoom, "workgroupRole.defaultRoom", issues);
  if (input.delegationPolicy !== undefined) {
    validateDelegationPolicy(
      input.delegationPolicy,
      "workgroupRole.delegationPolicy",
      issues
    );
    validateWorkgroupRoleDelegationPolicyTargets(input.delegationPolicy, issues);
  }
  if (
    input.tags !== undefined &&
    (!Array.isArray(input.tags) ||
      input.tags.some((entry) => typeof entry !== "string"))
  ) {
    issues.push("workgroupRole.tags must be an array of strings when provided");
  }
  optionalObject(input.metadata, "workgroupRole.metadata", issues);
  objectValue(input.contextPolicy, "workgroupRole.contextPolicy", issues);
  if (input.contextPolicy) {
    required(input.contextPolicy.scope, "workgroupRole.contextPolicy.scope", issues);
    if (typeof input.contextPolicy.includeApprovedMemory !== "boolean") {
      issues.push(
        "workgroupRole.contextPolicy.includeApprovedMemory must be a boolean"
      );
    }
    if (typeof input.contextPolicy.includeThreadSummary !== "boolean") {
      issues.push(
        "workgroupRole.contextPolicy.includeThreadSummary must be a boolean"
      );
    }
    stringArray(
      input.contextPolicy.instructions,
      "workgroupRole.contextPolicy.instructions",
      issues
    );
  }
  objectValue(input.approvalPolicy, "workgroupRole.approvalPolicy", issues);
  if (input.approvalPolicy) {
    stringArray(
      input.approvalPolicy.requiredFor,
      "workgroupRole.approvalPolicy.requiredFor",
      issues
    );
    required(input.approvalPolicy.summary, "workgroupRole.approvalPolicy.summary", issues);
  }
  objectValue(input.executor, "workgroupRole.executor", issues);
  if (input.executor) {
    enumValue(input.executor.kind, workgroupExecutorKinds, "workgroupRole.executor.kind", issues);
    if (input.executor.kind === "agent_adapter") {
      enumValue(
        input.executor.adapterKind,
        agentKinds,
        "workgroupRole.executor.adapterKind",
        issues
      );
      optionalString(input.executor.configRef, "workgroupRole.executor.configRef", issues);
    } else {
      optionalString(input.executor.configRef, "workgroupRole.executor.configRef", issues);
      optionalString(
        input.executor.unavailableReason,
        "workgroupRole.executor.unavailableReason",
        issues
      );
    }
  }
  return finish(input, issues);
}

export function validateRoleDefinition(input: RoleDefinition): RoleDefinition {
  const issues: string[] = [];
  required(input.id, "roleDefinition.id", issues);
  required(input.handle, "roleDefinition.handle", issues);
  if (input.handle && normalizeWorkgroupRoleHandle(input.handle) !== input.handle) {
    issues.push("roleDefinition.handle must be lowercase without @");
  }
  required(input.displayName, "roleDefinition.displayName", issues);
  required(input.purpose, "roleDefinition.purpose", issues);
  required(input.defaultInstructions, "roleDefinition.defaultInstructions", issues);
  stringArray(input.capabilities, "roleDefinition.capabilities", issues);
  validatePermissionSet(input.permissions, "roleDefinition.permissions", issues);
  validateRoleContextPolicy(
    input.contextPolicy,
    "roleDefinition.contextPolicy",
    issues
  );
  validateRoleApprovalPolicy(
    input.approvalPolicy,
    "roleDefinition.approvalPolicy",
    issues
  );
  validateDelegationPolicy(
    input.delegationPolicy,
    "roleDefinition.delegationPolicy",
    issues
  );
  validateIntakePolicy(input.intakePolicy, "roleDefinition.intakePolicy", issues);
  validateRoleExecutor(input.executor, "roleDefinition.executor", issues);
  enumValue(input.trustLevel, roleTrustLevels, "roleDefinition.trustLevel", issues);
  if (typeof input.enabled !== "boolean") {
    issues.push("roleDefinition.enabled must be a boolean");
  }
  validateConservativeCustomRoleDefaults(input, issues);
  return finish(input, issues);
}

export function validateRoleIntent(input: RoleIntent): RoleIntent {
  const issues: string[] = [];
  objectValue(input, "roleIntent", issues);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return finish(input, issues);
  }

  const intent = input as unknown as Record<string, unknown>;
  enumValue(intent.type, roleIntentTypes, "roleIntent.type", issues);
  switch (intent.type) {
    case "delegate":
      required(intent.targetRole, "roleIntent.targetRole", issues);
      normalizedRoleHandle(intent.targetRole, "roleIntent.targetRole", issues);
      required(intent.task, "roleIntent.task", issues);
      required(intent.reason, "roleIntent.reason", issues);
      validateExpectedOutputSpec(
        intent.expectedOutput,
        "roleIntent.expectedOutput",
        issues
      );
      optionalRolePriority(intent.priority, "roleIntent.priority", issues);
      break;
    case "request_analysis":
      required(intent.targetRole, "roleIntent.targetRole", issues);
      normalizedRoleHandle(intent.targetRole, "roleIntent.targetRole", issues);
      required(intent.task, "roleIntent.task", issues);
      required(intent.reason, "roleIntent.reason", issues);
      if (intent.expectedOutput !== undefined) {
        validateExpectedOutputSpec(
          intent.expectedOutput,
          "roleIntent.expectedOutput",
          issues
        );
      }
      optionalRolePriority(intent.priority, "roleIntent.priority", issues);
      break;
    case "request_review":
      required(intent.targetRole, "roleIntent.targetRole", issues);
      normalizedRoleHandle(intent.targetRole, "roleIntent.targetRole", issues);
      optionalString(intent.artifactId, "roleIntent.artifactId", issues);
      required(intent.task, "roleIntent.task", issues);
      required(intent.reason, "roleIntent.reason", issues);
      optionalRolePriority(intent.priority, "roleIntent.priority", issues);
      break;
    case "request_evidence":
      required(intent.targetRole, "roleIntent.targetRole", issues);
      normalizedRoleHandle(intent.targetRole, "roleIntent.targetRole", issues);
      required(intent.question, "roleIntent.question", issues);
      if (intent.requiredEvidence !== undefined) {
        stringArray(intent.requiredEvidence, "roleIntent.requiredEvidence", issues);
      }
      optionalRolePriority(intent.priority, "roleIntent.priority", issues);
      break;
    case "request_approval":
      required(intent.approvalType, "roleIntent.approvalType", issues);
      required(intent.reason, "roleIntent.reason", issues);
      required(intent.requestedAction, "roleIntent.requestedAction", issues);
      optionalRolePriority(intent.priority, "roleIntent.priority", issues);
      break;
    case "report_result":
      validateRoleResultFields(intent.result, "roleIntent.result", issues);
      break;
    case "raise_risk":
      required(intent.risk, "roleIntent.risk", issues);
      stringArray(intent.evidence, "roleIntent.evidence", issues);
      break;
    case "update_todo":
      optionalString(intent.todoId, "roleIntent.todoId", issues);
      enumValue(intent.status, roleTodoStatuses, "roleIntent.status", issues);
      required(intent.note, "roleIntent.note", issues);
      break;
  }
  return finish(input, issues);
}

export function validateRoleCall(input: RoleCall): RoleCall {
  const issues: string[] = [];
  required(input.id, "roleCall.id", issues);
  required(input.threadId, "roleCall.threadId", issues);
  optionalString(input.parentMessageId, "roleCall.parentMessageId", issues);
  optionalString(input.parentRoleCallId, "roleCall.parentRoleCallId", issues);
  required(input.callerRole, "roleCall.callerRole", issues);
  normalizedRoleHandle(input.callerRole, "roleCall.callerRole", issues);
  required(input.calleeRole, "roleCall.calleeRole", issues);
  normalizedRoleHandle(input.calleeRole, "roleCall.calleeRole", issues);
  required(input.task, "roleCall.task", issues);
  optionalString(input.reason, "roleCall.reason", issues);
  validateRoleCallContext(input.context, "roleCall.context", issues);
  validatePermissionSet(input.permissions, "roleCall.permissions", issues);
  validateExpectedOutputSpec(
    input.expectedOutput,
    "roleCall.expectedOutput",
    issues
  );
  enumValue(input.priority, rolePriorities, "roleCall.priority", issues);
  if (!Number.isInteger(input.depth) || input.depth < 0) {
    issues.push("roleCall.depth must be a non-negative integer");
  }
  enumValue(input.status, roleCallStatuses, "roleCall.status", issues);
  if (input.decision !== undefined) {
    validateRoleCallDecisionFields(input.decision, "roleCall.decision", issues);
  }
  if (input.result !== undefined) {
    validateRoleResultFields(input.result, "roleCall.result", issues);
  }
  optionalString(input.taskRunId, "roleCall.taskRunId", issues);
  optionalString(input.todoId, "roleCall.todoId", issues);
  optionalString(input.error, "roleCall.error", issues);
  timestamp(input.createdAt, "roleCall.createdAt", issues);
  optionalTimestamp(input.startedAt, "roleCall.startedAt", issues);
  optionalTimestamp(input.completedAt, "roleCall.completedAt", issues);
  return finish(input, issues);
}

export function validateRoleCallDecision(
  input: RoleCallDecision
): RoleCallDecision {
  const issues: string[] = [];
  validateRoleCallDecisionFields(input, "roleCallDecision", issues);
  return finish(input, issues);
}

export function validateRoleTodo(input: RoleTodo): RoleTodo {
  const issues: string[] = [];
  required(input.id, "roleTodo.id", issues);
  required(input.threadId, "roleTodo.threadId", issues);
  required(input.role, "roleTodo.role", issues);
  normalizedRoleHandle(input.role, "roleTodo.role", issues);
  optionalString(input.sourceRoleCallId, "roleTodo.sourceRoleCallId", issues);
  optionalString(input.parentTodoId, "roleTodo.parentTodoId", issues);
  required(input.title, "roleTodo.title", issues);
  optionalString(input.description, "roleTodo.description", issues);
  enumValue(input.status, roleTodoStatuses, "roleTodo.status", issues);
  enumValue(input.priority, rolePriorities, "roleTodo.priority", issues);
  optionalString(input.reason, "roleTodo.reason", issues);
  if (input.blockedBy !== undefined) {
    stringArray(input.blockedBy, "roleTodo.blockedBy", issues);
  }
  stringArray(input.relatedRoleCallIds, "roleTodo.relatedRoleCallIds", issues);
  timestamp(input.createdAt, "roleTodo.createdAt", issues);
  timestamp(input.updatedAt, "roleTodo.updatedAt", issues);
  optionalTimestamp(input.completedAt, "roleTodo.completedAt", issues);
  return finish(input, issues);
}

export function validateRoleCallEvent(input: RoleCallEvent): RoleCallEvent {
  const issues: string[] = [];
  required(input.id, "roleCallEvent.id", issues);
  required(input.roleCallId, "roleCallEvent.roleCallId", issues);
  required(input.threadId, "roleCallEvent.threadId", issues);
  enumValue(input.type, roleCallEventTypes, "roleCallEvent.type", issues);
  if (input.actorRole !== undefined) {
    normalizedRoleHandle(input.actorRole, "roleCallEvent.actorRole", issues);
  }
  required(input.message, "roleCallEvent.message", issues);
  optionalObject(input.metadata, "roleCallEvent.metadata", issues);
  timestamp(input.createdAt, "roleCallEvent.createdAt", issues);
  return finish(input, issues);
}

export function validateRoleResult(input: RoleResult): RoleResult {
  const issues: string[] = [];
  validateRoleResultFields(input, "roleResult", issues);
  return finish(input, issues);
}

export function validateContextPack(input: ContextPack): ContextPack {
  const issues: string[] = [];
  required(input.id, "contextPack.id", issues);
  required(input.projectId, "contextPack.projectId", issues);
  required(input.taskId, "contextPack.taskId", issues);
  optionalString(input.taskTitle, "contextPack.taskTitle", issues);
  optionalString(input.taskPrompt, "contextPack.taskPrompt", issues);
  enumValue(input.deliveryMode, contextDeliveryModes, "contextPack.deliveryMode", issues);
  stringArray(input.contextSections, "contextPack.contextSections", issues);
  stringArray(input.approvedMemorySections, "contextPack.approvedMemorySections", issues);
  stringArray(input.skillReferences, "contextPack.skillReferences", issues);
  optionalInjectedSkills(input.injectedSkills, "contextPack.injectedSkills", issues);
  timestamp(input.createdAt, "contextPack.createdAt", issues);
  return finish(input, issues);
}

export function validateTaskBrief(input: TaskBrief): TaskBrief {
  const issues: string[] = [];
  required(input.taskId, "taskBrief.taskId", issues);
  required(input.taskTitle, "taskBrief.taskTitle", issues);
  optionalString(input.taskPrompt, "taskBrief.taskPrompt", issues);
  required(input.renderedContent, "taskBrief.renderedContent", issues);
  required(input.contextPackId, "taskBrief.contextPackId", issues);
  timestamp(input.createdAt, "taskBrief.createdAt", issues);
  return finish(input, issues);
}

export function validateContextItem(input: ContextItem): ContextItem {
  const issues: string[] = [];
  required(input.id, "contextItem.id", issues);
  enumValue(input.layer, contextLayers, "contextItem.layer", issues);
  required(input.sourceKind, "contextItem.sourceKind", issues);
  required(input.sourceId, "contextItem.sourceId", issues);
  enumValue(input.scope, contextScopes, "contextItem.scope", issues);
  enumValue(input.trustLevel, trustLevels, "contextItem.trustLevel", issues);
  enumValue(input.lifetime, contextLifetimes, "contextItem.lifetime", issues);
  required(input.title, "contextItem.title", issues);
  required(input.content, "contextItem.content", issues);
  required(input.contentHash, "contextItem.contentHash", issues);
  optionalString(input.sourcePath, "contextItem.sourcePath", issues);
  timestamp(input.createdAt, "contextItem.createdAt", issues);
  optionalTimestamp(input.updatedAt, "contextItem.updatedAt", issues);
  objectValue(input.metadata, "contextItem.metadata", issues);
  return finish(input, issues);
}

export function validateContextCandidate(
  input: ContextCandidate
): ContextCandidate {
  const issues: string[] = [];
  if (!plainObject(input.item)) {
    issues.push("contextCandidate.item must be an object");
  } else {
    validateNested(() => validateContextItem(input.item), issues);
  }
  enumArray(input.routes, retrievalRoutes, "contextCandidate.routes", issues);
  nonNegativeNumber(
    input.relevanceScore,
    "contextCandidate.relevanceScore",
    issues
  );
  boundedScore(
    input.freshnessScore,
    "contextCandidate.freshnessScore",
    issues
  );
  boundedScore(input.trustScore, "contextCandidate.trustScore", issues);
  if (input.graphProximityScore !== undefined) {
    boundedScore(
      input.graphProximityScore,
      "contextCandidate.graphProximityScore",
      issues
    );
  }
  boundedScore(
    input.scopeMatchScore,
    "contextCandidate.scopeMatchScore",
    issues
  );
  required(input.inclusionReason, "contextCandidate.inclusionReason", issues);
  objectValue(input.diagnostics, "contextCandidate.diagnostics", issues);
  if (input.item?.layer === "conversation" && input.item.trustLevel !== "low") {
    issues.push("contextCandidate.item.trustLevel must be low for conversation context");
  }
  return finish(input, issues);
}

export function validateContextRetrievalResult(
  input: ContextRetrievalResult
): ContextRetrievalResult {
  const issues: string[] = [];
  required(input.id, "contextRetrievalResult.id", issues);
  required(input.planId, "contextRetrievalResult.planId", issues);
  required(input.taskId, "contextRetrievalResult.taskId", issues);
  optionalString(input.runId, "contextRetrievalResult.runId", issues);
  if (!Array.isArray(input.candidates)) {
    issues.push("contextRetrievalResult.candidates must be an array");
  } else {
    input.candidates.forEach((candidate, index) =>
      validateNested(
        () => validateContextCandidate(candidate),
        issues,
        `contextRetrievalResult.candidates.${index}`
      )
    );
  }
  if (!Array.isArray(input.omitted)) {
    issues.push("contextRetrievalResult.omitted must be an array");
  } else {
    input.omitted.forEach((omission, index) => {
      required(omission?.itemId, `contextRetrievalResult.omitted.${index}.itemId`, issues);
      enumValue(
        omission?.layer,
        contextLayers,
        `contextRetrievalResult.omitted.${index}.layer`,
        issues
      );
      required(omission?.reason, `contextRetrievalResult.omitted.${index}.reason`, issues);
    });
  }
  validateRuntimeContextDiagnostics(
    input.diagnostics,
    "contextRetrievalResult.diagnostics",
    issues
  );
  timestamp(input.createdAt, "contextRetrievalResult.createdAt", issues);
  return finish(input, issues);
}

export function validateContextIndexEntry(
  input: ContextIndexEntry
): ContextIndexEntry {
  const issues: string[] = [];
  validateNested(() => validateContextItem(input), issues);
  required(input.projectId, "contextIndexEntry.projectId", issues);
  enumValue(
    input.sourceKind,
    contextIndexSourceKinds,
    "contextIndexEntry.sourceKind",
    issues
  );
  timestamp(input.indexedAt, "contextIndexEntry.indexedAt", issues);
  return finish(input, issues);
}

export function validateCodeGraphEntry(input: CodeGraphEntry): CodeGraphEntry {
  const issues: string[] = [];
  required(input.id, "codeGraphEntry.id", issues);
  required(input.projectId, "codeGraphEntry.projectId", issues);
  required(input.filePath, "codeGraphEntry.filePath", issues);
  required(input.packageName, "codeGraphEntry.packageName", issues);
  if (typeof input.isTest !== "boolean") {
    issues.push("codeGraphEntry.isTest must be a boolean");
  }
  stringArray(input.imports, "codeGraphEntry.imports", issues);
  stringArray(input.exports, "codeGraphEntry.exports", issues);
  stringArray(input.symbols, "codeGraphEntry.symbols", issues);
  stringArray(input.relatedTests, "codeGraphEntry.relatedTests", issues);
  required(input.contentHash, "codeGraphEntry.contentHash", issues);
  timestamp(input.indexedAt, "codeGraphEntry.indexedAt", issues);
  objectValue(input.metadata, "codeGraphEntry.metadata", issues);
  return finish(input, issues);
}

export function validateContextEvalEvent(
  input: ContextEvalEvent
): ContextEvalEvent {
  const issues: string[] = [];
  required(input.id, "contextEvalEvent.id", issues);
  required(input.projectId, "contextEvalEvent.projectId", issues);
  required(input.taskId, "contextEvalEvent.taskId", issues);
  required(input.runId, "contextEvalEvent.runId", issues);
  optionalString(input.planId, "contextEvalEvent.planId", issues);
  enumValue(input.kind, contextEvalEventKinds, "contextEvalEvent.kind", issues);
  enumValue(
    input.severity,
    contextEvalEventSeverities,
    "contextEvalEvent.severity",
    issues
  );
  required(input.message, "contextEvalEvent.message", issues);
  stringArray(input.selectedItemIds, "contextEvalEvent.selectedItemIds", issues);
  stringArray(input.omittedItemIds, "contextEvalEvent.omittedItemIds", issues);
  objectValue(input.metadata, "contextEvalEvent.metadata", issues);
  timestamp(input.createdAt, "contextEvalEvent.createdAt", issues);
  return finish(input, issues);
}

export function validateContextPlan(input: ContextPlan): ContextPlan {
  const issues: string[] = [];
  required(input.id, "contextPlan.id", issues);
  enumValue(input.taskType, taskTypes, "contextPlan.taskType", issues);
  required(input.taskPromptHash, "contextPlan.taskPromptHash", issues);
  enumArray(input.requiredLayers, contextLayers, "contextPlan.requiredLayers", issues);
  enumArray(input.retrievalRoutes, retrievalRoutes, "contextPlan.retrievalRoutes", issues);
  contextLayerPolicyRecord(
    input.trustPolicy,
    contextPolicyDecisions,
    "contextPlan.trustPolicy",
    issues
  );
  numericContextLayerRecord(input.budgetPolicy, "contextPlan.budgetPolicy", issues);
  contextLayerPolicyRecord(
    input.compressionPolicy,
    compressionModes,
    "contextPlan.compressionPolicy",
    issues
  );
  timestamp(input.createdAt, "contextPlan.createdAt", issues);
  objectValue(input.diagnostics, "contextPlan.diagnostics", issues);
  return finish(input, issues);
}

export function validateRuntimeContextPack(
  input: RuntimeContextPack
): RuntimeContextPack {
  const issues: string[] = [];
  required(input.id, "runtimeContextPack.id", issues);
  required(input.planId, "runtimeContextPack.planId", issues);
  required(input.taskId, "runtimeContextPack.taskId", issues);
  optionalString(input.runId, "runtimeContextPack.runId", issues);
  if (!Array.isArray(input.sections)) {
    issues.push("runtimeContextPack.sections must be an array");
  } else {
    input.sections.forEach((section, index) =>
      validateRuntimeContextSection(section, `runtimeContextPack.sections.${index}`, issues)
    );
  }
  if (!Array.isArray(input.omitted)) {
    issues.push("runtimeContextPack.omitted must be an array");
  } else {
    input.omitted.forEach((omission, index) => {
      required(omission?.itemId, `runtimeContextPack.omitted.${index}.itemId`, issues);
      enumValue(
        omission?.layer,
        contextLayers,
        `runtimeContextPack.omitted.${index}.layer`,
        issues
      );
      required(omission?.reason, `runtimeContextPack.omitted.${index}.reason`, issues);
    });
  }
  validateRuntimeContextDiagnostics(
    input.diagnostics,
    "runtimeContextPack.diagnostics",
    issues
  );
  timestamp(input.createdAt, "runtimeContextPack.createdAt", issues);
  return finish(input, issues);
}

function validateRuntimeContextSection(
  section: RuntimeContextPack["sections"][number],
  field: string,
  issues: string[]
): void {
  required(section?.id, `${field}.id`, issues);
  enumValue(section?.layer, contextLayers, `${field}.layer`, issues);
  enumValue(section?.trustLevel, trustLevels, `${field}.trustLevel`, issues);
  if (section?.layer === "conversation" && section.trustLevel !== "low") {
    issues.push(`${field}.trustLevel must be low for conversation context`);
  }
  required(section?.title, `${field}.title`, issues);
  required(section?.content, `${field}.content`, issues);
  stringArray(section?.sourceItemIds, `${field}.sourceItemIds`, issues);
  stringArray(section?.sourceHashes, `${field}.sourceHashes`, issues);
  enumValue(section?.compressionMode, compressionModes, `${field}.compressionMode`, issues);
  nonNegativeInteger(
    section?.originalCharacterCount,
    `${field}.originalCharacterCount`,
    issues
  );
  nonNegativeInteger(
    section?.renderedCharacterCount,
    `${field}.renderedCharacterCount`,
    issues
  );
  nonNegativeInteger(section?.omittedItemCount, `${field}.omittedItemCount`, issues);
  required(section?.inclusionReason, `${field}.inclusionReason`, issues);
}

function validateRuntimeContextDiagnostics(
  value: RuntimeContextPack["diagnostics"],
  field: string,
  issues: string[]
): void {
  if (!Array.isArray(value)) {
    issues.push(`${field} must be an array`);
    return;
  }
  value.forEach((diagnostic, index) => {
    enumValue(diagnostic?.severity, ["info", "warning", "error"] as const, `${field}.${index}.severity`, issues);
    required(diagnostic?.message, `${field}.${index}.message`, issues);
    optionalObject(diagnostic?.metadata, `${field}.${index}.metadata`, issues);
  });
}

function validateNested(
  validate: () => unknown,
  issues: string[],
  prefix?: string
): void {
  try {
    validate();
  } catch (error) {
    if (!(error instanceof DomainValidationError)) {
      throw error;
    }
    issues.push(
      ...error.issues.map((issue) => (prefix ? `${prefix}.${issue}` : issue))
    );
  }
}

function enumArray<T extends readonly string[]>(
  value: unknown,
  values: T,
  field: string,
  issues: string[]
): void {
  if (!Array.isArray(value)) {
    issues.push(`${field} must be an array`);
    return;
  }
  value.forEach((entry, index) =>
    enumValue(entry, values, `${field}.${index}`, issues)
  );
}

function contextLayerPolicyRecord<T extends readonly string[]>(
  value: unknown,
  allowedValues: T,
  field: string,
  issues: string[]
): void {
  if (!plainObject(value)) {
    issues.push(`${field} must be an object`);
    return;
  }
  for (const layer of contextLayers) {
    enumValue(value[layer], allowedValues, `${field}.${layer}`, issues);
  }
  rejectUnknownContextLayerKeys(value, field, issues);
}

function numericContextLayerRecord(
  value: unknown,
  field: string,
  issues: string[]
): void {
  if (!plainObject(value)) {
    issues.push(`${field} must be an object`);
    return;
  }
  for (const layer of contextLayers) {
    const numberValue = value[layer];
    if (
      typeof numberValue !== "number" ||
      !Number.isFinite(numberValue) ||
      numberValue < 0
    ) {
      issues.push(`${field}.${layer} must be a non-negative number`);
    }
  }
  rejectUnknownContextLayerKeys(value, field, issues);
}

function rejectUnknownContextLayerKeys(
  value: Record<string, unknown>,
  field: string,
  issues: string[]
): void {
  const knownLayers = new Set<string>(contextLayers);
  for (const key of Object.keys(value)) {
    if (!knownLayers.has(key)) {
      issues.push(`${field}.${key} is not a supported context layer`);
    }
  }
}

function required(value: unknown, field: string, issues: string[]): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(`${field} is required`);
  }
}

function optionalString(value: unknown, field: string, issues: string[]): void {
  if (value !== undefined && typeof value !== "string") {
    issues.push(`${field} must be a string when provided`);
  }
}

function timestamp(value: unknown, field: string, issues: string[]): void {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    issues.push(`${field} must be an ISO-style timestamp`);
  }
}

function optionalTimestamp(value: unknown, field: string, issues: string[]): void {
  if (value !== undefined) {
    timestamp(value, field, issues);
  }
}

function optionalInteger(value: unknown, field: string, issues: string[]): void {
  if (value !== undefined && !Number.isInteger(value)) {
    issues.push(`${field} must be an integer when provided`);
  }
}

function nonNegativeNumber(value: unknown, field: string, issues: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    issues.push(`${field} must be a non-negative number`);
  }
}

function boundedScore(value: unknown, field: string, issues: string[]): void {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    issues.push(`${field} must be a number between 0 and 1`);
  }
}

function nonNegativeInteger(value: unknown, field: string, issues: string[]): void {
  if (!Number.isInteger(value) || (value as number) < 0) {
    issues.push(`${field} must be a non-negative integer`);
  }
}

function objectValue(value: unknown, field: string, issues: string[]): void {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    issues.push(`${field} must be an object`);
  }
}

function optionalObject(value: unknown, field: string, issues: string[]): void {
  if (value !== undefined) {
    objectValue(value, field, issues);
  }
}

function stringArray(value: unknown, field: string, issues: string[]): void {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    issues.push(`${field} must be an array of strings`);
  }
}

function optionalStringArray(
  value: unknown,
  field: string,
  issues: string[]
): void {
  if (value !== undefined) {
    stringArray(value, field, issues);
  }
}

function booleanValue(value: unknown, field: string, issues: string[]): void {
  if (typeof value !== "boolean") {
    issues.push(`${field} must be a boolean`);
  }
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizedRoleHandle(
  value: unknown,
  field: string,
  issues: string[]
): void {
  if (typeof value !== "string") {
    return;
  }
  if (normalizeWorkgroupRoleHandle(value) !== value) {
    issues.push(`${field} must be lowercase without @`);
  }
}

function optionalRolePriority(
  value: unknown,
  field: string,
  issues: string[]
): void {
  if (value !== undefined) {
    enumValue(value, rolePriorities, field, issues);
  }
}

function validatePermissionSet(
  value: unknown,
  field: string,
  issues: string[]
): void {
  objectValue(value, field, issues);
  if (!plainObject(value)) {
    return;
  }
  booleanValue(value.canReadFiles, `${field}.canReadFiles`, issues);
  booleanValue(value.canEditFiles, `${field}.canEditFiles`, issues);
  booleanValue(value.canRunCommands, `${field}.canRunCommands`, issues);
  booleanValue(value.canUseNetwork, `${field}.canUseNetwork`, issues);
  booleanValue(value.canAskUser, `${field}.canAskUser`, issues);
  booleanValue(
    value.requiresApprovalForShell,
    `${field}.requiresApprovalForShell`,
    issues
  );
  booleanValue(
    value.requiresApprovalForFileWrite,
    `${field}.requiresApprovalForFileWrite`,
    issues
  );
  optionalStringArray(
    value.allowedCommandPatterns,
    `${field}.allowedCommandPatterns`,
    issues
  );
  optionalStringArray(
    value.deniedCommandPatterns,
    `${field}.deniedCommandPatterns`,
    issues
  );
}

function validateDelegationPolicy(
  value: unknown,
  field: string,
  issues: string[]
): void {
  objectValue(value, field, issues);
  if (!plainObject(value)) {
    return;
  }
  booleanValue(
    value.canInitiateRoleCalls,
    `${field}.canInitiateRoleCalls`,
    issues
  );
  stringEnumArray(
    value.allowedIntentTypes,
    roleIntentTypes,
    `${field}.allowedIntentTypes`,
    issues
  );
  optionalStringArray(value.allowedTargetRoles, `${field}.allowedTargetRoles`, issues);
  optionalStringArray(
    value.allowedTargetCapabilities,
    `${field}.allowedTargetCapabilities`,
    issues
  );
  optionalStringArray(
    value.requiresApprovalForTargets,
    `${field}.requiresApprovalForTargets`,
    issues
  );
}

function validateWorkgroupRoleDelegationPolicyTargets(
  value: unknown,
  issues: string[]
): void {
  if (!plainObject(value) || value.canInitiateRoleCalls !== true) {
    return;
  }
  const hasTargets =
    (Array.isArray(value.allowedTargetRoles)
      ? value.allowedTargetRoles.length
      : 0) > 0 ||
    (Array.isArray(value.allowedTargetCapabilities)
      ? value.allowedTargetCapabilities.length
      : 0) > 0 ||
    (Array.isArray(value.requiresApprovalForTargets)
      ? value.requiresApprovalForTargets.length
      : 0) > 0;
  if (!hasTargets) {
    issues.push(
      "workgroupRole.delegationPolicy must name target roles, target capabilities, or approval targets when role calls are enabled"
    );
  }
}

function validateIntakePolicy(
  value: unknown,
  field: string,
  issues: string[]
): void {
  objectValue(value, field, issues);
  if (!plainObject(value)) {
    return;
  }
  booleanValue(value.acceptsRoleCalls, `${field}.acceptsRoleCalls`, issues);
  optionalStringArray(value.acceptedCallerRoles, `${field}.acceptedCallerRoles`, issues);
  optionalStringArray(
    value.acceptedCallerCapabilities,
    `${field}.acceptedCallerCapabilities`,
    issues
  );
  stringEnumArray(
    value.acceptedIntentTypes,
    roleIntentTypes,
    `${field}.acceptedIntentTypes`,
    issues
  );
  booleanValue(value.canReject, `${field}.canReject`, issues);
  booleanValue(value.canDefer, `${field}.canDefer`, issues);
}

function validateRoleContextPolicy(
  value: unknown,
  field: string,
  issues: string[]
): void {
  objectValue(value, field, issues);
  if (!plainObject(value)) {
    return;
  }
  required(value.scope, `${field}.scope`, issues);
  booleanValue(
    value.includeApprovedMemory,
    `${field}.includeApprovedMemory`,
    issues
  );
  booleanValue(
    value.includeThreadSummary,
    `${field}.includeThreadSummary`,
    issues
  );
  stringArray(value.instructions, `${field}.instructions`, issues);
}

function validateRoleApprovalPolicy(
  value: unknown,
  field: string,
  issues: string[]
): void {
  objectValue(value, field, issues);
  if (!plainObject(value)) {
    return;
  }
  stringArray(value.requiredFor, `${field}.requiredFor`, issues);
  required(value.summary, `${field}.summary`, issues);
}

function validateRoleExecutor(
  value: unknown,
  field: string,
  issues: string[]
): void {
  objectValue(value, field, issues);
  if (!plainObject(value)) {
    return;
  }
  enumValue(value.kind, roleExecutorKinds, `${field}.kind`, issues);
  switch (value.kind) {
    case "agent_adapter":
      enumValue(value.adapter, agentKinds, `${field}.adapter`, issues);
      optionalString(value.configRef, `${field}.configRef`, issues);
      break;
    case "local_workflow":
      required(value.workflowId, `${field}.workflowId`, issues);
      break;
    case "human":
      optionalString(value.configRef, `${field}.configRef`, issues);
      optionalString(value.unavailableReason, `${field}.unavailableReason`, issues);
      break;
    case "llm_api":
      required(value.modelRef, `${field}.modelRef`, issues);
      break;
  }
}

function validateExpectedOutputSpec(
  value: unknown,
  field: string,
  issues: string[]
): void {
  objectValue(value, field, issues);
  if (!plainObject(value)) {
    return;
  }
  enumValue(value.format, expectedOutputFormats, `${field}.format`, issues);
  optionalString(value.description, `${field}.description`, issues);
  optionalString(value.schemaRef, `${field}.schemaRef`, issues);
  optionalStringArray(value.requiredEvidence, `${field}.requiredEvidence`, issues);
}

function validateRoleCallContext(
  value: unknown,
  field: string,
  issues: string[]
): void {
  objectValue(value, field, issues);
  if (!plainObject(value)) {
    return;
  }
  required(value.userGoal, `${field}.userGoal`, issues);
  optionalString(value.currentPlan, `${field}.currentPlan`, issues);
  optionalStringArray(value.relevantFiles, `${field}.relevantFiles`, issues);
  optionalStringArray(value.recentFindings, `${field}.recentFindings`, issues);
  optionalStringArray(value.constraints, `${field}.constraints`, issues);
  if (value.previousRoleResults !== undefined) {
    roleResultArray(
      value.previousRoleResults,
      `${field}.previousRoleResults`,
      issues
    );
  }
  if (value.callerTodoState !== undefined) {
    roleTodoArray(value.callerTodoState, `${field}.callerTodoState`, issues);
  }
  if (value.calleeTodoState !== undefined) {
    roleTodoArray(value.calleeTodoState, `${field}.calleeTodoState`, issues);
  }
  if (value.repoState !== undefined) {
    objectValue(value.repoState, `${field}.repoState`, issues);
    if (plainObject(value.repoState)) {
      optionalString(value.repoState.branch, `${field}.repoState.branch`, issues);
      optionalStringArray(
        value.repoState.changedFiles,
        `${field}.repoState.changedFiles`,
        issues
      );
      optionalString(
        value.repoState.testStatus,
        `${field}.repoState.testStatus`,
        issues
      );
    }
  }
  const tokenBudget = value.tokenBudget;
  if (
    tokenBudget !== undefined &&
    (typeof tokenBudget !== "number" ||
      !Number.isInteger(tokenBudget) ||
      tokenBudget <= 0)
  ) {
    issues.push(`${field}.tokenBudget must be a positive integer when provided`);
  }
}

function validateRoleCallDecisionFields(
  value: unknown,
  field: string,
  issues: string[]
): void {
  objectValue(value, field, issues);
  if (!plainObject(value)) {
    return;
  }
  enumValue(value.disposition, roleCallDispositions, `${field}.disposition`, issues);
  required(value.reason, `${field}.reason`, issues);
  optionalStringArray(value.evidence, `${field}.evidence`, issues);
  optionalStringArray(value.requiredContext, `${field}.requiredContext`, issues);
  optionalString(
    value.suggestedResumeCondition,
    `${field}.suggestedResumeCondition`,
    issues
  );
  optionalString(value.alternativeTask, `${field}.alternativeTask`, issues);
  optionalString(value.risk, `${field}.risk`, issues);
  if (
    value.disposition === "needs_context" &&
    (!Array.isArray(value.requiredContext) || value.requiredContext.length === 0)
  ) {
    issues.push(`${field}.requiredContext is required for needs_context decisions`);
  }
  if (value.todo !== undefined) {
    objectValue(value.todo, `${field}.todo`, issues);
    if (plainObject(value.todo)) {
      required(value.todo.title, `${field}.todo.title`, issues);
      optionalRolePriority(value.todo.priority, `${field}.todo.priority`, issues);
      optionalString(value.todo.dueHint, `${field}.todo.dueHint`, issues);
    }
  }
}

function validateRoleResultFields(
  value: unknown,
  field: string,
  issues: string[]
): void {
  objectValue(value, field, issues);
  if (!plainObject(value)) {
    return;
  }
  required(value.summary, `${field}.summary`, issues);
  stringArray(value.evidence, `${field}.evidence`, issues);
  if (value.commandsRun !== undefined) {
    if (!Array.isArray(value.commandsRun)) {
      issues.push(`${field}.commandsRun must be an array when provided`);
    } else {
      value.commandsRun.forEach((entry, index) => {
        objectValue(entry, `${field}.commandsRun.${index}`, issues);
        if (plainObject(entry)) {
          required(entry.command, `${field}.commandsRun.${index}.command`, issues);
          if (entry.exitCode !== null && !Number.isInteger(entry.exitCode)) {
            issues.push(
              `${field}.commandsRun.${index}.exitCode must be an integer or null`
            );
          }
          required(
            entry.outputSummary,
            `${field}.commandsRun.${index}.outputSummary`,
            issues
          );
        }
      });
    }
  }
  optionalStringArray(value.filesRead, `${field}.filesRead`, issues);
  optionalStringArray(value.filesTouched, `${field}.filesTouched`, issues);
  optionalString(value.patchSummary, `${field}.patchSummary`, issues);
  optionalStringArray(value.risks, `${field}.risks`, issues);
  optionalStringArray(value.nextSteps, `${field}.nextSteps`, issues);
  optionalString(value.rawOutput, `${field}.rawOutput`, issues);
}

function roleResultArray(value: unknown, field: string, issues: string[]): void {
  if (!Array.isArray(value)) {
    issues.push(`${field} must be an array when provided`);
    return;
  }
  value.forEach((entry, index) => {
    validateRoleResultFields(entry, `${field}.${index}`, issues);
  });
}

function roleTodoArray(value: unknown, field: string, issues: string[]): void {
  if (!Array.isArray(value)) {
    issues.push(`${field} must be an array when provided`);
    return;
  }
  value.forEach((entry, index) => {
    try {
      validateRoleTodo(entry as RoleTodo);
    } catch (error) {
      if (error instanceof DomainValidationError) {
        issues.push(...error.issues.map((issue) => `${field}.${index}.${issue}`));
      } else {
        issues.push(`${field}.${index} must be a valid role todo`);
      }
    }
  });
}

function stringEnumArray<T extends readonly string[]>(
  value: unknown,
  values: T,
  field: string,
  issues: string[]
): void {
  if (!Array.isArray(value)) {
    issues.push(`${field} must be an array of ${values.join(", ")}`);
    return;
  }
  value.forEach((entry, index) => {
    enumValue(entry, values, `${field}.${index}`, issues);
  });
}

function validateConservativeCustomRoleDefaults(
  input: RoleDefinition,
  issues: string[]
): void {
  if (input.trustLevel === "preset") {
    return;
  }
  const delegationPolicy = input.delegationPolicy as unknown;
  const permissions = input.permissions as unknown;
  if (!plainObject(delegationPolicy) || !plainObject(permissions)) {
    return;
  }
  if (delegationPolicy.canInitiateRoleCalls !== true) {
    return;
  }
  const hasExplicitTargets =
    (Array.isArray(delegationPolicy.allowedTargetRoles)
      ? delegationPolicy.allowedTargetRoles.length
      : 0) > 0 ||
    (Array.isArray(delegationPolicy.allowedTargetCapabilities)
      ? delegationPolicy.allowedTargetCapabilities.length
      : 0) > 0 ||
    (Array.isArray(delegationPolicy.requiresApprovalForTargets)
      ? delegationPolicy.requiresApprovalForTargets.length
      : 0) > 0;
  if (!hasExplicitTargets) {
    issues.push(
      "roleDefinition.delegationPolicy must name target roles, target capabilities, or approval targets for custom roles that initiate role calls"
    );
  }
  if (
    permissions.canEditFiles === true &&
    permissions.requiresApprovalForFileWrite !== true
  ) {
    issues.push(
      "roleDefinition.permissions.requiresApprovalForFileWrite must be true for custom roles that can edit files"
    );
  }
  if (
    permissions.canRunCommands === true &&
    permissions.requiresApprovalForShell !== true
  ) {
    issues.push(
      "roleDefinition.permissions.requiresApprovalForShell must be true for custom roles that can run commands"
    );
  }
}

function optionalInjectedSkills(
  value: unknown,
  field: string,
  issues: string[]
): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    issues.push(`${field} must be an array when provided`);
    return;
  }
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      issues.push(`${field}.${index} must be an object`);
      return;
    }
    const skill = entry as Record<string, unknown>;
    required(skill.id, `${field}.${index}.id`, issues);
    enumValue(skill.scope, skillScopes, `${field}.${index}.scope`, issues);
    required(skill.name, `${field}.${index}.name`, issues);
    required(skill.description, `${field}.${index}.description`, issues);
    required(skill.contentHash, `${field}.${index}.contentHash`, issues);
    optionalString(skill.sourcePath, `${field}.${index}.sourcePath`, issues);
  });
}

function optionalSkillReferences(
  value: unknown,
  field: string,
  issues: string[]
): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    issues.push(`${field} must be an array when provided`);
    return;
  }
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      issues.push(`${field}.${index} must be an object`);
      return;
    }
    const reference = entry as Record<string, unknown>;
    required(reference.id, `${field}.${index}.id`, issues);
    if (reference.scope !== undefined) {
      enumValue(reference.scope, skillScopes, `${field}.${index}.scope`, issues);
    }
  });
}

function secretFreeSettingKey(value: unknown, field: string, issues: string[]): void {
  if (typeof value !== "string") {
    return;
  }
  if (isSecretLikeSettingKey(value)) {
    issues.push(`${field} must not store secrets`);
  }
}

function secretFreeSettingValue(
  value: unknown,
  field: string,
  issues: string[],
  seen: WeakSet<object>
): void {
  if (typeof value === "string") {
    if (
      secretLikeSettingValuePatterns.some((pattern) => pattern.test(value)) ||
      containsSecretLikeAssignment(value)
    ) {
      issues.push(`${field} must not store secret-like string values`);
    }
    return;
  }

  if (value === null || typeof value !== "object") {
    return;
  }

  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      secretFreeSettingValue(entry, `${field}.${index}`, issues, seen);
    });
    return;
  }

  Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
    secretFreeSettingKey(key, `${field}.${key}`, issues);
    secretFreeSettingValue(entry, `${field}.${key}`, issues, seen);
  });
}

function enumValue<T extends readonly string[]>(
  value: unknown,
  values: T,
  field: string,
  issues: string[]
): void {
  if (typeof value !== "string" || !values.includes(value)) {
    issues.push(`${field} must be one of ${values.join(", ")}`);
  }
}

const taskStatusTransitions: Record<TaskStatus, readonly TaskStatus[]> = {
  open: ["running", "cancelled"],
  running: ["open", "completed", "cancelled"],
  completed: [],
  cancelled: []
};

const taskRunStatusTransitions: Record<TaskRunStatus, readonly TaskRunStatus[]> = {
  queued: ["running", "cancelled"],
  running: ["succeeded", "failed", "cancelled"],
  succeeded: [],
  failed: [],
  cancelled: []
};

const memoryStatusTransitions: Record<MemoryStatus, readonly MemoryStatus[]> = {
  proposed: ["approved", "rejected"],
  approved: [],
  rejected: []
};

const roleCallStatusTransitions: Record<RoleCallStatus, readonly RoleCallStatus[]> = {
  proposed: ["assessing", "waiting_approval", "rejected", "cancelled"],
  assessing: [
    "accepted",
    "deferred",
    "rejected",
    "waiting_context",
    "waiting_approval",
    "cancelled"
  ],
  accepted: ["queued", "running", "deferred", "cancelled"],
  queued: ["running", "cancelled"],
  running: ["succeeded", "failed", "waiting_context", "waiting_approval", "cancelled"],
  deferred: ["accepted", "rejected", "cancelled"],
  rejected: [],
  waiting_context: ["assessing", "rejected", "cancelled"],
  waiting_approval: ["accepted", "rejected", "cancelled"],
  succeeded: [],
  failed: [],
  cancelled: []
};

const roleTodoStatusTransitions: Record<RoleTodoStatus, readonly RoleTodoStatus[]> = {
  open: ["in_progress", "deferred", "blocked", "done", "rejected", "cancelled"],
  in_progress: ["deferred", "blocked", "done", "rejected", "cancelled"],
  deferred: ["open", "in_progress", "blocked", "done", "rejected", "cancelled"],
  blocked: ["open", "in_progress", "deferred", "rejected", "cancelled"],
  done: [],
  rejected: [],
  cancelled: []
};

const expectedOutputFormats = ["summary", "json", "patch", "risk_report"] as const;

const secretLikeSettingValuePatterns = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i,
  /\b(api[_-]?key|token|password|private[_-]?key|credentials?)\b\s*[:=]\s*["']?[^"'\s]+/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/i,
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|sk-[A-Za-z0-9]{20,})\b/i
];

const secretLikeAssignmentPattern =
  /([A-Za-z0-9_.:-]+)\s*[:=]\s*["']?[^"'\s]+/g;

function isSecretLikeSettingKey(key: string): boolean {
  const terms = splitSettingKeyTerms(key);
  return terms.some((term, index) =>
    term === "token" ||
    term === "secret" ||
    term === "password" ||
    term === "credential" ||
    term === "credentials" ||
    term === "apikey" ||
    term === "privatekey" ||
    (term === "api" && terms[index + 1] === "key") ||
    (term === "private" && terms[index + 1] === "key")
  );
}

function splitSettingKeyTerms(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[._:\-\s]+/)
    .map((term) => term.toLowerCase())
    .filter((term) => term.length > 0);
}

function containsSecretLikeAssignment(value: string): boolean {
  for (const match of value.matchAll(secretLikeAssignmentPattern)) {
    const key = match[1];
    if (key && isSecretLikeSettingKey(key)) {
      return true;
    }
  }
  return false;
}

function validateStatusTransition<T extends string>(
  from: T,
  to: T,
  transitions: Record<T, readonly T[]>,
  label: string
): void {
  if (from === to) {
    return;
  }
  if (!transitions[from]?.includes(to)) {
    throw new DomainStateTransitionError(
      `invalid ${label} status transition ${from} -> ${to}`
    );
  }
}

function finish<T>(input: T, issues: string[]): T {
  if (issues.length > 0) {
    throw new DomainValidationError(issues);
  }

  return input;
}
