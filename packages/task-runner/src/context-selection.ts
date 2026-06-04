import {
  validateRuntimeContextPack,
  type CompressionMode,
  type ContextCandidate,
  type ContextLayer,
  type ContextPlan,
  type ContextRetrievalResult,
  type RuntimeContextPack
} from "@agent-hub/core";

const retrievalCharacterBudget = 6_000;

export interface RuntimeContextSelectionInput {
  pack: RuntimeContextPack;
  plan: ContextPlan;
  retrievalResult: ContextRetrievalResult;
}

export function selectRuntimeContextCandidates(
  input: RuntimeContextSelectionInput
): RuntimeContextPack {
  const baseSourceIds = new Set(
    input.pack.sections.flatMap((section) => [
      section.id,
      ...section.sourceItemIds
    ])
  );
  const omitted: RuntimeContextPack["omitted"] = [
    ...input.pack.omitted,
    ...input.retrievalResult.omitted
  ];
  const diagnostics: RuntimeContextPack["diagnostics"] = [
    ...input.pack.diagnostics
  ];
  const allowedCandidates: ContextCandidate[] = [];

  for (const candidate of input.retrievalResult.candidates) {
    const policyReason = candidatePolicyOmission(candidate, input.plan);
    if (policyReason) {
      omitted.push({
        itemId: candidate.item.id,
        layer: candidate.item.layer,
        reason: policyReason
      });
      continue;
    }
    if (candidate.item.layer === "task") {
      continue;
    }
    if (baseSourceIds.has(candidate.item.id)) {
      omitted.push({
        itemId: candidate.item.id,
        layer: candidate.item.layer,
        reason: "retrieval candidate already exists in pinned runtime context"
      });
      continue;
    }
    allowedCandidates.push(candidate);
  }

  const selectedSections: RuntimeContextPack["sections"] = [];
  const usedByLayer = new Map<ContextLayer, number>();
  for (const candidate of allowedCandidates.sort((left, right) =>
    finalCandidateScore(right, input.plan) - finalCandidateScore(left, input.plan)
  )) {
    const budget = layerCharacterBudget(candidate.item.layer, input.plan);
    if (budget <= 0) {
      omitted.push({
        itemId: candidate.item.id,
        layer: candidate.item.layer,
        reason: "retrieval candidate layer has no runtime budget"
      });
      continue;
    }
    const used = usedByLayer.get(candidate.item.layer) ?? 0;
    const renderedLength = candidate.item.content.length;
    if (used + renderedLength > budget) {
      omitted.push({
        itemId: candidate.item.id,
        layer: candidate.item.layer,
        reason: `retrieval candidate exceeds ${candidate.item.layer} budget`
      });
      continue;
    }
    usedByLayer.set(candidate.item.layer, used + renderedLength);
    selectedSections.push({
      id: `retrieval:${candidate.item.id}`,
      layer: candidate.item.layer,
      trustLevel: candidate.item.trustLevel,
      title: `${candidate.item.title} [routes=${candidate.routes.join("+")}]`,
      content: candidate.item.content,
      sourceItemIds: [candidate.item.id],
      sourceHashes: [candidate.item.contentHash],
      compressionMode: compressionModeForCandidate(candidate, input.plan),
      originalCharacterCount: candidate.item.content.length,
      renderedCharacterCount: candidate.item.content.length,
      omittedItemCount: 0,
      inclusionReason: candidate.inclusionReason
    });
  }

  diagnostics.push({
    severity: "info",
    message: "runtime context retrieval selection completed",
    metadata: {
      candidateCount: input.retrievalResult.candidates.length,
      selectedCount: selectedSections.length,
      omittedCount: omitted.length - input.pack.omitted.length
    }
  });

  return validateRuntimeContextPack({
    ...input.pack,
    sections: [...input.pack.sections, ...selectedSections],
    omitted,
    diagnostics
  });
}

function candidatePolicyOmission(
  candidate: ContextCandidate,
  plan: ContextPlan
): string | undefined {
  if (plan.trustPolicy[candidate.item.layer] === "deny") {
    return `retrieval candidate layer ${candidate.item.layer} is denied by context plan`;
  }
  if (candidate.item.layer === "conversation" && candidate.item.trustLevel !== "low") {
    return "conversation retrieval candidates must remain low trust";
  }
  if (candidate.item.sourcePath && secretLikePath(candidate.item.sourcePath)) {
    return "retrieval candidate source path is secret-like";
  }
  const memoryStatus = candidate.item.metadata.memoryStatus;
  if (
    candidate.item.layer === "approved_memory" &&
    typeof memoryStatus === "string" &&
    memoryStatus !== "approved"
  ) {
    return `memory status ${memoryStatus} is not approved`;
  }
  return undefined;
}

function finalCandidateScore(candidate: ContextCandidate, plan: ContextPlan): number {
  return (
    candidate.relevanceScore * 0.4 +
    layerPriority(candidate.item.layer, plan) * 0.2 +
    candidate.trustScore * 0.2 +
    candidate.freshnessScore * 0.1 +
    (candidate.graphProximityScore ?? 0) * 0.1
  );
}

function layerPriority(layer: ContextLayer, plan: ContextPlan): number {
  const requiredIndex = plan.requiredLayers.indexOf(layer);
  if (requiredIndex !== -1) {
    return Math.max(0.2, 1 - requiredIndex * 0.08);
  }
  return Math.min(1, plan.budgetPolicy[layer] / 40);
}

function layerCharacterBudget(layer: ContextLayer, plan: ContextPlan): number {
  return Math.floor(retrievalCharacterBudget * (plan.budgetPolicy[layer] / 100));
}

function compressionModeForCandidate(
  candidate: ContextCandidate,
  plan: ContextPlan
): CompressionMode {
  return plan.compressionPolicy[candidate.item.layer] ?? "summary";
}

function secretLikePath(value: string): boolean {
  const normalized = value.replace(/\\/g, "/").toLowerCase();
  return normalized
    .split("/")
    .some((segment) =>
      segment === ".env" ||
      segment.startsWith(".env.") ||
      segment === "id_rsa" ||
      segment === "id_ed25519" ||
      segment.endsWith(".pem") ||
      segment.endsWith(".key") ||
      segment.startsWith("secrets.") ||
      segment.startsWith("credentials.") ||
      segment.startsWith("token.")
    );
}
