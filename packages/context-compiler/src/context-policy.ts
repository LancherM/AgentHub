import type {
  ContextLayer,
  ContextOmission,
  MemoryContextItem,
  SkillContextItem
} from "@agent-hub/shared";

type ContextPolicyFilterDecision = {
  omission: ContextOmission;
  warning: string;
};

export function policyDecisionForMemory(
  memory: MemoryContextItem
): ContextPolicyFilterDecision | undefined {
  const itemId = `memory:${memory.id}`;
  if (memory.status !== undefined && memory.status !== "approved") {
    return filteredContextItem({
      itemId,
      layer: "approved_memory",
      reason: `memory status ${memory.status} is not approved`
    });
  }
  return policyDecisionForSourcePath({
    itemId,
    layer: "approved_memory",
    sourcePath: memory.sourcePath,
    sourceKind: "memory"
  });
}

export function policyDecisionForSkill(
  skill: SkillContextItem
): ContextPolicyFilterDecision | undefined {
  const itemId = `skill:${skillContextReferenceId(skill)}`;
  if (skill.scope === "task" || skill.scope === "role") {
    return filteredContextItem({
      itemId,
      layer: "skill",
      reason: `skill scope ${skill.scope} is not supported for runtime context`
    });
  }
  return policyDecisionForSourcePath({
    itemId,
    layer: "skill",
    sourcePath: skill.sourcePath,
    sourceKind: "skill"
  });
}

function policyDecisionForSourcePath(input: {
  itemId: string;
  layer: ContextLayer;
  sourcePath?: string;
  sourceKind: string;
}): ContextPolicyFilterDecision | undefined {
  if (!input.sourcePath) {
    return undefined;
  }
  if (isSecretLikePath(input.sourcePath)) {
    return filteredContextItem({
      itemId: input.itemId,
      layer: input.layer,
      reason: `${input.sourceKind} source path is secret-like`
    });
  }
  if (isRepoAgentInstructionPath(input.sourcePath)) {
    return filteredContextItem({
      itemId: input.itemId,
      layer: input.layer,
      reason: `${input.sourceKind} source path is a repository agent instruction export target`
    });
  }
  return undefined;
}

function filteredContextItem(input: {
  itemId: string;
  layer: ContextLayer;
  reason: string;
}): ContextPolicyFilterDecision {
  return {
    omission: {
      itemId: input.itemId,
      layer: input.layer,
      reason: input.reason
    },
    warning: `context policy filtered ${input.itemId}: ${input.reason}`
  };
}

function isSecretLikePath(value: string): boolean {
  const normalized = normalizePolicyPath(value);
  return secretPathPatterns.some((pattern) => pattern.test(normalized));
}

function isRepoAgentInstructionPath(value: string): boolean {
  const normalized = normalizePolicyPath(value);
  return (
    normalized === "agents.md" ||
    normalized === "claude.md" ||
    normalized.endsWith("/agents.md") ||
    normalized.endsWith("/claude.md") ||
    normalized.includes("/.claude/skills/") ||
    normalized.includes("/.agents/skills/")
  );
}

function normalizePolicyPath(value: string): string {
  return value.trim().replace(/\\/g, "/").toLowerCase();
}

const secretPathPatterns = [
  /(^|\/)\.env($|[./])/,
  /(^|\/)[^/]*\.pem$/,
  /(^|\/)[^/]*\.key$/,
  /(^|\/)id_rsa($|\/)/,
  /(^|\/)id_ed25519($|\/)/,
  /(^|\/)secrets?([._-]|$)/,
  /(^|\/)credentials?([._-]|$)/,
  /(^|\/)tokens?([._-]|$)/
] as const;

function skillContextReferenceId(skill: SkillContextItem): string {
  return skill.scope ? `${skill.scope}:${skill.id}` : skill.id;
}
