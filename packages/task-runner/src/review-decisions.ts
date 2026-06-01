import {
  validateRunArtifact,
  type RunArtifact,
  type RunArtifactRepository,
  type TaskRunRepository
} from "@agent-hub/core";

export const REVIEW_DECISION_ARTIFACT_KIND = "review_decision";

export type RunReviewDecisionStatus = "accepted" | "rejected";
export type RunReviewStatus = "pending" | RunReviewDecisionStatus;

export interface RunReviewDecisionRepositories {
  taskRunRepository: TaskRunRepository;
  runArtifactRepository: RunArtifactRepository;
}

export interface RecordRunReviewDecisionInput {
  runId: string;
  status: RunReviewDecisionStatus;
  reason?: string;
  now: () => string;
  idFactory: (prefix: string) => string;
}

export interface RunReviewDecision {
  runId: string;
  reviewStatus: RunReviewStatus;
  acceptedAt?: string;
  rejectedAt?: string;
  reason?: string;
  message?: string;
  artifact?: RunArtifact;
}

export async function recordRunReviewDecision(
  repositories: RunReviewDecisionRepositories,
  input: RecordRunReviewDecisionInput
): Promise<RunReviewDecision> {
  const run = await repositories.taskRunRepository.get(input.runId);
  if (!run) {
    throw new Error(`run ${input.runId} not found`);
  }
  const decidedAt = input.now();
  const accepted = input.status === "accepted";
  const artifact = await repositories.runArtifactRepository.create(
    validateRunArtifact({
      id: input.idFactory("review"),
      taskRunId: input.runId,
      kind: REVIEW_DECISION_ARTIFACT_KIND,
      content: accepted
        ? "Accepted for record. No merge was performed."
        : "Rejected for record. No files were deleted or reverted.",
      metadata: {
        reviewStatus: input.status,
        ...(accepted ? { acceptedAt: decidedAt } : { rejectedAt: decidedAt }),
        ...(input.reason ? { reason: input.reason } : {})
      },
      createdAt: decidedAt
    })
  );
  return reviewDecisionFromArtifact(input.runId, artifact);
}

export async function getRunReviewDecision(
  repositories: Pick<RunReviewDecisionRepositories, "runArtifactRepository">,
  runId: string
): Promise<RunReviewDecision> {
  const artifact = await repositories.runArtifactRepository.getLatestByRunIdAndKind(
    runId,
    REVIEW_DECISION_ARTIFACT_KIND
  );
  return reviewDecisionFromArtifact(runId, artifact);
}

export function reviewDecisionFromArtifact(
  runId: string,
  artifact: RunArtifact | undefined
): RunReviewDecision {
  const metadata = artifact?.metadata;
  if (artifact && metadata?.reviewStatus === "accepted") {
    return {
      runId,
      reviewStatus: "accepted",
      acceptedAt:
        typeof metadata.acceptedAt === "string" ? metadata.acceptedAt : artifact.createdAt,
      reason: typeof metadata.reason === "string" ? metadata.reason : undefined,
      message: artifact.content,
      artifact
    };
  }
  if (artifact && metadata?.reviewStatus === "rejected") {
    return {
      runId,
      reviewStatus: "rejected",
      rejectedAt:
        typeof metadata.rejectedAt === "string" ? metadata.rejectedAt : artifact.createdAt,
      reason: typeof metadata.reason === "string" ? metadata.reason : undefined,
      message: artifact.content,
      artifact
    };
  }
  return { runId, reviewStatus: "pending" };
}
