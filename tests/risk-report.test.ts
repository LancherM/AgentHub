import { describe, expect, it } from "vitest";
import type { DiffCollectionResult } from "../src/diff-collector";
import { RiskReportGenerator } from "../src/risk-report";
import type { VerificationCommandResult, VerificationSuiteResult } from "../src/verification";

describe("RiskReportGenerator", () => {
  it("reports low risk for a clean diff", () => {
    const report = generate({
      diff: diff({ changedFiles: [], isClean: true }),
      verification: verification({ status: "passed", summary: "1 passed, 0 failed, 0 skipped" })
    });

    expect(report.level).toBe("low");
    expect(report.changedFiles).toEqual([]);
    expect(report.summary).toContain("no code changes");
  });

  it("reports high risk for failed verification", () => {
    const failed = commandResult("test", "failed");
    const report = generate({
      diff: diff({ changedFiles: ["src/app.ts"] }),
      verification: verification({
        status: "failed",
        summary: "0 passed, 1 failed, 0 skipped",
        failedCommands: [failed],
        results: [failed]
      })
    });

    expect(report.level).toBe("high");
    expect(report.failedChecks).toEqual(["test"]);
    expect(report.riskFactors.join("\n")).toContain("verification commands failed");
  });

  it("reports medium risk for lockfile and config changes", () => {
    const report = generate({
      diff: diff({ changedFiles: ["pnpm-lock.yaml", "tsconfig.json"] }),
      verification: verification({ status: "passed", summary: "2 passed, 0 failed, 0 skipped" })
    });

    expect(report.level).toBe("medium");
    expect(report.riskFactors.join("\n")).toContain("Configuration or lockfile");
  });

  it("reports high risk for a large diff", () => {
    const report = generate({
      diff: diff({
        changedFiles: Array.from({ length: 30 }, (_, index) => `src/file-${index}.ts`),
        insertions: 900,
        deletions: 200
      }),
      verification: verification({ status: "passed", summary: "1 passed, 0 failed, 0 skipped" })
    });

    expect(report.level).toBe("high");
    expect(report.riskFactors.join("\n")).toContain("Large diff size");
  });

  it("classifies untested changes as medium risk", () => {
    const report = generate({
      diff: diff({ changedFiles: ["src/app.ts"] }),
      verification: verification({
        status: "skipped",
        missingCommandConfig: true,
        summary: "No verification commands were configured."
      })
    });

    expect(report.level).toBe("medium");
    expect(report.acceptanceRecommendation).toContain("reviewing");
  });
});

function generate(input: {
  diff: DiffCollectionResult;
  verification: VerificationSuiteResult;
}) {
  return new RiskReportGenerator().generate({
    id: "risk_1",
    taskRunId: "run_1",
    diff: input.diff,
    verification: input.verification,
    createdAt: "2026-01-01T00:00:00.000Z"
  });
}

function diff(input: {
  changedFiles: string[];
  isClean?: boolean;
  insertions?: number;
  deletions?: number;
}): DiffCollectionResult {
  return {
    ok: true,
    workspacePath: "/tmp/workspace",
    isClean: input.isClean ?? input.changedFiles.length === 0,
    changedFiles: input.changedFiles.map((filePath) => ({
      path: filePath,
      status: "modified"
    })),
    stat: {
      filesChanged: input.changedFiles.length,
      insertions: input.insertions ?? 10,
      deletions: input.deletions ?? 1,
      text: ""
    },
    diff: "",
    fileSummaries: [],
    commands: []
  };
}

function verification(input: {
  status: VerificationSuiteResult["status"];
  summary: string;
  failedCommands?: VerificationCommandResult[];
  results?: VerificationCommandResult[];
  missingCommandConfig?: boolean;
}): VerificationSuiteResult {
  return {
    status: input.status,
    summary: input.summary,
    failedCommands: input.failedCommands ?? [],
    results: input.results ?? [],
    missingCommandConfig: input.missingCommandConfig ?? false,
    durationMs: 1
  };
}

function commandResult(
  id: string,
  status: VerificationCommandResult["status"]
): VerificationCommandResult {
  return {
    commandId: id,
    label: id,
    command: { executable: "pnpm", args: [id] },
    status,
    stdout: "",
    stderr: status === "failed" ? "failed\n" : "",
    exitCode: status === "failed" ? 1 : 0,
    durationMs: 1,
    timedOut: false,
    dryRun: false
  };
}
