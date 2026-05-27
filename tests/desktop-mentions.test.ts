import { describe, expect, it } from "vitest";
import {
  parseAgentMentions,
  resolveMentionedAgents
} from "../apps/desktop/src/lib/mentions";
import { parseWorkgroupMentions } from "../apps/desktop/electron/services/workgroup-mentions";
import type { WorkgroupRole } from "@agent-hub/shared";

describe("desktop mention parsing", () => {
  it("extracts a leading agent mention and strips it from the task", () => {
    expect(parseAgentMentions("@fake implement desktop streaming")).toEqual({
      agents: ["fake"],
      cleanedPrompt: "implement desktop streaming"
    });
  });

  it("extracts multiple ordered agent mentions from the prompt body", () => {
    expect(
      parseAgentMentions("@fake compare with @codex and @claude-code")
    ).toEqual({
      agents: ["fake", "codex", "claude"],
      cleanedPrompt: "compare with and"
    });
  });

  it("deduplicates repeated mentions", () => {
    expect(parseAgentMentions("@codex @codex @claude plan")).toEqual({
      agents: ["codex", "claude"],
      cleanedPrompt: "plan"
    });
  });

  it("preserves unknown mentions in the cleaned prompt", () => {
    expect(parseAgentMentions("@reviewer ask @fake to check")).toEqual({
      agents: ["fake"],
      cleanedPrompt: "@reviewer ask to check"
    });
  });

  it("falls back to the last used agent set when no mention is present", () => {
    expect(resolveMentionedAgents("summarize the run", ["codex"])).toEqual({
      agents: ["codex"],
      cleanedPrompt: "summarize the run"
    });
  });

  it("resolves preset role mentions separately from adapter mentions", () => {
    const parsed = parseWorkgroupMentions(
      "@researcher ask @engineer to check with @fake"
    );

    expect(parsed.cleanedPrompt).toBe("ask to check with");
    expect(parsed.agentMentions).toEqual(["fake"]);
    expect(parsed.roleMentions.map((role) => role.roleHandle)).toEqual([
      "researcher",
      "engineer"
    ]);
    expect(parsed.participants.map((participant) => participant.agentId)).toEqual([
      "fake",
      "codex",
      "fake"
    ]);
  });

  it("rejects unavailable adapter mentions when requested by desktop services", () => {
    expect(() =>
      parseWorkgroupMentions("@fake inspect", undefined, {
        availableAgents: ["codex", "claude"],
        rejectUnavailableAgents: true
      })
    ).toThrow("fake agent is disabled");
  });

  it("deduplicates role handles and supports user-defined role contracts", () => {
    const customRoles: WorkgroupRole[] = [
      {
        id: "role_custom_qa",
        handle: "qa",
        displayName: "QA",
        purpose: "Review local checks.",
        capabilitySummary: "Verification and regression analysis.",
        persona: "Skeptical reviewer.",
        defaultInstructions: "Check evidence and report gaps.",
        permissions: ["read_run_evidence"],
        contextPolicy: {
          scope: "current_thread",
          includeApprovedMemory: false,
          includeThreadSummary: true,
          instructions: ["Stay inside thread context."]
        },
        approvalPolicy: {
          requiredFor: ["side_effects"],
          summary: "Ask before side effects."
        },
        executor: { kind: "agent_adapter", adapterKind: "fake" },
        enabled: true
      }
    ];

    const parsed = parseWorkgroupMentions("@qa @qa review @legal", customRoles);

    expect(parsed.cleanedPrompt).toBe("review @legal");
    expect(parsed.roleMentions).toHaveLength(1);
    expect(parsed.roleMentions[0]).toMatchObject({
      roleId: "role_custom_qa",
      roleHandle: "qa",
      executorKind: "agent_adapter",
      adapterKind: "fake"
    });
    expect(parsed.participants).toHaveLength(1);
  });

  it("records non-executable role mentions without creating run participants", () => {
    const humanRoles: WorkgroupRole[] = [
      {
        id: "role_custom_qa",
        handle: "qa",
        displayName: "QA",
        purpose: "Review acceptance evidence.",
        capabilitySummary: "Human verification.",
        persona: "Careful human reviewer.",
        defaultInstructions: "Review the grouped task output.",
        permissions: ["read_run_evidence"],
        contextPolicy: {
          scope: "current_thread",
          includeApprovedMemory: false,
          includeThreadSummary: true,
          instructions: ["Stay inside thread context."]
        },
        approvalPolicy: {
          requiredFor: ["acceptance"],
          summary: "Human approval required."
        },
        executor: { kind: "human", unavailableReason: "Human runtime is reserved." },
        enabled: true
      }
    ];

    const parsed = parseWorkgroupMentions("@qa review release evidence", humanRoles);

    expect(parsed.cleanedPrompt).toBe("review release evidence");
    expect(parsed.roleMentions).toEqual([
      expect.objectContaining({
        roleHandle: "qa",
        executorKind: "human",
        adapterKind: undefined
      })
    ]);
    expect(parsed.participants).toHaveLength(0);
  });
});
