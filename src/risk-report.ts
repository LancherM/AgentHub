import {
  validateRiskReport,
  type RiskFinding,
  type RiskLevel,
  type RiskReport
} from "./domain";
import type { DiffCollectionResult } from "./diff-collector";
import type { VerificationSuiteResult } from "./verification";

export interface RiskReportInput {
  id: string;
  taskRunId: string;
  diff: DiffCollectionResult;
  verification: VerificationSuiteResult;
  manualReviewNotes?: string[];
  createdAt: string;
}

export class RiskReportGenerator {
  generate(input: RiskReportInput): RiskReport {
    const findings: RiskFinding[] = [];
    const riskFactors: string[] = [];
    const changedFiles = input.diff.changedFiles.map((file) => file.path);

    if (!input.diff.ok) {
      addFinding(
        findings,
        riskFactors,
        "high",
        "Git diff collection failed.",
        input.diff.error
      );
    }

    if (input.diff.isClean) {
      addFinding(findings, riskFactors, "low", "No changed files were collected.");
    }

    if (input.verification.status === "failed") {
      addFinding(
        findings,
        riskFactors,
        "high",
        "One or more verification commands failed.",
        input.verification.failedCommands
          .map((result) => `${result.label}: exit ${result.exitCode ?? "unknown"}`)
          .join("; ")
      );
    }

    if (
      input.verification.missingCommandConfig ||
      input.verification.status === "skipped"
    ) {
      const level: RiskLevel = changedFiles.length > 0 ? "medium" : "low";
      addFinding(
        findings,
        riskFactors,
        level,
        "Verification commands were not run.",
        input.verification.summary
      );
    }

    const riskyFiles = changedFiles.filter(isRiskyFile);
    if (riskyFiles.length > 0) {
      addFinding(
        findings,
        riskFactors,
        "high",
        "Potentially sensitive or high-risk files changed.",
        riskyFiles.join(", ")
      );
    }

    const configFiles = changedFiles.filter(isConfigOrLockfile);
    if (configFiles.length > 0) {
      addFinding(
        findings,
        riskFactors,
        "medium",
        "Configuration or lockfile changes need extra review.",
        configFiles.join(", ")
      );
    }

    const totalLineChanges = input.diff.stat.insertions + input.diff.stat.deletions;
    if (input.diff.stat.filesChanged >= 25 || totalLineChanges >= 1000) {
      addFinding(
        findings,
        riskFactors,
        "high",
        "Large diff size increases review risk.",
        `${input.diff.stat.filesChanged} files, ${input.diff.stat.insertions} insertions, ${input.diff.stat.deletions} deletions`
      );
    }

    for (const note of input.manualReviewNotes ?? []) {
      addFinding(findings, riskFactors, "medium", "Manual review note.", note);
    }

    const level = classifyRisk(findings);
    return validateRiskReport({
      id: input.id,
      taskRunId: input.taskRunId,
      level,
      summary: summaryFor(level, changedFiles.length, input.verification.summary),
      changedFiles,
      verificationSummary: input.verification.summary,
      failedChecks: input.verification.failedCommands.map((result) => result.label),
      riskFactors,
      manualReviewChecklist: checklistFor(level, changedFiles.length),
      acceptanceRecommendation: recommendationFor(level),
      findings,
      createdAt: input.createdAt
    });
  }
}

function addFinding(
  findings: RiskFinding[],
  riskFactors: string[],
  level: RiskLevel,
  summary: string,
  details?: string
): void {
  findings.push({ level, summary, details });
  riskFactors.push(details ? `${summary} ${details}` : summary);
}

function classifyRisk(findings: RiskFinding[]): RiskLevel {
  if (findings.some((finding) => finding.level === "high" || finding.level === "blocking")) {
    return "high";
  }
  if (findings.some((finding) => finding.level === "medium")) {
    return "medium";
  }
  return "low";
}

function summaryFor(
  level: RiskLevel,
  changedFileCount: number,
  verificationSummary: string
): string {
  if (changedFileCount === 0) {
    return `Risk is ${level}: no code changes were collected; ${verificationSummary}.`;
  }
  return `Risk is ${level}: ${changedFileCount} changed file(s); ${verificationSummary}.`;
}

function recommendationFor(level: RiskLevel): string {
  if (level === "high" || level === "blocking") {
    return "Do not accept automatically; manual review is required before accepting this run.";
  }
  if (level === "medium") {
    return "Accept only after reviewing the listed risk factors and confirming verification coverage.";
  }
  return "Accept if the changed files match the task intent.";
}

function checklistFor(level: RiskLevel, changedFileCount: number): string[] {
  const checklist = [
    "Review every changed file against the task prompt.",
    "Confirm no secrets, credentials, or generated runtime files are included.",
    "Confirm verification output matches the reported status."
  ];
  if (changedFileCount === 0) {
    checklist.push("Confirm that a clean diff is expected for this task.");
  }
  if (level !== "low") {
    checklist.push("Inspect each risk factor before accepting the run.");
  }
  return checklist;
}

function isConfigOrLockfile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return (
    lower.endsWith("package.json") ||
    lower.endsWith("pnpm-lock.yaml") ||
    lower.endsWith("package-lock.json") ||
    lower.endsWith("yarn.lock") ||
    lower.endsWith("tsconfig.json") ||
    lower.endsWith("vite.config.ts") ||
    lower.endsWith("vitest.config.ts") ||
    lower.includes("/.github/")
  );
}

function isRiskyFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return [
    ".env",
    ".env.",
    ".pem",
    ".key",
    "id_rsa",
    "id_ed25519",
    "secrets.",
    "credentials.",
    "token."
  ].some((pattern) => lower.includes(pattern));
}
