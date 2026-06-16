# PlanGraph And ExecutionTraceGraph Product Spec

Status: implemented product slice with follow-on extension notes. This document
describes the PlanGraph and ExecutionTraceGraph behavior now implemented in
Agent Hub, plus the bounded future extensions called out below.

## Summary

Agent Hub models graph execution through a three-stage lifecycle:

1. A planner node runs from the `TaskBrief` and produces the initial graph.
2. The resulting `PlanGraph` schedules planned execution nodes as primary
   TaskRuns.
3. Runtime events expand the trace through TaskRuns, RoleCall tool events,
   verification, risk, diffs, artifacts, and deviations.

Agent Hub exposes two graph layers through that lifecycle:

- `PlanGraph`: a planner-produced executable DAG. It includes the planner node
  itself and the planned execution nodes that should be scheduled as primary
  runs.
- `ExecutionTraceGraph`: the runtime-expanded graph. It overlays the original
  PlanGraph with actual TaskRuns, RoleCall tool events, dynamically created
  trace nodes, verification, risk, diffs, artifacts, and deviations.

The current implementation already has most execution evidence primitives:
`TaskBrief`, `TaskRun`, `RunEvent`, `RunArtifact`, RoleCall records,
RoleCallEvent records, RoleTodo records, verification rows, risk reports, and a
TUI read model that exposes a RoleCall graph summary. The missing product layer
is an explicit plan contract that is created before the first execution role
runs and then linked to actual execution evidence.

The planner creates the initial graph; each planned execution node is scheduled
as a run; RoleCall is treated as a runtime tool event that may add dynamic
nodes to the execution trace without rewriting the original PlanGraph.

The intended flow is:

```text
TaskBrief
  -> PlannerNode run
  -> PlanGraph
       -> planned execution nodes scheduled as primary TaskRuns
       -> RoleCall tool events may create dynamic trace nodes
  -> ExecutionTraceGraph = PlanGraph + runtime expansions + persisted evidence
```

## Problem

The existing Graph surface is centered on RoleCalls. It is useful once one role
delegates to another, but it cannot answer these questions:

- What was supposed to happen before execution started?
- Which step is the current role working on?
- Did the implementation follow the intended verification and review path?
- Which planned node emitted a runtime RoleCall tool event?
- Where did execution deviate from the original task brief?

Without a first-class plan graph, the product can only display a trace after
dynamic collaboration has already happened. That makes the graph mostly
reactive. The proposed split makes Graph useful before, during, and after a
run.

## Current Implementation Anchors

The plan/trace design should build on these existing capabilities:

- TaskRunner already builds a task-specific context pack and `TaskBrief` before
  adapter execution.
- TaskRunner already creates an isolated worktree, invokes the selected adapter
  from that worktree, persists events, runs verification, collects diffs,
  stores artifacts, generates risk reports, and proposes memory.
- Role-backed runs already inject role metadata, collaboration rules, safe
  permission summaries, and team lists into the adapter prompt.
- Adaptive RoleCalls already parse line-start `@role task` syntax after a
  role-backed assistant message, validate policy, persist RoleCall/RoleTodo/
  RoleCallEvent records, and execute accepted `agent_adapter` calls through the
  same TaskRunner path.
- `agent-hub tui` already has a Graph focus mode, selected-object detail
  payloads, RoleCall loop state, and navigation state for selecting and
  folding role-call nodes.

The product change should not replace these primitives. It should add a plan
contract before them and a broader execution projection above them.

## Product Goals

1. Generate a `PlanGraph` before task execution starts.
2. Treat the planner as a special local `@planner` role represented by a
   planner node inside the graph.
3. Schedule executable PlanNodes as primary TaskRuns.
4. Treat RoleCall as a runtime tool event emitted by a running PlanNode.
5. Require executable roles to receive the active PlanGraph and current plan
   node in runtime injection.
6. Link task runs, RoleCalls, artifacts, verification results, and risk results
   back to plan nodes where possible.
7. Show planned workflow and actual execution separately, with an overlay view
   for deviations.
8. Keep all behavior local-first and compatible with isolated worktrees.
9. Preserve the existing RoleCall model as the dynamic delegation mechanism
   inside the execution trace.

## Non-Goals

- Do not add a cloud workflow engine.
- Do not add remote task execution.
- Do not add a browser-only workflow dashboard.
- Do not require users to write workflow files in their repositories.
- Do not automatically merge, push, create pull requests, or approve memory.
- Do not make the plan immutable in a way that blocks useful local execution;
  deviations should be recorded and reviewable.
- Do not replace RoleCalls with PlanGraph edges. RoleCalls remain audit records
  for dynamic role-to-role work.

## Core Concepts

### PlanGraph

`PlanGraph` is the expected workflow for one task. It is generated from the
current `TaskBrief` by a planner node before planned execution nodes are
scheduled.

The graph is product-owned local state. It should be persisted in SQLite and
available to CLI, TUI, desktop, and review commands.

Minimum fields:

```ts
interface PlanGraph {
  id: string;
  taskId: string;
  taskBriefArtifactId?: string;
  version: number;
  status: "active" | "superseded" | "failed";
  plannerNodeId: string;
  createdByRole: "planner";
  createdAt: string;
  nodes: PlanNode[];
  edges: PlanEdge[];
}
```

The planner node should be part of `nodes`, not only metadata on the graph:

```ts
interface PlannerNode extends PlanNode {
  kind: "planner";
  role: "planner";
  outputPlanGraphId: string;
}
```

This makes planner input, output, status, failures, and retries inspectable in
the same audit model as the rest of the graph.

### PlanNode

A `PlanNode` is a planned executable slot in the PlanGraph. It is not the
persisted TaskRun record itself, but each executable PlanNode is expected to
produce one primary TaskRun when scheduled.

A PlanNode describes which role should execute the node, what instructions it
receives, what output is expected, and what acceptance criteria must be met.
Runtime RoleCalls may create additional dynamic trace nodes linked back to the
source PlanNode, but they do not rewrite the original PlanGraph.

Suggested node kinds:

- `planner`: produce the executable DAG from the TaskBrief.
- `intake`: understand the user request and constraints.
- `plan`: derive implementation and verification sequence.
- `research`: inspect code, docs, or evidence.
- `implement`: change code or docs.
- `verify`: run checks or inspect evidence.
- `review`: review output, risk, and acceptance readiness.
- `memory`: propose or evaluate memory updates.
- `handoff`: produce final summary or retained-worktree handoff.

Minimum fields:

```ts
interface PlanNode {
  id: string;
  kind: PlanNodeKind;
  title: string;
  role: string;
  instructions: string;
  acceptanceCriteria: string[];
  riskLevel: "low" | "medium" | "high";
  required: boolean;
  execution: {
    mode: "primary_run" | "system" | "manual" | "non_executable";
    expectedAdapter?: string;
    worktreePolicy?: "isolated";
  };
}
```

Execution modes distinguish scheduled work from display or governance nodes:

- `primary_run`: the node should create a primary TaskRun when scheduled.
- `system`: Agent Hub owns the node as a system step, such as the planner root
  represented in the graph after the system `@planner` adapter returns valid
  output.
- `manual`: the node waits for explicit human input or confirmation.
- `non_executable`: the node represents evidence, artifacts, or summary state
  and is not scheduled directly.

### PlanEdge

A `PlanEdge` describes expected ordering or dependency.

Suggested edge types:

- `primary`: the normal path.
- `parallel`: work may run alongside another branch.
- `optional`: work only runs when conditions apply.
- `fallback`: work runs when a prior path fails or is blocked.

```ts
interface PlanEdge {
  from: string;
  to: string;
  type: "primary" | "parallel" | "optional" | "fallback";
  label?: string;
}
```

### ExecutionTraceGraph

`ExecutionTraceGraph` is not generated directly by an agent. It is a
deterministic projection from persisted local evidence.

ExecutionTraceGraph is the runtime overlay of a PlanGraph. It contains all
PlanGraph nodes and edges, then adds runtime evidence and dynamic trace nodes
created by TaskRuns, RoleCall tool events, verification, risk analysis, diffs,
artifacts, memory proposals, and deviations.

It should include:

- plan nodes from the active PlanGraph;
- task runs linked to plan nodes;
- RoleCalls linked to plan nodes and parent RoleCalls;
- verification, risk, diff, and artifact summaries;
- memory proposal events;
- deviations between planned workflow and actual execution.

Minimum projection shape:

```ts
interface ExecutionTraceGraph {
  taskId: string;
  planGraphId: string;
  planGraphVersion: number;
  baseNodes: PlanNode[];
  baseEdges: PlanEdge[];
  dynamicNodes: TraceNode[];
  dynamicEdges: TraceEdge[];
  evidence: TraceEvidence[];
  deviations: Deviation[];
}
```

The current RoleCall graph surface should evolve into an ExecutionTrace view,
but ExecutionTraceGraph remains broader than RoleCalls.

### Deviation

A deviation is an explicit difference between the plan and the trace.

Examples:

- an unplanned RoleCall was created;
- a required plan node was skipped;
- verification failed and triggered a fallback;
- a role executed a different node than the active one;
- a plan amendment superseded the active graph.

Deviations are evidence, not necessarily errors.

## Planner Role

The product should expose `@planner` as a special local role represented by a
planner node. The planner node creates the PlanGraph from the TaskBrief and is
the root of the graph lifecycle rather than an external pre-step.

Planner behavior must be agent-backed. Agent Hub runs `@planner` through a
selected local agent/LLM adapter such as Codex, Claude Code, or a future LLM
adapter. Users may choose the adapter, but they must not customize planner
persona, role metadata, system prompt, safety rules, or output format. Agent
Hub generates the complete planner prompt and treats `@planner` as a system
role, not a normal team persona.

Planner output must be structured and validated. Invalid planner output should
fail plan creation inspectably before any implementation run starts.

Planner constraints:

- must output a DAG;
- must include at least one implementation or documentation node for
  change-making tasks;
- must include verification or explicit evidence-inspection nodes when the task
  changes behavior or documentation;
- must include roles that exist in the current team roster or known presets;
- must not include automatic merge, push, PR creation, memory approval, or
  repository export actions;
- must not require writing Agent Hub context files into the target repository.

## Runtime Behavior

### Starting A Task

When a task run starts:

1. TaskRunner builds the context pack and TaskBrief as it does today.
2. Agent Hub runs the system `@planner` role through the selected planner
   adapter in an isolated planner worktree.
3. The planner output becomes a PlanGraph with `plannerNodeId`, planned
   execution nodes, and plan edges.
4. The PlanGraph is validated and persisted.
5. Executable PlanNodes are scheduled as primary TaskRuns according to graph
   edges and policy gates.
6. Runtime injection for each scheduled PlanNode includes the PlanGraph summary,
   current plan node, allowed next nodes, and plan-following rules.
7. The selected role starts work inside the isolated worktree for its scheduled
   primary TaskRun.

For direct agent runs without a role, Agent Hub may assign a default execution
role for plan binding, but it should not invent a collaboration role unless the
user selected one.

### Executing A Plan Node

Each scheduled executable PlanNode produces a primary TaskRun. The execution
role for that run receives:

- task brief;
- selected runtime context;
- role metadata and collaboration policy;
- active PlanGraph;
- current plan node id;
- allowed next node ids;
- rules for recording blocked, completed, or deviated work.

The role should report progress against the current plan node in its output or
structured metadata. The product should not rely only on prose. A future
structured result can record:

```ts
interface PlanNodeResult {
  planGraphId: string;
  planNodeId: string;
  status: "completed" | "blocked" | "skipped" | "deviated";
  summary: string;
  evidence?: string[];
  nextPlanNodeIds?: string[];
}
```

### RoleCall As Runtime Tool Event

A RoleCall is a runtime tool event emitted by a running PlanNode. It is not a
PlanGraph edge and does not mutate the original PlanGraph. If accepted by
policy, it creates one or more dynamic trace nodes in the ExecutionTraceGraph.

Suggested event shape:

```ts
interface RoleCallToolEvent {
  id: string;
  planGraphId: string;
  sourcePlanNodeId: string;
  sourceRunId: string;
  targetRole: string;
  task: string;
  status: "requested" | "accepted" | "rejected" | "completed" | "failed";
  createdTraceNodeIds: string[];
}
```

If a role decides it needs another role:

1. The role emits the existing line-start `@role task` syntax.
2. Agent Hub parses the RoleCall exactly as it does today.
3. The RoleCall records `planGraphId` and `sourcePlanNodeId`.
4. Policy validation still checks delegation permissions, depth, duplicate
   calls, dangerous commands, executor availability, approval gates, and todo
   capacity.
5. The accepted event creates one or more dynamic trace nodes linked to the
   source plan node.
6. The callee run receives the same PlanGraph plus the dynamic trace node or
   a role-specific planned node when one exists.
7. The ExecutionTraceGraph shows both the planned path and the dynamic
   delegation path.

Unplanned RoleCalls are allowed when policy permits them, but they should be
marked as deviations or ad hoc trace nodes.

### Amending The Plan

Plan amendments are useful but should not be part of the first implementation
slice unless required for correctness.

When added, amendments should create a new PlanGraph version rather than
mutating old evidence in place. The trace should show which version was active
for each run or RoleCall.

## Graph Surface

The TUI and desktop Graph surfaces should support three modes:

- `Plan`: show the planned workflow only.
- `Trace`: show actual execution evidence only.
- `Overlay`: show plan nodes plus actual runs, RoleCalls, artifacts, and
  deviations.

The current TUI Graph focus can evolve from a RoleCall list into this surface.
The existing RoleCall graph should be renamed in product copy to
`Execution Trace` once it includes non-RoleCall execution nodes.

### Node Detail

Selecting a PlanGraph node should show:

- node id;
- kind;
- assigned role;
- instructions;
- acceptance criteria;
- risk level;
- required/optional state;
- incoming/outgoing plan edges;
- linked trace evidence when available.

Selecting an ExecutionTrace node should show:

- trace node id;
- source plan node id, when available;
- role;
- run id or RoleCall id;
- status;
- verification summary;
- risk summary;
- artifacts;
- incoming/outgoing trace edges;
- deviations.

### Empty And Early States

Before execution starts, Graph should show PlanGraph even when there are no
RoleCalls. If the planner failed, Graph should show the planner failure and the
safe recovery command or retry path.

If a task has legacy runs without PlanGraph evidence, Graph should fall back to
ExecutionTraceGraph derived from the existing RoleCall/run data and mark the
plan as unavailable.

## CLI Surface

Initial CLI additions can be read-only:

```sh
agent-hub plan-graphs list --task-id <task-id>
agent-hub plan-graphs show <plan-graph-id> [--json]
agent-hub execution-trace show --task-id <task-id> [--json]
```

Potential later commands:

```sh
agent-hub plan-graphs create --task-id <task-id>
agent-hub plan-graphs supersede <plan-graph-id>
agent-hub plan-graphs validate <plan-graph-id>
```

The default `run` command should not print full graph JSON. It may print a
short plan summary and point to inspection commands.

## Persistence Expectations

The first durable implementation should add first-class local persistence once
query needs are concrete:

- plan graph lookup by task id;
- active plan graph lookup for task execution;
- graph version history;
- trace projection by task id;
- run/RoleCall to plan node linkage;
- review of deviations.

Suggested tables:

- `plan_graphs`
- `plan_graph_nodes`
- `plan_graph_edges`
- `trace_nodes`
- `trace_edges`
- `trace_evidence_links`
- `role_call_tool_events`

`ExecutionTraceGraph` itself can remain a read model/projection instead of a
stored graph snapshot. Persist the source evidence and stable links; derive the
view when needed.

## Review And Governance

PlanGraph and ExecutionTraceGraph do not change Agent Hub's governance model:

- review decisions remain audit-only records;
- memory proposals remain proposed until explicitly approved or bounded local
  memory automation applies at existing gates;
- retained-worktree handoff remains explicit;
- local apply remains human-gated;
- merge, push, PR creation, branch deletion, and repo export remain outside
  automatic execution.

Plan validation should reuse existing safety policy concepts:

- sensitive paths;
- dangerous commands;
- unsupported repo export;
- disallowed role delegation;
- automatic side effects;
- missing verification for risky changes.

## Implementation Phases

The implementation should land in small vertical slices. Each phase should keep
the product usable, preserve the current TaskRunner/RoleCall behavior, and add
inspection before adding automation.

### Phase 0: Baseline Rename And Compatibility Contract

Goal: prepare the product language without changing runtime behavior.

Scope:

- Rename the current RoleCall-focused graph copy to `Execution Trace` where it
  is presented as actual execution evidence.
- Keep the existing RoleCall read model and CLI commands unchanged.
- Add compatibility rules for legacy tasks that have runs or RoleCalls but no
  PlanGraph.

Implementation areas:

- `docs/product.md`
- `docs/architecture.md`
- `packages/core/src/tui-read-model.ts`
- `apps/cli/src/tui-ink/App.mts`

Data impact:

- No schema changes.
- No new runtime artifacts.
- No change to TaskRunner execution.

Tests:

- Focused TUI renderer tests that verify graph copy changes without changing
  selection behavior.
- Existing RoleCall read-model tests should continue to pass unchanged.

Exit criteria:

- Existing tasks still show RoleCall evidence.
- UI copy no longer implies RoleCalls are the whole future Graph model.
- Legacy graph behavior is documented as the ExecutionTrace compatibility path.

### Phase 1: Shared PlanGraph Domain Contract

Goal: add typed local contracts before persistence or execution logic.

Scope:

- Add `PlanGraph`, `PlanNode`, `PlannerNode`, `PlanEdge`,
  `PlanNodeExecution`, `TraceNode`, `TraceEdge`, `TraceEvidence`,
  `Deviation`, and `ExecutionTraceGraph` shared types.
- Add validators and state-transition helpers.
- Keep `ExecutionTraceGraph` as a projection type, not a stored domain object.
- Define stable ids for planner nodes and planned execution nodes.

Implementation areas:

- `packages/shared/src/`
- `packages/core/src/domain.ts`
- `tests/domain.test.ts`

Product rules:

- A PlanGraph must be a DAG.
- A PlanGraph must contain exactly one planner node.
- `planGraph.plannerNodeId` must reference a node with `kind: "planner"`.
- Every `primary_run` node must have a role and acceptance criteria.
- Every edge must reference existing nodes.
- PlanGraph validation must reject automatic merge, push, PR creation, memory
  approval, repo export, or repository-root context-file writes.

Tests:

- Validator tests for valid planner-rooted graphs.
- Validator tests for cycles, missing planner nodes, invalid edges, unsafe node
  instructions, and unsupported execution modes.
- Serialization round-trip tests for the shared DTO shape.

Exit criteria:

- Core can validate a PlanGraph without touching SQLite, TaskRunner, or the TUI.
- The type contract distinguishes planned nodes from runtime trace nodes.

### Phase 2: SQLite Persistence And Repository APIs

Goal: persist planner-produced graphs and dynamic trace links locally.

Scope:

- Add durable repositories for PlanGraph records, nodes, and edges.
- Add durable storage for trace nodes, trace edges, trace evidence links, and
  RoleCall tool events.
- Add in-memory repositories with the same contract for tests and local
  runtime composition.

Implementation areas:

- `packages/core/src/storage.ts`
- `packages/db/src/sqlite-storage.ts`
- SQLite migration/bootstrap definitions
- `tests/sqlite-storage.test.ts`

Suggested repository boundaries:

```ts
interface PlanGraphRepository {
  create(graph: PlanGraph): Promise<PlanGraph>;
  get(id: string): Promise<PlanGraph | undefined>;
  getActiveByTaskId(taskId: string): Promise<PlanGraph | undefined>;
  listByTaskId(taskId: string): Promise<PlanGraph[]>;
  supersede(id: string, nextGraphId: string): Promise<PlanGraph>;
}

interface TraceLinkRepository {
  createNode(node: TraceNode): Promise<TraceNode>;
  createEdge(edge: TraceEdge): Promise<TraceEdge>;
  linkEvidence(link: TraceEvidence): Promise<TraceEvidence>;
  listByPlanGraphId(planGraphId: string): Promise<TraceProjectionRows>;
}
```

Data rules:

- PlanGraph rows are versioned by task.
- Only one active PlanGraph should exist per task.
- Superseded graphs remain readable for audit.
- Trace links point to source evidence ids rather than copying full logs,
  patches, or verification bodies.

Tests:

- SQLite integration tests for create/get/list/supersede.
- Active graph uniqueness tests.
- Trace link tests that attach runs, RoleCalls, artifacts, verification, and
  risk evidence to graph nodes.
- Migration bootstrap tests that include the new tables.

Exit criteria:

- CLI/core code can persist and read PlanGraph data through repositories.
- No execution path depends on graph persistence yet.

### Phase 3: System Planner Adapter MVP

Goal: create a PlanGraph before execution through the special system
`@planner` role.

Scope:

- Add a system-generated planner prompt that converts the current TaskBrief and
  injected context into a bounded planner-rooted DAG.
- Run the planner through a selected local agent/LLM adapter in an isolated
  planner worktree.
- Represent the system planner as a planner node with `execution.mode:
  "system"`.
- Persist planner success or failure evidence.
- Add read-only CLI inspection for PlanGraph records.

Implementation areas:

- `packages/core/src/plan-graph-planner.ts`
- `packages/task-runner/src/task-runner.ts`
- `apps/cli/src/cli.ts`
- `tests/task-runner.test.ts`
- `tests/cli.test.ts`

MVP graph shape:

```text
planner
  -> intake/research
  -> implement or documentation
  -> verify
  -> review
  -> handoff
```

Planner behavior:

- Documentation-only tasks can use `documentation -> verify -> review`.
- Code-changing tasks must include `implement`, `verify`, and `review`.
- Memory-sensitive tasks can include optional `memory`.
- Risky or ambiguous tasks can include `research` before implementation.

CLI additions:

```sh
agent-hub plan-graphs list --task-id <task-id>
agent-hub plan-graphs show <plan-graph-id> [--json]
agent-hub plan-graphs validate <plan-graph-id>
```

Tests:

- Structured planner output parsing and validation tests.
- CLI JSON output tests.
- TaskRunner tests proving plan creation happens before adapter execution when
  enabled.
- Failure tests for invalid planner output.

Exit criteria:

- A task can have an active PlanGraph before the first primary execution run.
- The planner node is inspectable even when downstream execution has not
  started.
- Existing runs remain possible if the feature flag or configuration disables
  planner creation.

### Phase 4: Runtime Injection And Primary PlanNode Scheduling

Goal: execute planned nodes as primary TaskRuns while preserving existing run
semantics.

Scope:

- Add scheduling logic for executable PlanNodes.
- Add `planGraphId`, `planNodeId`, and `traceNodeId` to run metadata or
  first-class fields when warranted.
- Inject the active PlanGraph summary and current plan node into adapter input.
- Keep each scheduled run inside an isolated git worktree.

Implementation areas:

- `packages/task-runner/src/task-runner.ts`
- `packages/context-compiler/src/task-brief.ts`
- `packages/agent-adapters/src/agent-adapters.ts`
- `packages/core/src/tui-read-model.ts`
- `tests/task-runner.test.ts`
- `tests/process-adapters.test.ts`

Scheduling rules:

- The planner node runs first.
- `primary_run` nodes are scheduled according to graph dependencies.
- `manual` nodes pause and surface required human action.
- `non_executable` nodes are shown in PlanGraph but are not scheduled.
- Failed required nodes stop downstream required nodes unless a fallback edge is
  available.

Runtime injection must include:

- plan graph id/version;
- current plan node id/title/kind/role;
- node instructions and acceptance criteria;
- allowed next node ids;
- graph-level constraints;
- rule that RoleCalls are runtime tool events, not PlanGraph mutations.

Tests:

- TaskRunner integration tests for scheduling a simple planner -> implement ->
  verify graph.
- Runtime markdown snapshot tests.
- Tests proving generated context still stays out of the original checkout.
- Tests proving disabled planner mode preserves current behavior.

Exit criteria:

- Every scheduled executable PlanNode produces one primary TaskRun.
- The primary TaskRun links back to its PlanNode.
- The adapter-facing prompt includes enough plan context to follow the node
  without needing to infer the whole workflow from prose.

### Phase 5: RoleCall Tool Events And Dynamic Trace Nodes

Goal: model RoleCalls as runtime tool events that expand trace without changing
the original PlanGraph.

Scope:

- Record a RoleCall tool event when a role-backed assistant output creates a
  RoleCall.
- Link RoleCalls to `planGraphId`, `sourcePlanNodeId`, and `sourceRunId`.
- Create dynamic trace nodes for accepted RoleCalls and their callee TaskRuns.
- Keep the existing RoleCall policy validator and orchestrator as the source of
  truth for acceptance, rejection, approval, waiting, and execution.

Implementation areas:

- `packages/core/src/role-call-output-processor.ts`
- `packages/core/src/role-call-orchestrator.ts`
- `packages/core/src/role-call-context.ts`
- `packages/task-runner/src/role-call-executor.ts`
- `tests/role-call-orchestrator.test.ts`
- `tests/role-call-executor.test.ts`

Trace mapping:

- `RoleCallToolEvent` is created from the source run and source plan node.
- Accepted executable RoleCalls create dynamic trace nodes.
- Rejected, waiting, deferred, and failed RoleCalls remain tool events and
  deviation/evidence entries even when no callee run starts.
- Callee runs receive the same PlanGraph plus their dynamic trace node context.

Tests:

- RoleCall creation links back to source plan node.
- Accepted RoleCalls create dynamic trace nodes.
- Rejected/waiting RoleCalls do not mutate PlanGraph.
- Existing RoleCall depth, duplicate, and dangerous-command policy tests remain
  valid.

Exit criteria:

- The original PlanGraph remains unchanged after RoleCalls.
- Trace can explain which plan node emitted each RoleCall.
- Dynamic RoleCall work is visible without rewriting planned nodes or edges.

### Phase 6: ExecutionTraceGraph Projection And Inspection

Goal: derive a stable runtime overlay from persisted evidence.

Scope:

- Add a core read-model builder that returns `ExecutionTraceGraph`.
- Project base PlanGraph nodes and edges plus dynamic trace nodes, edges,
  evidence links, deviations, and status summaries.
- Add read-only CLI inspection for execution trace.
- Add legacy fallback for tasks with runs/RoleCalls but no PlanGraph.

Implementation areas:

- `packages/core/src/execution-trace-read-model.ts`
- `packages/core/src/tui-read-model.ts`
- `apps/cli/src/cli.ts`
- `tests/tui-read-model.test.ts`
- `tests/cli.test.ts`

CLI additions:

```sh
agent-hub execution-trace show --task-id <task-id> [--json]
agent-hub execution-trace show --plan-graph-id <plan-graph-id> [--json]
```

Projection rules:

- Base nodes are PlanNodes.
- Dynamic nodes come from trace nodes and accepted RoleCall work.
- Evidence links point to run ids, artifact ids, verification ids, risk ids,
  memory proposal ids, and review decision ids.
- Deviations are deterministic: skipped required node, unplanned RoleCall,
  failed required node, blocked manual node, missing verification, or superseded
  plan version.

Tests:

- Projection tests for plan-only, plan-plus-run, plan-plus-RoleCall, failure,
  and legacy no-plan states.
- CLI JSON stability tests.
- Tests proving trace projection does not call an LLM.

Exit criteria:

- ExecutionTraceGraph can be built from local persisted evidence only.
- Plan-only tasks and dynamic RoleCall tasks both render useful trace data.
- Legacy tasks remain inspectable.

### Phase 7: TUI Graph Modes

Goal: expose Plan, Trace, and Overlay views in the terminal workbench.

Scope:

- Replace the RoleCall-only Graph pane with mode-aware Plan/Trace/Overlay
  rendering.
- Reuse existing side navigation, detail rail, selection state, fold state, and
  command hints.
- Add deterministic terminal DAG rendering for bounded graph sizes.
- Keep narrow terminals readable with a compact list fallback.

Implementation areas:

- `apps/cli/src/tui-ink/App.mts`
- `apps/cli/src/tui-ink/state.mts`
- `apps/cli/src/tui-ink/graph-layout.mts`
- `packages/core/src/tui-read-model.ts`
- `tests/cli-tui-ink.test.mts`
- `tests/tui-read-model.test.ts`

TUI behavior:

- `Plan` mode shows planner and planned execution nodes.
- `Trace` mode shows runtime nodes and evidence.
- `Overlay` mode shows planned nodes plus dynamic nodes and deviations.
- Selected node detail shows plan fields or trace evidence depending on node
  type.
- RoleCall tool events appear as runtime edges/events, not as PlanGraph edges.

Tests:

- Renderer tests for Plan/Trace/Overlay at 80, 120, and wide terminal widths.
- Interaction tests for mode switching, selection movement, folding, and detail.
- Snapshot tests for empty, planner-failed, plan-only, and RoleCall-expanded
  states.

Manual verification:

- Rebuild CLI.
- Run `agent-hub tui --once`.
- Launch interactive TUI in a PTY.
- Verify Graph mode switching, selection, detail, folding, composer behavior,
  and narrow-terminal fallback.
- Write the manual TUI note under `docs/ui-verification/` and keep it
  untracked.

Exit criteria:

- Graph is useful before RoleCalls exist.
- Graph can explain both expected workflow and actual execution.
- Existing TUI focus, composer, and detail behavior remains intact.

### Phase 8: Desktop Graph Read Model Consumption

Goal: let desktop use the same local graph read models without adding renderer
orchestration.

Scope:

- Expose PlanGraph and ExecutionTraceGraph through Electron main-process
  services and preload IPC.
- Add desktop inspector/read-only graph panes when the UI is ready.
- Keep the renderer sandboxed and free of direct SQLite, filesystem, shell, or
  git access.

Implementation areas:

- `apps/desktop/electron/services/`
- `apps/desktop/preload/`
- `apps/desktop/src/`
- `tests/desktop-services.test.ts`

Tests:

- IPC/service tests for plan graph and trace reads.
- Renderer component tests where practical.
- Manual desktop UI verification when visible desktop UI changes land.

Exit criteria:

- Desktop reads the same core graph projections as CLI/TUI.
- Desktop does not duplicate TaskRunner or RoleCall orchestration logic.

### Phase 9: Agent-Backed Planner And Plan Amendments

Goal: make planning smarter without compromising auditability.

Scope:

- Allow `@planner` to run through a controlled local agent adapter when
  configured.
- Validate structured planner output before activation.
- Support proposed plan amendments and versioned supersession.
- Require explicit policy gates for activating amendments that change required
  execution nodes.

Implementation areas:

- `packages/agent-adapters/`
- `packages/task-runner/src/task-runner.ts`
- `packages/core/src/plan-graph-planner.ts`
- `packages/core/src/plan-graph-amendments.ts`
- `tests/process-adapters.test.ts`
- `tests/task-runner.test.ts`

Planner mode:

- `agent_adapter`: default for real runs, local-only, worktree-isolated,
  adapter-selectable, and validated through structured output. The planner
  prompt, persona, role metadata, and output contract are system-generated and
  not user-customizable.

Amendment rules:

- Amendments create a new PlanGraph version.
- Old graph versions remain inspectable.
- Runs and RoleCalls keep the graph version that was active when they started.
- A proposed amendment does not become active until validation and policy gates
  pass.

Tests:

- Agent-backed planner happy path with fake adapter.
- Invalid planner JSON rejection.
- Amendment versioning and supersession.
- Trace overlay across superseded graph versions.

Exit criteria:

- Agent-backed planning is optional and local.
- Plan changes are versioned, inspectable, and policy-checked.
- No amendment rewrites old execution evidence.

### Phase 10: Policy Hardening And Review Workflows

Goal: turn plan/trace evidence into reviewable governance without adding
automatic acceptance.

Scope:

- Add plan-aware risk findings.
- Add review surfaces for deviations.
- Add memory proposal evidence links back to plan and trace nodes.
- Add comparison support for two runs or two graph versions when useful.

Implementation areas:

- `packages/safety/`
- `packages/task-runner/`
- `packages/core/src/tui-read-model.ts`
- CLI review commands
- desktop review services

Policy checks:

- required verification node missing;
- required node skipped;
- unplanned RoleCall with high-risk task;
- failed required node without fallback;
- planner output asks for prohibited side effects;
- amendment changes required work without approval.

Tests:

- Safety scanner tests for plan-aware findings.
- Review command tests for deviation evidence.
- TUI/desktop read-model tests for plan-aware risk summaries.

Exit criteria:

- Plan and trace evidence improves review without merging, pushing, applying,
  approving memory, or cleaning worktrees automatically.
- Blocking risk can stop automatic acceptance paths exactly as current safety
  policy expects.

## Acceptance Criteria

The first implementation is product-complete when:

- a task has an active PlanGraph before the first implementation run starts;
- the planner itself is represented as a graph node with inspectable input,
  output, status, and failure evidence;
- each executable PlanNode can be scheduled as a primary TaskRun, and its run
  result is linked back to that node;
- the run prompt includes the active plan and current node;
- RoleCalls created during execution link back to the source plan node;
- RoleCall is recorded as a tool event and produces dynamic trace nodes rather
  than mutating the original PlanGraph;
- the trace can be derived without asking an LLM to reconstruct it;
- ExecutionTraceGraph can be rendered as an overlay of PlanGraph plus dynamic
  runtime nodes and evidence;
- Graph can show a task with no RoleCalls by displaying its PlanGraph;
- Graph can show a task with RoleCalls by displaying ExecutionTraceGraph;
- unplanned RoleCalls or skipped nodes are marked as deviations;
- all behavior remains local-first and worktree-isolated;
- docs and tests distinguish current implementation from planned capability.

## Follow-On Decisions

- `@planner` remains a system role shown in plan evidence by default, not a
  normal team role.
- Direct `@codex` or `@claude` runs bind to PlanGraph evidence without
  inventing a collaboration role unless the caller selected one.
- Adapter-authored `PlanNodeResult` fields remain a future extension; current
  progression uses persisted run metadata, verification, risk, trace evidence,
  and deviations.
- Plan amendments require explicit activation approval when required execution
  nodes change.
- Default run output stays concise; full PlanGraph and ExecutionTraceGraph
  details live in inspection commands, TUI Graph modes, and the desktop Trace
  inspector tab.
