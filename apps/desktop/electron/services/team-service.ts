import {
  validateWorkgroupRole,
  type MemoryItem,
  type ProjectRepository,
  type SettingsRepository,
  type Task,
  type TaskRepository
} from "@agent-hub/core";
import {
  isAgentKindEnabled,
  normalizeWorkgroupRoleHandle,
  presetWorkgroupRoles,
  roleIntentTypes,
  type AgentAvailabilityOptions,
  type RoleIntentType,
  type WorkgroupAgentAdapterKind,
  type WorkgroupExecutor,
  type WorkgroupExecutorKind,
  type WorkgroupRole,
  type WorkgroupTaskAssignmentMetadata
} from "@agent-hub/shared";
import type {
  SaveTeamRoleInput,
  TeamRoleActivity,
  TeamRoleLinkedMemory,
  TeamRoleSource,
  TeamRoleSummary,
  TeamWorkspace
} from "../../src/lib/types";
import type { DesktopServiceContext } from "./project-service";

const roleSettingsPrefix = "desktop.project.";
const roleSettingsSuffix = ".workgroupRoles";
const maxStoredRoles = 32;
const maxArrayEntries = 24;
const maxTextLength = 2_000;
const maxShortTextLength = 240;
const maxHandleLength = 63;
const reservedExecutorReason = "Reserved executor is not runnable in this phase.";

export interface TeamService {
  getWorkspace(projectId: string): Promise<TeamWorkspace>;
  saveRole(input: SaveTeamRoleInput): Promise<TeamRoleSummary>;
  rolesForProject(projectId?: string): Promise<readonly WorkgroupRole[]>;
}

export function createTeamService(
  context: DesktopServiceContext
): TeamService {
  return new RepositoryTeamService(
    context.repositories.projectRepository,
    context.repositories.taskRepository,
    context.repositories.memoryItemRepository,
    context.repositories.settingsRepository,
    context
  );
}

class RepositoryTeamService implements TeamService {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly tasks: TaskRepository,
    private readonly memories: {
      listByProjectId(projectId: string): Promise<MemoryItem[]>;
    },
    private readonly settings: SettingsRepository,
    private readonly context: DesktopServiceContext
  ) {}

  async getWorkspace(projectId: string): Promise<TeamWorkspace> {
    const parsedProjectId = parseNonEmptyString(projectId, "projectId", maxShortTextLength);
    await this.requireProject(parsedProjectId);
    const [roles, tasks, memoryItems] = await Promise.all([
      this.resolvedRoles(parsedProjectId),
      this.tasks.listByProjectId(parsedProjectId),
      this.memories.listByProjectId(parsedProjectId)
    ]);
    const summaries = roles.map((entry) =>
      toTeamRoleSummary(
        entry.role,
        entry.source,
        tasks,
        memoryItems,
        this.context.agentAvailability
      )
    );
    return {
      projectId: parsedProjectId,
      generatedAt: this.context.now(),
      metrics: {
        total: summaries.length,
        enabled: summaries.filter((summary) => summary.role.enabled).length,
        custom: summaries.filter((summary) => summary.source === "custom").length,
        presetOverrides: summaries.filter(
          (summary) => summary.source === "preset_override"
        ).length,
        reservedExecutors: summaries.filter(
          (summary) => !summary.executorRunnable
        ).length
      },
      roles: summaries
    };
  }

  async saveRole(input: SaveTeamRoleInput): Promise<TeamRoleSummary> {
    if (!input || typeof input !== "object") {
      throw new Error("team role input is required");
    }
    const projectId = parseNonEmptyString(
      input.projectId,
      "projectId",
      maxShortTextLength
    );
    await this.requireProject(projectId);
    const role = normalizeRoleInput(input.role);
    const existing = await this.storedRoles(projectId);
    const roleSource = sourceForRole(role);
    if (
      roleSource === "custom" &&
      presetWorkgroupRoles.some((preset) => preset.handle === role.handle)
    ) {
      throw new Error(`custom role handle @${role.handle} conflicts with a preset role`);
    }
    const nextStored = upsertRole(existing, role);
    await this.saveStoredRoles(projectId, nextStored);
    const workspace = await this.getWorkspace(projectId);
    const saved = workspace.roles.find((entry) => entry.role.id === role.id);
    if (!saved) {
      throw new Error(`role @${role.handle} was not saved`);
    }
    return saved;
  }

  async rolesForProject(projectId?: string): Promise<readonly WorkgroupRole[]> {
    if (!projectId) {
      return presetWorkgroupRoles;
    }
    try {
      return (await this.resolvedRoles(projectId)).map((entry) => entry.role);
    } catch {
      return presetWorkgroupRoles;
    }
  }

  private async resolvedRoles(
    projectId: string
  ): Promise<Array<{ role: WorkgroupRole; source: TeamRoleSource }>> {
    const stored = await this.storedRoles(projectId);
    const storedByHandle = new Map(stored.map((role) => [role.handle, role]));
    const presetHandles = new Set(presetWorkgroupRoles.map((role) => role.handle));
    const resolved: Array<{ role: WorkgroupRole; source: TeamRoleSource }> =
      presetWorkgroupRoles.map((preset) => {
        const override = storedByHandle.get(preset.handle);
        return override
          ? { role: override, source: "preset_override" }
          : { role: preset, source: "preset" };
      });
    for (const role of stored) {
      if (presetHandles.has(role.handle)) {
        continue;
      }
      resolved.push({ role, source: "custom" });
    }
    return resolved.sort((left, right) => {
      const leftPreset = presetHandles.has(left.role.handle) ? 0 : 1;
      const rightPreset = presetHandles.has(right.role.handle) ? 0 : 1;
      if (leftPreset !== rightPreset) {
        return leftPreset - rightPreset;
      }
      return left.role.handle.localeCompare(right.role.handle);
    });
  }

  private async storedRoles(projectId: string): Promise<WorkgroupRole[]> {
    const setting = await this.settings.get(roleSettingsKey(projectId));
    if (!setting) {
      return [];
    }
    const roles = settingValueRoles(setting.value);
    return roles.map((role) => normalizeRoleInput(role as WorkgroupRole));
  }

  private async saveStoredRoles(
    projectId: string,
    roles: WorkgroupRole[]
  ): Promise<void> {
    await this.settings.set({
      key: roleSettingsKey(projectId),
      value: { roles },
      updatedAt: this.context.now()
    });
  }

  private async requireProject(projectId: string): Promise<void> {
    const project = await this.projects.get(projectId);
    if (!project) {
      throw new Error(`project ${projectId} not found`);
    }
  }
}

function roleSettingsKey(projectId: string): string {
  return `${roleSettingsPrefix}${projectId}${roleSettingsSuffix}`;
}

function settingValueRoles(value: unknown): unknown[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("stored team roles must be an object");
  }
  const roles = (value as { roles?: unknown }).roles;
  if (!Array.isArray(roles)) {
    throw new Error("stored team roles must contain a roles array");
  }
  if (roles.length > maxStoredRoles) {
    throw new Error(`team roles must contain ${maxStoredRoles} or fewer entries`);
  }
  return roles;
}

function normalizeRoleInput(input: WorkgroupRole): WorkgroupRole {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("team role must be an object");
  }
  const value = input as Partial<WorkgroupRole>;
  const handle = normalizeWorkgroupRoleHandle(String(value.handle ?? ""));
  if (!handle) {
    throw new Error("role handle must start with a letter and contain only letters, numbers, underscores, or hyphens");
  }
  if (handle.length > maxHandleLength) {
    throw new Error(`role handle must be ${maxHandleLength} characters or fewer`);
  }
  const preset = presetWorkgroupRoles.find((role) => role.handle === handle);
  const id = preset
    ? `preset:${handle}`
    : parseRoleId(value.id, handle);
  const role: WorkgroupRole = {
    id,
    handle,
    displayName: parseNonEmptyString(
      value.displayName,
      "role displayName",
      maxShortTextLength
    ),
    purpose: parseNonEmptyString(value.purpose, "role purpose", maxTextLength),
    capabilitySummary: parseNonEmptyString(
      value.capabilitySummary,
      "role capabilitySummary",
      maxTextLength
    ),
    persona: parseNonEmptyString(value.persona, "role persona", maxTextLength),
    defaultInstructions: parseNonEmptyString(
      value.defaultInstructions,
      "role defaultInstructions",
      maxTextLength
    ),
    permissions: parseStringList(value.permissions, "role permissions"),
    contextPolicy: {
      scope: parseNonEmptyString(
        value.contextPolicy?.scope,
        "role contextPolicy.scope",
        maxShortTextLength
      ),
      includeApprovedMemory: parseBoolean(
        value.contextPolicy?.includeApprovedMemory,
        "role contextPolicy.includeApprovedMemory"
      ),
      includeThreadSummary: parseBoolean(
        value.contextPolicy?.includeThreadSummary,
        "role contextPolicy.includeThreadSummary"
      ),
      instructions: parseStringList(
        value.contextPolicy?.instructions,
        "role contextPolicy.instructions"
      )
    },
    approvalPolicy: {
      requiredFor: parseStringList(
        value.approvalPolicy?.requiredFor,
        "role approvalPolicy.requiredFor"
      ),
      summary: parseNonEmptyString(
        value.approvalPolicy?.summary,
        "role approvalPolicy.summary",
        maxTextLength
      )
    },
    delegationPolicy: normalizeDelegationPolicy(value.delegationPolicy),
    executor: normalizeExecutor(value.executor),
    enabled: parseBoolean(value.enabled, "role enabled"),
    defaultSkillReferences:
      value.defaultSkillReferences === undefined
        ? undefined
        : parseSkillReferenceList(
            value.defaultSkillReferences,
            "role defaultSkillReferences"
          ),
    defaultRoom:
      value.defaultRoom === undefined || value.defaultRoom === ""
        ? undefined
        : parseNonEmptyString(value.defaultRoom, "role defaultRoom", 80),
    tags:
      value.tags === undefined ? undefined : parseStringList(value.tags, "role tags"),
    metadata: metadataForRole(value.metadata, preset)
  };
  return validateWorkgroupRole(role);
}

function parseRoleId(value: unknown, handle: string): string {
  if (value === undefined || value === null || value === "") {
    return `custom:${handle}`;
  }
  const parsed = parseNonEmptyString(value, "role id", maxShortTextLength);
  if (parsed !== `custom:${handle}`) {
    throw new Error("custom role id must use custom:<handle>");
  }
  return parsed;
}

function sourceForRole(role: WorkgroupRole): TeamRoleSource {
  if (presetWorkgroupRoles.some((preset) => preset.handle === role.handle)) {
    return "preset_override";
  }
  return "custom";
}

function metadataForRole(
  value: WorkgroupRole["metadata"],
  preset: WorkgroupRole | undefined
): WorkgroupRole["metadata"] {
  const base =
    value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
  return {
    ...base,
    source: preset ? "preset_override" : "custom",
    persistedBy: "desktop_team_service"
  };
}

function normalizeExecutor(input: WorkgroupRole["executor"] | undefined): WorkgroupExecutor {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("role executor must be an object");
  }
  const value = input as Partial<WorkgroupExecutor> & {
    kind?: WorkgroupExecutorKind;
    adapterKind?: WorkgroupAgentAdapterKind;
    configRef?: unknown;
    unavailableReason?: unknown;
  };
  if (value.kind === "agent_adapter") {
    const adapterKind = value.adapterKind;
    if (
      adapterKind !== "fake" &&
      adapterKind !== "codex" &&
      adapterKind !== "claude-code"
    ) {
      throw new Error("role executor adapterKind must be fake, codex, or claude-code");
    }
    return {
      kind: "agent_adapter",
      adapterKind,
      configRef:
        value.configRef === undefined || value.configRef === ""
          ? undefined
          : parseNonEmptyString(value.configRef, "role executor configRef", 160)
    };
  }
  if (
    value.kind === "llm_api" ||
    value.kind === "workflow" ||
    value.kind === "human"
  ) {
    return {
      kind: value.kind,
      configRef:
        value.configRef === undefined || value.configRef === ""
          ? undefined
          : parseNonEmptyString(value.configRef, "role executor configRef", 160),
      unavailableReason:
        value.unavailableReason === undefined || value.unavailableReason === ""
          ? reservedExecutorReason
          : parseNonEmptyString(
              value.unavailableReason,
              "role executor unavailableReason",
              maxShortTextLength
            )
    };
  }
  throw new Error("role executor kind must be agent_adapter, llm_api, workflow, or human");
}

function normalizeDelegationPolicy(
  input: WorkgroupRole["delegationPolicy"] | undefined
): WorkgroupRole["delegationPolicy"] {
  if (input === undefined) {
    return undefined;
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("role delegationPolicy must be an object");
  }
  const value = input as Partial<NonNullable<WorkgroupRole["delegationPolicy"]>>;
  const allowedIntentTypes = parseRoleIntentList(
    value.allowedIntentTypes,
    "role delegationPolicy.allowedIntentTypes"
  );
  const allowedTargetRoles = optionalStringList(
    value.allowedTargetRoles,
    "role delegationPolicy.allowedTargetRoles"
  );
  const allowedTargetCapabilities = optionalStringList(
    value.allowedTargetCapabilities,
    "role delegationPolicy.allowedTargetCapabilities"
  );
  const requiresApprovalForTargets = optionalStringList(
    value.requiresApprovalForTargets,
    "role delegationPolicy.requiresApprovalForTargets"
  );
  if (
    value.canInitiateRoleCalls === true &&
    (allowedTargetRoles?.length ?? 0) === 0 &&
    (allowedTargetCapabilities?.length ?? 0) === 0 &&
    (requiresApprovalForTargets?.length ?? 0) === 0
  ) {
    throw new Error(
      "role delegationPolicy must name targets when role calls are enabled"
    );
  }
  return {
    canInitiateRoleCalls: parseBoolean(
      value.canInitiateRoleCalls,
      "role delegationPolicy.canInitiateRoleCalls"
    ),
    allowedIntentTypes,
    allowedTargetRoles,
    allowedTargetCapabilities,
    requiresApprovalForTargets
  };
}

function upsertRole(
  existing: WorkgroupRole[],
  role: WorkgroupRole
): WorkgroupRole[] {
  const roleHandles = new Set<string>();
  const next = existing.filter((entry) => entry.handle !== role.handle);
  next.push(role);
  if (next.length > maxStoredRoles) {
    throw new Error(`team roles must contain ${maxStoredRoles} or fewer entries`);
  }
  for (const entry of next) {
    if (roleHandles.has(entry.handle)) {
      throw new Error(`role handle @${entry.handle} must be unique`);
    }
    roleHandles.add(entry.handle);
  }
  return next.sort((left, right) => left.handle.localeCompare(right.handle));
}

function toTeamRoleSummary(
  role: WorkgroupRole,
  source: TeamRoleSource,
  tasks: Task[],
  memoryItems: MemoryItem[],
  availability: AgentAvailabilityOptions
): TeamRoleSummary {
  const recentActivity = recentRoleTasks(role.handle, tasks);
  const linkedMemory = linkedRoleMemory(role, memoryItems);
  return {
    role,
    source,
    executorRunnable: isRunnableExecutor(role.executor, availability),
    executorLabel: executorLabel(role.executor, availability),
    permissionSummary: compactList(role.permissions, "No permissions"),
    contextPolicySummary: contextPolicySummary(role),
    approvalPolicySummary: approvalPolicySummary(role),
    status: role.enabled ? "enabled" : "disabled",
    recentActivity,
    linkedMemory
  };
}

function recentRoleTasks(
  roleHandle: string,
  tasks: Task[]
): TeamRoleActivity[] {
  return tasks
    .flatMap((task) =>
      taskAssignments(task).flatMap((assignment) => {
        if (assignment.roleHandle !== roleHandle) {
          return [];
        }
        return [
          {
            taskId: task.id,
            title: task.title,
            status: assignment.status,
            runId: assignment.runId,
            updatedAt: task.updatedAt
          }
        ];
      })
    )
    .sort((left, right) =>
      right.updatedAt === left.updatedAt
        ? right.taskId.localeCompare(left.taskId)
        : right.updatedAt.localeCompare(left.updatedAt)
    )
    .slice(0, 5);
}

function linkedRoleMemory(
  role: WorkgroupRole,
  memoryItems: MemoryItem[]
): TeamRoleLinkedMemory[] {
  const searchTerms = [
    `@${role.handle}`,
    role.handle.toLowerCase(),
    role.displayName.toLowerCase()
  ];
  return memoryItems
    .filter((item) => {
      const content = item.content.toLowerCase();
      return searchTerms.some((term) => content.includes(term));
    })
    .sort((left, right) =>
      right.updatedAt === left.updatedAt
        ? right.id.localeCompare(left.id)
        : right.updatedAt.localeCompare(left.updatedAt)
    )
    .slice(0, 5)
    .map((item) => ({
      id: item.id,
      status: item.status,
      content: item.content,
      updatedAt: item.updatedAt
    }));
}

function taskAssignments(task: Task): WorkgroupTaskAssignmentMetadata[] {
  const value = task.metadata?.assignments;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is WorkgroupTaskAssignmentMetadata =>
      Boolean(entry) &&
      typeof entry === "object" &&
      typeof (entry as WorkgroupTaskAssignmentMetadata).assignmentId === "string" &&
      typeof (entry as WorkgroupTaskAssignmentMetadata).taskId === "string" &&
      typeof (entry as WorkgroupTaskAssignmentMetadata).roleHandle === "string"
  );
}

function executorLabel(
  executor: WorkgroupExecutor,
  availability: AgentAvailabilityOptions
): string {
  if (executor.kind === "agent_adapter") {
    if (!isAgentKindEnabled(executor.adapterKind, availability)) {
      return "agent_adapter disabled";
    }
    return `agent_adapter / ${executor.adapterKind}`;
  }
  return `${executor.kind} reserved`;
}

function isRunnableExecutor(
  executor: WorkgroupExecutor,
  availability: AgentAvailabilityOptions
): boolean {
  return (
    executor.kind === "agent_adapter" &&
    isAgentKindEnabled(executor.adapterKind, availability)
  );
}

function contextPolicySummary(role: WorkgroupRole): string {
  const parts = [role.contextPolicy.scope];
  if (role.contextPolicy.includeApprovedMemory) {
    parts.push("approved memory");
  }
  if (role.contextPolicy.includeThreadSummary) {
    parts.push("thread summary");
  }
  return compactList(parts, "No context policy");
}

function approvalPolicySummary(role: WorkgroupRole): string {
  return role.approvalPolicy.summary || compactList(
    role.approvalPolicy.requiredFor,
    "No approval policy"
  );
}

function compactList(values: readonly string[], fallback: string): string {
  const filtered = values.map((value) => value.trim()).filter(Boolean);
  if (filtered.length === 0) {
    return fallback;
  }
  if (filtered.length <= 3) {
    return filtered.join(", ");
  }
  return `${filtered.slice(0, 3).join(", ")} +${filtered.length - 3}`;
}

function parseStringList(input: unknown, label: string): string[] {
  if (!Array.isArray(input)) {
    throw new Error(`${label} must be an array`);
  }
  if (input.length > maxArrayEntries) {
    throw new Error(`${label} must contain ${maxArrayEntries} or fewer entries`);
  }
  return input.map((entry, index) =>
    parseNonEmptyString(entry, `${label} ${index + 1}`, maxShortTextLength)
  );
}

function optionalStringList(input: unknown, label: string): string[] | undefined {
  if (input === undefined) {
    return undefined;
  }
  return parseStringList(input, label);
}

function parseRoleIntentList(input: unknown, label: string): RoleIntentType[] {
  return parseStringList(input, label).map((entry) => {
    if (!roleIntentTypes.includes(entry as RoleIntentType)) {
      throw new Error(`${label} must contain ${roleIntentTypes.join(", ")}`);
    }
    return entry as RoleIntentType;
  });
}

function parseSkillReferenceList(
  input: unknown,
  label: string
): Array<{ id: string; scope?: "task" | "role" | "project" | "global" }> {
  if (!Array.isArray(input)) {
    throw new Error(`${label} must be an array`);
  }
  if (input.length > maxArrayEntries) {
    throw new Error(`${label} must contain ${maxArrayEntries} or fewer entries`);
  }
  return input.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${label} ${index + 1} must be an object`);
    }
    const value = entry as { id?: unknown; scope?: unknown };
    const id = parseNonEmptyString(value.id, `${label} ${index + 1} id`, 120);
    if (value.scope === undefined) {
      return { id };
    }
    if (
      value.scope !== "task" &&
      value.scope !== "role" &&
      value.scope !== "project" &&
      value.scope !== "global"
    ) {
      throw new Error(`${label} ${index + 1} scope must be task, role, project, or global`);
    }
    return { id, scope: value.scope };
  });
}

function parseBoolean(input: unknown, label: string): boolean {
  if (typeof input !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return input;
}

function parseNonEmptyString(
  input: unknown,
  label: string,
  maxLength: number
): string {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  const trimmed = input.trim();
  if (trimmed.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer`);
  }
  return trimmed;
}
