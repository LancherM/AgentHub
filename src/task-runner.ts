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
import { DiffCollector, type DiffCollectionResult, type DiffCollectorService } from "./diff-collector";
import {
  createId,
  nowIso,
  validateTask,
  validateTaskBrief,
  validateTaskRun,
  type AgentKind,
  type RiskReport,
  type Task,
  type TaskBrief,
  type TaskRun
} from "./domain";
import { RiskReportGenerator } from "./risk-report";
import { NodeShellExecutor, type ShellExecutor } from "./shell-executor";
import {
  DefaultAgentRegistry,
  InMemoryRunMetadataRepository,
  InMemoryTaskRepository,
  InMemoryTaskRunRepository,
  type AgentRegistry,
  type RunMetadataRepository,
  type RunStatus,
  type RunStatusTransition,
  type TaskRepository,
  type TaskRunRepository
} from "./storage";
import { VerificationRunner, type VerificationCommand, type VerificationSuiteResult } from "./verification";
import {
  GitWorktreeWorkspaceManager,
  type WorkspaceCleanupPolicy,
  type WorkspaceCleanupResult,
  type WorkspaceManager
} from "./workspace";

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
  workspaceBasePath?: string;
  workspaceCleanupPolicy?: WorkspaceCleanupPolicy;
  dryRun?: boolean;
  verificationCommands?: VerificationCommand[];
  stopOnVerificationFailure?: boolean;
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
  diff?: DiffCollectionResult;
  verification?: VerificationSuiteResult;
  riskReport?: RiskReport;
  workspaceCleanup?: WorkspaceCleanupResult;
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
  runMetadataRepository?: RunMetadataRepository;
  agentRegistry?: AgentRegistry;
  shellExecutor?: ShellExecutor;
  workspaceManager?: WorkspaceManager;
  diffCollector?: DiffCollectorService;
  verificationRunner?: VerificationRunner;
  riskReportGenerator?: RiskReportGenerator;
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
  readonly runMetadataRepository: RunMetadataRepository;
  private readonly contextCompiler: ContextCompiler;
  private readonly contextFormatter: ContextFormatter;
  private readonly agentRegistry: AgentRegistry;
  private readonly workspaceManager: WorkspaceManager;
  private readonly diffCollector: DiffCollectorService;
  private readonly verificationRunner: VerificationRunner;
  private readonly riskReportGenerator: RiskReportGenerator;
  private readonly idGenerator: IdGenerator;
  private readonly clock: Clock;
  private readonly defaultRunRoot: string;

  constructor(dependencies: TaskRunnerDependencies = {}) {
    const shellExecutor = dependencies.shellExecutor ?? new NodeShellExecutor();
    this.contextCompiler = dependencies.contextCompiler ?? new DefaultContextCompiler();
    this.contextFormatter = dependencies.contextFormatter ?? new MarkdownContextFormatter();
    this.taskRepository =
      dependencies.taskRepository ?? new InMemoryTaskRepository();
    this.taskRunRepository =
      dependencies.taskRunRepository ?? new InMemoryTaskRunRepository();
    this.runMetadataRepository =
      dependencies.runMetadataRepository ?? new InMemoryRunMetadataRepository();
    this.agentRegistry =
      dependencies.agentRegistry ??
      new DefaultAgentRegistry([new FakeAgentAdapter()]);
    this.workspaceManager =
      dependencies.workspaceManager ?? new GitWorktreeWorkspaceManager(shellExecutor);
    this.diffCollector = dependencies.diffCollector ?? new DiffCollector(shellExecutor);
    this.verificationRunner =
      dependencies.verificationRunner ?? new VerificationRunner(shellExecutor);
    this.riskReportGenerator =
      dependencies.riskReportGenerator ?? new RiskReportGenerator();
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

    const workspaceBasePath = path.resolve(
      input.workspaceBasePath ?? input.runRoot ?? this.defaultRunRoot
    );
    if (
      samePath(projectRoot, workspaceBasePath) ||
      isPathInside(workspaceBasePath, projectRoot)
    ) {
      throw new TaskRunnerError(
        "workspace base path must be outside the original project root"
      );
    }

    let workspaceSession:
      | Awaited<ReturnType<WorkspaceManager["createSession"]>>
      | undefined;
    let workspaceCleanup: WorkspaceCleanupResult | undefined;

    try {
      workspaceSession = await this.workspaceManager.createSession({
        sourceRepositoryPath: projectRoot,
        workspaceBasePath,
        taskId: task.id,
        runId: run.id,
        agentKind: parsed.agentKind,
        cleanupPolicy: input.workspaceCleanupPolicy ?? "always",
        dryRun: input.dryRun
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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

    const worktreePath = workspaceSession.workspace.path;
    const updatedRunWithPaths = await this.taskRunRepository.updateExecutionPaths(
      run.id,
      {
        worktreePath,
        branchName: workspaceSession.workspace.branchName
      },
      this.clock.now()
    );
    await this.runMetadataRepository.save({
      runId: run.id,
      workspace: workspaceSession.workspace
    });

    let taskBriefPath: string | undefined;
    const runtimeDirectory = path.join(worktreePath, ".agent-hub", "tasks", task.id);
    const events: AgentRunEvent[] = [];

    await this.taskRunRepository.updateStatus(run.id, "running", this.clock.now());

    if (input.dryRun) {
      events.push({
        type: "status",
        message: "dry-run mode skipped fake adapter execution"
      });
      events.push({
        type: "exit",
        message: "dry-run completed",
        exitCode: 0
      });
    } else {
      await fs.mkdir(runtimeDirectory, { recursive: true });
      const taskBrief = createTaskBrief(
        { ...task, status: "running" },
        contextMarkdown
      );
      taskBriefPath = path.join(runtimeDirectory, "brief.md");
      await fs.writeFile(taskBriefPath, taskBrief.renderedContent, "utf8");

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
    }

    const diff = await this.diffCollector.collect({
      workspacePath: worktreePath,
      excludePathPrefixes: [".agent-hub/"],
      dryRun: input.dryRun
    });
    const verification = await this.verificationRunner.run({
      cwd: worktreePath,
      commands: input.verificationCommands,
      stopOnFailure: input.stopOnVerificationFailure,
      dryRun: input.dryRun
    });
    const riskReport = this.riskReportGenerator.generate({
      id: this.idGenerator.nextId("risk"),
      taskRunId: run.id,
      diff,
      verification,
      createdAt: this.clock.now()
    });

    const exitEvent = findLastExitEvent(events);
    const adapterSucceeded =
      exitEvent?.type === "exit" && exitEvent.exitCode === 0;
    const status: RunStatus =
      adapterSucceeded && diff.ok && verification.status !== "failed"
        ? "succeeded"
        : "failed";
    const completedAt = this.clock.now();
    const updatedRun = await this.taskRunRepository.updateStatus(
      updatedRunWithPaths.id,
      status,
      completedAt
    );
    const updatedTask = await this.taskRepository.updateStatus(
      task.id,
      status === "succeeded" ? "completed" : "open",
      completedAt
    );

    try {
      workspaceCleanup = await workspaceSession.cleanup({
        successful: status === "succeeded"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      events.push({ type: "error", message: `workspace cleanup failed: ${message}` });
      workspaceCleanup = {
        cleaned: false,
        retained: true,
        reason: `workspace cleanup failed: ${message}`,
        commands: []
      };
    }

    await this.runMetadataRepository.save({
      runId: run.id,
      workspace: workspaceSession.workspace,
      workspaceCleanup,
      diff,
      verification,
      riskReport
    });

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
      diff,
      verification,
      riskReport,
      workspaceCleanup,
      warnings: [...contextBundle.warnings],
      error:
        status === "failed"
          ? errorEvent?.message ??
            diff.error ??
            verification.failedCommands[0]?.stderr ??
            "run failed"
          : undefined
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
