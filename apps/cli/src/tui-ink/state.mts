import type {
  TuiConversationEntry,
  TuiConversationSuggestion,
  TuiCurrentContextModel,
  TuiDetailSection,
  TuiRoleCallNodeSummary,
  TuiRunSummary,
  TuiSelectionDetail,
  TuiTaskSummary,
  TuiWorkBlock
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
  selectedWorkBlockIndex: number;
  selectedWorkBlockId?: string;
  selectedMemoryItemIndex: number;
  selectedMemoryItemId?: string;
  selectedTeamRoleIndex: number;
  selectedTeamRoleId?: string;
  selectedActiveRunIndex: number;
  hideCompletedRoleCalls: boolean;
  collapsedRoleCallIds: string[];
  collapsedDetailSectionIds: string[];
  expandedDetailSectionIds: string[];
  foldPrefixPending: boolean;
  detailVisible: boolean;
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
  | "toggle_notify"
  | "toggle_timeline"
  | "cancel"
  | "accept_review"
  | "reject_review"
  | "open_detail"
  | "close_detail"
  | "fold_prefix"
  | "cancel_fold_prefix"
  | "toggle_detail_sections"
  | "collapse_detail_sections"
  | "expand_detail_sections"
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
    selectedWorkBlockIndex: 0,
    selectedMemoryItemIndex: 0,
    selectedTeamRoleIndex: 0,
    selectedActiveRunIndex: 0,
    hideCompletedRoleCalls: false,
    collapsedRoleCallIds: [],
    collapsedDetailSectionIds: [],
    expandedDetailSectionIds: [],
    foldPrefixPending: false,
    detailVisible: false,
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

export function reduceInkState(
  state: TuiInkState,
  key: TuiInkKey,
  model: TuiCurrentContextModel
): TuiInkState {
  const next: TuiInkState = {
    ...state,
    selectedWorkBlockIndex: state.selectedWorkBlockIndex ?? 0,
    selectedMemoryItemIndex: state.selectedMemoryItemIndex ?? 0,
    selectedTeamRoleIndex: state.selectedTeamRoleIndex ?? 0,
    detailVisible: state.detailVisible ?? false,
    collapsedRoleCallIds: [...(state.collapsedRoleCallIds ?? [])],
    collapsedDetailSectionIds: [...(state.collapsedDetailSectionIds ?? [])],
    expandedDetailSectionIds: [...(state.expandedDetailSectionIds ?? [])],
    foldPrefixPending: false,
    composerHistory: [...(state.composerHistory ?? [])],
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
    next.timelineOpen = false;
    return next;
  }
  if (key === "team") {
    next.focus = "team";
    next.commandPaletteOpen = false;
    next.searchOpen = false;
    next.timelineOpen = false;
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
    next.timelineOpen = false;
    return next;
  }
  if (key === "memory") {
    next.focus = "memory";
    next.commandPaletteOpen = false;
    next.searchOpen = false;
    next.timelineOpen = false;
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
  if (key === "toggle_notify") {
    next.notifyEnabled = !next.notifyEnabled;
    next.statusMessage = next.notifyEnabled
      ? "Completion notifications enabled."
      : "Completion notifications disabled.";
    return next;
  }
  if (key === "toggle_timeline") {
    next.timelineOpen = !next.timelineOpen;
    next.commandPaletteOpen = false;
    next.searchOpen = false;
    next.statusMessage = next.timelineOpen ? "Timeline shown." : "Timeline hidden.";
    return next;
  }
  if (key === "cancel") {
    next.statusMessage =
      "Cancellation is unavailable for this CLI TUI context; use the owning run service when supported.";
    return next;
  }
  if (key === "open_detail" || key === "enter") {
    next.detailVisible = true;
    next.statusMessage = "Detail opened.";
    return next;
  }
  if (key === "close_detail") {
    next.detailVisible = false;
    next.statusMessage = "Detail closed.";
    return next;
  }
  if (key === "fold_prefix") {
    next.foldPrefixPending = true;
    next.statusMessage = "Fold prefix: press a to toggle detail sections.";
    return next;
  }
  if (key === "cancel_fold_prefix") {
    next.statusMessage = "Fold prefix cancelled.";
    return next;
  }
  if (key === "toggle_detail_sections" || key === "collapse_detail_sections" || key === "expand_detail_sections") {
    updateDetailSectionFolds(next, model, key);
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
    if (next.timelineOpen) {
      next.timelineOpen = false;
      next.statusMessage = "Timeline hidden.";
      return next;
    }
    if (next.detailVisible) {
      next.detailVisible = false;
      next.statusMessage = "Detail closed.";
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

export function selectedTeamRoleIndex(
  model: TuiCurrentContextModel,
  state: TuiInkState
): number {
  return selectedIndexById(
    model.team.roles,
    state.selectedTeamRoleId,
    state.selectedTeamRoleIndex
  );
}

export function selectedMemoryItemIndex(
  model: TuiCurrentContextModel,
  state: TuiInkState
): number {
  return selectedIndexById(
    model.memory.rows,
    state.selectedMemoryItemId,
    state.selectedMemoryItemIndex
  );
}

export function selectedWorkBlockIndex(
  model: TuiCurrentContextModel,
  state: TuiInkState
): number {
  return selectedIndexById(
    workBlocksForSelection(model),
    state.selectedWorkBlockId,
    state.selectedWorkBlockIndex
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
    if (key === "page_up" || key === "page_down" || key === "home" || key === "end") {
      moveConversationScroll(state, key, conversationLineCount(model.conversation));
      return;
    }
    const blocks = workBlocksForSelection(model);
    const nextIndex = nextSelectionIndex(
      selectedWorkBlockIndex(model, state),
      delta,
      blocks.length
    );
    state.selectedWorkBlockIndex = nextIndex;
    state.selectedWorkBlockId = blocks[nextIndex]?.id;
    return;
  }
  if (state.focus === "team") {
    const nextIndex = nextSelectionIndex(
      selectedTeamRoleIndex(model, state),
      delta,
      model.team.roles.length
    );
    state.selectedTeamRoleIndex = nextIndex;
    state.selectedTeamRoleId = model.team.roles[nextIndex]?.id;
    return;
  }
  if (state.focus === "memory") {
    const nextIndex = nextSelectionIndex(
      selectedMemoryItemIndex(model, state),
      delta,
      model.memory.rows.length
    );
    state.selectedMemoryItemIndex = nextIndex;
    state.selectedMemoryItemId = model.memory.rows[nextIndex]?.id;
    return;
  }
  if (state.focus === "help") {
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
  let count = 0;
  let previousEntry: TuiConversationEntry | undefined;
  for (const entry of entries) {
    if (previousEntry) {
      count += 1;
      if (conversationGapLabel(previousEntry.timestamp, entry.timestamp)) {
        count += 1;
      }
    }
    count += conversationEntryLineCount(entry);
    previousEntry = entry;
  }
  return count;
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
      (entry.inlineDiff ? inlineDiffLineCount(entry.inlineDiff.mode, entry.inlineDiff.lines.length) : 0) +
      (entry.type === "review_pending" ? 1 : 0) +
      (entry.suggestions?.length ?? 0);
  }
  return 1 + Math.max(1, contentLines);
}

function conversationGapLabel(previousTimestamp: string, timestamp: string): boolean {
  const previous = Date.parse(previousTimestamp);
  const current = Date.parse(timestamp);
  return Number.isFinite(previous) &&
    Number.isFinite(current) &&
    current - previous >= 5 * 60 * 1000;
}

function inlineDiffLineCount(mode: "inline" | "summary", lineCount: number): number {
  return mode === "summary" ? 2 : lineCount + 2;
}

function textLineCount(content: string | undefined): number {
  return (content ?? "")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .length;
}

function workBlocksForSelection(model: TuiCurrentContextModel): TuiWorkBlock[] {
  return model.workBlocks ?? [
    ...model.conversation.map((entry) => ({
      id: entry.id
    } as TuiWorkBlock)),
    ...model.activeRuns.map((run) => ({
      id: `active-run:${run.runId}`
    } as TuiWorkBlock))
  ];
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

function updateDetailSectionFolds(
  state: TuiInkState,
  model: TuiCurrentContextModel,
  key: "toggle_detail_sections" | "collapse_detail_sections" | "expand_detail_sections"
): void {
  const sections = selectedDetailSections(model, state);
  if (sections.length === 0) {
    state.statusMessage = "No detail sections are available to fold.";
    return;
  }
  if (key === "collapse_detail_sections") {
    state.collapsedDetailSectionIds = sections.map((section) => section.id);
    state.expandedDetailSectionIds = state.expandedDetailSectionIds.filter(
      (id) => !sections.some((section) => section.id === id)
    );
    state.statusMessage = "Detail sections collapsed.";
    return;
  }
  if (key === "expand_detail_sections") {
    const ids = new Set([...state.expandedDetailSectionIds, ...sections.map((section) => section.id)]);
    state.expandedDetailSectionIds = [...ids];
    state.collapsedDetailSectionIds = state.collapsedDetailSectionIds.filter(
      (id) => !sections.some((section) => section.id === id)
    );
    state.statusMessage = "Detail sections expanded.";
    return;
  }
  const anyCollapsed = sections.some((section) => detailSectionCollapsed(section, state));
  updateDetailSectionFolds(
    state,
    model,
    anyCollapsed ? "expand_detail_sections" : "collapse_detail_sections"
  );
}

function selectedDetailSections(
  model: TuiCurrentContextModel,
  state: TuiInkState
): TuiDetailSection[] {
  return selectedDetail(model, state)?.sections ?? [];
}

function selectedDetail(
  model: TuiCurrentContextModel,
  state: TuiInkState
): TuiSelectionDetail | undefined {
  const details = model.selectionDetails;
  if (state.focus === "runs") {
    const run = selectedRun(model, state);
    return run ? details.runs.find((detail) => detail.id === run.id) : undefined;
  }
  if (state.focus === "review") {
    if (model.review.kind === "run" && model.review.selectedId) {
      return details.runs.find((detail) => detail.id === model.review.selectedId);
    }
    if (model.review.kind === "role_call" && model.review.selectedId) {
      return details.roleCalls.find((detail) => detail.id === model.review.selectedId);
    }
    return undefined;
  }
  if (state.focus === "graph") {
    const call = selectedRoleCall(model, state);
    return call ? details.roleCalls.find((detail) => detail.id === call.id) : undefined;
  }
  if (state.focus === "tasks") {
    const task = selectedTask(model, state);
    return task ? details.tasks.find((detail) => detail.id === task.id) : undefined;
  }
  if (state.focus === "team") {
    const role = model.team.roles[selectedTeamRoleIndex(model, state)];
    return role ? details.teamRoles.find((detail) => detail.id === role.id) : undefined;
  }
  if (state.focus === "memory") {
    const rowDetails = details.memoryRows;
    if (rowDetails.length === 0) {
      return details.memory;
    }
    return rowDetails[selectedIndexById(rowDetails, state.selectedMemoryItemId, state.selectedMemoryItemIndex)] ?? rowDetails[0];
  }
  if (state.focus === "work") {
    const workDetails = details.workBlocks;
    return workDetails[selectedIndexById(workDetails, state.selectedWorkBlockId, state.selectedWorkBlockIndex)] ?? workDetails.at(-1);
  }
  return undefined;
}

function detailSectionCollapsed(section: TuiDetailSection, state: TuiInkState): boolean {
  if (state.collapsedDetailSectionIds.includes(section.id)) {
    return true;
  }
  return section.collapsedByDefault === true &&
    !state.expandedDetailSectionIds.includes(section.id);
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
  const safeCurrent = Number.isFinite(current) ? current : 0;
  if (delta === Number.NEGATIVE_INFINITY) {
    return 0;
  }
  if (delta === Number.POSITIVE_INFINITY) {
    return Math.max(0, length - 1);
  }
  return clampIndex(safeCurrent + delta, length);
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
  const safeIndex = Number.isFinite(index) ? index : 0;
  return Math.min(Math.max(safeIndex, 0), length - 1);
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return Math.min(Math.max(index, 0), length - 1);
}
