import React, { useEffect, useRef, useState } from "react";
import {
  Box,
  Text,
  useApp,
  useInput,
  type Key
} from "ink";
import type {
  TuiActiveRunBox,
  TuiConversationEntry,
  TuiCurrentContextModel
} from "@agent-hub/core";
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
  reduceInkState,
  roleListCommand,
  selectedReviewRunId,
  selectedRun,
  selectedTask,
  selectedTaskIndex,
  unavailableRoleExecutorCommands,
  visibleRoleCalls,
  selectedRoleCallIndex,
  type TuiInkFocus,
  type TuiInkKey,
  type TuiInkState
} from "./state.mjs";

const h = React.createElement;
const defaultTuiOperationTimeoutMs = 10 * 60 * 1000;
const defaultTuiPollIntervalMs = 2_500;
const defaultTuiModelRefreshTimeoutMs = 30_000;

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
  operationTimeoutMs?: number;
  pollIntervalMs?: number;
  modelRefreshTimeoutMs?: number;
}

export function TuiInkApp(props: TuiInkAppProps): React.ReactElement {
  const app = useApp();
  const [model, setModel] = useState(props.model);
  const [state, setState] = useState(props.state ?? createInitialInkState());
  const [busy, setBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState<string | undefined>();
  const stateRef = useRef(state);
  const modelRef = useRef(model);
  const busyRef = useRef(busy);
  const busyMessageRef = useRef(busyMessage);
  const operationTimeoutMs = props.operationTimeoutMs ?? defaultTuiOperationTimeoutMs;
  const modelRefreshTimeoutMs = props.modelRefreshTimeoutMs ?? defaultTuiModelRefreshTimeoutMs;

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    busyMessageRef.current = busyMessage;
  }, [busyMessage]);

  useEffect(() => {
    if (!props.interactive || !props.loadModel) {
      return undefined;
    }
    const intervalMs = props.pollIntervalMs ?? defaultTuiPollIntervalMs;
    if (intervalMs <= 0) {
      return undefined;
    }
    let disposed = false;
    let inFlight = false;
    const interval = setInterval(() => {
      if (inFlight || !props.loadModel) {
        return;
      }
      inFlight = true;
      withTimeout(
        props.loadModel(stateRef.current),
        modelRefreshTimeoutMs,
        "TUI refresh"
      )
        .then((nextModel) => {
          if (!disposed) {
            setModel(nextModel);
          }
        })
        .catch((error) => {
          if (!disposed) {
            setState((current) => ({
              ...current,
              statusMessage: `Refresh failed: ${errorMessage(error)}`
            }));
          }
        })
        .finally(() => {
          inFlight = false;
        });
    }, intervalMs);
    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, [modelRefreshTimeoutMs, props.interactive, props.loadModel, props.pollIntervalMs]);

  const refreshModel = async (nextState: TuiInkState) => {
    if (!props.loadModel) {
      return;
    }
    try {
      setModel(
        await withTimeout(
          props.loadModel(nextState),
          modelRefreshTimeoutMs,
          "TUI refresh"
        )
      );
    } catch (error) {
      setState({
        ...nextState,
        statusMessage: errorMessage(error)
      });
    }
  };

  const applyKey = (key: TuiInkKey) => {
    const nextState = reduceInkState(stateRef.current, key, modelRef.current);
    setState(nextState);
  };

  const setStateNow = (nextState: TuiInkState) => {
    stateRef.current = nextState;
    setState(nextState);
  };

  const showBusyInputMessage = () => {
    setState((current) => ({
      ...current,
      statusMessage: `${busyMessageRef.current ?? "An action is still running."} Wait for it to finish before submitting again.`
    }));
  };

  const applyComposerCommand = (): boolean => {
    const currentState = stateRef.current;
    const command = currentState.composer.trim().toLowerCase();
    if (command === "/team" || command === "/roles") {
      setStateNow({
        ...currentState,
        focus: "team",
        composer: "",
        commandPaletteOpen: false,
        statusMessage: "Team roles shown."
      });
      return true;
    }
    return false;
  };

  const submitComposer = async () => {
    const currentState = stateRef.current;
    const currentModel = modelRef.current;
    const prompt = currentState.composer.trim();
    if (!prompt) {
      setState({ ...currentState, statusMessage: "Composer is empty." });
      return;
    }
    if (!props.submitPrompt) {
      setState({ ...currentState, statusMessage: "Prompt submission is unavailable." });
      return;
    }
    if (busyRef.current) {
      showBusyInputMessage();
      return;
    }
    const submittingState = {
      ...currentState,
      composer: "",
      statusMessage: "Submitting prompt..."
    };
    setStateNow(submittingState);
    setBusyMessage("Submitting prompt...");
    busyMessageRef.current = "Submitting prompt...";
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await withTimeout(
        props.submitPrompt({
          prompt,
          projectId: currentModel.context.projectId,
          threadId: currentModel.context.threadId
        }),
        operationTimeoutMs,
        "Prompt submission"
      );
      const nextState = {
        ...stateRef.current,
        statusMessage: result.message
      };
      setStateNow(nextState);
      if (result.model) {
        setModel(result.model);
      } else {
        await refreshModel(nextState);
      }
    } catch (error) {
      setStateNow({
        ...stateRef.current,
        statusMessage: errorMessage(error)
      });
    } finally {
      busyRef.current = false;
      busyMessageRef.current = undefined;
      setBusy(false);
      setBusyMessage(undefined);
    }
  };

  const recordDecision = async (status: "accepted" | "rejected") => {
    if (!props.recordReviewDecision) {
      setState({ ...stateRef.current, statusMessage: "Review decisions are unavailable." });
      return;
    }
    const runId = selectedReviewRunId(modelRef.current, stateRef.current);
    if (!runId) {
      setState({ ...stateRef.current, statusMessage: "No linked run is selected for review." });
      return;
    }
    if (busyRef.current) {
      showBusyInputMessage();
      return;
    }
    setBusyMessage(`Recording review ${status}...`);
    busyMessageRef.current = `Recording review ${status}...`;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await withTimeout(
        props.recordReviewDecision({
          runId,
          status,
          reason: status === "rejected" ? "Rejected from TUI review shortcut." : undefined
        }),
        operationTimeoutMs,
        "Review decision"
      );
      const nextState = {
        ...stateRef.current,
        statusMessage: result.message
      };
      setStateNow(nextState);
      if (result.model) {
        setModel(result.model);
      } else {
        await refreshModel(nextState);
      }
    } catch (error) {
      setState({
        ...stateRef.current,
        statusMessage: errorMessage(error)
      });
    } finally {
      busyRef.current = false;
      busyMessageRef.current = undefined;
      setBusy(false);
      setBusyMessage(undefined);
    }
  };

  useInput(
    (input, key) => {
      const currentState = stateRef.current;
      const isBusy = busyRef.current;
      if (key.ctrl && (input === "c" || input === "C")) {
        app.exit();
        return;
      }
      const wantsSubmit =
        input === "\n" ||
        input === "\r" ||
        key.return ||
        (key.ctrl && (input === "j" || input === "J"));
      if (wantsSubmit && currentState.composer.length > 0) {
        if (applyComposerCommand()) {
          return;
        }
        if (isBusy) {
          showBusyInputMessage();
          return;
        }
        void submitComposer();
        return;
      }
      if (key.ctrl && (input === "j" || input === "J")) {
        if (isBusy) {
          showBusyInputMessage();
          return;
        }
        void submitComposer();
        return;
      }
      if ((input === "x" || input === "q") && currentState.composer.length === 0) {
        app.exit();
        return;
      }
      const canRecordReview = currentState.focus === "review";
      if (input === "a" && canRecordReview && currentState.composer.length === 0) {
        if (isBusy) {
          showBusyInputMessage();
          return;
        }
        void recordDecision("accepted");
        return;
      }
      if (input === "R" && canRecordReview && currentState.composer.length === 0) {
        if (isBusy) {
          showBusyInputMessage();
          return;
        }
        void recordDecision("rejected");
        return;
      }
      if ((input === ":" || input === "?") && currentState.composer.length === 0) {
        applyKey(input === ":" ? "palette" : "help");
        return;
      }
      const directMapped = currentState.composer.length === 0
        ? keyToAction(input, key, currentState.focus)
        : undefined;
      if (directMapped && isDirectFocusAction(directMapped)) {
        applyKey(directMapped);
        return;
      }
      if (key.escape && currentState.composer.length > 0) {
        setState((current) => ({
          ...current,
          composer: "",
          statusMessage: "Composer cleared."
        }));
        return;
      }
      if (
        isPrintableInput(input, key) &&
        (currentState.focus === "work" || currentState.composer.length > 0)
      ) {
        setState((current) => ({ ...current, composer: `${current.composer}${input}` }));
        return;
      }
      const mapped = keyToAction(input, key, currentState.focus);
      if (mapped) {
        applyKey(mapped);
        return;
      }
      if (key.backspace || key.delete) {
        setState((current) => ({ ...current, composer: current.composer.slice(0, -1) }));
        return;
      }
      if (isPrintableInput(input, key)) {
        setState((current) => ({ ...current, composer: `${current.composer}${input}` }));
      }
    },
    { isActive: props.interactive }
  );

  return h(TuiInkFrame, {
    model,
    state: busy ? { ...state, statusMessage: busyMessage ?? "Working..." } : state,
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
    h(HeaderBar, { model, terminal }),
    ...model.warnings.map((warning) => line(`! ${warning}`, { color: "yellow" })),
    ...(state.statusMessage ? [line(`Status: ${state.statusMessage}`, { color: "green" })] : []),
    line(""),
    h(MainView, { model, state, terminal }),
    line(""),
    h(Composer, { model, state }),
    h(FocusTabs, { state }),
    h(StatusBar, { model, state })
  );
}

function HeaderBar({
  model,
  terminal
}: {
  model: TuiCurrentContextModel;
  terminal: TuiInkTerminalSize;
}): React.ReactElement {
  const project = model.context.projectName ?? model.context.projectId ?? "unregistered";
  const agent = model.context.selectedAgent ? `@${model.context.selectedAgent}` : "@agent";
  const loop = model.roleCalls.loop.maxIterations === undefined
    ? `iter ${model.roleCalls.loop.iteration}`
    : `iter ${model.roleCalls.loop.iteration}/${model.roleCalls.loop.maxIterations}`;
  const room = model.context.roomHandle ? `#${model.context.roomHandle}` : undefined;
  const parts = [
    room ? `${project} ${room}` : project,
    agent,
    loop,
    `risk ${highestRisk(model)}`
  ];
  return h(
    Box,
    { flexDirection: "column" },
    line(
      compactHeaderParts(parts, terminal.columns),
      { bold: true, color: "cyan" }
    )
  );
}

function FocusTabs({ state }: { state: TuiInkState }): React.ReactElement {
  const tabs: Array<{ focus: TuiInkFocus; label: string }> = [
    { focus: "work", label: "[W]ork" },
    { focus: "runs", label: "[R]uns" },
    { focus: "review", label: "[V]iew" },
    { focus: "graph", label: "[G]raph" },
    { focus: "tasks", label: "[T]asks" },
    { focus: "memory", label: "[M]em" },
    { focus: "help", label: "?help" }
  ];
  return h(
    Box,
    { flexDirection: "row" },
    ...tabs.map((tab) =>
      h(
        Box,
        { key: tab.focus, marginRight: 1 },
        line(tab.label, {
          color: tab.focus === state.focus ? "green" : undefined,
          bold: tab.focus === state.focus
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
    return h(RoleCallsPane, { model, state, terminal, detail: true });
  }
  if (state.focus === "team") {
    return h(TeamPane, { model, terminal });
  }
  if (state.focus === "runs") {
    return h(RunsPane, { model, state, terminal, detail: true });
  }
  if (state.focus === "review") {
    return h(ReviewPane, { model, state, detail: true });
  }
  if (state.focus === "tasks") {
    return h(TasksPane, { model, state, terminal });
  }
  if (state.focus === "memory") {
    return h(MemoryPane, { model });
  }
  return h(WorkView, { model, state, terminal });
}

function WorkView({ model, state, terminal }: Required<TuiInkFrameProps>): React.ReactElement {
  const fullBoxLimit = Math.min(model.activeRuns.length, 3);
  const collapsedBoxes = model.activeRuns.slice(0, Math.max(0, model.activeRuns.length - fullBoxLimit));
  const fullBoxes = model.activeRuns.slice(-fullBoxLimit);
  const activeLineCost = collapsedBoxes.length + fullBoxes.length * activeRunBoxLineCount(terminal);
  const conversationLines = conversationWindowSize(terminal, activeLineCost);
  return h(
    Box,
    { flexDirection: "column" },
    h(ConversationFlow, { model, state, visibleLines: conversationLines }),
    ...(collapsedBoxes.length > 0
      ? collapsedBoxes.map((box) =>
          line(`${activeRunTitle(box)} ...`, { color: toneColor(box.tone) })
        )
      : []),
    ...fullBoxes.map((box) => h(ActiveRunBoxView, { key: box.runId, box, terminal }))
  );
}

function ConversationFlow({
  model,
  state,
  visibleLines
}: {
  model: TuiCurrentContextModel;
  state: TuiInkState;
  visibleLines: number;
}): React.ReactElement {
  if (model.conversation.length === 0) {
    return block(line("No messages in the current context.", { dimColor: true }));
  }
  const maxOffset = Math.max(0, model.conversation.length - visibleLines);
  const offsetFromBottom = Math.min(state.conversationScrollOffset, maxOffset);
  const start = Math.max(0, model.conversation.length - visibleLines - offsetFromBottom);
  const visible = model.conversation.slice(start, start + visibleLines);
  const title = maxOffset > 0
    ? `Messages ${start + 1}-${start + visible.length}/${model.conversation.length}`
    : undefined;
  return block(
    ...(title ? [line(title, { dimColor: true })] : []),
    ...visible.flatMap((entry) => conversationEntryLines(entry))
  );
}

function conversationEntryLines(entry: TuiConversationEntry): React.ReactElement[] {
  if (entry.type === "agent_completed" || entry.type === "agent_failed") {
    const statusIcon = entry.type === "agent_failed" ? "✗" : "✓";
    return [
      line(`${entry.agent ? `@${entry.agent}` : entry.author} ${entry.runId ? compactId(entry.runId) : ""} ${statusIcon} ${entry.statusLabel ?? ""}`.trim(), {
        color: entry.type === "agent_failed" ? "red" : "cyan"
      }),
      ...conversationContentLines(entry.content),
      ...(entry.verificationLine ? [line(`  ~ ${entry.verificationLine}`)] : []),
      ...(entry.riskLine ? [line(`  ⚠ ${entry.riskLine}`, { color: "yellow" })] : []),
      ...(entry.reviewLine ? [line(`  △ ${entry.reviewLine}`, { color: "yellow" })] : [])
    ];
  }
  if (entry.type === "review_decided") {
    const decisionIcon = entry.decision === "rejected" ? "✗" : "✓";
    return [
      line(`review ${entry.runId ? compactId(entry.runId) : ""}`.trim(), { color: entry.decision === "rejected" ? "red" : "green" }),
      line(`  ${decisionIcon} ${entry.content}`)
    ];
  }
  if (entry.type === "delegation") {
    return [
      line(`${entry.author} -> ${entry.roleCallId ? compactId(entry.roleCallId) : "role"}`, { color: "cyan" }),
      line(`  → ${entry.content}`)
    ];
  }
  return [
    line(entry.author, { color: entry.type === "user_message" ? undefined : "cyan" }),
    ...conversationContentLines(entry.content)
  ];
}

function conversationContentLines(content: string): React.ReactElement[] {
  const lines = content
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  const visible = lines.length > 0 ? lines.slice(0, 6) : ["(empty)"];
  return [
    ...visible.map((value) => line(`  ${value}`)),
    ...(lines.length > visible.length
      ? [line(`  ... ${lines.length - visible.length} more lines`, { dimColor: true })]
      : [])
  ];
}

function ActiveRunBoxView({
  box,
  terminal
}: {
  box: TuiActiveRunBox;
  terminal: TuiInkTerminalSize;
}): React.ReactElement {
  const width = activeRunBoxWidth(terminal);
  const innerWidth = Math.max(12, width - 2);
  const title = activeRunTitle(box);
  const top = borderedTitle(title, innerWidth);
  const contentHeight = activeRunContentHeight(terminal);
  const contentLines = [...box.outputLines, ...box.evidenceLines].slice(-contentHeight);
  const paddedLines = [
    ...contentLines,
    ...Array.from({ length: Math.max(0, contentHeight - contentLines.length) }, () => "")
  ];
  const hint = box.actionHint ?? "▍";
  return block(
    line(top, { color: toneColor(box.tone) }),
    ...paddedLines.map((value) => line(`│ ${truncateText(value, innerWidth - 2).padEnd(innerWidth - 2)} │`, { color: toneColor(box.tone) })),
    line(`│ ${truncateText(hint, innerWidth - 2).padEnd(innerWidth - 2)} │`, { color: toneColor(box.tone) }),
    line(`╰${"─".repeat(innerWidth)}╯`, { color: toneColor(box.tone) })
  );
}

function activeRunTitle(box: TuiActiveRunBox): string {
  const icon = box.state === "queued" ? "○" : "●";
  return `@${box.agent} ${compactId(box.runId)} ${icon} ${box.state}`;
}

function borderedTitle(title: string, innerWidth: number): string {
  const decorated = `─ ${truncateText(title, Math.max(8, innerWidth - 4))} `;
  return `╭${decorated}${"─".repeat(Math.max(0, innerWidth - decorated.length))}╮`;
}

function RunsPane({
  model,
  state,
  terminal,
  detail = false
}: {
  model: TuiCurrentContextModel;
  state: TuiInkState;
  terminal: TuiInkTerminalSize;
  detail?: boolean;
}): React.ReactElement {
  if (model.runs.length === 0) {
    return block(line("No runs in the current context.", { dimColor: true }));
  }
  const activeRun = selectedRun(model, state);
  const windowSize = runWindowSize(terminal, detail);
  const offset = Math.min(state.scrollOffsets.runs, Math.max(0, model.runs.length - windowSize));
  const visibleRuns = model.runs.slice(offset, offset + windowSize);
  return block(
    ...visibleRuns.map((run) =>
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
  terminal,
  detail = false
}: {
  model: TuiCurrentContextModel;
  state: TuiInkState;
  terminal: TuiInkTerminalSize;
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
  const selectedIndex = selectedRoleCallIndex(model, state);
  const windowSize = roleCallWindowSize(terminal, detail);
  const offset = Math.min(state.scrollOffsets.roleCalls, Math.max(0, nodes.length - windowSize));
  const visibleNodes = nodes.slice(offset, offset + windowSize);
  return block(
    line(
      `active ${model.roleCalls.counts.active} waiting ${model.roleCalls.counts.waiting} pending ${model.roleCalls.counts.pending} stop ${model.roleCalls.loop.stopReason}`,
      { dimColor: true }
    ),
    ...visibleNodes.map((node, index) => {
      const absoluteIndex = offset + index;
      const selected = absoluteIndex === selectedIndex;
      const indent = "  ".repeat(node.depth);
      const run = node.linkedRunId ? ` ${compactId(node.linkedRunId)}` : "";
      return line(
        `${selected ? ">" : " "} ${indent}@${node.callerRole} -> @${node.calleeRole} [${node.statusLabel}]${run} ${truncateText(node.task, 58)}`,
        { color: selected ? "green" : undefined }
      );
    })
  );
}

function TranscriptPane({
  model,
  state,
  terminal
}: {
  model: TuiCurrentContextModel;
  state: TuiInkState;
  terminal: TuiInkTerminalSize;
}): React.ReactElement {
  if (model.transcript.length === 0) {
    return block(line("Transcript", { bold: true }), line("No messages in the current context.", { dimColor: true }));
  }
  const windowSize = transcriptWindowSize(terminal);
  const maxOffset = Math.max(0, model.transcript.length - windowSize);
  const offsetFromBottom = Math.min(state.scrollOffsets.transcript, maxOffset);
  const start = Math.max(0, model.transcript.length - windowSize - offsetFromBottom);
  const visible = model.transcript.slice(start, start + windowSize);
  const title = maxOffset > 0
    ? `Transcript ${start + 1}-${start + visible.length}/${model.transcript.length}`
    : "Transcript";
  return block(
    line(title, { bold: true }),
    ...visible.flatMap((message) => [
      line(`${message.author}${message.runId ? ` ${compactId(message.runId)}` : ""}`, {
        color: "cyan"
      }),
      line(`  ${truncateText(message.content || "(empty)", 90)}`)
    ])
  );
}

function TasksPane({
  model,
  state,
  terminal
}: {
  model: TuiCurrentContextModel;
  state: TuiInkState;
  terminal: TuiInkTerminalSize;
}): React.ReactElement {
  if (model.tasks.length === 0) {
    return h(Pane, { title: "Tasks" }, line("No current-context tasks.", { dimColor: true }));
  }
  const task = selectedTask(model, state);
  const windowSize = taskWindowSize(terminal);
  const offset = Math.min(state.scrollOffsets.tasks, Math.max(0, model.tasks.length - windowSize));
  const selectedIndex = selectedTaskIndex(model, state);
  return h(
    Pane,
    { title: `Tasks ${model.tasks.length}` },
    ...model.tasks.slice(offset, offset + windowSize).map((item, index) =>
      line(`${offset + index === selectedIndex ? ">" : " "} ${item.id} ${item.status} ${truncateText(item.title, 72)}${item.nextAction ? ` next ${item.nextAction}` : ""}`)
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

function TeamPane({
  model,
  terminal
}: {
  model: TuiCurrentContextModel;
  terminal: TuiInkTerminalSize;
}): React.ReactElement {
  const team = model.team;
  if (!team.projectId) {
    return h(
      Pane,
      { title: "Team Roles" },
      line("Register or select a project before listing team roles.", { dimColor: true })
    );
  }
  if (team.roles.length === 0) {
    return h(
      Pane,
      { title: "Team Roles" },
      line("No team roles are available in the current context.", { dimColor: true }),
      line(`next ${team.command ?? "agent-hub project list"}`, { dimColor: true })
    );
  }
  const windowSize = teamWindowSize(terminal);
  const visibleRoles = team.roles.slice(0, windowSize);
  const remaining = team.roles.length - visibleRoles.length;
  return h(
    Pane,
    { title: `Team Roles ${team.counts.total}` },
    line(
      `enabled ${team.counts.enabled} runnable ${team.counts.runnable} reserved ${team.counts.reserved} custom ${team.counts.custom} overrides ${team.counts.presetOverrides}`,
      { dimColor: true }
    ),
    ...visibleRoles.map((role) =>
      line(
        `${role.enabled ? " " : "!"} @${role.handle} ${role.source} ${role.executorLabel}${role.defaultRoom ? ` #${role.defaultRoom}` : ""} - ${truncateText(role.capabilitySummary, 62)}`
      )
    ),
    ...(remaining > 0 ? [line(`${remaining} more roles hidden by window size`, { dimColor: true })] : []),
    line(""),
    line(`next ${team.command ?? "agent-hub project list"}`, { dimColor: true })
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
  const primaryCommand = commandHintForFocus(model, state);
  const roleCommand = roleListCommand(model);
  return h(
    Pane,
    { title: "Command Palette" },
    line(`focus ${state.focus}`),
    line(primaryCommand, { color: "green" }),
    line(""),
    ...(roleCommand && roleCommand !== primaryCommand ? [line(roleCommand)] : []),
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
    line(": commands   /team roles   c continue   a accept review   R reject in Review"),
    line("enter submits non-empty composer   h hide done   m memory   ? help   x exit")
  );
}

function Composer({ model, state }: { model: TuiCurrentContextModel; state: TuiInkState }): React.ReactElement {
  const agent = model.context.selectedAgent ? `@${model.context.selectedAgent}` : "@agent";
  return line(`> ${state.composer || `${agent} prompt`}`, { color: "green" });
}

function StatusBar({ model, state }: { model: TuiCurrentContextModel; state: TuiInkState }): React.ReactElement {
  const hints = state.composer
    ? "enter submit | /team roles | tab focus | esc clear | ctrl+c exit"
    : state.focus === "review"
      ? "tab focus | enter review | : palette | p command | a accept | R reject | ? help | x exit"
      : "tab focus | enter review | : palette | p command | ? help | x exit";
  return line(
    `${hints} | ${commandHintForFocus(model, state)}`,
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

function runWindowSize(terminal: TuiInkTerminalSize, detail: boolean): number {
  return boundedWindowSize(terminal.rows - (detail ? 14 : 24), detail ? 8 : 5, detail ? 30 : 14);
}

function roleCallWindowSize(terminal: TuiInkTerminalSize, detail: boolean): number {
  return boundedWindowSize(terminal.rows - (detail ? 10 : 28), detail ? 8 : 5, detail ? 30 : 12);
}

function taskWindowSize(terminal: TuiInkTerminalSize): number {
  return boundedWindowSize(terminal.rows - 14, 8, 30);
}

function teamWindowSize(terminal: TuiInkTerminalSize): number {
  return boundedWindowSize(terminal.rows - 12, 8, 32);
}

function transcriptWindowSize(terminal: TuiInkTerminalSize): number {
  return boundedWindowSize(Math.floor((terminal.rows - 14) / 2), 5, 18);
}

function conversationWindowSize(
  terminal: TuiInkTerminalSize,
  activeLineCost: number
): number {
  return boundedWindowSize(terminal.rows - 7 - activeLineCost, 4, 8);
}

function activeRunBoxLineCount(terminal: TuiInkTerminalSize): number {
  return activeRunContentHeight(terminal) + 3;
}

function activeRunContentHeight(terminal: TuiInkTerminalSize): number {
  return terminal.rows < 24 ? 3 : 6;
}

function activeRunBoxWidth(terminal: TuiInkTerminalSize): number {
  return Math.max(28, terminal.columns - 4);
}

function toneColor(tone: TuiActiveRunBox["tone"]): string {
  if (tone === "yellow") {
    return "yellow";
  }
  if (tone === "red") {
    return "red";
  }
  return "green";
}

function boundedWindowSize(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  if (timeoutMs <= 0 || !Number.isFinite(timeoutMs)) {
    return promise;
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return new Promise<T>((resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${formatDuration(timeoutMs)}.`));
    }, timeoutMs);
    promise.then(resolve, reject).finally(() => {
      if (timeout) {
        clearTimeout(timeout);
      }
    });
  });
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) {
    return `${milliseconds}ms`;
  }
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  return `${Math.round(seconds / 60)}m`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function keyToAction(input: string, key: Key, focus: string): TuiInkKey | undefined {
  if (key.tab || input === "\t") {
    return key.shift ? "shift_tab" : "tab";
  }
  if (key.upArrow || input === "k") {
    return "up";
  }
  if (key.downArrow || input === "j") {
    return "down";
  }
  if (key.pageUp) {
    return "page_up";
  }
  if (key.pageDown) {
    return "page_down";
  }
  if (key.home) {
    return "home";
  }
  if (key.end) {
    return "end";
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
  if (input === "w") {
    return "work";
  }
  if (input === "r") {
    return "runs";
  }
  if (input === "v") {
    return "review";
  }
  if (input === "g") {
    return "graph";
  }
  if (input === "t") {
    return "tasks";
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

function isDirectFocusAction(action: TuiInkKey): boolean {
  return (
    action === "work" ||
    action === "runs" ||
    action === "review" ||
    action === "graph" ||
    action === "tasks" ||
    action === "memory" ||
    action === "team" ||
    action === "help"
  );
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

function compactHeaderParts(parts: string[], columns: number): string {
  const minimumColumns = Math.max(12, columns);
  const visible = [...parts];
  while (visible.length > 1 && visible.join(" · ").length > minimumColumns) {
    visible.pop();
  }
  return truncateText(visible.join(" · "), minimumColumns);
}
