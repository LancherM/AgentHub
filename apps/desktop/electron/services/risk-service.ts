import type {
  ChangedFile,
  DiffSummary,
  RiskCategory,
  RiskFinding,
  RiskReport,
  RiskSeverity,
  VerificationReport
} from "../../src/lib/types";

const LARGE_DIFF_FILE_THRESHOLD = 20;
const LARGE_DIFF_LINE_THRESHOLD = 1_000;

export interface RiskService {
  getRisk(input: {
    runId: string;
    diff: DiffSummary;
    verification: VerificationReport;
    generatedAt: string;
  }): RiskReport;
}

export function createRiskService(): RiskService {
  return new DeterministicRiskService();
}

class DeterministicRiskService implements RiskService {
  getRisk(input: {
    runId: string;
    diff: DiffSummary;
    verification: VerificationReport;
    generatedAt: string;
  }): RiskReport {
    const findings = buildFindings(input.diff, input.verification);
    const level = riskLevel(findings, input.diff, input.verification);
    return {
      runId: input.runId,
      level,
      findings,
      generatedAt: input.generatedAt,
      message:
        findings.length === 0
          ? input.diff.empty
            ? input.diff.message ?? "No diff was available to analyze."
            : "No evidence-based risk findings were detected."
          : undefined
    };
  }
}

function buildFindings(
  diff: DiffSummary,
  verification: VerificationReport
): RiskFinding[] {
  const findings: RiskFinding[] = [];
  const files = diff.files;
  const sourceFiles = files.filter((file) => isSourcePath(file.path));
  const testFiles = files.filter((file) => file.isTest);

  if (diff.empty) {
    return findings;
  }

  for (const file of files) {
    if (isAuthOrSecurityPath(file.path)) {
      addFinding(findings, "high", "Authentication or security file changed", file.path, file.path, "auth");
    }
    if (isPaymentPath(file.path)) {
      addFinding(findings, "high", "Payment or billing file changed", file.path, file.path, "security");
    }
    if (isSensitiveConfigPath(file.path)) {
      addFinding(findings, "high", "Sensitive configuration path changed", file.path, file.path, "config");
    }
    if (file.isMigration || isMigrationPath(file.path)) {
      addFinding(findings, "high", "Database migration changed", file.path, file.path, "migration");
    }
    if (isDependencyLockPath(file.path)) {
      addFinding(findings, "high", "Dependency lockfile changed", file.path, file.path, "dependency");
    }
    if (isShellExecutionPath(file.path)) {
      addFinding(findings, "high", "Shell or process execution code changed", file.path, file.path, "security");
    }
    if (isApiPath(file.path)) {
      addFinding(findings, "medium", "Public API route changed", file.path, file.path, "security");
    }
    if (isDatabaseAccessPath(file.path)) {
      addFinding(findings, "medium", "Database access layer changed", file.path, file.path, "data");
    }
    if (isCiOrBuildConfigPath(file.path)) {
      addFinding(findings, "medium", "CI or build configuration changed", file.path, file.path, "config");
    }
    if (file.isGenerated) {
      addFinding(findings, "medium", "Generated file changed", file.path, file.path, "generated");
    }
    if (isPackageManifestPath(file.path)) {
      addFinding(findings, "medium", "Package manifest changed", file.path, file.path, "dependency");
    }
    if (isErrorHandlingPath(file.path)) {
      addFinding(findings, "medium", "Error handling code changed", file.path, file.path, "unknown");
    }
  }

  if (verification.status === "failed") {
    const failedCommands = verification.commands
      .filter((command) => command.status === "failed")
      .map((command) => `${command.command}${command.exitCode !== undefined ? ` exit ${command.exitCode}` : ""}`)
      .join("; ");
    addFinding(
      findings,
      "high",
      "Verification failed",
      failedCommands || verification.message || "One or more verification commands failed.",
      undefined,
      "test"
    );
  }

  const additions = totalAdditions(files);
  const deletions = totalDeletions(files);
  if (
    files.length > LARGE_DIFF_FILE_THRESHOLD ||
    additions + deletions > LARGE_DIFF_LINE_THRESHOLD
  ) {
    addFinding(
      findings,
      "high",
      "Large diff requires careful review",
      `${files.length} files changed, +${additions}/-${deletions}`,
      undefined,
      "large_change"
    );
  }

  if (sourceFiles.length > 0 && testFiles.length === 0) {
    addFinding(
      findings,
      "medium",
      "Source changed without tests",
      `${sourceFiles.length} source file(s) changed and no test file changes were detected.`,
      undefined,
      "test"
    );
  }

  if (findings.length === 0 && (isDocsOnly(files) || isTestsOnly(files))) {
    return findings;
  }

  return dedupeFindings(findings);
}

function riskLevel(
  findings: RiskFinding[],
  diff: DiffSummary,
  verification: VerificationReport
): RiskReport["level"] {
  if (findings.some((finding) => finding.severity === "high")) {
    return "high";
  }
  if (findings.some((finding) => finding.severity === "medium")) {
    return "medium";
  }
  if (findings.some((finding) => finding.severity === "low")) {
    return "low";
  }
  if (diff.empty) {
    return diff.message?.includes("fake mode") ||
      diff.message === "No real repository files were modified."
      ? "none"
      : "unknown";
  }
  if (verification.status === "unknown") {
    return "unknown";
  }
  return "low";
}

function addFinding(
  findings: RiskFinding[],
  severity: RiskSeverity,
  title: string,
  description: string,
  filePath: string | undefined,
  category: RiskCategory
): void {
  findings.push({
    id: `risk_${findings.length + 1}`,
    severity,
    title,
    description,
    evidence: description,
    filePath,
    category
  });
}

function dedupeFindings(findings: RiskFinding[]): RiskFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = [
      finding.severity,
      finding.title,
      finding.filePath,
      finding.description
    ].join("\0");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  }).map((finding, index) => ({ ...finding, id: `risk_${index + 1}` }));
}

function totalAdditions(files: ChangedFile[]): number {
  return files.reduce((sum, file) => sum + file.additions, 0);
}

function totalDeletions(files: ChangedFile[]): number {
  return files.reduce((sum, file) => sum + file.deletions, 0);
}

function isDocsOnly(files: ChangedFile[]): boolean {
  return files.length > 0 && files.every((file) => isDocsPath(file.path));
}

function isTestsOnly(files: ChangedFile[]): boolean {
  return files.length > 0 && files.every((file) => file.isTest);
}

function isSourcePath(filePath: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|rb|php|cs)$/.test(filePath) &&
    !isDocsPath(filePath) &&
    !isTestPath(filePath);
}

function isDocsPath(filePath: string): boolean {
  return /(^|\/)(docs?|README|CHANGELOG|LICENSE)/i.test(filePath) ||
    /\.(md|mdx|txt|rst)$/.test(filePath);
}

function isTestPath(filePath: string): boolean {
  return /(^|\/)(__tests__|tests?)\//.test(filePath) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(filePath);
}

function isAuthOrSecurityPath(filePath: string): boolean {
  return /(auth|permission|policy|session|token|oauth|security|middleware)/i.test(filePath);
}

function isPaymentPath(filePath: string): boolean {
  return /(billing|payment|invoice|stripe|checkout|subscription)/i.test(filePath);
}

function isSensitiveConfigPath(filePath: string): boolean {
  return /(^|\/)(\.env|\.env\.|secrets?|credentials?|token|id_rsa|id_ed25519)|\.(pem|key)$/i.test(filePath);
}

function isDependencyLockPath(filePath: string): boolean {
  return /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|Cargo\.lock|go\.sum|poetry\.lock)$/.test(filePath);
}

function isMigrationPath(filePath: string): boolean {
  return /(^|\/)(migrations?|schema|db)\//i.test(filePath) || /migration/i.test(filePath);
}

function isShellExecutionPath(filePath: string): boolean {
  return /(child_process|spawn|exec|process-runner|shell-executor|dangerous-commands|git-safety)/i.test(filePath);
}

function isApiPath(filePath: string): boolean {
  return /(^|\/)(api|routes?|controllers?)\//i.test(filePath);
}

function isDatabaseAccessPath(filePath: string): boolean {
  return /(^|\/)(db|database|repositories?|storage|sqlite|prisma|models?)\//i.test(filePath);
}

function isCiOrBuildConfigPath(filePath: string): boolean {
  return /(^|\/)(\.github\/workflows|Dockerfile|docker-compose|vite\.config|electron\.vite\.config|tsconfig|eslint|prettier|vitest\.config)/i.test(filePath);
}

function isPackageManifestPath(filePath: string): boolean {
  return /(^|\/)(package\.json|Cargo\.toml|pyproject\.toml|go\.mod)$/.test(filePath);
}

function isErrorHandlingPath(filePath: string): boolean {
  return /(error|exception|failure|fallback|retry)/i.test(filePath);
}
