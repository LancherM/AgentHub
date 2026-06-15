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
  deviationTypes,
  memoryCategories,
  memoryAutomationDecisionStatuses,
  memoryAutomationPolicyModes,
  memoryAutomationReasonCodes,
  memoryStatuses,
  normalizeWorkgroupRoleHandle,
  planEdgeTypes,
  planGraphStatuses,
  planNodeExecutionModes,
  planNodeKinds,
  planNodeRiskLevels,
  planNodeWorktreePolicies,
  retrievalRoutes,
  riskLevels,
  roleCallDispositions,
  roleCallEventTypes,
  roleCallStatuses,
  roleCallToolEventStatuses,
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
  traceEdgeTypes,
  traceEvidenceSourceTypes,
  traceNodeKinds,
  traceNodeStatuses,
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
  type Deviation,
  type ExecutionTraceGraph,
  type RuntimeContextPack,
  type MemoryItem,
  type MemoryAutomationDecision,
  type MemoryAutomationEvaluation,
  type MemoryAutomationPolicy,
  type MemoryStatus,
  type PlanGraph,
  type PlanGraphStatus,
  type PlanNode,
  type Project,
  type RiskReport,
  type RoleCall,
  type RoleCallDecision,
  type RoleCallEvent,
  type RoleCallStatus,
  type RoleCallToolEvent,
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
  type TraceEvidence,
  type TraceNode,
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

export function validatePlanGraphStatusTransition(
  from: PlanGraphStatus,
  to: PlanGraphStatus
): void {
  validateStatusTransition(from, to, planGraphStatusTransitions, "plan graph");
}

export function validatePlanGraph(input: PlanGraph): PlanGraph {
  const issues: string[] = [];
  required(input.id, "planGraph.id", issues);
  required(input.taskId, "planGraph.taskId", issues);
  optionalString(input.taskBriefArtifactId, "planGraph.taskBriefArtifactId", issues);
  if (!Number.isInteger(input.version) || input.version < 1) {
    issues.push("planGraph.version must be a positive integer");
  }
  enumValue(input.status, planGraphStatuses, "planGraph.status", issues);
  required(input.plannerNodeId, "planGraph.plannerNodeId", issues);
  if (input.createdByRole !== "planner") {
    issues.push("planGraph.createdByRole must be planner");
  }
  timestamp(input.createdAt, "planGraph.createdAt", issues);

  const nodeIds = validatePlanNodeArray(input.nodes, "planGraph.nodes", issues);
  const plannerNodes = Array.isArray(input.nodes)
    ? input.nodes.filter((node) => node.kind === "planner")
    : [];
  if (plannerNodes.length !== 1) {
    issues.push("planGraph.nodes must contain exactly one planner node");
  }
  const plannerNode = plannerNodes[0];
  if (plannerNode) {
    if (input.plannerNodeId !== plannerNode.id) {
      issues.push("planGraph.plannerNodeId must reference the planner node");
    }
    if ((plannerNode as { outputPlanGraphId?: string }).outputPlanGraphId !== input.id) {
      issues.push("planGraph planner node outputPlanGraphId must reference planGraph.id");
    }
  }

  validatePlanEdges(input.edges, "planGraph.edges", nodeIds, issues);
  validatePlanGraphDag(input.nodes, input.edges, issues);
  return finish(input, issues);
}

export function validateExecutionTraceGraph(
  input: ExecutionTraceGraph
): ExecutionTraceGraph {
  const issues: string[] = [];
  required(input.taskId, "executionTraceGraph.taskId", issues);
  required(input.planGraphId, "executionTraceGraph.planGraphId", issues);
  if (!Number.isInteger(input.planGraphVersion) || input.planGraphVersion < 1) {
    issues.push("executionTraceGraph.planGraphVersion must be a positive integer");
  }

  const baseNodeIds = validatePlanNodeArray(
    input.baseNodes,
    "executionTraceGraph.baseNodes",
    issues
  );
  validatePlanEdges(
    input.baseEdges,
    "executionTraceGraph.baseEdges",
    baseNodeIds,
    issues
  );
  validatePlanGraphDag(input.baseNodes, input.baseEdges, issues);

  const traceNodeIds = validateTraceNodeArray(
    input.dynamicNodes,
    "executionTraceGraph.dynamicNodes",
    input.planGraphId,
    baseNodeIds,
    issues
  );
  validateTraceEdges(
    input.dynamicEdges,
    "executionTraceGraph.dynamicEdges",
    input.planGraphId,
    new Set([...baseNodeIds, ...traceNodeIds]),
    issues
  );
  validateTraceEvidenceArray(
    input.evidence,
    "executionTraceGraph.evidence",
    input.planGraphId,
    baseNodeIds,
    new Set([...baseNodeIds, ...traceNodeIds]),
    issues
  );
  validateDeviationArray(
    input.deviations,
    "executionTraceGraph.deviations",
    input.planGraphId,
    baseNodeIds,
    new Set([...baseNodeIds, ...traceNodeIds]),
    issues
  );

  return finish(input, issues);
}

export function validateRoleCallToolEvent(
  input: RoleCallToolEvent
): RoleCallToolEvent {
  const issues: string[] = [];
  required(input.id, "roleCallToolEvent.id", issues);
  required(input.planGraphId, "roleCallToolEvent.planGraphId", issues);
  required(input.sourcePlanNodeId, "roleCallToolEvent.sourcePlanNodeId", issues);
  required(input.sourceRunId, "roleCallToolEvent.sourceRunId", issues);
  required(input.targetRole, "roleCallToolEvent.targetRole", issues);
  required(input.task, "roleCallToolEvent.task", issues);
  enumValue(input.status, roleCallToolEventStatuses, "roleCallToolEvent.status", issues);
  stringArray(input.createdTraceNodeIds, "roleCallToolEvent.createdTraceNodeIds", issues);
  timestamp(input.createdAt, "roleCallToolEvent.createdAt", issues);
  optionalTimestamp(input.updatedAt, "roleCallToolEvent.updatedAt", issues);
  return finish(input, issues);
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
  optionalObject(input.metadata, "memoryItem.metadata", issues);
  timestamp(input.createdAt, "memoryItem.createdAt", issues);
  timestamp(input.updatedAt, "memoryItem.updatedAt", issues);
  return finish(input, issues);
}

export function createDefaultMemoryAutomationPolicy(): MemoryAutomationPolicy {
  return {
    mode: "suggest_only",
    maxRiskLevel: "low",
    allowSkippedVerification: false,
    allowedCategories: ["workflow_rule"],
    maxAutoApprovalsPerRun: 2
  };
}

export function parseMemoryAutomationPolicySettingValue(
  value: unknown
): MemoryAutomationPolicy {
  if (value === undefined || value === null) {
    return createDefaultMemoryAutomationPolicy();
  }
  const issues: string[] = [];
  objectValue(value, "memoryAutomationPolicy", issues);
  if (issues.length > 0) {
    return finish(value as MemoryAutomationPolicy, issues);
  }

  const input = value as Record<string, unknown>;
  unknownObjectKeys(
    input,
    memoryAutomationPolicyKeys,
    "memoryAutomationPolicy",
    issues
  );
  const policy: MemoryAutomationPolicy = {
    ...createDefaultMemoryAutomationPolicy()
  };

  if (input.mode !== undefined) {
    policy.mode = input.mode as MemoryAutomationPolicy["mode"];
  }
  if (input.maxRiskLevel !== undefined) {
    policy.maxRiskLevel = input.maxRiskLevel as MemoryAutomationPolicy["maxRiskLevel"];
  }
  if (input.allowSkippedVerification !== undefined) {
    policy.allowSkippedVerification = input.allowSkippedVerification as boolean;
  }
  if (input.allowedCategories !== undefined) {
    policy.allowedCategories = input.allowedCategories as MemoryAutomationPolicy["allowedCategories"];
  }
  if (input.maxAutoApprovalsPerRun !== undefined) {
    policy.maxAutoApprovalsPerRun = input.maxAutoApprovalsPerRun as number;
  }

  if (issues.length > 0) {
    return finish(policy, issues);
  }
  return validateMemoryAutomationPolicy(policy);
}

export function validateMemoryAutomationPolicy(
  input: MemoryAutomationPolicy
): MemoryAutomationPolicy {
  const issues: string[] = [];
  objectValue(input, "memoryAutomationPolicy", issues);
  if (issues.length > 0) {
    return finish(input, issues);
  }
  enumValue(input.mode, memoryAutomationPolicyModes, "memoryAutomationPolicy.mode", issues);
  enumValue(input.maxRiskLevel, riskLevels, "memoryAutomationPolicy.maxRiskLevel", issues);
  if (typeof input.allowSkippedVerification !== "boolean") {
    issues.push("memoryAutomationPolicy.allowSkippedVerification must be a boolean");
  }
  memoryCategoryArray(
    input.allowedCategories,
    "memoryAutomationPolicy.allowedCategories",
    issues
  );
  nonNegativeInteger(
    input.maxAutoApprovalsPerRun,
    "memoryAutomationPolicy.maxAutoApprovalsPerRun",
    issues
  );
  if (
    Number.isInteger(input.maxAutoApprovalsPerRun) &&
    input.maxAutoApprovalsPerRun > 10
  ) {
    issues.push("memoryAutomationPolicy.maxAutoApprovalsPerRun must be 10 or less");
  }
  return finish(input, issues);
}

export function validateMemoryAutomationDecision(
  input: MemoryAutomationDecision
): MemoryAutomationDecision {
  const issues: string[] = [];
  required(input.memoryId, "memoryAutomationDecision.memoryId", issues);
  enumValue(
    input.status,
    memoryAutomationDecisionStatuses,
    "memoryAutomationDecision.status",
    issues
  );
  reasonCodeArray(
    input.reasonCodes,
    "memoryAutomationDecision.reasonCodes",
    issues
  );
  optionalString(input.message, "memoryAutomationDecision.message", issues);
  return finish(input, issues);
}

export function validateMemoryAutomationEvaluation(
  input: MemoryAutomationEvaluation
): MemoryAutomationEvaluation {
  const issues: string[] = [];
  required(input.runId, "memoryAutomationEvaluation.runId", issues);
  try {
    validateMemoryAutomationPolicy(input.policy);
  } catch (error) {
    if (error instanceof DomainValidationError) {
      issues.push(...error.issues);
    } else {
      throw error;
    }
  }
  if (!Array.isArray(input.decisions)) {
    issues.push("memoryAutomationEvaluation.decisions must be an array");
  } else {
    input.decisions.forEach((decision, index) => {
      try {
        validateMemoryAutomationDecision(decision);
      } catch (error) {
        if (error instanceof DomainValidationError) {
          issues.push(
            ...error.issues.map((issue) =>
              issue.replace("memoryAutomationDecision", `memoryAutomationEvaluation.decisions.${index}`)
            )
          );
        } else {
          throw error;
        }
      }
    });
  }
  optionalTimestamp(input.createdAt, "memoryAutomationEvaluation.createdAt", issues);
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

function validatePlanNodeArray(
  value: unknown,
  field: string,
  issues: string[]
): Set<string> {
  const nodeIds = new Set<string>();
  if (!Array.isArray(value) || value.length === 0) {
    issues.push(`${field} must be a non-empty array`);
    return nodeIds;
  }
  value.forEach((node, index) => {
    validatePlanNode(node as PlanNode, `${field}.${index}`, issues);
    const id = plainObject(node) && typeof node.id === "string" ? node.id : undefined;
    if (!id) {
      return;
    }
    if (nodeIds.has(id)) {
      issues.push(`${field}.${index}.id must be unique`);
    }
    nodeIds.add(id);
  });
  return nodeIds;
}

function validatePlanNode(
  value: PlanNode,
  field: string,
  issues: string[]
): void {
  objectValue(value, field, issues);
  if (!plainObject(value)) {
    return;
  }
  required(value.id, `${field}.id`, issues);
  enumValue(value.kind, planNodeKinds, `${field}.kind`, issues);
  required(value.title, `${field}.title`, issues);
  required(value.role, `${field}.role`, issues);
  required(value.instructions, `${field}.instructions`, issues);
  stringArray(value.acceptanceCriteria, `${field}.acceptanceCriteria`, issues);
  enumValue(value.riskLevel, planNodeRiskLevels, `${field}.riskLevel`, issues);
  booleanValue(value.required, `${field}.required`, issues);
  validatePlanNodeExecution(value.execution, `${field}.execution`, issues);

  if (value.kind === "planner") {
    if (value.role !== "planner") {
      issues.push(`${field}.role must be planner for planner nodes`);
    }
    required(
      (value as { outputPlanGraphId?: string }).outputPlanGraphId,
      `${field}.outputPlanGraphId`,
      issues
    );
  }

  if (plainObject(value.execution) && value.execution.mode === "primary_run") {
    if (typeof value.role !== "string" || value.role.trim().length === 0) {
      issues.push(`${field}.role is required for primary_run nodes`);
    }
    if (!Array.isArray(value.acceptanceCriteria) || value.acceptanceCriteria.length === 0) {
      issues.push(`${field}.acceptanceCriteria must be non-empty for primary_run nodes`);
    }
  }

  validatePlanNodeInstructionsAreSafe(value, field, issues);
}

function validatePlanNodeExecution(
  value: unknown,
  field: string,
  issues: string[]
): void {
  objectValue(value, field, issues);
  if (!plainObject(value)) {
    return;
  }
  enumValue(value.mode, planNodeExecutionModes, `${field}.mode`, issues);
  if (value.expectedAdapter !== undefined) {
    enumValue(value.expectedAdapter, agentKinds, `${field}.expectedAdapter`, issues);
  }
  if (value.worktreePolicy !== undefined) {
    enumValue(value.worktreePolicy, planNodeWorktreePolicies, `${field}.worktreePolicy`, issues);
  }
}

function validatePlanEdges(
  value: unknown,
  field: string,
  nodeIds: Set<string>,
  issues: string[]
): void {
  if (!Array.isArray(value)) {
    issues.push(`${field} must be an array`);
    return;
  }
  value.forEach((edge, index) => {
    objectValue(edge, `${field}.${index}`, issues);
    if (!plainObject(edge)) {
      return;
    }
    required(edge.from, `${field}.${index}.from`, issues);
    required(edge.to, `${field}.${index}.to`, issues);
    enumValue(edge.type, planEdgeTypes, `${field}.${index}.type`, issues);
    optionalString(edge.label, `${field}.${index}.label`, issues);
    if (typeof edge.from === "string" && !nodeIds.has(edge.from)) {
      issues.push(`${field}.${index}.from must reference an existing node`);
    }
    if (typeof edge.to === "string" && !nodeIds.has(edge.to)) {
      issues.push(`${field}.${index}.to must reference an existing node`);
    }
  });
}

function validatePlanGraphDag(
  nodes: unknown,
  edges: unknown,
  issues: string[]
): void {
  if (!Array.isArray(nodes) || !Array.isArray(edges)) {
    return;
  }
  const nodeIds = nodes
    .filter((node): node is { id: string } => plainObject(node) && typeof node.id === "string")
    .map((node) => node.id);
  const adjacency = new Map<string, string[]>();
  for (const id of nodeIds) {
    adjacency.set(id, []);
  }
  for (const edge of edges) {
    if (!plainObject(edge) || typeof edge.from !== "string" || typeof edge.to !== "string") {
      continue;
    }
    if (adjacency.has(edge.from) && adjacency.has(edge.to)) {
      adjacency.get(edge.from)?.push(edge.to);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) {
      return true;
    }
    if (visited.has(id)) {
      return false;
    }
    visiting.add(id);
    for (const next of adjacency.get(id) ?? []) {
      if (visit(next)) {
        return true;
      }
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };

  if (nodeIds.some((id) => visit(id))) {
    issues.push("planGraph.edges must form a DAG");
  }
}

function validateTraceNodeArray(
  value: unknown,
  field: string,
  planGraphId: string,
  planNodeIds: Set<string>,
  issues: string[]
): Set<string> {
  const nodeIds = new Set<string>();
  if (!Array.isArray(value)) {
    issues.push(`${field} must be an array`);
    return nodeIds;
  }
  value.forEach((node, index) => {
    validateTraceNode(node as TraceNode, `${field}.${index}`, planGraphId, planNodeIds, issues);
    const id = plainObject(node) && typeof node.id === "string" ? node.id : undefined;
    if (!id) {
      return;
    }
    if (nodeIds.has(id) || planNodeIds.has(id)) {
      issues.push(`${field}.${index}.id must be unique across trace and plan nodes`);
    }
    nodeIds.add(id);
  });
  return nodeIds;
}

function validateTraceNode(
  value: TraceNode,
  field: string,
  planGraphId: string,
  planNodeIds: Set<string>,
  issues: string[]
): void {
  objectValue(value, field, issues);
  if (!plainObject(value)) {
    return;
  }
  required(value.id, `${field}.id`, issues);
  required(value.planGraphId, `${field}.planGraphId`, issues);
  if (value.planGraphId !== planGraphId) {
    issues.push(`${field}.planGraphId must match executionTraceGraph.planGraphId`);
  }
  enumValue(value.kind, traceNodeKinds, `${field}.kind`, issues);
  required(value.title, `${field}.title`, issues);
  enumValue(value.status, traceNodeStatuses, `${field}.status`, issues);
  optionalString(value.sourcePlanNodeId, `${field}.sourcePlanNodeId`, issues);
  optionalString(value.role, `${field}.role`, issues);
  if (value.sourceType !== undefined) {
    enumValue(value.sourceType, traceEvidenceSourceTypes, `${field}.sourceType`, issues);
  }
  optionalString(value.sourceId, `${field}.sourceId`, issues);
  optionalTimestamp(value.createdAt, `${field}.createdAt`, issues);
  if (value.sourcePlanNodeId !== undefined && !planNodeIds.has(value.sourcePlanNodeId)) {
    issues.push(`${field}.sourcePlanNodeId must reference a base plan node`);
  }
}

function validateTraceEdges(
  value: unknown,
  field: string,
  planGraphId: string,
  nodeIds: Set<string>,
  issues: string[]
): void {
  if (!Array.isArray(value)) {
    issues.push(`${field} must be an array`);
    return;
  }
  value.forEach((edge, index) => {
    objectValue(edge, `${field}.${index}`, issues);
    if (!plainObject(edge)) {
      return;
    }
    required(edge.id, `${field}.${index}.id`, issues);
    required(edge.planGraphId, `${field}.${index}.planGraphId`, issues);
    if (edge.planGraphId !== planGraphId) {
      issues.push(`${field}.${index}.planGraphId must match executionTraceGraph.planGraphId`);
    }
    required(edge.from, `${field}.${index}.from`, issues);
    required(edge.to, `${field}.${index}.to`, issues);
    enumValue(edge.type, traceEdgeTypes, `${field}.${index}.type`, issues);
    optionalString(edge.label, `${field}.${index}.label`, issues);
    if (typeof edge.from === "string" && !nodeIds.has(edge.from)) {
      issues.push(`${field}.${index}.from must reference an existing trace or plan node`);
    }
    if (typeof edge.to === "string" && !nodeIds.has(edge.to)) {
      issues.push(`${field}.${index}.to must reference an existing trace or plan node`);
    }
  });
}

function validateTraceEvidenceArray(
  value: unknown,
  field: string,
  planGraphId: string,
  planNodeIds: Set<string>,
  nodeIds: Set<string>,
  issues: string[]
): void {
  if (!Array.isArray(value)) {
    issues.push(`${field} must be an array`);
    return;
  }
  value.forEach((evidence, index) => {
    validateTraceEvidence(
      evidence as TraceEvidence,
      `${field}.${index}`,
      planGraphId,
      planNodeIds,
      nodeIds,
      issues
    );
  });
}

function validateTraceEvidence(
  value: TraceEvidence,
  field: string,
  planGraphId: string,
  planNodeIds: Set<string>,
  nodeIds: Set<string>,
  issues: string[]
): void {
  objectValue(value, field, issues);
  if (!plainObject(value)) {
    return;
  }
  required(value.id, `${field}.id`, issues);
  required(value.planGraphId, `${field}.planGraphId`, issues);
  if (value.planGraphId !== planGraphId) {
    issues.push(`${field}.planGraphId must match executionTraceGraph.planGraphId`);
  }
  enumValue(value.sourceType, traceEvidenceSourceTypes, `${field}.sourceType`, issues);
  required(value.sourceId, `${field}.sourceId`, issues);
  optionalString(value.planNodeId, `${field}.planNodeId`, issues);
  optionalString(value.traceNodeId, `${field}.traceNodeId`, issues);
  optionalString(value.summary, `${field}.summary`, issues);
  optionalTimestamp(value.createdAt, `${field}.createdAt`, issues);
  if (value.planNodeId !== undefined && !planNodeIds.has(value.planNodeId)) {
    issues.push(`${field}.planNodeId must reference an existing base plan node`);
  }
  if (value.traceNodeId !== undefined && !nodeIds.has(value.traceNodeId)) {
    issues.push(`${field}.traceNodeId must reference an existing node`);
  }
}

function validateDeviationArray(
  value: unknown,
  field: string,
  planGraphId: string,
  planNodeIds: Set<string>,
  nodeIds: Set<string>,
  issues: string[]
): void {
  if (!Array.isArray(value)) {
    issues.push(`${field} must be an array`);
    return;
  }
  value.forEach((deviation, index) => {
    validateDeviation(
      deviation as Deviation,
      `${field}.${index}`,
      planGraphId,
      planNodeIds,
      nodeIds,
      issues
    );
  });
}

function validateDeviation(
  value: Deviation,
  field: string,
  planGraphId: string,
  planNodeIds: Set<string>,
  nodeIds: Set<string>,
  issues: string[]
): void {
  objectValue(value, field, issues);
  if (!plainObject(value)) {
    return;
  }
  required(value.id, `${field}.id`, issues);
  required(value.planGraphId, `${field}.planGraphId`, issues);
  if (value.planGraphId !== planGraphId) {
    issues.push(`${field}.planGraphId must match executionTraceGraph.planGraphId`);
  }
  enumValue(value.type, deviationTypes, `${field}.type`, issues);
  enumValue(value.severity, planNodeRiskLevels, `${field}.severity`, issues);
  required(value.description, `${field}.description`, issues);
  optionalString(value.planNodeId, `${field}.planNodeId`, issues);
  optionalString(value.traceNodeId, `${field}.traceNodeId`, issues);
  optionalString(value.evidenceId, `${field}.evidenceId`, issues);
  timestamp(value.createdAt, `${field}.createdAt`, issues);
  if (value.planNodeId !== undefined && !planNodeIds.has(value.planNodeId)) {
    issues.push(`${field}.planNodeId must reference an existing base plan node`);
  }
  if (value.traceNodeId !== undefined && !nodeIds.has(value.traceNodeId)) {
    issues.push(`${field}.traceNodeId must reference an existing node`);
  }
}

function validatePlanNodeInstructionsAreSafe(
  value: PlanNode,
  field: string,
  issues: string[]
): void {
  const text = [
    value.title,
    value.instructions,
    ...(Array.isArray(value.acceptanceCriteria) ? value.acceptanceCriteria : [])
  ]
    .filter((entry): entry is string => typeof entry === "string")
    .join("\n");
  const prohibited = prohibitedPlanInstructionPatterns.find((entry) =>
    containsProhibitedAction(text, entry.pattern)
  );
  if (prohibited) {
    issues.push(`${field}.instructions must not request ${prohibited.reason}`);
  }
}

function containsProhibitedAction(text: string, pattern: RegExp): boolean {
  for (const match of text.matchAll(pattern)) {
    const before = text.slice(Math.max(0, match.index - 32), match.index).toLowerCase();
    if (/\b(do not|don't|must not|never|avoid|without|no)\b/.test(before)) {
      continue;
    }
    return true;
  }
  return false;
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

function memoryCategoryArray(
  value: unknown,
  field: string,
  issues: string[]
): void {
  if (!Array.isArray(value)) {
    issues.push(`${field} must be an array of memory categories`);
    return;
  }
  const seen = new Set<string>();
  for (const entry of value) {
    if (!(memoryCategories as readonly string[]).includes(String(entry))) {
      issues.push(`${field} contains unsupported memory category ${String(entry)}`);
      continue;
    }
    if (seen.has(String(entry))) {
      issues.push(`${field} must not contain duplicate category ${String(entry)}`);
    }
    seen.add(String(entry));
  }
}

function reasonCodeArray(
  value: unknown,
  field: string,
  issues: string[]
): void {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push(`${field} must be a non-empty array of reason codes`);
    return;
  }
  for (const entry of value) {
    if (!(memoryAutomationReasonCodes as readonly string[]).includes(String(entry))) {
      issues.push(`${field} contains unsupported reason code ${String(entry)}`);
    }
  }
}

function unknownObjectKeys(
  value: Record<string, unknown>,
  allowedKeys: Set<string>,
  field: string,
  issues: string[]
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(`${field} contains unsupported field ${key}`);
    }
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
  if (value.planTrace !== undefined) {
    objectValue(value.planTrace, `${field}.planTrace`, issues);
    if (plainObject(value.planTrace)) {
      required(value.planTrace.planGraphId, `${field}.planTrace.planGraphId`, issues);
      const planGraphVersion = value.planTrace.planGraphVersion;
      if (
        typeof planGraphVersion !== "number" ||
        !Number.isInteger(planGraphVersion) ||
        planGraphVersion <= 0
      ) {
        issues.push(`${field}.planTrace.planGraphVersion must be a positive integer`);
      }
      required(
        value.planTrace.sourcePlanNodeId,
        `${field}.planTrace.sourcePlanNodeId`,
        issues
      );
      required(value.planTrace.sourceRunId, `${field}.planTrace.sourceRunId`, issues);
      optionalString(value.planTrace.traceNodeId, `${field}.planTrace.traceNodeId`, issues);
      optionalStringArray(
        value.planTrace.allowedNextPlanNodeIds,
        `${field}.planTrace.allowedNextPlanNodeIds`,
        issues
      );
    }
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
  approved: ["retired"],
  rejected: [],
  retired: []
};

const memoryAutomationPolicyKeys = new Set([
  "mode",
  "maxRiskLevel",
  "allowSkippedVerification",
  "allowedCategories",
  "maxAutoApprovalsPerRun"
]);

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

const planGraphStatusTransitions: Record<PlanGraphStatus, readonly PlanGraphStatus[]> = {
  proposed: ["active", "failed"],
  active: ["superseded", "failed"],
  superseded: [],
  failed: []
};

const prohibitedPlanInstructionPatterns: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\b(?:git\s+push|push\s+(?:the\s+)?(?:branch|changes|code)|automatically\s+push|auto-?push)\b/gi,
    reason: "automatic git push"
  },
  {
    pattern: /\b(?:git\s+merge|merge\s+(?:the\s+)?(?:branch|changes|pull request)|automatically\s+merge|auto-?merge)\b/gi,
    reason: "automatic merge"
  },
  {
    pattern: /\b(?:(?:create|open|submit)\s+(?:a\s+)?(?:pull request|pr)|automatic\s+(?:pull request|pr))\b/gi,
    reason: "automatic pull request creation"
  },
  {
    pattern: /\b(?:approve\s+memory|memory\s+approval|automatically\s+approve\s+memory)\b/gi,
    reason: "memory approval"
  },
  {
    pattern: /\b(?:repo(?:sitory)?\s+export|export\s+(?:AGENTS\.md|CLAUDE\.md|\.claude\/skills|\.agents\/skills))\b/gi,
    reason: "repository export"
  },
  {
    pattern: /\b(?:write|create|update)\s+(?:AGENTS\.md|CLAUDE\.md|\.claude\/skills|\.agents\/skills).*\b(?:repo(?:sitory)?\s+root|checkout\s+root|project\s+root)\b/gi,
    reason: "repository-root context file writes"
  }
];

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
