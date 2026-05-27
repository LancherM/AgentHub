import { describe, expect, it } from "vitest";
import {
  activeComposerTrigger,
  applyComposerSuggestion,
  buildComposerSuggestions,
  insertComposerTarget,
  removeComposerTarget,
  resolveComposerTargets
} from "../apps/desktop/src/lib/composer-controls";
import type { AgentId, TeamRoleSummary } from "../apps/desktop/src/lib/types";
import type { WorkgroupRole } from "@agent-hub/shared";

describe("desktop composer controls", () => {
  it("suggests agents and roles for active @ mentions", () => {
    const trigger = activeComposerTrigger("@eng", 4);
    const suggestions = buildComposerSuggestions({
      roles: [roleSummary("engineer", "Engineer", "codex")],
      trigger
    });

    expect(trigger).toMatchObject({
      kind: "mention",
      query: "eng"
    });
    expect(suggestions.map((suggestion) => suggestion.label)).toContain(
      "@engineer"
    );
  });

  it("applies selected mention suggestions at the active token", () => {
    const trigger = activeComposerTrigger("ask @eng to review", 8);
    if (!trigger) {
      throw new Error("expected trigger");
    }
    const [suggestion] = buildComposerSuggestions({
      roles: [roleSummary("engineer", "Engineer", "codex")],
      trigger
    });
    if (!suggestion) {
      throw new Error("expected suggestion");
    }

    expect(applyComposerSuggestion("ask @eng to review", trigger, suggestion))
      .toMatchObject({
        value: "ask @engineer to review",
        cursor: "ask @engineer ".length
      });
  });

  it("preserves prompt spacing outside the applied suggestion", () => {
    const input = "ask @co to edit:\n    const value  = 1;";
    const trigger = activeComposerTrigger(input, "ask @co".length);
    if (!trigger) {
      throw new Error("expected trigger");
    }
    const [suggestion] = buildComposerSuggestions({ roles: [], trigger });
    if (!suggestion) {
      throw new Error("expected suggestion");
    }

    expect(applyComposerSuggestion(input, trigger, suggestion)).toMatchObject({
      value: "ask @codex to edit:\n    const value  = 1;",
      cursor: "ask @codex ".length
    });
  });

  it("keeps unknown mentions as prompt text while resolving fallback agents", () => {
    const resolved = resolveComposerTargets({
      value: "@unknown inspect logs",
      roles: [],
      fallbackAgents: ["codex"]
    });

    expect(resolved.targets).toEqual([
      expect.objectContaining({
        kind: "agent",
        handle: "codex",
        source: "fallback",
        removable: false
      })
    ]);
    expect(resolved.runCount).toBe(1);
  });

  it("resolves explicit agent and role targets into expected run fan-out", () => {
    const resolved = resolveComposerTargets({
      value: "@engineer @fake compare",
      roles: [roleSummary("engineer", "Engineer", "codex")],
      availableAgents: ["fake", "codex", "claude"],
      fallbackAgents: ["codex"]
    });

    expect(resolved.targets.map((target) => target.label)).toEqual([
      "@engineer",
      "@fake"
    ]);
    expect(resolved.explicitTargetCount).toBe(2);
    expect(resolved.runCount).toBe(2);
  });

  it("filters disabled agents from suggestions and fallback targets", () => {
    const trigger = activeComposerTrigger("@fa", 3);
    const suggestions = buildComposerSuggestions({
      roles: [],
      availableAgents: ["codex", "claude"],
      trigger
    });
    const resolved = resolveComposerTargets({
      value: "@fake compare",
      roles: [],
      availableAgents: ["codex", "claude"],
      defaultAgent: "codex",
      fallbackAgents: ["fake", "codex"]
    });

    expect(suggestions.map((suggestion) => suggestion.label)).not.toContain("@fake");
    expect(resolved.targets.map((target) => target.label)).toEqual(["@codex"]);
  });

  it("supports slash command suggestions without changing command execution", () => {
    const trigger = activeComposerTrigger("/rev", 4);
    const suggestions = buildComposerSuggestions({ roles: [], trigger });

    expect(suggestions.map((suggestion) => suggestion.label)).toContain("/review");
    expect(suggestions.every((suggestion) => suggestion.kind === "command")).toBe(
      true
    );
  });

  it("pins fallback targets and removes explicit mention targets", () => {
    const [target] = resolveComposerTargets({
      value: "summarize",
      roles: [],
      fallbackAgents: ["claude"]
    }).targets;
    if (!target) {
      throw new Error("expected target");
    }

    const pinned = insertComposerTarget("summarize", target);
    expect(pinned).toBe("@claude summarize");
    expect(removeComposerTarget(pinned, target)).toBe("summarize");
  });

  it("removes every matching explicit mention without rewriting prompt formatting", () => {
    const target = {
      id: "agent:fake",
      kind: "agent" as const,
      handle: "fake",
      label: "@fake",
      detail: "Use fake",
      runCount: 1,
      removable: true,
      source: "explicit" as const
    };

    expect(
      removeComposerTarget(
        "@fake compare @fake output\n    keep  aligned",
        target
      )
    ).toBe("compare output\n    keep  aligned");
  });
});

function roleSummary(
  handle: string,
  displayName: string,
  adapter: AgentId
): TeamRoleSummary {
  const role: WorkgroupRole = {
    id: `role_${handle}`,
    handle,
    displayName,
    purpose: "Test role.",
    capabilitySummary: "Test role.",
    persona: "Test persona.",
    defaultInstructions: "Use local evidence.",
    permissions: ["read_run_evidence"],
    contextPolicy: {
      scope: "current_thread",
      includeApprovedMemory: true,
      includeThreadSummary: true,
      instructions: []
    },
    approvalPolicy: {
      requiredFor: ["side_effects"],
      summary: "Ask before side effects."
    },
    executor: {
      kind: "agent_adapter",
      adapterKind: adapter === "claude" ? "claude-code" : adapter
    },
    enabled: true
  };
  return {
    role,
    source: "preset",
    executorRunnable: true,
    executorLabel: adapter,
    permissionSummary: "read run evidence",
    contextPolicySummary: "current thread",
    approvalPolicySummary: "ask before side effects",
    status: "enabled",
    recentActivity: [],
    linkedMemory: []
  };
}
