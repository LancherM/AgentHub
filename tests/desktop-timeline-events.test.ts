import { describe, expect, it } from "vitest";
import {
  runEvidenceTimelineChips,
  timelinePresentationForMessage
} from "../apps/desktop/src/lib/timelineEvents";
import type {
  AgentRunMessage,
  ReviewArtifact,
  ReviewSummary,
  SystemMessage
} from "../apps/desktop/src/lib/types";

describe("desktop timeline event presentation", () => {
  it("maps legacy task system metadata to task timeline cards", () => {
    const message: SystemMessage = {
      id: "message_task",
      threadId: "thread_1",
      type: "system",
      text: "Task created: review output",
      metadata: {
        taskEvent: "task_created",
        taskId: "task_1"
      },
      createdAt: "2026-05-25T00:00:00.000Z"
    };

    expect(timelinePresentationForMessage(message)).toMatchObject({
      kind: "task_created",
      title: "Task created",
      tone: "accent"
    });
  });

  it("derives run cards and evidence chips from run review summaries", () => {
    const message: AgentRunMessage = {
      id: "message_run",
      threadId: "thread_1",
      type: "agent_run",
      runId: "run_1",
      agentId: "fake",
      status: "completed",
      taskId: "task_1",
      taskTitle: "Review output",
      createdAt: "2026-05-25T00:00:00.000Z"
    };
    const review: ReviewSummary = {
      runId: "run_1",
      agentId: "fake",
      status: "completed",
      task: "Review output",
      summary: "Completed.",
      changedFileCount: 3,
      additions: 12,
      deletions: 2,
      verificationStatus: "passed",
      riskLevel: "medium",
      memoryProposalCount: 1,
      reviewStatus: "accepted"
    };

    const presentation = timelinePresentationForMessage(message, {
      reviewSummary: review,
      eventCount: 8,
      status: "completed"
    });

    expect(presentation).toMatchObject({
      kind: "run_completed",
      linkedRunId: "run_1",
      linkedTaskId: "task_1",
      tone: "success"
    });
    expect(presentation.chips.map((chip) => chip.kind)).toEqual([
      "check_completed",
      "risk_detected",
      "artifact_created",
      "review_decision",
      "review_decision",
      "lifecycle_marked_keep",
      "memory_proposed",
      "system_event"
    ]);
    expect(presentation.chips).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Checks passed",
          tab: "checks",
          tone: "success"
        }),
        expect.objectContaining({
          label: "Risks medium",
          tab: "risks",
          tone: "warning"
        }),
        expect.objectContaining({
          label: "Memory 1",
          tab: "memory",
          tone: "accent"
        })
      ])
    );
  });

  it("keeps pending run evidence bounded to compact inspector chips", () => {
    expect(runEvidenceTimelineChips(undefined, 4, "running")).toEqual([
      expect.objectContaining({ label: "Checks pending", tab: "checks" }),
      expect.objectContaining({ label: "Risks pending", tab: "risks" }),
      expect.objectContaining({ label: "Artifacts pending", tab: "artifacts" }),
      expect.objectContaining({ label: "Compare", tab: "artifacts" }),
      expect.objectContaining({ label: "Review pending", tab: "brief" }),
      expect.objectContaining({ label: "Lifecycle", tab: "lifecycle" }),
      expect.objectContaining({ label: "Memory 0", tab: "memory" }),
      expect.objectContaining({ label: "Audit 4", tab: "audit" })
    ]);
  });

  it("adds named artifact chips when review artifacts are available", () => {
    const artifacts: ReviewArtifact[] = [
      reviewArtifact("artifact_context", "conversation_brief", "context"),
      reviewArtifact("artifact_diff", "git_diff", "diff"),
      reviewArtifact("artifact_decision", "review_decision", "review")
    ];

    expect(
      runEvidenceTimelineChips(undefined, 4, "completed", artifacts)
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Artifacts 3", tab: "artifacts" }),
        expect.objectContaining({
          label: "conversation_brief",
          tab: "artifacts",
          tone: "info"
        }),
        expect.objectContaining({
          label: "git_diff",
          tab: "artifacts",
          tone: "warning"
        }),
        expect.objectContaining({
          label: "review_decision",
          tab: "artifacts",
          tone: "success"
        })
      ])
    );
  });
});

function reviewArtifact(
  id: string,
  kind: string,
  artifactType: string
): ReviewArtifact {
  return {
    id,
    runId: "run_1",
    taskId: "task_1",
    kind,
    artifactType,
    title: kind,
    sourceRunId: "run_1",
    sourceTaskId: "task_1",
    summary: "Artifact summary",
    createdAt: "2026-05-25T00:00:00.000Z",
    availability: "local",
    contentCharacters: 10,
    previewCharacters: 10,
    truncated: false
  };
}
