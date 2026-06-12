import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildTuiCurrentContextModel,
  defaultAgentKind,
  emptyTuiSelectionDetails,
  parseAgentKindAlias,
  type AgentKind,
  type ConversationThread,
  type ProjectRepository,
  type TuiCurrentContextInput,
  type TuiCurrentContextModel,
  type TuiReadModelRepositories
} from "@agent-hub/core";

export interface TuiCliIO {
  stdin?: NodeJS.ReadableStream;
  stdout: Pick<NodeJS.WriteStream, "write"> &
    Partial<Pick<NodeJS.WriteStream, "columns" | "rows" | "isTTY">>;
  stderr: Pick<NodeJS.WriteStream, "write">;
}

export interface TuiCliRuntime extends TuiReadModelRepositories {
  projectRepository: ProjectRepository;
}

export interface RunTuiCommandOptions {
  args: string[];
  io: TuiCliIO;
  cwd: string;
  projectRoot: string;
  runtime: TuiCliRuntime;
  selectedAgent?: AgentKind;
  debug?: boolean;
  submitPrompt?: TuiPromptSubmitter;
  recordReviewDecision?: TuiReviewDecisionRecorder;
}

export interface TuiPromptSubmissionInput {
  prompt: string;
  projectRoot: string;
  projectId?: string;
  threadId?: string;
  roomRef?: string;
  selectedAgent: AgentKind;
  debug: boolean;
  dryRun: boolean;
  retainOnFailure: boolean;
  workspaceBasePath?: string;
  mode?: "blocking" | "background";
}

export interface TuiPromptSubmissionResult {
  ok: boolean;
  exitCode: number;
  projectId?: string;
  threadId?: string;
  message: string;
}

export type TuiPromptSubmitter = (
  input: TuiPromptSubmissionInput
) => Promise<TuiPromptSubmissionResult>;

export interface TuiReviewDecisionInput {
  runId: string;
  status: "accepted" | "rejected";
  reason?: string;
}

export interface TuiReviewDecisionResult {
  ok: boolean;
  message: string;
}

export type TuiReviewDecisionRecorder = (
  input: TuiReviewDecisionInput
) => Promise<TuiReviewDecisionResult>;

export type TuiFocusMode =
  | "work"
  | "graph"
  | "team"
  | "runs"
  | "review"
  | "tasks"
  | "memory"
  | "help";

export interface TuiShellState {
  focus: TuiFocusMode;
  selectedRunIndex: number;
  selectedRunId?: string;
  selectedRoleCallIndex: number;
  selectedRoleCallId?: string;
  selectedTaskIndex: number;
  selectedTaskId?: string;
  selectedActiveRunIndex: number;
  hideCompletedRoleCalls: boolean;
  collapsedRoleCallIds: string[];
  scrollOffsets: {
    runs: number;
    roleCalls: number;
    tasks: number;
    transcript: number;
  };
  conversationScrollOffset: number;
  reviewDiffExpanded: boolean;
  reviewCompareMode: boolean;
  searchOpen: boolean;
  searchQuery: string;
  searchMatchIndex: number;
  notifyEnabled: boolean;
  timelineOpen: boolean;
  composer: string;
  composerCursorPosition: number;
  composerHistory: string[];
  composerHistoryIndex?: number;
  composerHistoryDraft: string;
  agentCompletionIndex: number;
  commandPaletteOpen: boolean;
  paletteQuery: string;
  paletteSelectedIndex: number;
  statusMessage?: string;
}

interface ParsedTuiArgs {
  threadId?: string;
  roomRef?: string;
  agentKind?: AgentKind;
  maxIterations?: number;
  submitPrompt?: string;
  acceptRunId?: string;
  rejectRunId?: string;
  rejectReason?: string;
  selectedSkillReferences: string[];
  workspaceBasePath?: string;
  dryRun: boolean;
  retainOnFailure: boolean;
  debug: boolean;
  once: boolean;
  splash?: boolean;
  help: boolean;
}

interface TuiLaunchContext {
  projectId?: string;
  threadId?: string;
  warnings: string[];
}

interface TuiFailureModelInput {
  modelInput: TuiCurrentContextInput;
  launchWarnings: string[];
  message: string;
  projectRoot: string;
}

interface InkTuiEntry {
  runInkTui(input: {
    model: TuiCurrentContextModel;
    state: TuiShellState;
    terminal: { columns: number; rows: number };
    io: TuiCliIO;
    interactive: boolean;
    showSplash?: boolean;
    loadModel?: (state: TuiShellState) => Promise<TuiCurrentContextModel>;
    submitPrompt?: (input: {
      prompt: string;
      projectId?: string;
      threadId?: string;
    }) => Promise<{
      ok: boolean;
      message: string;
      model?: TuiCurrentContextModel;
    }>;
    recordReviewDecision?: (input: TuiReviewDecisionInput) => Promise<{
      ok: boolean;
      message: string;
      model?: TuiCurrentContextModel;
    }>;
  }): Promise<void>;
}

export async function runTuiCommand(options: RunTuiCommandOptions): Promise<number> {
  let parsed: ParsedTuiArgs;
  try {
    parsed = parseTuiArgs(options.args);
  } catch (error) {
    options.io.stderr.write(`error: ${errorMessage(error)}\n`);
    return 1;
  }

  if (parsed.help) {
    options.io.stdout.write(tuiHelpText());
    return 0;
  }

  const selectedAgent =
    parsed.agentKind ??
    options.selectedAgent ??
    defaultAgentKind({ env: process.env, debug: parsed.debug || options.debug });
  let launch: TuiLaunchContext;
  try {
    launch = await resolveTuiLaunchContext({
      runtime: options.runtime,
      projectRoot: options.projectRoot,
      threadId: parsed.threadId,
      roomRef: parsed.roomRef
    });
  } catch (error) {
    launch = {
      warnings: [
        `failed to resolve TUI launch context: ${errorMessage(error)}`,
        "recovery: agent-hub project list"
      ]
    };
  }

  const state = createInitialTuiShellState(parsed.submitPrompt ?? "");
  if (parsed.submitPrompt) {
    if (!options.submitPrompt) {
      options.io.stderr.write("error: TUI prompt submission is unavailable\n");
      return 1;
    }
    const submission = await safeSubmitPrompt(options.submitPrompt, {
      prompt: parsed.submitPrompt,
      projectRoot: options.projectRoot,
      projectId: launch.projectId,
      threadId: launch.threadId,
      roomRef: parsed.roomRef,
      selectedAgent,
      debug: parsed.debug || options.debug === true,
      dryRun: parsed.dryRun,
      retainOnFailure: parsed.retainOnFailure,
      workspaceBasePath: parsed.workspaceBasePath,
      mode: "blocking"
    });
    launch = {
      projectId: submission.projectId ?? launch.projectId,
      threadId: submission.threadId ?? launch.threadId,
      warnings: launch.warnings
    };
    state.composer = "";
    state.statusMessage = submitStatusMessage(submission, selectedAgent);
    if (!submission.ok) {
      options.io.stderr.write(`error: ${submission.message}\n`);
    }
  }

  if (parsed.acceptRunId || parsed.rejectRunId) {
    if (!options.recordReviewDecision) {
      options.io.stderr.write("error: TUI review decisions are unavailable\n");
      return 1;
    }
    const runId = parsed.acceptRunId ?? parsed.rejectRunId;
    if (runId) {
      const decision = await safeRecordReviewDecision(options.recordReviewDecision, {
        runId,
        status: parsed.acceptRunId ? "accepted" : "rejected",
        reason: parsed.rejectReason
      });
      state.statusMessage = decision.message;
      if (!decision.ok) {
        options.io.stderr.write(`error: ${decision.message}\n`);
      }
    }
  }

  const modelInput: TuiCurrentContextInput = {
    projectId: launch.projectId,
    threadId: launch.threadId,
    selectedAgent,
    selectedSkillReferences: parsed.selectedSkillReferences,
    maxIterations: parsed.maxIterations,
    hideCompletedRoleCalls: state.hideCompletedRoleCalls
  };
  const model = await buildRenderableTuiModel({
    runtime: options.runtime,
    modelInput,
    launchWarnings: launch.warnings,
    projectRoot: options.projectRoot
  });

  let activeModelInput = { ...modelInput };
  const interactive =
    !parsed.once &&
    isInteractiveTerminal(options.io) &&
    hasRawMode(options.io.stdin ?? process.stdin);

  await renderInkTui({
    io: options.io,
    runtime: options.runtime,
    model,
    state,
    getModelInput: () => activeModelInput,
    launchWarnings: launch.warnings,
    projectRoot: options.projectRoot,
    interactive,
    showSplash: parsed.splash === true,
    submitPrompt: options.submitPrompt
      ? async (input) => {
          const submission = await safeSubmitPrompt(options.submitPrompt as TuiPromptSubmitter, {
            prompt: input.prompt,
            projectRoot: options.projectRoot,
            projectId: input.projectId ?? activeModelInput.projectId,
            threadId: input.threadId ?? activeModelInput.threadId,
            roomRef: parsed.roomRef,
            selectedAgent,
            debug: parsed.debug || options.debug === true,
            dryRun: parsed.dryRun,
            retainOnFailure: parsed.retainOnFailure,
            workspaceBasePath: parsed.workspaceBasePath,
            mode: tuiPromptSubmissionMode({ interactive })
          });
          activeModelInput = {
            ...activeModelInput,
            projectId: submission.projectId ?? input.projectId ?? activeModelInput.projectId,
            threadId: submission.threadId ?? input.threadId ?? activeModelInput.threadId
          };
          return {
            ok: submission.ok,
            message: submitStatusMessage(submission, selectedAgent),
            model: await buildRenderableTuiModel({
              runtime: options.runtime,
              modelInput: activeModelInput,
              launchWarnings: launch.warnings,
              projectRoot: options.projectRoot
            })
          };
        }
      : undefined,
    recordReviewDecision: options.recordReviewDecision
      ? async (input) => {
          const decision = await safeRecordReviewDecision(
            options.recordReviewDecision as TuiReviewDecisionRecorder,
            input
          );
          return {
            ok: decision.ok,
            message: decision.message,
            model: await buildRenderableTuiModel({
              runtime: options.runtime,
              modelInput: activeModelInput,
              launchWarnings: launch.warnings,
              projectRoot: options.projectRoot
            })
          };
        }
      : undefined
  });
  return 0;
}

export function tuiHelpText(): string {
  return [
    "agent-hub tui",
    "",
    "Usage:",
    "  agent-hub tui [--thread <thread-id>|--room <handle-or-thread-id>] [--agent codex|claude-code|fake] [--max-iterations <n>] [--debug]",
    "",
    "Options:",
    "  --thread <thread-id>       Start from an existing thread.",
    "  --room <handle-or-id>      Start from a room in the current registered project.",
    "  --agent <agent>            Select the default prompt target.",
    "  --max-iterations <n>       Display the bounded loop limit.",
    "  --submit <prompt>          Submit a prompt through the TUI composer path, then render.",
    "  --workspace-base <path>    Workspace base for submitted runs.",
    "  --retain-on-failure        Keep failed submitted-run worktrees.",
    "  --dry-run                  Create submitted runs without adapter execution.",
    "  --accept-run <run-id>      Record an audit-only accepted review decision.",
    "  --reject-run <run-id>      Record an audit-only rejected review decision.",
    "  --reason <text>            Reason for --reject-run.",
    "  --skill [scope:]id         Show a selected skill indicator.",
    "  --debug                    Include debug-available agent choices.",
    "  --once                     Render once and exit, useful for smoke tests.",
    "  --splash                   Show a short non-blocking startup splash.",
    "  --no-splash                Skip the startup splash.",
    "  --help                     Show this help.",
    ""
  ].join("\n");
}

export function createInitialTuiShellState(composer = ""): TuiShellState {
  return {
    focus: "work",
    selectedRunIndex: 0,
    selectedRoleCallIndex: 0,
    selectedTaskIndex: 0,
    selectedActiveRunIndex: 0,
    hideCompletedRoleCalls: false,
    collapsedRoleCallIds: [],
    scrollOffsets: {
      runs: 0,
      roleCalls: 0,
      tasks: 0,
      transcript: 0
    },
    conversationScrollOffset: 0,
    reviewDiffExpanded: false,
    reviewCompareMode: false,
    searchOpen: false,
    searchQuery: "",
    searchMatchIndex: 0,
    notifyEnabled: false,
    timelineOpen: false,
    composer,
    composerCursorPosition: composer.length,
    composerHistory: [],
    composerHistoryDraft: "",
    agentCompletionIndex: 0,
    commandPaletteOpen: false,
    paletteQuery: "",
    paletteSelectedIndex: 0
  };
}

export function tuiPromptSubmissionMode(input: {
  interactive: boolean;
}): "blocking" | "background" {
  return input.interactive ? "background" : "blocking";
}

async function renderInkTui(input: {
  io: TuiCliIO;
  runtime: TuiCliRuntime;
  model: TuiCurrentContextModel;
  state: TuiShellState;
  getModelInput: () => TuiCurrentContextInput;
  launchWarnings: string[];
  projectRoot: string;
  interactive: boolean;
  submitPrompt?: (input: {
    prompt: string;
    projectId?: string;
    threadId?: string;
  }) => Promise<{
    ok: boolean;
    message: string;
    model?: TuiCurrentContextModel;
  }>;
  recordReviewDecision?: (input: TuiReviewDecisionInput) => Promise<{
    ok: boolean;
    message: string;
    model?: TuiCurrentContextModel;
  }>;
  showSplash?: boolean;
}): Promise<void> {
  const entry = await loadInkTuiEntry();
  await entry.runInkTui({
    model: input.model,
    state: input.state,
    terminal: terminalSize(input.io.stdout),
    io: input.io,
    interactive: input.interactive,
    showSplash: input.showSplash,
    loadModel: async (state) =>
      buildRenderableTuiModel({
        runtime: input.runtime,
        modelInput: {
          ...input.getModelInput(),
          hideCompletedRoleCalls: state.hideCompletedRoleCalls
        },
        launchWarnings: input.launchWarnings,
        projectRoot: input.projectRoot
      }),
    submitPrompt: input.submitPrompt,
    recordReviewDecision: input.recordReviewDecision
  });
}

async function loadInkTuiEntry(): Promise<InkTuiEntry> {
  const nativeImport = new Function("specifier", "return import(specifier)") as (
    specifier: string
  ) => Promise<unknown>;
  const entryPath = [
    path.join(__dirname, "tui-ink", "entry.mjs"),
    path.resolve(__dirname, "..", "dist", "tui-ink", "entry.mjs"),
    path.resolve(process.cwd(), "apps", "cli", "dist", "tui-ink", "entry.mjs")
  ].find((candidate) => existsSync(candidate));
  if (!entryPath) {
    throw new Error("Ink TUI entrypoint is not built; run pnpm build first.");
  }
  const entryUrl = pathToFileURL(entryPath).href;
  if (process.env.VITEST) {
    return import(entryUrl) as Promise<InkTuiEntry>;
  }
  return nativeImport(entryUrl) as Promise<InkTuiEntry>;
}

function parseTuiArgs(args: string[]): ParsedTuiArgs {
  const parsed: ParsedTuiArgs = {
    debug: false,
    dryRun: false,
    retainOnFailure: false,
    selectedSkillReferences: [],
    once: false,
    splash: false,
    help: false
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--thread") {
      parsed.threadId = requiredArgValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--room") {
      parsed.roomRef = requiredArgValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--agent") {
      parsed.agentKind = parseAgentKindAlias(requiredArgValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--max-iterations") {
      parsed.maxIterations = parsePositiveInteger(requiredArgValue(args, index, arg), arg);
      index += 1;
      continue;
    }
    if (arg === "--submit") {
      parsed.submitPrompt = requiredArgValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--workspace-base") {
      parsed.workspaceBasePath = requiredArgValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--retain-on-failure") {
      parsed.retainOnFailure = true;
      continue;
    }
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (arg === "--accept-run") {
      parsed.acceptRunId = requiredArgValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--reject-run") {
      parsed.rejectRunId = requiredArgValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--reason") {
      parsed.rejectReason = requiredArgValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--skill") {
      parsed.selectedSkillReferences.push(requiredArgValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--debug") {
      parsed.debug = true;
      continue;
    }
    if (arg === "--once") {
      parsed.once = true;
      continue;
    }
    if (arg === "--splash") {
      parsed.splash = true;
      continue;
    }
    if (arg === "--no-splash") {
      parsed.splash = false;
      continue;
    }
    throw new Error(`unknown tui argument ${arg}`);
  }
  if (parsed.threadId && parsed.roomRef) {
    throw new Error("tui accepts only one of --thread or --room");
  }
  if (parsed.acceptRunId && parsed.rejectRunId) {
    throw new Error("tui accepts only one of --accept-run or --reject-run");
  }
  return parsed;
}

async function resolveTuiLaunchContext(input: {
  runtime: TuiCliRuntime;
  projectRoot: string;
  threadId?: string;
  roomRef?: string;
}): Promise<TuiLaunchContext> {
  const warnings: string[] = [];
  if (input.threadId) {
    const thread = await input.runtime.conversationThreadRepository.get(input.threadId);
    if (!thread) {
      return { threadId: input.threadId, warnings: [`thread ${input.threadId} not found`] };
    }
    return { projectId: thread.projectId, threadId: thread.id, warnings };
  }

  const project = await input.runtime.projectRepository.getByRootPath(
    path.resolve(input.projectRoot)
  );
  if (!project) {
    const root = path.resolve(input.projectRoot);
    warnings.push(`project root ${root} is not registered`);
    warnings.push(`recovery: agent-hub project add --name <name> --root ${root}`);
    return { warnings };
  }
  if (!input.roomRef) {
    return { projectId: project.id, warnings };
  }
  const room = await findRoomThread(input.runtime, project.id, input.roomRef);
  if (!room) {
    warnings.push(`room ${input.roomRef} not found in project ${project.id}`);
    return { projectId: project.id, warnings };
  }
  return { projectId: project.id, threadId: room.id, warnings };
}

async function buildRenderableTuiModel(input: {
  runtime: TuiCliRuntime;
  modelInput: TuiCurrentContextInput;
  launchWarnings: string[];
  projectRoot: string;
}): Promise<TuiCurrentContextModel> {
  try {
    const model = await buildTuiCurrentContextModel(input.runtime, input.modelInput);
    return mergeLaunchWarnings(model, input.launchWarnings);
  } catch (error) {
    return buildTuiFailureModel({
      modelInput: input.modelInput,
      launchWarnings: input.launchWarnings,
      message: `failed to read TUI context: ${errorMessage(error)}`,
      projectRoot: input.projectRoot
    });
  }
}

function buildTuiFailureModel(input: TuiFailureModelInput): TuiCurrentContextModel {
  const commands = recoveryCommandsForFailure(input);
  const warnings = [
    ...input.launchWarnings,
    input.message,
    ...commands.map((command) => `recovery: ${command}`)
  ];
  return {
    context: {
      projectId: input.modelInput.projectId,
      threadId: input.modelInput.threadId,
      selectedAgent: input.modelInput.selectedAgent,
      contextMode: input.modelInput.contextMode ?? "runtime_injection"
    },
    conversation: [],
    activeRuns: [],
    workBlocks: [],
    transcript: [],
    runs: [],
    roleCalls: {
      nodes: [],
      todos: [],
      counts: {
        total: 0,
        visible: 0,
        active: 0,
        pending: 0,
        waiting: 0,
        failed: 0,
        terminal: 0
      },
      loop: {
        iteration: input.modelInput.iteration ?? 0,
        maxIterations: input.modelInput.maxIterations,
        pendingRoleCallIds: [],
        waitingRoleCallIds: [],
        activeRoleCallIds: [],
        stopReason: "terminal",
        convergenceReason: "idle"
      }
    },
    review: {
      kind: "none",
      title: "TUI context unavailable",
      summary: "The current local context could not be read.",
      evidence: { latestEvent: input.message },
      commands
    },
    tasks: [],
    team: {
      projectId: input.modelInput.projectId,
      roles: [],
      counts: {
        total: 0,
        enabled: 0,
        runnable: 0,
        reserved: 0,
        custom: 0,
        presetOverrides: 0
      },
      command: input.modelInput.projectId
        ? `agent-hub team roles list --project-id ${input.modelInput.projectId}`
        : undefined
    },
    memory: {
      projectId: input.modelInput.projectId,
      counts: { proposed: 0, approved: 0, rejected: 0, retired: 0 },
      rows: [],
      command: input.modelInput.projectId
        ? `agent-hub memory list --project-id ${input.modelInput.projectId}`
        : undefined,
      approvalCommands: input.modelInput.projectId
        ? [`agent-hub memory list --project-id ${input.modelInput.projectId}`]
        : [],
      approvedSource: "Unavailable while the TUI context read failed.",
      approvalReminder: "Retry after local database access is restored."
    },
    skills: {
      contextMode: input.modelInput.contextMode ?? "runtime_injection",
      runtimeSource: "Unavailable while the TUI context read failed.",
      selected: [],
      available: []
    },
    selectionDetails: emptyTuiSelectionDetails(),
    warnings
  };
}

function recoveryCommandsForFailure(input: TuiFailureModelInput): string[] {
  const commands = ["agent-hub project list"];
  if (input.modelInput.projectId) {
    commands.push(`agent-hub rooms list --project-id ${input.modelInput.projectId}`);
  } else {
    commands.push(`agent-hub project add --name <name> --root ${input.projectRoot}`);
  }
  if (input.modelInput.threadId) {
    commands.push(`agent-hub threads show ${input.modelInput.threadId}`);
  }
  commands.push("agent-hub tui --help");
  return commands;
}

async function findRoomThread(
  runtime: TuiCliRuntime,
  projectId: string,
  roomRef: string
): Promise<ConversationThread | undefined> {
  const threads = await runtime.conversationThreadRepository.list(projectId);
  return threads.find(
    (thread) => thread.id === roomRef || roomHandleForThread(thread) === stripHash(roomRef)
  );
}

async function safeSubmitPrompt(
  submitPrompt: TuiPromptSubmitter,
  input: TuiPromptSubmissionInput
): Promise<TuiPromptSubmissionResult> {
  try {
    return await submitPrompt(input);
  } catch (error) {
    return {
      ok: false,
      exitCode: 1,
      projectId: input.projectId,
      threadId: input.threadId,
      message: errorMessage(error)
    };
  }
}

async function safeRecordReviewDecision(
  recordReviewDecision: TuiReviewDecisionRecorder,
  input: TuiReviewDecisionInput
): Promise<TuiReviewDecisionResult> {
  try {
    return await recordReviewDecision(input);
  } catch (error) {
    return {
      ok: false,
      message: errorMessage(error)
    };
  }
}

function submitStatusMessage(
  submission: TuiPromptSubmissionResult,
  selectedAgent: AgentKind
): string {
  if (submission.ok) {
    return submission.message;
  }
  return `${submission.message}; inspect runs with agent-hub runs list; check ${agentAvailabilityCommand(selectedAgent)}.`;
}

function agentAvailabilityCommand(agent: AgentKind): string {
  if (agent === "codex") {
    return "codex --version";
  }
  if (agent === "claude-code") {
    return "claude --version";
  }
  return "agent-hub tui --debug --agent fake --once";
}

function mergeLaunchWarnings(
  model: TuiCurrentContextModel,
  warnings: string[]
): TuiCurrentContextModel {
  if (warnings.length === 0) {
    return model;
  }
  return { ...model, warnings: [...warnings, ...model.warnings] };
}

function isInteractiveTerminal(io: TuiCliIO): boolean {
  const stdin = (io.stdin ?? process.stdin) as NodeJS.ReadableStream & { isTTY?: boolean };
  return Boolean(stdin?.isTTY && io.stdout.isTTY);
}

function hasRawMode(
  input: NodeJS.ReadableStream
): input is NodeJS.ReadStream & { setRawMode(mode: boolean): void } {
  return typeof (input as { setRawMode?: unknown }).setRawMode === "function";
}

function terminalSize(stdout: TuiCliIO["stdout"]): { columns: number; rows: number } {
  return {
    columns: typeof stdout.columns === "number" ? stdout.columns : 120,
    rows: typeof stdout.rows === "number" ? stdout.rows : 40
  };
}

function requiredArgValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} requires a positive integer`);
  }
  return parsed;
}

function roomHandleForThread(thread: ConversationThread): string | undefined {
  const value = thread.metadata?.roomHandle;
  return typeof value === "string" ? value : undefined;
}

function stripHash(value: string): string {
  return value.startsWith("#") ? value.slice(1) : value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
