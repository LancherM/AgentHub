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
        message: "runtime context layer budget allocation completed",
        metadata: expect.objectContaining({
          items_selected: 1,
          items_compressed: 0,
          items_omitted: 1,
          top_omission_reason: "retrieval candidate exceeds code budget"
        })
      }),
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

  it("deduplicates indexed approved memory already present in the base pack", () => {
    const plan = createContextPlan({
      id: "context_plan_memory_dedupe",
      taskPrompt: "Fix parser bug using approved memory",
      createdAt
    });
    const basePack = validateRuntimeContextPack({
      id: "runtime_pack_memory_dedupe",
      planId: plan.id,
      taskId: "task_memory_dedupe",
      runId: "run_memory_dedupe",
      sections: [
        section("runtime_policy:agent_hub", "runtime_policy", "system", "Runtime Policy"),
        section("task:task", "task", "system", "Current Task"),
        section(
          "memory:approved",
          "approved_memory",
          "high",
          "Approved Memory",
          "Approved parser memory.",
          "none"
        )
      ],
      omitted: [],
      diagnostics: [],
      createdAt
    });
    const retrievalResult = validateContextRetrievalResult({
      id: "context_retrieval_memory_dedupe",
      planId: plan.id,
      taskId: "task_memory_dedupe",
      runId: "run_memory_dedupe",
      candidates: [
        candidate({
          id: "context_index:project_1:approved_memory:memory/approved.md",
          layer: "approved_memory",
          trustLevel: "high",
          sourceKind: "approved_memory",
          sourceId: "memory/approved.md",
          content: "Approved parser memory."
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

    expect(selected.sections.map((section) => section.id)).not.toContain(
      "retrieval:context_index:project_1:approved_memory:memory/approved.md"
    );
    expect(selected.omitted).toEqual([
      {
        itemId: "context_index:project_1:approved_memory:memory/approved.md",
        layer: "approved_memory",
        reason: "retrieval candidate already exists in pinned runtime context"
      }
    ]);
  });

  it("compresses long project docs, run evidence, and conversation continuity by layer budget", () => {
    const plan = createContextPlan({
      id: "context_plan_compression",
      taskPrompt: "Fix parser bug using previous run evidence",
      createdAt
    });
    const longConversation = [
      "trust: low",
      "purpose: continuity only",
      "may_override_current_task: false",
      "may_override_project_context: false",
      "may_override_approved_memory: false",
      "",
      "Prior discussion ".repeat(80),
      "decisions:",
      ...Array.from({ length: 12 }, (_, index) => `- Decision ${index}`),
      "open_items:",
      ...Array.from({ length: 12 }, (_, index) => `- Open item ${index}`)
    ].join("\n");
    const basePack = validateRuntimeContextPack({
      id: "runtime_pack_compression",
      planId: plan.id,
      taskId: "task_compression",
      runId: "run_compression",
      sections: [
        section("runtime_policy:agent_hub", "runtime_policy", "system", "Runtime Policy"),
        section("task:task", "task", "system", "Current Task"),
        section(
          "conversation:thread",
          "conversation",
          "low",
          "Thread Summary",
          longConversation,
          "structured"
        )
      ],
      omitted: [],
      diagnostics: [],
      createdAt
    });
    const longProjectDoc = [
      "# Parser Context",
      "Use packages/task-runner for runtime context.",
      ...Array.from(
        { length: 80 },
        (_, index) => `- Parser rule ${index} lives near src/parser.ts and tests/parser.test.ts.`
      )
    ].join("\n");
    const longRunEvidence = [
      "run_id: run_prior",
      "task_id: task_prior",
      "task_title: Parser fix",
      "agent_kind: codex",
      "status: failed",
      "",
      "Previous run output ".repeat(160),
      "changed_files:",
      ...Array.from({ length: 16 }, (_, index) => `- src/file-${index}.ts`),
      "verification_summary: pnpm test failed in parser.test.ts",
      "risk_summary: medium"
    ].join("\n");
    const retrievalResult = validateContextRetrievalResult({
      id: "context_retrieval_compression",
      planId: plan.id,
      taskId: "task_compression",
      runId: "run_compression",
      candidates: [
        candidate({
          id: "context_index:long_project",
          layer: "project",
          trustLevel: "high",
          sourceKind: "project_context",
          sourceId: "context/project.md",
          content: longProjectDoc,
          sourcePath: "/tmp/context/project.md"
        }),
        candidate({
          id: "run_evidence:prior",
          layer: "run_evidence",
          trustLevel: "medium",
          sourceKind: "recent_run_summary",
          sourceId: "run_prior",
          content: longRunEvidence
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

    const compressedConversation = selected.sections.find(
      (entry) => entry.id === "conversation:thread"
    );
    const compressedProject = selected.sections.find(
      (entry) => entry.id === "retrieval:context_index:long_project"
    );
    const compressedRun = selected.sections.find(
      (entry) => entry.id === "retrieval:run_evidence:prior"
    );
    expect(compressedConversation).toMatchObject({
      layer: "conversation",
      trustLevel: "low",
      compressionMode: "structured",
      sourceItemIds: ["conversation:thread"],
      sourceHashes: ["sha256:conversation:thread"],
      omittedItemCount: 1
    });
    expect(compressedConversation?.content).toContain("may_override_current_task: false");
    expect(compressedConversation?.renderedCharacterCount).toBeLessThan(
      compressedConversation?.originalCharacterCount ?? 0
    );
    expect(compressedProject).toMatchObject({
      compressionMode: "extractive",
      sourceItemIds: ["context_index:long_project"],
      sourceHashes: ["sha256:context_index:long_project"],
      omittedItemCount: 1
    });
    expect(compressedProject?.content).toContain("compression: extractive");
    expect(compressedProject?.renderedCharacterCount).toBeLessThanOrEqual(1_200);
    expect(compressedRun).toMatchObject({
      compressionMode: "structured",
      sourceItemIds: ["run_evidence:prior"],
      sourceHashes: ["sha256:run_evidence:prior"],
      omittedItemCount: 1
    });
    expect(compressedRun?.content).toContain("verification_summary:");
    expect(compressedRun?.renderedCharacterCount).toBeLessThanOrEqual(1_200);
    expect(selected.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "runtime context layer budget allocation completed",
          metadata: expect.objectContaining({
            items_compressed: 3,
            layer_budget_requested: expect.objectContaining({
              project: 1_200,
              run_evidence: 1_200,
              conversation: 300
            })
          })
        })
      ])
    );
  });
});

function section(
  id: string,
  layer: ContextLayer,
  trustLevel: TrustLevel,
  title: string,
  content = title,
  compressionMode: "none" | "extractive" | "structured" | "summary" = "none"
) {
  return {
    id,
    layer,
    trustLevel,
    title,
    content,
    sourceItemIds: [id],
    sourceHashes: [`sha256:${id}`],
    compressionMode,
    originalCharacterCount: content.length,
    renderedCharacterCount: content.length,
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
