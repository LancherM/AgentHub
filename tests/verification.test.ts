import { describe, expect, it } from "vitest";
import { VerificationRunner } from "../src/verification";
import { createTestDirectory, MockShellExecutor } from "./helpers";

describe("VerificationRunner", () => {
  it("records successful verification commands", async () => {
    const cwd = await createTestDirectory("verify-success");
    const runner = new VerificationRunner(
      new MockShellExecutor([{ stdout: "ok\n", exitCode: 0 }])
    );

    const result = await runner.run({
      cwd,
      commands: [{ id: "test", command: "pnpm", args: ["test"] }]
    });

    expect(result.status).toBe("passed");
    expect(result.summary).toBe("1 passed, 0 failed, 0 skipped");
    expect(result.results[0]).toMatchObject({
      commandId: "test",
      status: "passed",
      stdout: "ok\n"
    });
  });

  it("records failed verification commands", async () => {
    const cwd = await createTestDirectory("verify-failure");
    const runner = new VerificationRunner(
      new MockShellExecutor([{ stderr: "failed\n", exitCode: 1 }])
    );

    const result = await runner.run({
      cwd,
      commands: [{ id: "test", command: "pnpm", args: ["test"] }]
    });

    expect(result.status).toBe("failed");
    expect(result.failedCommands).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      status: "failed",
      stderr: "failed\n"
    });
  });

  it("supports mixed verification results and stop-on-failure", async () => {
    const cwd = await createTestDirectory("verify-mixed");
    const runner = new VerificationRunner(
      new MockShellExecutor([{ exitCode: 0 }, { exitCode: 1, stderr: "bad\n" }])
    );

    const result = await runner.run({
      cwd,
      stopOnFailure: true,
      commands: [
        { id: "lint", command: "pnpm", args: ["lint"] },
        { id: "test", command: "pnpm", args: ["test"] },
        { id: "build", command: "pnpm", args: ["build"] }
      ]
    });

    expect(result.status).toBe("failed");
    expect(result.results.map((entry) => entry.status)).toEqual([
      "passed",
      "failed",
      "skipped"
    ]);
  });

  it("marks dry-run verification as skipped", async () => {
    const cwd = await createTestDirectory("verify-dry-run");
    const shell = new MockShellExecutor();
    const runner = new VerificationRunner(shell);

    const result = await runner.run({
      cwd,
      dryRun: true,
      commands: [{ id: "typecheck", command: "pnpm", args: ["typecheck"] }]
    });

    expect(result.status).toBe("skipped");
    expect(result.results[0]).toMatchObject({
      status: "skipped",
      dryRun: true
    });
    expect(shell.calls[0].options.dryRun).toBe(true);
  });

  it("reports missing command configuration", async () => {
    const cwd = await createTestDirectory("verify-missing");
    const runner = new VerificationRunner(new MockShellExecutor());

    const result = await runner.run({ cwd });

    expect(result.status).toBe("skipped");
    expect(result.missingCommandConfig).toBe(true);
    expect(result.summary).toContain("No verification commands");
  });
});
