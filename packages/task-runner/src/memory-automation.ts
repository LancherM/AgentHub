import {
  createDefaultMemoryAutomationPolicy,
  validateMemoryAutomationEvaluation,
  validateMemoryAutomationPolicy,
  type MemoryAutomationDecision,
  type MemoryAutomationEvaluation,
  type MemoryAutomationPolicy,
  type MemoryAutomationReasonCode,
  type MemoryItem,
  type MemoryItemRepository,
  type RiskReport,
  type RiskReportRepository,
  type TaskRepository,
  type TaskRun,
  type TaskRunRepository,
  type VerificationResult,
  type VerificationResultRepository
} from "@agent-hub/core";
import { hasDangerousCommandText } from "@agent-hub/safety";
import { normalizeMemoryContent } from "./memory-proposals";

export interface MemoryAutomationEvaluatorRepositories {
  taskRunRepository: TaskRunRepository;
  taskRepository: TaskRepository;
  memoryItemRepository: MemoryItemRepository;
  verificationResultRepository: VerificationResultRepository;
  riskReportRepository: RiskReportRepository;
}

export interface MemoryAutomationEvaluationInput {
  runId: string;
  policy?: MemoryAutomationPolicy;
  reviewAccepted?: boolean;
  createdAt?: string;
}

interface DecisionDraft {
  item: MemoryItem;
  reasonCodes: Set<MemoryAutomationReasonCode>;
}

const manualOnlyCategories = new Set<MemoryItem["category"]>([
  "user_preference",
  "temporary_note"
]);

const sensitiveContentTerms = new Set([
  "token",
  "secret",
  "password",
  "passwd",
  "credential",
  "credentials",
  "authorization",
  "bearer",
  "apikey",
  "privatekey"
]);

const sensitivePathPatterns = [
  /\.env(?:\.|$)/i,
  /\.pem$/i,
  /\.key$/i,
  /(^|\/)id_rsa$/i,
  /(^|\/)id_ed25519$/i,
  /(^|\/)secrets?\./i,
  /(^|\/)credentials?\./i,
  /(^|\/)tokens?\./i
];

export class MemoryAutomationEvaluator {
  constructor(private readonly repositories: MemoryAutomationEvaluatorRepositories) {}

  async evaluateRun(
    input: MemoryAutomationEvaluationInput
  ): Promise<MemoryAutomationEvaluation> {
    const policy = validateMemoryAutomationPolicy(
      input.policy ?? createDefaultMemoryAutomationPolicy()
    );
    const run = await this.requireRun(input.runId);
    const task = await this.repositories.taskRepository.get(run.taskId);
    if (!task) {
      throw new Error(`task ${run.taskId} not found`);
    }

    const [projectItems, verificationResults, riskReport] = await Promise.all([
      this.repositories.memoryItemRepository.listByProjectId(task.projectId),
      this.repositories.verificationResultRepository.listByRunId(run.id),
      this.repositories.riskReportRepository.getLatestByRunId(run.id)
    ]);
    const evaluatedItems = projectItems
      .filter((item) =>
        item.taskId === task.id &&
        item.status !== "rejected" &&
        item.metadata?.sourceRunId === run.id
      )
      .sort(compareMemoryItems);
    const canonicalByContent = canonicalMemoryByContent(projectItems);
    const runReasonCodes = runEvidenceReasonCodes({
      run,
      verificationResults,
      riskReport,
      policy
    });
    const drafts = evaluatedItems.map((item) =>
      this.evaluateItem({
        item,
        policy,
        canonicalByContent,
        runReasonCodes,
        reviewAccepted: input.reviewAccepted ?? false
      })
    );

    applyPerRunLimit(drafts, policy);

    return validateMemoryAutomationEvaluation({
      runId: run.id,
      policy,
      decisions: drafts.map(toDecision),
      createdAt: input.createdAt
    });
  }

  private async requireRun(runId: string): Promise<TaskRun> {
    const run = await this.repositories.taskRunRepository.get(runId);
    if (!run) {
      throw new Error(`run ${runId} not found`);
    }
    return run;
  }

  private evaluateItem(input: {
    item: MemoryItem;
    policy: MemoryAutomationPolicy;
    canonicalByContent: Map<string, MemoryItem>;
    runReasonCodes: Set<MemoryAutomationReasonCode>;
    reviewAccepted: boolean;
  }): DecisionDraft {
    const reasonCodes = new Set(input.runReasonCodes);
    const normalizedContent = normalizeMemoryContent(input.item.content);
    const canonical = input.canonicalByContent.get(normalizedContent);

    if (input.item.status === "approved") {
      reasonCodes.add("already_approved");
    } else if (canonical && canonical.id !== input.item.id) {
      reasonCodes.add("duplicate_content");
      if (canonical.status === "approved") {
        reasonCodes.add("already_approved");
      }
    }

    if (manualOnlyCategories.has(input.item.category)) {
      reasonCodes.add("manual_only_category");
    } else if (!input.policy.allowedCategories.includes(input.item.category)) {
      reasonCodes.add("unsupported_category");
    }

    if (input.policy.mode === "suggest_only") {
      reasonCodes.add("policy_disabled");
    } else if (
      input.policy.mode === "auto_after_review_accept" &&
      !input.reviewAccepted
    ) {
      reasonCodes.add("review_not_accepted");
    }

    if (hasSecretLikeText(input.item.content)) {
      reasonCodes.add("secret_like_content");
    }

    return {
      item: input.item,
      reasonCodes
    };
  }
}

export async function evaluateMemoryAutomationForRun(
  repositories: MemoryAutomationEvaluatorRepositories,
  input: MemoryAutomationEvaluationInput
): Promise<MemoryAutomationEvaluation> {
  return new MemoryAutomationEvaluator(repositories).evaluateRun(input);
}

function runEvidenceReasonCodes(input: {
  run: TaskRun;
  verificationResults: VerificationResult[];
  riskReport?: RiskReport;
  policy: MemoryAutomationPolicy;
}): Set<MemoryAutomationReasonCode> {
  const reasonCodes = new Set<MemoryAutomationReasonCode>();
  if (input.run.status !== "succeeded") {
    reasonCodes.add("run_not_succeeded");
  }

  const verificationStatus = summarizeVerification(input.verificationResults);
  if (verificationStatus === "failed") {
    reasonCodes.add("verification_failed");
  } else if (
    verificationStatus === "skipped" &&
    !input.policy.allowSkippedVerification
  ) {
    reasonCodes.add("verification_skipped_not_allowed");
  }

  if (
    input.verificationResults.some((result) =>
      hasDangerousCommandText(result.command) || hasSecretLikeText(result.command)
    )
  ) {
    reasonCodes.add("unsafe_command");
  }

  const riskReport = input.riskReport;
  if (riskReport) {
    if (riskReport.level === "blocking") {
      reasonCodes.add("blocking_risk");
    }
    if (riskRank(riskReport.level) > riskRank(input.policy.maxRiskLevel)) {
      reasonCodes.add("risk_too_high");
    }
    if (riskReport.findings.some((finding) => finding.level === "blocking")) {
      reasonCodes.add("blocking_risk");
    }
    if (hasSensitivePathRisk(riskReport)) {
      reasonCodes.add("sensitive_path");
    }
    if (hasUnsafeCommandRisk(riskReport)) {
      reasonCodes.add("unsafe_command");
    }
  }
  return reasonCodes;
}

function applyPerRunLimit(
  drafts: DecisionDraft[],
  policy: MemoryAutomationPolicy
): void {
  if (policy.mode === "suggest_only") {
    return;
  }
  let eligibleCount = 0;
  for (const draft of drafts) {
    if (!isPotentiallyEligible(draft.reasonCodes)) {
      continue;
    }
    eligibleCount += 1;
    if (eligibleCount > policy.maxAutoApprovalsPerRun) {
      draft.reasonCodes.add("per_run_limit_exceeded");
    }
  }
}

function toDecision(draft: DecisionDraft): MemoryAutomationDecision {
  const reasonCodes = [...draft.reasonCodes];
  if (reasonCodes.length === 0) {
    reasonCodes.push("within_policy");
  }
  const status = decisionStatus(reasonCodes);
  return {
    memoryId: draft.item.id,
    status,
    reasonCodes,
    message: describeDecision(status, reasonCodes)
  };
}

function decisionStatus(
  reasonCodes: MemoryAutomationReasonCode[]
): MemoryAutomationDecision["status"] {
  if (
    reasonCodes.includes("already_approved") &&
    !reasonCodes.includes("duplicate_content")
  ) {
    return "already_approved";
  }
  if (reasonCodes.includes("duplicate_content")) {
    return "duplicate";
  }
  if (reasonCodes.some((reason) => blockingReasonCodes.has(reason))) {
    return "blocked";
  }
  if (reasonCodes.some((reason) => manualReasonCodes.has(reason))) {
    return "manual_only";
  }
  return "eligible";
}

function describeDecision(
  status: MemoryAutomationDecision["status"],
  reasonCodes: MemoryAutomationReasonCode[]
): string {
  if (status === "eligible") {
    return "Eligible under the supplied memory automation policy.";
  }
  return `Decision ${status}: ${reasonCodes.join(", ")}.`;
}

function isPotentiallyEligible(reasonCodes: Set<MemoryAutomationReasonCode>): boolean {
  return (
    ![...reasonCodes].some((reason) => blockingReasonCodes.has(reason)) &&
    ![...reasonCodes].some((reason) => manualReasonCodes.has(reason)) &&
    !reasonCodes.has("duplicate_content") &&
    !reasonCodes.has("already_approved")
  );
}

const blockingReasonCodes = new Set<MemoryAutomationReasonCode>([
  "run_not_succeeded",
  "verification_failed",
  "verification_skipped_not_allowed",
  "risk_too_high",
  "blocking_risk",
  "sensitive_path",
  "unsafe_command",
  "secret_like_content",
  "unsupported_category",
  "review_not_accepted",
  "per_run_limit_exceeded"
]);

const manualReasonCodes = new Set<MemoryAutomationReasonCode>([
  "policy_disabled",
  "manual_only_category"
]);

function summarizeVerification(
  results: VerificationResult[]
): "passed" | "failed" | "skipped" {
  if (results.some((result) => result.status === "failed")) {
    return "failed";
  }
  if (results.some((result) => result.status === "passed")) {
    return "passed";
  }
  return "skipped";
}

function hasSensitivePathRisk(riskReport: RiskReport): boolean {
  return (
    riskReport.changedFiles.some((filePath) =>
      sensitivePathPatterns.some((pattern) => pattern.test(filePath))
    ) ||
    riskReport.findings.some((finding) =>
      /sensitive file path/i.test(`${finding.summary}\n${finding.details ?? ""}`)
    )
  );
}

function hasUnsafeCommandRisk(riskReport: RiskReport): boolean {
  return riskReport.findings.some((finding) =>
    /command detected|privileged command|force push|pipe-to-shell|recursive deletion|git push/i.test(
      `${finding.summary}\n${finding.details ?? ""}`
    )
  );
}

function hasSecretLikeText(value: string): boolean {
  const terms = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((term) => term.toLowerCase())
    .filter((term) => term.length > 0);
  return terms.some((term, index) =>
    sensitiveContentTerms.has(term) ||
    (term === "api" && terms[index + 1] === "key") ||
    (term === "private" && terms[index + 1] === "key")
  );
}

function canonicalMemoryByContent(items: MemoryItem[]): Map<string, MemoryItem> {
  const byContent = new Map<string, MemoryItem>();
  for (const item of [...items].sort(compareMemoryItems)) {
    const normalizedContent = normalizeMemoryContent(item.content);
    const existing = byContent.get(normalizedContent);
    if (!existing || prefersMemoryItem(item, existing)) {
      byContent.set(normalizedContent, item);
    }
  }
  return byContent;
}

function prefersMemoryItem(candidate: MemoryItem, current: MemoryItem): boolean {
  const candidateRank = memoryStatusRank(candidate.status);
  const currentRank = memoryStatusRank(current.status);
  if (candidateRank !== currentRank) {
    return candidateRank > currentRank;
  }
  return compareMemoryItems(candidate, current) < 0;
}

function compareMemoryItems(left: MemoryItem, right: MemoryItem): number {
  if (left.createdAt !== right.createdAt) {
    return left.createdAt.localeCompare(right.createdAt);
  }
  return left.id.localeCompare(right.id);
}

function memoryStatusRank(status: MemoryItem["status"]): number {
  if (status === "approved") {
    return 3;
  }
  if (status === "proposed") {
    return 2;
  }
  return 1;
}

function riskRank(risk: string): number {
  switch (risk) {
    case "low":
      return 1;
    case "medium":
      return 2;
    case "high":
      return 4;
    case "blocking":
      return 5;
    default:
      return 3;
  }
}
