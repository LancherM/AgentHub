import type {
  TuiCurrentContextModel,
  TuiRoleCallNodeSummary,
  TuiRunSummary,
  TuiTaskSummary
} from "@agent-hub/core";

export type TuiInkFocus =
  | "work"
  | "graph"
  | "runs"
  | "review"
  | "tasks"
  | "memory"
  | "help";

export interface TuiInkState {
  focus: TuiInkFocus;
  selectedRunIndex: number;
  selectedRoleCallIndex: number;
  selectedTaskIndex: number;
  hideCompletedRoleCalls: boolean;
  collapsedRoleCallIds: string[];
  composer: string;
  commandPaletteOpen: boolean;
  statusMessage?: string;
}

export type TuiInkKey =
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
  | "accept_review"
  | "reject_review"
  | "print_commands"
  | "palette";

export const focusModes: TuiInkFocus[] = [
  "work",
  "graph",
  "runs",
  "review",
  "tasks",
  "memory",
  "help"
];

export function createInitialInkState(composer = ""): TuiInkState {
  return {
    focus: "work",
    selectedRunIndex: 0,
    selectedRoleCallIndex: 0,
    selectedTaskIndex: 0,
    hideCompletedRoleCalls: false,
    collapsedRoleCallIds: [],
    composer,
    commandPaletteOpen: false
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
  if (key === "review") {
    next.focus = "review";
    return next;
  }
  if (key === "memory") {
    next.focus = "memory";
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
    return next;
  }
  if (key === "escape") {
    next.commandPaletteOpen = false;
    next.focus = "work";
    return next;
  }
  if (key === "enter") {
    next.focus = "review";
    return next;
  }
  if (key === "up" || key === "down") {
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
  return model.runs[boundedIndex(state.selectedRunIndex, model.runs.length)];
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
  return nodes[boundedIndex(state.selectedRoleCallIndex, nodes.length)];
}

export function selectedTask(
  model: TuiCurrentContextModel,
  state: TuiInkState
): TuiTaskSummary | undefined {
  return model.tasks[boundedIndex(state.selectedTaskIndex, model.tasks.length)];
}

export function selectedReviewRunId(
  model: TuiCurrentContextModel,
  state: TuiInkState
): string | undefined {
  if (model.review.kind === "run") {
    return model.review.selectedId;
  }
  return model.review.evidence.linkedRunId ?? selectedRun(model, state)?.id;
}

export function commandHintForFocus(
  model: TuiCurrentContextModel,
  state: TuiInkState
): string {
  if (state.focus === "memory") {
    return model.memory.command ?? "Register a project before listing memory.";
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
  return node ? `agent-hub role-calls show ${node.id}` : "No RoleCall command is available.";
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
    visibleRoleCalls(model, state).length
  );
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
  state.statusMessage = "Continuation prompt prepared; press ctrl+j to submit.";
}

function nextFocus(current: TuiInkFocus, delta: number): TuiInkFocus {
  const index = focusModes.indexOf(current);
  const next = (index + delta + focusModes.length) % focusModes.length;
  return focusModes[next];
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
