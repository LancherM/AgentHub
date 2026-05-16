import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentRunEvent } from "./agent-adapters";
import { FakeAgentAdapter, isPathInside } from "./agent-adapters";
import { parseAgentPrompt } from "./agent-parser";
import {
  DefaultContextCompiler,
  MarkdownContextFormatter,
  type ContextBundle,
  type ContextCompiler,
  type ContextCompilerInput,
  type ContextFormatter,
  type TargetRepositoryMetadata
} from "./context-compiler";
import {
  createId,
  nowIso,
  validateTask,
  validateTaskBrief,
  validateTaskRun,
  type AgentKind,
  type Task,
  type TaskBrief,
  type TaskRun
} from "./domain";
import {
  DefaultAgentRegistry,
  InMemoryTaskRepository,
  InMemoryTaskRunRepository,
  type AgentRegistry,
  type RunStatus,
  type RunStatusTransition,
  type TaskRepository,
  type TaskRunRepository
} from "./storage";

export interface IdGenerator {
  nextId(prefix: string): string;
}

export interface Clock {
  now(): string;
}

export interface RunTaskInput {
  projectRoot: string;
  rawPrompt?: string;
  taskPrompt?: string;
  agentKind?: AgentKind;
  taskId?: string;
  projectId?: string;
  title?: string;
  runRoot?: string;
  targetRepository?: Partial<TargetRepositoryMetadata>;
  userConstraints?: string[];
  executionHints?: string[];
}

export interface RunResult {
  ok: boolean;
  task: Task;
  run: TaskRun;
  events: AgentRunEvent[];
  status: RunStatus;
  contextBundle: ContextBundle;
  contextMarkdown: string;
  worktreePath?: string;
  taskBriefPath?: string;
  fakeOutput?: string;
  warnings: string[];
  error?: string;
  statusTransitions: RunStatusTransition[];
}

export type TaskRunResult = RunResult;

export interface TaskRunnerDependencies {
  contextCompiler?: ContextCompiler;
  contextFormatter?: ContextFormatter;
  taskRepository?: TaskRepository;
  taskRunRepository?: TaskRunRepository;
  agentRegistry?: AgentRegistry;
  idGenerator?: IdGenerator;
  clock?: Clock;
  defaultRunRoot?: string;
}

export class TaskRunnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskRunnerError";
  }
}

export class DefaultIdGenerator implements IdGenerator {
  nextId(prefix: string): string {
    return createId(prefix);
  }
}

export class SystemClock implements Clock {
  now(): string {
    return nowIso();
  }
}

export class SequenceIdGenerator implements IdGenerator {
  private next = 1;

  nextId(prefix: string): string {
    const id = `${prefix}_${String(this.next).padStart(4, "0")}`;
    this.next += 1;
    return id;
  }
}

export class FixedClock implements Clock {
  constructor(private readonly fixedNow: string) {}

  now(): string {
    return this.fixedNow;
  }
}

export class TaskRunner {
  readonly taskRepository: TaskRepository;
  readonly taskRunRepository: TaskRunRepository;
  private readonly contextCompiler: ContextCompiler;
  private readonly contextFormatter: ContextFormatter;
  private readonly agentRegistry: AgentRegistry;
  private readonly idGenerator: IdGenerator;
  private readonly clock: Clock;
  private readonly defaultRunRoot: string;

  constructor(dependencies: TaskRunnerDependencies = {}) {
    this.contextCompiler = dependencies.contextCompiler ?? new DefaultContextCompiler();
    this.contextFormatter = dependencies.contextFormatter ?? new MarkdownContextFormatter();
    this.taskRepository =
      dependencies.taskRepository ?? new InMemoryTaskRepository();
    this.taskRunRepository =
      dependencies.taskRunRepository ?? new InMemoryTaskRunRepository();
    this.agentRegistry =
      dependencies.agentRegistry ??
      new DefaultAgentRegistry([new FakeAgentAdapter()]);
    this.idGenerator = dependencies.idGenerator ?? new DefaultIdGenerator();
    this.clock = dependencies.clock ?? new SystemClock();
    this.defaultRunRoot =
      dependencies.defaultRunRoot ?? path.join(os.tmpdir(), "agent-hub-runs");
  }

  async run(input: RunTaskInput): Promise<RunResult> {
    const parsed = parseRunInput(input);
    const projectRoot = path.resolve(input.projectRoot);
    const createdAt = this.clock.now();
    const task = validateTask({
      id: input.taskId ?? this.idGenerator.nextId("task"),
      projectId: input.projectId ?? "adhoc_project",
      title: input.title ?? titleFromPrompt(parsed.taskPrompt),
      description: parsed.taskPrompt,
      status: "open",
      createdAt,
      updatedAt: createdAt
    });
    await this.taskRepository.create(task);
    await this.taskRepository.updateStatus(task.id, "running", this.clock.now());

    const contextBundle = await this.contextCompiler.compile({
      taskPrompt: parsed.taskPrompt,
      selectedAgentId: parsed.agentKind,
      targetRepository: targetRepository(projectRoot, input.targetRepository),
      userConstraints: input.userConstraints,
      executionHints: input.executionHints
    });
    const contextMarkdown = this.contextFormatter.format(contextBundle);

    const run = validateTaskRun({
      id: this.idGenerator.nextId("run"),
      taskId: task.id,
      agentKind: parsed.agentKind,
      status: "queued",
      createdAt,
      updatedAt: createdAt
    });
    await this.taskRunRepository.create(run);

    const adapter = this.agentRegistry.get(parsed.agentKind);
    if (!adapter) {
      const message = `agent ${parsed.agentKind} is not registered`;
      const failedRun = await this.taskRunRepository.updateStatus(
        run.id,
        "failed",
        this.clock.now()
      );
      const failedTask = await this.taskRepository.updateStatus(
        task.id,
        "open",
        this.clock.now()
      );
      return this.result({
        ok: false,
        task: failedTask,
        run: failedRun,
        events: [{ type: "error", message }],
        status: "failed",
        contextBundle,
        contextMarkdown,
        warnings: [...contextBundle.warnings],
        error: message
      });
    }

    const runRoot = path.resolve(input.runRoot ?? this.defaultRunRoot);
    if (samePath(projectRoot, runRoot) || isPathInside(runRoot, projectRoot)) {
      throw new TaskRunnerError("run root must be outside the original project root");
    }

    const worktreePath = await createRunDirectory(
      runRoot,
      task.id,
      parsed.agentKind,
      this.idGenerator
    );
    await this.taskRunRepository.updateExecutionPaths(
      run.id,
      { worktreePath },
      this.clock.now()
    );
    const runtimeDirectory = path.join(worktreePath, ".agent-hub", "tasks", task.id);
    await fs.mkdir(runtimeDirectory, { recursive: true });

    const taskBrief = createTaskBrief(
      { ...task, status: "running" },
      contextMarkdown
    );
    const taskBriefPath = path.join(runtimeDirectory, "brief.md");
    await fs.writeFile(taskBriefPath, taskBrief.renderedContent, "utf8");

    await this.taskRunRepository.updateStatus(run.id, "running", this.clock.now());

    const events: AgentRunEvent[] = [];
    try {
      for await (const event of adapter.run({
        originalProjectRoot: projectRoot,
        worktreePath,
        taskBriefPath,
        contextBundle,
        contextMarkdown,
        runtimeDirectory,
        taskId: task.id,
        taskTitle: task.title,
        taskPrompt: parsed.taskPrompt
      })) {
        events.push(event);
      }
    } catch (error) {
      events.push({
        type: "error",
        message: error instanceof Error ? error.message : String(error)
      });
    }

    const exitEvent = findLastExitEvent(events);
    const status: RunStatus =
      exitEvent?.type === "exit" && exitEvent.exitCode === 0 ? "succeeded" : "failed";
    const completedAt = this.clock.now();
    const updatedRun = await this.taskRunRepository.updateStatus(
      run.id,
      status,
      completedAt
    );
    const updatedTask = await this.taskRepository.updateStatus(
      task.id,
      status === "succeeded" ? "completed" : "open",
      completedAt
    );
    const fakeOutput = extractFakeOutput(events);
    const errorEvent = events.find((event) => event.type === "error");

    return this.result({
      ok: status === "succeeded",
      task: updatedTask,
      run: updatedRun,
      events,
      status,
      contextBundle,
      contextMarkdown,
      worktreePath,
      taskBriefPath,
      fakeOutput,
      warnings: [...contextBundle.warnings],
      error: status === "failed" ? errorEvent?.message ?? "adapter failed" : undefined
    });
  }

  private async result(
    result: Omit<RunResult, "statusTransitions">
  ): Promise<RunResult> {
    return {
      ...result,
      statusTransitions: await this.taskRunRepository.getStatusTransitions(
        result.run.id
      )
    };
  }
}

export async function runTask(input: RunTaskInput): Promise<RunResult> {
  return new TaskRunner().run(input);
}

export function createTaskBrief(task: Task, contextMarkdown = ""): TaskBrief {
  const createdAt = nowIso();
  const renderedContent = [
    "# Agent Hub Task Brief",
    "",
    `Task ID: ${task.id}`,
    `Title: ${task.title}`,
    "",
    "## Prompt",
    "",
    task.description ?? task.title,
    "",
    "## Context",
    "",
    contextMarkdown || "No project context is available."
  ].join("\n");

  return validateTaskBrief({
    taskId: task.id,
    taskTitle: task.title,
    taskPrompt: task.description,
    renderedContent,
    contextPackId: "context_bundle",
    createdAt
  });
}

function parseRunInput(input: RunTaskInput): { agentKind: AgentKind; taskPrompt: string } {
  if (input.rawPrompt !== undefined) {
    const parsed = parseAgentPrompt(input.rawPrompt);
    return { agentKind: parsed.agentKind, taskPrompt: parsed.prompt };
  }

  if (!input.taskPrompt) {
    throw new TaskRunnerError("task prompt is required");
  }

  return {
    agentKind: input.agentKind ?? "fake",
    taskPrompt: input.taskPrompt
  };
}

async function createRunDirectory(
  runRoot: string,
  taskId: string,
  agentKind: AgentKind,
  idGenerator: IdGenerator
): Promise<string> {
  await fs.mkdir(runRoot, { recursive: true });
  const runDirectory = path.join(
    runRoot,
    `${sanitizeSegment(taskId)}-${sanitizeSegment(agentKind)}-${sanitizeSegment(
      idGenerator.nextId("work")
    )}`
  );
  await fs.mkdir(runDirectory, { recursive: false });
  return runDirectory;
}

function targetRepository(
  projectRoot: string,
  overrides: Partial<TargetRepositoryMetadata> = {}
): TargetRepositoryMetadata {
  return {
    id: overrides.id ?? `repo_${sanitizeSegment(path.basename(projectRoot))}`,
    name: overrides.name ?? path.basename(projectRoot),
    rootPath: overrides.rootPath ?? projectRoot
  };
}

function titleFromPrompt(prompt: string): string {
  const compact = prompt.replace(/\s+/g, " ").trim();
  if (compact.length === 0) {
    throw new TaskRunnerError("task prompt is required");
  }

  return compact.length <= 80 ? compact : `${compact.slice(0, 77)}...`;
}

function sanitizeSegment(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized.length > 0 ? sanitized : "run";
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

function findLastExitEvent(events: AgentRunEvent[]): AgentRunEvent | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].type === "exit") {
      return events[index];
    }
  }

  return undefined;
}

function extractFakeOutput(events: AgentRunEvent[]): string | undefined {
  for (const event of events) {
    if (event.type === "exit" && typeof event.metadata?.output === "string") {
      return event.metadata.output;
    }
  }

  return undefined;
}
