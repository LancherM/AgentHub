import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ShellCommand,
  ShellExecutionOptions,
  ShellExecutor,
  ShellResult
} from "../src/shell-executor";
import type {
  ProcessDetectionInput,
  ProcessDetectionResult,
  ProcessRunEvent,
  ProcessRunInput,
  ProcessRunner
} from "../src/process-runner";

export async function createTestDirectory(name: string): Promise<string> {
  const directory = path.join(
    process.cwd(),
    ".tmp",
    "tests",
    `${name}-${randomUUID()}`
  );
  await fs.mkdir(directory, { recursive: true });
  return directory;
}

export class MockShellExecutor implements ShellExecutor {
  readonly calls: Array<{ command: ShellCommand; options: ShellExecutionOptions }> = [];

  constructor(
    private readonly responses: Array<
      Partial<ShellResult> | ((command: ShellCommand, options: ShellExecutionOptions) => Partial<ShellResult>)
    > = []
  ) {}

  async execute(
    command: ShellCommand,
    options: ShellExecutionOptions
  ): Promise<ShellResult> {
    this.calls.push({ command, options });
    const next = this.responses.shift();
    const partial =
      typeof next === "function" ? next(command, options) : next ?? {};
    return shellResult(command, options, partial);
  }
}

export class MockProcessRunner implements ProcessRunner {
  readonly runCalls: ProcessRunInput[] = [];
  readonly detectCalls: ProcessDetectionInput[] = [];

  constructor(
    private readonly runResponses: Array<
      ProcessRunEvent[] | ((input: ProcessRunInput) => ProcessRunEvent[])
    > = [],
    private readonly detectResponses: Array<
      Partial<ProcessDetectionResult> |
        ((input: ProcessDetectionInput) => Partial<ProcessDetectionResult>)
    > = []
  ) {}

  async *run(input: ProcessRunInput): AsyncIterable<ProcessRunEvent> {
    this.runCalls.push(input);
    const next = this.runResponses.shift();
    const events = typeof next === "function" ? next(input) : next ?? [
      { type: "exit", exitCode: 0, signal: null }
    ];
    for (const event of events) {
      yield event;
    }
  }

  async detect(input: ProcessDetectionInput): Promise<ProcessDetectionResult> {
    this.detectCalls.push(input);
    const next = this.detectResponses.shift();
    const partial = typeof next === "function" ? next(input) : next ?? {};
    return {
      available: true,
      version: "mock",
      ...partial
    };
  }
}

export function shellResult(
  command: ShellCommand,
  options: ShellExecutionOptions,
  partial: Partial<ShellResult> = {}
): ShellResult {
  return {
    command,
    cwd: options.cwd,
    stdout: "",
    stderr: "",
    exitCode: 0,
    durationMs: 1,
    timedOut: false,
    dryRun: options.dryRun ?? false,
    ...partial
  };
}
