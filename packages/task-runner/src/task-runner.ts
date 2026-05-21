import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentRunEvent } from "@agent-hub/agent-adapters";
import {
  ClaudeCodeAdapter,
  CodexAdapter,
  DefaultAgentRegistry,
  FakeAgentAdapter,
  isPathInside,
  NodeProcessRunner,
  parseAgentPrompt,
  type AgentRegistry,
  type ProcessRunner
} from "@agent-hub/agent-adapters";
import {
  DefaultContextCompiler,
  MarkdownContextFormatter,
  createTaskBrief as createContextTaskBrief,
  materializeWorktreeOverlay,
  type ConversationContextBrief,
  type GeneratedFileBaseline,
  type ContextBundle,
  type ContextCompiler,
  type ContextCompilerInput,
  type ContextFormatter,
  type TargetRepositoryMetadata
} from "@agent-hub/context-compiler";
import {
  DiffCollector,
  type ChangedFile,
  type DiffCollectionResult,
  type DiffCollectorService
} from "./diff-collector";
import {
  createId,
  nowIso,
  validateRunArtifact,
  validateRunEvent,
  validateVerificationResult,
  validateTask,
  validateTaskRun,
  type AgentKind,
  type ContextPack,
  type JsonObject,
  type RiskReport,
  type RunContextDeliveryMode,
  type RunEvent,
  type Task,
  type TaskBrief,
  type TaskRun,
  type VerificationResult
} from "@agent-hub/core";
import { RiskReportGenerator } from "@agent-hub/safety";
import { generateMemoryProposalsFromCompletedRun } from "./memory-proposals";
import { formatShellCommand, NodeShellExecutor, type ShellExecutor } from "./shell-executor";
import {
  InMemoryRiskReportRepository,
  InMemoryRunArtifactRepository,
  InMemoryRunEventRepository,
  InMemoryRunMetadataRepository,
  InMemoryTaskRepository,
  InMemoryTaskRunRepository,
  InMemoryVerificationResultRepository,
  InMemoryMemoryItemRepository,
  type MemoryItemRepository,
  type RiskReportRepository,
  type RunArtifactRepository,
  type RunEventRepository,
  type RunMetadataRepository,
  type RunStatus,
  type RunStatusTransition,
  type TaskRepository,
  type TaskRunRepository,
  type VerificationResultRepository
} from "@agent-hub/core";
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
import { safeGitCommand, safeGitExecutionOptions } from "./git-safety";

export type { AgentRunEvent } from "@agent-hub/agent-adapters";

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
  deliveryMode?: RunContextDeliveryMode;
  contextStoreRoot?: string;
  runRoot?: string;
  workspaceBasePath?: string;
  workspaceCleanupPolicy?: WorkspaceCleanupPolicy;
  dryRun?: boolean;
  verificationCommands?: VerificationCommand[];
  stopOnVerificationFailure?: boolean;
  environmentOverrides?: Record<string, string | undefined>;
  targetRepository?: Partial<TargetRepositoryMetadata>;
  conversationBrief?: string | ConversationContextBrief;
  userConstraints?: string[];
  executionHints?: string[];
  continueFrom?: RunContinuationInput;
  onEvent?: (event: AgentRunEvent) => void | Promise<void>;
  signal?: AbortSignal;
}

export interface RunContinuationInput {
  parentRunId: string;
  parentMessageId?: string;
}

export interface CodeStateProvenance {
  mode: "continue_from_run";
  parentRunId: string;
  parentMessageId?: string;
  sourceWorktreePath: string;
  sourceBranchName?: string;
  sourceHead: string;
  copiedFiles: string[];
  deletedFiles: string[];
  blockedFiles: string[];
  inheritedFileCount: number;
  createdAt: string;
}

interface ResolvedContinuation extends RunContinuationInput {
  sourceWorktreePath: string;
  sourceBranchName?: string;
  sourceHead: string;
  changedFiles: ChangedFile[];
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

const MISSING_VERIFICATION_COMMANDS_WARNING =
  "No verification commands were configured; verification was skipped.";

export interface TaskRunnerDependencies {
  contextCompiler?: ContextCompiler;
  contextFormatter?: ContextFormatter;
  taskRepository?: TaskRepository;
  taskRunRepository?: TaskRunRepository;
  runEventRepository?: RunEventRepository;
  runArtifactRepository?: RunArtifactRepository;
  verificationResultRepository?: VerificationResultRepository;
  riskReportRepository?: RiskReportRepository;
  memoryItemRepository?: MemoryItemRepository;
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
  readonly memoryItemRepository: MemoryItemRepository;
  readonly runMetadataRepository: RunMetadataRepository;
  private readonly contextCompiler: ContextCompiler;
  private readonly contextFormatter: ContextFormatter;
  private readonly agentRegistry: AgentRegistry;
  private readonly workspaceManager: WorkspaceManager;
  private readonly diffCollector: DiffCollectorService;
  private readonly verificationRunner: VerificationRunner;
  private readonly riskReportGenerator: RiskReportGenerator;
  private readonly shellExecutor: ShellExecutor;
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
    this.memoryItemRepository =
      dependencies.memoryItemRepository ?? new InMemoryMemoryItemRepository();
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
    this.shellExecutor = shellExecutor;
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
    const continuation = input.continueFrom
      ? await this.resolveContinuation(input.continueFrom, projectRoot, input.projectId)
      : undefined;
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
      conversationBrief: input.conversationBrief,
      userConstraints: input.userConstraints,
      executionHints: input.executionHints
    });
    const contextMarkdown = this.contextFormatter.format(contextBundle);
    const contextPack = createRuntimeContextPack(
      contextBundle,
      task.id,
      task.title,
      parsed.taskPrompt,
      parsed.deliveryMode
    );

    const run = validateTaskRun({
      id: this.idGenerator.nextId("run"),
      taskId: task.id,
      agentKind: parsed.agentKind,
      status: "queued",
      parentRunId: continuation?.parentRunId,
      parentMessageId: continuation?.parentMessageId,
      createdAt,
      updatedAt: createdAt
    });
    await this.taskRunRepository.create(run);
    const events: AgentRunEvent[] = [];
    const warnings = [...contextBundle.warnings];
    const emitRunEvent = async (event: AgentRunEvent): Promise<void> => {
      events.push(event);
      if (!input.onEvent) {
        return;
      }
      try {
        await input.onEvent(event);
      } catch (error) {
        warnings.push(`run event listener failed: ${errorMessage(error)}`);
      }
    };

    await emitRunEvent(
      progressEvent(
        "context_compiled",
        "Context compiled for runtime injection.",
        {
          phase: "context",
          deliveryMode: parsed.deliveryMode,
          contextBundleId: contextBundle.id,
          sectionCount: contextBundle.sections.length
        }
      )
    );

    if (input.signal?.aborted) {
      await emitRunEvent(
        progressEvent("run_cancelled", "Run cancelled before execution started.", {
          phase: "final",
          status: "cancelled"
        })
      );
      await this.persistNewRunEvents(run.id, events, warnings);
      const cancelledAt = this.clock.now();
      const cancelledRun = await this.taskRunRepository.updateStatus(
        run.id,
        "cancelled",
        cancelledAt
      );
      const reopenedTask = await this.taskRepository.updateStatus(
        currentTask.id,
        "open",
        cancelledAt
      );
      return this.result({
        ok: false,
        task: reopenedTask,
        run: cancelledRun,
        events,
        status: "cancelled",
        contextBundle,
        contextMarkdown,
        warnings,
        error: "Run cancelled before execution started."
      });
    }

    const adapter = this.agentRegistry.get(parsed.agentKind);
    if (!adapter) {
      const message = `agent ${parsed.agentKind} is not registered`;
      await emitRunEvent({ type: "error", message });
      await emitRunEvent(
        progressEvent("run_failed", message, {
          phase: "final",
          status: "failed"
        })
      );
      await this.persistNewRunEvents(run.id, events, warnings);
      await this.taskRunRepository.updateStatus(
        run.id,
        "running",
        this.clock.now()
      );
      const failedAt = this.clock.now();
      const failedRun = await this.taskRunRepository.updateStatus(
        run.id,
        "failed",
        failedAt
      );
      const reopenedTask = await this.taskRepository.updateStatus(
        currentTask.id,
        "open",
        failedAt
      );
      return this.result({
        ok: false,
        task: reopenedTask,
        run: failedRun,
        events,
        status: "failed",
        contextBundle,
        contextMarkdown,
        warnings,
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
        branchName: continuation
          ? continuationBranchName(task.id, parsed.agentKind, continuation.parentRunId, run.id)
          : undefined,
        startPoint: continuation?.sourceHead,
        cleanupPolicy: input.workspaceCleanupPolicy ?? "never",
        dryRun: input.dryRun
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await emitRunEvent({ type: "error", message });
      await emitRunEvent(
        progressEvent("run_failed", message, {
          phase: "final",
          status: "failed"
        })
      );
      await this.persistNewRunEvents(run.id, events, warnings);
      await this.taskRunRepository.updateStatus(
        run.id,
        "running",
        this.clock.now()
      );
      const failedAt = this.clock.now();
      const failedRun = await this.taskRunRepository.updateStatus(
        run.id,
        "failed",
        failedAt
      );
      const reopenedTask = await this.taskRepository.updateStatus(
        currentTask.id,
        "open",
        failedAt
      );
      return this.result({
        ok: false,
        task: reopenedTask,
        run: failedRun,
        events,
        status: "failed",
        contextBundle,
        contextMarkdown,
        warnings,
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
    let taskBriefArtifactContent: string | undefined;
    const runtimeDirectory = path.join(worktreePath, ".agent-hub", "tasks", task.id);
    let generatedFileBaselines: GeneratedFileBaseline[] = [];
    let workspaceCleanup: WorkspaceCleanupResult | undefined;
    let codeStateProvenance: CodeStateProvenance | undefined;
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
    await emitRunEvent(
      progressEvent("run_started", "TaskRunner execution started.", {
        phase: "lifecycle",
        status: "running",
        worktreePath
      })
    );
    await emitRunEvent(
      progressEvent("agent_step", "Isolated worktree is ready.", {
        phase: "agent",
        worktreePath,
        branchName: workspaceSession.workspace.branchName
      })
    );

    if (input.dryRun) {
      await emitRunEvent({
        type: "status",
        message: "dry-run mode skipped fake adapter execution"
      });
      await emitRunEvent({
        type: "exit",
        message: "dry-run completed",
        exitCode: 0
      });
    } else {
      try {
        if (continuation) {
          codeStateProvenance = await this.applyContinuationToWorkspace({
            continuation,
            childWorktreePath: worktreePath,
            createdAt: this.clock.now()
          });
          await emitRunEvent({
            type: "status",
            message: `continued code state from ${continuation.parentRunId}`,
            metadata: {
              stage: "code_state_continuation",
              parentRunId: continuation.parentRunId,
              parentMessageId: continuation.parentMessageId,
              copiedFiles: codeStateProvenance.copiedFiles,
              deletedFiles: codeStateProvenance.deletedFiles
            }
          });
        }
        const taskBrief = createContextTaskBrief({
          taskId: task.id,
          title: task.title,
          prompt: parsed.taskPrompt,
          contextPackId: contextPack.id,
          contextMarkdown
        });
        const generatedTaskBriefPath = path.join(runtimeDirectory, "brief.md");
        taskBriefArtifactContent = taskBrief.renderedContent;
        const overlay = await materializeWorktreeOverlay({
          worktreePath,
          taskId: task.id,
          contextPack,
          taskBrief,
          contextMarkdown,
          includeAgentFiles: parsed.deliveryMode === "worktree_overlay",
          storeRoot:
            parsed.deliveryMode === "worktree_overlay"
              ? input.contextStoreRoot
              : undefined
        });
        taskBriefPath = generatedTaskBriefPath;
        warnings.push(...overlay.warnings);
        generatedFileBaselines = overlay.baselines;
        if (parsed.deliveryMode !== "worktree_overlay") {
          generatedFileBaselines = overlay.baselines.filter((baseline) =>
            baseline.path.startsWith(".agent-hub/")
          );
        }

        try {
          let adapterEventSeen = false;
          for await (const event of adapter.run({
            originalProjectRoot: projectRoot,
            worktreePath,
            taskBriefPath: generatedTaskBriefPath,
            contextPackPath: path.join(runtimeDirectory, "context-pack.json"),
            contextBundle,
            contextMarkdown,
            runtimeDirectory,
            taskId: task.id,
            taskTitle: task.title,
            taskPrompt: parsed.taskPrompt,
            environment: input.environmentOverrides,
            signal: input.signal
          })) {
            if (!adapterEventSeen) {
              adapterEventSeen = true;
              await emitRunEvent(
                progressEvent("agent_step", "Agent adapter started.", {
                  phase: "agent",
                  agentKind: parsed.agentKind
                })
              );
            }
            await emitRunEvent(event);
          }
        } catch (error) {
          await emitRunEvent({
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

    const adapterExitBeforeVerification = findLastExitEvent(events);
    const adapterCancelled = isCancellationExit(
      adapterExitBeforeVerification,
      input.signal
    );
    await emitRunEvent(
      progressEvent("verification_started", "Verification stage started.", {
        phase: "verification",
        status: "verifying",
        skipped: adapterCancelled
      })
    );
    if (adapterCancelled) {
      verification = skippedVerificationSuite("Verification skipped because the run was cancelled.");
    } else {
      try {
        verification = await this.verificationRunner.run({
          cwd: worktreePath,
          commands: input.verificationCommands,
          stopOnFailure: input.stopOnVerificationFailure,
          dryRun: input.dryRun,
          signal: input.signal
        });
      } catch (error) {
        recordDiagnostic("verification", error);
        verification = failedVerificationSuiteFromError(
          error,
          input.verificationCommands
        );
      }
    }
    await emitRunEvent(
      progressEvent("verification_finished", verification.summary, {
        phase: "verification",
        passed: verification.status === "passed",
        summary: verification.summary
      })
    );
    if (verification.missingCommandConfig) {
      warnings.push(MISSING_VERIFICATION_COMMANDS_WARNING);
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
    const runCancelled =
      isCancellationExit(exitEvent, input.signal) ||
      didVerificationObserveCancellation(verification, input.signal);
    const adapterSucceeded =
      exitEvent?.type === "exit" && exitEvent.exitCode === 0;
    let status: RunStatus =
      runCancelled
        ? "cancelled"
        : adapterSucceeded &&
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
    if (taskBriefArtifactContent !== undefined) {
      try {
        await this.runArtifactRepository.create(
          createTextArtifact({
            runId: run.id,
            kind: "task_brief",
            content: taskBriefArtifactContent,
            metadata: taskBriefPath ? { path: taskBriefPath } : {},
            clock: this.clock,
            idGenerator: this.idGenerator
          })
        );
      } catch (error) {
        recordDiagnostic("task brief artifact persistence", error);
      }
    }
    const conversationBrief = conversationBriefArtifact(input.conversationBrief);
    if (conversationBrief) {
      try {
        await this.runArtifactRepository.create(
          createTextArtifact({
            runId: run.id,
            kind: "conversation_brief",
            content: conversationBrief.content,
            metadata: conversationBrief.metadata,
            clock: this.clock,
            idGenerator: this.idGenerator
          })
        );
      } catch (error) {
        recordDiagnostic("conversation brief artifact persistence", error);
      }
    }
    if (codeStateProvenance) {
      try {
        await this.runArtifactRepository.create(
          createTextArtifact({
            runId: run.id,
            kind: "code_state_provenance",
            content: renderCodeStateProvenance(codeStateProvenance),
            metadata: codeStateProvenance as unknown as JsonObject,
            clock: this.clock,
            idGenerator: this.idGenerator
          })
        );
      } catch (error) {
        recordDiagnostic("code-state provenance artifact persistence", error);
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

    status = finalRunStatus(status, finalizationFailed);

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
    status = finalRunStatus(status, finalizationFailed);

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
    status = finalRunStatus(status, finalizationFailed);

    const errorEvent = events.find((event) => event.type === "error");
    const failureMessage =
      finalizationError ??
      errorEvent?.message ??
      diff.error ??
      verification.failedCommands[0]?.stderr;
    const finalMessage = finalRunMessage(status, failureMessage);
    await emitRunEvent(
      progressEvent(finalDesktopEventType(status), finalMessage, {
        phase: "final",
        status: toDesktopStatus(status),
        summary: finalMessage,
        assistantOutput: false
      })
    );

    try {
      await this.persistNewRunEvents(run.id, events, warnings);
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
    const updatedTask = await this.taskRepository.updateStatus(
      currentTask.id,
      status === "succeeded" ? "completed" : "open",
      completedAt
    );
    if (status === "succeeded") {
      try {
        await generateMemoryProposalsFromCompletedRun(
          {
            taskRunRepository: this.taskRunRepository,
            taskRepository: this.taskRepository,
            runArtifactRepository: this.runArtifactRepository,
            verificationResultRepository: this.verificationResultRepository,
            riskReportRepository: this.riskReportRepository,
            memoryItemRepository: this.memoryItemRepository
          },
          {
            runId: updatedRun.id,
            idGenerator: this.idGenerator,
            clock: this.clock
          }
        );
      } catch (error) {
        warnings.push(`memory proposal generation failed: ${errorMessage(error)}`);
      }
    }

    const fakeOutput = extractFakeOutput(events);

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
          ? finalizationError ?? failureMessage ?? "run failed"
          : undefined
    });
  }

  private async resolveContinuation(
    input: RunContinuationInput,
    projectRoot: string,
    projectId: string | undefined
  ): Promise<ResolvedContinuation> {
    if (!input.parentRunId.trim()) {
      throw new TaskRunnerError("continueFrom.parentRunId is required");
    }
    const parentRun = await this.taskRunRepository.get(input.parentRunId);
    if (!parentRun) {
      throw new TaskRunnerError(`parent run ${input.parentRunId} not found`);
    }
    if (!isTerminalTaskRunStatus(parentRun.status)) {
      throw new TaskRunnerError(
        `parent run ${input.parentRunId} must be terminal before continuation`
      );
    }
    const parentTask = await this.taskRepository.get(parentRun.taskId);
    if (!parentTask) {
      throw new TaskRunnerError(`parent task ${parentRun.taskId} not found`);
    }
    if (projectId !== undefined && parentTask.projectId !== projectId) {
      throw new TaskRunnerError(
        `parent run ${input.parentRunId} belongs to project ${parentTask.projectId}, not ${projectId}`
      );
    }

    const metadata = await this.runMetadataRepository.get(parentRun.id);
    if (metadata?.workspaceCleanup?.retained !== true) {
      throw new TaskRunnerError(
        `parent run ${parentRun.id} does not have a retained worktree`
      );
    }
    const rawSourceWorktreePath = parentRun.worktreePath ?? metadata.workspace?.path;
    if (!rawSourceWorktreePath || !path.isAbsolute(rawSourceWorktreePath)) {
      throw new TaskRunnerError(
        `parent run ${parentRun.id} does not have an absolute worktree path`
      );
    }
    const sourceWorktreePath = path.resolve(rawSourceWorktreePath);
    if (
      metadata.workspace?.sourceRepositoryPath &&
      !samePath(metadata.workspace.sourceRepositoryPath, projectRoot)
    ) {
      throw new TaskRunnerError(
        `parent run ${parentRun.id} belongs to a different source repository`
      );
    }

    await assertDirectoryExists(sourceWorktreePath, `parent run ${parentRun.id} worktree`);
    const sourceHead = await this.resolveGitHead(sourceWorktreePath);
    const parentDiff = await this.diffCollector.collect({
      workspacePath: sourceWorktreePath,
      excludePathPrefixes: [".agent-hub/"]
    });
    if (!parentDiff.ok) {
      throw new TaskRunnerError(
        `parent run ${parentRun.id} diff could not be inspected: ${parentDiff.error ?? "unknown error"}`
      );
    }
    const blockedFiles = parentDiff.changedFiles.filter((file) =>
      isBlockedContinuationFile(file)
    );
    const unsafeSourceFiles = await unsafeContinuationSourceFiles(
      sourceWorktreePath,
      parentDiff.changedFiles
    );
    const unsafeFiles = [
      ...blockedFiles.map((file) => file.path),
      ...unsafeSourceFiles
    ];
    if (unsafeFiles.length > 0) {
      throw new TaskRunnerError(
        `parent run ${parentRun.id} cannot be continued because unsafe file paths changed: ${unsafeFiles.join(", ")}`
      );
    }

    return {
      parentRunId: parentRun.id,
      parentMessageId: input.parentMessageId,
      sourceWorktreePath,
      sourceBranchName: parentRun.branchName ?? metadata.workspace?.branchName,
      sourceHead,
      changedFiles: parentDiff.changedFiles
    };
  }

  private async resolveGitHead(worktreePath: string): Promise<string> {
    const result = await this.shellExecutor.execute(
      safeGitCommand(["rev-parse", "HEAD"]),
      safeGitExecutionOptions({ cwd: worktreePath })
    );
    if (result.exitCode !== 0) {
      throw new TaskRunnerError(
        `could not resolve parent worktree HEAD: ${result.stderr.trim() || result.stdout.trim() || result.error || "git rev-parse failed"}`
      );
    }
    return result.stdout.trim();
  }

  private async applyContinuationToWorkspace(input: {
    continuation: ResolvedContinuation;
    childWorktreePath: string;
    createdAt: string;
  }): Promise<CodeStateProvenance> {
    const copiedFiles: string[] = [];
    const deletedFiles: string[] = [];
    const blockedFiles: string[] = [];
    for (const file of input.continuation.changedFiles) {
      try {
        await copyContinuationFile({
          sourceWorktreePath: input.continuation.sourceWorktreePath,
          childWorktreePath: input.childWorktreePath,
          file
        });
        if (file.status === "deleted") {
          deletedFiles.push(file.path);
        } else {
          copiedFiles.push(file.path);
        }
      } catch (error) {
        blockedFiles.push(`${file.path}: ${errorMessage(error)}`);
      }
    }
    if (blockedFiles.length > 0) {
      throw new TaskRunnerError(
        `code-state continuation failed: ${blockedFiles.join("; ")}`
      );
    }
    return {
      mode: "continue_from_run",
      parentRunId: input.continuation.parentRunId,
      parentMessageId: input.continuation.parentMessageId,
      sourceWorktreePath: input.continuation.sourceWorktreePath,
      sourceBranchName: input.continuation.sourceBranchName,
      sourceHead: input.continuation.sourceHead,
      copiedFiles,
      deletedFiles,
      blockedFiles,
      inheritedFileCount: copiedFiles.length + deletedFiles.length,
      createdAt: input.createdAt
    };
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

  private async persistNewRunEvents(
    runId: string,
    events: AgentRunEvent[],
    warnings: string[]
  ): Promise<void> {
    const existingCount = await this.runEventRepository.countByRunId(runId);
    const newEvents = events.slice(existingCount);
    if (newEvents.length === 0) {
      return;
    }
    try {
      await this.runEventRepository.createMany(
        toPersistedRunEvents(
          runId,
          newEvents,
          this.clock,
          this.idGenerator,
          existingCount
        )
      );
    } catch (error) {
      warnings.push(`run event persistence failed: ${errorMessage(error)}`);
      throw error;
    }
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

function progressEvent(
  desktopEventType: string,
  message: string,
  metadata: JsonObject = {}
): AgentRunEvent {
  return {
    type: "status",
    message,
    metadata: compactMetadata({
      ...metadata,
      desktopEventType,
      message
    })
  };
}

function compactMetadata(metadata: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== undefined)
  ) as JsonObject;
}

function finalRunStatus(status: RunStatus, finalizationFailed: boolean): RunStatus {
  if (status === "cancelled") {
    return "cancelled";
  }
  return status === "succeeded" && !finalizationFailed ? "succeeded" : "failed";
}

function finalDesktopEventType(status: RunStatus): string {
  if (status === "succeeded") {
    return "run_completed";
  }
  if (status === "cancelled") {
    return "run_cancelled";
  }
  return "run_failed";
}

function toDesktopStatus(status: RunStatus): string {
  return status === "succeeded" ? "completed" : status;
}

function finalRunMessage(status: RunStatus, error: string | undefined): string {
  if (status === "succeeded") {
    return "Run completed.";
  }
  if (status === "cancelled") {
    return "Run cancelled.";
  }
  return error ?? "Run failed.";
}

function isCancellationExit(
  event: AgentRunEvent | undefined,
  signal: AbortSignal | undefined
): boolean {
  return signal?.aborted === true &&
    event?.type === "exit" &&
    event.signal !== undefined &&
    event.signal !== null;
}

function didVerificationObserveCancellation(
  verification: VerificationSuiteResult,
  signal: AbortSignal | undefined
): boolean {
  return signal?.aborted === true &&
    verification.results.some((result) => result.signal !== null && result.signal !== undefined);
}

function skippedVerificationSuite(summary: string): VerificationSuiteResult {
  return {
    status: "skipped",
    results: [],
    failedCommands: [],
    missingCommandConfig: false,
    summary,
    durationMs: 0
  };
}

function toPersistedRunEvents(
  runId: string,
  events: AgentRunEvent[],
  clock: Clock,
  idGenerator: IdGenerator,
  sequenceOffset = 0
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
      sequence: sequenceOffset + sequence,
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
  deliveryMode: RunContextDeliveryMode
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

function conversationBriefArtifact(
  brief: RunTaskInput["conversationBrief"]
): { content: string; metadata: JsonObject } | undefined {
  if (brief === undefined) {
    return undefined;
  }
  if (typeof brief === "string") {
    const content = brief.trim();
    return content.length > 0
      ? {
          content: `${content}\n`,
          metadata: {
            source: "conversation_context_builder",
            characterCount: content.length
          }
        }
      : undefined;
  }
  const content = brief.renderedContent.trim();
  return content.length > 0
    ? {
        content: `${content}\n`,
        metadata: {
          source: "conversation_context_builder",
          ...brief.metadata
        }
      }
    : undefined;
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

function parseRunInput(input: RunTaskInput): {
  agentKind: AgentKind;
  taskPrompt: string;
  deliveryMode: RunContextDeliveryMode;
} {
  const deliveryMode = parseRunDeliveryMode(input.deliveryMode);
  if (input.rawPrompt !== undefined) {
    const parsed = parseAgentPrompt(input.rawPrompt);
    return { agentKind: parsed.agentKind, taskPrompt: parsed.prompt, deliveryMode };
  }

  if (!input.taskPrompt) {
    throw new TaskRunnerError("task prompt is required");
  }

  return {
    agentKind: input.agentKind ?? "fake",
    taskPrompt: input.taskPrompt,
    deliveryMode
  };
}

function parseRunDeliveryMode(
  value: string | undefined
): RunContextDeliveryMode {
  if (value === undefined) {
    return "runtime_injection";
  }
  if (value === "runtime_injection" || value === "worktree_overlay") {
    return value;
  }
  throw new TaskRunnerError(
    "deliveryMode must be runtime_injection or worktree_overlay for task runs"
  );
}

function continuationBranchName(
  taskId: string,
  agentKind: AgentKind,
  parentRunId: string,
  runId: string
): string {
  return [
    "agent-hub",
    sanitizeSegment(taskId),
    sanitizeSegment(agentKind),
    `continue-${shortSegment(parentRunId)}-${shortSegment(runId)}`
  ].join("/");
}

function shortSegment(value: string): string {
  return sanitizeSegment(value).slice(0, 24);
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

function isTerminalTaskRunStatus(status: TaskRun["status"]): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

async function assertDirectoryExists(directoryPath: string, label: string): Promise<void> {
  try {
    const stats = await fs.stat(directoryPath);
    if (!stats.isDirectory()) {
      throw new TaskRunnerError(`${label} is not a directory: ${directoryPath}`);
    }
  } catch (error) {
    if (error instanceof TaskRunnerError) {
      throw error;
    }
    throw new TaskRunnerError(`${label} is not available: ${directoryPath}`);
  }
}

function isBlockedContinuationFile(file: ChangedFile): boolean {
  const normalizedPath = normalizeContinuationPath(file.path);
  if (normalizedPath === undefined) {
    return true;
  }
  if (file.symlink || file.symlinkTarget !== undefined) {
    return true;
  }
  if (file.status === "renamed") {
    return true;
  }
  if (isSensitiveContinuationPath(normalizedPath)) {
    return true;
  }
  return normalizedPath
    .split("/")
    .some((segment) => segment === ".git" || segment === ".agent-hub");
}

async function unsafeContinuationSourceFiles(
  sourceWorktreePath: string,
  files: ChangedFile[]
): Promise<string[]> {
  const unsafeFiles: string[] = [];
  for (const file of files) {
    if (file.status === "deleted" || isBlockedContinuationFile(file)) {
      continue;
    }
    const relativePath = normalizeContinuationPath(file.path);
    if (relativePath === undefined) {
      unsafeFiles.push(file.path);
      continue;
    }
    try {
      const sourcePath = safeContinuationPath(sourceWorktreePath, relativePath);
      const stats = await fs.lstat(sourcePath);
      if (stats.isSymbolicLink() || !stats.isFile()) {
        unsafeFiles.push(file.path);
      }
    } catch {
      unsafeFiles.push(file.path);
    }
  }
  return unsafeFiles;
}

async function copyContinuationFile(input: {
  sourceWorktreePath: string;
  childWorktreePath: string;
  file: ChangedFile;
}): Promise<void> {
  const relativePath = normalizeContinuationPath(input.file.path);
  if (relativePath === undefined || isBlockedContinuationFile(input.file)) {
    throw new Error("unsafe continuation path");
  }
  const childPath = safeContinuationPath(input.childWorktreePath, relativePath);
  if (input.file.status === "deleted") {
    await fs.rm(childPath, { force: true });
    return;
  }
  const sourcePath = safeContinuationPath(input.sourceWorktreePath, relativePath);
  const stats = await fs.lstat(sourcePath);
  if (stats.isSymbolicLink()) {
    throw new Error("symlink inheritance is not allowed");
  }
  if (!stats.isFile()) {
    throw new Error("only regular files can be inherited");
  }
  await fs.mkdir(path.dirname(childPath), { recursive: true });
  await fs.copyFile(sourcePath, childPath);
}

function safeContinuationPath(worktreePath: string, relativePath: string): string {
  const resolvedWorktree = path.resolve(worktreePath);
  const resolvedPath = path.resolve(resolvedWorktree, relativePath);
  if (!isContinuationPathInside(resolvedPath, resolvedWorktree)) {
    throw new Error("continuation path escapes the worktree");
  }
  return resolvedPath;
}

function normalizeContinuationPath(filePath: string): string | undefined {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (
    normalized.length === 0 ||
    path.posix.isAbsolute(normalized) ||
    normalized.split("/").some((segment) => segment === ".." || segment.length === 0)
  ) {
    return undefined;
  }
  return normalized;
}

function isContinuationPathInside(candidatePath: string, basePath: string): boolean {
  const relative = path.relative(basePath, candidatePath);
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function isSensitiveContinuationPath(filePath: string): boolean {
  return /\.env(?:\.|$)/i.test(filePath) ||
    /\.pem$/i.test(filePath) ||
    /\.key$/i.test(filePath) ||
    /(^|\/)id_rsa$/i.test(filePath) ||
    /(^|\/)id_ed25519$/i.test(filePath) ||
    /(^|\/)secrets?\./i.test(filePath) ||
    /(^|\/)credentials?\./i.test(filePath) ||
    /(^|\/)tokens?\./i.test(filePath);
}

function renderCodeStateProvenance(provenance: CodeStateProvenance): string {
  return [
    "# Agent Hub Code-State Provenance",
    "",
    `mode: ${provenance.mode}`,
    `parent_run_id: ${provenance.parentRunId}`,
    `parent_message_id: ${provenance.parentMessageId ?? "none"}`,
    `source_worktree_path: ${provenance.sourceWorktreePath}`,
    `source_branch_name: ${provenance.sourceBranchName ?? "none"}`,
    `source_head: ${provenance.sourceHead}`,
    `inherited_file_count: ${provenance.inheritedFileCount}`,
    "copied_files:",
    ...(provenance.copiedFiles.length === 0
      ? ["- none"]
      : provenance.copiedFiles.map((file) => `- ${file}`)),
    "deleted_files:",
    ...(provenance.deletedFiles.length === 0
      ? ["- none"]
      : provenance.deletedFiles.map((file) => `- ${file}`)),
    "blocked_files:",
    ...(provenance.blockedFiles.length === 0
      ? ["- none"]
      : provenance.blockedFiles.map((file) => `- ${file}`)),
    `created_at: ${provenance.createdAt}`,
    ""
  ].join("\n");
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
