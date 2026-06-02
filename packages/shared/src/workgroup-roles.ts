import type { DelegationPolicy } from "./role-calls";

export const workgroupExecutorKinds = [
  "agent_adapter",
  "llm_api",
  "workflow",
  "human"
] as const;
export type WorkgroupExecutorKind = (typeof workgroupExecutorKinds)[number];
export type WorkgroupAgentAdapterKind = "fake" | "codex" | "claude-code";
export type WorkgroupSkillScope = "task" | "role" | "project" | "global";

export interface WorkgroupSkillReference {
  id: string;
  scope?: WorkgroupSkillScope;
}

export interface WorkgroupAgentAdapterExecutor {
  kind: "agent_adapter";
  adapterKind: WorkgroupAgentAdapterKind;
  configRef?: string;
}

export interface WorkgroupReservedExecutor {
  kind: "llm_api" | "workflow" | "human";
  configRef?: string;
  unavailableReason?: string;
}

export type WorkgroupExecutor =
  | WorkgroupAgentAdapterExecutor
  | WorkgroupReservedExecutor;

export interface WorkgroupContextPolicy {
  scope: string;
  includeApprovedMemory: boolean;
  includeThreadSummary: boolean;
  instructions: string[];
}

export interface WorkgroupApprovalPolicy {
  requiredFor: string[];
  summary: string;
}

export interface WorkgroupRole {
  id: string;
  handle: string;
  displayName: string;
  purpose: string;
  capabilitySummary: string;
  persona: string;
  defaultInstructions: string;
  permissions: string[];
  contextPolicy: WorkgroupContextPolicy;
  approvalPolicy: WorkgroupApprovalPolicy;
  delegationPolicy?: DelegationPolicy;
  executor: WorkgroupExecutor;
  enabled: boolean;
  defaultSkillReferences?: WorkgroupSkillReference[];
  defaultRoom?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface WorkgroupRoleRunMetadata {
  roleId: string;
  roleHandle: string;
  displayName: string;
  executorKind: WorkgroupExecutorKind;
  adapterKind?: WorkgroupAgentAdapterKind;
  persona: string;
  defaultInstructions: string;
  permissions: string[];
  defaultSkillReferences?: WorkgroupSkillReference[];
  contextPolicy: WorkgroupContextPolicy;
  approvalPolicy: WorkgroupApprovalPolicy;
}

export type WorkgroupTaskAssignmentStatus =
  | "assigned"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped";

export interface WorkgroupTaskAssignmentMetadata {
  assignmentId: string;
  taskId: string;
  threadId: string;
  sourceMessageId: string;
  assignmentRole: "agent" | "role";
  agentId?: "fake" | "codex" | "claude";
  roleHandle?: string;
  displayName: string;
  executorKind: WorkgroupExecutorKind;
  adapterKind?: WorkgroupAgentAdapterKind;
  executable: boolean;
  runId?: string;
  status: WorkgroupTaskAssignmentStatus;
}

export const presetWorkgroupRoleHandles = [
  "researcher",
  "writer",
  "analyst",
  "operator",
  "reviewer",
  "engineer",
  "memory"
] as const;
export type PresetWorkgroupRoleHandle =
  (typeof presetWorkgroupRoleHandles)[number];

export const presetWorkgroupRoles: readonly WorkgroupRole[] = [
  presetRole({
    handle: "researcher",
    displayName: "Researcher",
    purpose: "Gather and synthesize source-backed project context.",
    capabilitySummary: "Research, source review, question framing.",
    persona: "Evidence-first researcher who separates facts from assumptions.",
    defaultInstructions:
      "Collect relevant context, cite source messages or files, and call out uncertainty.",
    permissions: ["read_project_context", "read_thread_context"],
    defaultRoom: "research",
    tags: ["research", "context"]
  }),
  presetRole({
    handle: "writer",
    displayName: "Writer",
    purpose: "Draft concise user-facing and project-facing text.",
    capabilitySummary: "Writing, summarization, documentation drafts.",
    persona: "Clear technical writer who keeps prose specific and reviewable.",
    defaultInstructions:
      "Draft bounded text, preserve technical claims, and avoid unsupported scope expansion.",
    permissions: ["read_project_context", "read_thread_context"],
    defaultRoom: "planning",
    tags: ["writing", "docs"]
  }),
  presetRole({
    handle: "analyst",
    displayName: "Analyst",
    purpose: "Compare options, identify tradeoffs, and summarize signals.",
    capabilitySummary: "Analysis, comparison, prioritization.",
    persona: "Structured analyst who makes tradeoffs explicit.",
    defaultInstructions:
      "Compare evidence, list risks and unknowns, and keep recommendations bounded.",
    permissions: ["read_project_context", "read_thread_context", "read_run_evidence"],
    defaultRoom: "planning",
    tags: ["analysis", "planning"]
  }),
  presetRole({
    handle: "operator",
    displayName: "Operator",
    purpose: "Coordinate local task execution and status reporting.",
    capabilitySummary: "Operational planning, run monitoring, follow-up tracking.",
    persona: "Pragmatic operator focused on local, auditable execution.",
    defaultInstructions:
      "Track run state, summarize next actions, and avoid unapproved side effects.",
    permissions: ["read_project_context", "read_thread_context", "read_run_evidence"],
    defaultRoom: "general",
    tags: ["operations", "status"]
  }),
  presetRole({
    handle: "reviewer",
    displayName: "Reviewer",
    purpose: "Review outputs, checks, risks, and acceptance readiness.",
    capabilitySummary: "Review, risk assessment, verification planning.",
    persona: "Strict reviewer who prioritizes evidence and missing tests.",
    defaultInstructions:
      "Inspect claims against evidence, identify risks, and do not apply changes.",
    permissions: ["read_project_context", "read_thread_context", "read_run_evidence"],
    defaultRoom: "review",
    tags: ["review", "risk"]
  }),
  presetRole({
    handle: "engineer",
    displayName: "Engineer",
    purpose: "Implement local code changes through the coding agent path.",
    capabilitySummary: "Implementation, tests, refactoring within task scope.",
    persona: "Careful engineer who keeps changes small, tested, and local-first.",
    defaultInstructions:
      "Implement only the requested slice, run focused checks, and preserve safety boundaries.",
    permissions: [
      "read_project_context",
      "read_thread_context",
      "read_run_evidence",
      "write_isolated_worktree"
    ],
    executor: { kind: "agent_adapter", adapterKind: "codex" },
    defaultRoom: "planning",
    tags: ["engineering", "implementation"]
  }),
  presetRole({
    handle: "memory",
    displayName: "Memory",
    purpose: "Propose conservative memory items and decision records.",
    capabilitySummary: "Memory proposal review, decision extraction.",
    persona: "Conservative memory steward who never auto-approves memory.",
    defaultInstructions:
      "Suggest memory only when durable, source-backed, and useful for future runs.",
    permissions: ["read_thread_context", "read_run_evidence"],
    defaultRoom: "knowledge",
    tags: ["memory", "knowledge"]
  })
];

export function normalizeWorkgroupRoleHandle(value: string): string | undefined {
  const normalized = value.replace(/^@/, "").trim().toLowerCase();
  return /^[a-z][a-z0-9_-]{0,62}$/.test(normalized) ? normalized : undefined;
}

export function findWorkgroupRoleByHandle(
  roles: readonly WorkgroupRole[],
  handle: string
): WorkgroupRole | undefined {
  const normalized = normalizeWorkgroupRoleHandle(handle);
  if (!normalized) {
    return undefined;
  }
  return roles.find(
    (role) => normalizeWorkgroupRoleHandle(role.handle) === normalized
  );
}

export function toWorkgroupRoleRunMetadata(
  role: WorkgroupRole
): WorkgroupRoleRunMetadata {
  return {
    roleId: role.id,
    roleHandle: normalizeWorkgroupRoleHandle(role.handle) ?? role.handle,
    displayName: role.displayName,
    executorKind: role.executor.kind,
    adapterKind:
      role.executor.kind === "agent_adapter" ? role.executor.adapterKind : undefined,
    persona: role.persona,
    defaultInstructions: role.defaultInstructions,
    permissions: [...role.permissions],
    defaultSkillReferences: role.defaultSkillReferences?.map((reference) => ({
      ...reference
    })),
    contextPolicy: {
      ...role.contextPolicy,
      instructions: [...role.contextPolicy.instructions]
    },
    approvalPolicy: {
      ...role.approvalPolicy,
      requiredFor: [...role.approvalPolicy.requiredFor]
    }
  };
}

function presetRole(
  input: Omit<
    WorkgroupRole,
    "id" | "contextPolicy" | "approvalPolicy" | "enabled" | "executor"
  > & {
    executor?: WorkgroupExecutor;
  }
): WorkgroupRole {
  const handle = normalizeWorkgroupRoleHandle(input.handle) ?? input.handle;
  return {
    id: `preset:${handle}`,
    handle,
    displayName: input.displayName,
    purpose: input.purpose,
    capabilitySummary: input.capabilitySummary,
    persona: input.persona,
    defaultInstructions: input.defaultInstructions,
    permissions: input.permissions,
    contextPolicy: {
      scope: "current_thread_and_project_context",
      includeApprovedMemory: true,
      includeThreadSummary: true,
      instructions: [
        "Use Agent Hub runtime-injected context only.",
        "Do not read secrets or credential files."
      ]
    },
    approvalPolicy: {
      requiredFor: [
        "repository_writes_outside_worktree",
        "memory_approval",
        "external_side_effects"
      ],
      summary:
        "User approval is required for memory approval, external effects, and repository-side writes."
    },
    executor: input.executor ?? { kind: "agent_adapter", adapterKind: "fake" },
    enabled: true,
    defaultRoom: input.defaultRoom,
    tags: input.tags,
    metadata: input.metadata
  };
}
