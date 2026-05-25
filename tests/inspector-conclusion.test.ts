import { describe, expect, it } from "vitest";
import {
  buildReviewConclusion,
  normalizeReviewInspectorTab
} from "../apps/desktop/src/lib/inspector-conclusion";
import type {
  ReviewSummary,
  RiskReport
} from "../apps/desktop/src/lib/types";

describe("normalizeReviewInspectorTab", () => {
  it("keeps review openings on Brief and maps legacy evidence tabs", () => {
    expect(normalizeReviewInspectorTab("brief")).toBe("brief");
    expect(normalizeReviewInspectorTab("summary")).toBe("brief");
    expect(normalizeReviewInspectorTab("compare")).toBe("artifacts");
    expect(normalizeReviewInspectorTab("logs")).toBe("audit");
    expect(normalizeReviewInspectorTab("risk")).toBe("risks");
  });
});

describe("buildReviewConclusion", () => {
  it("pins blocking risks before accept-oriented review", () => {
    const conclusion = buildReviewConclusion(
      reviewSummary({ riskLevel: "blocking", verificationStatus: "passed" }),
      riskReport("blocking")
    );

    expect(conclusion.headline).toBe("Blocking risk needs review");
    expect(conclusion.suggestedDecision).toBe(
      "Record reject or request a follow-up"
    );
    expect(conclusion.tone).toBe("danger");
    expect(conclusion.blockingFindings).toHaveLength(1);
    expect(conclusion.nextActions[0]).toMatchObject({
      label: "Open Risks",
      tab: "risks"
    });
  });

  it("suggests accept only after manual review for clean terminal runs", () => {
    const conclusion = buildReviewConclusion(
      reviewSummary({ riskLevel: "low", verificationStatus: "passed" }),
      riskReport("low")
    );

    expect(conclusion.headline).toBe("Review ready");
    expect(conclusion.suggestedDecision).toBe(
      "Record accept after manual review"
    );
    expect(conclusion.tone).toBe("ready");
    expect(conclusion.blockingFindings).toEqual([]);
    expect(conclusion.nextActions.map((action) => action.tab)).toEqual([
      "artifacts",
      "checks",
      "brief"
    ]);
  });

  it("keeps medium risk in review state", () => {
    const conclusion = buildReviewConclusion(
      reviewSummary({ riskLevel: "medium", verificationStatus: "skipped" }),
      riskReport("medium")
    );

    expect(conclusion.headline).toBe("Risk needs review");
    expect(conclusion.suggestedDecision).toBe("Review evidence before deciding");
    expect(conclusion.tone).toBe("warning");
  });
});

function reviewSummary(
  input: Pick<ReviewSummary, "riskLevel" | "verificationStatus">
): ReviewSummary {
  return {
    runId: "run_1",
    agentId: "fake",
    status: "completed",
    task: "Review this",
    summary: "Run completed.",
    startedAt: "2026-05-25T00:00:00.000Z",
    completedAt: "2026-05-25T00:00:01.000Z",
    durationMs: 1000,
    changedFileCount: 2,
    additions: 12,
    deletions: 1,
    verificationStatus: input.verificationStatus,
    riskLevel: input.riskLevel,
    memoryProposalCount: 0,
    reviewStatus: "pending"
  };
}

function riskReport(level: RiskReport["level"]): RiskReport {
  return {
    runId: "run_1",
    level,
    generatedAt: "2026-05-25T00:00:01.000Z",
    findings:
      level === "blocking"
        ? [
            {
              id: "risk_1",
              severity: "blocking",
              category: "security",
              title: "Sensitive path changed",
              description: "A sensitive path was modified.",
              evidence: ".env"
            }
          ]
        : []
  };
}
