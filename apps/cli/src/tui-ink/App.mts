import React, { useState } from "react";
import {
  Box,
  Text,
  useApp,
  useInput,
  type Key
} from "ink";
import type { TuiCurrentContextModel } from "@agent-hub/core";
import {
  compactId,
  evidenceItems,
  highestRisk,
  runLine,
  truncateText
} from "./format.mjs";
import {
  commandHintForFocus,
  createInitialInkState,
  focusModes,
  reduceInkState,
  selectedReviewRunId,
  selectedRun,
  selectedTask,
  unavailableRoleExecutorCommands,
  visibleRoleCalls,
  type TuiInkKey,
  type TuiInkState
} from "./state.mjs";

const h = React.createElement;

export interface TuiInkTerminalSize {
  columns: number;
  rows: number;
}

export interface TuiInkSubmitInput {
  prompt: string;
  projectId?: string;
  threadId?: string;
}

export interface TuiInkSubmitResult {
  ok: boolean;
  message: string;
  model?: TuiCurrentContextModel;
}

export interface TuiInkReviewInput {
  runId: string;
  status: "accepted" | "rejected";
  reason?: string;
}

export interface TuiInkReviewResult {
  ok: boolean;
  message: string;
  model?: TuiCurrentContextModel;
}

export interface TuiInkFrameProps {
  model: TuiCurrentContextModel;
  state?: TuiInkState;
  terminal: TuiInkTerminalSize;
}

export interface TuiInkAppProps extends TuiInkFrameProps {
  interactive: boolean;
  loadModel?: (state: TuiInkState) => Promise<TuiCurrentContextModel>;
  submitPrompt?: (input: TuiInkSubmitInput) => Promise<TuiInkSubmitResult>;
  recordReviewDecision?: (input: TuiInkReviewInput) => Promise<TuiInkReviewResult>;
}

export function TuiInkApp(props: TuiInkAppProps): React.ReactElement {
  const app = useApp();
  const [model, setModel] = useState(props.model);
  const [state, setState] = useState(props.state ?? createInitialInkState());
  const [busy, setBusy] = useState(false);

  const refreshModel = async (nextState: TuiInkState) => {
    if (!props.loadModel) {
      return;
    }
    try {
      setModel(await props.loadModel(nextState));
    } catch (error) {
      setState({
        ...nextState,
        statusMessage: error instanceof Error ? error.message : String(error)
      });
    }
  };

  const applyKey = (key: TuiInkKey) => {
    const nextState = reduceInkState(state, key, model);
    setState(nextState);
  };

  const submitComposer = async () => {
    const prompt = state.composer.trim();
    if (!prompt) {
      setState({ ...state, statusMessage: "Composer is empty." });
      return;
    }
    if (!props.submitPrompt) {
      setState({ ...state, statusMessage: "Prompt submission is unavailable." });
      return;
    }
    setBusy(true);
    const result = await props.submitPrompt({
      prompt,
      projectId: model.context.projectId,
      threadId: model.context.threadId
    });
    const nextState = {
      ...state,
      composer: "",
      statusMessage: result.message
    };
    setState(nextState);
    if (result.model) {
      setModel(result.model);
    } else {
      await refreshModel(nextState);
    }
    setBusy(false);
  };

  const recordDecision = async (status: "accepted" | "rejected") => {
    if (!props.recordReviewDecision) {
      setState({ ...state, statusMessage: "Review decisions are unavailable." });
      return;
    }
    const runId = selectedReviewRunId(model, state);
    if (!runId) {
      setState({ ...state, statusMessage: "No linked run is selected for review." });
      return;
    }
    setBusy(true);
    const result = await props.recordReviewDecision({
      runId,
      status,
      reason: status === "rejected" ? "Rejected from TUI review shortcut." : undefined
    });
    const nextState = {
      ...state,
      focus: "review" as const,
      statusMessage: result.message
    };
    setState(nextState);
    if (result.model) {
      setModel(result.model);
    } else {
      await refreshModel(nextState);
    }
    setBusy(false);
  };

  useInput(
    (input, key) => {
      if (key.ctrl && (input === "c" || input === "C")) {
        app.exit();
        return;
      }
      if (key.ctrl && (input === "j" || key.return)) {
        void submitComposer();
        return;
      }
      if (input === "x" || input === "q") {
        app.exit();
        return;
      }
      if (input === "a") {
        void recordDecision("accepted");
        return;
      }
      if (input === "j" && state.focus === "review") {
        void recordDecision("rejected");
        return;
      }
      const mapped = keyToAction(input, key, state.focus);
      if (mapped) {
        applyKey(mapped);
        return;
      }
      if (key.backspace || key.delete) {
        setState({ ...state, composer: state.composer.slice(0, -1) });
        return;
      }
      if (isPrintableInput(input, key)) {
        setState({ ...state, composer: `${state.composer}${input}` });
      }
    },
    { isActive: props.interactive && !busy }
  );

  return h(TuiInkFrame, {
    model,
    state: busy ? { ...state, statusMessage: state.statusMessage ?? "Working..." } : state,
    terminal: props.terminal
  });
}

export function TuiInkFrame({
  model,
  state = createInitialInkState(),
  terminal
}: TuiInkFrameProps): React.ReactElement {
  const width = terminal.columns;
  return h(
    Box,
    { flexDirection: "column", width },
    h(HeaderBar, { model }),
    h(FocusTabs, { state }),
    ...model.warnings.map((warning) => line(`! ${warning}`, { color: "yellow" })),
    ...(state.statusMessage ? [line(`Status: ${state.statusMessage}`, { color: "green" })] : []),
    line(""),
    h(MainView, { model, state, terminal }),
    line(""),
    h(Composer, { model, state }),
    h(StatusBar, { model, state })
  );
}

function HeaderBar({ model }: { model: TuiCurrentContextModel }): React.ReactElement {
  const project = model.context.projectName ?? model.context.projectId ?? "unregistered";
  const room = model.context.roomHandle
    ? `#${model.context.roomHandle}`
    : model.context.threadTitle ?? model.context.threadId ?? "no-thread";
  const agent = model.context.selectedAgent ? `@${model.context.selectedAgent}` : "@agent";
  const loop = model.roleCalls.loop.maxIterations === undefined
    ? `iter ${model.roleCalls.loop.iteration}`
    : `iter ${model.roleCalls.loop.iteration}/${model.roleCalls.loop.maxIterations}`;
  return h(
    Box,
    { flexDirection: "column" },
    line(
      `Agent Hub  ${project}  ${room}  ${agent}  ctx ${model.context.contextMode}  ${loop}  risk ${highestRisk(model)}`,
      { bold: true, color: "cyan" }
    )
  );
}

function FocusTabs({ state }: { state: TuiInkState }): React.ReactElement {
  return h(
    Box,
    { flexDirection: "row" },
    ...focusModes.map((mode) =>
      h(
        Box,
        { key: mode, marginRight: 1 },
        line(mode === state.focus ? `[${label(mode)}]` : label(mode), {
          color: mode === state.focus ? "green" : undefined,
          bold: mode === state.focus
        })
      )
    )
  );
}

function MainView(props: TuiInkFrameProps): React.ReactElement {
  const { model, state = createInitialInkState(), terminal } = props;
  if (state.commandPaletteOpen) {
    return h(CommandPalette, { model, state });
  }
  if (state.focus === "help") {
    return h(HelpPane);
  }
  if (state.focus === "graph") {
    return h(RoleCallsPane, { model, state, detail: true });
  }
  if (state.focus === "runs") {
    return h(RunsPane, { model, state, detail: true });
  }
  if (state.focus === "review") {
    return h(ReviewPane, { model, state, detail: true });
  }
  if (state.focus === "tasks") {
    return h(TasksPane, { model, state });
  }
  if (state.focus === "memory") {
    return h(MemoryPane, { model });
  }
  return h(WorkView, { model, state, terminal });
}

function WorkView({ model, state, terminal }: Required<TuiInkFrameProps>): React.ReactElement {
  if (terminal.columns >= 120) {
    return h(
      Box,
      { flexDirection: "row", columnGap: 2 },
      h(Pane, { title: "Runs", width: 38 }, h(RunsPane, { model, state })),
      h(Pane, { title: "Review", width: 42 }, h(ReviewPane, { model, state })),
      h(
        Pane,
        { title: "RoleCalls", flexGrow: 1 },
        h(RoleCallsPane, { model, state }),
        line(""),
        h(TranscriptPane, { model })
      )
    );
  }
  if (terminal.columns >= 90) {
    return h(
      Box,
      { flexDirection: "row", columnGap: 2 },
      h(
        Pane,
        { title: "Runs + Review", width: Math.floor(terminal.columns * 0.52) },
        h(RunsPane, { model, state }),
        line(""),
        h(ReviewPane, { model, state })
      ),
      h(
        Pane,
        { title: "RoleCalls + Transcript", flexGrow: 1 },
        h(RoleCallsPane, { model, state }),
        line(""),
        h(TranscriptPane, { model })
      )
    );
  }
  return h(
    Box,
    { flexDirection: "column" },
    h(Pane, { title: "Runs" }, h(RunsPane, { model, state })),
    line(""),
    h(Pane, { title: "Review" }, h(ReviewPane, { model, state })),
    line(""),
    h(Pane, { title: "RoleCalls" }, h(RoleCallsPane, { model, state })),
    line(""),
    h(TranscriptPane, { model })
  );
}

function RunsPane({
  model,
  state,
  detail = false
}: {
  model: TuiCurrentContextModel;
  state: TuiInkState;
  detail?: boolean;
}): React.ReactElement {
  if (model.runs.length === 0) {
    return block(line("No runs in the current context.", { dimColor: true }));
  }
  const activeRun = selectedRun(model, state);
  return block(
    ...model.runs.slice(0, 8).map((run, index) =>
      line(runLine(run, run.id === activeRun?.id), {
        color: run.id === activeRun?.id ? "green" : undefined
      })
    ),
    ...(detail && activeRun
      ? [
          line(""),
          line(`${activeRun.taskTitle ?? activeRun.taskId}`, { bold: true }),
          line(`stage ${activeRun.stage}  retained ${activeRun.retainedWorktree ? "yes" : "no"}  review ${activeRun.reviewDecision.status}`),
          ...evidenceItems(activeRun.evidence).map((item) => line(item)),
          ...activeRun.commands.slice(0, 4).map((command) => line(command, { dimColor: true }))
        ]
      : [])
  );
}

function ReviewPane({
  model,
  state,
  detail = false
}: {
  model: TuiCurrentContextModel;
  state: TuiInkState;
  detail?: boolean;
}): React.ReactElement {
  const run = selectedRun(model, state);
  return block(
    line(
      model.review.selectedId
        ? `${model.review.title} (${compactId(model.review.selectedId)})`
        : model.review.title,
      { bold: true }
    ),
    line(model.review.summary),
    ...(run ? [line(`selected ${compactId(run.id)}  review ${run.reviewDecision.status}`)] : []),
    ...evidenceItems(model.review.evidence).map((item) => line(item)),
    ...(detail ? model.review.commands.slice(0, 5).map((command) => line(command, { dimColor: true })) : [])
  );
}

function RoleCallsPane({
  model,
  state,
  detail = false
}: {
  model: TuiCurrentContextModel;
  state: TuiInkState;
  detail?: boolean;
}): React.ReactElement {
  const nodes = visibleRoleCalls(model, state);
  if (nodes.length === 0) {
    return block(
      line(
        `none | loop stop ${model.roleCalls.loop.stopReason} | pending ${model.roleCalls.loop.pendingRoleCallIds.length}`
      )
    );
  }
  return block(
    line(
      `active ${model.roleCalls.counts.active} waiting ${model.roleCalls.counts.waiting} pending ${model.roleCalls.counts.pending} stop ${model.roleCalls.loop.stopReason}`,
      { dimColor: true }
    ),
    ...nodes.slice(0, detail ? 12 : 5).map((node, index) => {
      const selected = index === state.selectedRoleCallIndex;
      const indent = "  ".repeat(node.depth);
      const run = node.linkedRunId ? ` ${compactId(node.linkedRunId)}` : "";
      return line(
        `${selected ? ">" : " "} ${indent}@${node.callerRole} -> @${node.calleeRole} [${node.statusLabel}]${run} ${truncateText(node.task, 58)}`,
        { color: selected ? "green" : undefined }
      );
    })
  );
}

function TranscriptPane({ model }: { model: TuiCurrentContextModel }): React.ReactElement {
  if (model.transcript.length === 0) {
    return block(line("Transcript", { bold: true }), line("No messages in the current context.", { dimColor: true }));
  }
  return block(
    line("Transcript", { bold: true }),
    ...model.transcript.slice(-5).flatMap((message) => [
      line(`${message.author}${message.runId ? ` ${compactId(message.runId)}` : ""}`, {
        color: "cyan"
      }),
      line(`  ${truncateText(message.content || "(empty)", 90)}`)
    ])
  );
}

function TasksPane({ model, state }: { model: TuiCurrentContextModel; state: TuiInkState }): React.ReactElement {
  if (model.tasks.length === 0) {
    return h(Pane, { title: "Tasks" }, line("No current-context tasks.", { dimColor: true }));
  }
  const task = selectedTask(model, state);
  return h(
    Pane,
    { title: `Tasks ${model.tasks.length}` },
    ...model.tasks.slice(0, 8).map((item, index) =>
      line(`${index === state.selectedTaskIndex ? ">" : " "} ${item.id} ${item.status} ${truncateText(item.title, 72)}${item.nextAction ? ` next ${item.nextAction}` : ""}`)
    ),
    ...(task
      ? [
          line(""),
          line(`Selected ${task.id}`, { bold: true }),
          ...task.assignments.map((assignment) =>
            line(`${assignment.label} ${assignment.status}${assignment.executable ? "" : " executor_unavailable"}`)
          ),
          ...unavailableRoleExecutorCommands(model.context.projectId, task).map((command) =>
            line(command, { dimColor: true })
          )
        ]
      : [])
  );
}

function MemoryPane({ model }: { model: TuiCurrentContextModel }): React.ReactElement {
  const selectedSkills =
    model.skills.selected.length === 0
      ? "none"
      : model.skills.selected.map((skill) => `${skill.scope}:${skill.id}`).join(", ");
  const availableSkills =
    model.skills.available.length === 0
      ? "none"
      : model.skills.available.map((skill) => `${skill.scope}:${skill.id}`).join(", ");
  return h(
    Pane,
    { title: "Memory + Skills" },
    line(`proposed ${model.memory.counts.proposed} approved ${model.memory.counts.approved} rejected ${model.memory.counts.rejected}`),
    line(`approved_source ${model.memory.approvedSource}`),
    line(`reminder ${model.memory.approvalReminder}`),
    line(`next ${model.memory.command ?? "register a project before listing memory"}`),
    ...model.memory.approvalCommands.map((command) => line(command, { dimColor: true })),
    line(""),
    line(`selected ${selectedSkills}`),
    line(`available ${availableSkills}`),
    line(`source ${model.skills.runtimeSource}`),
    line(`mode ${model.skills.contextMode}`)
  );
}

function CommandPalette({
  model,
  state
}: {
  model: TuiCurrentContextModel;
  state: TuiInkState;
}): React.ReactElement {
  const run = selectedRun(model, state);
  return h(
    Pane,
    { title: "Command Palette" },
    line(`focus ${state.focus}`),
    line(commandHintForFocus(model, state), { color: "green" }),
    line(""),
    ...(run ? run.commands.map((command) => line(command)) : [line("no run selected")]),
    ...model.review.commands.map((command) => line(command)),
    ...model.memory.approvalCommands.map((command) => line(command))
  );
}

function HelpPane(): React.ReactElement {
  return h(
    Pane,
    { title: "Help" },
    line("tab/shift-tab focus   up/down or k/j move   enter review"),
    line(": commands   c continue   a accept review   j reject in Review"),
    line("ctrl+j submit composer   h hide done   m memory   ? help   x exit")
  );
}

function Composer({ model, state }: { model: TuiCurrentContextModel; state: TuiInkState }): React.ReactElement {
  const agent = model.context.selectedAgent ? `@${model.context.selectedAgent}` : "@agent";
  return line(`> ${state.composer || `${agent} prompt`}`, { color: "green" });
}

function StatusBar({ model, state }: { model: TuiCurrentContextModel; state: TuiInkState }): React.ReactElement {
  return line(
    `tab focus | enter review | : palette | p command | ? help | x exit | ${commandHintForFocus(model, state)}`,
    { dimColor: true }
  );
}

function Pane({
  title,
  children,
  width,
  flexGrow
}: {
  title: string;
  children?: React.ReactNode;
  width?: number;
  flexGrow?: number;
}): React.ReactElement {
  return h(
    Box,
    { flexDirection: "column", width, flexGrow, flexShrink: width ? 0 : 1 },
    line(title, { bold: true, color: "cyan" }),
    ...React.Children.toArray(children)
  );
}

function block(...children: React.ReactElement[]): React.ReactElement {
  return h(Box, { flexDirection: "column" }, ...children);
}

function line(
  value: string,
  options: { color?: string; bold?: boolean; dimColor?: boolean } = {}
): React.ReactElement {
  return h(Text, { wrap: "truncate", ...options }, value);
}

function keyToAction(input: string, key: Key, focus: string): TuiInkKey | undefined {
  if (key.tab) {
    return key.shift ? "shift_tab" : "tab";
  }
  if (key.upArrow || input === "k") {
    return "up";
  }
  if (key.downArrow || input === "j") {
    return focus === "review" ? undefined : "down";
  }
  if (key.leftArrow) {
    return "left";
  }
  if (key.rightArrow) {
    return "right";
  }
  if (key.return) {
    return "enter";
  }
  if (key.escape) {
    return "escape";
  }
  if (input === "?") {
    return "help";
  }
  if (input === "r") {
    return "review";
  }
  if (input === "m") {
    return "memory";
  }
  if (input === "s") {
    return "skills";
  }
  if (input === "h") {
    return "hide_done";
  }
  if (input === "c") {
    return "continue_loop";
  }
  if (input === "p") {
    return "print_commands";
  }
  if (input === ":") {
    return "palette";
  }
  return undefined;
}

function isPrintableInput(input: string, key: Key): boolean {
  return (
    input.length > 0 &&
    !key.ctrl &&
    !key.meta &&
    !key.upArrow &&
    !key.downArrow &&
    !key.leftArrow &&
    !key.rightArrow &&
    !key.return &&
    !key.escape &&
    !key.tab &&
    !key.backspace &&
    !key.delete &&
    input >= " "
  );
}

function label(value: string): string {
  return value[0].toUpperCase() + value.slice(1);
}
