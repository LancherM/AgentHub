import type { RiskFinding, RiskLevel } from "./domain";
import type { ChangedFile, DiffCollectionResult } from "./diff-collector";
import { detectDangerousCommandText } from "./dangerous-commands";

export type SafetyFindingCategory =
  | "sensitive_path"
  | "dangerous_command"
  | "diff"
  | "large_deletion"
  | "binary";

export interface SafetyFinding extends RiskFinding {
  category: SafetyFindingCategory;
  path?: string;
  command?: string;
}

export interface SafetyScanInput {
  diff: DiffCollectionResult;
  commands?: string[];
  generatedText?: SafetyTextSource[];
}

export type SafetyTextSource =
  | string
  | {
      label: string;
      text: string;
    };

export interface SafetyScanResult {
  level: RiskLevel;
  findings: SafetyFinding[];
}

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

export class SafetyScanner {
  scan(input: SafetyScanInput): SafetyScanResult {
    const findings = [
      ...scanSensitivePaths(input.diff.changedFiles),
      ...scanDangerousCommands(
        input.diff.diff,
        input.commands ?? [],
        input.generatedText ?? []
      ),
      ...scanDiff(input.diff),
      ...scanLargeDeletions(input.diff),
      ...scanBinaryFiles(input.diff.changedFiles)
    ];
    return {
      findings,
      level: aggregateRiskLevel(findings)
    };
  }
}

export function scanSensitivePaths(changedFiles: ChangedFile[]): SafetyFinding[] {
  return changedFiles
    .filter((file) => sensitivePathPatterns.some((pattern) => pattern.test(file.path)))
    .map((file) => ({
      level: "blocking",
      category: "sensitive_path",
      path: file.path,
      summary: "Sensitive file path changed.",
      details: file.path
    }));
}

export function scanDangerousCommands(
  diffText: string,
  commands: string[] = [],
  generatedText: SafetyTextSource[] = []
): SafetyFinding[] {
  const haystacks = [
    { label: "diff", text: diffText },
    ...commands.map((command) => ({ label: "command", text: command })),
    ...generatedText.map((source, index) =>
      typeof source === "string"
        ? { label: `generated_text_${index + 1}`, text: source }
        : source
    )
  ].filter((entry) => entry.text.trim().length > 0);
  const findings: SafetyFinding[] = [];

  for (const source of haystacks) {
    for (const match of detectDangerousCommandText(source.text)) {
      findings.push({
        level: "blocking",
        category: "dangerous_command",
        command: match.command,
        summary: match.summary,
        details: `${source.label}: ${match.command}`
      });
    }
  }

  return findings;
}

export function scanDiff(diff: DiffCollectionResult): SafetyFinding[] {
  const findings: SafetyFinding[] = [];
  const configFiles = diff.changedFiles.filter((file) => isConfigOrLockfile(file.path));
  if (configFiles.length > 0) {
    findings.push({
      level: "medium",
      category: "diff",
      summary: "Configuration or lockfile changes need extra review.",
      details: configFiles.map((file) => file.path).join(", ")
    });
  }

  const deletedFiles = diff.changedFiles.filter((file) => file.status === "deleted");
  if (deletedFiles.length > 0) {
    findings.push({
      level: deletedFiles.length >= 10 ? "high" : "medium",
      category: "diff",
      summary: "Deleted files need review.",
      details: deletedFiles.map((file) => file.path).join(", ")
    });
  }

  if (diff.stat.filesChanged >= 25) {
    findings.push({
      level: "high",
      category: "diff",
      summary: "Large diff size increases review risk.",
      details: `${diff.stat.filesChanged} files, ${diff.stat.insertions} insertions, ${diff.stat.deletions} deletions`
    });
  }

  return findings;
}

export function scanLargeDeletions(diff: DiffCollectionResult): SafetyFinding[] {
  if (diff.stat.deletions >= 500) {
    return [
      {
        level: "high",
        category: "large_deletion",
        summary: "Large deletion volume detected.",
        details: `${diff.stat.deletions} deleted lines`
      }
    ];
  }
  if (diff.stat.deletions >= 100 && diff.stat.deletions > diff.stat.insertions * 5) {
    return [
      {
        level: "high",
        category: "large_deletion",
        summary: "Deletion-heavy diff detected.",
        details: `${diff.stat.insertions} insertions, ${diff.stat.deletions} deletions`
      }
    ];
  }
  return [];
}

export function scanBinaryFiles(changedFiles: ChangedFile[]): SafetyFinding[] {
  return changedFiles
    .filter((file) => file.binary)
    .map((file) => ({
      level: "medium",
      category: "binary",
      path: file.path,
      summary: "Binary file changed.",
      details:
        file.sizeBytes === undefined
          ? file.path
          : `${file.path} (${file.sizeBytes} bytes)`
    }));
}

export function aggregateRiskLevel(findings: Array<Pick<RiskFinding, "level">>): RiskLevel {
  if (findings.some((finding) => finding.level === "blocking")) {
    return "blocking";
  }
  if (findings.some((finding) => finding.level === "high")) {
    return "high";
  }
  if (findings.some((finding) => finding.level === "medium")) {
    return "medium";
  }
  return "low";
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
