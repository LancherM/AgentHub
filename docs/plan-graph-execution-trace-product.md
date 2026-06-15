# PlanGraph And ExecutionTraceGraph Product Spec

Status: planned product slice. This document describes the target behavior
against the current Agent Hub implementation. It does not describe an existing
shipped runtime path yet.

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
- `system`: Agent Hub executes the node through a local system path, such as a
  deterministic MVP planner.
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

MVP behavior can use a deterministic local planner implementation while still
recording the product role as `planner`. This keeps tests stable and avoids
making every run depend on an additional agent call. Later, an executable
agent-backed planner can be added behind the same contract.

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
2. Agent Hub schedules the PlannerNode run or deterministic system planner.
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

## Rollout Plan

### Phase 1: Product Contract And Read Model

- Add shared PlanGraph/PlanNode/PlanEdge types and validators.
- Add deterministic local planner output for common task shapes.
- Persist PlanGraph records, including the planner node.
- Add read-only CLI inspection.
- Keep TUI rendering unchanged except for copy that distinguishes planned graph
  from existing RoleCall trace.

### Phase 2: Runtime Injection And Linkage

- Include active PlanGraph and current plan node in role-backed runtime
  injection.
- Schedule executable PlanNodes as primary TaskRuns.
- Record `planGraphId` and `planNodeId` on run metadata and RoleCalls.
- Record RoleCalls as runtime tool events with dynamic trace-node links.
- Add plan-node result metadata where adapters provide structured output.
- Build ExecutionTraceGraph projection from runs, RoleCalls, events, and
  artifacts.

### Phase 3: TUI Graph Upgrade

- Replace the current RoleCall-only Graph pane with Plan, Trace, and Overlay
  modes.
- Render deterministic terminal DAG nodes and edges.
- Reuse existing selected-detail payloads and navigation state.
- Add narrow-terminal fallback and renderer tests.

### Phase 4: Agent-Backed Planner And Amendments

- Allow `@planner` to run through a controlled local executor when configured.
- Validate structured planner output before execution starts.
- Add plan amendment and version history.
- Mark deviations and superseded graph versions in the overlay.

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

## Open Decisions

- Should `@planner` be visible in the team role list by default, or remain a
  system role shown only in plan evidence?
- Should direct `@codex` or `@claude` runs receive a synthetic execution role
  for plan binding?
- Which plan node result fields should be required from adapters before the
  product can enforce plan progression?
- Should plan amendments require explicit user approval, or can a role create a
  proposed amendment that remains inactive until accepted?
- How much of PlanGraph should be shown in default run output versus only in
  Graph and inspection commands?
