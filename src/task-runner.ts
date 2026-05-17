import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentRunEvent } from "./agent-adapters";
import {
  ClaudeCodeAdapter,
  CodexAdapter,
  FakeAgentAdapter,
  isPathInside
} from "./agent-adapters";
import { parseAgentPrompt } from "./agent-parser";
import {
  DefaultContextCompiler,
  MarkdownContextFormatter,
  createTaskBrief as createContextTaskBrief,
  materializeWorktreeOverlay,
  type GeneratedFileBaseline,
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
  validateRunArtifact,
  validateRunEvent,
  validateVerificationResult,
  validateTask,
  validateTaskRun,
  type AgentKind,
  type ContextDeliveryMode,
  type ContextPack,
  type JsonObject,
  type RiskReport,
  type RunEvent,
  type Task,
  type TaskBrief,
  type TaskRun,
  type VerificationResult
} from "./domain";
import { RiskReportGenerator } from "./risk-report";
import { NodeProcessRunner, type ProcessRunner } from "./process-runner";
import { formatShellCommand, NodeShellExecutor, type ShellExecutor } from "./shell-executor";
import {
  DefaultAgentRegistry,
  InMemoryRiskReportRepository,
  InMemoryRunArtifactRepository,
  InMemoryRunEventRepository,
  InMemoryRunMetadataRepository,
  InMemoryTaskRepository,
  InMemoryTaskRunRepository,
  InMemoryVerificationResultRepository,
  type AgentRegistry,
  type RiskReportRepository,
  type RunArtifactRepository,
  type RunEventRepository,
  type RunMetadataRepository,
  type RunStatus,
  type RunStatusTransition,
  type TaskRepository,
  type TaskRunRepository,
  type VerificationResultRepository
} from "./storage";
import {
  VerificationRunner,
  type VerificationCommand,
  type VerificationCommandResult,
  type VerificationSuiteResult
} from "./verification";
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
  deliveryMode?: ContextDeliveryMode;
  contextStoreRoot?: string;
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
  runEventRepository?: RunEventRepository;
  runArtifactRepository?: RunArtifactRepository;
  verificationResultRepository?: VerificationResultRepository;
  riskReportRepository?: RiskReportRepository;
  runMetadataRepository?: RunMetadataRepository;
  agentRegistry?: AgentRegistry;
  shellExecutor?: ShellExecutor;
  processRunner?: ProcessRunner;
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
  readonly runEventRepository: RunEventRepository;
  readonly runArtifactRepository: RunArtifactRepository;
  readonly verificationResultRepository: VerificationResultRepository;
  readonly riskReportRepository: RiskReportRepository;
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
    const processRunner = dependencies.processRunner ?? new NodeProcessRunner();
    this.contextCompiler = dependencies.contextCompiler ?? new DefaultContextCompiler();
    this.contextFormatter = dependencies.contextFormatter ?? new MarkdownContextFormatter();
    this.taskRepository =
      dependencies.taskRepository ?? new InMemoryTaskRepository();
    this.taskRunRepository =
      dependencies.taskRunRepository ?? new InMemoryTaskRunRepository();
    this.runEventRepository =
      dependencies.runEventRepository ?? new InMemoryRunEventRepository();
    this.runArtifactRepository =
      dependencies.runArtifactRepository ?? new InMemoryRunArtifactRepository();
    this.verificationResultRepository =
      dependencies.verificationResultRepository ??
      new InMemoryVerificationResultRepository();
    this.riskReportRepository =
      dependencies.riskReportRepository ?? new InMemoryRiskReportRepository();
    this.runMetadataRepository =
      dependencies.runMetadataRepository ?? new InMemoryRunMetadataRepository();
    this.agentRegistry =
      dependencies.agentRegistry ??
      new DefaultAgentRegistry([
        new FakeAgentAdapter(),
        new CodexAdapter({ processRunner }),
        new ClaudeCodeAdapter({ processRunner })
      ]);
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
    let currentTask = await this.taskRepository.get(task.id);
    currentTask ??= await this.taskRepository.create(task);
    currentTask = await this.taskRepository.updateStatus(
      currentTask.id,
      "running",
      this.clock.now()
    );

    const contextBundle = await this.contextCompiler.compile({
      taskPrompt: parsed.taskPrompt,
      selectedAgentId: parsed.agentKind,
      targetRepository: targetRepository(projectRoot, input.targetRepository),
      userConstraints: input.userConstraints,
      executionHints: input.executionHints
    });
    const contextMarkdown = this.contextFormatter.format(contextBundle);
    const contextPack = createRuntimeContextPack(
      contextBundle,
      task.id,
      task.title,
      parsed.taskPrompt,
      input.deliveryMode ?? "runtime_injection"
    );

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
      const events: AgentRunEvent[] = [{ type: "error", message }];
      await this.runEventRepository.createMany(
        toPersistedRunEvents(run.id, events, this.clock, this.idGenerator)
      );
      await this.taskRunRepository.updateStatus(
        run.id,
        "running",
        this.clock.now()
      );
      const failedRun = await this.taskRunRepository.updateStatus(
        run.id,
        "failed",
        this.clock.now()
      );
      return this.result({
        ok: false,
        task: currentTask,
        run: failedRun,
        events,
        status: "failed",
        contextBundle,
        contextMarkdown,
        warnings: [...contextBundle.warnings],
        error: message
      });
    }

    let workspaceSession:
      | Awaited<ReturnType<WorkspaceManager["createSession"]>>
      | undefined;

    try {
      workspaceSession = await this.workspaceManager.createSession({
        sourceRepositoryPath: projectRoot,
        workspaceBasePath,
        taskId: task.id,
        runId: run.id,
        agentKind: parsed.agentKind,
        cleanupPolicy: input.workspaceCleanupPolicy ?? "never",
        dryRun: input.dryRun
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const events: AgentRunEvent[] = [{ type: "error", message }];
      await this.runEventRepository.createMany(
        toPersistedRunEvents(run.id, events, this.clock, this.idGenerator)
      );
      await this.taskRunRepository.updateStatus(
        run.id,
        "running",
        this.clock.now()
      );
      const failedRun = await this.taskRunRepository.updateStatus(
        run.id,
        "failed",
        this.clock.now()
      );
      return this.result({
        ok: false,
        task: currentTask,
        run: failedRun,
        events,
        status: "failed",
        contextBundle,
        contextMarkdown,
        warnings: [...contextBundle.warnings],
        error: message
      });
    }

    const worktreePath = workspaceSession.workspace.path;
    let currentRun = await this.taskRunRepository.updateExecutionPaths(
      run.id,
      {
        worktreePath,
        branchName: workspaceSession.workspace.branchName
      },
      this.clock.now()
    );

    let taskBriefPath: string | undefined;
    const runtimeDirectory = path.join(worktreePath, ".agent-hub", "tasks", task.id);
    const events: AgentRunEvent[] = [];
    const warnings = [...contextBundle.warnings];
    let generatedFileBaselines: GeneratedFileBaseline[] = [];
    let workspaceCleanup: WorkspaceCleanupResult | undefined;
    let diff: DiffCollectionResult = failedDiffResultFromError(
      worktreePath,
      "diff collection did not run"
    );
    let verification: VerificationSuiteResult = failedVerificationSuiteFromError(
      "verification did not run",
      input.verificationCommands
    );
    let riskReport: RiskReport | undefined;
    let finalizationFailed = false;
    let finalizationError: string | undefined;
    const recordDiagnostic = (stage: string, error: unknown): void => {
      const detail = errorMessage(error);
      const message = `${stage} failed: ${detail}`;
      finalizationFailed = true;
      finalizationError ??= message;
      warnings.push(message);
      events.push({
        type: "error",
        message,
        metadata: { stage, error: detail }
      });
    };

    try {
      await this.runMetadataRepository.save({
        runId: run.id,
        workspace: workspaceSession.workspace
      });
    } catch (error) {
      recordDiagnostic("workspace metadata persistence", error);
    }

    currentRun = await this.taskRunRepository.updateStatus(
      run.id,
      "running",
      this.clock.now()
    );

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
      try {
        const taskBrief = createContextTaskBrief({
          taskId: task.id,
          title: task.title,
          prompt: parsed.taskPrompt,
          contextPackId: contextPack.id,
          contextMarkdown
        });
        taskBriefPath = path.join(runtimeDirectory, "brief.md");
        const overlay = await materializeWorktreeOverlay({
          worktreePath,
          taskId: task.id,
          contextPack,
          taskBrief,
          contextMarkdown,
          includeAgentFiles: input.deliveryMode === "worktree_overlay",
          storeRoot:
            input.deliveryMode === "worktree_overlay"
              ? input.contextStoreRoot
              : undefined
        });
        warnings.push(...overlay.warnings);
        generatedFileBaselines = overlay.baselines;
        if (input.deliveryMode !== "worktree_overlay") {
          generatedFileBaselines = overlay.baselines.filter((baseline) =>
            baseline.path.startsWith(".agent-hub/")
          );
        }

        try {
          for await (const event of adapter.run({
            originalProjectRoot: projectRoot,
            worktreePath,
            taskBriefPath,
            contextPackPath: path.join(runtimeDirectory, "context-pack.json"),
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
      } catch (error) {
        recordDiagnostic("runtime context materialization", error);
      }
    }

    try {
      diff = await this.diffCollector.collect({
        workspacePath: worktreePath,
        excludePathPrefixes: [".agent-hub/"],
        generatedFileBaselines,
        dryRun: input.dryRun
      });
    } catch (error) {
      recordDiagnostic("diff collection", error);
      diff = failedDiffResultFromError(worktreePath, error);
    }

    try {
      verification = await this.verificationRunner.run({
        cwd: worktreePath,
        commands: input.verificationCommands,
        stopOnFailure: input.stopOnVerificationFailure,
        dryRun: input.dryRun
      });
    } catch (error) {
      recordDiagnostic("verification", error);
      verification = failedVerificationSuiteFromError(
        error,
        input.verificationCommands
      );
    }

    try {
      riskReport = this.riskReportGenerator.generate({
        id: this.idGenerator.nextId("risk"),
        taskRunId: run.id,
        diff,
        verification,
        runEvents: events,
        createdAt: this.clock.now()
      });
    } catch (error) {
      recordDiagnostic("risk report generation", error);
    }

    const exitEvent = findLastExitEvent(events);
    const adapterSucceeded =
      exitEvent?.type === "exit" && exitEvent.exitCode === 0;
    let status: RunStatus =
      adapterSucceeded &&
      diff.ok &&
      verification.status !== "failed" &&
      !finalizationFailed
        ? "succeeded"
        : "failed";

    try {
      await this.runArtifactRepository.create(
        createDiffArtifact(run.id, diff, this.clock, this.idGenerator)
      );
    } catch (error) {
      recordDiagnostic("diff artifact persistence", error);
    }
    if (taskBriefPath) {
      try {
        await this.runArtifactRepository.create(
          createTextArtifact({
            runId: run.id,
            kind: "task_brief",
            content: await fs.readFile(taskBriefPath, "utf8"),
            metadata: { path: taskBriefPath },
            clock: this.clock,
            idGenerator: this.idGenerator
          })
        );
      } catch (error) {
        recordDiagnostic("task brief artifact persistence", error);
      }
    }
    try {
      await this.verificationResultRepository.createMany(
        toPersistedVerificationResults(
          run.id,
          verification,
          this.clock,
          this.idGenerator
        )
      );
    } catch (error) {
      recordDiagnostic("verification result persistence", error);
    }
    if (riskReport) {
      try {
        await this.riskReportRepository.create(riskReport);
      } catch (error) {
        recordDiagnostic("risk report persistence", error);
      }
    }

    status = status === "succeeded" && !finalizationFailed ? "succeeded" : "failed";

    try {
      workspaceCleanup = await workspaceSession.cleanup({
        successful: status === "succeeded"
      });
    } catch (error) {
      recordDiagnostic("workspace cleanup", error);
      workspaceCleanup = {
        cleaned: false,
        retained: true,
        reason: `workspace cleanup failed: ${errorMessage(error)}`,
        commands: []
      };
    }
    status = status === "succeeded" && !finalizationFailed ? "succeeded" : "failed";

    try {
      await this.runMetadataRepository.save({
        runId: run.id,
        workspace: workspaceSession.workspace,
        workspaceCleanup,
        diff,
        verification,
        riskReport
      });
    } catch (error) {
      recordDiagnostic("run metadata persistence", error);
    }
    status = status === "succeeded" && !finalizationFailed ? "succeeded" : "failed";

    try {
      await this.runEventRepository.createMany(
        toPersistedRunEvents(run.id, events, this.clock, this.idGenerator)
      );
    } catch (error) {
      const message = `run event persistence failed: ${errorMessage(error)}`;
      warnings.push(message);
      if (status === "succeeded") {
        status = "failed";
        finalizationError ??= message;
      }
    }

    const completedAt = this.clock.now();
    const updatedRun = await this.taskRunRepository.updateStatus(
      currentRun.id,
      status,
      completedAt
    );
    const updatedTask = status === "succeeded"
      ? await this.taskRepository.updateStatus(task.id, "completed", completedAt)
      : currentTask;

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
      warnings,
      error:
        status === "failed"
          ? finalizationError ??
            errorEvent?.message ??
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

export function createTaskBriefFromTask(task: Task, contextMarkdown = ""): TaskBrief {
  return createContextTaskBrief({
    taskId: task.id,
    title: task.title,
    prompt: task.description,
    contextPackId: "context_bundle",
    contextMarkdown,
    createdAt: nowIso()
  });
}

function toPersistedRunEvents(
  runId: string,
  events: AgentRunEvent[],
  clock: Clock,
  idGenerator: IdGenerator
): RunEvent[] {
  return events.map((event, sequence) => {
    const metadata: JsonObject = { ...(event.metadata ?? {}) };
    if (event.type === "exit") {
      metadata.exitCode = event.exitCode;
      if (event.signal !== undefined) {
        metadata.signal = event.signal;
      }
    }
    return validateRunEvent({
      id: idGenerator.nextId("event"),
      taskRunId: runId,
      sequence,
      type: event.type,
      message: event.message,
      metadata,
      createdAt: clock.now()
    });
  });
}

function createRuntimeContextPack(
  bundle: ContextBundle,
  taskId: string,
  title: string,
  prompt: string,
  deliveryMode: ContextDeliveryMode
): ContextPack {
  return {
    id: bundle.id,
    projectId: bundle.targetRepository.id,
    taskId,
    taskTitle: title,
    taskPrompt: prompt,
    deliveryMode,
    contextSections: bundle.sections.map((entry) => `${entry.title}\n\n${entry.body}`),
    approvedMemorySections: bundle.sections
      .filter((entry) => entry.source.kind === "memory")
      .map((entry) => entry.body),
    skillReferences: bundle.sections
      .filter((entry) => entry.source.kind === "skill")
      .map((entry) => entry.source.id),
    createdAt: nowIso()
  };
}

function createDiffArtifact(
  runId: string,
  diff: DiffCollectionResult,
  clock: Clock,
  idGenerator: IdGenerator
) {
  return createTextArtifact({
    runId,
    kind: "git_diff",
    content:
      diff.diff.trim().length > 0
        ? diff.diff
        : JSON.stringify(
            {
              changedFiles: diff.changedFiles,
              stat: diff.stat,
              fileSummaries: diff.fileSummaries,
              error: diff.error
            },
            null,
            2
          ),
    metadata: {
      ok: diff.ok,
      workspacePath: diff.workspacePath,
      isClean: diff.isClean,
      changedFiles: diff.changedFiles,
      stat: diff.stat,
      fileSummaries: diff.fileSummaries,
      error: diff.error
    },
    clock,
    idGenerator
  });
}

function createTextArtifact(input: {
  runId: string;
  kind: string;
  content: string;
  metadata: JsonObject;
  clock: Clock;
  idGenerator: IdGenerator;
}) {
  return validateRunArtifact({
    id: input.idGenerator.nextId("artifact"),
    taskRunId: input.runId,
    kind: input.kind,
    content: input.content,
    metadata: input.metadata,
    createdAt: input.clock.now()
  });
}

function toPersistedVerificationResults(
  runId: string,
  verification: VerificationSuiteResult,
  clock: Clock,
  idGenerator: IdGenerator
): VerificationResult[] {
  if (verification.results.length === 0) {
    return [
      validateVerificationResult({
        id: idGenerator.nextId("verification"),
        taskRunId: runId,
        command: "not configured",
        status: "skipped",
        createdAt: clock.now()
      })
    ];
  }

  return verification.results.map((result) =>
    validateVerificationResult({
      id: idGenerator.nextId("verification"),
      taskRunId: runId,
      command: formatShellCommand(result.command),
      status: result.status,
      exitCode: result.exitCode ?? undefined,
      stdout: result.stdout,
      stderr: result.stderr,
      createdAt: clock.now()
    })
  );
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

function failedDiffResultFromError(
  worktreePath: string,
  error: unknown
): DiffCollectionResult {
  return {
    ok: false,
    workspacePath: worktreePath,
    isClean: false,
    changedFiles: [],
    stat: { filesChanged: 0, insertions: 0, deletions: 0, text: "" },
    diff: "",
    fileSummaries: [],
    commands: [],
    error: errorMessage(error)
  };
}

function failedVerificationSuiteFromError(
  error: unknown,
  commands: VerificationCommand[] | undefined
): VerificationSuiteResult {
  const message = errorMessage(error);
  const failedCommands =
    commands && commands.length > 0
      ? commands.map((command) => failedVerificationCommand(command, message))
      : [
          failedVerificationCommand(
            {
              id: "runner-finalization",
              label: "Runner finalization",
              command: "agent-hub",
              args: ["finalize"]
            },
            message
          )
        ];
  return {
    status: "failed",
    results: failedCommands,
    failedCommands,
    missingCommandConfig: false,
    summary: `0 passed, ${failedCommands.length} failed, 0 skipped`,
    durationMs: 0
  };
}

function failedVerificationCommand(
  command: VerificationCommand,
  message: string
): VerificationCommandResult {
  return {
    commandId: command.id,
    label: command.label ?? command.id,
    command: {
      executable: command.command,
      args: [...(command.args ?? [])],
      displayName: command.label ?? command.id
    },
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
