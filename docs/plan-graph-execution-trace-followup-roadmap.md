# PlanGraph And ExecutionTraceGraph Follow-Up Roadmap

Status: planning follow-up for the current PlanGraph implementation branch
Last updated: 2026-06-16

Current note: several phases in this original follow-up roadmap have now landed
on the PlanGraph implementation branch. Use `docs/product.md` and
`docs/architecture.md` for current shipped behavior. The remaining
Graph-specific terminal UI fidelity work is tracked in
`docs/plan-graph-tui-workflow-dag-roadmap.md`.

This document turns the remaining PlanGraph and ExecutionTraceGraph gaps into
small implementation slices. It assumes the current branch already has the
shared graph contracts, deterministic planner, optional local adapter-backed
planner, primary-run plan binding, RoleCall trace links, execution-trace read
model, CLI inspection, TUI list modes, desktop Trace tab, and plan-aware risk
findings.

The goal of the follow-up work is not to replace that foundation. The goal is
to close the semantic gaps between the current implementation and the target
workflow:

```text
TaskBrief
  -> @planner produces PlanGraph
  -> PlanGraph drives scheduled primary TaskRuns
  -> RoleCalls expand ExecutionTraceGraph as runtime tool events
  -> verification, risk, artifacts, review, memory, and comparison evidence
     attach to the trace
```

## Current Baseline

Implemented:

- planner-rooted `PlanGraph` and `ExecutionTraceGraph` shared DTOs;
- domain validation for planner metadata, DAG topology, safe instructions,
  trace links, evidence links, and deviations;
- in-memory and SQLite repositories for PlanGraphs and trace-link source rows;
- deterministic PlanGraph creation before the primary adapter run;
- opt-in `agent_adapter` planner mode that runs a special local `@planner`
  role in an isolated planner worktree and validates structured JSON output;
- manual PlanGraph input mode after validation;
- primary run binding to the first planned `primary_run` node;
- runtime injection of PlanGraph, current plan node, allowed next nodes, and
  plan-following rules;
- RoleCall tool events and dynamic trace nodes for accepted RoleCalls;
- callee run inheritance of the source PlanGraph binding;
- deterministic `ExecutionTraceGraph` projection from local evidence;
- read-only CLI and desktop inspection;
- TUI Overlay, Plan, and Trace list modes.

Remaining product diffs:

1. SQLite currently needs the durable `proposed` PlanGraph status constraint to
   match the shared domain contract before proposed amendments can be treated
   as fully durable in SQLite.
2. Desktop run trace lookup should resolve the PlanGraph bound to the selected
   run, not just the task's current active graph.
3. TaskRunner does not yet act as a full PlanGraph scheduler. It binds the
   current run to one plan node, while downstream `primary_run` nodes require
   explicit caller binding.
4. The default planner path is deterministic and represented by a planner node.
   A stricter product mode where every task uses an actual adapter-backed
   `@planner` role remains optional and needs a product switch.
5. ExecutionTraceGraph does not yet attach every available evidence class as a
   first-class trace source, especially run artifacts, review decisions, and
   comparison/best-result outcomes.
6. The TUI Graph surface is still a list-oriented trace view, not the full DAG
   workbench with node boxes, edge labels, subgraphs, mini-map, legend, and
   structured selected-node actions.

## Guardrails

- Keep Agent Hub local-first and CLI-first.
- Do not add a cloud workflow engine, remote task execution, accounts, hosted
  dashboards, browser-only UI, or a server API.
- Keep every agent execution inside an isolated git worktree.
- Do not write Agent Hub context files to the target repository root by
  default.
- Do not automatically merge, push, create pull requests, approve memory,
  export repository context, apply code, or delete branches.
- Preserve the existing RoleCall model as dynamic runtime delegation. Do not
  turn RoleCalls into PlanGraph mutations.
- Keep `ExecutionTraceGraph` as a deterministic read model over local evidence,
  not a stored LLM-generated snapshot.
- Keep desktop renderer code sandboxed. Renderer code must not access SQLite,
  filesystem, shell, git, or TaskRunner directly.
- Land each phase as a small vertical slice with focused tests and matching
  product/architecture docs when behavior changes.

## Phase 1: Durable Contract Cleanup

Goal: make persisted graph state match the shared domain contract.

Scope:

- Allow `proposed` in the SQLite `plan_graphs.status` constraint.
- Add a SQLite regression proving a proposed amendment persists without
  replacing the active graph.
- Confirm in-memory and SQLite repository behavior match for proposed,
  active, superseded, and failed states.
- Update current-state docs to say proposed amendments are durable after this
  phase lands.

Implementation areas:

- `packages/db/src/sqlite-storage.ts`
- `tests/sqlite-storage.test.ts`
- `docs/product.md`
- `docs/architecture.md`

Tests:

- `vitest run tests/sqlite-storage.test.ts -t "persists PlanGraphs"`
- `pnpm test -- tests/sqlite-storage.test.ts`
- `pnpm typecheck`
- `pnpm lint`
- `git diff --check`

Exit criteria:

- `PlanGraph.status: "proposed"` can be inserted and read back from SQLite.
- Creating a proposed graph does not supersede the current active graph.
- Activating that proposed graph still supersedes the prior active graph
  through the existing repository path.

Implementation prompt:

```text
You are working in /Users/lan/agent-hub.

Implement Phase 1 of docs/plan-graph-execution-trace-followup-roadmap.md.
Close the durable contract mismatch for proposed PlanGraph amendments.

Constraints:
- Keep the change limited to SQLite persistence, focused tests, and current-state docs.
- Do not change PlanGraph domain semantics unless a test proves the contract is wrong.
- Do not touch TUI or desktop UI code.
- Preserve local-first behavior and existing migration/bootstrap style.

Deliverables:
- SQLite accepts plan_graphs.status = proposed.
- A regression test proves a proposed graph can be stored without replacing the active graph.
- docs/product.md and docs/architecture.md describe the corrected current state.

Verification:
- Run the focused SQLite test.
- Run typecheck, lint, and git diff --check.
```

## Phase 2: Run-Bound Execution Trace Lookup

Goal: make trace inspection stable for old runs after a task receives a newer
active PlanGraph.

Scope:

- Resolve `ExecutionTraceGraph` for a run from `run_metadata.planBinding` when
  a run id is the lookup root.
- Fall back to task active graph only when the selected run has no plan
  binding.
- Add a service test with two PlanGraph versions for the same task: one old run
  bound to v1, one newer active v2. The old run inspector must show v1.
- Consider adding a core helper so CLI, TUI, and desktop can share the same
  run-bound lookup rule.

Implementation areas:

- `packages/core/src/execution-trace-read-model.ts`
- `packages/core/src/storage.ts`
- `apps/desktop/electron/services/review-service.ts`
- `tests/execution-trace-read-model.test.ts`
- `tests/desktop-services.test.ts`

Tests:

- focused execution-trace read-model test;
- focused desktop service test;
- `pnpm typecheck`;
- `pnpm lint`;
- `git diff --check`.

Exit criteria:

- A run inspector never silently switches to a later active PlanGraph when the
  run metadata is bound to an older graph.
- Legacy runs without plan binding remain readable through the existing
  no-plan fallback.
- The fix does not make the renderer aware of SQLite or run metadata internals.

Implementation prompt:

```text
You are working in /Users/lan/agent-hub.

Implement Phase 2 of docs/plan-graph-execution-trace-followup-roadmap.md.
Make ExecutionTrace lookup run-bound when the caller asks for trace evidence for a specific run.

Constraints:
- Keep the read-model deterministic and repository-backed.
- Prefer a core helper over duplicating lookup rules in desktop services.
- Preserve legacy fallback for runs without planBinding.
- Do not change desktop renderer orchestration boundaries.

Deliverables:
- ReviewService.getExecutionTrace(runId) uses runMetadata.planBinding.planGraphId when present.
- Tests cover an old run bound to a superseded graph and a newer active graph for the same task.
- Existing task-id and plan-graph-id lookup behavior still works.

Verification:
- Run the focused read-model and desktop-service tests.
- Run typecheck, lint, and git diff --check.
```

## Phase 3: PlanGraph Scheduler MVP

Goal: move from single-node binding to bounded DAG-driven execution for
planned `primary_run` nodes.

Scope:

- Add a scheduler service that can select runnable `primary_run` nodes from a
  PlanGraph based on dependencies and prior run evidence.
- Keep scheduling explicit and local. The scheduler may create TaskRuns, but it
  must not apply, merge, push, approve memory, or export repository context.
- Support a conservative first policy:
  - planner node must exist and be valid;
  - `system` nodes are satisfied by local system evidence;
  - a `primary_run` node becomes runnable when all required upstream primary or
    system nodes have terminal successful evidence;
  - `manual` nodes block downstream required nodes until explicit user action;
  - `fallback` edges are activated only when the source node failed or blocked;
  - `parallel` nodes may be launched as separate TaskRunner calls but remain
    concurrency-limited by the existing local queue policy.
- Store one TaskRun binding per scheduled PlanNode.
- Avoid re-running a plan node that already has terminal successful evidence
  unless the caller explicitly requests a rerun.

Implementation areas:

- `packages/task-runner/src/task-runner.ts`
- `packages/task-runner/src/plan-graph-scheduler.ts`
- `packages/core/src/execution-trace-read-model.ts`
- `packages/core/src/storage.ts`
- `apps/cli/src/cli.ts` if a CLI entry point is needed
- `tests/task-runner.test.ts`
- `tests/execution-trace-read-model.test.ts`

Tests:

- simple chain: planner -> implement -> verify -> review;
- parallel branch scheduling with bounded concurrency;
- fallback edge after failed required node;
- manual node blocks downstream work;
- rerun is explicit, not automatic;
- generated worktrees stay isolated and original checkout unchanged.

Exit criteria:

- Every scheduled executable PlanNode produces one primary TaskRun and run
  metadata binds it to that node.
- ExecutionTraceGraph shows one runtime TaskRun node for each scheduled
  PlanNode.
- Skipped-required-node deviations only appear when a node is truly skipped or
  blocked, not simply because the scheduler has not reached it yet.

Implementation prompt:

```text
You are working in /Users/lan/agent-hub.

Implement Phase 3 of docs/plan-graph-execution-trace-followup-roadmap.md.
Add a bounded PlanGraph scheduler MVP for primary_run nodes.

Constraints:
- Keep TaskRunner as the only adapter execution boundary.
- Do not introduce a workflow server, remote queue, cloud state, or renderer-side orchestration.
- Keep the first scheduler policy conservative and testable.
- Preserve the existing single-run TaskRunner path for callers that do not opt into graph scheduling.
- Do not auto-merge, push, apply, approve memory, export context, or delete branches.

Deliverables:
- A scheduler service selects runnable primary_run nodes from persisted PlanGraph evidence.
- Scheduled nodes call the existing TaskRunner path with planGraphBinding.
- Tests cover chain, parallel, fallback, manual blocking, and rerun behavior.
- docs/product.md and docs/architecture.md distinguish single-run mode from graph-scheduled mode.

Verification:
- Run focused TaskRunner and execution-trace tests.
- Run typecheck, lint, and git diff --check.
```

## Phase 4: Planner Role Policy

Goal: decide and implement whether `@planner` should always be adapter-backed
or remain deterministic by default with an opt-in adapter-backed mode.

Recommended product decision:

- Keep deterministic planner as the default MVP path because it is stable,
  local, fast, testable, and does not require an authenticated Codex or Claude
  CLI before every run.
- Add a project or run policy that can require `agent_adapter` planner mode for
  users who want every task to be planned by an actual local `@planner` role.
- Keep both modes represented by the same planner node contract so downstream
  graph logic does not care how the plan was produced.

Scope:

- Add explicit planner policy configuration if not already present at the
  desired surface.
- Make run output and inspection clear about whether the planner was
  deterministic, manual, or adapter-backed.
- Ensure adapter-backed planner failures stop before primary execution and
  preserve planner evidence.
- Keep dry-run behavior explicit: adapter-backed planning cannot run in
  dry-run mode unless a future fake/local adapter policy says otherwise.

Implementation areas:

- `packages/task-runner/src/task-runner.ts`
- project settings repositories if persistent policy is needed
- `apps/cli/src/cli.ts`
- desktop settings only if the product surface needs it
- `tests/task-runner.test.ts`
- `tests/cli.test.ts`

Tests:

- deterministic default remains available;
- policy requires adapter-backed planner and fails clearly when no planner
  adapter is configured;
- valid adapter-backed planner output activates the graph;
- invalid planner output prevents primary execution;
- planner mode is visible in persisted events and inspection output.

Exit criteria:

- Product behavior explicitly matches the chosen planner policy.
- Users can tell which planner mode created a graph.
- The rest of PlanGraph and ExecutionTraceGraph remains mode-agnostic.

Implementation prompt:

```text
You are working in /Users/lan/agent-hub.

Implement Phase 4 of docs/plan-graph-execution-trace-followup-roadmap.md.
Harden planner role policy so the product can clearly support deterministic default planning and optional required adapter-backed @planner planning.

Constraints:
- Do not remove deterministic mode unless product docs and tests are updated together.
- Keep @planner local-only and worktree-isolated.
- Do not add remote model APIs or cloud planner execution.
- Preserve structured output validation before activation.

Deliverables:
- A clear planner policy surface or explicit run configuration.
- Planner mode visible in events and inspection.
- Tests for deterministic, required adapter-backed, missing adapter, and invalid output paths.

Verification:
- Run focused TaskRunner and CLI tests.
- Run typecheck, lint, and git diff --check.
```

## Phase 5: Trace Evidence Completion

Goal: make ExecutionTraceGraph cover all major local evidence classes needed
for review and comparison.

Scope:

- Add trace projection for run artifacts where bounded summaries are already
  available.
- Add trace projection for review decisions as review evidence.
- Add comparison report support so parallel implementation workflows can create
  trace nodes such as `compare_results` and `best_result` without inventing a
  new non-local workflow engine.
- Extend trace source types only when needed, for example
  `comparison_report`.
- Keep raw logs, full diffs, and large artifacts out of the trace payload;
  store ids and bounded summaries.

Implementation areas:

- `packages/shared/src/plan-graphs.ts`
- `packages/core/src/domain.ts`
- `packages/core/src/execution-trace-read-model.ts`
- `packages/core/src/storage.ts`
- comparison report repositories if trace projection needs them
- `tests/domain.test.ts`
- `tests/execution-trace-read-model.test.ts`
- `tests/sqlite-storage.test.ts`

Tests:

- run artifact evidence appears as bounded trace evidence;
- review decision evidence links to the relevant run or plan node;
- comparison report evidence creates deterministic trace evidence;
- trace validation rejects evidence that points to unknown nodes;
- legacy tasks remain readable.

Exit criteria:

- ExecutionTraceGraph can explain implementation, verification, risk,
  artifacts, review, memory, and comparison outcomes from local persisted
  evidence.
- Parallel Codex/Claude comparison workflows can be represented as trace
  evidence without mutating the original PlanGraph.
- Trace payloads remain bounded and inspection-friendly.

Implementation prompt:

```text
You are working in /Users/lan/agent-hub.

Implement Phase 5 of docs/plan-graph-execution-trace-followup-roadmap.md.
Complete ExecutionTrace evidence projection for artifacts, review decisions, and comparison outcomes.

Constraints:
- Keep ExecutionTraceGraph deterministic and local.
- Link evidence by ids and bounded summaries; do not copy raw logs, full diffs, or large artifact bodies.
- Extend shared trace source types only when the projection needs a new durable source category.
- Keep RoleCalls as runtime trace expansion, not PlanGraph mutations.

Deliverables:
- Trace projection includes run_artifact, review_decision, and comparison evidence where available.
- Domain and storage tests cover any new trace source type.
- Read-model tests cover parallel comparison evidence and best-result style summaries.

Verification:
- Run domain, execution-trace read-model, and storage tests.
- Run typecheck, lint, and git diff --check.
```

## Phase 6: TUI DAG Workbench

Goal: turn the existing TUI trace list into the graph workbench described by
the product mock.

Scope:

- Keep the existing read-model boundary. TUI rendering must consume
  `TuiCurrentContextModel.executionTrace`; it must not query SQLite directly.
- Rename or present the focus as `Graph - Workflow DAG` while preserving
  compatibility shortcuts for existing `graph` focus state.
- Add a bounded terminal DAG renderer:
  - rectangular nodes with state/risk glyphs;
  - visible edge labels and line styles for primary, parallel, optional, and
    fallback edges;
  - dashed grouped subgraphs for dynamic RoleCall or comparison branches;
  - compact list fallback for narrow terminals;
  - selected-node highlighting and detail synchronization.
- Add toolbar state for mode, layout, focus, labels, fold, and zoom when the
  terminal can display it.
- Add selected-node details for plan nodes and trace nodes:
  artifacts, incoming, outgoing, evidence, deviations, and actions.
- Add legend and mini-map only after the core DAG renderer is stable.

Implementation areas:

- `apps/cli/src/tui-ink/App.mts`
- `apps/cli/src/tui-ink/state.mts`
- `apps/cli/src/tui-ink/graph-layout.mts`
- `packages/core/src/tui-read-model.ts`
- `tests/cli-tui-ink.test.mts`
- `tests/tui-read-model.test.ts`

Tests:

- renderer snapshots for plan-only, trace-only, overlay, RoleCall-expanded,
  comparison-expanded, narrow, and wide terminal states;
- interaction tests for mode switching, selection movement, fold, detail, and
  graph focus command;
- fallback tests proving legacy RoleCall rows remain inspectable when trace
  projection is absent.

Manual verification:

- rebuild CLI;
- run `agent-hub tui --once`;
- launch interactive TUI in a real PTY;
- verify launch, exit, help, command palette, focus navigation, selection,
  composer typing, composer clear/cancel, safe prompt submission path,
  Graph/Trace/Runs/Review/Tasks/Memory views, and narrow fallback;
- write an untracked verification note under `docs/ui-verification/`.

Exit criteria:

- Graph is useful before RoleCalls exist.
- Overlay mode explains both expected workflow and actual execution.
- Edge labels, subgraphs, selected-node details, and deviations are readable in
  bounded terminal sizes.

Implementation prompt:

```text
You are working in /Users/lan/agent-hub.

Implement Phase 6 of docs/plan-graph-execution-trace-followup-roadmap.md.
Upgrade the TUI Graph surface from a list trace view into a bounded terminal Workflow DAG workbench.

Constraints:
- Keep orchestration and persistence out of the Ink renderer.
- Consume the existing TUI read model and extend it only where renderer data is missing.
- Preserve existing focus, composer, status, and hotkey behavior.
- Keep narrow terminals readable with a compact fallback.
- Follow AGENTS.md TUI verification requirements.

Deliverables:
- DAG renderer with node boxes, edge labels, selected state, and compact fallback.
- Structured selected-node detail for plan and trace nodes.
- Tests for rendering and graph interactions.
- Untracked manual TUI verification note.

Verification:
- Rebuild CLI.
- Run focused TUI tests.
- Run interactive PTY verification and save the note.
- Run typecheck, lint, and git diff --check.
```

## Phase 7: End-To-End Acceptance Sweep

Goal: prove the graph lifecycle works as a real local workflow rather than a
set of isolated features.

Scope:

- Create an end-to-end fixture or integration test that exercises:
  - TaskBrief creation;
  - planner graph creation;
  - scheduled PlanNode execution;
  - runtime RoleCall expansion;
  - verification/risk/diff/artifact evidence;
  - review and comparison evidence;
  - ExecutionTraceGraph projection;
  - CLI inspection;
  - TUI read-model consumption.
- Keep the test local and deterministic. Use fake adapters unless the test is
  explicitly process-adapter focused.
- Add docs updates for any behavior clarified by the acceptance sweep.

Implementation areas:

- `tests/task-runner.test.ts`
- `tests/execution-trace-read-model.test.ts`
- `tests/cli.test.ts`
- `tests/tui-read-model.test.ts`
- optional focused fixture helper under `tests/`
- `docs/product.md`
- `docs/architecture.md`

Tests:

- focused end-to-end graph lifecycle test;
- CLI JSON stability test;
- read-model fixture test;
- relevant package tests touched by earlier phases.

Exit criteria:

- One deterministic local test can show the entire graph lifecycle from plan to
  trace.
- Product and architecture docs match the implemented behavior.
- Remaining work is clearly UI polish or future capability, not a hidden
  bottom-layer semantic gap.

Implementation prompt:

```text
You are working in /Users/lan/agent-hub.

Implement Phase 7 of docs/plan-graph-execution-trace-followup-roadmap.md.
Add an end-to-end acceptance sweep for the PlanGraph and ExecutionTraceGraph lifecycle.

Constraints:
- Use local fake adapters unless a process adapter is specifically under test.
- Keep the fixture deterministic and bounded.
- Do not introduce cloud, server, remote execution, automatic merge, push, apply, or memory approval behavior.

Deliverables:
- End-to-end lifecycle test from TaskBrief to PlanGraph to scheduled runs to ExecutionTraceGraph.
- CLI/read-model assertions that prove the trace is inspectable.
- Product and architecture docs updated for the final implemented behavior.

Verification:
- Run the new focused test and the touched package tests.
- Run typecheck, lint, and git diff --check.
```

## Recommended Sequencing

Do the phases in this order:

1. Phase 1, because it closes a durable contract mismatch with low blast radius.
2. Phase 2, because trace inspection must be trustworthy before richer graph
   UI or scheduler behavior builds on it.
3. Phase 3, because full graph scheduling is the main semantic gap.
4. Phase 4, because planner policy should be explicit before broad rollout.
5. Phase 5, because evidence completion makes the graph useful for comparison
   and review.
6. Phase 6, because the TUI DAG should be built on stable semantics and
   complete evidence.
7. Phase 7, because it locks the lifecycle with one acceptance-level proof.

Each phase should land as a focused branch and PR unless the user explicitly
asks to batch adjacent phases. If a phase changes behavior, update both
`docs/product.md` and `docs/architecture.md` in the same change.
