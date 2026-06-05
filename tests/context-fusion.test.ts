import { describe, expect, it } from "vitest";
import { fuseContextCandidates } from "@agent-hub/task-runner";
import {
  validateContextCandidate,
  type ContextCandidate,
  type RetrievalRoute
} from "@agent-hub/core";

const createdAt = "2026-01-01T00:00:00.000Z";

describe("hybrid context retrieval fusion", () => {
  it("combines same-source BM25 and embedding candidates without losing route evidence", () => {
    const fused = fuseContextCandidates([
      candidate("bm25", 0.72),
      candidate("embedding", 0.84)
    ]);

    expect(fused).toHaveLength(1);
    expect(fused[0]).toMatchObject({
      routes: ["bm25", "embedding"],
      relevanceScore: 0.88,
      inclusionReason: "hybrid fusion combined bm25+embedding retrieval signals",
      diagnostics: expect.objectContaining({
        fusedRoutes: ["bm25", "embedding"],
        fusedCandidateCount: 2,
        fusedSourceIds: ["context/project.md", "context/project.md"]
      })
    });
  });
});

function candidate(route: RetrievalRoute, relevanceScore: number): ContextCandidate {
  return validateContextCandidate({
    item: {
      id: `candidate:${route}`,
      layer: "project",
      sourceKind: "project_context",
      sourceId: "context/project.md",
      scope: "project",
      trustLevel: "high",
      lifetime: "static",
      title: "Project Context",
      content: `${route} context`,
      contentHash: `sha256:${route}`,
      sourcePath: "/tmp/context/project.md",
      createdAt,
      metadata: {}
    },
    routes: [route],
    relevanceScore,
    freshnessScore: 0.8,
    trustScore: 0.85,
    scopeMatchScore: 0.9,
    inclusionReason: `${route} matched`,
    diagnostics: { route }
  });
}
