import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { buildChildProcessEnv } from "@agent-hub/shared";

export interface ProcessRunInput {
  executable: string;
  args?: string[];
  cwd: string;
  stdin?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
}

export type ProcessRunEvent =
  | {
      type: "stdout";
      data: string;
    }
  | {
      type: "stderr";
      data: string;
    }
  | {
      type: "error";
      error: Error;
    }
  | {
      type: "exit";
      exitCode: number | null;
      signal: NodeJS.Signals | string | null;
    };

export interface ProcessDetectionInput {
  executable: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
}

export interface ProcessDetectionResult {
  available: boolean;
  version?: string;
  reason?: string;
}

export interface ProcessRunner {
  run(input: ProcessRunInput): AsyncIterable<ProcessRunEvent>;
  detect(input: ProcessDetectionInput): Promise<ProcessDetectionResult>;
}

export interface SpawnedProcess {
  stdout?: Readable | null;
  stderr?: Readable | null;
  stdin?: Writable | null;
  on(event: "error", listener: (error: Error) => void): this;
  on(
    event: "close",
    listener: (code: number | null, signal: NodeJS.Signals | string | null) => void
  ): this;
  kill(signal?: NodeJS.Signals | string | number): boolean;
}

export type ProcessSpawner = (
  executable: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    shell: false;
    stdio: ["pipe", "pipe", "pipe"];
  }
) => SpawnedProcess;

export class NodeProcessRunner implements ProcessRunner {
  constructor(private readonly spawner: ProcessSpawner = spawnProcess) {}

  async *run(input: ProcessRunInput): AsyncIterable<ProcessRunEvent> {
    validateProcessInput(input);
    const queue = new AsyncEventQueue<ProcessRunEvent>();
    const args = [...(input.args ?? [])];
    let closed = false;
    let timeout: NodeJS.Timeout | undefined;

    const finish = (event: ProcessRunEvent): void => {
      if (closed) {
        return;
      }
      closed = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      queue.push(event);
      queue.close();
    };

    let child: SpawnedProcess;
    try {
      const env = buildProcessRunnerEnv(input.env);
      child = this.spawner(input.executable, args, {
        cwd: path.resolve(input.cwd),
        env,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"]
      });
    } catch (error) {
      queue.push({
        type: "error",
        error: error instanceof Error ? error : new Error(String(error))
      });
      queue.push({ type: "exit", exitCode: 1, signal: null });
      queue.close();
      yield* queue;
      return;
    }

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string | Buffer) => {
      queue.push({ type: "stdout", data: chunk.toString() });
    });
    child.stderr?.on("data", (chunk: string | Buffer) => {
      queue.push({ type: "stderr", data: chunk.toString() });
    });
    child.on("error", (error) => {
      queue.push({ type: "error", error });
      finish({ type: "exit", exitCode: 1, signal: null });
    });
    child.on("close", (exitCode, signal) => {
      finish({ type: "exit", exitCode, signal });
    });

    if (input.timeoutMs !== undefined) {
      timeout = setTimeout(() => {
        child.kill("SIGTERM");
      }, input.timeoutMs);
    }

    if (input.stdin !== undefined) {
      child.stdin?.write(input.stdin);
    }
    child.stdin?.end();

    yield* queue;
  }

  async detect(input: ProcessDetectionInput): Promise<ProcessDetectionResult> {
    const stdout: string[] = [];
    const stderr: string[] = [];
    let errorMessage: string | undefined;
    let exitCode: number | null | undefined;
    let signal: NodeJS.Signals | string | null | undefined;

    for await (const event of this.run({
      executable: input.executable,
      args: input.args,
      cwd: input.cwd ?? process.cwd(),
      env: input.env,
      timeoutMs: input.timeoutMs ?? 5_000
    })) {
      if (event.type === "stdout") {
        stdout.push(event.data);
      } else if (event.type === "stderr") {
        stderr.push(event.data);
      } else if (event.type === "error") {
        errorMessage = event.error.message;
      } else {
        exitCode = event.exitCode;
        signal = event.signal;
      }
    }

    const output = [...stdout, ...stderr].join("").trim();
    if (exitCode === 0) {
      return {
        available: true,
        version: firstLine(output)
      };
    }

    return {
      available: false,
      reason:
        errorMessage ??
        (output ||
          (signal
            ? `process exited by signal ${signal}`
            : `process exited with code ${exitCode ?? "unknown"}`))
    };
  }
}

function buildProcessRunnerEnv(
  overrides?: Record<string, string | undefined>
): NodeJS.ProcessEnv {
  const env = buildChildProcessEnv(overrides);
  if (
    overrides &&
    Object.prototype.hasOwnProperty.call(overrides, "PATH") &&
    overrides.PATH === undefined
  ) {
    delete env.PATH;
    return env;
  }
  const cliLookupPath = buildCliLookupPath(env.PATH, env.HOME);
  if (cliLookupPath) {
    env.PATH = cliLookupPath;
  } else {
    delete env.PATH;
  }
  return env;
}

function buildCliLookupPath(
  inheritedPath: string | undefined,
  homeDirectory: string | undefined
): string {
  const existingPaths = splitPath(inheritedPath);
  const candidates = [
    process.env.NVM_BIN,
    process.env.PNPM_HOME,
    process.env.VOLTA_HOME ? path.join(process.env.VOLTA_HOME, "bin") : undefined,
    homeDirectory ? path.join(homeDirectory, ".local", "bin") : undefined,
    homeDirectory ? path.join(homeDirectory, "bin") : undefined,
    ...findNvmNodeBinPaths(homeDirectory),
    "/opt/homebrew/bin",
    "/usr/local/bin"
  ];
  return [...existingPaths, ...dedupeExistingPaths(candidates, existingPaths)].join(
    path.delimiter
  );
}

function splitPath(value: string | undefined): string[] {
  return (value ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function dedupeExistingPaths(
  candidates: Array<string | undefined>,
  existingPaths: string[]
): string[] {
  const seen = new Set(existingPaths.map(normalizePathForDedupe));
  const result: string[] = [];
  for (const candidate of candidates) {
    if (!candidate || !fs.existsSync(candidate)) {
      continue;
    }
    const normalized = normalizePathForDedupe(candidate);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(candidate);
  }
  return result;
}

function findNvmNodeBinPaths(homeDirectory: string | undefined): string[] {
  if (!homeDirectory) {
    return [];
  }
  const versionsDirectory = path.join(homeDirectory, ".nvm", "versions", "node");
  let versionNames: string[];
  try {
    versionNames = fs.readdirSync(versionsDirectory);
  } catch {
    return [];
  }
  return versionNames
    .filter((versionName) => versionName.startsWith("v"))
    .sort(compareNodeVersionNames)
    .map((versionName) => path.join(versionsDirectory, versionName, "bin"));
}

function compareNodeVersionNames(left: string, right: string): number {
  const leftParts = parseNodeVersionName(left);
  const rightParts = parseNodeVersionName(right);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const diff = (rightParts[index] ?? 0) - (leftParts[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return left.localeCompare(right);
}

function parseNodeVersionName(versionName: string): number[] {
  return versionName
    .replace(/^v/, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function normalizePathForDedupe(candidate: string): string {
  return path.resolve(candidate);
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<() => void> = [];
  private done = false;

  push(value: T): void {
    if (this.done) {
      return;
    }
    this.values.push(value);
    this.wake();
  }

  close(): void {
    this.done = true;
    this.wake();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (!this.done || this.values.length > 0) {
      const value = this.values.shift();
      if (value !== undefined) {
        yield value;
        continue;
      }
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
      });
    }
  }

  private wake(): void {
    for (const waiter of this.waiters.splice(0)) {
      waiter();
    }
  }
}

function validateProcessInput(input: ProcessRunInput): void {
  if (!input.executable.trim()) {
    throw new Error("process executable is required");
  }
  if (input.args !== undefined && !Array.isArray(input.args)) {
    throw new Error("process args must be an array");
  }
  if (!path.isAbsolute(input.cwd)) {
    throw new Error("process cwd must be an absolute path");
  }
}

function firstLine(output: string): string | undefined {
  return output.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim();
}

const spawnProcess: ProcessSpawner = (executable, args, options) =>
  spawn(executable, args, options) as SpawnedProcess;
