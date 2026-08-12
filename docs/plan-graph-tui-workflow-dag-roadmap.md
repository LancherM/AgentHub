# PlanGraph TUI Workflow DAG Roadmap

Status: planning follow-up for the current Workflow DAG TUI
Last updated: 2026-06-16

This roadmap focuses only on the terminal UI gap between the current
`Graph - Workflow DAG` implementation and the original graph mock. It assumes
the PlanGraph and ExecutionTraceGraph data layer is already available through
`TuiCurrentContextModel.executionTrace` and that the Ink renderer must continue
to consume that read model without querying SQLite, running agents, shelling
out, or duplicating TaskRunner orchestration.

The current TUI already has a useful Workflow DAG surface:

- Graph focus label: `Graph - Workflow DAG`.
- Overlay, Plan, and Trace modes.
- Bounded node rows and visible edge labels.
- Selected row highlighting.
- Toolbar state for mode, labels, fold, and zoom.
- Text mini-map and legend.
- Compact fallback for narrow terminals.
- Selected graph-node details with incoming, outgoing, evidence, deviations,
  and inspection commands.
- Legacy RoleCall compatibility view when no PlanGraph-backed trace exists.

The remaining work is reference fidelity and interaction completeness. The
target is a terminal-native DAG workbench that feels close to the mock without
turning the TUI into a renderer-side workflow engine.

## Target Shape

The target Graph screen should communicate these pieces in one terminal-safe
layout:

```text
Graph - Workflow DAG
[zoom:82%] [layout:dag] [focus:run_91ab] [labels:auto] [fold:inline:false]

user_req --> pm_plan --> research --> implement --> verify --> review
                                      |
                                      +-- Implement Subgraph [-]
                                          codex_run     claude_run
                                                \       /
                                             compare_results
                                                   |
                                               best_result

Mini Map                                      Graph Legend
Selected Node                                Actions
```

The implementation should stay pragmatic: draw a bounded terminal DAG, not a
pixel-perfect canvas. When the terminal is too narrow or the graph is too
large, use a compact list fallback that still preserves graph meaning.

## Current Remaining TUI Diffs

1. **Spatial DAG fidelity**

   The current renderer is a row-oriented graph workbench. It shows node boxes
   and edge rows, but it does not lay out nodes into visible ranks with
   horizontal/vertical connectors like the mock.

2. **Viewport controls**

   Current zoom is a coarse `fit/detail` state. There is no percentage zoom,
   pan, viewport origin, or `/graph focus <node>` command that moves the
   viewport and selected node together.

3. **Subgraph containers**

   Current grouped mode inserts group rows such as RoleCall or comparison
   branches. It does not draw dashed subgraph boxes, fold handles, or nested
   branch boundaries.

4. **Action semantics**

   Selected graph-node details expose inspection commands, but the mock has a
   richer action model: open details, node actions, fold subgraph, pin node,
   and rerun from here. These must remain explicit and safe; no action should
   auto-apply, push, merge, approve memory, or run agents without clear user
   intent.

5. **Mini-map fidelity**

   Current mini-map is a text summary. The mock expects a small structural
   overview with a viewport marker. The terminal version should be symbolic but
   should still show graph shape and selected viewport.

6. **Graph fixtures and visual QA**

   Current tests cover snippets and manual verification covers a narrow PTY.
   The next pass needs deterministic fixture screens that mirror the mock:
   plan-only, RoleCall-expanded, parallel comparison, failed/deviated, narrow,
   and wide layouts.

## Non-Goals

- Do not add a web canvas, browser-only UI, or server-rendered graph.
- Do not make the Ink renderer access SQLite, filesystem, git, shell, or
  TaskRunner directly.
- Do not make graph actions bypass existing CLI/TaskRunner/review gates.
- Do not auto-run compare, rerun, apply, merge, push, PR creation, or memory
  approval from the graph.
- Do not remove compact fallback behavior for narrow terminals.
- Do not replace ExecutionTraceGraph with renderer-specific graph state.

## Phase TDAG-0: Current-State Cleanup

Goal: align roadmap and product docs with the current implementation before
adding more TUI behavior.

Scope:

- Mark previously listed TUI graph gaps that are now implemented as complete.
- Link this TUI-specific roadmap from product and architecture docs.
- Keep this phase documentation-only.

Implementation areas:

- `docs/plan-graph-execution-trace-followup-roadmap.md`
- `docs/product.md`
- `docs/architecture.md`

Tests:

- `git diff --check`

Exit criteria:

- Follow-up docs no longer imply the current graph is still RoleCall-only or
  list-only.
- Future TUI work points to this roadmap instead of the broader PlanGraph
  lifecycle roadmap.

Implementation prompt:

```text
You are working in /Users/lan/agent-hub.

Implement Phase TDAG-0 of docs/plan-graph-tui-workflow-dag-roadmap.md.
Update documentation only so the current Workflow DAG implementation and remaining TUI-specific gaps are accurately separated.

Constraints:
- Do not change runtime code.
- Do not edit ignored local implementation prompt files.
- Keep product and architecture docs concise; link to this roadmap for detail.

Deliverables:
- docs/product.md and docs/architecture.md link to this TUI roadmap.
- The broader PlanGraph follow-up roadmap no longer misstates TUI graph status.

Verification:
- Run git diff --check.
```

## Phase TDAG-1: Renderer Graph Model

Goal: give the Ink renderer a stable terminal layout model without changing
core ExecutionTraceGraph semantics.

Scope:

- Add a renderer-local graph layout model that derives:
  - node rank and lane;
  - bounded display width;
  - incoming/outgoing connector anchors;
  - optional subgraph group id;
  - selected/focused state;
  - viewport inclusion;
  - action descriptors.
- Keep the source of truth as `ExecutionTraceGraph`.
- Keep layout deterministic for snapshot tests.

Implementation areas:

- `apps/cli/src/tui-ink/graph-layout.mts`
- `apps/cli/src/tui-ink/App.mts`
- `tests/cli-tui-ink.test.mts`

Tests:

- deterministic rank assignment for primary chain;
- parallel branch lane assignment;
- comparison branch grouping;
- compact fallback still works below the width threshold;
- selected node remains stable when mode changes.

Exit criteria:

- Renderer code has a clear layout intermediate form before converting to
  strings.
- Tests can assert graph shape without depending on the full shell snapshot.

Implementation prompt:

```text
You are working in /Users/lan/agent-hub.

Implement Phase TDAG-1 of docs/plan-graph-tui-workflow-dag-roadmap.md.
Create a deterministic renderer-local graph layout model for the TUI Workflow DAG.

Constraints:
- Do not change ExecutionTraceGraph DTOs unless the read model is missing essential display data.
- Do not query SQLite or TaskRunner from the renderer.
- Keep layout deterministic and bounded.
- Preserve current compact fallback behavior.

Deliverables:
- graph-layout.mts exposes a stable intermediate layout shape.
- Existing Workflow DAG rendering still passes.
- New tests cover rank, lane, grouping, and selection stability.

Verification:
- Run focused cli-tui-ink tests.
- Run typecheck, lint, and git diff --check.
```

## Phase TDAG-2: Spatial DAG Rows

Goal: move from row-oriented node listings to a terminal-native spatial DAG.

Scope:

- Render top-level PlanGraph nodes in horizontal ranks when width allows.
- Render connector rows between ranks with edge glyphs and compact edge labels.
- Support dynamic trace branches under or beside the source plan node.
- Keep text wrapping bounded so node boxes never resize the shell.
- Preserve a readable list fallback for narrow terminals.

Implementation areas:

- `apps/cli/src/tui-ink/graph-layout.mts`
- `apps/cli/src/tui-ink/App.mts`
- `tests/cli-tui-ink.test.mts`

Tests:

- wide terminal shows horizontal plan chain;
- dynamic TaskRun and comparison branches appear near source plan node;
- edge labels are visible at wide widths and clipped predictably when needed;
- narrow terminal falls back to compact rows;
- no row exceeds terminal width in tested sizes.

Exit criteria:

- At `154x42` or similar width, the Graph pane reads as a DAG rather than a
  vertical list.
- Node boxes, connectors, and labels remain stable across repeated renders.

Implementation prompt:

```text
You are working in /Users/lan/agent-hub.

Implement Phase TDAG-2 of docs/plan-graph-tui-workflow-dag-roadmap.md.
Upgrade the TUI Workflow DAG renderer to draw spatial terminal DAG rows at wide widths.

Constraints:
- Keep all rendering terminal-safe ASCII.
- Keep compact fallback below the configured width threshold.
- Do not add a canvas, browser dependency, or renderer-side data fetching.
- Do not let node labels or edge labels overflow terminal width.

Deliverables:
- Wide graph renders horizontal ranks and connector rows.
- Dynamic trace branches are visually tied to their source plan nodes.
- Tests cover wide, medium, and narrow terminal widths.

Verification:
- Run focused cli-tui-ink tests.
- Run typecheck, lint, and git diff --check.
```

## Phase TDAG-3: Viewport, Focus, And Toolbar

Goal: make the toolbar controls in the mock real TUI state.

Scope:

- Replace coarse zoom copy with a bounded percentage-like zoom state, while
  mapping it internally to terminal-safe density levels.
- Add `/graph focus <node-id>` command handling or palette action that selects
  the node and moves the viewport around it.
- Add viewport origin state for wide graphs that cannot fit in the main panel.
- Add label policy states: `auto`, `compact`, `full`, and `off`.
- Show toolbar fields:
  - `zoom`;
  - `layout`;
  - `focus`;
  - `labels`;
  - `fold`.

Implementation areas:

- `apps/cli/src/tui-ink/state.mts`
- `apps/cli/src/tui-ink/App.mts`
- `apps/cli/src/tui-ink/graph-layout.mts`
- CLI/TUI command parsing path if `/graph focus` is implemented as a command
- `tests/cli-tui-ink.test.mts`

Tests:

- cycling zoom changes toolbar and density;
- `/graph focus <node-id>` selects expected node;
- focusing an unknown node reports a non-destructive status message;
- label policy affects edge/node labels predictably;
- viewport state does not affect non-graph focus modes.

Exit criteria:

- Toolbar reflects real state, not decorative copy.
- Users can jump to a node id without manually stepping through every node.

Implementation prompt:

```text
You are working in /Users/lan/agent-hub.

Implement Phase TDAG-3 of docs/plan-graph-tui-workflow-dag-roadmap.md.
Make Workflow DAG toolbar state real: zoom, labels, fold, focus, and viewport behavior.

Constraints:
- Keep changes inside TUI state/rendering and existing command parsing boundaries.
- Do not run agents or mutate task state from focus commands.
- Preserve normal composer typing and slash-command behavior.
- Keep unknown-node focus attempts non-destructive.

Deliverables:
- Toolbar fields reflect actual graph state.
- /graph focus <node-id> or equivalent palette command selects and centers a node.
- Tests cover zoom, labels, focus, and viewport behavior.

Verification:
- Run focused cli-tui-ink tests.
- Rebuild CLI if visible TUI behavior changed.
- Run manual PTY verification for Graph focus, focus command, zoom, labels, and composer safety.
- Run typecheck, lint, and git diff --check.
```

## Phase TDAG-4: Subgraphs And Fold State

Goal: represent dynamic branches as visual subgraphs rather than plain grouped
rows.

Scope:

- Derive subgraph groups for:
  - RoleCall branches;
  - comparison branches;
  - parallel implementation branches;
  - fallback branches.
- Draw terminal-safe group boundaries when width allows.
- Add fold state per group id.
- Collapsed groups should show a summary row with node count, status, risk,
  and selected descendant indicator.
- Preserve current grouped-row fallback when boundaries do not fit.

Implementation areas:

- `apps/cli/src/tui-ink/graph-layout.mts`
- `apps/cli/src/tui-ink/state.mts`
- `apps/cli/src/tui-ink/App.mts`
- `packages/core/src/tui-read-model.ts` only if group metadata needs to be
  exposed from the read model
- `tests/cli-tui-ink.test.mts`
- `tests/tui-read-model.test.ts` if read-model grouping is added

Tests:

- expanded RoleCall subgraph shows branch nodes;
- collapsed RoleCall subgraph hides descendants but keeps summary;
- selected descendant keeps parent summary highlighted when collapsed;
- comparison branch and fallback branch get separate group labels;
- compact fallback remains readable.

Exit criteria:

- The Graph view can show an `Implement Subgraph [-]` style section without
  losing selection or evidence detail.
- Folding does not mutate ExecutionTraceGraph or RoleCall state.

Implementation prompt:

```text
You are working in /Users/lan/agent-hub.

Implement Phase TDAG-4 of docs/plan-graph-tui-workflow-dag-roadmap.md.
Add visual subgraph grouping and fold state to the TUI Workflow DAG.

Constraints:
- Fold state is local TUI state only.
- Do not mutate PlanGraph, ExecutionTraceGraph, RoleCall, or TaskRun records.
- Keep grouped rendering bounded and deterministic.
- Preserve current list fallback for narrow terminals.

Deliverables:
- RoleCall, comparison, parallel, and fallback groups can render as subgraphs.
- Fold/unfold works per group and keeps selection coherent.
- Tests cover expanded, collapsed, selected-descendant, and compact states.

Verification:
- Run focused cli-tui-ink and tui-read-model tests if touched.
- Rebuild CLI and run manual Graph fold verification in a PTY.
- Run typecheck, lint, and git diff --check.
```

## Phase TDAG-5: Node Actions And Safe Commands

Goal: make selected graph nodes actionable without bypassing safety gates.

Scope:

- Add a node action menu opened from the graph detail surface.
- Support read-only actions first:
  - open execution trace command;
  - open run details when source run exists;
  - open RoleCall details when source RoleCall exists;
  - open review/comparison evidence when source id exists;
  - copy or prepare focus command.
- Add safe prepared actions:
  - prepare rerun-from-here command in composer;
  - prepare graph focus command;
  - prepare fold/unfold command.
- Do not immediately execute reruns from the action menu unless a later phase
  adds explicit confirmation and existing TaskRunner entry points.

Implementation areas:

- `packages/core/src/tui-read-model.ts`
- `apps/cli/src/tui-ink/App.mts`
- `apps/cli/src/tui-ink/state.mts`
- `tests/tui-read-model.test.ts`
- `tests/cli-tui-ink.test.mts`

Tests:

- plan node exposes trace/focus/fold actions;
- task-run trace node exposes run detail command;
- RoleCall trace node exposes RoleCall command;
- comparison trace node exposes comparison evidence command when available;
- rerun-from-here is prepared, not executed.

Exit criteria:

- The mock's `Actions` section has real, inspectable behavior.
- Dangerous or mutating actions remain behind explicit user submission or
  confirmation.

Implementation prompt:

```text
You are working in /Users/lan/agent-hub.

Implement Phase TDAG-5 of docs/plan-graph-tui-workflow-dag-roadmap.md.
Add safe selected-node actions for the TUI Workflow DAG.

Constraints:
- Prefer read-only commands and composer-prepared actions.
- Do not execute reruns, apply code, merge, push, create PRs, or approve memory from the graph action menu.
- Keep action derivation in the read model where it depends on source ids.
- Keep renderer behavior local and predictable.

Deliverables:
- Selected graph nodes expose useful read-only commands.
- Rerun/focus/fold actions are prepared safely and visibly.
- Tests cover node-type-specific actions and no-auto-execution behavior.

Verification:
- Run focused tui-read-model and cli-tui-ink tests.
- Rebuild CLI and manually verify action menu behavior in a PTY.
- Run typecheck, lint, and git diff --check.
```

## Phase TDAG-6: Structural Mini-Map

Goal: make the mini-map show graph structure and viewport, not only item count.

Scope:

- Render a small symbolic overview of rank/lane occupancy.
- Mark selected node or selected viewport.
- Show current zoom and viewport coverage.
- Keep mini-map hidden or compact when the terminal cannot spare rows.

Implementation areas:

- `apps/cli/src/tui-ink/graph-layout.mts`
- `apps/cli/src/tui-ink/App.mts`
- `tests/cli-tui-ink.test.mts`

Tests:

- chain graph mini-map shows linear structure;
- parallel graph mini-map shows branch structure;
- selected viewport marker changes when focus changes;
- mini-map truncates safely in narrow terminals.

Exit criteria:

- Mini-map gives a useful structural cue at a glance.
- It does not steal enough height to make the graph less readable.

Implementation prompt:

```text
You are working in /Users/lan/agent-hub.

Implement Phase TDAG-6 of docs/plan-graph-tui-workflow-dag-roadmap.md.
Upgrade the Workflow DAG mini-map from a count summary to a structural terminal overview.

Constraints:
- Keep the mini-map symbolic and bounded.
- Do not introduce bitmap, canvas, browser, or external rendering dependencies.
- Hide or compress the mini-map when terminal height is constrained.

Deliverables:
- Mini-map reflects chain, branch, selected node, and viewport state.
- Tests cover chain, parallel, focused, and narrow layouts.

Verification:
- Run focused cli-tui-ink tests.
- Rebuild CLI and manually verify Graph mini-map in a PTY.
- Run typecheck, lint, and git diff --check.
```

## Phase TDAG-7: Visual QA Fixture Pack

Goal: make reference fidelity testable rather than subjective.

Scope:

- Add deterministic graph fixture models for:
  - plan-only chain;
  - plan plus primary TaskRun;
  - RoleCall-expanded implement subgraph;
  - parallel Codex/Claude comparison branch;
  - failed required node with fallback;
  - narrow terminal fallback.
- Add snapshot tests at representative sizes:
  - `154x42`;
  - `160x48`;
  - `120x36`;
  - `80x24`.
- Add a manual verification checklist specifically for Graph.
- Keep generated manual verification notes untracked unless explicitly asked.

Implementation areas:

- `tests/cli-tui-ink.test.mts`
- `tests/tui-read-model.test.ts`
- optional fixture helper under `tests/`
- `docs/ui-verification/` for manual local notes only

Tests:

- snapshot or targeted string assertions for each fixture;
- row-width budget checks;
- CJK/wide-character label checks if graph labels can contain user text;
- compact fallback assertions.

Exit criteria:

- Future TUI graph regressions can be caught without relying only on manual
  screenshots.
- Manual verification has a stable checklist aligned with the mock.

Implementation prompt:

```text
You are working in /Users/lan/agent-hub.

Implement Phase TDAG-7 of docs/plan-graph-tui-workflow-dag-roadmap.md.
Add a deterministic visual QA fixture pack for the TUI Workflow DAG.

Constraints:
- Keep fixtures local and deterministic.
- Do not add visual browser automation for the terminal UI unless existing test infrastructure already supports it.
- Keep manual verification notes untracked unless the user explicitly asks to publish them.

Deliverables:
- Fixture models cover plan-only, RoleCall-expanded, parallel comparison, fallback, and narrow states.
- Tests assert reference-critical strings, row widths, and fallback behavior.
- A manual Graph verification checklist exists for future TUI graph changes.

Verification:
- Run focused cli-tui-ink and tui-read-model tests.
- Rebuild CLI and complete manual Graph PTY verification.
- Run typecheck, lint, and git diff --check.
```

## Recommended Order

1. TDAG-0, to remove stale roadmap confusion.
2. TDAG-1, because a stable layout model makes later work smaller.
3. TDAG-2, because spatial DAG rows are the main visual gap.
4. TDAG-3, because focus/viewport state makes large graphs navigable.
5. TDAG-4, because subgraphs depend on layout and viewport semantics.
6. TDAG-5, because actions should build on stable selection and grouping.
7. TDAG-6, because mini-map fidelity depends on viewport semantics.
8. TDAG-7, because it locks the result with repeatable fixtures and manual QA.

Each phase should stay inside the CLI/TUI/read-model boundary unless it
explicitly needs a small core read-model addition. Behavior-changing phases
must update `docs/product.md` and `docs/architecture.md` in the same PR.
