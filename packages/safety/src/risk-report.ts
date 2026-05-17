import {
  validateRiskReport,
} from "@agent-hub/core";
import {
  formatShellCommand,
  type JsonObject,
  type DiffCollectionResult,
  type RiskFinding,
  type RiskLevel,
  type RiskReport,
  type VerificationSuiteResult
} from "@agent-hub/shared";
import { SafetyScanner, aggregateRiskLevel, type SafetyFinding } from "./safety";

export interface RiskReportInput {
  id: string;
  taskRunId: string;
  diff: DiffCollectionResult;
  verification: VerificationSuiteResult;
  runEvents?: RiskReportRunEventInput[];
  manualReviewNotes?: string[];
  createdAt: string;
}

export interface RiskReportRunEventInput {
  type?: string;
  message: string;
  metadata?: JsonObject;
}

export class RiskReportGenerator {
  constructor(private readonly safetyScanner = new SafetyScanner()) {}

  generate(input: RiskReportInput): RiskReport {
    const findings: RiskFinding[] = [];
    const riskFactors: string[] = [];
    const changedFiles = input.diff.changedFiles.map((file) => file.path);
    const safety = this.safetyScanner.scan({
      diff: input.diff,
      commands: input.verification.results.map((result) =>
        formatShellCommand(result.command)
      ),
      generatedText: (input.runEvents ?? []).map((event, index) => ({
        label: `run_event_${index + 1}${event.type ? `:${event.type}` : ""}`,
        text: stringifyRunEvent(event)
      }))
    });

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

    for (const finding of safety.findings) {
      addSafetyFinding(findings, riskFactors, finding);
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

function stringifyRunEvent(event: RiskReportRunEventInput): string {
  const metadata =
    event.metadata === undefined ? "" : safeJsonStringify(event.metadata);
  return [event.type ?? "", event.message, metadata]
    .filter((part) => part.trim().length > 0)
    .join("\n");
}

function safeJsonStringify(value: JsonObject): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function addSafetyFinding(
  findings: RiskFinding[],
  riskFactors: string[],
  finding: SafetyFinding
): void {
  findings.push(finding);
  riskFactors.push(
    finding.details ? `${finding.summary} ${finding.details}` : finding.summary
  );
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
  return aggregateRiskLevel(findings);
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
