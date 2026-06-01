import type {
  TuiConversationEntry,
  TuiConversationSuggestion,
  TuiCurrentContextModel,
  TuiRoleCallNodeSummary,
  TuiRunSummary,
  TuiTaskSummary
} from "@agent-hub/core";

const defaultListWindowSize = 8;
const defaultConversationWindowSize = 8;

export type TuiInkFocus =
  | "work"
  | "graph"
  | "team"
  | "runs"
  | "review"
  | "tasks"
  | "memory"
  | "help";

export interface TuiInkState {
  focus: TuiInkFocus;
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
  };
  conversationScrollOffset: number;
  reviewDiffExpanded: boolean;
  reviewCompareMode: boolean;
  searchOpen: boolean;
  searchQuery: string;
  searchMatchIndex: number;
  composer: string;
  composerCursorPosition: number;
  commandPaletteOpen: boolean;
  paletteQuery: string;
  paletteSelectedIndex: number;
  statusMessage?: string;
}

export type TuiInkKey =
  | "tab"
  | "shift_tab"
  | "up"
  | "down"
  | "page_up"
  | "page_down"
  | "home"
  | "end"
  | "left"
  | "right"
  | "enter"
  | "escape"
  | "work"
  | "graph"
  | "runs"
  | "tasks"
  | "help"
  | "team"
  | "review"
  | "memory"
  | "skills"
  | "hide_done"
  | "continue_loop"
  | "toggle_review_diff"
  | "toggle_compare"
  | "cancel"
  | "accept_review"
  | "reject_review"
  | "print_commands"
  | "palette";

export const focusModes: TuiInkFocus[] = [
  "work",
  "runs",
  "review",
  "graph",
  "tasks",
  "memory",
  "team",
  "help"
];

export function createInitialInkState(composer = ""): TuiInkState {
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
      tasks: 0
    },
    conversationScrollOffset: 0,
    reviewDiffExpanded: false,
    reviewCompareMode: false,
    searchOpen: false,
    searchQuery: "",
    searchMatchIndex: 0,
    composer,
    composerCursorPosition: composer.length,
    commandPaletteOpen: false,
    paletteQuery: "",
    paletteSelectedIndex: 0
  };
}

export function reduceInkState(
  state: TuiInkState,
  key: TuiInkKey,
  model: TuiCurrentContextModel
): TuiInkState {
  const next: TuiInkState = {
    ...state,
    collapsedRoleCallIds: [...state.collapsedRoleCallIds],
    statusMessage: undefined
  };

  if (key === "tab" || key === "shift_tab") {
    next.focus = nextFocus(state.focus, key === "tab" ? 1 : -1);
    return next;
  }
  if (key === "help") {
    next.focus = next.focus === "help" ? "work" : "help";
    return next;
  }
  if (key === "work" || key === "graph" || key === "runs" || key === "tasks") {
    next.focus = key;
    next.commandPaletteOpen = false;
    next.searchOpen = false;
    return next;
  }
  if (key === "team") {
    next.focus = "team";
    next.commandPaletteOpen = false;
    next.searchOpen = false;
    next.statusMessage = "Team roles shown.";
    return next;
  }
  if (key === "review") {
    const pendingRun = state.focus === "work"
      ? selectedPendingReviewRun(model, state)
      : undefined;
    if (pendingRun) {
      next.selectedRunId = pendingRun.id;
    }
    next.focus = "review";
    next.reviewCompareMode = false;
    next.commandPaletteOpen = false;
    next.searchOpen = false;
    return next;
  }
  if (key === "memory") {
    next.focus = "memory";
    next.commandPaletteOpen = false;
    next.searchOpen = false;
    return next;
  }
  if (key === "skills") {
    next.focus = "memory";
    next.statusMessage = "Skills are shown with memory and context indicators.";
    return next;
  }
  if (key === "hide_done") {
    next.hideCompletedRoleCalls = !next.hideCompletedRoleCalls;
    next.statusMessage = next.hideCompletedRoleCalls
      ? "Completed RoleCalls hidden."
      : "Completed RoleCalls visible.";
    return next;
  }
  if (key === "continue_loop") {
    applyContinuePrompt(next, model);
    return next;
  }
  if (key === "toggle_review_diff" || (key === "enter" && state.focus === "review")) {
    toggleReviewDiff(next, model);
    return next;
  }
  if (key === "toggle_compare") {
    toggleCompareMode(next, model);
    return next;
  }
  if (key === "cancel") {
    next.statusMessage =
      "Cancellation is unavailable for this CLI TUI context; use the owning run service when supported.";
    return next;
  }
  if (key === "accept_review" || key === "reject_review") {
    next.focus = "review";
    next.statusMessage = "Review decision shortcut is available for the selected run.";
    return next;
  }
  if (key === "print_commands") {
    next.statusMessage = commandHintForFocus(model, next);
    return next;
  }
  if (key === "palette") {
    next.commandPaletteOpen = !next.commandPaletteOpen;
    next.searchOpen = false;
    next.paletteQuery = "";
    next.paletteSelectedIndex = 0;
    return next;
  }
  if (key === "escape") {
    if (next.searchOpen) {
      next.searchOpen = false;
      next.searchQuery = "";
      next.searchMatchIndex = 0;
      next.statusMessage = "Search closed.";
      return next;
    }
    if (next.commandPaletteOpen) {
      next.commandPaletteOpen = false;
      next.paletteQuery = "";
      next.paletteSelectedIndex = 0;
      next.statusMessage = "Command palette closed.";
      return next;
    }
    if (next.focus === "review" && next.reviewDiffExpanded) {
      next.reviewDiffExpanded = false;
      next.statusMessage = "Review diff collapsed.";
      return next;
    }
    next.commandPaletteOpen = false;
    next.focus = "work";
    return next;
  }
  if (key === "enter") {
    return next;
  }
  if (key === "up" || key === "down" || key === "page_up" || key === "page_down" || key === "home" || key === "end") {
    moveSelection(next, key, model);
    return next;
  }
  if (key === "left" || key === "right") {
    toggleSelectedRoleCallCollapse(next, model, key === "left");
    return next;
  }
  return next;
}

export function selectedRun(
  model: TuiCurrentContextModel,
  state: TuiInkState
): TuiRunSummary | undefined {
  return model.runs[selectedRunIndex(model, state)];
}

export function selectedRunIndex(
  model: TuiCurrentContextModel,
  state: TuiInkState
): number {
  return selectedIndexById(
    model.runs,
    state.selectedRunId,
    state.selectedRunIndex
  );
}

export function visibleRoleCalls(
  model: TuiCurrentContextModel,
  state: TuiInkState
): TuiRoleCallNodeSummary[] {
  const base = state.hideCompletedRoleCalls
    ? model.roleCalls.nodes.filter((node) => !node.hidden)
    : model.roleCalls.nodes;
  if (state.collapsedRoleCallIds.length === 0) {
    return base;
  }
  const collapsed = new Set(state.collapsedRoleCallIds);
  const byId = new Map(base.map((node) => [node.id, node]));
  return base.filter((node) => {
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

export function selectedRoleCall(
  model: TuiCurrentContextModel,
  state: TuiInkState
): TuiRoleCallNodeSummary | undefined {
  const nodes = visibleRoleCalls(model, state);
  return nodes[selectedRoleCallIndex(model, state)];
}

export function selectedRoleCallIndex(
  model: TuiCurrentContextModel,
  state: TuiInkState
): number {
  return selectedIndexById(
    visibleRoleCalls(model, state),
    state.selectedRoleCallId,
    state.selectedRoleCallIndex
  );
}

export function selectedTask(
  model: TuiCurrentContextModel,
  state: TuiInkState
): TuiTaskSummary | undefined {
  return model.tasks[selectedTaskIndex(model, state)];
}

export function selectedTaskIndex(
  model: TuiCurrentContextModel,
  state: TuiInkState
): number {
  return selectedIndexById(
    model.tasks,
    state.selectedTaskId,
    state.selectedTaskIndex
  );
}

export function selectedReviewRunId(
  model: TuiCurrentContextModel,
  state: TuiInkState
): string | undefined {
  const pendingReviewRun = state.focus === "work"
    ? selectedPendingReviewRun(model, state)
    : undefined;
  if (pendingReviewRun) {
    return pendingReviewRun.id;
  }
  if (model.review.kind === "run") {
    return model.review.selectedId;
  }
  return model.review.evidence.linkedRunId ?? selectedRun(model, state)?.id;
}

export function selectedPendingReviewRun(
  model: TuiCurrentContextModel,
  state: TuiInkState
): TuiRunSummary | undefined {
  const pending = model.runs
    .filter((run) =>
      (run.status === "succeeded" || run.status === "failed" || run.status === "cancelled") &&
      run.reviewDecision.status === "pending"
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  if (pending.length === 0) {
    return undefined;
  }
  return pending[Math.min(Math.max(state.selectedActiveRunIndex, 0), pending.length - 1)];
}

export function visibleConversationSuggestions(
  model: TuiCurrentContextModel,
  state: TuiInkState
): TuiConversationSuggestion[] {
  if (
    state.focus !== "work" ||
    state.composer.length > 0 ||
    state.conversationScrollOffset !== 0
  ) {
    return [];
  }
  const entry = findLast(
    model.conversation,
    (item) => (item.suggestions?.length ?? 0) > 0
  );
  return entry?.suggestions ?? [];
}

export function commandHintForFocus(
  model: TuiCurrentContextModel,
  state: TuiInkState
): string {
  if (state.focus === "memory") {
    return model.memory.command ?? "Register a project before listing memory.";
  }
  if (state.focus === "team") {
    return model.team.command ?? "Register a project before listing team roles.";
  }
  if (state.focus === "runs") {
    return selectedRun(model, state)?.commands[0] ?? "No run command is available.";
  }
  if (state.focus === "review") {
    return model.review.commands[0] ?? "No review command is available.";
  }
  if (state.focus === "tasks") {
    const task = selectedTask(model, state);
    const command = task
      ? unavailableRoleExecutorCommands(model.context.projectId, task)[0]
      : undefined;
    return command ?? "No task recovery command is available.";
  }
  const node = selectedRoleCall(model, state);
  return node ? `agent-hub role-calls show ${node.id}` : roleListCommand(model) ?? "No RoleCall command is available.";
}

export function roleListCommand(model: TuiCurrentContextModel): string | undefined {
  return model.team.command ?? (model.context.projectId
    ? `agent-hub team roles list --project-id ${model.context.projectId}`
    : undefined);
}

export function unavailableRoleExecutorCommands(
  projectId: string | undefined,
  task: TuiTaskSummary
): string[] {
  if (!projectId) {
    return [];
  }
  return task.assignments
    .filter((assignment) => !assignment.executable && assignment.role)
    .map((assignment) => `agent-hub team roles executor --project-id ${projectId} --role ${assignment.role}`);
}

function moveSelection(
  state: TuiInkState,
  key: "up" | "down" | "page_up" | "page_down" | "home" | "end",
  model: TuiCurrentContextModel
): void {
  const delta = selectionDelta(key);
  if (state.focus === "runs") {
    const nextIndex = nextSelectionIndex(selectedRunIndex(model, state), delta, model.runs.length);
    state.selectedRunIndex = nextIndex;
    state.selectedRunId = model.runs[nextIndex]?.id;
    state.scrollOffsets.runs = ensureVisible(
      state.scrollOffsets.runs,
      nextIndex,
      defaultListWindowSize,
      model.runs.length
    );
    return;
  }
  if (state.focus === "tasks") {
    const nextIndex = nextSelectionIndex(selectedTaskIndex(model, state), delta, model.tasks.length);
    state.selectedTaskIndex = nextIndex;
    state.selectedTaskId = model.tasks[nextIndex]?.id;
    state.scrollOffsets.tasks = ensureVisible(
      state.scrollOffsets.tasks,
      nextIndex,
      defaultListWindowSize,
      model.tasks.length
    );
    return;
  }
  if (state.focus === "work") {
    moveConversationScroll(state, key, conversationLineCount(model.conversation));
    return;
  }
  if (state.focus === "team" || state.focus === "memory" || state.focus === "help") {
    return;
  }
  const nodes = visibleRoleCalls(model, state);
  const nextIndex = nextSelectionIndex(selectedRoleCallIndex(model, state), delta, nodes.length);
  state.selectedRoleCallIndex = clampIndex(
    nextIndex,
    nodes.length
  );
  state.selectedRoleCallId = nodes[state.selectedRoleCallIndex]?.id;
  state.scrollOffsets.roleCalls = ensureVisible(
    state.scrollOffsets.roleCalls,
    state.selectedRoleCallIndex,
    defaultListWindowSize,
    nodes.length
  );
}

function moveConversationScroll(
  state: TuiInkState,
  key: "up" | "down" | "page_up" | "page_down" | "home" | "end",
  conversationLineLength: number
): void {
  const maxOffset = Math.max(0, conversationLineLength - defaultConversationWindowSize);
  if (key === "home") {
    state.conversationScrollOffset = maxOffset;
    return;
  }
  if (key === "end") {
    state.conversationScrollOffset = 0;
    return;
  }
  const delta = transcriptScrollDelta(key);
  state.conversationScrollOffset = Math.min(
    Math.max(state.conversationScrollOffset + delta, 0),
    maxOffset
  );
}

function conversationLineCount(entries: TuiConversationEntry[]): number {
  return entries.reduce((count, entry) => count + conversationEntryLineCount(entry), 0);
}

function conversationEntryLineCount(entry: TuiConversationEntry): number {
  if (entry.type === "delegation") {
    return 1;
  }
  const contentLines = Array.isArray(entry.outputLines)
    ? entry.outputLines.length
    : textLineCount(entry.content);
  if (
    entry.type === "agent_completed" ||
    entry.type === "agent_failed" ||
    entry.type === "review_pending"
  ) {
    return 1 +
      Math.max(1, contentLines) +
      (entry.verificationLine ? 1 : 0) +
      (entry.riskLine ? 1 : 0) +
      (entry.type === "review_pending" ? 1 : 0) +
      (entry.suggestions?.length ?? 0);
  }
  return 1 + Math.max(1, contentLines);
}

function textLineCount(content: string | undefined): number {
  return (content ?? "")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .length;
}

function toggleSelectedRoleCallCollapse(
  state: TuiInkState,
  model: TuiCurrentContextModel,
  collapse: boolean
): void {
  const selected = selectedRoleCall(model, state);
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

function applyContinuePrompt(
  state: TuiInkState,
  model: TuiCurrentContextModel
): void {
  const stopReason = model.roleCalls.loop.stopReason;
  if (stopReason !== "terminal" && stopReason !== "none") {
    state.statusMessage = `Cannot continue: ${stopReason}.`;
    return;
  }
  const selected = selectedRoleCall(model, state);
  state.composer = selected
    ? `Continue @${selected.calleeRole} on RoleCall ${selected.id}: ${selected.task}`
    : "Continue the current task with the selected agent.";
  state.composerCursorPosition = state.composer.length;
  state.statusMessage = "Continuation prompt prepared; press ctrl+j to submit.";
}

function toggleReviewDiff(
  state: TuiInkState,
  model: TuiCurrentContextModel
): void {
  if (state.focus !== "review") {
    return;
  }
  if (!model.review.evidence.inlineDiff) {
    state.statusMessage = "No review diff is available for the selected run.";
    return;
  }
  state.reviewDiffExpanded = !state.reviewDiffExpanded;
  state.statusMessage = state.reviewDiffExpanded
    ? "Review diff expanded."
    : "Review diff collapsed.";
}

function toggleCompareMode(
  state: TuiInkState,
  model: TuiCurrentContextModel
): void {
  if (state.focus !== "review") {
    return;
  }
  const run = selectedRun(model, state);
  const comparableRuns = run
    ? model.runs.filter((candidate) => candidate.taskId === run.taskId)
    : [];
  if (comparableRuns.length < 2) {
    state.statusMessage = "Split compare requires at least two runs for the selected task.";
    return;
  }
  state.reviewCompareMode = !state.reviewCompareMode;
  state.statusMessage = state.reviewCompareMode
    ? "Split compare shown read-only."
    : "Split compare hidden.";
}

function nextFocus(current: TuiInkFocus, delta: number): TuiInkFocus {
  const index = focusModes.indexOf(current);
  const next = (index + delta + focusModes.length) % focusModes.length;
  return focusModes[next];
}

function selectedIndexById<T extends { id: string }>(
  items: T[],
  selectedId: string | undefined,
  fallbackIndex: number
): number {
  if (items.length <= 0) {
    return 0;
  }
  if (selectedId) {
    const idIndex = items.findIndex((item) => item.id === selectedId);
    if (idIndex >= 0) {
      return idIndex;
    }
  }
  return boundedIndex(fallbackIndex, items.length);
}

function findLast<T>(values: T[], predicate: (value: T) => boolean): T | undefined {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index])) {
      return values[index];
    }
  }
  return undefined;
}

function selectionDelta(
  key: "up" | "down" | "page_up" | "page_down" | "home" | "end"
): number {
  if (key === "page_up") {
    return -8;
  }
  if (key === "page_down") {
    return 8;
  }
  if (key === "home") {
    return Number.NEGATIVE_INFINITY;
  }
  if (key === "end") {
    return Number.POSITIVE_INFINITY;
  }
  return key === "down" ? 1 : -1;
}

function transcriptScrollDelta(
  key: "up" | "down" | "page_up" | "page_down" | "home" | "end"
): number {
  if (key === "page_up") {
    return defaultConversationWindowSize;
  }
  if (key === "page_down") {
    return -defaultConversationWindowSize;
  }
  if (key === "up") {
    return 1;
  }
  if (key === "down") {
    return -1;
  }
  return 0;
}

function nextSelectionIndex(current: number, delta: number, length: number): number {
  if (delta === Number.NEGATIVE_INFINITY) {
    return 0;
  }
  if (delta === Number.POSITIVE_INFINITY) {
    return Math.max(0, length - 1);
  }
  return clampIndex(current + delta, length);
}

function ensureVisible(
  offset: number,
  index: number,
  windowSize: number,
  length: number
): number {
  if (length <= windowSize) {
    return 0;
  }
  if (index < offset) {
    return index;
  }
  if (index >= offset + windowSize) {
    return Math.min(index - windowSize + 1, Math.max(0, length - windowSize));
  }
  return Math.min(offset, Math.max(0, length - windowSize));
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
