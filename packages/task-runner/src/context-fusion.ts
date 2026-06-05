import {
  validateContextCandidate,
  type ContextBundle,
  type ContextCandidate,
  type ContextPlan,
  type RetrievalRoute,
  type Task
} from "@agent-hub/core";

export interface ContextRetrievalCapability {
  available: boolean;
  provider: string;
  reason?: string;
}

export interface ContextEmbeddingRetrieverInput {
  plan: ContextPlan;
  task: Task;
  taskPrompt: string;
  contextBundle: ContextBundle;
  queryTerms: string[];
  limit: number;
}

export interface ContextEmbeddingRetriever {
  detect(): Promise<ContextRetrievalCapability>;
  retrieve(input: ContextEmbeddingRetrieverInput): Promise<ContextCandidate[]>;
}

export interface ContextCandidateRerankerInput {
  plan: ContextPlan;
  taskPrompt: string;
  candidates: ContextCandidate[];
}

export interface ContextCandidateReranker {
  detect?(): Promise<ContextRetrievalCapability>;
  rerank(input: ContextCandidateRerankerInput): Promise<ContextCandidate[]>;
}

export function fuseContextCandidates(
  candidates: ContextCandidate[]
): ContextCandidate[] {
  const grouped = new Map<string, ContextCandidate[]>();
  for (const candidate of candidates) {
    const key = fusionKey(candidate);
    grouped.set(key, [...(grouped.get(key) ?? []), candidate]);
  }

  return [...grouped.values()].map(fuseCandidateGroup);
}

function fuseCandidateGroup(candidates: ContextCandidate[]): ContextCandidate {
  const primary = candidates.sort((left, right) =>
    right.relevanceScore === left.relevanceScore
      ? routePriority(left.routes) - routePriority(right.routes)
      : right.relevanceScore - left.relevanceScore
  )[0];
  if (!primary) {
    throw new Error("cannot fuse an empty context candidate group");
  }
  const routes = uniqueRoutes(candidates.flatMap((candidate) => candidate.routes));
  const routeDiversityBoost = Math.max(0, routes.length - primary.routes.length) * 0.04;
  return validateContextCandidate({
    ...primary,
    routes,
    relevanceScore: Math.min(
      1,
      Math.max(...candidates.map((candidate) => candidate.relevanceScore)) +
        routeDiversityBoost
    ),
    freshnessScore: Math.max(
      ...candidates.map((candidate) => candidate.freshnessScore)
    ),
    trustScore: Math.max(...candidates.map((candidate) => candidate.trustScore)),
    graphProximityScore: maxOptionalNumber(
      candidates.map((candidate) => candidate.graphProximityScore)
    ),
    scopeMatchScore: Math.max(
      ...candidates.map((candidate) => candidate.scopeMatchScore)
    ),
    inclusionReason:
      routes.length > primary.routes.length
        ? `hybrid fusion combined ${routes.join("+")} retrieval signals`
        : primary.inclusionReason,
    diagnostics:
      routes.length > primary.routes.length
        ? {
            ...primary.diagnostics,
            fusedRoutes: routes,
            fusedCandidateCount: candidates.length,
            fusedSourceIds: candidates.map((candidate) => candidate.item.sourceId)
          }
        : primary.diagnostics
  });
}

function fusionKey(candidate: ContextCandidate): string {
  return [
    candidate.item.sourceKind,
    candidate.item.sourceId,
    candidate.item.sourcePath ?? ""
  ].join(":");
}

function uniqueRoutes(routes: RetrievalRoute[]): RetrievalRoute[] {
  const priority = new Map(routeOrder.map((route, index) => [route, index]));
  return [...new Set(routes)].sort(
    (left, right) => (priority.get(left) ?? 99) - (priority.get(right) ?? 99)
  );
}

function routePriority(routes: RetrievalRoute[]): number {
  const priority = new Map(routeOrder.map((route, index) => [route, index]));
  return Math.min(...routes.map((route) => priority.get(route) ?? 99));
}

function maxOptionalNumber(values: Array<number | undefined>): number | undefined {
  const numbers = values.filter((value): value is number => value !== undefined);
  return numbers.length > 0 ? Math.max(...numbers) : undefined;
}

const routeOrder: RetrievalRoute[] = [
  "explicit",
  "task_rule",
  "bm25",
  "embedding",
  "graph",
  "recency"
];
