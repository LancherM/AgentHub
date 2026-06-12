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
  TuiConversationSuggestion,
  TuiCurrentContextModel,
  TuiInlineDiffSummary,
  TuiRunSummary
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
  visibleConversationSuggestions,
  visibleRoleCalls,
  selectedRoleCallIndex,
  type TuiInkFocus,
  type TuiInkKey,
  type TuiInkState
} from "./state.mjs";

const h = React.createElement;
const defaultTuiOperationTimeoutMs = 10 * 60 * 1000;
const defaultTuiPollIntervalMs = 2_500;
const defaultIdleTuiPollIntervalMs = 10_000;
const defaultTuiModelRefreshTimeoutMs = 30_000;
const activeRunSpinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const completionNotificationMinimumMs = 30_000;
const staleActiveRunThresholdMs = 60 * 60 * 1000;

type RunFeedbackKind = "success" | "failure";

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
  animationTick?: number;
  feedbackByRunId?: Partial<Record<string, RunFeedbackKind>>;
  badgeFlash?: boolean;
  showSplash?: boolean;
}

export interface TuiInkAppProps extends TuiInkFrameProps {
  interactive: boolean;
  loadModel?: (state: TuiInkState) => Promise<TuiCurrentContextModel>;
  submitPrompt?: (input: TuiInkSubmitInput) => Promise<TuiInkSubmitResult>;
  recordReviewDecision?: (input: TuiInkReviewInput) => Promise<TuiInkReviewResult>;
  notify?: (message: string) => void;
  operationTimeoutMs?: number;
  pollIntervalMs?: number;
  idlePollIntervalMs?: number;
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

  useCompletionNotifications(model, state.notifyEnabled, props.notify);

  useEffect(() => {
    if (!props.interactive || !props.loadModel) {
      return undefined;
    }
    let disposed = false;
    let inFlight = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (disposed) {
        return;
      }
      const activeIntervalMs = props.pollIntervalMs ?? defaultTuiPollIntervalMs;
      const idleIntervalMs = props.idlePollIntervalMs ?? defaultIdleTuiPollIntervalMs;
      const intervalMs = modelRef.current.activeRuns.length > 0
        ? activeIntervalMs
        : idleIntervalMs;
      if (intervalMs <= 0) {
        return;
      }
      timeout = setTimeout(refresh, intervalMs);
    };
    const refresh = () => {
      if (inFlight || !props.loadModel) {
        schedule();
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
            setModelFromRefresh(nextModel);
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
          schedule();
        });
    };
    schedule();
    return () => {
      disposed = true;
      if (timeout) {
        clearTimeout(timeout);
      }
    };
  }, [
    modelRefreshTimeoutMs,
    props.idlePollIntervalMs,
    props.interactive,
    props.loadModel,
    props.pollIntervalMs
  ]);

  const refreshModel = async (nextState: TuiInkState) => {
    if (!props.loadModel) {
      return;
    }
    try {
      const nextModel = await withTimeout(
          props.loadModel(nextState),
          modelRefreshTimeoutMs,
          "TUI refresh"
      );
      setModelFromRefresh(nextModel);
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

  const updateStateNow = (updater: (current: TuiInkState) => TuiInkState) => {
    setStateNow(updater(stateRef.current));
  };

  const showBusyInputMessage = () => {
    setState((current) => ({
      ...current,
      statusMessage: `${busyMessageRef.current ?? "An action is still running."} Wait for it to finish before submitting again.`
    }));
  };

  const setModelFromRefresh = (nextModel: TuiCurrentContextModel) => {
    const previousModel = modelRef.current;
    if (modelRenderSignature(previousModel) === modelRenderSignature(nextModel)) {
      return;
    }
    modelRef.current = nextModel;
    setModel(nextModel);
    if (workContentSignature(previousModel) !== workContentSignature(nextModel)) {
      setState((current) => ({
        ...current,
        conversationScrollOffset: 0
      }));
    }
  };

  const applyComposerCommand = (): boolean => {
    const currentState = stateRef.current;
    const command = currentState.composer.trim().toLowerCase();
    if (command === "/team" || command === "/roles") {
      setStateNow({
        ...currentState,
        focus: "team",
        composer: "",
        composerCursorPosition: 0,
        composerHistoryIndex: undefined,
        composerHistoryDraft: "",
        agentCompletionIndex: 0,
        commandPaletteOpen: false,
        statusMessage: "Team roles shown."
      });
      return true;
    }
    if (command === "/search") {
      setStateNow(openSearchState({
        ...currentState,
        composer: "",
        composerCursorPosition: 0,
        composerHistoryIndex: undefined,
        composerHistoryDraft: "",
        agentCompletionIndex: 0
      }));
      return true;
    }
    if (command === "/timeline") {
      setStateNow({
        ...currentState,
        timelineOpen: true,
        searchOpen: false,
        commandPaletteOpen: false,
        composer: "",
        composerCursorPosition: 0,
        composerHistoryIndex: undefined,
        composerHistoryDraft: "",
        agentCompletionIndex: 0,
        statusMessage: "Timeline shown."
      });
      return true;
    }
    if (command === "/notify") {
      setStateNow({
        ...currentState,
        notifyEnabled: !currentState.notifyEnabled,
        composer: "",
        composerCursorPosition: 0,
        composerHistoryIndex: undefined,
        composerHistoryDraft: "",
        agentCompletionIndex: 0,
        statusMessage: currentState.notifyEnabled
          ? "Completion notifications disabled."
          : "Completion notifications enabled."
      });
      return true;
    }
    return false;
  };

  const submitComposer = async () => {
    const currentState = stateRef.current;
    const prompt = currentState.composer.trim();
    if (!prompt) {
      setState({ ...currentState, statusMessage: "Composer is empty." });
      return;
    }
    await submitPromptText(prompt, currentState, "Submitting prompt...");
  };

  const submitSuggestion = async (suggestion: TuiConversationSuggestion) => {
    await submitPromptText(
      suggestion.prompt,
      stateRef.current,
      `Submitting suggestion: ${suggestion.label}...`
    );
  };

  const submitPromptText = async (
    prompt: string,
    currentState: TuiInkState,
    busyLabel: string
  ) => {
    const currentModel = modelRef.current;
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
      composerCursorPosition: 0,
      composerHistory: appendComposerHistory(currentState.composerHistory, prompt),
      composerHistoryIndex: undefined,
      composerHistoryDraft: "",
      agentCompletionIndex: 0,
      statusMessage: busyLabel
    };
    setStateNow(submittingState);
    setBusyMessage(busyLabel);
    busyMessageRef.current = busyLabel;
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
        setModelFromRefresh(result.model);
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
        setModelFromRefresh(result.model);
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

  const handleSearchInput = (input: string, key: Key) => {
    if (key.escape) {
      applyKey("escape");
      return;
    }
    if (key.upArrow || input === "\u001B[A") {
      moveSearchMatch(-1);
      return;
    }
    if (key.downArrow || input === "\u001B[B" || input === "\n" || input === "\r" || key.return) {
      moveSearchMatch(1);
      return;
    }
    if (key.backspace) {
      setState((current) => ({
        ...current,
        searchQuery: current.searchQuery.slice(0, -1),
        searchMatchIndex: 0
      }));
      return;
    }
    if (isPrintableInput(input, key)) {
      setState((current) => ({
        ...current,
        searchQuery: `${current.searchQuery}${input}`,
        searchMatchIndex: 0
      }));
    }
  };

  const moveSearchMatch = (delta: number) => {
    setState((current) => {
      const count = conversationSearchMatches(modelRef.current, current.searchQuery).length;
      if (count === 0) {
        return current;
      }
      return {
        ...current,
        searchMatchIndex: (current.searchMatchIndex + delta + count) % count
      };
    });
  };

  const handlePaletteInput = (input: string, key: Key) => {
    if (key.escape) {
      applyKey("escape");
      return;
    }
    if (key.upArrow || input === "k") {
      movePaletteSelection(-1);
      return;
    }
    if (key.downArrow || input === "j") {
      movePaletteSelection(1);
      return;
    }
    if (input === "\n" || input === "\r" || key.return) {
      executeSelectedPaletteItem();
      return;
    }
    if (key.backspace) {
      setState((current) => ({
        ...current,
        paletteQuery: current.paletteQuery.slice(0, -1),
        paletteSelectedIndex: 0
      }));
      return;
    }
    if (isPrintableInput(input, key)) {
      setState((current) => ({
        ...current,
        paletteQuery: `${current.paletteQuery}${input}`,
        paletteSelectedIndex: 0
      }));
    }
  };

  const movePaletteSelection = (delta: number) => {
    setState((current) => {
      const count = filteredPaletteItems(modelRef.current, current).length;
      if (count === 0) {
        return current;
      }
      return {
        ...current,
        paletteSelectedIndex: (current.paletteSelectedIndex + delta + count) % count
      };
    });
  };

  const executeSelectedPaletteItem = () => {
    const currentState = stateRef.current;
    const items = filteredPaletteItems(modelRef.current, currentState);
    const item = items[Math.min(currentState.paletteSelectedIndex, Math.max(0, items.length - 1))];
    if (!item) {
      setStateNow({
        ...currentState,
        statusMessage: "No palette command matches."
      });
      return;
    }
    if (item.kind === "focus") {
      const nextState = reduceInkState(
        {
          ...currentState,
          commandPaletteOpen: false,
          paletteQuery: "",
          paletteSelectedIndex: 0
        },
        item.focus,
        modelRef.current
      );
      setStateNow({
        ...nextState,
        statusMessage: `Opened ${item.label}.`
      });
      return;
    }
    setStateNow({
      ...currentState,
      commandPaletteOpen: false,
      paletteQuery: "",
      paletteSelectedIndex: 0,
      composer: item.command,
      composerCursorPosition: item.command.length,
      statusMessage: "Command prepared in composer."
    });
  };

  useInput(
    (input, key) => {
      const currentState = stateRef.current;
      const isBusy = busyRef.current;
      if (key.ctrl && (input === "c" || input === "C")) {
        app.exit();
        return;
      }
      if (currentState.searchOpen) {
        handleSearchInput(input, key);
        return;
      }
      if (currentState.commandPaletteOpen) {
        handlePaletteInput(input, key);
        return;
      }
      if (key.ctrl && (input === "f" || input === "F")) {
        setStateNow(openSearchState(currentState));
        return;
      }
      const activeCompletion = agentCompletionForState(modelRef.current, currentState);
      if (activeCompletion && (key.tab || input === "\t")) {
        updateStateNow((current) => acceptAgentCompletion(modelRef.current, current));
        return;
      }
      if (activeCompletion && (isUpInput(input, key) || isDownInput(input, key))) {
        updateStateNow((current) =>
          moveAgentCompletionSelection(modelRef.current, current, isDownInput(input, key) ? 1 : -1)
        );
        return;
      }
      const suggestion = suggestionForInput(input, modelRef.current, currentState);
      if (suggestion) {
        if (isBusy) {
          showBusyInputMessage();
          return;
        }
        void submitSuggestion(suggestion);
        return;
      }
      if (input === "C" && currentState.focus === "work" && currentState.composer.length === 0) {
        applyKey("continue_loop");
        return;
      }
      if (input === "L" && currentState.composer.length === 0) {
        applyKey("toggle_timeline");
        return;
      }
      if (input === " " && currentState.focus === "review" && currentState.composer.length === 0) {
        applyKey("toggle_review_diff");
        return;
      }
      if (input === "s" && currentState.focus === "review" && currentState.composer.length === 0) {
        applyKey("toggle_compare");
        return;
      }
      const wantsNewline =
        (key.ctrl && (input === "o" || input === "O")) ||
        (key.return && (key.shift || key.meta));
      if (wantsNewline) {
        updateStateNow((current) => insertComposerText(current, "\n"));
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
      if (key.ctrl && (input === "a" || input === "A")) {
        updateStateNow((current) => ({
          ...current,
          composerCursorPosition: 0
        }));
        return;
      }
      if (key.ctrl && (input === "e" || input === "E")) {
        updateStateNow((current) => ({
          ...current,
          composerCursorPosition: current.composer.length
        }));
        return;
      }
      if (key.ctrl && (input === "u" || input === "U")) {
        updateStateNow((current) => ({
          ...current,
          composer: "",
          composerCursorPosition: 0,
          composerHistoryIndex: undefined,
          composerHistoryDraft: "",
          agentCompletionIndex: 0,
          statusMessage: "Composer cleared."
        }));
        return;
      }
      if (
        (isUpInput(input, key) || isDownInput(input, key)) &&
        (currentState.composer.length > 0 ||
          currentState.composerHistoryIndex !== undefined ||
          (currentState.focus === "work" && currentState.composerHistory.length > 0))
      ) {
        updateStateNow((current) => moveComposerHistory(current, isDownInput(input, key) ? 1 : -1));
        return;
      }
      if (key.ctrl && (input === "d" || input === "D")) {
        updateStateNow(deleteComposerCharacterAfterCursor);
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
      if (directMapped && isImmediateEmptyComposerAction(directMapped, currentState.focus)) {
        applyKey(directMapped);
        return;
      }
      if (key.escape && currentState.composer.length > 0) {
        updateStateNow((current) => ({
          ...current,
          composer: "",
          composerCursorPosition: 0,
          composerHistoryIndex: undefined,
          composerHistoryDraft: "",
          agentCompletionIndex: 0,
          statusMessage: "Composer cleared."
        }));
        return;
      }
      if (key.leftArrow && currentState.composer.length > 0) {
        updateStateNow((current) => ({
          ...current,
          composerCursorPosition: Math.max(0, current.composerCursorPosition - 1)
        }));
        return;
      }
      if (key.rightArrow && currentState.composer.length > 0) {
        updateStateNow((current) => ({
          ...current,
          composerCursorPosition: Math.min(current.composer.length, current.composerCursorPosition + 1)
        }));
        return;
      }
      if (key.home && currentState.composer.length > 0) {
        updateStateNow((current) => ({
          ...current,
          composerCursorPosition: 0
        }));
        return;
      }
      if (key.end && currentState.composer.length > 0) {
        updateStateNow((current) => ({
          ...current,
          composerCursorPosition: current.composer.length
        }));
        return;
      }
      if (key.backspace) {
        updateStateNow(deleteComposerCharacterBeforeCursor);
        return;
      }
      if (key.delete) {
        updateStateNow(deleteComposerCharacterAfterCursor);
        return;
      }
      const navigationMapped = currentState.composer.length === 0
        ? keyToAction(input, key, currentState.focus)
        : undefined;
      if (navigationMapped && isNavigationAction(navigationMapped)) {
        applyKey(navigationMapped);
        return;
      }
      if (isPrintableInput(input, key)) {
        updateStateNow((current) => insertComposerText(current, input));
        return;
      }
      const mapped = keyToAction(input, key, currentState.focus);
      if (mapped) {
        applyKey(mapped);
        return;
      }
    },
    { isActive: props.interactive }
  );

  return h(TuiInkFrame, {
    model,
    state: busy ? { ...state, statusMessage: busyMessage ?? "Working..." } : state,
    terminal: props.terminal,
    showSplash: false
  });
}

export function TuiInkFrame({
  model,
  state = createInitialInkState(),
  terminal,
  animationTick: providedAnimationTick,
  feedbackByRunId: providedFeedbackByRunId = {},
  badgeFlash: providedBadgeFlash = false,
  showSplash = false
}: TuiInkFrameProps): React.ReactElement {
  const effectiveFeedbackByRunId = {
    ...providedFeedbackByRunId
  };
  const attentionItems = attentionItemsForModel(model);
  return h(ShellFrame, {
    model,
    state,
    terminal,
    animationTick: providedAnimationTick ?? 0,
    feedbackByRunId: effectiveFeedbackByRunId,
    badgeFlash: providedBadgeFlash,
    showSplash,
    attentionItems
  });
}

interface ShellFrameProps extends TuiInkRenderProps {
  badgeFlash: boolean;
  showSplash: boolean;
  attentionItems: AttentionItem[];
}

function ShellFrame({
  model,
  state,
  terminal,
  animationTick,
  feedbackByRunId,
  badgeFlash,
  showSplash,
  attentionItems
}: ShellFrameProps): React.ReactElement {
  const width = terminal.columns;
  return h(
    Box,
    { flexDirection: "column", width },
    ...(showSplash ? [h(SplashPane, { key: "splash" })] : []),
    h(HeaderBar, { model, state, terminal, badgeFlash }),
    ...model.warnings.map((warning) => line(`! ${warning}`, { color: "yellow" })),
    ...(state.statusMessage ? [line(`Status: ${state.statusMessage}`, { color: "green" })] : []),
    ...(attentionItems.length > 0
      ? [h(AttentionStrip, { items: attentionItems, terminal })]
      : []),
    h(WorkbenchLayout, {
      model,
      state,
      terminal,
      animationTick,
      feedbackByRunId
    }),
    h(Composer, { model, state }),
    h(FocusTabs, { state, terminal }),
    h(StatusBar, { state, terminal })
  );
}

function HeaderBar({
  model,
  state,
  terminal,
  badgeFlash
}: {
  model: TuiCurrentContextModel;
  state: TuiInkState;
  terminal: TuiInkTerminalSize;
  badgeFlash: boolean;
}): React.ReactElement {
  const idle = model.activeRuns.length === 0 && state.composer.length === 0;
  const project = model.context.projectName ?? model.context.projectId ?? "unregistered";
  const agent = model.context.selectedAgent ? `@${model.context.selectedAgent}` : "@agent";
  const loop = model.roleCalls.loop.maxIterations === undefined
    ? `iter ${model.roleCalls.loop.iteration}`
    : `iter ${model.roleCalls.loop.iteration}/${model.roleCalls.loop.maxIterations}`;
  const risk = highestRisk(model);
  const parts: HeaderPart[] = [
    { text: project, bold: true },
    { text: agent },
    { text: loop },
    { text: `risk ${risk}` }
  ];
  const clock = formatHeaderClock(new Date());
  const symbol = badgeFlash ? "!" : idle ? "◈" : "●";
  const availableWidth = Math.max(12, terminal.columns - clock.length - 4);
  const visibleParts = compactHeaderParts(parts, availableWidth);
  const leftText = headerPartsText(visibleParts);
  const content = `${leftText}${" ".repeat(Math.max(1, terminal.columns - leftText.length - clock.length - 2))}${clock}`;
  const headerColor = riskHeaderColor(risk);
  return h(
    Box,
    { flexDirection: "row", width: terminal.columns },
    h(Text, {
      inverse: true,
      backgroundColor: headerColor,
      dimColor: idle && !badgeFlash
    }, symbol),
    h(Text, {
      inverse: true,
      backgroundColor: headerColor,
      bold: true
    }, ` ${content}`)
  );
}

interface HeaderPart {
  text: string;
  color?: string;
  bold?: boolean;
}

interface AttentionItem {
  text: string;
  narrowText: string;
  color?: string;
}

function AttentionStrip({
  items,
  terminal
}: {
  items: AttentionItem[];
  terminal: TuiInkTerminalSize;
}): React.ReactElement {
  return line(attentionStripText(items, terminal.columns), {
    color: items[0]?.color ?? "yellow"
  });
}

function attentionStripText(items: AttentionItem[], columns: number): string {
  const prefix = columns < 56 ? "attn: " : "attention: ";
  const body = columns < 56
    ? `${items[0]?.narrowText ?? ""}${items.length > 1 ? " | : more" : ""}`
    : items.map((item) => item.text).join(" | ");
  return truncateText(`${prefix}${body}`, columns);
}

function attentionItemsForModel(model: TuiCurrentContextModel): AttentionItem[] {
  const items: AttentionItem[] = [];
  const blockingRiskCount = blockingRiskAttentionCount(model);
  if (blockingRiskCount > 0) {
    items.push({
      text: `risk blocking ${blockingRiskCount} G`,
      narrowText: `risk blocking ${blockingRiskCount}`,
      color: "red"
    });
  }

  const failedChecks = model.runs.reduce(
    (total, run) => total + (run.evidence.checks?.failed ?? 0),
    0
  );
  if (failedChecks > 0) {
    items.push({
      text: `checks failed ${failedChecks} R`,
      narrowText: `checks failed ${failedChecks}`,
      color: "red"
    });
  }

  const waitingApproval = waitingRoleCallCount(model, "waiting_approval");
  if (waitingApproval > 0) {
    items.push({
      text: `waiting approval ${waitingApproval} G`,
      narrowText: `waiting approval ${waitingApproval}`
    });
  }

  const waitingContext = waitingRoleCallCount(model, "waiting_context");
  if (waitingContext > 0) {
    items.push({
      text: `waiting context ${waitingContext} G`,
      narrowText: `waiting context ${waitingContext}`
    });
  }

  const pendingReview = model.runs.filter((run) => run.reviewDecision.status === "pending").length;
  if (pendingReview > 0) {
    items.push({
      text: `review pending ${pendingReview} V`,
      narrowText: `review pending ${pendingReview}`
    });
  }

  const staleActiveRuns = model.activeRuns.filter(activeRunIsStale).length;
  if (staleActiveRuns > 0) {
    items.push({
      text: `stale run ${staleActiveRuns} R`,
      narrowText: `stale run ${staleActiveRuns}`
    });
  }

  const unavailableExecutors = unavailableExecutorCount(model);
  if (unavailableExecutors > 0) {
    items.push({
      text: `executor unavailable ${unavailableExecutors} T`,
      narrowText: `executor unavailable ${unavailableExecutors}`
    });
  }

  const proposedMemory = model.memory.counts.proposed ?? 0;
  if (proposedMemory > 0) {
    items.push({
      text: `memory proposed ${proposedMemory} M`,
      narrowText: `memory proposed ${proposedMemory}`
    });
  }
  return items;
}

function blockingRiskAttentionCount(model: TuiCurrentContextModel): number {
  const runCount = model.runs.filter((run) => run.evidence.risk?.level === "blocking").length;
  if (runCount > 0) {
    return runCount;
  }
  return model.review.evidence.risk?.level === "blocking" ? 1 : 0;
}

function waitingRoleCallCount(
  model: TuiCurrentContextModel,
  status: "waiting_approval" | "waiting_context"
): number {
  const visibleCount = model.roleCalls.nodes.filter((node) => node.status === status).length;
  if (visibleCount > 0) {
    return visibleCount;
  }
  if (model.roleCalls.loop.stopReason === status) {
    return Math.max(1, model.roleCalls.loop.waitingRoleCallIds.length);
  }
  return 0;
}

function unavailableExecutorCount(model: TuiCurrentContextModel): number {
  const taskAssignments = model.tasks.reduce(
    (total, task) =>
      total + task.assignments.filter((assignment) =>
        !assignment.executable && assignment.status !== "completed"
      ).length,
    0
  );
  const disabledAgentAdapters = model.team.roles.filter((role) =>
    role.enabled && role.executorKind === "agent_adapter" && !role.executorRunnable
  ).length;
  return taskAssignments + disabledAgentAdapters;
}

function SplashPane(): React.ReactElement {
  return block(
    line("Agent Hub TUI", { bold: true, color: "cyan" }),
    line("local-first terminal workbench", { dimColor: true })
  );
}

function activeRunDurationMs(run: TuiActiveRunBox): number | undefined {
  if (!run.startedAt) {
    return undefined;
  }
  const startedAt = Date.parse(run.startedAt);
  if (!Number.isFinite(startedAt)) {
    return undefined;
  }
  return Date.now() - startedAt;
}

function terminalConversationEntryForRun(
  model: TuiCurrentContextModel,
  runId: string
): TuiConversationEntry | undefined {
  return model.conversation.find((entry) =>
    entry.runId === runId &&
    (entry.type === "agent_completed" ||
      entry.type === "agent_failed" ||
      entry.type === "review_pending")
  );
}

function notificationMessageForEntry(entry: TuiConversationEntry): string {
  const status = entry.type === "agent_failed"
    ? "failed"
    : entry.type === "review_pending"
      ? "awaiting review"
      : "completed";
  return `Agent Hub run ${entry.runId ? compactId(entry.runId) : entry.id} ${status}`;
}

function useCompletionNotifications(
  model: TuiCurrentContextModel,
  notifyEnabled: boolean,
  notify: ((message: string) => void) | undefined
): void {
  const previousActiveRunsRef = useRef<Map<string, TuiActiveRunBox>>(
    new Map(model.activeRuns.map((run) => [run.runId, run]))
  );

  useEffect(() => {
    const previousActiveRuns = previousActiveRunsRef.current;
    const currentActiveRuns = new Map(model.activeRuns.map((run) => [run.runId, run]));
    if (notifyEnabled && notify) {
      for (const [runId, run] of previousActiveRuns.entries()) {
        if (currentActiveRuns.has(runId)) {
          continue;
        }
        const duration = activeRunDurationMs(run);
        if (duration === undefined || duration <= completionNotificationMinimumMs) {
          continue;
        }
        const entry = terminalConversationEntryForRun(model, runId);
        if (entry) {
          notify(notificationMessageForEntry(entry));
        }
      }
    }
    previousActiveRunsRef.current = currentActiveRuns;
  }, [model, notify, notifyEnabled]);
}

function FocusTabs({
  state,
  terminal
}: {
  state: TuiInkState;
  terminal: TuiInkTerminalSize;
}): React.ReactElement {
  const tabs = focusTabLabels(terminal.columns);
  return h(
    Box,
    { flexDirection: "row" },
    ...tabs.map((tab) => h(FocusTab, {
        key: tab.focus,
        active: tab.focus === state.focus,
        label: tab.label
      }))
  );
}

function FocusTab({
  active,
  label
}: {
  active: boolean;
  label: string;
}): React.ReactElement {
  return h(
    Box,
    { marginRight: 1 },
    h(Text, { color: "green", bold: true, inverse: active, wrap: "truncate" }, label)
  );
}

function focusTabLabels(columns: number): Array<{ focus: TuiInkFocus; label: string }> {
  if (columns < 56) {
    return [
      { focus: "work", label: "W" },
      { focus: "runs", label: "R" },
      { focus: "review", label: "V" },
      { focus: "graph", label: "G" },
      { focus: "tasks", label: "T" },
      { focus: "memory", label: "M" },
      { focus: "team", label: "Team" },
      { focus: "help", label: "?" }
    ];
  }
  if (columns < 84) {
    return [
      { focus: "work", label: "W Work" },
      { focus: "runs", label: "R Runs" },
      { focus: "review", label: "V View" },
      { focus: "graph", label: "G Graph" },
      { focus: "tasks", label: "T Tasks" },
      { focus: "memory", label: "M Mem" },
      { focus: "team", label: "Team" },
      { focus: "help", label: "?" }
    ];
  }
  return [
    { focus: "work", label: "[W]ork" },
    { focus: "runs", label: "[R]uns" },
    { focus: "review", label: "[V]iew" },
    { focus: "graph", label: "[G]raph" },
    { focus: "tasks", label: "[T]asks" },
    { focus: "memory", label: "[M]em" },
    { focus: "team", label: "Team" },
    { focus: "help", label: "?" }
  ];
}

interface TuiInkRenderProps {
  model: TuiCurrentContextModel;
  state: TuiInkState;
  terminal: TuiInkTerminalSize;
  animationTick: number;
  feedbackByRunId: Partial<Record<string, RunFeedbackKind>>;
}

interface WorkbenchLayoutSpec {
  navWidth: number;
  mainWidth: number;
  detailWidth: number;
}

function WorkbenchLayout(props: TuiInkRenderProps): React.ReactElement {
  const { model, state, terminal } = props;
  const layout = workbenchLayoutSpec(terminal);
  if (layout.navWidth === 0) {
    return h(MainView, props);
  }

  const mainTerminal = {
    ...terminal,
    columns: layout.mainWidth
  };
  return h(
    Box,
    { flexDirection: "row", width: terminal.columns },
    h(SideNav, { model, state, width: layout.navWidth }),
    h(
      Box,
      { flexDirection: "column", width: layout.mainWidth, flexShrink: 1 },
      h(MainView, { ...props, terminal: mainTerminal })
    ),
    ...(layout.detailWidth > 0
      ? [h(DetailPane, { model, state, width: layout.detailWidth })]
      : [])
  );
}

function workbenchLayoutSpec(terminal: TuiInkTerminalSize): WorkbenchLayoutSpec {
  if (terminal.columns < 80) {
    return {
      navWidth: 0,
      mainWidth: terminal.columns,
      detailWidth: 0
    };
  }

  const detailWidth = terminal.columns >= 112
    ? Math.min(36, Math.max(28, Math.floor(terminal.columns * 0.28)))
    : 0;
  const navWidth = terminal.columns >= 96 ? 14 : 11;
  const mainWidth = Math.max(24, terminal.columns - navWidth - detailWidth);
  return {
    navWidth,
    mainWidth,
    detailWidth
  };
}

function SideNav({
  model,
  state,
  width
}: {
  model: TuiCurrentContextModel;
  state: TuiInkState;
  width: number;
}): React.ReactElement {
  return h(
    Box,
    { flexDirection: "column", width, flexShrink: 0 },
    ...sideNavItems(model).map((item) =>
      h(SideNavItemLine, {
        key: item.focus,
        active: item.focus === state.focus,
        item,
        width
      })
    )
  );
}

interface SideNavItem {
  focus: TuiInkFocus;
  label: string;
  count?: string;
}

function SideNavItemLine({
  active,
  item,
  width
}: {
  active: boolean;
  item: SideNavItem;
  width: number;
}): React.ReactElement {
  const marker = active ? ">" : " ";
  const count = item.count ? ` ${item.count}` : "";
  const text = truncateText(`${marker} ${item.label}${count}`, Math.max(1, width - 1));
  return h(
    Text,
    { wrap: "truncate", color: active ? "cyan" : undefined, inverse: active },
    text.padEnd(Math.max(1, width - 1)),
    " "
  );
}

function sideNavItems(model: TuiCurrentContextModel): SideNavItem[] {
  const pendingReviewCount = model.runs.filter((run) => run.reviewDecision.status === "pending").length;
  return [
    {
      focus: "work",
      label: "Work",
      count: String(model.conversation.length + model.activeRuns.length)
    },
    {
      focus: "graph",
      label: "Graph",
      count: String(model.roleCalls.counts.visible ?? model.roleCalls.counts.total)
    },
    {
      focus: "runs",
      label: "Runs",
      count: String(model.runs.length)
    },
    {
      focus: "review",
      label: "Review",
      count: String(pendingReviewCount)
    },
    {
      focus: "tasks",
      label: "Tasks",
      count: String(model.tasks.length)
    },
    {
      focus: "memory",
      label: "Memory",
      count: String(model.memory.counts.proposed ?? 0)
    },
    {
      focus: "team",
      label: "Team",
      count: String(model.team.counts.enabled ?? model.team.roles.length)
    },
    {
      focus: "help",
      label: "Help",
      count: "?"
    }
  ];
}

function DetailPane({
  model,
  state,
  width
}: {
  model: TuiCurrentContextModel;
  state: TuiInkState;
  width: number;
}): React.ReactElement {
  const selectedLabel = detailPlaceholderSelection(model, state);
  const lines = [
    "Block Detail",
    "",
    selectedLabel,
    "No detail selected",
    "Not available in",
    "current read model."
  ];
  return h(
    Box,
    { flexDirection: "column", width, flexShrink: 0 },
    ...lines.map((value, index) =>
      line(index === 0 ? truncateText(value, width) : truncateText(`| ${value}`, width), {
        color: index === 0 ? "cyan" : undefined,
        bold: index === 0,
        dimColor: index > 1
      })
    )
  );
}

function detailPlaceholderSelection(
  model: TuiCurrentContextModel,
  state: TuiInkState
): string {
  if (state.focus === "runs") {
    const run = selectedRun(model, state);
    return run ? `Selected run ${compactId(run.id)}` : "Selected run unavailable";
  }
  if (state.focus === "review") {
    return model.review.selectedId
      ? `Selected review ${compactId(model.review.selectedId)}`
      : "Selected review unavailable";
  }
  if (state.focus === "graph") {
    const roleCall = visibleRoleCalls(model, state)[selectedRoleCallIndex(model, state)];
    return roleCall ? `Selected call ${compactId(roleCall.id)}` : "Selected call unavailable";
  }
  if (state.focus === "tasks") {
    const task = selectedTask(model, state);
    return task ? `Selected task ${compactId(task.id)}` : "Selected task unavailable";
  }
  return `${focusLabel(state.focus)} focus`;
}

function focusLabel(focus: TuiInkFocus): string {
  if (focus === "work") {
    return "Work";
  }
  if (focus === "runs") {
    return "Runs";
  }
  if (focus === "review") {
    return "Review";
  }
  if (focus === "graph") {
    return "Graph";
  }
  if (focus === "tasks") {
    return "Tasks";
  }
  if (focus === "memory") {
    return "Memory";
  }
  if (focus === "team") {
    return "Team";
  }
  return "Help";
}

function MainView(props: TuiInkRenderProps): React.ReactElement {
  const { model, state = createInitialInkState(), terminal } = props;
  if (state.searchOpen) {
    return h(SearchPane, { model, state });
  }
  if (state.commandPaletteOpen) {
    return h(CommandPalette, { model, state });
  }
  if (state.timelineOpen) {
    return h(TimelinePane, { model, state });
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
    return h(ReviewPane, { model, state, terminal, detail: true });
  }
  if (state.focus === "tasks") {
    return h(TasksPane, { model, state, terminal });
  }
  if (state.focus === "memory") {
    return h(MemoryPane, { model });
  }
  return h(WorkView, {
    model,
    state,
    terminal,
    animationTick: props.animationTick,
    feedbackByRunId: props.feedbackByRunId
  });
}

function WorkView({
  model,
  state,
  terminal,
  animationTick,
  feedbackByRunId
}: TuiInkRenderProps): React.ReactElement {
  const chromeLineBudget = workChromeLineBudget(model, state);
  const { collapsedBoxes, fullBoxes } = activeRunLayout(model.activeRuns, terminal, chromeLineBudget);
  const activeLineCost = activeRunLineCost(collapsedBoxes, fullBoxes, terminal, chromeLineBudget);
  const conversationLines = conversationWindowSize(terminal, activeLineCost, chromeLineBudget);
  return h(
    Box,
    { flexDirection: "column" },
    h(ConversationFlow, { model, state, terminal, visibleLines: conversationLines, feedbackByRunId }),
    ...(collapsedBoxes.length > 0
      ? collapsedBoxes.map((box) =>
          line(`${activeRunTitle(box, animationTick)} ...`, { color: activeRunColor(box) })
        )
      : []),
    ...fullBoxes.map((box) =>
      h(ActiveRunBoxView, { key: box.runId, box, terminal, animationTick, chromeLineBudget })
    )
  );
}

function ConversationFlow({
  model,
  state,
  terminal,
  visibleLines,
  feedbackByRunId
}: {
  model: TuiCurrentContextModel;
  state: TuiInkState;
  terminal: TuiInkTerminalSize;
  visibleLines: number;
  feedbackByRunId: Partial<Record<string, RunFeedbackKind>>;
}): React.ReactElement {
  if (model.conversation.length === 0) {
    return block(line("No messages in the current context.", { dimColor: true }));
  }
  const showSuggestions = state.composer.length === 0 && state.conversationScrollOffset === 0;
  const renderedLines = conversationRenderItems(model.conversation).flatMap((item) =>
    item.kind === "review_group"
      ? [reviewPendingGroupLine(item.count)]
      : item.kind === "time_anchor"
        ? [timeAnchorLine(item.label)]
        : item.kind === "separator"
          ? [conversationSeparatorLine()]
          : conversationEntryLines(item.entry, feedbackByRunId, showSuggestions, terminal)
  );
  const maxOffset = Math.max(0, renderedLines.length - visibleLines);
  const offsetFromBottom = Math.min(state.conversationScrollOffset, maxOffset);
  const start = Math.max(0, renderedLines.length - visibleLines - offsetFromBottom);
  const visible = renderedLines.slice(start, start + visibleLines);
  return block(
    ...visible
  );
}

type ConversationRenderItem =
  | { kind: "entry"; entry: TuiConversationEntry }
  | { kind: "review_group"; count: number }
  | { kind: "separator" }
  | { kind: "time_anchor"; label: string };

function conversationRenderItems(entries: TuiConversationEntry[]): ConversationRenderItem[] {
  const items: ConversationRenderItem[] = [];
  let previousEntry: TuiConversationEntry | undefined;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    appendConversationBoundary(items, previousEntry, entry);
    if (entry.type !== "review_pending") {
      items.push({ kind: "entry", entry });
      previousEntry = entry;
      continue;
    }
    const group: TuiConversationEntry[] = [];
    while (entries[index]?.type === "review_pending") {
      group.push(entries[index]);
      index += 1;
    }
    index -= 1;
    if (group.length > 3) {
      items.push({ kind: "review_group", count: group.length });
    } else {
      items.push(...group.map((value) => ({ kind: "entry" as const, entry: value })));
    }
    previousEntry = group.at(-1) ?? entry;
  }
  return items;
}

function appendConversationBoundary(
  items: ConversationRenderItem[],
  previousEntry: TuiConversationEntry | undefined,
  entry: TuiConversationEntry
): void {
  if (!previousEntry) {
    return;
  }
  items.push({ kind: "separator" });
  const label = conversationGapLabel(previousEntry.timestamp, entry.timestamp);
  if (label) {
    items.push({ kind: "time_anchor", label });
  }
}

function conversationSeparatorLine(): React.ReactElement {
  return line("  " + "─".repeat(28), { dimColor: true });
}

function timeAnchorLine(label: string): React.ReactElement {
  return line(`  ── ${label} ──`, { dimColor: true });
}

function conversationGapLabel(previousTimestamp: string, timestamp: string): string | undefined {
  const previous = Date.parse(previousTimestamp);
  const current = Date.parse(timestamp);
  if (!Number.isFinite(previous) || !Number.isFinite(current)) {
    return undefined;
  }
  const deltaMs = current - previous;
  if (deltaMs < 5 * 60 * 1000) {
    return undefined;
  }
  return `${formatDuration(deltaMs)} later`;
}

function reviewPendingGroupLine(count: number): React.ReactElement {
  return line(`┃ △ ${count} pending reviews collapsed — [V]iew review queue`, {
    color: "yellow"
  });
}

function conversationEntryLines(
  entry: TuiConversationEntry,
  feedbackByRunId: Partial<Record<string, RunFeedbackKind>>,
  showSuggestions: boolean,
  terminal: TuiInkTerminalSize
): React.ReactElement[] {
  if (entry.type === "agent_completed" || entry.type === "agent_failed") {
    const statusIcon = entry.type === "agent_failed" ? "✗" : "✓";
    const tone = entry.type === "agent_failed" ? "red" : "cyan";
    const feedback = entry.runId ? feedbackByRunId[entry.runId] : undefined;
    return [
      agentEntryHeaderLine(
        `${conversationEntryHandle(entry)} ${entry.runId ? compactId(entry.runId) : ""} ${statusIcon} ${entry.statusLabel ?? ""}`.trim(),
        entry,
        tone,
        feedback
      ),
      ...conversationContentLines(entry.outputLines ?? entry.content, { prefix: "┃   ", agent: true, tone, keyPrefix: entry.id }, terminal),
      ...(entry.verificationLine
        ? conversationRichLines(`~ ${entry.verificationLine}`, { prefix: "┃   ", agent: true, tone }, terminal)
        : []),
      ...(entry.riskLine
        ? conversationRichLines(`⚠ ${entry.riskLine}`, { prefix: "┃   ", agent: true, tone, color: "yellow" }, terminal)
        : []),
      ...inlineDiffLines(entry.inlineDiff, "┃   ", entry.id, terminal),
      ...conversationSuggestionLines(entry, showSuggestions, tone, terminal)
    ];
  }
  if (entry.type === "review_pending") {
    const tone = "yellow";
    const feedback = entry.runId ? feedbackByRunId[entry.runId] : undefined;
    return [
      agentEntryHeaderLine(
        `${conversationEntryHandle(entry)} ${entry.runId ? compactId(entry.runId) : ""} △ ${entry.statusLabel ?? "awaiting review"}`.trim(),
        entry,
        tone,
        feedback
      ),
      ...conversationContentLines(entry.outputLines ?? entry.content, { prefix: "┃   ", agent: true, tone, keyPrefix: entry.id }, terminal),
      ...(entry.verificationLine
        ? conversationRichLines(`~ ${entry.verificationLine}`, { prefix: "┃   ", agent: true, tone }, terminal)
        : []),
      ...(entry.riskLine
        ? conversationRichLines(`⚠ ${entry.riskLine}`, { prefix: "┃   ", agent: true, tone, color: "yellow" }, terminal)
        : []),
      ...inlineDiffLines(entry.inlineDiff, "┃   ", entry.id, terminal),
      ...conversationRichLines(`△ ${entry.content ?? "open [V]iew for details"}`, { prefix: "┃   ", agent: true, tone, color: "yellow" }, terminal),
      ...conversationSuggestionLines(entry, showSuggestions, tone, terminal)
    ];
  }
  if (entry.type === "delegation") {
    return [
      line(`  → delegated to @${entry.delegatedTo ?? "role"}: ${entry.delegationTask ?? entry.content ?? ""}`, { color: "cyan" })
    ];
  }
  return [
    line(`${entry.author} ${formatConversationTimestamp(entry.timestamp)}`.trim(), { dimColor: true }),
    ...conversationContentLines(entry.content, { prefix: "  ", agent: false, keyPrefix: entry.id }, terminal)
  ];
}

function agentEntryHeaderLine(
  title: string,
  entry: TuiConversationEntry,
  tone: string,
  feedback?: RunFeedbackKind
): React.ReactElement {
  const metadata = [
    entry.elapsedLabel,
    entry.usageLabel,
    formatConversationTimestamp(entry.timestamp)
  ].filter((value): value is string => Boolean(value));
  const backgroundColor = feedback === "success"
    ? "green"
    : feedback === "failure"
      ? "red"
      : undefined;
  const feedbackPrefix = feedback === "failure" ? "!! " : "";
  return h(
    Text,
    { wrap: "truncate", backgroundColor },
    h(Text, { color: tone, bold: true }, "┃"),
    " ",
    h(Text, { color: tone, bold: true }, `${feedbackPrefix}${title}`),
    ...(metadata.length > 0
      ? [
          h(Text, { key: "metadata", dimColor: true }, `  ${metadata.join("  ")}`)
        ]
      : [])
  );
}

function conversationContentLines(
  content: string[] | string | undefined,
  options: {
    prefix: string;
    agent: boolean;
    tone?: string;
    keyPrefix: string;
  },
  terminal: TuiInkTerminalSize
): React.ReactElement[] {
  const lines = Array.isArray(content)
    ? content
    : (content ?? "")
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean);
  const visible = lines.length > 0 ? lines : ["(empty)"];
  let inCodeBlock = false;
  return visible.flatMap((value, index) => {
    const trimmed = value.trim();
    const isFence = trimmed.startsWith("```");
    const renderAsCode = inCodeBlock && !isFence;
    const rendered = conversationRichLines(value, {
      ...options,
      key: `${options.keyPrefix}-content-${index}`,
      code: renderAsCode || isFence,
      codeFence: isFence
    }, terminal);
    if (isFence) {
      inCodeBlock = !inCodeBlock;
    }
    return rendered;
  });
}

function conversationSuggestionLines(
  entry: TuiConversationEntry,
  showSuggestions: boolean,
  tone: string,
  terminal: TuiInkTerminalSize
): React.ReactElement[] {
  if (!showSuggestions || !entry.suggestions || entry.suggestions.length === 0) {
    return [];
  }
  return entry.suggestions.flatMap((suggestion) =>
    conversationRichLines(`[${suggestion.key}] ${suggestion.label}`, {
      prefix: "┃   ",
      agent: true,
      tone,
      dimColor: true,
      key: `${entry.id}-suggestion-${suggestion.key}`
    }, terminal)
  );
}

function inlineDiffLines(
  diff: TuiInlineDiffSummary | undefined,
  prefix: string,
  keyPrefix: string,
  terminal: TuiInkTerminalSize
): React.ReactElement[] {
  if (!diff) {
    return [];
  }
  if (diff.mode === "summary") {
    return [
      ...conversationRichLines(`╭ diff ${diff.summary}`, {
        prefix,
        agent: true,
        tone: "cyan",
        dimColor: true,
        key: `${keyPrefix}-diff-card-top`
      }, terminal),
      ...conversationRichLines("╰ review details available in View", {
        prefix,
        agent: true,
        tone: "cyan",
        dimColor: true,
        key: `${keyPrefix}-diff-card-bottom`
      }, terminal)
    ];
  }
  return [
    ...conversationRichLines(`╭ diff ${diff.summary}`, {
      prefix,
      agent: true,
      tone: "cyan",
      dimColor: true,
      key: `${keyPrefix}-diff-card-top`
    }, terminal),
    ...diff.lines.flatMap((lineItem, index) =>
      conversationRichLines(`│ ${lineItem.text}`, {
        prefix,
        agent: true,
        tone: "cyan",
        color: diffLineColor(lineItem.kind),
        dimColor: lineItem.kind === "file",
        key: `${keyPrefix}-diff-${index}`
      }, terminal)
    ),
    ...conversationRichLines("╰ end diff", {
      prefix,
      agent: true,
      tone: "cyan",
      dimColor: true,
      key: `${keyPrefix}-diff-card-bottom`
    }, terminal)
  ];
}

function diffLineColor(kind: TuiInlineDiffSummary["lines"][number]["kind"]): string | undefined {
  if (kind === "add") {
    return "green";
  }
  if (kind === "delete") {
    return "red";
  }
  return undefined;
}

function conversationRichLines(
  value: string,
  options: {
    prefix: string;
    agent: boolean;
    tone?: string;
    color?: string;
    dimColor?: boolean;
    code?: boolean;
    codeFence?: boolean;
    key?: string;
  },
  terminal: TuiInkTerminalSize
): React.ReactElement[] {
  const contentWidth = Math.max(1, terminal.columns - options.prefix.length);
  return hardWrapLine(value, contentWidth).map((chunk, index) =>
    conversationRichLine(chunk, {
      ...options,
      key: options.key ? `${options.key}-${index}` : undefined
    })
  );
}

function conversationRichLine(
  value: string,
  options: {
    prefix: string;
    agent: boolean;
    tone?: string;
    color?: string;
    dimColor?: boolean;
    code?: boolean;
    codeFence?: boolean;
    key?: string;
  }
): React.ReactElement {
  const prefixText = options.agent
    ? h(Text, { color: options.tone ?? "cyan", bold: true }, options.prefix.slice(0, 1))
    : h(Text, null, options.prefix);
  const spacerText = options.agent ? options.prefix.slice(1) : "";
  return h(
    Text,
    { key: options.key, wrap: "truncate", color: options.color, dimColor: options.dimColor },
    prefixText,
    spacerText,
    ...richTextSegments(value, options)
  );
}

function richTextSegments(
  value: string,
  options: {
    code?: boolean;
    codeFence?: boolean;
  }
): React.ReactNode[] {
  if (options.codeFence) {
    return [h(Text, { key: "fence", dimColor: true }, value)];
  }
  if (options.code) {
    return codeHighlightSegments(value);
  }
  if (isShellCommandLine(value)) {
    return [h(Text, { key: "command", bold: true }, value)];
  }
  return pathHighlightSegments(value);
}

function pathHighlightSegments(value: string): React.ReactNode[] {
  const segments: React.ReactNode[] = [];
  const pathPattern = /((?:\.{1,2}\/|\/)?(?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9_-]+(?::\d+(?::\d+)?)?|[\w.-]+\.(?:[cm]?[tj]sx?|json|md|css|scss|html|py|rs|go|ya?ml|toml)(?::\d+(?::\d+)?)?)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pathPattern.exec(value)) !== null) {
    if (match.index > lastIndex) {
      segments.push(value.slice(lastIndex, match.index));
    }
    const matchedPath = match[0];
    segments.push(
      h(Text, { key: `path-${match.index}`, color: "blue", underline: true }, osc8FileLink(matchedPath))
    );
    lastIndex = match.index + matchedPath.length;
  }
  if (lastIndex < value.length) {
    segments.push(value.slice(lastIndex));
  }
  return segments.length > 0 ? segments : [value];
}

function codeHighlightSegments(value: string): React.ReactNode[] {
  const segments: React.ReactNode[] = [];
  const tokenPattern =
    /\/\/.*|#.*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:async|await|break|case|catch|class|const|continue|else|export|extends|finally|for|from|function|if|implements|import|interface|let|new|return|switch|throw|try|type|var|while)\b/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(value)) !== null) {
    if (match.index > lastIndex) {
      segments.push(value.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("//") || token.startsWith("#")) {
      segments.push(h(Text, { key: `comment-${match.index}`, dimColor: true }, token));
    } else if (token.startsWith("\"") || token.startsWith("'") || token.startsWith("`")) {
      segments.push(h(Text, { key: `string-${match.index}`, color: "green" }, token));
    } else {
      segments.push(h(Text, { key: `keyword-${match.index}`, color: "cyan" }, token));
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < value.length) {
    segments.push(value.slice(lastIndex));
  }
  return segments.length > 0 ? segments : [value];
}

function isShellCommandLine(value: string): boolean {
  const trimmed = value.trim();
  return (
    /^(?:[$>]\s*)?(?:agent-hub|codex|claude|git|node|npm|npx|pnpm|tsx|tsc|vitest)\b/.test(trimmed) ||
    /^(?:command|next|run|running|verification)\s+[`']?(?:agent-hub|codex|claude|git|node|npm|npx|pnpm|tsx|tsc|vitest)\b/i.test(trimmed)
  );
}

function osc8FileLink(value: string): string {
  if (!supportsOsc8Links()) {
    return value;
  }
  const target = fileLinkTarget(value);
  if (!target) {
    return value;
  }
  return `\u001B]8;;${target}\u0007${value}\u001B]8;;\u0007`;
}

function supportsOsc8Links(): boolean {
  return (
    process.env.AGENT_HUB_TUI_OSC8 !== "0" &&
    process.env.CI !== "true" &&
    process.stdout.isTTY === true
  );
}

function fileLinkTarget(value: string): string | undefined {
  const pathPart = value.replace(/:\d+(?::\d+)?$/, "");
  if (pathPart.startsWith("/")) {
    return `file://${pathPart}`;
  }
  const base = process.cwd().replace(/\/$/, "");
  return `file://${base}/${pathPart.replace(/^\.\//, "")}`;
}

function conversationEntryHandle(entry: TuiConversationEntry): string {
  if (entry.displayHandle) {
    return `@${entry.displayHandle}`;
  }
  return entry.agent ? `@${entry.agent}` : entry.author;
}

function ActiveRunBoxView({
  box,
  terminal,
  animationTick,
  chromeLineBudget
}: {
  box: TuiActiveRunBox;
  terminal: TuiInkTerminalSize;
  animationTick: number;
  chromeLineBudget: number;
}): React.ReactElement {
  const width = activeRunBoxWidth(terminal);
  const innerWidth = Math.max(12, width - 2);
  const title = activeRunTitle(box, animationTick);
  const top = roundedBorderedTitle(title, innerWidth);
  const color = activeRunColor(box);
  const compact = usesCompactActiveRunBox(terminal);
  const contentLines = compact
    ? activeRunCompactOutputLines(box, terminal)
    : activeRunVisibleOutputLines(box, terminal, chromeLineBudget);
  const contentHeight = compact
    ? contentLines.length
    : activeRunContentHeight(contentLines.length, terminal, chromeLineBudget);
  const paddedLines = [
    ...contentLines,
    ...Array.from({ length: Math.max(0, contentHeight - contentLines.length) }, () => "")
  ];
  const progress = activeRunProgress(box.outputLines);
  return block(
    line(top, { color }),
    ...paddedLines.map((value) => line(`│ ${value.padEnd(innerWidth - 2)} │`, { color })),
    line(`│ ${activeRunFooter(progress, innerWidth - 2)} │`, { color }),
    line(`╰${"─".repeat(innerWidth)}╯`, { color })
  );
}

function activeRunTitle(box: TuiActiveRunBox, animationTick: number): string {
  const metadata = [
    activeRunSpinnerFrame(animationTick),
    "running",
    activeRunIsStale(box) ? "stale" : undefined,
    activeRunElapsedLabel(box),
    box.usageLabel
  ].filter((value): value is string => Boolean(value));
  return `@${box.displayHandle ?? box.agent} ${compactId(box.runId)} ${metadata.join(" ")}`;
}

function activeRunColor(box: TuiActiveRunBox): string {
  return activeRunIsStale(box) ? "yellow" : "green";
}

function activeRunIsStale(box: TuiActiveRunBox): boolean {
  const duration = activeRunDurationMs(box);
  return Boolean(
    duration !== undefined &&
    duration >= staleActiveRunThresholdMs &&
    !hasUsefulActiveRunOutput(box)
  );
}

function hasUsefulActiveRunOutput(box: TuiActiveRunBox): boolean {
  return box.outputLines.some((value) => {
    const normalized = value.trim().toLowerCase();
    return normalized.length > 0 && normalized !== "agent thinking...";
  });
}

function activeRunSpinnerFrame(animationTick: number): string {
  return activeRunSpinnerFrames[animationTick % activeRunSpinnerFrames.length] ?? activeRunSpinnerFrames[0];
}

function activeRunElapsedLabel(box: TuiActiveRunBox): string | undefined {
  if (!box.startedAt) {
    return box.elapsedLabel;
  }
  const startedAt = Date.parse(box.startedAt);
  if (!Number.isFinite(startedAt)) {
    return box.elapsedLabel;
  }
  const elapsed = Date.now() - startedAt;
  if (elapsed < 0) {
    return box.elapsedLabel;
  }
  return formatDuration(elapsed);
}

function roundedBorderedTitle(title: string, innerWidth: number): string {
  const decorated = `─ ${truncateText(title, Math.max(8, innerWidth - 4))} `;
  return `╭${decorated}${"─".repeat(Math.max(0, innerWidth - decorated.length))}╮`;
}

interface ActiveRunProgress {
  ratio: number;
  label: string;
}

function activeRunProgress(lines: string[]): ActiveRunProgress | undefined {
  for (const lineText of [...lines].reverse()) {
    const percentage = /\b(\d{1,3})\s*%/.exec(lineText);
    if (percentage) {
      const value = Number(percentage[1]);
      if (value >= 0 && value <= 100) {
        return {
          ratio: value / 100,
          label: `${value}%`
        };
      }
    }
    const fraction = /\b(?:step\s*)?(\d{1,4})\s*\/\s*(\d{1,4})\b/i.exec(lineText);
    if (fraction) {
      const current = Number(fraction[1]);
      const total = Number(fraction[2]);
      if (total > 0 && current >= 0 && current <= total) {
        return {
          ratio: current / total,
          label: `${current}/${total}`
        };
      }
    }
  }
  return undefined;
}

function activeRunFooter(progress: ActiveRunProgress | undefined, width: number): string {
  if (!progress) {
    return "▍".padEnd(width);
  }
  const label = ` ${progress.label}`;
  const barWidth = Math.max(4, width - label.length);
  const filled = Math.min(barWidth, Math.max(0, Math.round(progress.ratio * barWidth)));
  const bar = `${"█".repeat(filled)}${"░".repeat(Math.max(0, barWidth - filled))}`;
  return truncateText(`${bar}${label}`, width).padEnd(width);
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
        color: run.id === activeRun?.id ? "green" : undefined,
        inverse: run.id === activeRun?.id
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
  terminal,
  detail = false
}: {
  model: TuiCurrentContextModel;
  state: TuiInkState;
  terminal: TuiInkTerminalSize;
  detail?: boolean;
}): React.ReactElement {
  const run = selectedRun(model, state);
  const compareRuns = run
    ? model.runs.filter((candidate) => candidate.taskId === run.taskId).slice(0, 2)
    : [];
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
    ...(model.review.evidence.inlineDiff
      ? [
          line(
            state.reviewDiffExpanded
              ? "diff expanded (Esc collapses)"
              : "diff available (Enter/Space expands)",
            { dimColor: true }
          )
        ]
      : []),
    ...(state.reviewDiffExpanded
      ? inlineDiffLines(model.review.evidence.inlineDiff, "  ", "review", terminal)
      : []),
    ...(state.reviewCompareMode && compareRuns.length >= 2
      ? [
          line("split compare (read-only)", { bold: true }),
          ...compareRuns.map((candidate) =>
            line(runLine(candidate, candidate.id === run?.id), {
              inverse: candidate.id === run?.id
            })
          )
        ]
      : []),
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
        `${selected ? "▌" : " "} ${indent}@${node.callerRole} -> @${node.calleeRole} [${node.statusLabel}]${run} ${truncateText(node.task, 58)}`,
        { color: selected ? "green" : undefined, inverse: selected }
      );
    })
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
    ...model.tasks.slice(offset, offset + windowSize).map((item, index) => {
      const selected = offset + index === selectedIndex;
      return line(`${selected ? "▌" : " "} ${item.id} ${item.status} ${truncateText(item.title, 72)}${item.nextAction ? ` next ${item.nextAction}` : ""}`, {
        inverse: selected
      });
    }),
    ...(task
      ? [
          line(""),
          line(`Selected ${task.id}`, { bold: true }),
          ...task.assignments.map((assignment) =>
            line(`${assignment.label} ${assignment.status}${assignment.executable ? "" : " needs executor"}`)
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
      line(`command ${team.command ?? "agent-hub project list"}`, { dimColor: true })
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
        `${role.enabled ? " " : "!"} @${role.handle} ${role.source} ${teamExecutorLabel(role)}${role.defaultRoom ? ` #${role.defaultRoom}` : ""} - ${truncateText(role.capabilitySummary, 62)}`
      )
    ),
    ...(remaining > 0 ? [line(`${remaining} more roles hidden by window size`, { dimColor: true })] : []),
    line(""),
    line(`command ${team.command ?? "agent-hub project list"}`, { dimColor: true })
  );
}

function teamExecutorLabel(role: TuiCurrentContextModel["team"]["roles"][number]): string {
  if (role.executorKind !== "agent_adapter") {
    return "manual";
  }
  if (!role.executorRunnable) {
    return "agent unavailable";
  }
  const adapter = role.executorLabel.split("/").at(-1)?.trim();
  return adapter ? `runs with ${adapter}` : "agent ready";
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
    line(`approved memory ${model.memory.approvedSource}`),
    line(`reminder ${model.memory.approvalReminder}`),
    line(`command ${model.memory.command ?? "register a project before listing memory"}`),
    ...model.memory.approvalCommands.map((command) => line(command, { dimColor: true })),
    line(""),
    line(`selected skills ${selectedSkills}`),
    line(`available skills ${availableSkills}`),
    line(`skill source ${model.skills.runtimeSource}`),
    line(`context ${contextModeLabel(model.skills.contextMode)}`)
  );
}

function CommandPalette({
  model,
  state
}: {
  model: TuiCurrentContextModel;
  state: TuiInkState;
}): React.ReactElement {
  const items = filteredPaletteItems(model, state);
  const selectedIndex = Math.min(state.paletteSelectedIndex, Math.max(0, items.length - 1));
  return h(
    Pane,
    { title: "Command Palette" },
    line(`:${state.paletteQuery}`, { color: "green" }),
    line(`${items.length} matches  enter execute  esc close`, { dimColor: true }),
    ...items.slice(0, 12).map((item, index) =>
      paletteItemLine(item, state.paletteQuery, index === selectedIndex)
    )
  );
}

function SearchPane({
  model,
  state
}: {
  model: TuiCurrentContextModel;
  state: TuiInkState;
}): React.ReactElement {
  const matches = conversationSearchMatches(model, state.searchQuery);
  const selectedIndex = Math.min(state.searchMatchIndex, Math.max(0, matches.length - 1));
  const selected = matches[selectedIndex];
  return h(
    Pane,
    { title: "Search" },
    line(`/${state.searchQuery}`, { color: "green" }),
    line(
      state.searchQuery
        ? `${matches.length === 0 ? 0 : selectedIndex + 1}/${matches.length} matches  up/down jump  esc close`
        : "type to search conversation text",
      { dimColor: true }
    ),
    ...(selected
      ? [
          highlightedLine(selected.text, state.searchQuery),
          line(`source ${selected.source}`, { dimColor: true })
        ]
      : [])
  );
}

function TimelinePane({
  model,
  state
}: {
  model: TuiCurrentContextModel;
  state: TuiInkState;
}): React.ReactElement {
  const items = timelineItems(model).slice(-12);
  return h(
    Pane,
    { title: "Timeline" },
    line(
      `${state.notifyEnabled ? "notify on" : "notify off"}  L close  /notify toggle  /timeline open`,
      { dimColor: true }
    ),
    ...(items.length > 0
      ? items.map((item) =>
          line(
            `${item.marker} ${item.time} ${truncateText(item.text, 92)}`,
            { color: item.color }
          )
        )
      : [line("No timeline events in the current context.", { dimColor: true })])
  );
}

interface TimelineItem {
  marker: string;
  time: string;
  text: string;
  color?: string;
}

function timelineItems(model: TuiCurrentContextModel): TimelineItem[] {
  const conversationRunIds = new Set(
    model.conversation
      .map((entry) => entry.runId)
      .filter((value): value is string => Boolean(value))
  );
  return [
    ...model.conversation.map(timelineItemForConversationEntry),
    ...model.activeRuns.map(timelineItemForActiveRun),
    ...model.runs
      .filter((run) => !conversationRunIds.has(run.id))
      .map(timelineItemForRun)
  ].sort((left, right) => left.time.localeCompare(right.time));
}

function timelineItemForConversationEntry(entry: TuiConversationEntry): TimelineItem {
  const label = firstContentLine(entry.outputLines ?? entry.content ?? entry.delegationTask);
  if (entry.type === "agent_failed") {
    return {
      marker: "✗",
      time: formatConversationTimestamp(entry.timestamp),
      text: `${conversationEntryHandle(entry)} ${entry.runId ? compactId(entry.runId) : ""} failed ${label}`.trim(),
      color: "red"
    };
  }
  if (entry.type === "agent_completed") {
    return {
      marker: "✓",
      time: formatConversationTimestamp(entry.timestamp),
      text: `${conversationEntryHandle(entry)} ${entry.runId ? compactId(entry.runId) : ""} completed ${label}`.trim(),
      color: "green"
    };
  }
  if (entry.type === "review_pending") {
    return {
      marker: "△",
      time: formatConversationTimestamp(entry.timestamp),
      text: `${conversationEntryHandle(entry)} ${entry.runId ? compactId(entry.runId) : ""} awaiting review ${label}`.trim(),
      color: "yellow"
    };
  }
  if (entry.type === "delegation") {
    return {
      marker: "→",
      time: formatConversationTimestamp(entry.timestamp),
      text: `${conversationEntryHandle(entry)} delegated to @${entry.delegatedTo ?? "role"} ${label}`.trim(),
      color: "cyan"
    };
  }
  return {
    marker: "·",
    time: formatConversationTimestamp(entry.timestamp),
    text: `${entry.author} ${label}`.trim()
  };
}

function timelineItemForActiveRun(run: TuiActiveRunBox): TimelineItem {
  const label = firstContentLine(run.outputLines);
  return {
    marker: "●",
    time: run.startedAt ? formatConversationTimestamp(run.startedAt) : "--:--:--",
    text: `@${run.displayHandle ?? run.agent} ${compactId(run.runId)} running ${label}`.trim(),
    color: "green"
  };
}

function timelineItemForRun(run: TuiRunSummary): TimelineItem {
  const status = run.status === "failed" ? "failed" : run.status;
  return {
    marker: run.status === "failed" ? "✗" : run.status === "succeeded" ? "✓" : "·",
    time: formatConversationTimestamp(run.updatedAt ?? run.completedAt ?? run.startedAt),
    text: `${compactId(run.id)} @${run.agentKind} ${status} ${run.taskTitle ?? run.taskId}`,
    color: run.status === "failed" ? "red" : run.status === "succeeded" ? "green" : undefined
  };
}

function firstContentLine(content: string[] | string | undefined): string {
  if (Array.isArray(content)) {
    return content.find((value) => value.trim().length > 0)?.trim() ?? "";
  }
  return (content ?? "")
    .split(/\r?\n/)
    .find((value) => value.trim().length > 0)
    ?.trim() ?? "";
}

function HelpPane(): React.ReactElement {
  return h(
    Pane,
    { title: "Help" },
    line("tabs: W work  R runs  V review  G graph  T tasks  M memory  E team"),
    line(": palette   /search   /timeline or L   /notify   /team"),
    line("review: a accept  R reject  audit only; no apply, merge, or push"),
    line("prompt: enter submit  ctrl+o newline  esc clear  ctrl+u clear")
  );
}

type PaletteItem =
  | { kind: "focus"; label: string; focus: TuiInkKey }
  | { kind: "command"; label: string; command: string };

function paletteItems(model: TuiCurrentContextModel, state: TuiInkState): PaletteItem[] {
  const run = selectedRun(model, state);
  const roleCommand = roleListCommand(model);
  const commands = [
    commandHintForFocus(model, state),
    roleCommand,
    ...(run?.commands ?? []),
    ...model.review.commands,
    ...model.memory.approvalCommands
  ].filter((value, index, values): value is string =>
    Boolean(value) && values.indexOf(value) === index
  );
  return [
    { kind: "focus", label: "Open Work", focus: "work" },
    { kind: "focus", label: "Open Runs", focus: "runs" },
    { kind: "focus", label: "Open Review", focus: "review" },
    { kind: "focus", label: "Open Team", focus: "team" },
    { kind: "focus", label: "Open Memory", focus: "memory" },
    { kind: "command", label: "/timeline", command: "/timeline" },
    { kind: "command", label: "/notify", command: "/notify" },
    ...commands.map((command) => ({ kind: "command" as const, label: command, command }))
  ];
}

function filteredPaletteItems(model: TuiCurrentContextModel, state: TuiInkState): PaletteItem[] {
  const query = state.paletteQuery.trim();
  const items = paletteItems(model, state);
  if (!query) {
    return items;
  }
  return items
    .map((item) => ({
      item,
      score: fuzzyScore(item.label, query)
    }))
    .filter((value) => value.score >= 0)
    .sort((left, right) => left.score - right.score)
    .map((value) => value.item);
}

function paletteItemLine(
  item: PaletteItem,
  query: string,
  selected: boolean
): React.ReactElement {
  return h(
    Text,
    { wrap: "truncate", inverse: selected },
    selected ? "> " : "  ",
    ...highlightSegments(item.label, query, selected ? "black" : "cyan")
  );
}

interface SearchMatch {
  source: string;
  text: string;
}

function conversationSearchMatches(
  model: TuiCurrentContextModel,
  query: string
): SearchMatch[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }
  return conversationSearchDocuments(model.conversation)
    .filter((item) => item.text.toLowerCase().includes(normalizedQuery));
}

function conversationSearchDocuments(entries: TuiConversationEntry[]): SearchMatch[] {
  return entries.flatMap((entry) => {
    const source = entry.runId ?? entry.id;
    const values = [
      conversationEntryHandle(entry),
      entry.content,
      ...(entry.outputLines ?? []),
      entry.verificationLine,
      entry.riskLine,
      ...(entry.inlineDiff?.lines.map((lineItem) => lineItem.text) ?? []),
      ...(entry.suggestions?.map((suggestion) => suggestion.label) ?? [])
    ].filter((value): value is string => Boolean(value));
    return values.map((text) => ({ source, text }));
  });
}

function highlightedLine(value: string, query: string): React.ReactElement {
  return h(Text, { wrap: "truncate" }, ...highlightSegments(value, query, "black"));
}

function highlightSegments(value: string, query: string, highlightColor: string): React.ReactNode[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [value];
  }
  const segments: React.ReactNode[] = [];
  const lowerValue = value.toLowerCase();
  let index = 0;
  let matchIndex = lowerValue.indexOf(normalizedQuery);
  while (matchIndex >= 0) {
    if (matchIndex > index) {
      segments.push(value.slice(index, matchIndex));
    }
    segments.push(
      h(Text, { key: `match-${matchIndex}`, backgroundColor: "yellow", color: highlightColor }, value.slice(matchIndex, matchIndex + normalizedQuery.length))
    );
    index = matchIndex + normalizedQuery.length;
    matchIndex = lowerValue.indexOf(normalizedQuery, index);
  }
  if (index < value.length) {
    segments.push(value.slice(index));
  }
  return segments;
}

function fuzzyScore(value: string, query: string): number {
  const haystack = value.toLowerCase();
  const needle = query.toLowerCase();
  let score = 0;
  let position = -1;
  for (const character of needle) {
    const nextPosition = haystack.indexOf(character, position + 1);
    if (nextPosition < 0) {
      return -1;
    }
    score += nextPosition - position;
    position = nextPosition;
  }
  return score;
}

function Composer({ model, state }: { model: TuiCurrentContextModel; state: TuiInkState }): React.ReactElement {
  const agent = model.context.selectedAgent ? `@${model.context.selectedAgent}` : "@agent";
  const completion = agentCompletionForState(model, state);
  return h(
    Box,
    { flexDirection: "column" },
    line(composerPreviewLine(model, state), { dimColor: true }),
    ...(completion ? [agentCompletionLine(completion)] : []),
    ...(state.composer
      ? composerInputLines(state)
      : [
          h(
            Box,
            { flexDirection: "row" },
            h(Text, null, "> "),
            h(Text, { dimColor: true }, `${agent} prompt`)
          )
        ])
  );
}

function StatusBar({
  state,
  terminal
}: {
  state: TuiInkState;
  terminal: TuiInkTerminalSize;
}): React.ReactElement {
  const hints = contextualShortcutHint(state, terminal.columns);
  const localState = [
    state.notifyEnabled ? "notify on" : "notify off",
    state.timelineOpen ? "timeline" : undefined
  ].filter(Boolean).join("  ");
  const showLocalState = terminal.columns >= 72 && localState.length > 0;
  return line(`${hints}${showLocalState ? `  ${localState}` : ""}`, { dimColor: true });
}

interface AgentCompletion {
  tokenStart: number;
  tokenEnd: number;
  query: string;
  options: string[];
  selectedIndex: number;
  selectedOption: string;
}

function composerPreviewLine(model: TuiCurrentContextModel, state: TuiInkState): string {
  const target = composerTarget(model, state);
  const thread = model.context.threadTitle
    ? `${model.context.threadTitle}${model.context.roomHandle ? ` (#${model.context.roomHandle})` : ""}`
    : model.context.threadId ?? (model.context.roomHandle ? `#${model.context.roomHandle}` : "current");
  return `send ${target}  thread ${thread}  context ${contextModeLabel(model.context.contextMode)}`;
}

function contextModeLabel(mode: string): string {
  if (mode === "runtime_injection") {
    return "runtime";
  }
  if (mode === "worktree_overlay") {
    return "worktree overlay";
  }
  if (mode === "repo_export") {
    return "repo export";
  }
  return mode;
}

function composerTarget(model: TuiCurrentContextModel, state: TuiInkState): string {
  const options = new Set(agentCompletionOptions(model));
  const match = /@([A-Za-z0-9_-]+)/.exec(state.composer);
  if (match && options.has(match[1])) {
    return `@${match[1]}`;
  }
  return model.context.selectedAgent ? `@${model.context.selectedAgent}` : "@agent";
}

function agentCompletionLine(completion: AgentCompletion): React.ReactElement {
  return h(
    Text,
    { wrap: "truncate" },
    h(Text, { dimColor: true }, "agents "),
    ...completion.options.flatMap((option, index) => [
      h(
        Text,
        {
          key: `agent-${option}`,
          inverse: index === completion.selectedIndex,
          color: index === completion.selectedIndex ? "black" : "cyan"
        },
        `@${option}`
      ),
      " "
    ])
  );
}

function composerInputLines(state: TuiInkState): React.ReactElement[] {
  const cursor = composerCursorLine(state);
  const lines = state.composer.split("\n");
  return lines.map((value, index) => {
    const isCursorLine = index === cursor.line;
    const prefix = index === 0 ? "> " : "  ";
    if (!isCursorLine) {
      return h(
        Box,
        { key: `composer-${index}`, flexDirection: "row" },
        h(Text, null, prefix),
        h(Text, { color: "green" }, value.length > 0 ? value : " ")
      );
    }
    const before = value.slice(0, cursor.column);
    const cursorCharacter = value[cursor.column] ?? " ";
    const after = value.slice(cursor.column + (cursor.column < value.length ? 1 : 0));
    return h(
      Box,
      { key: `composer-${index}`, flexDirection: "row" },
      h(Text, null, prefix),
      h(Text, { color: "green" }, before),
      h(Text, { color: "green", inverse: true }, cursorCharacter),
      h(Text, { color: "green" }, after)
    );
  });
}

function composerCursorLine(state: TuiInkState): { line: number; column: number } {
  let remaining = boundedComposerCursor(state);
  const lines = state.composer.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const value = lines[index] ?? "";
    if (remaining <= value.length) {
      return { line: index, column: remaining };
    }
    remaining -= value.length + 1;
  }
  const lastIndex = Math.max(0, lines.length - 1);
  return { line: lastIndex, column: lines[lastIndex]?.length ?? 0 };
}

function contextualShortcutHint(state: TuiInkState, columns: number): string {
  if (state.composer.length > 0) {
    if (columns < 56) {
      return "keys: enter submit | esc clear | ctrl+c exit";
    }
    if (columns < 84) {
      return "keys: enter submit | tab complete | esc clear | ctrl+c exit";
    }
    return "keys: enter submit | ctrl+o newline | tab complete/focus | esc clear | ctrl+c exit";
  }
  if (state.focus === "runs") {
    if (columns < 56) {
      return "keys: Up/Down | V review | p cmd | Esc";
    }
    return "keys: Up/Down select | V review | p command | Esc back | x exit";
  }
  if (state.focus === "review") {
    if (columns < 56) {
      return "keys: a accept | R reject | Esc";
    }
    if (columns < 84) {
      return "keys: Enter diff | a accept | R reject | Esc back";
    }
    return "keys: Up/Down select | Enter/Space diff | a accept | R reject | s compare | Esc back";
  }
  if (state.focus === "graph") {
    if (columns < 56) {
      return "keys: Up/Down | arrows | p cmd | Esc";
    }
    return "keys: Up/Down select | Left collapse | Right expand | h hide done | p command | Esc back";
  }
  if (state.focus === "tasks") {
    if (columns < 56) {
      return "keys: Up/Down | p cmd | Esc";
    }
    return "keys: Up/Down select | p command | Esc back";
  }
  if (state.focus === "memory") {
    if (columns < 56) {
      return "keys: s skills | : cmd | Esc";
    }
    return "keys: s skills | p command | : palette | Esc back";
  }
  if (state.focus === "team") {
    if (columns < 56) {
      return "keys: Team | p cmd | Esc";
    }
    return "keys: Team | p command | : palette | Esc back";
  }
  if (state.focus === "help") {
    if (columns < 56) {
      return "keys: W work | Esc | x";
    }
    return "keys: W work | Tab focus | Esc back | x exit";
  }
  if (columns < 56) {
    return "keys: type | : cmd | ? | x";
  }
  if (columns < 84) {
    return "keys: type prompt | C continue | : commands | ? help | x exit";
  }
  return "keys: type prompt | @ agents | C continue | L timeline | : palette | ? help | x exit";
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
  options: {
    color?: string;
    bold?: boolean;
    dimColor?: boolean;
    inverse?: boolean;
    backgroundColor?: string;
    underline?: boolean;
  } = {}
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

function activeRunLayout(
  activeRuns: TuiActiveRunBox[],
  terminal: TuiInkTerminalSize,
  chromeLineBudget: number
): {
  collapsedBoxes: TuiActiveRunBox[];
  fullBoxes: TuiActiveRunBox[];
} {
  const collapsedBoxes = activeRuns.slice(0, Math.max(0, activeRuns.length - 3));
  const fullBoxes = activeRuns.slice(collapsedBoxes.length);
  const minimumRows = minimumWorkConversationRows(terminal);
  while (
    fullBoxes.length > 1 &&
    terminal.rows - chromeLineBudget - activeRunLineCost(collapsedBoxes, fullBoxes, terminal, chromeLineBudget) < minimumRows
  ) {
    const nextCollapsed = fullBoxes.shift();
    if (nextCollapsed) {
      collapsedBoxes.push(nextCollapsed);
    }
  }
  return { collapsedBoxes, fullBoxes };
}

function conversationWindowSize(
  terminal: TuiInkTerminalSize,
  activeLineCost: number,
  chromeLineBudget: number
): number {
  const availableRows = Math.max(1, terminal.rows - chromeLineBudget - activeLineCost);
  const minimumRows = Math.min(minimumWorkConversationRows(terminal), availableRows);
  const maximumRows = Math.max(minimumRows, terminal.rows - chromeLineBudget);
  return boundedWindowSize(
    availableRows,
    minimumRows,
    maximumRows
  );
}

function workChromeLineBudget(model: TuiCurrentContextModel, state: TuiInkState): number {
  const headerLines = 1;
  const warningLines = model.warnings.length;
  const statusLines = state.statusMessage ? 1 : 0;
  const attentionLines = attentionItemsForModel(model).length > 0 ? 1 : 0;
  const composerLines = composerLineBudget(model, state);
  const tabLines = 1;
  const statusBarLines = 1;
  return headerLines + warningLines + statusLines + attentionLines + composerLines + tabLines + statusBarLines;
}

function composerLineBudget(model: TuiCurrentContextModel, state: TuiInkState): number {
  const previewLines = 1;
  const completionLines = agentCompletionForState(model, state) ? 1 : 0;
  const inputLines = state.composer ? state.composer.split("\n").length : 1;
  return previewLines + completionLines + inputLines;
}

function minimumWorkConversationRows(terminal: TuiInkTerminalSize): number {
  return terminal.rows < 20 ? 4 : 6;
}

function activeRunLineCost(
  collapsedBoxes: TuiActiveRunBox[],
  fullBoxes: TuiActiveRunBox[],
  terminal: TuiInkTerminalSize,
  chromeLineBudget: number
): number {
  return collapsedBoxes.length + fullBoxes.reduce(
    (total, box) => total + activeRunBoxLineCountForBox(box, terminal, chromeLineBudget),
    0
  );
}

function activeRunBoxLineCountForBox(
  box: TuiActiveRunBox,
  terminal: TuiInkTerminalSize,
  chromeLineBudget: number
): number {
  if (usesCompactActiveRunBox(terminal)) {
    return activeRunCompactOutputLines(box, terminal).length + 3;
  }
  return activeRunContentHeight(
    activeRunVisibleOutputLines(box, terminal, chromeLineBudget).length,
    terminal,
    chromeLineBudget
  ) + 3;
}

function usesCompactActiveRunBox(terminal: TuiInkTerminalSize): boolean {
  return terminal.columns < 56 || terminal.rows < 20;
}

function activeRunMinimumContentHeight(_terminal: TuiInkTerminalSize): number {
  return 5;
}

function activeRunMaximumContentHeight(terminal: TuiInkTerminalSize, chromeLineBudget: number): number {
  return Math.max(1, terminal.rows - chromeLineBudget - minimumWorkConversationRows(terminal) - 3);
}

function activeRunContentHeight(
  lineCount: number,
  terminal: TuiInkTerminalSize,
  chromeLineBudget: number
): number {
  const desiredHeight = Math.max(activeRunMinimumContentHeight(terminal), lineCount);
  return Math.min(desiredHeight, activeRunMaximumContentHeight(terminal, chromeLineBudget));
}

function activeRunBoxWidth(terminal: TuiInkTerminalSize): number {
  return Math.max(12, terminal.columns - 4);
}

function activeRunWrappedOutputLines(
  box: TuiActiveRunBox,
  terminal: TuiInkTerminalSize
): string[] {
  const innerWidth = Math.max(12, activeRunBoxWidth(terminal) - 2);
  const contentWidth = Math.max(1, innerWidth - 2);
  return box.outputLines.flatMap((value) => hardWrapLine(value, contentWidth));
}

function activeRunCompactOutputLines(
  box: TuiActiveRunBox,
  terminal: TuiInkTerminalSize
): string[] {
  const width = Math.max(1, activeRunBoxWidth(terminal) - 4);
  const latest = [...box.outputLines]
    .reverse()
    .map((value) => value.trim())
    .find((value) => value.length > 0) ?? "agent thinking...";
  return [truncateText(latest, width)];
}

function activeRunVisibleOutputLines(
  box: TuiActiveRunBox,
  terminal: TuiInkTerminalSize,
  chromeLineBudget: number
): string[] {
  const contentWidth = Math.max(1, activeRunBoxWidth(terminal) - 4);
  const wrappedLines = activeRunWrappedOutputLines(box, terminal);
  const maxContentHeight = activeRunMaximumContentHeight(terminal, chromeLineBudget);
  if (wrappedLines.length <= maxContentHeight) {
    return wrappedLines;
  }
  if (maxContentHeight <= 1) {
    return [truncateText(`... ${wrappedLines.length} older lines hidden`, contentWidth)];
  }
  const visibleTailCount = maxContentHeight - 1;
  const hiddenLineCount = wrappedLines.length - visibleTailCount;
  return [
    truncateText(`... ${hiddenLineCount} older lines hidden`, contentWidth),
    ...wrappedLines.slice(-visibleTailCount)
  ];
}

function hardWrapLine(value: string, width: number): string[] {
  if (width <= 0) {
    return [value];
  }
  if (value.length === 0) {
    return [""];
  }
  const lines: string[] = [];
  let current = "";
  let currentWidth = 0;
  const tokens = value.match(/\s+|\S+/gu) ?? [value];

  for (const token of tokens) {
    if (/^\s+$/u.test(token)) {
      if (current.length === 0) {
        continue;
      }
      const normalizedWhitespace = token.replace(/\s+/g, " ");
      const whitespaceWidth = terminalDisplayWidth(normalizedWhitespace);
      if (currentWidth + whitespaceWidth <= width) {
        current += normalizedWhitespace;
        currentWidth += whitespaceWidth;
      }
      continue;
    }

    const tokenWidth = terminalDisplayWidth(token);
    if (tokenWidth > width) {
      if (current.trimEnd().length > 0) {
        lines.push(current.trimEnd());
        current = "";
        currentWidth = 0;
      }
      const wrappedToken = wrapLongTokenByDisplayWidth(token, width);
      lines.push(...wrappedToken.slice(0, -1));
      current = wrappedToken.at(-1) ?? "";
      currentWidth = terminalDisplayWidth(current);
      continue;
    }

    if (currentWidth + tokenWidth <= width) {
      current += token;
      currentWidth += tokenWidth;
      continue;
    }

    if (current.trimEnd().length > 0) {
      lines.push(current.trimEnd());
    }
    current = token;
    currentWidth = tokenWidth;
  }

  if (current.length > 0) {
    lines.push(current.trimEnd());
  }
  return lines.length > 0 ? lines : [""];
}

function wrapLongTokenByDisplayWidth(value: string, width: number): string[] {
  const lines: string[] = [];
  let current = "";
  let currentWidth = 0;
  for (const cluster of graphemeClusters(value)) {
    const clusterWidth = terminalDisplayWidth(cluster);
    if (currentWidth > 0 && currentWidth + clusterWidth > width) {
      lines.push(current);
      current = "";
      currentWidth = 0;
    }
    current += cluster;
    currentWidth += clusterWidth;
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines.length > 0 ? lines : [""];
}

type GraphemeSegmenter = {
  segment(value: string): Iterable<{ segment: string }>;
};

type GraphemeSegmenterConstructor = new (
  locale: string | string[] | undefined,
  options: { granularity: "grapheme" }
) => GraphemeSegmenter;

function graphemeClusters(value: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: GraphemeSegmenterConstructor }).Segmenter;
  if (Segmenter) {
    return Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(value), (part) => part.segment);
  }
  return Array.from(value);
}

function terminalDisplayWidth(value: string): number {
  let width = 0;
  for (const cluster of graphemeClusters(value)) {
    width += terminalGraphemeWidth(cluster);
  }
  return width;
}

function terminalGraphemeWidth(cluster: string): number {
  if (cluster.length === 0) {
    return 0;
  }
  if (cluster === "\t") {
    return 4;
  }
  if (containsEmoji(cluster)) {
    return 2;
  }
  let width = 0;
  for (const character of Array.from(cluster)) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || isZeroWidthCodePoint(codePoint)) {
      continue;
    }
    width += isFullWidthCodePoint(codePoint) ? 2 : 1;
  }
  return width;
}

function containsEmoji(value: string): boolean {
  return /\p{Emoji_Presentation}|\p{Extended_Pictographic}/u.test(value);
}

function isZeroWidthCodePoint(codePoint: number): boolean {
  return (
    codePoint === 0 ||
    codePoint === 0x200d ||
    (codePoint >= 0x00 && codePoint <= 0x1f) ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    (codePoint >= 0x300 && codePoint <= 0x36f) ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f)
  );
}

function isFullWidthCodePoint(codePoint: number): boolean {
  return (
    codePoint >= 0x1100 &&
    (
      codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd)
    )
  );
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
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds === 0 ? `${minutes}m` : `${minutes}m${remainingSeconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0 ? `${hours}h` : `${hours}h${remainingMinutes}m`;
}

function formatHeaderClock(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatConversationTimestamp(value: string): string {
  const match = /T(\d{2}:\d{2}:\d{2})/.exec(value);
  if (match) {
    return match[1];
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function suggestionForInput(
  input: string,
  model: TuiCurrentContextModel,
  state: TuiInkState
): TuiConversationSuggestion | undefined {
  if (input !== "1" && input !== "2" && input !== "3") {
    return undefined;
  }
  return visibleConversationSuggestions(model, state)
    .find((suggestion) => suggestion.key === input);
}

function openSearchState(state: TuiInkState): TuiInkState {
  return {
    ...state,
    searchOpen: true,
    searchQuery: "",
    searchMatchIndex: 0,
    commandPaletteOpen: false,
    paletteQuery: "",
    paletteSelectedIndex: 0,
    statusMessage: "Search opened."
  };
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
  if (input === "W") {
    return "work";
  }
  if (input === "R") {
    return "runs";
  }
  if (input === "V") {
    return "review";
  }
  if (input === "G") {
    return "graph";
  }
  if (input === "T") {
    return "tasks";
  }
  if (input === "M") {
    return "memory";
  }
  if (input === "E") {
    return "team";
  }
  if (input === "s") {
    return "skills";
  }
  if (input === "h") {
    return "hide_done";
  }
  if (input === "C") {
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

function isImmediateEmptyComposerAction(action: TuiInkKey, focus: TuiInkFocus): boolean {
  if (isDirectFocusAction(action)) {
    return true;
  }
  if (action === "print_commands") {
    return focus !== "work";
  }
  if (action === "hide_done") {
    return focus === "graph";
  }
  if (action === "skills") {
    return focus === "memory";
  }
  return false;
}

function isNavigationAction(action: TuiInkKey): boolean {
  return (
    action === "up" ||
    action === "down" ||
    action === "page_up" ||
    action === "page_down" ||
    action === "home" ||
    action === "end" ||
    action === "left" ||
    action === "right"
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

function isUpInput(input: string, key: Key): boolean {
  return key.upArrow || input === "\u001B[A";
}

function isDownInput(input: string, key: Key): boolean {
  return key.downArrow || input === "\u001B[B";
}

function insertComposerText(state: TuiInkState, value: string): TuiInkState {
  const cursor = boundedComposerCursor(state);
  return {
    ...state,
    composer: `${state.composer.slice(0, cursor)}${value}${state.composer.slice(cursor)}`,
    composerCursorPosition: cursor + value.length,
    composerHistoryIndex: undefined,
    composerHistoryDraft: "",
    agentCompletionIndex: 0
  };
}

function deleteComposerCharacterBeforeCursor(state: TuiInkState): TuiInkState {
  const cursor = boundedComposerCursor(state);
  if (cursor <= 0) {
    return state;
  }
  return {
    ...state,
    composer: `${state.composer.slice(0, cursor - 1)}${state.composer.slice(cursor)}`,
    composerCursorPosition: cursor - 1,
    composerHistoryIndex: undefined,
    composerHistoryDraft: "",
    agentCompletionIndex: 0
  };
}

function deleteComposerCharacterAfterCursor(state: TuiInkState): TuiInkState {
  const cursor = boundedComposerCursor(state);
  if (cursor >= state.composer.length) {
    return state;
  }
  return {
    ...state,
    composer: `${state.composer.slice(0, cursor)}${state.composer.slice(cursor + 1)}`,
    composerCursorPosition: cursor,
    composerHistoryIndex: undefined,
    composerHistoryDraft: "",
    agentCompletionIndex: 0
  };
}

function boundedComposerCursor(state: TuiInkState): number {
  return Math.min(Math.max(state.composerCursorPosition, 0), state.composer.length);
}

function appendComposerHistory(history: string[], prompt: string): string[] {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return history;
  }
  const next = history.at(-1) === trimmed ? history : [...history, trimmed];
  return next.slice(Math.max(0, next.length - 50));
}

function moveComposerHistory(state: TuiInkState, delta: 1 | -1): TuiInkState {
  if (state.composerHistory.length === 0) {
    return {
      ...state,
      statusMessage: "No composer history yet."
    };
  }
  if (delta < 0) {
    const nextIndex = state.composerHistoryIndex === undefined
      ? state.composerHistory.length - 1
      : Math.max(0, state.composerHistoryIndex - 1);
    const draft = state.composerHistoryIndex === undefined
      ? state.composer
      : state.composerHistoryDraft;
    const prompt = state.composerHistory[nextIndex] ?? "";
    return {
      ...state,
      composer: prompt,
      composerCursorPosition: prompt.length,
      composerHistoryIndex: nextIndex,
      composerHistoryDraft: draft,
      agentCompletionIndex: 0,
      statusMessage: `History ${nextIndex + 1}/${state.composerHistory.length}.`
    };
  }
  if (state.composerHistoryIndex === undefined) {
    return state;
  }
  if (state.composerHistoryIndex >= state.composerHistory.length - 1) {
    const prompt = state.composerHistoryDraft;
    return {
      ...state,
      composer: prompt,
      composerCursorPosition: prompt.length,
      composerHistoryIndex: undefined,
      composerHistoryDraft: "",
      agentCompletionIndex: 0,
      statusMessage: "Draft restored."
    };
  }
  const nextIndex = state.composerHistoryIndex + 1;
  const prompt = state.composerHistory[nextIndex] ?? "";
  return {
    ...state,
    composer: prompt,
    composerCursorPosition: prompt.length,
    composerHistoryIndex: nextIndex,
    agentCompletionIndex: 0,
    statusMessage: `History ${nextIndex + 1}/${state.composerHistory.length}.`
  };
}

function agentCompletionForState(
  model: TuiCurrentContextModel,
  state: TuiInkState
): AgentCompletion | undefined {
  const token = activeAgentToken(state);
  if (!token) {
    return undefined;
  }
  const query = token.value.slice(1).toLowerCase();
  const options = agentCompletionOptions(model)
    .filter((option) => {
      const normalized = option.toLowerCase();
      return query.length === 0 || normalized.startsWith(query) || normalized.includes(query);
    })
    .sort((left, right) => {
      if (query.length === 0) {
        return 0;
      }
      const leftStarts = left.toLowerCase().startsWith(query);
      const rightStarts = right.toLowerCase().startsWith(query);
      return Number(rightStarts) - Number(leftStarts);
    });
  if (options.length === 0) {
    return undefined;
  }
  const selectedIndex = Math.min(Math.max(state.agentCompletionIndex, 0), options.length - 1);
  return {
    tokenStart: token.start,
    tokenEnd: token.end,
    query,
    options,
    selectedIndex,
    selectedOption: options[selectedIndex] ?? options[0]
  };
}

function activeAgentToken(state: TuiInkState): { start: number; end: number; value: string } | undefined {
  const cursor = boundedComposerCursor(state);
  const beforeCursor = state.composer.slice(0, cursor);
  const start = Math.max(
    beforeCursor.lastIndexOf(" "),
    beforeCursor.lastIndexOf("\n"),
    beforeCursor.lastIndexOf("\t")
  ) + 1;
  const value = beforeCursor.slice(start);
  if (!value.startsWith("@")) {
    return undefined;
  }
  const afterCursor = state.composer.slice(cursor);
  const nextBoundary = afterCursor.search(/\s/);
  const end = nextBoundary < 0 ? state.composer.length : cursor + nextBoundary;
  return {
    start,
    end,
    value
  };
}

function agentCompletionOptions(model: TuiCurrentContextModel): string[] {
  const options = [
    model.context.selectedAgent,
    "codex",
    "claude-code",
    ...model.team.roles
      .filter((role) => role.enabled)
      .map((role) => role.handle)
  ].filter((value): value is string => Boolean(value));
  return dedupe(options)
    .filter((option) => /^[A-Za-z0-9_-]+$/.test(option));
}

function moveAgentCompletionSelection(
  model: TuiCurrentContextModel,
  state: TuiInkState,
  delta: 1 | -1
): TuiInkState {
  const completion = agentCompletionForState(model, state);
  if (!completion) {
    return state;
  }
  return {
    ...state,
    agentCompletionIndex: (completion.selectedIndex + delta + completion.options.length) % completion.options.length
  };
}

function acceptAgentCompletion(
  model: TuiCurrentContextModel,
  state: TuiInkState
): TuiInkState {
  const completion = agentCompletionForState(model, state);
  if (!completion) {
    return state;
  }
  const nextCharacter = state.composer[completion.tokenEnd];
  const suffix = nextCharacter === undefined || !/\s/.test(nextCharacter) ? " " : "";
  const replacement = `@${completion.selectedOption}${suffix}`;
  const composer = `${state.composer.slice(0, completion.tokenStart)}${replacement}${state.composer.slice(completion.tokenEnd)}`;
  const cursor = completion.tokenStart + replacement.length;
  return {
    ...state,
    composer,
    composerCursorPosition: cursor,
    composerHistoryIndex: undefined,
    composerHistoryDraft: "",
    agentCompletionIndex: 0,
    statusMessage: `Selected @${completion.selectedOption}.`
  };
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    unique.push(value);
  }
  return unique;
}

function compactHeaderParts(parts: HeaderPart[], columns: number): HeaderPart[] {
  const minimumColumns = Math.max(12, columns);
  const visible = [...parts];
  while (visible.length > 1 && headerPartsText(visible).length > minimumColumns) {
    visible.pop();
  }
  if (visible.length === 1 && visible[0]) {
    return [{ ...visible[0], text: truncateText(visible[0].text, minimumColumns) }];
  }
  return visible;
}

function headerPartsText(parts: HeaderPart[]): string {
  return parts.map((part) => part.text).join(" · ");
}

function riskHeaderColor(risk: string): string | undefined {
  if (risk === "high" || risk === "blocking") {
    return "red";
  }
  if (risk === "medium") {
    return "yellow";
  }
  return undefined;
}

function workContentSignature(model: TuiCurrentContextModel): string {
  const lastEntry = model.conversation.at(-1);
  const activeDigest = model.activeRuns
    .map((run) => `${run.runId}:${run.outputLines.at(-1) ?? ""}`)
    .join("|");
  return `${lastEntry?.id ?? ""}:${lastEntry?.timestamp ?? ""}:${activeDigest}`;
}

function modelRenderSignature(model: TuiCurrentContextModel): string {
  return JSON.stringify({
    context: model.context,
    conversation: model.conversation,
    activeRuns: model.activeRuns,
    runs: model.runs,
    roleCalls: model.roleCalls,
    review: model.review,
    tasks: model.tasks,
    team: model.team,
    memory: model.memory,
    skills: model.skills,
    warnings: model.warnings
  });
}
