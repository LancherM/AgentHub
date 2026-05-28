# Adaptive Role Calls Implementation Roadmap

Status: planning
Last updated: 2026-05-28

This roadmap turns `docs/adaptive-role-calls.en.md` into an implementation
sequence for Agent Hub. The target is a complete product architecture, not a
throwaway MVP: roles can dynamically collaborate through structured intents,
the Orchestrator owns execution reality, every RoleCall is auditable, each role
has a todo ledger, and the main conversation remains quiet while deeper role
graph evidence stays available behind review surfaces.

The work should land as small vertical slices, but each slice must preserve the
long-term contracts: custom roles, role-specific delegation policy, callee
intake policy, role-call DAGs, deferred/rejected work, local TaskRunner-backed
execution, and collapsed UI evidence.

## Product Target

Adaptive Role Calls should let Agent Hub answer a user goal through dynamic
role collaboration without becoming either a free-form multi-agent chat room or
a rigid workflow template.

The desired runtime loop is:

```text
role output
-> structured RoleIntent
-> Orchestrator validation
-> RoleCall + RoleCallEvent + optional RoleTodo
-> callee intake decision
-> execute, defer, reject, request context, or request approval
-> RoleResult / decision event / todo update
-> caller context reinjection
-> final user-facing answer or next role intent
```

The user-facing desktop surface should stay simple:

```text
assistant answer
compact role status chips
blocking approvals
collapsed "role details" affordance
```

The audit surface should expose the full graph:

```text
RoleCall DAG
RoleTodo lists
RoleCallEvents
RoleResult JSON
linked TaskRunner runs
commands, files, risks, evidence
```

## Guardrails

- Keep Agent Hub CLI-first and local-first.
- Do not add a hosted backend, login, cloud sync, remote task execution, or a
  browser-only architecture.
- Keep the desktop renderer sandboxed. No renderer Node.js, filesystem, Git,
  SQLite, shell, or child-process access.
- Keep privileged orchestration in shared local packages and Electron
  main-process services.
- Do not reuse the generic desktop mention fan-out parser for RoleCall parsing.
- Do not model Orchestrator as a visible role, persona, or `@orchestrator`
  target.
- Do not hard-code concrete role relationships into the Orchestrator. It should
  hard-code validation and scheduling algorithms, while reading role manifests,
  project policy, executor capabilities, and approval state.
- Do not rely on prompt text alone for permissions.
- Do not automatically merge, push, create PRs, approve memory, export repo
  context, or write context files to a repository root.
- Do not read or expose `.env`, private keys, tokens, or credential files.
- Keep RoleCall graph, todo, event, command, file, risk, and raw evidence
  collapsed outside the main conversation by default.
- Every behavior or architecture change must update `docs/product.md` and
  `docs/architecture.md`.
- Every desktop UI phase must rebuild the desktop app, verify the affected
  workflow in the running UI, and write a local UI verification summary.

## Architecture Shape

### Shared/Core Domain

Add stable domain contracts for:

- `RoleDefinition`
- `RoleIntent`
- `RoleCall`
- `RoleCallDecision`
- `RoleCallEvent`
- `RoleTodo`
- `RoleResult`
- `PermissionSet`
- `DelegationPolicy`
- `IntakePolicy`
- `RoleExecutionPolicy`
- `RoleCallContext`

These should live in the shared/core boundary where CLI, desktop main process,
TaskRunner integration, tests, and future services can reuse them.

### Persistence

Add local SQLite persistence for:

- role calls
- role call events
- role todos
- optional role-call-to-run linkage

The initial tables should be first-class once queries need them. Do not hide
RoleCall state inside generic message metadata if lifecycle, graph traversal,
todo updates, or audit views need direct access.

### Orchestrator

The Orchestrator is a deterministic runtime service. It should:

- parse RoleIntent records and line-start role-call syntax
- validate caller delegation policy
- validate callee intake policy
- enforce project-level policy
- enforce depth, concurrency, cycle, duplicate, and todo-capacity limits
- build compact RoleCallContext
- create RoleCall, RoleCallEvent, and RoleTodo records
- schedule intake and execution
- validate RoleResult JSON
- inject decisions/results/todos back into caller context

It should not:

- produce user-facing analysis text
- appear as a mention target
- bypass TaskRunner for code-agent execution
- bypass local persistence
- embed role-specific workflow order such as analyst -> operator -> reviewer

### Executors

Role executors are behind role definitions:

```ts
type RoleExecutor =
  | { kind: "agent_adapter"; adapter: "codex" | "claude-code" | "fake" }
  | { kind: "local_workflow"; workflowId: string }
  | { kind: "human" }
  | { kind: "llm_api"; modelRef: string };
```

The roadmap should start with `agent_adapter` and local deterministic helpers.
Reserved executors can be represented in policy and UI, but must not create
hidden remote execution or external side effects.

## Phase Sequence

| Phase | Theme | UI Impact | Primary Outcome |
| --- | --- | --- | --- |
| ARC-0 | Roadmap and prompt planning | No | Implementation plan and local phase prompts |
| ARC-1 | Domain contracts and validators | No | Shared types and validation for RoleCall objects |
| ARC-2 | SQLite repositories and migrations | No | Durable RoleCall, RoleCallEvent, and RoleTodo storage |
| ARC-3 | Parser and policy engine | No | Structured intent parsing and deterministic authorization |
| ARC-4 | Orchestrator ledger runtime | Conditional | RoleCall creation, intake decisions, events, and todos without full agent execution |
| ARC-5 | Context and structured output protocol | No | Compact RoleCallContext, prompts, and RoleResult schema |
| ARC-6 | TaskRunner-backed role execution | Conditional | Executable role calls link to local runs and persist structured results |
| ARC-7 | Caller reinjection and graph convergence | Conditional | Decisions, deferrals, todos, and results influence caller follow-up |
| ARC-8 | Collapsed desktop role-call UI | Yes | Main conversation stays quiet; role graph and todos live in inspector |
| ARC-9 | CLI review and audit parity | No | CLI can inspect role calls, todos, events, and linked evidence |
| ARC-10 | Governance hardening and end-to-end validation | Conditional | Product-grade policy, approval, safety, and regression coverage |

## Phase ARC-0: Roadmap and Prompt Planning

### Goal

Create the durable implementation roadmap and a local prompt companion that
future agents can execute phase by phase.

### Scope

- Add this roadmap.
- Create `docs/adaptive-role-calls-implementation-prompts.md` as a local
  implementation prompt artifact.
- Cross-link the roadmap from product and architecture docs.
- Keep the prompt companion ignored by git unless explicitly published.

### Acceptance Criteria

- Roadmap exists in `docs/adaptive-role-calls-implementation-roadmap.md`.
- Local prompt companion exists at
  `docs/adaptive-role-calls-implementation-prompts.md`.
- `docs/product.md` and `docs/architecture.md` mention the roadmap.
- No runtime code changes are made.
- `git diff --check` passes.

## Phase ARC-1: Domain Contracts and Validators

### Goal

Add stable TypeScript contracts and validation for Adaptive Role Calls without
changing runtime behavior.

### Scope

- Define RoleCall domain types in shared/core boundaries.
- Add runtime validators for role call status, role intent shape, role call
  decisions, role todos, role call events, and role results.
- Add state-transition validation for RoleCall and RoleTodo.
- Keep existing workgroup role contracts compatible.
- Avoid colliding with the existing `ContextPack` type; use `RoleCallContext`.

### Non-Goals

- No SQLite migration yet.
- No orchestrator service yet.
- No desktop UI yet.
- No agent execution changes.

### Acceptance Criteria

- Domain validators reject malformed decisions, todos, events, and results.
- Domain validators enforce conservative custom-role defaults.
- Unit tests cover valid and invalid RoleCall, RoleCallDecision, RoleTodo, and
  RoleResult examples.
- Product and architecture docs reflect any contract changes.

## Phase ARC-2: SQLite Repositories and Migrations

### Goal

Persist role calls, events, and todos as first-class local audit records.

### Scope

- Add SQLite migrations for `role_calls`, `role_call_events`, and `role_todos`.
- Add repositories and in-memory test repositories where needed.
- Store JSON fields with `json_valid` checks.
- Link RoleCalls to `conversation_messages`, `conversation_threads`, and
  optional `task_runs`.
- Add list/query methods for thread, role, parent call, status, and todo state.

### Non-Goals

- No real role execution.
- No UI beyond possible service tests.
- No migration of existing workgroup assignment metadata.

### Acceptance Criteria

- SQLite tests verify schema columns, JSON validation, create/update/list
  behavior, and cascade or set-null semantics.
- Repository methods preserve timestamps and status transitions.
- Existing SQLite migrations still run against empty and upgraded databases.

## Phase ARC-3: Parser and Policy Engine

### Goal

Turn role output into structured intents and determine whether a RoleCall is
allowed without relying on model judgment.

### Scope

- Implement a dedicated RoleCall parser for line-start mentions.
- Ignore mentions inside fenced code blocks.
- Ignore unknown roles or return non-blocking validation warnings.
- Add a policy validator for caller `delegationPolicy`, callee `intakePolicy`,
  project limits, executor capability, depth, concurrency, cycles, duplicate
  calls, todo capacity, and approval requirements.
- Reuse existing safety dangerous-command detection and extend missing patterns
  when role-call policy needs them.

### Non-Goals

- Do not reuse broad composer mention fan-out parsing.
- Do not execute calls yet.
- Do not create desktop UI yet.

### Acceptance Criteria

- Parser tests cover line starts, indentation, code fences, unknown roles,
  duplicate mentions, and multiline tasks.
- Policy tests cover a custom `@qa -> @analyst` allowed case and a default
  `@random -> @analyst` denied case.
- Policy tests cover approval-required and blocked dangerous-command cases.

## Phase ARC-4: Orchestrator Ledger Runtime

### Goal

Introduce the Orchestrator as a local service that owns RoleCall creation,
intake decisions, events, and todo updates without full agent execution.

### Scope

- Add a shared/main-process Orchestrator service boundary.
- Convert valid RoleIntent records into persisted RoleCalls.
- Create RoleCallEvents for creation, assessment, acceptance, deferral,
  rejection, context requests, approval requests, and todo updates.
- Support deterministic fake intake decisions for tests.
- Create/update RoleTodo records for accepted, deferred, rejected, succeeded,
  cancelled, and blocked work.
- Keep caller awareness by producing compact decision summaries.

### Non-Goals

- No real Codex/Claude role execution yet.
- No desktop graph UI yet.
- No autonomous background loops.

### Acceptance Criteria

- Tests prove Orchestrator creates a RoleCall and event records from a valid
  intent.
- Tests prove deferred calls create deferred callee todos.
- Tests prove rejected calls are visible to the caller and are not treated as
  failed execution.
- Tests prove depth/cycle/duplicate guards prevent runaway graphs.

## Phase ARC-5: Context and Structured Output Protocol

### Goal

Define how each role receives compact context and how executable roles return
validated structured output.

### Scope

- Add `RoleCallContextBuilder`.
- Include user goal, current plan, constraints, relevant files, previous role
  results, caller todo state, callee todo state, and repo state.
- Add role system prompts for analyst, operator, reviewer, and custom roles.
- Add JSON schema or strict validator for `RoleCallDecision` and `RoleResult`.
- Persist bounded raw output only for invalid-result audit.
- Keep full run evidence out of main conversation messages.

### Non-Goals

- No UI graph yet.
- No memory approval or approved-memory writeback.
- No whole-thread context injection.

### Acceptance Criteria

- Tests prove RoleCallContext excludes unrelated role chatter and raw run logs.
- Tests prove invalid RoleResult JSON marks the call failed with audit evidence.
- Tests prove decision/result summaries are compact enough for caller
  reinjection.

## Phase ARC-6: TaskRunner-Backed Role Execution

### Goal

Execute accepted role calls through local Agent Hub executors while preserving
worktree isolation, safety scanning, and run evidence.

### Scope

- Map executable RoleCalls to existing TaskRunner runs.
- Link RoleCall rows to `task_runs`.
- Inject role instructions, RoleCallContext, permission summary, expected output
  schema, and todo state into the run.
- Enforce local safety: worktree cwd, no dangerous permission bypass flags, no
  repo-root context writes, dangerous command policy, no automatic push/merge.
- Capture run events, verification, diff, risk, and artifacts through existing
  evidence services.
- Extract and validate RoleResult from the callee output.

### Non-Goals

- No remote execution.
- No automatic approval of dangerous shell or file writes.
- No UI apply/merge flow.

### Acceptance Criteria

- Accepted operator/reviewer RoleCalls can run through fake adapter in tests.
- Process-backed adapters fail inspectably when unavailable.
- RoleCall status tracks queued/running/succeeded/failed/cancelled.
- Linked run evidence remains inspectable through existing review services.

## Phase ARC-7: Caller Reinjection and Graph Convergence

### Goal

Let caller roles observe callee decisions and results, then continue planning or
produce a final user-facing answer.

### Scope

- Inject RoleCallDecision, RoleResult, RoleTodo, and RoleCallEvent summaries
  into caller context.
- Keep rejected/deferred decisions as normal collaboration state.
- Add graph convergence rules: no pending/running calls, no blocking approvals,
  or caller final answer.
- Add bounded continuation for parent roles.
- Avoid recursive free-form role chat.

### Non-Goals

- No unlimited autonomous background execution.
- No hidden follow-up runs after the user leaves the turn.
- No direct role-to-role message channel.

### Acceptance Criteria

- Tests prove caller receives deferred/rejected summaries.
- Tests prove operator can defer reviewer work into todo and caller can replan.
- Tests prove graph execution stops at policy limits or final answer.

## Phase ARC-8: Collapsed Desktop Role-Call UI

### Goal

Expose role collaboration clearly without cluttering the main conversation.

### Scope

- Add compact main-transcript affordances such as
  `3 role calls · 1 deferred · review needed`.
- Add inspector/drawer views for RoleCall graph, RoleCallCard, RoleTodoPanel,
  event stream, linked run evidence, commands, files, risks, and raw JSON.
- Keep DAG, todo, event, command, file, risk, and raw evidence collapsed by
  default.
- Add retry/cancel/approval placeholders without implementing unsafe automatic
  side effects.
- Preserve existing room transcript and run-card behavior.

### UI Gate

This phase changes desktop UI. Generate design artifacts and screenshots before
production code changes. Then rebuild the desktop app, open the running UI,
verify affected workflows manually, write a local UI verification summary under
`docs/ui-verification/`, and include the summary path in the final report.

### Acceptance Criteria

- Main transcript remains concise.
- RoleCall details are one interaction away in a review surface.
- Deferred/rejected/todo states are visible in details without reading raw logs.
- Renderer never reads SQLite, filesystem, shell, or git directly.

## Phase ARC-9: CLI Review and Audit Parity

### Goal

Make RoleCall evidence inspectable from CLI without requiring desktop.

### Scope

- Add CLI read commands for role calls, role todos, and role events.
- Provide concise summaries and optional JSON output.
- Link RoleCalls to existing `runs events`, `runs diff`, `runs show`, and
  `risks show` commands where a TaskRunner run exists.
- Keep CLI normal run output human-facing and quiet.

### Non-Goals

- No CLI automatic approval of unsafe actions.
- No role graph rendering dependency on desktop.

### Acceptance Criteria

- CLI tests cover listing RoleCalls by thread/status/role.
- CLI output distinguishes rejected/deferred from failed execution.
- JSON output is stable enough for local scripting.

## Phase ARC-10: Governance Hardening and End-to-End Validation

### Goal

Harden the full Adaptive Role Calls loop for product-grade use.

### Scope

- Add end-to-end tests for analyst -> operator -> reviewer flows.
- Add custom role authorization tests.
- Add approval-required tests for file writes, shell, network, and high-risk
  targets.
- Add cancellation and retry tests.
- Add duplicate suppression and todo-capacity tests.
- Add docs for operational limits and known non-goals.

### Acceptance Criteria

- Full relevant test suite passes.
- Typecheck and lint pass.
- Dangerous command handling is covered.
- Desktop UI verification exists for role-call UI flows.
- Product and architecture docs match runtime behavior.

## Implementation Prompt Companion

The local prompt companion for this roadmap lives at:

```text
docs/adaptive-role-calls-implementation-prompts.md
```

That file is intentionally ignored by git because implementation prompt
documents are local planning artifacts in this repository. Do not commit or push
it unless the user explicitly asks to publish implementation prompts.

