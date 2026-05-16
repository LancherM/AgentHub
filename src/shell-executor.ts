import { spawn } from "node:child_process";
import path from "node:path";

export interface ShellCommand {
  executable: string;
  args?: string[];
  displayName?: string;
}

export interface ShellExecutionOptions {
  cwd: string;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
  dryRun?: boolean;
}

export interface ShellResult {
  command: ShellCommand;
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  dryRun: boolean;
  error?: string;
}

export interface ShellExecutor {
  execute(command: ShellCommand, options: ShellExecutionOptions): Promise<ShellResult>;
}

export class ShellExecutorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShellExecutorError";
  }
}

export class NodeShellExecutor implements ShellExecutor {
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
      const child = spawn(command.executable, command.args ?? [], {
        cwd,
        env: options.env ? { ...process.env, ...options.env } : process.env,
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
          durationMs: Date.now() - start,
          timedOut,
          dryRun: false,
          error: signal ? `terminated by ${signal}` : undefined
        });
      });
    });
  }
}

export function formatShellCommand(command: ShellCommand): string {
  return [command.executable, ...(command.args ?? [])]
    .map((part) => (/\s/.test(part) ? JSON.stringify(part) : part))
    .join(" ");
}

export function isDangerousShellCommand(command: ShellCommand): boolean {
  const parts = [command.executable, ...(command.args ?? [])];
  const normalized = parts.join(" ").toLowerCase();
  if (path.basename(command.executable) === "sudo") {
    return true;
  }
  return [
    "rm -rf /",
    "chmod -r 777",
    "curl | sh",
    "wget | sh",
    "git push --force",
    "git clean -fdx"
  ].some((pattern) => normalized.includes(pattern));
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
