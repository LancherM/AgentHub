import type {
  ReviewRiskLevel,
  ReviewSummary,
  RiskFinding,
  RiskReport,
  RunInspectorTab,
  VerificationStatus,
  WorkgroupInspectorTab
} from "./types";

export type ReviewDecisionTone = "ready" | "warning" | "danger";

export interface ReviewNextAction {
  label: string;
  detail: string;
  tab: WorkgroupInspectorTab;
}

export interface ReviewConclusionModel {
  headline: string;
  suggestedDecision: string;
  rationale: string;
  tone: ReviewDecisionTone;
  changedOutput: string;
  checkSummary: string;
  riskSummary: string;
  memorySummary: string;
  blockingFindings: RiskFinding[];
  nextActions: ReviewNextAction[];
}

export function buildReviewConclusion(
  summary: ReviewSummary,
  risk?: RiskReport
): ReviewConclusionModel {
  const blockingFindings =
    risk?.findings.filter((finding) => finding.severity === "blocking") ?? [];
  const riskLevel = risk?.level ?? summary.riskLevel;
  const hasBlockingRisk = riskLevel === "blocking" || blockingFindings.length > 0;
  const hasFailedChecks = summary.verificationStatus === "failed";
  const hasHighRisk = riskLevel === "high";
  const hasReviewRisk = riskLevel === "medium" || riskLevel === "unknown";
  const failedRun = summary.status === "failed";
  const cancelledRun = summary.status === "cancelled";
  const cleanRun =
    summary.status === "completed" &&
    !hasBlockingRisk &&
    !hasHighRisk &&
    !hasReviewRisk &&
    !hasFailedChecks;

  return {
    headline: headlineFor({
      hasBlockingRisk,
      hasFailedChecks,
      hasHighRisk,
      hasReviewRisk,
      failedRun,
      cancelledRun,
      cleanRun
    }),
    suggestedDecision: suggestedDecisionFor({
      hasBlockingRisk,
      hasFailedChecks,
      hasHighRisk,
      hasReviewRisk,
      failedRun,
      cancelledRun,
      cleanRun
    }),
    rationale: rationaleFor({
      status: summary.status,
      riskLevel,
      verificationStatus: summary.verificationStatus
    }),
    tone: toneFor({
      hasBlockingRisk,
      hasFailedChecks,
      hasHighRisk,
      hasReviewRisk,
      failedRun,
      cancelledRun,
      cleanRun
    }),
    changedOutput: `${summary.changedFileCount} files +${summary.additions}/-${summary.deletions}`,
    checkSummary: summary.verificationStatus,
    riskSummary: riskLevel,
    memorySummary: `${summary.memoryProposalCount} proposal${
      summary.memoryProposalCount === 1 ? "" : "s"
    }`,
    blockingFindings,
    nextActions: nextActionsFor({
      hasBlockingRisk,
      hasFailedChecks,
      failedRun,
      cancelledRun
    })
  };
}

export function normalizeReviewInspectorTab(
  tab: RunInspectorTab
): WorkgroupInspectorTab {
  switch (tab) {
    case "summary":
      return "brief";
    case "diff":
    case "handoff":
    case "compare":
      return "artifacts";
    case "tests":
      return "checks";
    case "risk":
      return "risks";
    case "logs":
      return "audit";
    default:
      return tab;
  }
}

function headlineFor(input: {
  hasBlockingRisk: boolean;
  hasFailedChecks: boolean;
  hasHighRisk: boolean;
  hasReviewRisk: boolean;
  failedRun: boolean;
  cancelledRun: boolean;
  cleanRun: boolean;
}): string {
  if (input.hasBlockingRisk) {
    return "Blocking risk needs review";
  }
  if (input.failedRun) {
    return "Run failed before acceptance";
  }
  if (input.cancelledRun) {
    return "Run was cancelled";
  }
  if (input.hasFailedChecks) {
    return "Checks failed";
  }
  if (input.hasHighRisk) {
    return "High risk needs review";
  }
  if (input.hasReviewRisk) {
    return "Risk needs review";
  }
  if (input.cleanRun) {
    return "Review ready";
  }
  return "Needs review";
}

function suggestedDecisionFor(input: {
  hasBlockingRisk: boolean;
  hasFailedChecks: boolean;
  hasHighRisk: boolean;
  hasReviewRisk: boolean;
  failedRun: boolean;
  cancelledRun: boolean;
  cleanRun: boolean;
}): string {
  if (
    input.hasBlockingRisk ||
    input.hasFailedChecks ||
    input.hasHighRisk ||
    input.failedRun ||
    input.cancelledRun
  ) {
    return "Record reject or request a follow-up";
  }
  if (input.cleanRun) {
    return "Record accept after manual review";
  }
  return "Review evidence before deciding";
}

function rationaleFor(input: {
  status: ReviewSummary["status"];
  riskLevel: ReviewRiskLevel;
  verificationStatus: VerificationStatus;
}): string {
  if (input.riskLevel === "blocking") {
    return "A blocking risk is present. Review risk evidence before any acceptance or local apply workflow.";
  }
  if (input.verificationStatus === "failed") {
    return "One or more verification commands failed. Inspect Checks before recording a decision.";
  }
  if (input.status === "failed") {
    return "The run failed. Inspect Artifacts and Audit before deciding whether to retry.";
  }
  if (input.status === "cancelled") {
    return "The run was cancelled. Inspect Audit if the cancellation was unexpected.";
  }
  if (input.riskLevel === "high") {
    return "High risk findings are present. Review the Risks tab before accepting.";
  }
  return "The run is terminal. Review the summarized output and supporting tabs before recording accept or reject.";
}

function toneFor(input: {
  hasBlockingRisk: boolean;
  hasFailedChecks: boolean;
  hasHighRisk: boolean;
  hasReviewRisk: boolean;
  failedRun: boolean;
  cancelledRun: boolean;
  cleanRun: boolean;
}): ReviewDecisionTone {
  if (input.hasBlockingRisk || input.failedRun || input.cancelledRun) {
    return "danger";
  }
  if (input.hasFailedChecks || input.hasHighRisk || input.hasReviewRisk || !input.cleanRun) {
    return "warning";
  }
  return "ready";
}

function nextActionsFor(input: {
  hasBlockingRisk: boolean;
  hasFailedChecks: boolean;
  failedRun: boolean;
  cancelledRun: boolean;
}): ReviewNextAction[] {
  if (input.hasBlockingRisk) {
    return [
      {
        label: "Open Risks",
        detail: "Inspect blocking evidence before any acceptance or local apply workflow.",
        tab: "risks"
      },
      {
        label: "Open Artifacts",
        detail: "Review changed output and bounded diff evidence.",
        tab: "artifacts"
      },
      {
        label: "Open Audit",
        detail: "Confirm the exact run event sequence if the risk is unexpected.",
        tab: "audit"
      }
    ];
  }
  if (input.hasFailedChecks) {
    return [
      {
        label: "Open Checks",
        detail: "Inspect failed command output before accepting.",
        tab: "checks"
      },
      {
        label: "Open Artifacts",
        detail: "Review changed output against the failed check.",
        tab: "artifacts"
      },
      {
        label: "Record Decision",
        detail: "Accept or reject records review state only.",
        tab: "brief"
      }
    ];
  }
  if (input.failedRun || input.cancelledRun) {
    return [
      {
        label: "Open Audit",
        detail: "Review the terminal event and adapter output.",
        tab: "audit"
      },
      {
        label: "Open Artifacts",
        detail: "Check whether any reviewable output was captured.",
        tab: "artifacts"
      },
      {
        label: "Record Decision",
        detail: "Accept or reject records review state only.",
        tab: "brief"
      }
    ];
  }
  return [
    {
      label: "Review Artifacts",
      detail: "Inspect changed output and bounded previews.",
      tab: "artifacts"
    },
    {
      label: "Review Checks",
      detail: "Confirm verification status before accepting.",
      tab: "checks"
    },
    {
      label: "Record Decision",
      detail: "Accept or reject records review state only.",
      tab: "brief"
    }
  ];
}
