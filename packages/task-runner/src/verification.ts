import path from "node:path";
import {
  assertSafeShellCommand,
  formatShellCommand,
  type ShellCommand,
  type ShellExecutor,
  type ShellResult
} from "./shell-executor";
import type { VerificationStatus } from "@agent-hub/core";

export interface VerificationCommand {
  id: string;
  label?: string;
  command: string;
  args?: string[];
  timeoutMs?: number;
  continueOnFailure?: boolean;
}

export interface VerificationRunInput {
  cwd: string;
  commands?: VerificationCommand[];
  stopOnFailure?: boolean;
  dryRun?: boolean;
}

export interface VerificationCommandResult {
  commandId: string;
  label: string;
  command: ShellCommand;
  status: VerificationStatus;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal?: NodeJS.Signals | string | null;
  durationMs: number;
  timedOut: boolean;
  dryRun: boolean;
  skippedReason?: string;
  error?: string;
}

export interface VerificationSuiteResult {
  status: VerificationStatus;
  results: VerificationCommandResult[];
  failedCommands: VerificationCommandResult[];
  missingCommandConfig: boolean;
  summary: string;
  durationMs: number;
}

export const DEFAULT_VERIFICATION_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

export class VerificationRunner {
  constructor(private readonly shellExecutor: ShellExecutor) {}

  async run(input: VerificationRunInput): Promise<VerificationSuiteResult> {
    if (!path.isAbsolute(input.cwd)) {
      throw new Error("verification cwd must be absolute");
    }

    const commands = input.commands ?? [];
    const startedAt = Date.now();
    if (commands.length === 0) {
      return {
        status: "skipped",
        results: [],
        failedCommands: [],
        missingCommandConfig: true,
        summary: "No verification commands were configured.",
        durationMs: 0
      };
    }

    const results: VerificationCommandResult[] = [];
    let stoppedAfterFailure = false;

    for (const command of commands) {
      if (stoppedAfterFailure) {
        results.push(skippedResult(command, "Skipped after an earlier failure."));
        continue;
      }

      const shellCommand = toShellCommand(command);
      let result: VerificationCommandResult;
      try {
        assertSafeShellCommand(shellCommand);
        const shellResult = await this.shellExecutor.execute(shellCommand, {
          cwd: input.cwd,
          timeoutMs: command.timeoutMs ?? DEFAULT_VERIFICATION_COMMAND_TIMEOUT_MS,
          dryRun: input.dryRun
        });
        result = toVerificationResult(command, shellResult, input.dryRun ?? false);
      } catch (error) {
        result = failedVerificationResult(command, shellCommand, error);
      }
      results.push(result);

      if (result.status === "failed" && shouldStopOnFailure(command, input)) {
        stoppedAfterFailure = true;
      }
    }

    const failedCommands = results.filter((result) => result.status === "failed");
    const status = suiteStatus(results);
    return {
      status,
      results,
      failedCommands,
      missingCommandConfig: false,
      summary: verificationSummary(results),
      durationMs: Date.now() - startedAt
    };
  }
}

function toShellCommand(command: VerificationCommand): ShellCommand {
  return {
    executable: command.command,
    args: [...(command.args ?? [])],
    displayName: command.label ?? command.id
  };
}

function toVerificationResult(
  command: VerificationCommand,
  shellResult: ShellResult,
  dryRun: boolean
): VerificationCommandResult {
  return {
    commandId: command.id,
    label: command.label ?? command.id,
    command: shellResult.command,
    status: dryRun ? "skipped" : shellResult.exitCode === 0 ? "passed" : "failed",
    stdout: shellResult.stdout,
    stderr: shellResult.stderr,
    exitCode: shellResult.exitCode,
    signal: shellResult.signal,
    durationMs: shellResult.durationMs,
    timedOut: shellResult.timedOut,
    dryRun: shellResult.dryRun,
    skippedReason: dryRun ? "Dry-run mode did not execute this command." : undefined,
    error: shellResult.error
  };
}

function failedVerificationResult(
  command: VerificationCommand,
  shellCommand: ShellCommand,
  error: unknown
): VerificationCommandResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    commandId: command.id,
    label: command.label ?? command.id,
    command: shellCommand,
    status: "failed",
    stdout: "",
    stderr: message,
    exitCode: null,
    signal: null,
    durationMs: 0,
    timedOut: false,
    dryRun: false,
    error: message
  };
}

function skippedResult(
  command: VerificationCommand,
  skippedReason: string
): VerificationCommandResult {
  const shellCommand = toShellCommand(command);
  return {
    commandId: command.id,
    label: command.label ?? command.id,
    command: shellCommand,
    status: "skipped",
    stdout: "",
    stderr: "",
    exitCode: null,
    durationMs: 0,
    timedOut: false,
    dryRun: false,
    skippedReason
  };
}

function shouldStopOnFailure(
  command: VerificationCommand,
  input: VerificationRunInput
): boolean {
  if (command.continueOnFailure === true) {
    return false;
  }
  return input.stopOnFailure ?? false;
}

function suiteStatus(results: VerificationCommandResult[]): VerificationStatus {
  if (results.some((result) => result.status === "failed")) {
    return "failed";
  }
  if (results.length === 0 || results.every((result) => result.status === "skipped")) {
    return "skipped";
  }
  return "passed";
}

function verificationSummary(results: VerificationCommandResult[]): string {
  const passed = results.filter((result) => result.status === "passed").length;
  const failed = results.filter((result) => result.status === "failed").length;
  const skipped = results.filter((result) => result.status === "skipped").length;
  return `${passed} passed, ${failed} failed, ${skipped} skipped`;
}

export function formatVerificationCommand(command: VerificationCommand): string {
  return formatShellCommand(toShellCommand(command));
}
