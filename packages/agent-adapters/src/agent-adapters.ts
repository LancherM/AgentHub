import fs from "node:fs/promises";
import path from "node:path";
import type {
  AgentKind,
  ChildEnvironmentOverrides,
  ContextBundle,
  JsonObject
} from "@agent-hub/shared";
import { NodeProcessRunner, type ProcessRunner } from "./process-runner";

export interface AgentDetectionResult {
  available: boolean;
  version?: string;
  reason?: string;
}

export interface AgentRunInput {
  originalProjectRoot: string;
  worktreePath: string;
  taskBriefPath: string;
  contextPackPath?: string;
  runtimeDirectory?: string;
  taskId: string;
  taskTitle: string;
  taskPrompt: string;
  contextBundle?: ContextBundle;
  contextMarkdown?: string;
  environment?: ChildEnvironmentOverrides;
}

export type AgentRunEvent =
  | {
      type: "stdout" | "stderr" | "message" | "status" | "error";
      message: string;
      metadata?: JsonObject;
    }
  | {
      type: "exit";
      message: string;
      exitCode: number;
      signal?: NodeJS.Signals | string | null;
      metadata?: JsonObject;
    };

export interface AgentAdapter {
  kind: AgentKind;
  displayName: string;
  detect(): Promise<AgentDetectionResult>;
  run(input: AgentRunInput): AsyncIterable<AgentRunEvent>;
}

export interface AgentRegistry {
  get(agentKind: AgentKind): AgentAdapter | undefined;
  list(): AgentAdapter[];
}

export class DefaultAgentRegistry implements AgentRegistry {
  private readonly adapters = new Map<AgentKind, AgentAdapter>();

  constructor(adapters: AgentAdapter[] = []) {
    for (const adapter of adapters) {
      this.adapters.set(adapter.kind, adapter);
    }
  }

  get(agentKind: AgentKind): AgentAdapter | undefined {
    return this.adapters.get(agentKind);
  }

  list(): AgentAdapter[] {
    return [...this.adapters.values()].sort((left, right) =>
      left.kind.localeCompare(right.kind)
    );
  }
}

export interface FakeAgentAdapterOptions {
  fail?: boolean;
  failureMessage?: string;
}

export interface ProcessAgentAdapterOptions {
  executable?: string;
  detectArgs?: string[];
  runArgs?: string[];
  processRunner?: ProcessRunner;
  detectTimeoutMs?: number;
  runTimeoutMs?: number;
}

export class FakeAgentAdapter implements AgentAdapter {
  readonly kind = "fake";
  readonly displayName = "Fake Agent";

  constructor(private readonly options: FakeAgentAdapterOptions = {}) {}

  async detect(): Promise<AgentDetectionResult> {
    return {
      available: true,
      version: "fake"
    };
  }

  async *run(input: AgentRunInput): AsyncIterable<AgentRunEvent> {
    if (this.options.fail) {
      yield* failureEvents(
        this.options.failureMessage ?? "FakeAgentAdapter configured failure."
      );
      return;
    }

    const originalProjectRoot = path.resolve(input.originalProjectRoot);
    const worktreePath = path.resolve(input.worktreePath);
    const taskBriefPath = path.resolve(input.taskBriefPath);

    if (samePath(originalProjectRoot, worktreePath)) {
      yield* failureEvents(
        "FakeAgentAdapter refused to run in the original project root."
      );
      return;
    }

    if (!isPathInside(taskBriefPath, worktreePath)) {
      yield* failureEvents(
        "FakeAgentAdapter refused a task brief outside the isolated run directory."
      );
      return;
    }

    try {
      const worktreeStat = await fs.stat(worktreePath);
      if (!worktreeStat.isDirectory()) {
        yield* failureEvents("FakeAgentAdapter worktree path is not a directory.");
        return;
      }
    } catch {
      yield* failureEvents("FakeAgentAdapter worktree path does not exist.");
      return;
    }

    let taskBrief: string;
    try {
      taskBrief = await fs.readFile(taskBriefPath, "utf8");
    } catch {
      yield* failureEvents("FakeAgentAdapter task brief is missing or unreadable.");
      return;
    }

    const outputPath = path.join(worktreePath, "fake-agent-output.md");
    const output = [
      "# Fake Agent Output",
      "",
      `task_id: ${input.taskId}`,
      `title: ${input.taskTitle}`,
      `context_bundle_id: ${input.contextBundle?.id ?? "none"}`,
      `context_sections: ${input.contextBundle?.sections.length ?? 0}`,
      `brief_characters: ${taskBrief.length}`,
      "",
      "## Prompt",
      "",
      input.taskPrompt,
      "",
      "## Context",
      "",
      input.contextMarkdown?.trim() ?? "No context payload was provided."
    ].join("\n");

    await fs.writeFile(outputPath, `${output}\n`, "utf8");

    yield {
      type: "stdout",
      message: `fake agent wrote ${path.basename(outputPath)}`
    };
    yield {
      type: "exit",
      message: "fake agent completed",
      exitCode: 0,
      metadata: { outputPath, output }
    };
  }
}

export class CodexAdapter implements AgentAdapter {
  readonly kind = "codex";
  readonly displayName = "Codex";
  private readonly executable: string;
  private readonly detectArgs: string[];
  private readonly runArgs: string[];
  private readonly processRunner: ProcessRunner;
  private readonly detectTimeoutMs: number;
  private readonly runTimeoutMs: number | undefined;

  constructor(options: ProcessAgentAdapterOptions = {}) {
    this.executable = options.executable ?? "codex";
    this.detectArgs = options.detectArgs ?? ["--version"];
    this.runArgs = options.runArgs ?? ["exec", "--json", "-"];
    assertSafeAdapterArgs(this.kind, this.runArgs);
    this.processRunner = options.processRunner ?? new NodeProcessRunner();
    this.detectTimeoutMs = options.detectTimeoutMs ?? 5_000;
    this.runTimeoutMs = options.runTimeoutMs;
  }

  async detect(): Promise<AgentDetectionResult> {
    return detectProcessAgent({
      displayName: this.displayName,
      executable: this.executable,
      args: this.detectArgs,
      processRunner: this.processRunner,
      timeoutMs: this.detectTimeoutMs
    });
  }

  async *run(input: AgentRunInput): AsyncIterable<AgentRunEvent> {
    yield* runProcessAgentWithPreflight({
      adapterKind: this.kind,
      displayName: this.displayName,
      executable: this.executable,
      args: this.runArgs,
      detect: (runInput) =>
        detectProcessAgent({
          displayName: this.displayName,
          executable: this.executable,
          args: this.detectArgs,
          processRunner: this.processRunner,
          timeoutMs: this.detectTimeoutMs,
          cwd: path.resolve(runInput.worktreePath),
          env: runInput.environment
        }),
      processRunner: this.processRunner,
      input,
      timeoutMs: this.runTimeoutMs
    });
  }
}

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly kind = "claude-code";
  readonly displayName = "Claude Code";
  private readonly executable: string;
  private readonly detectArgs: string[];
  private readonly runArgs: string[];
  private readonly processRunner: ProcessRunner;
  private readonly detectTimeoutMs: number;
  private readonly runTimeoutMs: number | undefined;

  constructor(options: ProcessAgentAdapterOptions = {}) {
    this.executable = options.executable ?? "claude";
    this.detectArgs = options.detectArgs ?? ["--version"];
    this.runArgs = options.runArgs ?? ["--print", "--output-format", "stream-json"];
    assertSafeAdapterArgs(this.kind, this.runArgs);
    this.processRunner = options.processRunner ?? new NodeProcessRunner();
    this.detectTimeoutMs = options.detectTimeoutMs ?? 5_000;
    this.runTimeoutMs = options.runTimeoutMs;
  }

  async detect(): Promise<AgentDetectionResult> {
    return detectProcessAgent({
      displayName: this.displayName,
      executable: this.executable,
      args: this.detectArgs,
      processRunner: this.processRunner,
      timeoutMs: this.detectTimeoutMs
    });
  }

  async *run(input: AgentRunInput): AsyncIterable<AgentRunEvent> {
    yield* runProcessAgentWithPreflight({
      adapterKind: this.kind,
      displayName: this.displayName,
      executable: this.executable,
      args: this.runArgs,
      detect: (runInput) =>
        detectProcessAgent({
          displayName: this.displayName,
          executable: this.executable,
          args: this.detectArgs,
          processRunner: this.processRunner,
          timeoutMs: this.detectTimeoutMs,
          cwd: path.resolve(runInput.worktreePath),
          env: runInput.environment
        }),
      processRunner: this.processRunner,
      input,
      timeoutMs: this.runTimeoutMs
    });
  }
}

export function isPathInside(candidatePath: string, parentPath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

function* failureEvents(
  message: string,
  metadata: JsonObject = { error: message }
): Iterable<AgentRunEvent> {
  yield {
    type: "error",
    message,
    metadata
  };
  yield {
    type: "exit",
    message,
    exitCode: 1,
    metadata
  };
}

async function detectProcessAgent(input: {
  displayName: string;
  executable: string;
  args: string[];
  processRunner: ProcessRunner;
  timeoutMs: number;
  cwd?: string;
  env?: Record<string, string | undefined>;
}): Promise<AgentDetectionResult> {
  try {
    const result = await input.processRunner.detect({
      executable: input.executable,
      args: input.args,
      cwd: input.cwd ?? process.cwd(),
      env: input.env,
      timeoutMs: input.timeoutMs
    });
    if (result.available) {
      return {
        available: true,
        version: result.version
      };
    }
    return {
      available: false,
      reason: `${input.displayName} CLI unavailable: ${result.reason ?? "not found or not authenticated"}`
    };
  } catch (error) {
    return {
      available: false,
      reason: `${input.displayName} CLI detection failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    };
  }
}

async function* runProcessAgentWithPreflight(input: {
  adapterKind: AgentKind;
  displayName: string;
  executable: string;
  args: string[];
  detect: (input: AgentRunInput) => Promise<AgentDetectionResult>;
  processRunner: ProcessRunner;
  input: AgentRunInput;
  timeoutMs?: number;
}): AsyncIterable<AgentRunEvent> {
  const validation = await validateProcessAgentInput(input.input);
  if (!validation.ok) {
    yield* failureEvents(validation.message);
    return;
  }

  let detection: AgentDetectionResult;
  try {
    detection = await input.detect(input.input);
  } catch (error) {
    detection = {
      available: false,
      reason: `${input.displayName} CLI detection failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    };
  }

  if (!detection.available) {
    yield* failureEvents(
      `${input.displayName} preflight failed: ${
        detection.reason ?? "CLI unavailable or not configured"
      }`,
      {
        adapter: input.adapterKind,
        detection
      }
    );
    return;
  }

  yield {
    type: "status",
    message: `${input.displayName} preflight passed`,
    metadata: {
      adapter: input.adapterKind,
      version: detection.version ?? null
    }
  };

  yield* runProcessAgent(input);
}

async function* runProcessAgent(input: {
  adapterKind: AgentKind;
  displayName: string;
  executable: string;
  args: string[];
  processRunner: ProcessRunner;
  input: AgentRunInput;
  timeoutMs?: number;
}): AsyncIterable<AgentRunEvent> {
  const validation = await validateProcessAgentInput(input.input);
  if (!validation.ok) {
    yield* failureEvents(validation.message);
    return;
  }

  const parser = new StructuredOutputParser(input.displayName);
  const stdin = buildRuntimeStdin(input.input, validation.taskBrief);
  yield {
    type: "status",
    message: `starting ${input.displayName}`,
    metadata: {
      executable: input.executable,
      args: input.args,
      cwd: path.resolve(input.input.worktreePath)
    }
  };

  try {
    for await (const event of input.processRunner.run({
      executable: input.executable,
      args: input.args,
      cwd: path.resolve(input.input.worktreePath),
      stdin,
      env: input.input.environment,
      timeoutMs: input.timeoutMs
    })) {
      if (event.type === "stdout") {
        yield { type: "stdout", message: event.data };
        for (const parsedEvent of parser.push(event.data)) {
          yield parsedEvent;
        }
        continue;
      }
      if (event.type === "stderr") {
        yield { type: "stderr", message: event.data };
        continue;
      }
      if (event.type === "error") {
        yield {
          type: "error",
          message: event.error.message,
          metadata: { error: event.error.message }
        };
        continue;
      }
      for (const parsedEvent of parser.flush()) {
        yield parsedEvent;
      }
      const exitCode = event.exitCode ?? 1;
      yield {
        type: "exit",
        message:
          event.signal !== null && event.signal !== undefined
            ? `${input.displayName} exited by signal ${event.signal}`
            : `${input.displayName} exited with code ${exitCode}`,
        exitCode,
        signal: event.signal,
        metadata: {
          exitCode,
          signal: event.signal ?? null,
          adapter: input.adapterKind
        }
      };
    }
  } catch (error) {
    yield* failureEvents(
      `${input.displayName} process failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

async function validateProcessAgentInput(
  input: AgentRunInput
): Promise<{ ok: true; taskBrief: string } | { ok: false; message: string }> {
  const originalProjectRoot = path.resolve(input.originalProjectRoot);
  const worktreePath = path.resolve(input.worktreePath);
  const taskBriefPath = path.resolve(input.taskBriefPath);

  if (samePath(originalProjectRoot, worktreePath)) {
    return { ok: false, message: "adapter refused to run in the original project root." };
  }

  if (!isPathInside(taskBriefPath, worktreePath)) {
    return {
      ok: false,
      message: "adapter refused a task brief outside the isolated run directory."
    };
  }

  try {
    const worktreeStat = await fs.stat(worktreePath);
    if (!worktreeStat.isDirectory()) {
      return { ok: false, message: "adapter worktree path is not a directory." };
    }
  } catch {
    return { ok: false, message: "adapter worktree path does not exist." };
  }

  try {
    return { ok: true, taskBrief: await fs.readFile(taskBriefPath, "utf8") };
  } catch {
    return { ok: false, message: "adapter task brief is missing or unreadable." };
  }
}

function buildRuntimeStdin(input: AgentRunInput, taskBrief: string): string {
  return [
    "# Agent Hub Runtime Injection",
    "",
    "Run inside the current isolated worktree. Do not push, merge, or delete branches.",
    "",
    "## Task Brief",
    "",
    taskBrief.trim(),
    "",
    "## Context",
    "",
    input.contextMarkdown?.trim() ?? "No context payload was provided."
  ].join("\n");
}

class StructuredOutputParser {
  private buffer = "";

  constructor(private readonly displayName: string) {}

  push(chunk: string): AgentRunEvent[] {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? "";
    return lines.flatMap((line) => this.parseLine(line));
  }

  flush(): AgentRunEvent[] {
    if (this.buffer.trim().length === 0) {
      this.buffer = "";
      return [];
    }
    const line = this.buffer;
    this.buffer = "";
    return this.parseLine(line);
  }

  private parseLine(line: string): AgentRunEvent[] {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return [];
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return [];
    }

    const adapterEvent = parsed as JsonObject;
    const type = String(
      adapterEvent.type ?? adapterEvent.event ?? adapterEvent.kind ?? "event"
    );
    const structuredOutput = structuredMessage(adapterEvent);
    const message = structuredOutput ?? `${this.displayName} ${type}`;
    const metadata = { adapterEvent };

    if (/error|failed|failure/i.test(type)) {
      return [{ type: "error", message, metadata }];
    }
    if (isStructuredMessageEvent(adapterEvent, type, structuredOutput)) {
      return [{ type: "message", message, metadata }];
    }
    return [{ type: "status", message, metadata }];
  }
}

function isStructuredMessageEvent(
  event: JsonObject,
  type: string,
  structuredOutput: string | undefined
): boolean {
  if (structuredOutput === undefined) {
    return /message|assistant|agent|result|output_text/i.test(type);
  }
  if (/message|assistant|agent|result|output_text/i.test(type)) {
    return true;
  }
  return isAssistantMessageItem(event.item);
}

function structuredMessage(event: JsonObject): string | undefined {
  for (const key of ["message", "content", "text", "summary", "result", "item", "delta"]) {
    const value = event[key];
    const text = structuredTextFromValue(value);
    if (text !== undefined) {
      return text;
    }
  }
  return undefined;
}

function isAssistantMessageItem(value: JsonObject[string]): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const item = value as JsonObject;
  return item.type === "message" && item.role === "assistant";
}

function structuredTextFromValue(value: JsonObject[string], depth = 0): string | undefined {
  if (depth > 4 || value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => structuredTextFromValue(entry as JsonObject[string], depth + 1))
      .filter((entry): entry is string => entry !== undefined);
    return parts.length > 0 ? parts.join("\n") : undefined;
  }
  if (typeof value !== "object") {
    return undefined;
  }

  const nested = value as JsonObject;
  if (typeof nested.type === "string" && /reasoning/i.test(nested.type)) {
    return undefined;
  }
  for (const key of ["text", "message", "content", "result", "summary", "delta", "item"]) {
    const text = structuredTextFromValue(nested[key], depth + 1);
    if (text !== undefined) {
      return text;
    }
  }
  return undefined;
}

function assertSafeAdapterArgs(adapterKind: AgentKind, args: string[]): void {
  const normalized = args.join(" ").toLowerCase();
  const lowerArgs = args.map((arg) => arg.toLowerCase());
  const dangerousFlags = [
    "--dangerously-bypass-approvals-and-sandbox",
    "--dangerously-skip-permissions",
    "--ignore-rules",
    "--bypass-permissions"
  ];
  if (
    dangerousFlags.some((flag) => normalized.includes(flag)) ||
    lowerArgs.some((arg) => arg.startsWith("--sandbox=danger-full-access")) ||
    lowerArgs.some(
      (arg, index) => arg === "--sandbox" && lowerArgs[index + 1] === "danger-full-access"
    ) ||
    lowerArgs.some(
      (arg, index) =>
        (arg === "--permission-mode" || arg === "--permissions") &&
        lowerArgs[index + 1]?.includes("bypass")
    )
  ) {
    throw new Error(`${adapterKind} adapter configuration contains unsafe permission flags`);
  }
}
