export const roleTrustLevels = ["preset", "user_defined", "restricted"] as const;
export type RoleTrustLevel = (typeof roleTrustLevels)[number];

export const roleIntentTypes = [
  "delegate",
  "request_analysis",
  "request_review",
  "request_evidence",
  "request_approval",
  "report_result",
  "raise_risk",
  "update_todo"
] as const;
export type RoleIntentType = (typeof roleIntentTypes)[number];

export const rolePriorities = ["low", "normal", "high", "urgent"] as const;
export type RolePriority = (typeof rolePriorities)[number];

export const roleCallStatuses = [
  "proposed",
  "assessing",
  "accepted",
  "queued",
  "running",
  "deferred",
  "rejected",
  "waiting_context",
  "waiting_approval",
  "succeeded",
  "failed",
  "cancelled"
] as const;
export type RoleCallStatus = (typeof roleCallStatuses)[number];

export const roleCallDispositions = [
  "accepted",
  "rejected",
  "deferred",
  "needs_context",
  "needs_approval"
] as const;
export type RoleCallDisposition = (typeof roleCallDispositions)[number];

export const roleTodoStatuses = [
  "open",
  "in_progress",
  "deferred",
  "blocked",
  "done",
  "rejected",
  "cancelled"
] as const;
export type RoleTodoStatus = (typeof roleTodoStatuses)[number];

export const roleCallEventTypes = [
  "created",
  "assessment_started",
  "accepted",
  "deferred",
  "rejected",
  "context_requested",
  "approval_requested",
  "queued",
  "started",
  "todo_created",
  "todo_updated",
  "result_reported",
  "failed",
  "cancelled"
] as const;
export type RoleCallEventType = (typeof roleCallEventTypes)[number];

export const roleExecutorKinds = [
  "agent_adapter",
  "local_workflow",
  "human",
  "llm_api"
] as const;
export type RoleExecutorKind = (typeof roleExecutorKinds)[number];
export type RoleAgentAdapterKind = "fake" | "codex" | "claude-code";

export type RoleCapability = string;

export interface PermissionSet {
  canReadFiles: boolean;
  canEditFiles: boolean;
  canRunCommands: boolean;
  canUseNetwork: boolean;
  canAskUser: boolean;
  requiresApprovalForShell: boolean;
  requiresApprovalForFileWrite: boolean;
  allowedCommandPatterns?: string[];
  deniedCommandPatterns?: string[];
}

export interface DelegationPolicy {
  canInitiateRoleCalls: boolean;
  allowedIntentTypes: RoleIntentType[];
  allowedTargetRoles?: string[];
  allowedTargetCapabilities?: string[];
  requiresApprovalForTargets?: string[];
}

export interface IntakePolicy {
  acceptsRoleCalls: boolean;
  acceptedCallerRoles?: string[];
  acceptedCallerCapabilities?: string[];
  acceptedIntentTypes: RoleIntentType[];
  canReject: boolean;
  canDefer: boolean;
}

export interface RoleContextPolicy {
  scope: string;
  includeApprovedMemory: boolean;
  includeThreadSummary: boolean;
  instructions: string[];
}

export interface RoleApprovalPolicy {
  requiredFor: string[];
  summary: string;
}

export type RoleExecutor =
  | { kind: "agent_adapter"; adapter: RoleAgentAdapterKind; configRef?: string }
  | { kind: "local_workflow"; workflowId: string }
  | { kind: "human"; configRef?: string; unavailableReason?: string }
  | { kind: "llm_api"; modelRef: string };

export interface ExpectedOutputSpec {
  format: "summary" | "json" | "patch" | "risk_report";
  description?: string;
  schemaRef?: string;
  requiredEvidence?: string[];
}

export interface RoleResultCommand {
  command: string;
  exitCode: number | null;
  outputSummary: string;
}

export interface RoleResult {
  summary: string;
  evidence: string[];
  commandsRun?: RoleResultCommand[];
  filesRead?: string[];
  filesTouched?: string[];
  patchSummary?: string;
  risks?: string[];
  nextSteps?: string[];
  rawOutput?: string;
}

export interface RoleCallContext {
  userGoal: string;
  currentPlan?: string;
  relevantFiles?: string[];
  recentFindings?: string[];
  constraints?: string[];
  previousRoleResults?: RoleResult[];
  callerTodoState?: RoleTodo[];
  calleeTodoState?: RoleTodo[];
  repoState?: {
    branch?: string;
    changedFiles?: string[];
    testStatus?: string;
  };
  tokenBudget?: number;
  planTrace?: RoleCallPlanTraceContext;
}

export interface RoleCallPlanTraceContext {
  planGraphId: string;
  planGraphVersion: number;
  sourcePlanNodeId: string;
  sourceRunId: string;
  traceNodeId?: string;
  allowedNextPlanNodeIds?: string[];
}

export interface RoleDecisionTodoDraft {
  title: string;
  priority?: RolePriority;
  dueHint?: string;
}

export interface RoleCallDecision {
  disposition: RoleCallDisposition;
  reason: string;
  evidence?: string[];
  requiredContext?: string[];
  suggestedResumeCondition?: string;
  alternativeTask?: string;
  risk?: string;
  todo?: RoleDecisionTodoDraft;
}

export interface RoleTodo {
  id: string;
  threadId: string;
  role: string;
  sourceRoleCallId?: string;
  parentTodoId?: string;
  title: string;
  description?: string;
  status: RoleTodoStatus;
  priority: RolePriority;
  reason?: string;
  blockedBy?: string[];
  relatedRoleCallIds: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface RoleCallEvent {
  id: string;
  roleCallId: string;
  threadId: string;
  type: RoleCallEventType;
  actorRole?: string;
  message: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface RoleCall {
  id: string;
  threadId: string;
  parentMessageId?: string;
  parentRoleCallId?: string;
  callerRole: string;
  calleeRole: string;
  task: string;
  reason?: string;
  context: RoleCallContext;
  permissions: PermissionSet;
  expectedOutput: ExpectedOutputSpec;
  priority: RolePriority;
  depth: number;
  status: RoleCallStatus;
  decision?: RoleCallDecision;
  result?: RoleResult;
  taskRunId?: string;
  todoId?: string;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface RoleDefinition {
  id: string;
  handle: string;
  displayName: string;
  purpose: string;
  defaultInstructions: string;
  capabilities: RoleCapability[];
  permissions: PermissionSet;
  contextPolicy: RoleContextPolicy;
  approvalPolicy: RoleApprovalPolicy;
  delegationPolicy: DelegationPolicy;
  intakePolicy: IntakePolicy;
  executor: RoleExecutor;
  trustLevel: RoleTrustLevel;
  enabled: boolean;
}

export interface RoleExecutionPolicy {
  maxDepth: number;
  maxSubtasksPerTurn: number;
  maxConcurrentRoleCalls: number;
  maxContextTokensPerRoleCall: number;
  requireStructuredResult: boolean;
  requireEvidenceForResult: boolean;
  requireApprovalForFileWrite: boolean;
  requireApprovalForDangerousShell: boolean;
  blockDangerousCommands: boolean;
  allowedDelegations: Record<string, string[]>;
  defaultUserDefinedRoleTrustLevel: RoleTrustLevel;
  maxTodosPerRole?: number;
}

export interface DelegateRoleIntent {
  type: "delegate";
  targetRole: string;
  task: string;
  reason: string;
  expectedOutput: ExpectedOutputSpec;
  priority?: RolePriority;
}

export interface RequestAnalysisRoleIntent {
  type: "request_analysis";
  targetRole: string;
  task: string;
  reason: string;
  expectedOutput?: ExpectedOutputSpec;
  priority?: RolePriority;
}

export interface RequestReviewRoleIntent {
  type: "request_review";
  targetRole: string;
  artifactId?: string;
  task: string;
  reason: string;
  priority?: RolePriority;
}

export interface RequestEvidenceRoleIntent {
  type: "request_evidence";
  targetRole: string;
  question: string;
  requiredEvidence?: string[];
  priority?: RolePriority;
}

export interface RequestApprovalRoleIntent {
  type: "request_approval";
  approvalType: string;
  reason: string;
  requestedAction: string;
  priority?: RolePriority;
}

export interface ReportResultRoleIntent {
  type: "report_result";
  result: RoleResult;
}

export interface RaiseRiskRoleIntent {
  type: "raise_risk";
  risk: string;
  evidence: string[];
}

export interface UpdateTodoRoleIntent {
  type: "update_todo";
  todoId?: string;
  status: RoleTodoStatus;
  note: string;
}

export type RoleIntent =
  | DelegateRoleIntent
  | RequestAnalysisRoleIntent
  | RequestReviewRoleIntent
  | RequestEvidenceRoleIntent
  | RequestApprovalRoleIntent
  | ReportResultRoleIntent
  | RaiseRiskRoleIntent
  | UpdateTodoRoleIntent;

export const conservativePermissionSet: PermissionSet = {
  canReadFiles: true,
  canEditFiles: false,
  canRunCommands: false,
  canUseNetwork: false,
  canAskUser: false,
  requiresApprovalForShell: true,
  requiresApprovalForFileWrite: true
};

export const conservativeDelegationPolicy: DelegationPolicy = {
  canInitiateRoleCalls: false,
  allowedIntentTypes: [],
  allowedTargetRoles: [],
  allowedTargetCapabilities: [],
  requiresApprovalForTargets: ["operator", "engineer"]
};

export const conservativeIntakePolicy: IntakePolicy = {
  acceptsRoleCalls: true,
  acceptedIntentTypes: ["request_analysis", "request_review"],
  acceptedCallerRoles: [],
  acceptedCallerCapabilities: [],
  canReject: true,
  canDefer: true
};

export const defaultRoleExecutionPolicy: RoleExecutionPolicy = {
  maxDepth: 3,
  maxSubtasksPerTurn: 5,
  maxConcurrentRoleCalls: 2,
  maxContextTokensPerRoleCall: 6000,
  requireStructuredResult: true,
  requireEvidenceForResult: true,
  requireApprovalForFileWrite: true,
  requireApprovalForDangerousShell: true,
  blockDangerousCommands: true,
  allowedDelegations: {},
  defaultUserDefinedRoleTrustLevel: "restricted",
  maxTodosPerRole: 20
};
