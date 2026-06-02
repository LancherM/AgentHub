import {
  presetWorkgroupRoles,
  roleIntentTypes,
  type RoleDefinition,
  type RoleIntentType,
  type WorkgroupRole
} from "@agent-hub/shared";
import { validateRoleDefinition } from "./domain";

export function roleDefinitionsForWorkgroupRoles(
  roles: readonly WorkgroupRole[]
): RoleDefinition[] {
  return roles
    .filter((role) => role.enabled)
    .map((role) =>
      validateRoleDefinition({
        id: role.id,
        handle: role.handle,
        displayName: role.displayName,
        purpose: role.purpose,
        defaultInstructions: role.defaultInstructions,
        capabilities: roleCapabilities(role),
        permissions: rolePermissions(role),
        contextPolicy: {
          scope: role.contextPolicy.scope,
          includeApprovedMemory: role.contextPolicy.includeApprovedMemory,
          includeThreadSummary: role.contextPolicy.includeThreadSummary,
          instructions: [...role.contextPolicy.instructions]
        },
        approvalPolicy: {
          requiredFor: [...role.approvalPolicy.requiredFor],
          summary: role.approvalPolicy.summary
        },
        delegationPolicy: roleDelegationPolicy(role),
        intakePolicy: roleIntakePolicy(role),
        executor: roleExecutor(role),
        trustLevel: presetWorkgroupRoles.some((preset) => preset.handle === role.handle)
          ? "preset"
          : "user_defined",
        enabled: role.enabled
      })
    );
}

export function roleCapabilities(role: WorkgroupRole): string[] {
  const explicit = String(role.metadata?.capabilities ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (explicit.length > 0) {
    return explicit;
  }
  const defaults: Record<string, string[]> = {
    analyst: ["analysis", "planning"],
    operator: ["operations", "local_execution"],
    pm: ["planning", "coordination", "delegation"],
    reviewer: ["review", "risk"],
    researcher: ["research", "context"],
    writer: ["writing", "documentation"],
    engineer: ["implementation", "local_execution"],
    memory: ["memory", "knowledge"]
  };
  return defaults[role.handle] ?? [role.handle];
}

export function rolePermissions(role: WorkgroupRole): RoleDefinition["permissions"] {
  const permissionSet = new Set(role.permissions);
  const canRunCommands =
    permissionSet.has("run_commands") ||
    permissionSet.has("local_execution") ||
    permissionSet.has("write_isolated_worktree");
  const canEditFiles =
    permissionSet.has("write_files") || permissionSet.has("write_isolated_worktree");
  return {
    canReadFiles:
      permissionSet.has("read_project_context") ||
      permissionSet.has("read_thread_context") ||
      permissionSet.has("read_run_evidence"),
    canEditFiles,
    canRunCommands,
    canUseNetwork: permissionSet.has("network"),
    canAskUser: permissionSet.has("ask_user"),
    requiresApprovalForShell: true,
    requiresApprovalForFileWrite: true
  };
}

export function roleDelegationPolicy(role: WorkgroupRole): RoleDefinition["delegationPolicy"] {
  const configuredPolicy = roleDelegationPolicyFromMetadata(role.metadata?.delegationPolicy);
  if (configuredPolicy) {
    return configuredPolicy;
  }
  if (role.handle === "analyst") {
    return {
      canInitiateRoleCalls: true,
      allowedIntentTypes: ["delegate", "request_analysis", "request_review", "request_evidence"],
      allowedTargetRoles: ["operator", "reviewer", "researcher", "writer", "engineer"]
    };
  }
  if (role.handle === "operator") {
    return {
      canInitiateRoleCalls: true,
      allowedIntentTypes: ["delegate", "request_review", "request_evidence"],
      allowedTargetRoles: ["reviewer", "researcher"],
      requiresApprovalForTargets: ["engineer"]
    };
  }
  if (role.handle === "engineer") {
    return {
      canInitiateRoleCalls: true,
      allowedIntentTypes: ["request_review", "request_evidence"],
      allowedTargetRoles: ["reviewer", "operator"]
    };
  }
  if (isCoordinatorRole(role)) {
    return {
      canInitiateRoleCalls: true,
      allowedIntentTypes: ["delegate", "request_analysis", "request_review", "request_evidence"],
      allowedTargetRoles: ["*"]
    };
  }
  return {
    canInitiateRoleCalls: false,
    allowedIntentTypes: [],
    allowedTargetRoles: [],
    allowedTargetCapabilities: [],
    requiresApprovalForTargets: ["operator", "engineer"]
  };
}

function roleDelegationPolicyFromMetadata(
  value: unknown
): RoleDefinition["delegationPolicy"] | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  return {
    canInitiateRoleCalls: value.canInitiateRoleCalls === true,
    allowedIntentTypes: parseRoleIntentTypes(value.allowedIntentTypes),
    allowedTargetRoles: parseStringArray(value.allowedTargetRoles),
    allowedTargetCapabilities: parseStringArray(value.allowedTargetCapabilities),
    requiresApprovalForTargets: parseStringArray(value.requiresApprovalForTargets)
  };
}

function isCoordinatorRole(role: WorkgroupRole): boolean {
  if (presetWorkgroupRoles.some((preset) => preset.handle === role.handle)) {
    return false;
  }
  const handle = normalizeRoleText(role.handle);
  if (
    [
      "pm",
      "project_manager",
      "project-manager",
      "manager",
      "coordinator",
      "lead"
    ].includes(handle)
  ) {
    return true;
  }
  const tags = role.tags?.map(normalizeRoleText) ?? [];
  if (
    tags.some((tag) =>
      [
        "pm",
        "project_manager",
        "project-management",
        "coordination",
        "coordinator",
        "lead"
      ].includes(tag)
    )
  ) {
    return true;
  }
  const text = [
    role.displayName,
    role.purpose,
    role.capabilitySummary,
    role.persona,
    role.defaultInstructions
  ]
    .map(normalizeRoleText)
    .join(" ");
  return [
    "project_manager",
    "coordinate",
    "coordination",
    "delegate",
    "delegation"
  ].some((marker) => text.includes(marker));
}

function parseRoleIntentTypes(value: unknown): RoleIntentType[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is RoleIntentType =>
    roleIntentTypes.includes(entry as RoleIntentType)
  );
}

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeRoleText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

export function roleDelegationPolicyAllowsTarget(
  policy: RoleDefinition["delegationPolicy"],
  target: WorkgroupRole
): boolean {
  if (!policy.canInitiateRoleCalls) {
    return false;
  }
  const allowedTargetRoles = policy.allowedTargetRoles ?? [];
  const allowedTargetCapabilities = policy.allowedTargetCapabilities ?? [];
  if (allowedTargetRoles.includes(target.handle) || allowedTargetRoles.includes("*")) {
    return true;
  }
  const targetCapabilities = roleCapabilities(target);
  if (
    targetCapabilities.some((capability) =>
      allowedTargetCapabilities.includes(capability)
    )
  ) {
    return true;
  }
  return allowedTargetRoles.length === 0 && allowedTargetCapabilities.length === 0;
}

export function roleIntakePolicy(role: WorkgroupRole): RoleDefinition["intakePolicy"] {
  const acceptedIntentTypes: RoleDefinition["intakePolicy"]["acceptedIntentTypes"] =
    role.handle === "reviewer"
      ? ["delegate", "request_review"]
      : role.handle === "operator"
        ? ["delegate", "request_evidence"]
        : role.handle === "analyst"
          ? ["delegate", "request_analysis", "request_review"]
          : ["delegate", "request_analysis", "request_review", "request_evidence"];
  return {
    acceptsRoleCalls: true,
    acceptedIntentTypes,
    canReject: true,
    canDefer: true
  };
}

export function roleExecutor(role: WorkgroupRole): RoleDefinition["executor"] {
  if (role.executor.kind === "agent_adapter") {
    return {
      kind: "agent_adapter",
      adapter: role.executor.adapterKind
    };
  }
  if (role.executor.kind === "workflow") {
    return {
      kind: "local_workflow",
      workflowId: role.executor.configRef ?? role.handle
    };
  }
  if (role.executor.kind === "llm_api") {
    return {
      kind: "llm_api",
      modelRef: role.executor.configRef ?? role.handle
    };
  }
  return {
    kind: "human",
    configRef: role.executor.configRef,
    unavailableReason: role.executor.unavailableReason
  };
}
