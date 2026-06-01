import readline from "node:readline";
import path from "node:path";
import {
  buildTuiCurrentContextModel,
  defaultAgentKind,
  parseAgentKindAlias,
  type AgentKind,
  type ConversationThread,
  type ProjectRepository,
  type TuiCurrentContextInput,
  type TuiCurrentContextModel,
  type TuiRoleCallNodeSummary,
  type TuiRunSummary,
  type TuiTaskSummary,
  type TuiReadModelRepositories
} from "@agent-hub/core";

export interface TuiCliIO {
  stdin?: NodeJS.ReadableStream;
  stdout: Pick<NodeJS.WriteStream, "write"> & Partial<Pick<NodeJS.WriteStream, "columns" | "rows" | "isTTY">>;
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

export type TuiFocusMode =
  | "work"
  | "graph"
  | "runs"
  | "review"
  | "tasks"
  | "memory"
  | "help";

export interface TuiShellState {
  focus: TuiFocusMode;
  selectedRunIndex: number;
  selectedRoleCallIndex: number;
  selectedTaskIndex: number;
  hideCompletedRoleCalls: boolean;
  collapsedRoleCallIds: string[];
  composer: string;
  statusMessage?: string;
}

export type TuiKey =
  | "tab"
  | "shift_tab"
  | "up"
  | "down"
  | "left"
  | "right"
  | "enter"
  | "escape"
  | "help"
  | "review"
  | "memory"
  | "skills"
  | "hide_done"
  | "continue_loop"
  | "cancel"
  | "exit"
  | "other";

export interface TuiKeyResult {
  state: TuiShellState;
  exit: boolean;
}

interface ParsedTuiArgs {
  threadId?: string;
  roomRef?: string;
  agentKind?: AgentKind;
  maxIterations?: number;
  submitPrompt?: string;
  workspaceBasePath?: string;
  dryRun: boolean;
  retainOnFailure: boolean;
  debug: boolean;
  once: boolean;
  help: boolean;
}

interface TuiLaunchContext {
  projectId?: string;
  threadId?: string;
  warnings: string[];
}

const focusModes: TuiFocusMode[] = [
  "work",
  "graph",
  "runs",
  "review",
  "tasks",
  "memory",
  "help"
];

const riskRank = new Map([
  ["low", 0],
  ["medium", 1],
  ["high", 2],
  ["blocking", 3]
]);

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
    options.io.stderr.write(`error: ${errorMessage(error)}\n`);
    return 1;
  }

  const state: TuiShellState = {
    focus: "work",
    selectedRunIndex: 0,
    selectedRoleCallIndex: 0,
    selectedTaskIndex: 0,
    hideCompletedRoleCalls: false,
    collapsedRoleCallIds: [],
    composer: parsed.submitPrompt ?? ""
  };
  if (parsed.submitPrompt) {
    if (!options.submitPrompt) {
      options.io.stderr.write("error: TUI prompt submission is unavailable\n");
      return 1;
    }
    const submission = await options.submitPrompt({
      prompt: parsed.submitPrompt,
      projectRoot: options.projectRoot,
      projectId: launch.projectId,
      threadId: launch.threadId,
      roomRef: parsed.roomRef,
      selectedAgent,
      debug: parsed.debug || options.debug === true,
      dryRun: parsed.dryRun,
      retainOnFailure: parsed.retainOnFailure,
      workspaceBasePath: parsed.workspaceBasePath
    });
    launch = {
      projectId: submission.projectId ?? launch.projectId,
      threadId: submission.threadId ?? launch.threadId,
      warnings: launch.warnings
    };
    state.composer = "";
    state.statusMessage = submission.message;
    if (!submission.ok) {
      options.io.stderr.write(`error: ${submission.message}\n`);
    }
  }
  const modelInput: TuiCurrentContextInput = {
    projectId: launch.projectId,
    threadId: launch.threadId,
    selectedAgent,
    maxIterations: parsed.maxIterations,
    hideCompletedRoleCalls: state.hideCompletedRoleCalls
  };
  const model = await buildTuiCurrentContextModel(options.runtime, modelInput);
  const rendered = renderTuiWorkbench(
    mergeLaunchWarnings(model, launch.warnings),
    state,
    terminalSize(options.io.stdout)
  );

  if (parsed.once || !isInteractiveTerminal(options.io)) {
    options.io.stdout.write(rendered);
    return 0;
  }

  return runInteractiveTui({
    io: options.io,
    runtime: options.runtime,
    modelInput,
    initialState: state,
    launchWarnings: launch.warnings,
    submitPrompt: options.submitPrompt,
    submitInput: {
      projectRoot: options.projectRoot,
      roomRef: parsed.roomRef,
      selectedAgent,
      debug: parsed.debug || options.debug === true,
      dryRun: parsed.dryRun,
      retainOnFailure: parsed.retainOnFailure,
      workspaceBasePath: parsed.workspaceBasePath
    }
  });
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
    "  --debug                    Include debug-available agent choices.",
    "  --once                     Render once and exit, useful for smoke tests.",
    "  --help                     Show this help.",
    ""
  ].join("\n");
}

export function createInitialTuiShellState(): TuiShellState {
  return {
    focus: "work",
    selectedRunIndex: 0,
    selectedRoleCallIndex: 0,
    selectedTaskIndex: 0,
    hideCompletedRoleCalls: false,
    collapsedRoleCallIds: [],
    composer: ""
  };
}

export function reduceTuiKey(
  state: TuiShellState,
  key: TuiKey,
  model: TuiCurrentContextModel
): TuiKeyResult {
  const next: TuiShellState = {
    ...state,
    collapsedRoleCallIds: [...state.collapsedRoleCallIds],
    statusMessage: undefined
  };
  if (key === "exit") {
    return { state: next, exit: true };
  }
  if (key === "tab" || key === "shift_tab") {
    next.focus = nextFocus(state.focus, key === "tab" ? 1 : -1);
    return { state: next, exit: false };
  }
  if (key === "help") {
    next.focus = next.focus === "help" ? "work" : "help";
    return { state: next, exit: false };
  }
  if (key === "review") {
    next.focus = "review";
    return { state: next, exit: false };
  }
  if (key === "memory") {
    next.focus = "memory";
    return { state: next, exit: false };
  }
  if (key === "skills") {
    next.focus = "memory";
    next.statusMessage = "Skills are shown with memory and context indicators.";
    return { state: next, exit: false };
  }
  if (key === "hide_done") {
    next.hideCompletedRoleCalls = !next.hideCompletedRoleCalls;
    next.statusMessage = next.hideCompletedRoleCalls
      ? "Completed RoleCalls hidden."
      : "Completed RoleCalls visible.";
    return { state: next, exit: false };
  }
  if (key === "continue_loop") {
    applyContinuePrompt(next, model);
    return { state: next, exit: false };
  }
  if (key === "cancel") {
    next.statusMessage =
      "Cancellation is unavailable for this CLI TUI context; use the owning run service when supported.";
    return { state: next, exit: false };
  }
  if (key === "escape") {
    next.focus = "work";
    return { state: next, exit: false };
  }
  if (key === "enter") {
    next.focus = "review";
    return { state: next, exit: false };
  }
  if (key === "up" || key === "down") {
    moveSelection(next, key, model);
    return { state: next, exit: false };
  }
  if (key === "left" || key === "right") {
    toggleSelectedRoleCallCollapse(next, model, key === "left");
    return { state: next, exit: false };
  }
  return { state: next, exit: false };
}

export function renderTuiWorkbench(
  model: TuiCurrentContextModel,
  state: TuiShellState,
  size: { columns: number; rows: number }
): string {
  const narrow = size.columns < 92;
  const lines = [
    renderHeader(model),
    renderFocusBar(state),
    ...renderWarnings(model),
    ...(state.statusMessage ? [`Status: ${state.statusMessage}`] : []),
    ""
  ];

  if (state.focus === "help") {
    lines.push(...renderHelpPanel());
  } else if (state.focus === "graph") {
    lines.push(...renderGraphPanel(model, state, { includeTitle: true }));
  } else if (state.focus === "runs") {
    lines.push(...renderRunsPanel(model, state, { includeTitle: true }));
  } else if (state.focus === "review") {
    lines.push(...renderReviewPanel(model));
  } else if (state.focus === "tasks") {
    lines.push(...renderTasksPanel(model, state, { includeTitle: true }));
  } else if (state.focus === "memory") {
    lines.push(...renderMemoryPanel(model));
  } else if (narrow) {
    lines.push(
      ...renderGraphPanel(model, state, { includeTitle: true }),
      "",
      ...renderRunsPanel(model, state, { includeTitle: true }),
      "",
      ...renderTranscriptPanel(model, { includeTitle: true })
    );
  } else {
    lines.push(
      ...renderTranscriptPanel(model, { includeTitle: true }),
      "",
      ...renderGraphPanel(model, state, { includeTitle: true }),
      "",
      ...renderRunsPanel(model, state, { includeTitle: true }),
      "",
      ...renderSelectedSummary(model)
    );
  }

  lines.push("", ...renderActionHints(), renderComposerPlaceholder(model, state));
  return fitLines(lines, size.columns, size.rows).join("\n") + "\n";
}

async function runInteractiveTui(input: {
  io: TuiCliIO;
  runtime: TuiCliRuntime;
  modelInput: TuiCurrentContextInput;
  initialState: TuiShellState;
  launchWarnings: string[];
  submitPrompt?: TuiPromptSubmitter;
  submitInput: Omit<TuiPromptSubmissionInput, "prompt" | "projectId" | "threadId">;
}): Promise<number> {
  const stdin = input.io.stdin ?? process.stdin;
  const stdout = input.io.stdout;
  if (!hasRawMode(stdin)) {
    const model = await buildTuiCurrentContextModel(input.runtime, input.modelInput);
    stdout.write(renderTuiWorkbench(mergeLaunchWarnings(model, input.launchWarnings), input.initialState, terminalSize(stdout)));
    return 0;
  }

  let state = input.initialState;
  let modelInput = { ...input.modelInput };
  let rendering = Promise.resolve();

  return new Promise((resolve) => {
    const cleanup = () => {
      stdin.off("keypress", onKeypress);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
    };
    const rerender = () => {
      rendering = rendering
        .then(async () => {
          modelInput = {
            ...modelInput,
            hideCompletedRoleCalls: state.hideCompletedRoleCalls,
            selectedRunId: undefined,
            selectedRoleCallId: undefined
          };
          const model = await buildTuiCurrentContextModel(input.runtime, modelInput);
          stdout.write("\x1b[2J\x1b[H");
          stdout.write(
            renderTuiWorkbench(
              mergeLaunchWarnings(model, input.launchWarnings),
              state,
              terminalSize(stdout)
            )
          );
        })
        .catch((error) => {
          stdout.write(`\nerror: ${errorMessage(error)}\n`);
        });
    };
    const onKeypress = async (chunk: string, key: readline.Key) => {
      await rendering;
      if (isSubmitKey(key)) {
        if (!state.composer.trim()) {
          state = { ...state, statusMessage: "Composer is empty." };
          rerender();
          return;
        }
        if (!input.submitPrompt) {
          state = { ...state, statusMessage: "Prompt submission is unavailable." };
          rerender();
          return;
        }
        const submission = await input.submitPrompt({
          ...input.submitInput,
          prompt: state.composer,
          projectId: modelInput.projectId,
          threadId: modelInput.threadId
        });
        modelInput = {
          ...modelInput,
          projectId: submission.projectId ?? modelInput.projectId,
          threadId: submission.threadId ?? modelInput.threadId
        };
        state = {
          ...state,
          composer: "",
          statusMessage: submission.message
        };
        rerender();
        return;
      }
      if (key.name === "backspace" || key.name === "delete") {
        state = { ...state, composer: state.composer.slice(0, -1) };
        rerender();
        return;
      }
      if (isPrintableChunk(chunk, key)) {
        state = { ...state, composer: `${state.composer}${chunk}` };
        rerender();
        return;
      }
      const model = await buildTuiCurrentContextModel(input.runtime, modelInput);
      const result = reduceTuiKey(
        state,
        tuiKeyFromReadlineKey(key),
        mergeLaunchWarnings(model, input.launchWarnings)
      );
      state = result.state;
      if (result.exit) {
        cleanup();
        resolve(0);
        return;
      }
      rerender();
    };

    readline.emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("keypress", onKeypress);
    rerender();
  });
}

function parseTuiArgs(args: string[]): ParsedTuiArgs {
  const parsed: ParsedTuiArgs = {
    debug: false,
    dryRun: false,
    retainOnFailure: false,
    once: false,
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
    if (arg === "--debug") {
      parsed.debug = true;
      continue;
    }
    if (arg === "--once") {
      parsed.once = true;
      continue;
    }
    throw new Error(`unknown tui argument ${arg}`);
  }
  if (parsed.threadId && parsed.roomRef) {
    throw new Error("tui accepts only one of --thread or --room");
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
    warnings.push(
      `project root ${path.resolve(input.projectRoot)} is not registered; run agent-hub project add first`
    );
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

function renderHeader(model: TuiCurrentContextModel): string {
  const project = model.context.projectName ?? model.context.projectId ?? "unregistered";
  const room = model.context.roomHandle
    ? `#${model.context.roomHandle}`
    : model.context.threadTitle ?? model.context.threadId ?? "no-thread";
  const agent = model.context.selectedAgent ? `@${model.context.selectedAgent}` : "@agent";
  const risk = highestRisk(model);
  const loop = model.roleCalls.loop.maxIterations === undefined
    ? `iter ${model.roleCalls.loop.iteration}`
    : `iter ${model.roleCalls.loop.iteration}/${model.roleCalls.loop.maxIterations}`;
  return [
    "Agent Hub",
    project,
    room,
    agent,
    `ctx ${model.context.contextMode}`,
    loop,
    `risk ${risk}`
  ].join("  ");
}

function renderFocusBar(state: TuiShellState): string {
  return focusModes
    .map((mode) => (mode === state.focus ? `[${label(mode)}]` : label(mode)))
    .join("  ");
}

function renderWarnings(model: TuiCurrentContextModel): string[] {
  return model.warnings.map((warning) => `Warning: ${warning}`);
}

function renderTranscriptPanel(
  model: TuiCurrentContextModel,
  options: { includeTitle: boolean }
): string[] {
  const lines = options.includeTitle ? ["Transcript"] : [];
  if (model.transcript.length === 0) {
    return [...lines, "  No messages in the current context."];
  }
  return [
    ...lines,
    ...model.transcript.flatMap((message) => [
      `${message.author}${message.runId ? ` ${message.runId}` : ""}`,
      `  ${message.content || "(empty)"}`
    ])
  ];
}

function renderGraphPanel(
  model: TuiCurrentContextModel,
  state: TuiShellState,
  options: { includeTitle: boolean }
): string[] {
  const visibleNodes = graphNodesForState(model.roleCalls.nodes, state);
  const counts = model.roleCalls.counts;
  const lines = options.includeTitle
    ? [
        `RoleCall Graph  active ${counts.active}  waiting ${counts.waiting}  pending ${counts.pending}  stop ${model.roleCalls.loop.stopReason}`
      ]
    : [];
  if (visibleNodes.length === 0) {
    return [...lines, "  No RoleCalls in the current context."];
  }
  return [
    ...lines,
    ...visibleNodes.map((node, index) => {
      const selected = index === boundedIndex(state.selectedRoleCallIndex, visibleNodes.length)
        ? ">"
        : " ";
      const branch = node.depth > 0 ? `${"  ".repeat(node.depth)}|-- ` : "";
      const collapsed = state.collapsedRoleCallIds.includes(node.id) ? " [+]" : "";
      const run = node.linkedRunId ? ` ${node.linkedRunId}` : "";
      const waiting = node.evidence.waitingReason ? ` ${node.evidence.waitingReason}` : "";
      return `${selected} ${branch}@${node.callerRole} -> @${node.calleeRole} [${node.statusLabel}]${run}${collapsed} ${node.task}${waiting}`;
    }),
    "",
    ...renderLoopDetail(model)
  ];
}

function renderLoopDetail(model: TuiCurrentContextModel): string[] {
  const loop = model.roleCalls.loop;
  const iteration = loop.maxIterations === undefined
    ? `${loop.iteration}`
    : `${loop.iteration}/${loop.maxIterations}`;
  return [
    "Loop",
    `  iteration ${iteration}`,
    `  active ${loop.activeRoleCallIds.length}`,
    `  pending ${loop.pendingRoleCallIds.length}`,
    `  waiting ${loop.waitingRoleCallIds.length}`,
    `  stop ${loop.stopReason}`,
    `  convergence ${loop.convergenceReason}`
  ];
}

function renderRunsPanel(
  model: TuiCurrentContextModel,
  state: TuiShellState,
  options: { includeTitle: boolean }
): string[] {
  const lines = options.includeTitle ? ["Runs"] : [];
  if (model.runs.length === 0) {
    return [...lines, "  No runs in the current context."];
  }
  const selectedRun = model.runs[boundedIndex(state.selectedRunIndex, model.runs.length)];
  return [
    ...lines,
    ...model.runs.map((run, index) => {
      const selected = index === boundedIndex(state.selectedRunIndex, model.runs.length)
        ? ">"
        : " ";
      const checks = run.evidence.checks
        ? ` checks ${run.evidence.checks.passed}/${run.evidence.checks.failed}/${run.evidence.checks.skipped}`
        : "";
      const risk = run.evidence.risk ? ` risk ${run.evidence.risk.level}` : "";
      const diff = run.evidence.diff ? ` files ${run.evidence.diff.changedFiles}` : "";
      return `${selected} ${run.id} @${run.agentKind} ${run.status} ${run.stage}${checks}${risk}${diff}`;
    }),
    "",
    ...renderRunOperatingDetail(selectedRun)
  ];
}

function renderRunOperatingDetail(run: TuiRunSummary | undefined): string[] {
  if (!run) {
    return [];
  }
  return [
    `Selected Run ${run.id}`,
    `  task ${run.taskTitle ?? run.taskId}`,
    `  status ${run.status}`,
    `  stage ${run.stage}`,
    `  retained_worktree ${run.retainedWorktree ? "yes" : "no"}`,
    ...evidenceLines(run.evidence),
    ...commandLines(run.commands)
  ];
}

function renderSelectedSummary(model: TuiCurrentContextModel): string[] {
  return [
    "Selected",
    `${model.review.title}`,
    `  ${model.review.summary}`,
    ...evidenceLines(model.review.evidence),
    ...commandLines(model.review.commands)
  ];
}

function renderReviewPanel(model: TuiCurrentContextModel): string[] {
  return [
    `Review ${model.review.selectedId ?? "none"}`,
    model.review.title,
    `  ${model.review.summary}`,
    ...evidenceLines(model.review.evidence),
    ...commandLines(model.review.commands)
  ];
}

function renderTasksPanel(
  model: TuiCurrentContextModel,
  state: TuiShellState,
  options: { includeTitle: boolean }
): string[] {
  const lines = options.includeTitle ? ["Tasks"] : [];
  if (model.tasks.length === 0) {
    return [...lines, "  No current-context tasks."];
  }
  const selectedTask = model.tasks[boundedIndex(state.selectedTaskIndex, model.tasks.length)];
  return [
    ...lines,
    ...model.tasks.map((task, index) =>
      renderTaskLine(
        task,
        index,
        index === boundedIndex(state.selectedTaskIndex, model.tasks.length)
      )
    ),
    "",
    ...renderTaskOperatingDetail(selectedTask)
  ];
}

function renderTaskLine(
  task: TuiTaskSummary,
  index: number,
  selectedTask: boolean
): string {
  const selected = selectedTask ? ">" : " ";
  const assignments = task.assignments
    .map((assignment) => `${assignment.label}:${assignment.status}`)
    .join(", ");
  return `${selected} ${task.id} ${task.status} ${task.title} assignments ${task.assignmentCount}${task.nextAction ? ` next ${task.nextAction}` : ""}${assignments ? ` (${assignments})` : ""}`;
}

function renderTaskOperatingDetail(task: TuiTaskSummary | undefined): string[] {
  if (!task) {
    return [];
  }
  return [
    `Selected Task ${task.id}`,
    `  goal ${task.title}`,
    `  status ${task.status}`,
    `  next ${task.nextAction ?? "wait"}`,
    "  assignments:",
    ...(task.assignments.length === 0
      ? ["    none"]
      : task.assignments.map((assignment) =>
          `    ${assignment.label} ${assignment.status}${assignment.runId ? ` ${assignment.runId}` : ""}`
        )),
    "  role_todos:",
    ...(task.roleTodos.length === 0
      ? ["    none"]
      : task.roleTodos.map((todo) => `    @${todo.role} ${todo.status}: ${todo.title}`)),
    "  follow_ups:",
    ...(task.followUps.length === 0
      ? ["    none"]
      : task.followUps.map((item) => `    ${item}`))
  ];
}

function renderMemoryPanel(model: TuiCurrentContextModel): string[] {
  const selectedSkills =
    model.skills.selected.length === 0
      ? "none"
      : model.skills.selected.map((skill) => `${skill.scope}:${skill.id}`).join(", ");
  const availableSkills =
    model.skills.available.length === 0
      ? "none"
      : model.skills.available.map((skill) => `${skill.scope}:${skill.id}`).join(", ");
  return [
    "Memory",
    `  proposed ${model.memory.counts.proposed}`,
    `  approved ${model.memory.counts.approved}`,
    `  rejected ${model.memory.counts.rejected}`,
    `  next ${model.memory.command ?? "register a project before listing memory"}`,
    "Skills",
    `  selected ${selectedSkills}`,
    `  available ${availableSkills}`,
    `  source ${model.skills.runtimeSource}`,
    "Context",
    `  mode ${model.skills.contextMode}`
  ];
}

function renderHelpPanel(): string[] {
  return [
    "Help",
    "  tab / shift-tab   switch focus",
    "  up/down           move selection",
    "  left/right        collapse or expand selected RoleCall subtree",
    "  enter             open selected review summary",
    "  c                 prepare bounded continuation prompt",
    "  k                 cancel selected running item when supported",
    "  ctrl+j            submit composer prompt",
    "  r                 review summary",
    "  h                 toggle completed RoleCalls",
    "  m                 memory summary",
    "  s                 skills/context summary",
    "  ?                 help",
    "  esc               work view",
    "  x or ctrl+c       exit",
    "",
    "Commands",
    "  agent-hub runs show <run-id>",
    "  agent-hub runs diff <run-id> --stat",
    "  agent-hub risks show <run-id>",
    "  agent-hub role-calls show <role-call-id>",
    "  agent-hub memory list --project-id <project-id>"
  ];
}

function renderActionHints(): string[] {
  return [
    "Actions: tab focus  enter open  c continue  k cancel  ctrl+j submit  r review  h hide done  m memory  ? help  x exit"
  ];
}

function renderComposerPlaceholder(
  model: TuiCurrentContextModel,
  state: TuiShellState
): string {
  const agent = model.context.selectedAgent ? `@${model.context.selectedAgent}` : "@agent";
  return `> ${state.composer || `${agent} prompt`}`;
}

function evidenceLines(evidence: TuiCurrentContextModel["review"]["evidence"]): string[] {
  const lines: string[] = [];
  if (evidence.linkedRunId) {
    lines.push(`  linked_run ${evidence.linkedRunId}`);
  }
  if (evidence.latestEvent) {
    lines.push(`  latest ${evidence.latestEvent}`);
  }
  if (evidence.waitingReason) {
    lines.push(`  waiting ${evidence.waitingReason}`);
  }
  if (evidence.checks) {
    lines.push(
      `  checks passed ${evidence.checks.passed} failed ${evidence.checks.failed} skipped ${evidence.checks.skipped}`
    );
  }
  if (evidence.risk) {
    lines.push(`  risk ${evidence.risk.level}${evidence.risk.primaryReason ? ` ${evidence.risk.primaryReason}` : ""}`);
  }
  if (evidence.diff) {
    lines.push(
      `  changed ${evidence.diff.changedFiles} files +${evidence.diff.insertions ?? 0} -${evidence.diff.deletions ?? 0}`
    );
  }
  return lines;
}

function commandLines(commands: string[]): string[] {
  if (commands.length === 0) {
    return [];
  }
  return ["  commands:", ...commands.map((command) => `    ${command}`)];
}

function moveSelection(
  state: TuiShellState,
  key: "up" | "down",
  model: TuiCurrentContextModel
): void {
  const delta = key === "down" ? 1 : -1;
  if (state.focus === "runs") {
    state.selectedRunIndex = clampIndex(state.selectedRunIndex + delta, model.runs.length);
    return;
  }
  if (state.focus === "tasks") {
    state.selectedTaskIndex = clampIndex(state.selectedTaskIndex + delta, model.tasks.length);
    return;
  }
  state.selectedRoleCallIndex = clampIndex(
    state.selectedRoleCallIndex + delta,
    graphNodesForState(model.roleCalls.nodes, state).length
  );
}

function toggleSelectedRoleCallCollapse(
  state: TuiShellState,
  model: TuiCurrentContextModel,
  collapse: boolean
): void {
  const nodes = graphNodesForState(model.roleCalls.nodes, state);
  const selected = nodes[boundedIndex(state.selectedRoleCallIndex, nodes.length)];
  if (!selected) {
    return;
  }
  const collapsed = new Set(state.collapsedRoleCallIds);
  if (collapse) {
    collapsed.add(selected.id);
    state.statusMessage = `Collapsed ${selected.id}.`;
  } else {
    collapsed.delete(selected.id);
    state.statusMessage = `Expanded ${selected.id}.`;
  }
  state.collapsedRoleCallIds = [...collapsed];
}

function graphNodesForState(
  nodes: TuiRoleCallNodeSummary[],
  state: TuiShellState
): TuiRoleCallNodeSummary[] {
  if (state.collapsedRoleCallIds.length === 0) {
    return nodes;
  }
  const collapsed = new Set(state.collapsedRoleCallIds);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return nodes.filter((node) => {
    let parentId = node.parentRoleCallId;
    while (parentId) {
      if (collapsed.has(parentId)) {
        return false;
      }
      parentId = byId.get(parentId)?.parentRoleCallId;
    }
    return true;
  });
}

function nextFocus(current: TuiFocusMode, delta: number): TuiFocusMode {
  const index = focusModes.indexOf(current);
  const next = (index + delta + focusModes.length) % focusModes.length;
  return focusModes[next];
}

function highestRisk(model: TuiCurrentContextModel): string {
  const levels = [
    ...model.runs.map((run) => run.evidence.risk?.level),
    ...model.roleCalls.nodes.map((node) => node.evidence.risk?.level)
  ].filter((level): level is NonNullable<typeof level> => level !== undefined);
  if (levels.length === 0) {
    return "unknown";
  }
  return levels.sort(
    (left, right) => (riskRank.get(right) ?? -1) - (riskRank.get(left) ?? -1)
  )[0];
}

function tuiKeyFromReadlineKey(key: readline.Key): TuiKey {
  if (key.ctrl && key.name === "c") {
    return "exit";
  }
  if (key.name === "x" || key.name === "q") {
    return "exit";
  }
  if (key.name === "tab") {
    return key.shift ? "shift_tab" : "tab";
  }
  if (key.name === "up") {
    return "up";
  }
  if (key.name === "down") {
    return "down";
  }
  if (key.name === "left") {
    return "left";
  }
  if (key.name === "right") {
    return "right";
  }
  if (key.name === "return") {
    return "enter";
  }
  if (key.name === "escape") {
    return "escape";
  }
  if (key.sequence === "?") {
    return "help";
  }
  if (key.name === "r") {
    return "review";
  }
  if (key.name === "m") {
    return "memory";
  }
  if (key.name === "s") {
    return "skills";
  }
  if (key.name === "h") {
    return "hide_done";
  }
  if (key.name === "c") {
    return "continue_loop";
  }
  if (key.name === "k") {
    return "cancel";
  }
  return "other";
}

function applyContinuePrompt(
  state: TuiShellState,
  model: TuiCurrentContextModel
): void {
  const stopReason = model.roleCalls.loop.stopReason;
  if (stopReason !== "terminal" && stopReason !== "none") {
    state.statusMessage = `Cannot continue: ${stopReason}.`;
    return;
  }
  const nodes = graphNodesForState(model.roleCalls.nodes, state);
  const selected = nodes[boundedIndex(state.selectedRoleCallIndex, nodes.length)];
  state.composer = selected
    ? `Continue @${selected.calleeRole} on RoleCall ${selected.id}: ${selected.task}`
    : "Continue the current task with the selected agent.";
  state.statusMessage = "Continuation prompt prepared; press ctrl+j to submit.";
}

function isSubmitKey(key: readline.Key): boolean {
  return Boolean(key.ctrl && (key.name === "j" || key.name === "return"));
}

function isPrintableChunk(chunk: string, key: readline.Key): boolean {
  return (
    chunk.length === 1 &&
    !key.ctrl &&
    !key.meta &&
    chunk >= " " &&
    chunk !== "\u007f"
  );
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
  const stdin = io.stdin as (NodeJS.ReadableStream & { isTTY?: boolean }) | undefined;
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

function fitLines(lines: string[], columns: number, rows: number): string[] {
  const fitted = lines.map((line) => fitLine(line, columns));
  if (fitted.length <= rows) {
    return fitted;
  }
  return [...fitted.slice(0, Math.max(0, rows - 1)), "-- more hidden --"];
}

function fitLine(line: string, columns: number): string {
  if (columns <= 0 || line.length <= columns) {
    return line;
  }
  return `${line.slice(0, Math.max(0, columns - 3))}...`;
}

function boundedIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return Math.min(Math.max(index, 0), length - 1);
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return Math.min(Math.max(index, 0), length - 1);
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

function label(mode: TuiFocusMode): string {
  return mode[0].toUpperCase() + mode.slice(1);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
