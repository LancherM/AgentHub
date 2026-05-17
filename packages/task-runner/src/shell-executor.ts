import { spawn } from "node:child_process";
import path from "node:path";
import {
  detectDangerousCommandText,
  shellCommandSearchText
} from "@agent-hub/safety";
import {
  buildChildProcessEnv,
  formatShellCommand,
  type ShellCommand,
  type ShellResult
} from "@agent-hub/shared";

export interface ShellExecutionOptions {
  cwd: string;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
  dryRun?: boolean;
}

export { formatShellCommand };
export type { ShellCommand, ShellResult };

export interface ShellExecutor {
  execute(command: ShellCommand, options: ShellExecutionOptions): Promise<ShellResult>;
}

export interface SpawnedShellProcess {
  stdout?: NodeJS.ReadableStream | null;
  stderr?: NodeJS.ReadableStream | null;
  on(event: "error", listener: (error: Error) => void): this;
  on(
    event: "close",
    listener: (code: number | null, signal: NodeJS.Signals | string | null) => void
  ): this;
  kill(signal?: NodeJS.Signals | string | number): boolean;
}

export type ShellSpawner = (
  executable: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    shell: false;
    stdio: ["ignore", "pipe", "pipe"];
  }
) => SpawnedShellProcess;

export class ShellExecutorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShellExecutorError";
  }
}

export class NodeShellExecutor implements ShellExecutor {
  constructor(private readonly spawner: ShellSpawner = spawnShellProcess) {}

  async execute(
    command: ShellCommand,
    options: ShellExecutionOptions
  ): Promise<ShellResult> {
    validateShellCommand(command, options);
    const cwd = path.resolve(options.cwd);
    const start = Date.now();

    if (options.dryRun) {
      return {
        command: normalizeCommand(command),
        cwd,
        stdout: "",
        stderr: "",
        exitCode: 0,
        durationMs: 0,
        timedOut: false,
        dryRun: true
      };
    }

    return new Promise<ShellResult>((resolve) => {
      const child = this.spawner(command.executable, command.args ?? [], {
        cwd,
        env: buildChildProcessEnv(options.env),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;
      const timeout =
        options.timeoutMs !== undefined
          ? setTimeout(() => {
              timedOut = true;
              child.kill("SIGTERM");
            }, options.timeoutMs)
          : undefined;

      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr?.on("data", (chunk: string) => {
        stderr += chunk;
      });

      child.on("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeout) {
          clearTimeout(timeout);
        }
        resolve({
          command: normalizeCommand(command),
          cwd,
          stdout,
          stderr,
          exitCode: null,
          signal: null,
          durationMs: Date.now() - start,
          timedOut,
          dryRun: false,
          error: error.message
        });
      });

      child.on("close", (code, signal) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeout) {
          clearTimeout(timeout);
        }
        resolve({
          command: normalizeCommand(command),
          cwd,
          stdout,
          stderr,
          exitCode: code,
          signal,
          durationMs: Date.now() - start,
          timedOut,
          dryRun: false,
          error: signal ? `terminated by ${signal}` : undefined
        });
      });
    });
  }
}

export function isDangerousShellCommand(command: ShellCommand): boolean {
  return (
    detectDangerousCommandText(
      shellCommandSearchText(command.executable, command.args ?? [])
    ).length > 0
  );
}

export function assertSafeShellCommand(command: ShellCommand): void {
  if (isDangerousShellCommand(command)) {
    throw new ShellExecutorError(
      `refusing to execute dangerous command: ${formatShellCommand(command)}`
    );
  }
}

function validateShellCommand(
  command: ShellCommand,
  options: ShellExecutionOptions
): void {
  if (typeof command.executable !== "string" || command.executable.trim() === "") {
    throw new ShellExecutorError("shell command executable is required");
  }
  if (command.args !== undefined && !Array.isArray(command.args)) {
    throw new ShellExecutorError("shell command args must be an array");
  }
  if (!options.cwd || !path.isAbsolute(options.cwd)) {
    throw new ShellExecutorError("shell execution cwd must be an absolute path");
  }
  assertSafeShellCommand(command);
}

function normalizeCommand(command: ShellCommand): ShellCommand {
  return {
    executable: command.executable,
    args: [...(command.args ?? [])],
    displayName: command.displayName
  };
}

const spawnShellProcess: ShellSpawner = (executable, args, options) =>
  spawn(executable, args, options) as SpawnedShellProcess;
