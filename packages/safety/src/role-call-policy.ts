import {
  defaultRoleExecutionPolicy,
  type DelegationPolicy,
  type IntakePolicy,
  type PermissionSet,
  type RoleCall,
  type RoleDefinition,
  type RoleExecutionPolicy,
  type RoleIntent,
  type RoleTodo
} from "@agent-hub/core";
import {
  detectDangerousCommandText,
  type DangerousCommandMatch
} from "./dangerous-commands";

export type RoleCallPolicyStatus =
  | "allowed"
  | "approval_required"
  | "blocked";

export interface RoleCallPolicyRequest {
  callerRole: RoleDefinition;
  calleeRole: RoleDefinition;
  intent: RoleIntent;
  executionPolicy?: RoleExecutionPolicy;
  currentDepth?: number;
  activeRoleCalls?: readonly RoleCall[];
  existingRoleCalls?: readonly RoleCall[];
  roleTodos?: readonly RoleTodo[];
  requestedPermissions?: PermissionSet;
  approvalGranted?: boolean;
}

export interface RoleCallPolicyResult {
  allowed: boolean;
  status: RoleCallPolicyStatus;
  reasons: string[];
  warnings: string[];
  approvalReasons: string[];
  dangerousCommands: DangerousCommandMatch[];
}

export function validateRoleCallPolicy(
  request: RoleCallPolicyRequest
): RoleCallPolicyResult {
  const policy = request.executionPolicy ?? defaultRoleExecutionPolicy;
  const reasons: string[] = [];
  const warnings: string[] = [];
  const approvalReasons: string[] = [];
  const intentType = request.intent.type;
  const targetRole = roleIntentTargetRole(request.intent);
  const callerPolicy = request.callerRole.delegationPolicy;
  const calleePolicy = request.calleeRole.intakePolicy;

  if (!request.callerRole.enabled) {
    reasons.push(`Caller role @${request.callerRole.handle} is disabled.`);
  }
  if (!request.calleeRole.enabled) {
    reasons.push(`Callee role @${request.calleeRole.handle} is disabled.`);
  }
  if (targetRole !== undefined && targetRole !== request.calleeRole.handle) {
    reasons.push(
      `Intent target @${targetRole} does not match callee @${request.calleeRole.handle}.`
    );
  }

  validateCallerDelegation(
    callerPolicy,
    request.callerRole,
    request.calleeRole,
    intentType,
    reasons,
    approvalReasons
  );
  validateCalleeIntake(
    calleePolicy,
    request.callerRole,
    request.calleeRole,
    intentType,
    reasons
  );
  validateProjectPolicy(
    policy,
    request.callerRole,
    request.calleeRole,
    reasons
  );
  validateGraphLimits(request, policy, reasons);
  validateExecutorCapability(request.calleeRole, warnings, reasons);
  validatePermissions(request, policy, reasons, approvalReasons);

  const dangerousCommands = detectDangerousCommandText(roleIntentSearchText(request.intent));
  if (dangerousCommands.length > 0) {
    if (policy.blockDangerousCommands) {
      reasons.push(
        `Dangerous command text is blocked: ${dangerousCommands
          .map((match) => match.summary)
          .join("; ")}`
      );
    } else if (policy.requireApprovalForDangerousShell) {
      approvalReasons.push("dangerous shell command");
    }
  }

  if (reasons.length > 0) {
    return {
      allowed: false,
      status: "blocked",
      reasons,
      warnings,
      approvalReasons,
      dangerousCommands
    };
  }
  if (approvalReasons.length > 0 && request.approvalGranted !== true) {
    return {
      allowed: false,
      status: "approval_required",
      reasons,
      warnings,
      approvalReasons,
      dangerousCommands
    };
  }
  return {
    allowed: true,
    status: "allowed",
    reasons,
    warnings,
    approvalReasons,
    dangerousCommands
  };
}

function validateCallerDelegation(
  policy: DelegationPolicy,
  callerRole: RoleDefinition,
  calleeRole: RoleDefinition,
  intentType: RoleIntent["type"],
  reasons: string[],
  approvalReasons: string[]
): void {
  if (!policy.canInitiateRoleCalls) {
    reasons.push(`Caller role @${callerRole.handle} cannot initiate role calls.`);
    return;
  }
  if (!policy.allowedIntentTypes.includes(intentType)) {
    reasons.push(
      `Caller role @${callerRole.handle} cannot initiate ${intentType} intents.`
    );
  }

  const directRoleAllowed =
    policy.allowedTargetRoles?.includes("*") ||
    policy.allowedTargetRoles?.includes(calleeRole.handle);
  const capabilityAllowed = calleeRole.capabilities.some((capability) =>
    policy.allowedTargetCapabilities?.includes(capability)
  );
  const hasTargetRestrictions =
    (policy.allowedTargetRoles?.length ?? 0) > 0 ||
    (policy.allowedTargetCapabilities?.length ?? 0) > 0;
  if (hasTargetRestrictions && !directRoleAllowed && !capabilityAllowed) {
    reasons.push(
      `Caller role @${callerRole.handle} cannot target @${calleeRole.handle}.`
    );
  }

  const requiresApproval =
    policy.requiresApprovalForTargets?.includes(calleeRole.handle) ||
    calleeRole.capabilities.some((capability) =>
      policy.requiresApprovalForTargets?.includes(capability)
    ) ||
    policy.requiresApprovalForTargets?.includes("*");
  if (requiresApproval) {
    approvalReasons.push(`target @${calleeRole.handle}`);
  }
}

function validateCalleeIntake(
  policy: IntakePolicy,
  callerRole: RoleDefinition,
  calleeRole: RoleDefinition,
  intentType: RoleIntent["type"],
  reasons: string[]
): void {
  if (!policy.acceptsRoleCalls) {
    reasons.push(`Callee role @${calleeRole.handle} does not accept role calls.`);
    return;
  }
  if (!policy.acceptedIntentTypes.includes(intentType)) {
    reasons.push(
      `Callee role @${calleeRole.handle} does not accept ${intentType} intents.`
    );
  }
  const callerRoleRestricted = (policy.acceptedCallerRoles?.length ?? 0) > 0;
  const callerCapabilityRestricted =
    (policy.acceptedCallerCapabilities?.length ?? 0) > 0;
  if (
    callerRoleRestricted &&
    !policy.acceptedCallerRoles?.includes(callerRole.handle)
  ) {
    reasons.push(
      `Callee role @${calleeRole.handle} does not accept caller @${callerRole.handle}.`
    );
  }
  if (
    callerCapabilityRestricted &&
    !callerRole.capabilities.some((capability) =>
      policy.acceptedCallerCapabilities?.includes(capability)
    )
  ) {
    reasons.push(
      `Callee role @${calleeRole.handle} does not accept caller capabilities from @${callerRole.handle}.`
    );
  }
}

function validateProjectPolicy(
  policy: RoleExecutionPolicy,
  callerRole: RoleDefinition,
  calleeRole: RoleDefinition,
  reasons: string[]
): void {
  const allowedTargets =
    policy.allowedDelegations[callerRole.handle] ?? policy.allowedDelegations["*"];
  if (allowedTargets === undefined) {
    return;
  }
  if (allowedTargets.includes("*") || allowedTargets.includes(calleeRole.handle)) {
    return;
  }
  reasons.push(
    `Project policy does not allow @${callerRole.handle} to call @${calleeRole.handle}.`
  );
}

function validateGraphLimits(
  request: RoleCallPolicyRequest,
  policy: RoleExecutionPolicy,
  reasons: string[]
): void {
  const nextDepth = (request.currentDepth ?? 0) + 1;
  if (nextDepth > policy.maxDepth) {
    reasons.push(`Role call depth ${nextDepth} exceeds max depth ${policy.maxDepth}.`);
  }
  const activeCount = (request.activeRoleCalls ?? []).filter((call) =>
    isActiveRoleCall(call)
  ).length;
  if (activeCount >= policy.maxConcurrentRoleCalls) {
    reasons.push(
      `Active role call count ${activeCount} reaches concurrency limit ${policy.maxConcurrentRoleCalls}.`
    );
  }
  const openTodos = (request.roleTodos ?? []).filter(
    (todo) =>
      todo.role === request.calleeRole.handle && !isTerminalRoleTodoStatus(todo.status)
  ).length;
  if (
    policy.maxTodosPerRole !== undefined &&
    openTodos >= policy.maxTodosPerRole
  ) {
    reasons.push(
      `Callee @${request.calleeRole.handle} has reached todo capacity ${policy.maxTodosPerRole}.`
    );
  }
  const taskText = roleIntentTaskText(request.intent);
  const duplicate = (request.existingRoleCalls ?? []).some(
    (call) =>
      !isTerminalRoleCallStatus(call.status) &&
      call.callerRole === request.callerRole.handle &&
      call.calleeRole === request.calleeRole.handle &&
      normalizeTask(call.task) === normalizeTask(taskText)
  );
  if (duplicate) {
    reasons.push("Duplicate active role call detected.");
  }
  const cycle = (request.existingRoleCalls ?? []).some(
    (call) =>
      !isTerminalRoleCallStatus(call.status) &&
      call.callerRole === request.calleeRole.handle &&
      call.calleeRole === request.callerRole.handle
  );
  if (cycle) {
    reasons.push(
      `Potential role-call cycle detected between @${request.callerRole.handle} and @${request.calleeRole.handle}.`
    );
  }
}

function validateExecutorCapability(
  calleeRole: RoleDefinition,
  warnings: string[],
  reasons: string[]
): void {
  if (calleeRole.executor.kind === "llm_api") {
    reasons.push(
      `Callee role @${calleeRole.handle} uses reserved llm_api executor ${calleeRole.executor.modelRef}.`
    );
  }
  if (calleeRole.executor.kind === "human") {
    warnings.push(
      `Callee role @${calleeRole.handle} uses a human executor and cannot run automatically.`
    );
  }
}

function validatePermissions(
  request: RoleCallPolicyRequest,
  policy: RoleExecutionPolicy,
  reasons: string[],
  approvalReasons: string[]
): void {
  const permissions = request.requestedPermissions;
  if (!permissions) {
    return;
  }
  for (const [key, label] of permissionChecks) {
    if (permissions[key] !== true) {
      continue;
    }
    if (request.callerRole.permissions[key] !== true) {
      reasons.push(`Caller role lacks ${label} permission.`);
    }
    if (request.calleeRole.permissions[key] !== true) {
      reasons.push(`Callee role lacks ${label} permission.`);
    }
  }
  if (
    permissions.canEditFiles &&
    (policy.requireApprovalForFileWrite ||
      roleRequiresApproval(request, "file_write"))
  ) {
    pushApprovalReason(approvalReasons, "file write permission");
  }
  if (
    permissions.canRunCommands &&
    (policy.requireApprovalForDangerousShell ||
      permissions.requiresApprovalForShell ||
      roleRequiresApproval(request, "shell"))
  ) {
    pushApprovalReason(approvalReasons, "shell command permission");
  }
  if (permissions.canUseNetwork && roleRequiresApproval(request, "network")) {
    pushApprovalReason(approvalReasons, "network permission");
  }
}

const permissionChecks: Array<[keyof PermissionSet, string]> = [
  ["canReadFiles", "read files"],
  ["canEditFiles", "edit files"],
  ["canRunCommands", "run commands"],
  ["canUseNetwork", "network"],
  ["canAskUser", "ask user"]
];

function roleRequiresApproval(
  request: RoleCallPolicyRequest,
  action: "file_write" | "shell" | "network"
): boolean {
  const requiredFor = [
    ...request.callerRole.approvalPolicy.requiredFor,
    ...request.calleeRole.approvalPolicy.requiredFor
  ].map(normalizeApprovalPolicyEntry);
  const aliases = approvalAliases[action];
  return requiredFor.some(
    (entry) =>
      entry === "*" ||
      entry === "external_side_effects" ||
      aliases.includes(entry)
  );
}

const approvalAliases: Record<"file_write" | "shell" | "network", string[]> = {
  file_write: ["file_write", "file_writes", "write_files"],
  shell: ["shell", "commands", "shell_command", "shell_commands", "run_commands"],
  network: ["network", "network_access", "external_network"]
};

function pushApprovalReason(reasons: string[], reason: string): void {
  if (!reasons.includes(reason)) {
    reasons.push(reason);
  }
}

function normalizeApprovalPolicyEntry(entry: string): string {
  return entry.trim().toLowerCase().replace(/[\s-]+/g, "_");
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

function roleIntentSearchText(intent: RoleIntent): string {
  return [
    roleIntentTaskText(intent),
    "reason" in intent ? intent.reason : undefined,
    "expectedOutput" in intent ? intent.expectedOutput?.description : undefined
  ]
    .filter((entry): entry is string => typeof entry === "string")
    .join("\n");
}

function isActiveRoleCall(call: RoleCall): boolean {
  return !isTerminalRoleCallStatus(call.status);
}

function isTerminalRoleCallStatus(status: RoleCall["status"]): boolean {
  return (
    status === "succeeded" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "rejected"
  );
}

function isTerminalRoleTodoStatus(status: RoleTodo["status"]): boolean {
  return status === "done" || status === "cancelled" || status === "rejected";
}

function normalizeTask(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}
