import { describe, expect, it } from "vitest";
import {
  createContextPlan,
  selectRuntimeContextCandidates
} from "@agent-hub/task-runner";
import {
  validateContextCandidate,
  validateContextRetrievalResult,
  validateRuntimeContextPack,
  type ContextCandidate,
  type ContextLayer,
  type TrustLevel
} from "@agent-hub/core";

const createdAt = "2026-01-01T00:00:00.000Z";

describe("runtime context retrieval selection", () => {
  it("selects policy-allowed candidates and preserves pinned runtime/task sections", () => {
    const plan = createContextPlan({
      id: "context_plan_selection",
      taskPrompt: "Fix parser bug in src/parser.ts",
      createdAt
    });
    const basePack = validateRuntimeContextPack({
      id: "runtime_pack_selection",
      planId: plan.id,
      taskId: "task_selection",
      runId: "run_selection",
      sections: [
        section("runtime_policy:agent_hub", "runtime_policy", "system", "Runtime Policy"),
        section("task:task", "task", "system", "Current Task")
      ],
      omitted: [],
      diagnostics: [],
      createdAt
    });
    const retrievalResult = validateContextRetrievalResult({
      id: "context_retrieval_selection",
      planId: plan.id,
      taskId: "task_selection",
      runId: "run_selection",
      candidates: [
        candidate({
          id: "context_index:project",
          layer: "project",
          trustLevel: "high",
          sourceKind: "project_context",
          sourceId: "context/project.md",
          content: "Parser behavior is documented here.",
          sourcePath: "/tmp/context/project.md"
        }),
        candidate({
          id: "context_index:secret",
          layer: "code",
          trustLevel: "high",
          sourceKind: "selected_file",
          sourceId: ".env",
          content: "SECRET=redacted",
          sourcePath: "/tmp/project/.env"
        }),
        candidate({
          id: "context_index:proposed_memory",
          layer: "approved_memory",
          trustLevel: "high",
          sourceKind: "approved_memory",
          sourceId: "memory/proposed",
          content: "Unapproved memory.",
          metadata: { memoryStatus: "proposed" }
        }),
        candidate({
          id: "context_index:huge_code",
          layer: "code",
          trustLevel: "high",
          sourceKind: "selected_file",
          sourceId: "src/huge.ts",
          content: "x".repeat(2_000),
          sourcePath: "/tmp/project/src/huge.ts"
        })
      ],
      omitted: [],
      diagnostics: [],
      createdAt
    });

    const selected = selectRuntimeContextCandidates({
      pack: basePack,
      plan,
      retrievalResult
    });

    expect(selected.sections.map((section) => section.id)).toEqual([
      "runtime_policy:agent_hub",
      "task:task",
      "retrieval:context_index:project"
    ]);
    expect(selected.sections.at(-1)).toMatchObject({
      layer: "project",
      trustLevel: "high",
      sourceItemIds: ["context_index:project"],
      inclusionReason: "project_context matched bm25"
    });
    expect(selected.omitted).toEqual([
      {
        itemId: "context_index:secret",
        layer: "code",
        reason: "retrieval candidate source path is secret-like"
      },
      {
        itemId: "context_index:proposed_memory",
        layer: "approved_memory",
        reason: "memory status proposed is not approved"
      },
      {
        itemId: "context_index:huge_code",
        layer: "code",
        reason: "retrieval candidate exceeds code budget"
      }
    ]);
    expect(selected.diagnostics).toEqual([
      expect.objectContaining({
        message: "runtime context retrieval selection completed",
        metadata: expect.objectContaining({
          candidateCount: 4,
          selectedCount: 1,
          omittedCount: 3
        })
      })
    ]);
  });
});

function section(
  id: string,
  layer: ContextLayer,
  trustLevel: TrustLevel,
  title: string
) {
  return {
    id,
    layer,
    trustLevel,
    title,
    content: title,
    sourceItemIds: [id],
    sourceHashes: [`sha256:${id}`],
    compressionMode: "none" as const,
    originalCharacterCount: title.length,
    renderedCharacterCount: title.length,
    omittedItemCount: 0,
    inclusionReason: "pinned"
  };
}

function candidate(input: {
  id: string;
  layer: ContextLayer;
  trustLevel: TrustLevel;
  sourceKind: string;
  sourceId: string;
  content: string;
  sourcePath?: string;
  metadata?: Record<string, unknown>;
}): ContextCandidate {
  return validateContextCandidate({
    item: {
      id: input.id,
      layer: input.layer,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      scope: "project",
      trustLevel: input.trustLevel,
      lifetime: "static",
      title: input.sourceKind,
      content: input.content,
      contentHash: `sha256:${input.id}`,
      sourcePath: input.sourcePath,
      createdAt,
      metadata: input.metadata ?? {}
    },
    routes: ["bm25"],
    relevanceScore: 0.9,
    freshnessScore: 0.8,
    trustScore: input.trustLevel === "high" ? 0.85 : 0.5,
    scopeMatchScore: 0.9,
    inclusionReason: `${input.sourceKind} matched bm25`,
    diagnostics: {}
  });
}
