import type {
  PresetWorkgroupRoleHandle,
  WorkgroupAgentAdapterKind,
  WorkgroupExecutorKind
} from "./workgroup-roles";

export type WorkgroupPackId =
  | "core-workgroup"
  | "engineering"
  | "research"
  | "writing"
  | "analysis"
  | "operations";

export type WorkgroupSurfaceTerm =
  | "brief"
  | "context"
  | "artifacts"
  | "checks"
  | "risks"
  | "memory";

export type EngineeringVocabularyTerm =
  | "diff"
  | "tests"
  | "worktree"
  | "pr"
  | "ci";

export type WorkgroupVocabularyTerm =
  | WorkgroupSurfaceTerm
  | EngineeringVocabularyTerm;

export interface WorkgroupPackArtifactType {
  id: string;
  label: string;
  description: string;
  statusValues: string[];
}

export interface WorkgroupPackCheckType {
  id: string;
  label: string;
  description: string;
}

export interface WorkgroupPackRiskCategory {
  id: string;
  label: string;
  description: string;
}

export interface WorkgroupPackExecutorCapability {
  executorKind: WorkgroupExecutorKind;
  adapterKind?: WorkgroupAgentAdapterKind;
  capability: string;
  sideEffectClass: "read_only" | "isolated_write" | "approval_required";
}

export interface WorkgroupPackContextSectionProvider {
  id: string;
  label: string;
  description: string;
}

export interface WorkgroupPackLabels {
  core: Record<WorkgroupSurfaceTerm, string>;
  engineeringTerms?: Record<EngineeringVocabularyTerm, string>;
}

export interface WorkgroupPack {
  id: WorkgroupPackId;
  displayName: string;
  description: string;
  artifactTypes: WorkgroupPackArtifactType[];
  checkTypes: WorkgroupPackCheckType[];
  riskCategories: WorkgroupPackRiskCategory[];
  defaultRoleTemplateHandles: PresetWorkgroupRoleHandle[];
  executorCapabilities: WorkgroupPackExecutorCapability[];
  contextSectionProviders: WorkgroupPackContextSectionProvider[];
  labels: WorkgroupPackLabels;
  allowsCustomRoles: true;
}

export const coreWorkgroupSurfaceLabels: Record<WorkgroupSurfaceTerm, string> = {
  brief: "Brief",
  context: "Context",
  artifacts: "Artifacts",
  checks: "Checks",
  risks: "Risks",
  memory: "Memory"
};

const engineeringVocabularyLabels: Record<EngineeringVocabularyTerm, string> = {
  diff: "Diff",
  tests: "Tests",
  worktree: "Worktree",
  pr: "PR",
  ci: "CI"
};

const engineeringTermsToCoreSurfaces: Record<
  EngineeringVocabularyTerm,
  WorkgroupSurfaceTerm
> = {
  diff: "artifacts",
  tests: "checks",
  worktree: "artifacts",
  pr: "artifacts",
  ci: "checks"
};

export const builtInWorkgroupPacks: readonly WorkgroupPack[] = [
  pack({
    id: "core-workgroup",
    displayName: "Core Workgroup",
    description: "General project coordination, memory, decisions, and review.",
    artifactTypes: [
      artifact("summary", "Summary", "Reusable summary or synthesis."),
      artifact("decision", "Decision", "Source-linked decision record."),
      artifact("note", "Note", "Reusable local note."),
      artifact("memory_proposal", "Memory Proposal", "Candidate governed memory item.")
    ],
    checkTypes: [
      check("source_review", "Source Review", "Confirm cited source evidence exists."),
      check("acceptance_review", "Acceptance Review", "Confirm the result matches the brief.")
    ],
    riskCategories: [
      risk("scope_risk", "Scope Risk", "The work may exceed the requested scope."),
      risk("evidence_gap", "Evidence Gap", "The conclusion lacks enough local evidence.")
    ],
    defaultRoleTemplateHandles: ["operator", "reviewer", "memory"],
    executorCapabilities: [
      capability("agent_adapter", "fake", "local dry-run response", "read_only"),
      capability("human", undefined, "manual review placeholder", "approval_required")
    ],
    contextSectionProviders: [
      contextProvider("project_context", "Project Context", "Agent Hub-owned project context."),
      contextProvider("approved_memory", "Approved Memory", "Governed memory only.")
    ]
  }),
  pack({
    id: "engineering",
    displayName: "Engineering",
    description: "Local code implementation, verification, review evidence, and handoff.",
    artifactTypes: [
      artifact("diff", "Diff", "Git diff or patch evidence."),
      artifact("worktree_snapshot", "Worktree Snapshot", "Retained isolated workspace state."),
      artifact("verification_output", "Verification Output", "Command output from local checks."),
      artifact("pull_request_note", "PR Note", "Draft or review note for explicit publishing.")
    ],
    checkTypes: [
      check("tests", "Tests", "Local test command result."),
      check("typecheck", "Typecheck", "TypeScript or static type command result."),
      check("lint", "Lint", "Local lint command result."),
      check("ci", "CI", "Externally reported CI evidence imported by the user.")
    ],
    riskCategories: [
      risk("sensitive_path", "Sensitive Path", "A protected or credential-like path changed."),
      risk("dangerous_command", "Dangerous Command", "A risky shell or git command was observed."),
      risk("large_deletion", "Large Deletion", "The diff removes an unusually large amount."),
      risk("binary_change", "Binary Change", "A binary file changed and needs manual review.")
    ],
    defaultRoleTemplateHandles: ["engineer", "reviewer", "operator"],
    executorCapabilities: [
      capability("agent_adapter", "codex", "local code implementation", "isolated_write"),
      capability("agent_adapter", "claude-code", "local code implementation", "isolated_write"),
      capability("agent_adapter", "fake", "local dry-run implementation", "read_only")
    ],
    contextSectionProviders: [
      contextProvider("repository_context", "Repository Context", "Runtime-injected repository summary."),
      contextProvider("verification_policy", "Verification Policy", "Configured local verification commands.")
    ],
    labels: {
      core: coreWorkgroupSurfaceLabels,
      engineeringTerms: engineeringVocabularyLabels
    }
  }),
  pack({
    id: "research",
    displayName: "Research",
    description: "Question framing, source collection, evidence summaries, and uncertainty.",
    artifactTypes: [
      artifact("source_note", "Source Note", "Local source finding or citation note."),
      artifact("research_summary", "Research Summary", "Synthesized research output.")
    ],
    checkTypes: [
      check("source_coverage", "Source Coverage", "Confirm relevant source messages or files were reviewed."),
      check("uncertainty_review", "Uncertainty Review", "Call out assumptions and missing evidence.")
    ],
    riskCategories: [
      risk("stale_source", "Stale Source", "The source may be outdated."),
      risk("unsupported_claim", "Unsupported Claim", "A claim lacks source evidence.")
    ],
    defaultRoleTemplateHandles: ["researcher", "analyst", "reviewer"],
    executorCapabilities: [
      capability("agent_adapter", "fake", "local research simulation", "read_only"),
      capability("llm_api", undefined, "future direct model research", "approval_required")
    ],
    contextSectionProviders: [
      contextProvider("source_messages", "Source Messages", "Relevant room messages."),
      contextProvider("approved_memory", "Approved Memory", "Governed memory only.")
    ]
  }),
  pack({
    id: "writing",
    displayName: "Writing",
    description: "Drafting, editing, summaries, and audience-specific text.",
    artifactTypes: [
      artifact("draft", "Draft", "Proposed written content."),
      artifact("summary", "Summary", "Concise reusable summary.")
    ],
    checkTypes: [
      check("claim_review", "Claim Review", "Confirm technical claims are supported."),
      check("audience_review", "Audience Review", "Confirm the tone matches the audience.")
    ],
    riskCategories: [
      risk("overclaim", "Overclaim", "The draft overstates evidence or scope."),
      risk("ambiguous_language", "Ambiguous Language", "The draft may be unclear.")
    ],
    defaultRoleTemplateHandles: ["writer", "reviewer", "memory"],
    executorCapabilities: [
      capability("agent_adapter", "fake", "local writing simulation", "read_only"),
      capability("llm_api", undefined, "future direct model drafting", "approval_required")
    ],
    contextSectionProviders: [
      contextProvider("thread_summary", "Thread Summary", "Room-local summary context."),
      contextProvider("approved_memory", "Approved Memory", "Governed memory only.")
    ]
  }),
  pack({
    id: "analysis",
    displayName: "Analysis",
    description: "Tradeoffs, comparisons, scoring, prioritization, and recommendations.",
    artifactTypes: [
      artifact("comparison", "Comparison", "Structured option comparison."),
      artifact("priority_matrix", "Priority Matrix", "Prioritized work or decision matrix.")
    ],
    checkTypes: [
      check("criteria_review", "Criteria Review", "Confirm evaluation criteria are explicit."),
      check("tradeoff_review", "Tradeoff Review", "Confirm tradeoffs are named.")
    ],
    riskCategories: [
      risk("criteria_gap", "Criteria Gap", "The analysis lacks decision criteria."),
      risk("hidden_assumption", "Hidden Assumption", "The recommendation depends on unstated assumptions.")
    ],
    defaultRoleTemplateHandles: ["analyst", "reviewer", "operator"],
    executorCapabilities: [
      capability("agent_adapter", "fake", "local analysis simulation", "read_only"),
      capability("workflow", undefined, "future deterministic scoring workflow", "approval_required")
    ],
    contextSectionProviders: [
      contextProvider("comparison_inputs", "Comparison Inputs", "Source artifacts and prior decisions."),
      contextProvider("thread_summary", "Thread Summary", "Room-local summary context.")
    ]
  }),
  pack({
    id: "operations",
    displayName: "Operations",
    description: "Local execution status, handoffs, checklists, and follow-up tracking.",
    artifactTypes: [
      artifact("handoff", "Handoff", "Bounded task or review handoff."),
      artifact("checklist", "Checklist", "Operational checklist or follow-up list.")
    ],
    checkTypes: [
      check("handoff_review", "Handoff Review", "Confirm owner, scope, and next action are clear."),
      check("status_review", "Status Review", "Confirm local status is current.")
    ],
    riskCategories: [
      risk("owner_gap", "Owner Gap", "The work has no clear owner."),
      risk("stale_status", "Stale Status", "The current status may be outdated.")
    ],
    defaultRoleTemplateHandles: ["operator", "reviewer", "memory"],
    executorCapabilities: [
      capability("agent_adapter", "fake", "local operations simulation", "read_only"),
      capability("human", undefined, "future manual owner assignment", "approval_required")
    ],
    contextSectionProviders: [
      contextProvider("task_status", "Task Status", "Local task and run status."),
      contextProvider("review_evidence", "Review Evidence", "Local review evidence.")
    ]
  })
];

export function listBuiltInWorkgroupPacks(): readonly WorkgroupPack[] {
  return builtInWorkgroupPacks;
}

export function getBuiltInWorkgroupPack(
  packId: string
): WorkgroupPack | undefined {
  return builtInWorkgroupPacks.find((packDefinition) => packDefinition.id === packId);
}

export function requireBuiltInWorkgroupPack(packId: string): WorkgroupPack {
  const packDefinition = getBuiltInWorkgroupPack(packId);
  if (!packDefinition) {
    throw new Error(`workgroup pack ${packId} not found`);
  }
  return packDefinition;
}

export function labelWorkgroupVocabulary(
  term: WorkgroupVocabularyTerm,
  packId: WorkgroupPackId = "core-workgroup"
): string {
  const packDefinition = requireBuiltInWorkgroupPack(packId);
  if (isEngineeringVocabularyTerm(term)) {
    return (
      packDefinition.labels.engineeringTerms?.[term] ??
      coreWorkgroupSurfaceLabels[engineeringTermsToCoreSurfaces[term]]
    );
  }
  return packDefinition.labels.core[term];
}

export function engineeringTermSurface(
  term: EngineeringVocabularyTerm
): WorkgroupSurfaceTerm {
  return engineeringTermsToCoreSurfaces[term];
}

export function validateWorkgroupPackDefinition(packDefinition: WorkgroupPack): WorkgroupPack {
  const ids = new Set<string>();
  const collectId = (id: string, label: string): void => {
    if (!/^[a-z][a-z0-9_-]{0,80}$/.test(id)) {
      throw new Error(`${label} id ${id} is invalid`);
    }
    if (ids.has(id)) {
      throw new Error(`${label} id ${id} is duplicated in ${packDefinition.id}`);
    }
    ids.add(id);
  };

  collectId(packDefinition.id, "pack");
  for (const artifactType of packDefinition.artifactTypes) {
    collectId(artifactType.id, "artifact type");
  }
  for (const checkType of packDefinition.checkTypes) {
    collectId(checkType.id, "check type");
  }
  for (const riskCategory of packDefinition.riskCategories) {
    collectId(riskCategory.id, "risk category");
  }
  for (const provider of packDefinition.contextSectionProviders) {
    collectId(provider.id, "context section provider");
  }
  if (packDefinition.allowsCustomRoles !== true) {
    throw new Error(`${packDefinition.id} must allow custom roles`);
  }
  return packDefinition;
}

function pack(
  input: Omit<WorkgroupPack, "labels" | "allowsCustomRoles"> & {
    labels?: WorkgroupPackLabels;
  }
): WorkgroupPack {
  return validateWorkgroupPackDefinition({
    ...input,
    labels: input.labels ?? { core: coreWorkgroupSurfaceLabels },
    allowsCustomRoles: true
  });
}

function artifact(
  id: string,
  label: string,
  description: string,
  statusValues = ["draft", "reviewed", "accepted"]
): WorkgroupPackArtifactType {
  return { id, label, description, statusValues };
}

function check(
  id: string,
  label: string,
  description: string
): WorkgroupPackCheckType {
  return { id, label, description };
}

function risk(
  id: string,
  label: string,
  description: string
): WorkgroupPackRiskCategory {
  return { id, label, description };
}

function capability(
  executorKind: WorkgroupExecutorKind,
  adapterKind: WorkgroupAgentAdapterKind | undefined,
  capabilityText: string,
  sideEffectClass: WorkgroupPackExecutorCapability["sideEffectClass"]
): WorkgroupPackExecutorCapability {
  return {
    executorKind,
    adapterKind,
    capability: capabilityText,
    sideEffectClass
  };
}

function contextProvider(
  id: string,
  label: string,
  description: string
): WorkgroupPackContextSectionProvider {
  return { id, label, description };
}

function isEngineeringVocabularyTerm(
  term: WorkgroupVocabularyTerm
): term is EngineeringVocabularyTerm {
  return (
    term === "diff" ||
    term === "tests" ||
    term === "worktree" ||
    term === "pr" ||
    term === "ci"
  );
}
