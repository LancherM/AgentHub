import {
  validateRiskReport,
} from "@agent-hub/core";
import {
  formatShellCommand,
  type JsonObject,
  type DiffCollectionResult,
  type AnyPlanNode,
  type ExecutionTraceGraph,
  type PlanGraph,
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
  planGraph?: PlanGraph;
  currentPlanNode?: AnyPlanNode;
  executionTrace?: ExecutionTraceGraph;
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

    addPlanAwareFindings(findings, riskFactors, {
      planGraph: input.planGraph,
      currentPlanNode: input.currentPlanNode,
      executionTrace: input.executionTrace,
      verification: input.verification,
      changedFileCount: changedFiles.length
    });

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

function addPlanAwareFindings(
  findings: RiskFinding[],
  riskFactors: string[],
  input: {
    planGraph?: PlanGraph;
    currentPlanNode?: AnyPlanNode;
    executionTrace?: ExecutionTraceGraph;
    verification: VerificationSuiteResult;
    changedFileCount: number;
  }
): void {
  if (input.planGraph) {
    if (input.planGraph.status === "proposed") {
      addFinding(
        findings,
        riskFactors,
        "high",
        "PlanGraph is proposed, not active.",
        `PlanGraph ${input.planGraph.id} must be explicitly activated before acceptance.`
      );
    }
    if (input.changedFileCount > 0 && !hasRequiredVerificationNode(input.planGraph)) {
      addFinding(
        findings,
        riskFactors,
        "medium",
        "PlanGraph is missing a required verification node.",
        `PlanGraph ${input.planGraph.id} changed files without a required verify node.`
      );
    }
    if (
      input.currentPlanNode &&
      !input.planGraph.nodes.some((node) => node.id === input.currentPlanNode?.id)
    ) {
      addFinding(
        findings,
        riskFactors,
        "high",
        "Run is bound to a PlanNode outside the active PlanGraph.",
        `PlanNode ${input.currentPlanNode.id} is not part of ${input.planGraph.id}.`
      );
    }
  }

  if (input.currentPlanNode) {
    if (
      input.currentPlanNode.required &&
      input.verification.status === "failed"
    ) {
      addFinding(
        findings,
        riskFactors,
        "high",
        "Required PlanNode has failed verification evidence.",
        `${input.currentPlanNode.id}: ${input.verification.summary}`
      );
    }
    if (
      input.currentPlanNode.execution.mode !== "primary_run" &&
      input.changedFileCount > 0
    ) {
      addFinding(
        findings,
        riskFactors,
        "high",
        "Non-primary PlanNode produced changed files.",
        `${input.currentPlanNode.id} uses ${input.currentPlanNode.execution.mode}.`
      );
    }
  }

  for (const deviation of input.executionTrace?.deviations ?? []) {
    addFinding(
      findings,
      riskFactors,
      riskLevelForPlanSeverity(deviation.severity),
      `Plan deviation: ${deviation.type}.`,
      deviation.description
    );
  }
}

function hasRequiredVerificationNode(graph: PlanGraph): boolean {
  return graph.nodes.some((node) => node.kind === "verify" && node.required);
}

function riskLevelForPlanSeverity(severity: "low" | "medium" | "high"): RiskLevel {
  return severity;
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
