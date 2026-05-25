# Local AI Workgroup Roadmap

Status: planning
Last updated: 2026-05-25

This document defines the staged plan for evolving Agent Hub from a
CLI-first coding-agent orchestrator into a local-first AI workgroup. The plan
uses the current codebase shape as the baseline: durable conversation threads,
desktop run cards, TaskRunner-backed runs, SQLite persistence, review
evidence, risk reports, verification results, and memory proposals already
exist. The roadmap intentionally reuses those surfaces before adding new
domain tables.

The target product shape is:

> Agent Hub is a local-first AI workgroup. Users work in project rooms, mention
> role-based participants, assign research, writing, analysis, engineering,
> review, operations, and custom work, and keep every message, run, artifact,
> check, risk, decision, and memory proposal on an auditable local timeline.

The phase list below is the first productization wave, not the full product
ceiling. Each phase should land as a small, verifiable slice, but the underlying
contracts should leave room for richer roles, executor types, workflows,
artifacts, knowledge systems, packs, optional sync, and multi-person review
without forcing a rewrite.

The companion near-term interaction plan lives in
`docs/interaction-optimization-roadmap.md`. Use it when a phase needs to reduce
visible complexity, improve the room transcript, clarify project/room creation,
govern room shared context, add global skill scope, or polish composer,
run-card, inspector, empty-state, preference, and keyboard workflows.

## Guardrails

- Keep Agent Hub CLI-first and local-first.
- Do not add a hosted backend, login, cloud sync, remote task execution, or a
  browser-only architecture.
- Keep the desktop renderer sandboxed. No renderer Node.js, filesystem, Git,
  SQLite, shell, or child-process access.
- Keep orchestration in shared packages and Electron main-process services.
- Do not automatically merge, push, open PRs, publish externally, approve
  memory, or write repository context files.
- Reuse existing `ConversationThread`, `ConversationMessage`, `TaskRunner`,
  run evidence, review artifacts, risk reports, verification results, and
  memory items before introducing larger domain splits.
- Every behavior change must update `docs/product.md` and
  `docs/architecture.md`.
- Every implementation phase must include focused tests and the most relevant
  validation commands.
- Prefer extension points over closed enums when the concept is likely to grow:
  roles, executors, artifacts, checks, risks, packs, approvals, and workflows
  should have stable contracts and metadata escape hatches.
- Keep long-term optional capabilities behind explicit local-first boundaries.
  Future sync, collaboration, publishing, external integrations, or hosted
  components must not become prerequisites for local single-user operation.

## Strategic Horizons

Agent Hub should evolve in horizons. The early phases make the workgroup loop
real; later horizons broaden what participants can be, what they can produce,
and how teams can govern or extend the system.

| Horizon | Product Shape | Architecture Emphasis |
| --- | --- | --- |
| H0: Current foundation | CLI-first local agent runs, desktop conversation shell, run evidence, risk, verification, memory proposals | Preserve TaskRunner, context compiler, SQLite repositories, IPC sandbox |
| H1: Workgroup loop | Rooms, custom role participants, task grouping, structured timeline, inspector, artifacts, memory governance | Layer semantics on conversation/run evidence before broad schema splits |
| H2: Configurable team platform | User-defined roles, executor bindings, permissions, context policies, approval policies, workflow templates | First-class role/executor/config repositories and clear runtime capability checks |
| H3: Extensible work system | Workflow executors, LLM API executors, human assignments, artifact stores, pack-defined checks/risks/artifacts | Plugin-like internal extension contracts without untrusted marketplace execution |
| H4: Optional collaboration and sync | Multi-device or team review, shared audit trails, external publishing gateways | Optional sync/collaboration adapters that preserve local-first offline operation |

The roadmap should not overbuild H3/H4 in the first pass, but each earlier
phase should avoid decisions that would block those horizons. For example,
roles should not be hard-coded as a fixed agent enum, packs should not assume
only engineering work, and timeline events should not depend on raw chat text
as their only durable representation.

## Extension Architecture Principles

### Roles and Participants

Roles are configurable participant profiles. Preset roles are templates, not a
closed product boundary. A role should support:

- handle and display identity
- capability summary
- persona and default instructions
- permission policy
- context policy
- approval policy
- executor binding
- default room/task behavior
- tags and pack affinities
- local audit metadata

The long-term participant model should allow:

- AI agents backed by local adapters
- direct LLM API-backed roles
- local workflow-backed roles
- human assignees or reviewers
- external integration placeholders that require explicit approval before any
  side effect

### Executors

Executors are the runtime backends behind roles. The initial runnable executor
is `agent_adapter`, but the contract should leave space for:

- `agent_adapter`: current fake, Codex, and Claude Code adapters
- `llm_api`: future direct model or API execution
- `workflow`: future local deterministic workflow or script execution
- `human`: future manual assignment, review, or approval owner
- `integration`: future explicit external system action gateway

Every executor should advertise capabilities, required approvals, allowed
context, side-effect class, cancellation behavior, evidence outputs, and audit
events. Executor configuration must never store secrets in SQLite; secret
material should stay in explicit external credential mechanisms if such
integrations are later designed.

### Workflows

Workflows should be first-class plans over tasks, roles, executors, artifacts,
checks, approvals, and timeline events. Early workflows can be metadata-backed,
but long-term workflows should support:

- templates
- bounded rounds
- dependency ordering
- human approval gates
- retry and handoff rules
- generated artifacts
- checks and risk policies
- local audit replay

Workflow execution must stay bounded and inspectable. Agent-to-agent or
participant-to-participant loops require max rounds and clear stop conditions.

### Artifacts and Knowledge

Artifacts should eventually become project-level reusable objects, not only
run blobs. The long-term artifact model should support:

- source links to room messages, tasks, runs, participants, and decisions
- type-specific metadata
- local previews
- versioning
- lifecycle status
- pack-defined artifact types
- export or publish gates

Knowledge should remain governed:

- thread summaries stay local to their source room/thread
- proposals require approval
- approved memory has scope
- decisions are source-linked and auditable
- future indexes or embeddings are local-first and rebuildable

### Packs and Extensions

Packs should define local metadata and behavior templates before they ever
become a marketplace concept. A pack can contribute:

- role templates
- artifact type definitions
- check definitions
- risk categories
- workflow templates
- context section providers
- UI labels or grouping metadata

Pack loading should begin with built-in deterministic packs. Third-party or
marketplace-style extensions are a later product decision, not a near-term
dependency. If external extensions are added, they must run with explicit local
permissions, strong audit trails, and no ambient access to secrets or project
files.

### Optional Sync and Collaboration

The product may eventually support multi-device sync or team review, but those
features must be optional adapters over the local model:

- local project data remains usable offline
- no account is required for the core local product
- sync conflict handling is explicit and auditable
- remote execution is not introduced as a side effect of sync
- external publishing remains separately approved

Early schema and service boundaries should therefore avoid assumptions that
only one local UI will ever read data, while still keeping single-user local
operation as the default.

## UI Design Gate

Any phase that changes desktop UI, renderer behavior, visible workflows,
layout, styling, navigation, or inspector panels must be split into two steps:

1. Generate a UI design artifact before changing production code. Acceptable
   artifacts are a static HTML/CSS mockup, a rendered screenshot, or a set of
   screen images saved under `docs/ui-design/`.
2. Proceed with production UI implementation after the design artifact exists.
   Do not stop for user review by default, including future UI phases. Only
   wait for explicit approval when the user asks for a review gate on that
   phase.

The default UI workflow is therefore: produce the UI image first, then implement
the matching production code directly. The UI image is a required implementation
input, not a default manual approval gate.

The implementation prompt for UI phases must explicitly say:

```text
This phase changes desktop UI. First generate UI design artifacts and screenshots
before production code changes. After the artifacts exist, implement the UI to
match the design unless the user explicitly asked for a review stop. Rebuild the
desktop app, open the running UI, verify the affected workflow manually, write a
concise UI verification summary under docs/ui-verification/, and include that
file path in the final summary.
```

## Phase Sequence

| Phase | Theme | UI Gate | Primary Outcome |
| --- | --- | --- | --- |
| 0 | Roadmap and product boundary | No | Shared direction and prompts |
| 1 | Role and executor foundation | Conditional | Custom role handles map to current and future executors |
| 2 | Rooms over conversation threads | Yes | Project rooms replace generic thread UX |
| 3 | Mention-to-task grouping | Conditional | One instruction creates one task with multiple role assignments |
| 4 | Timeline event semantics | Yes | Messages, run cards, and system events render as one audit stream |
| 5 | Structured inspector | Yes | Brief, Context, Artifacts, Checks, Risks, Memory panels |
| 6 | Artifact model v0 | Conditional | Run outputs become reusable local artifacts |
| 7 | Memory and decisions workspace | Yes | Proposals, approved memory, summaries, decisions, and audit are browsable |
| 8 | Team and custom role configuration v0 | Yes | Preset and custom roles with capability, persona, permission, and executor settings |
| 9 | Controlled collaboration workflows | Yes | Handoff, review loop, and panel discussion with bounded rounds |
| 10 | CLI parity for rooms and roles | No | CLI can operate room/role/executor workgroup flows |
| 11 | Pack boundaries | Conditional | Engineering terms move behind pack-specific surfaces |
| 12 | Explicit apply and lifecycle controls | Yes | Apply/merge/worktree cleanup remain human-gated workflows |

## Phase 0: Roadmap and Product Boundary

### Goal

Create the durable plan for the local AI workgroup transformation and align
current product and architecture docs with the staged direction.

### Scope

- Add this roadmap document.
- Link the roadmap from `docs/product.md` and `docs/architecture.md`.
- State that the near-term transformation layers workgroup semantics over the
  existing conversation/run evidence model.
- Preserve all current non-goals.

### Non-goals

- No runtime behavior changes.
- No UI implementation.
- No schema migration beyond documentation.

### Acceptance Criteria

- Roadmap exists in `docs/local-ai-workgroup-roadmap.md`.
- Product and architecture docs mention the roadmap and minimal-adaptation
  strategy.
- Validation passes for docs-only change checks that are practical in the
  current checkout.

### Implementation Prompt

```text
Read AGENTS.md, docs/product.md, docs/architecture.md, and
docs/local-ai-workgroup-roadmap.md. This is a docs-only planning phase.

Create or update the roadmap for evolving Agent Hub into a local-first AI
workgroup while preserving CLI-first/local-first constraints. Do not change
runtime code. Update docs/product.md and docs/architecture.md with a short
cross-reference to the roadmap and the principle that rooms/roles/timeline UI
will reuse existing conversation threads, TaskRunner runs, review evidence,
and memory proposals before adding larger domain splits.

Verify with git diff --check and any lightweight docs checks available. Commit,
push, and open a PR.
```

## Phase 1: Role and Executor Foundation

### Goal

Introduce a generic workgroup role model without replacing the existing adapter
model. Users should be able to mention preset roles such as `@researcher` or
`@engineer`, and the model must also support user-defined handles such as
`@qa`, `@pm`, `@legal`, or `@customer`. A role is a configurable participant
profile, not necessarily an agent. It has capability, persona, instructions,
permissions, context policy, approval policy, and an executor binding. The
first executor type dispatches through existing `fake`, `codex`, or
`claude-code` adapters, while the model reserves space for future LLM API,
workflow, and human executors.

### Current Baseline

- Desktop `AgentId` is currently `fake | codex | claude`.
- Mention parsing recognizes only adapter-like mentions.
- TaskRunner runs adapter kinds, not user-defined workgroup roles.

### Scope

- Add shared role and executor contracts:
  - role id
  - handle
  - display name
  - purpose
  - capability summary
  - persona
  - default instructions
  - permission set
  - context policy
  - approval policy
  - executor kind
  - executor config reference
  - enabled/disabled status
- Define executor kinds as an extensible local enum or discriminated union:
  - `agent_adapter` for the current `fake`, `codex`, and `claude-code` path
  - `llm_api` reserved for future direct model/API-backed roles
  - `workflow` reserved for future local workflow roles
  - `human` reserved for future human participant assignment and review
- Add preset role templates that users can adopt or customize:
  - `researcher`
  - `writer`
  - `analyst`
  - `operator`
  - `reviewer`
  - `engineer`
  - `memory`
- Avoid hard-coding the preset list as the only valid role set.
- Add a default role registry that maps preset roles to:
  - display metadata
  - capability/persona/instruction templates
  - conservative permission summary
- Extend mention parsing so handles are resolved from configured roles, while
  adapter/debug mentions remain supported.
- Persist the role handle and executor metadata in conversation message
  metadata and run metadata.
- Inject role persona, instructions, permissions, and context policy into the
  conversation brief or task-run user constraints.
- Preserve `@fake`, `@codex`, and `@claude` as adapter/debug mentions.

### UI Impact

This phase can be service-only if role metadata is not exposed yet. If the
implementation changes any visible desktop UI, including composer chips,
autocomplete, role labels, participant labels, run cards, or status text, apply
the UI Design Gate before production UI implementation.

### Non-goals

- Do not add full editable role configuration UI yet; that belongs to Phase 8.
- Do not add complex permission enforcement beyond metadata and existing hard
  safety boundaries.
- Do not add new agent adapters.
- Do not change adapter execution semantics.
- Do not implement direct LLM API, workflow, or human executor runtimes yet.

### Acceptance Criteria

- Preset role handles are parsed and deduplicated.
- User-defined role handles are representable in the domain/service contract,
  even if editing those roles lands in Phase 8.
- A mentioned executable role creates a run through its configured executor;
  in this phase, the only runnable executor is `agent_adapter`.
- Persisted records show the role handle separately from the executor kind and
  adapter kind.
- Existing `@fake`, `@codex`, and `@claude` flows still work.
- Tests cover parsing and service dispatch.
- Docs explain role-over-executor and executor-over-adapter separation.

### Implementation Prompt

```text
Read AGENTS.md, docs/product.md, docs/architecture.md, and
docs/local-ai-workgroup-roadmap.md. Implement Phase 1 only.

Introduce a generic workgroup role and executor foundation while preserving the
existing adapter model. A role is a user-facing participant profile with handle,
display name, purpose, capability summary, persona, default instructions,
permission set, context policy, approval policy, enabled status, and executor
binding. The role model must support user-defined handles such as @qa, @pm,
@legal, and @customer, not only preset roles. Add preset role templates for
researcher, writer, analyst, operator, reviewer, engineer, and memory, but do
not hard-code those templates as the only valid roles.

Define executor kinds with an extensible local shape: agent_adapter for the
current fake/codex/claude-code path, plus reserved llm_api, workflow, and human
executor kinds for future phases. In this phase, only agent_adapter needs to be
runnable. Preserve @fake, @codex, @claude, and @claude-code as adapter/debug
mentions. Persist role handle and executor metadata on user messages, run-card
messages, and run creation inputs where appropriate. Dispatch executable role
mentions through the configured executor and inject role persona, instructions,
permissions, and context policy into the generated conversation brief or
TaskRunner constraints without changing adapter execution semantics.

Keep the renderer sandboxed. Route privileged work through existing IPC and
main-process services. Do not add editable role configuration UI, external
services, cloud sync, new adapters, direct LLM API execution, workflow
execution, or human assignment runtime in this phase.

If this phase changes any visible desktop UI, including composer chips,
autocomplete, role labels, participant labels, run cards, or status text, first
generate UI design artifacts and screenshots before production code changes.
After the artifacts exist, implement the UI to match the design unless the user
explicitly asked for a review stop.

Update docs/product.md and docs/architecture.md. Add focused tests for mention
parsing, role resolution, executor dispatch, custom-role shape, and persisted
metadata. Run targeted tests plus pnpm typecheck when practical. Commit, push,
and open a PR.
```

## Phase 2: Rooms over Conversation Threads

### Goal

Turn the current thread-first desktop shell into room-based project navigation
without adding a separate room table yet.

### Current Baseline

- `conversation_threads` already provide project-scoped durable timelines.
- Thread metadata can store room type and room display metadata.
- Desktop sidebar currently lists generic Threads and Projects.

### Scope

- Treat `ConversationThread` as the first room implementation.
- Store `roomType`, `roomHandle`, `description`, and `pinned` in thread
  metadata.
- Create default rooms per project:
  - `#general`
  - `#planning`
  - `#research`
  - `#review`
  - `#knowledge`
- Rename desktop navigation from Threads to Rooms.
- Keep compatibility with older conversation threads by treating them as
  custom rooms.
- Add room creation and selection through existing thread IPC or renamed room
  facade methods.
- Keep CLI `chat` working during the transition.

### UI Impact

This is a UI phase. Apply the UI Design Gate before production UI changes.

### Non-goals

- Do not add `rooms` table yet unless metadata proves insufficient.
- Do not add multi-user membership.
- Do not add unread counts or notifications beyond local activity indicators.
- Do not redesign the whole desktop shell beyond room navigation.

### Acceptance Criteria

- New projects receive default rooms.
- Desktop left sidebar shows Rooms, Team, and project status in a layout
  consistent with the approved design.
- Selecting a room loads the corresponding conversation messages and run cards.
- Legacy threads remain readable.
- CLI chat remains functional.
- Tests cover default room creation and metadata compatibility.
- UI verification summary is saved under `docs/ui-verification/`.

### Implementation Prompt

```text
Read AGENTS.md, docs/product.md, docs/architecture.md, and
docs/local-ai-workgroup-roadmap.md. Implement Phase 2 only.

This phase changes desktop UI. First generate UI design artifacts and screenshots
before production UI changes. The design should show the left sidebar with
project selector, room list, default rooms, team list placeholder, task status
placeholder, and local-first status. It should show the center room timeline
still backed by existing conversation messages and run cards. Save design
artifacts under docs/ui-design/. Proceed with implementation after the
artifacts exist unless the user explicitly asks for a review stop.

Treat ConversationThread as the first Room implementation. Store roomType,
roomHandle, description, and pinned in thread metadata. Seed #general,
#planning, #research, #review, and #knowledge rooms for a project without
breaking older threads. Rename desktop navigation from Threads to Rooms while
keeping existing thread repositories and IPC stable where practical. Add
minimal room creation/selection through the existing service boundary.

Keep orchestration in Electron main-process services and shared packages. Do
not add a cloud backend, account system, room membership, notifications, or a
separate rooms table unless the existing metadata model cannot satisfy the
phase.

Update docs/product.md and docs/architecture.md. Add focused tests for default
room creation, legacy thread compatibility, and room metadata mapping. Rebuild
the desktop app, open the running UI, verify the affected workflow manually,
write docs/ui-verification/<date>-phase-2-rooms.md, and include that file path
in the final summary. Commit, push, and open a PR.
```

## Phase 3: Mention-to-Task Grouping

### Goal

Make one user instruction create one structured task with multiple role
assignments and executable runs, instead of creating unrelated task rows per
participant/run.

### Current Baseline

- `ThreadService.sendMessage()` creates one user message and one run per
  selected executable participant.
- `RunService.createRun()` currently creates a new task for each run.
- `Task` exists but has a small status model.

### Scope

- Add a task creation step before multi-role fan-out.
- Allow `RunService.createRun()` to accept an existing `taskId`.
- Store assignment metadata linking role handles, executor kind, and assignment
  role to the shared task.
- Keep task state narrow at first: `open`, `running`, `completed`,
  `cancelled`.
- Add system timeline messages for task created and participants assigned.
- Show grouped run cards under the same task in the room timeline.

### UI Impact

This phase can be mostly service-level. If the implementation changes any
visible timeline grouping, task labels, run-card grouping, sidebar counts, or
inspector content, apply the UI Design Gate before production UI
implementation.

### Non-goals

- Do not implement the full expanded task state machine yet.
- Do not add kanban board or task room auto-creation.
- Do not implement task acceptance/apply semantics.

### Acceptance Criteria

- A prompt such as `@researcher @qa analyze this` creates one task and linked
  assignments. Executable role assignments create runs; non-executable future
  participant types can remain assigned without a run until their executor
  exists.
- Task metadata includes room/thread id and role assignments.
- Room timeline shows a task-created system event and grouped run cards.
- Existing single-role, custom-role, and adapter-mention flows still work.
- Tests cover shared task creation and run linkage.

### Implementation Prompt

```text
Read AGENTS.md, docs/product.md, docs/architecture.md, and
docs/local-ai-workgroup-roadmap.md. Implement Phase 3 only.

Change mention fan-out so one user instruction creates one task and multiple
role assignments linked to that task. Executable role assignments should create
runs through their configured executor; future non-executable participants can
be represented as assignments without a run. Add the smallest service changes
needed for RunService.createRun to accept an existing taskId. Store room/thread
id, role handle, executor kind, and assignment metadata without introducing a
large task-assignment table unless the current repositories cannot support the
phase safely.

Append system timeline messages for task creation and agent assignment. Keep
task statuses limited to the current model unless a narrow migration is
required. Do not implement kanban, auto task rooms, full task state machine,
merge/apply, or external side effects.

If this phase changes any visible desktop UI, including timeline grouping, task
labels, run-card grouping, sidebar counts, or inspector content, first generate
UI design artifacts and screenshots before production code changes. After the
artifacts exist, implement the UI to match the design unless the user explicitly
asked for a review stop, then complete the desktop verification flow.

Update docs/product.md and docs/architecture.md. Add tests for multi-role
mention grouping, shared task id linkage, executable role dispatch,
non-executable assignment representation where modeled, and existing
single-agent behavior. Run targeted tests plus pnpm typecheck when practical.
Commit, push, and open a PR.
```

## Phase 4: Timeline Event Semantics

### Goal

Make the room timeline feel like an auditable work stream rather than a raw
chat transcript.

### Current Baseline

- `conversation_messages` store user, assistant, system, and run-card rows.
- Run events, risk reports, verification rows, and memory proposals live on the
  run evidence model.

### Scope

- Define timeline event semantics over existing message rows:
  - user message
  - participant message
  - system event
  - task created
  - assignment created
  - run started/completed
  - artifact created
  - check completed
  - risk detected
  - memory proposed
  - review decision
- Store event kind and linked ids in message metadata.
- Render event cards with actor, timestamp, status, linked run/task/artifact,
  and risk/memory chips.
- Preserve raw run evidence behind inspector APIs.

### UI Impact

This is a UI phase. Apply the UI Design Gate before production UI changes.

### Non-goals

- Do not introduce full event sourcing.
- Do not duplicate raw logs, diffs, or verification output into message bodies.
- Do not build global search yet.

### Acceptance Criteria

- Timeline cards render distinct user, participant, system, task, risk, check,
  review, and memory proposal events.
- Clicking a run or event opens the relevant inspector context.
- Full run evidence remains lazy-loaded.
- Event metadata is bounded and safe.
- Tests cover event metadata mapping and rendering decisions.
- UI verification summary is saved.

### Implementation Prompt

```text
Read AGENTS.md, docs/product.md, docs/architecture.md, and
docs/local-ai-workgroup-roadmap.md. Implement Phase 4 only.

This phase changes desktop UI. First generate UI design artifacts and screenshots
before production code changes. The design should show the room timeline as an
audit stream with user messages, role/participant messages, system events,
task-created events, run cards, artifact chips, check chips, risk badges,
review decisions, and memory proposal events. Save design artifacts under
docs/ui-design/, then implement the UI unless the user explicitly asked for a
review stop.

After the artifacts exist, add timeline event semantics over existing
conversation_messages metadata. Do not add a full event-sourcing system. Keep
raw logs, diffs, verification output, and risk evidence on the run evidence
model and load them lazily through review IPC. Render timeline cards according
to event kind and linked ids.

Keep the renderer sandboxed and route all data access through preload/main IPC.
Update docs/product.md and docs/architecture.md. Add focused tests for event
metadata conversion and UI rendering where practical. Rebuild the desktop app,
open the running UI, verify the affected workflow manually, write
docs/ui-verification/<date>-phase-4-timeline.md, and include that file path in
the final summary. Commit, push, and open a PR.
```

## Phase 5: Structured Inspector

### Goal

Replace the run-centric inspector labels with a workgroup inspector organized
around Brief, Context, Artifacts, Checks, Risks, and Memory.

### Current Baseline

- The inspector currently exposes Summary, Diff, Tests, Risk, Memory, and Logs.
- Review data already aggregates run summary, diff, verification, risk, memory
  proposals, and logs.

### Scope

- Convert the desktop inspector into a persistent right-side panel or a drawer
  that follows the approved design.
- Rename core tabs:
  - Summary -> Brief
  - Diff -> Artifacts or Engineering Artifacts
  - Tests -> Checks
  - Risk -> Risks
  - Memory -> Memory
  - Logs -> Audit
- Keep engineering-specific terms inside Engineering Pack sections.
- Add context preview from the persisted `conversation_brief` artifact.
- Show task goal, assignees, acceptance criteria placeholder, and run status in
  Brief.

### UI Impact

This is a UI phase. Apply the UI Design Gate before production UI changes.

### Non-goals

- Do not implement rich artifact editing.
- Do not implement acceptance criteria editing unless it is a small metadata
  field.
- Do not add apply/merge controls.

### Acceptance Criteria

- Inspector tabs match the workgroup vocabulary.
- Existing evidence remains accessible.
- Context tab shows injected conversation brief or a clear unavailable state.
- Checks tab shows verification results.
- Risks tab preserves blocking risk levels.
- Memory tab preserves proposal approval/ignore behavior.
- UI verification summary is saved.

### Implementation Prompt

```text
Read AGENTS.md, docs/product.md, docs/architecture.md, and
docs/local-ai-workgroup-roadmap.md. Implement Phase 5 only.

This phase changes desktop UI. First generate UI design artifacts and screenshots
before production code changes. The design should show a right-side workgroup
inspector with Brief, Context, Artifacts, Checks, Risks, Memory, and Audit tabs.
It should map the current run evidence to the new vocabulary without hiding
important review details. Save design artifacts under docs/ui-design/.

After the artifacts exist, refactor the run inspector UI to match the workgroup
inspector unless the user explicitly asked for a review stop. Use existing
review, memory, risk, verification, diff, and artifact services. Add a Context
tab backed by the persisted conversation_brief run artifact. Keep
engineering-specific labels contained inside the Artifacts or Engineering Pack
section. Do not add apply, merge, push, worktree cleanup, or external publishing
controls.

Update docs/product.md and docs/architecture.md. Add focused renderer/service
tests where practical. Rebuild the desktop app, open the running UI, verify the
affected workflow manually, write docs/ui-verification/<date>-phase-5-inspector.md,
and include that file path in the final summary. Commit, push, and open a PR.
```

## Phase 6: Artifact Model v0

### Goal

Promote important outputs from run evidence into reusable local artifacts
without duplicating every log or diff line.

### Current Baseline

- `run_artifacts` already store `conversation_brief`, `git_diff`,
  `review_decision`, and other per-run artifacts.
- There is no project-level artifact list.

### Scope

- Define an artifact v0 contract that can be backed initially by
  `run_artifacts`.
- Add artifact metadata:
  - title
  - artifact type
  - source run
  - source task
  - room/thread id
  - created by role or participant
  - summary
- List artifacts in the inspector.
- Support artifact chips on timeline events.
- Keep file contents local and bounded.

### UI Impact

This phase can be service-only if artifact metadata is not rendered yet. If the
implementation changes any visible artifact chips, artifact list, timeline
cards, inspector tab content, or preview state, apply the UI Design Gate before
production UI implementation.

### Non-goals

- Do not build artifact versioning.
- Do not implement document editors, spreadsheet editors, or deck editors.
- Do not publish artifacts externally.
- Do not add vector search.

### Acceptance Criteria

- Run outputs can appear as named artifact chips.
- Inspector Artifacts tab lists source, type, summary, and local availability.
- Existing `run_artifacts` remain readable.
- Tests cover artifact metadata mapping and bounded content behavior.

### Implementation Prompt

```text
Read AGENTS.md, docs/product.md, docs/architecture.md, and
docs/local-ai-workgroup-roadmap.md. Implement Phase 6 only.

Add Artifact v0 using the existing run_artifacts repository where practical.
Define a narrow artifact metadata shape with title, type, source run, source
task, room/thread id, created-by role/participant, and summary. Render artifact
chips on timeline events and list artifacts in the inspector. Keep file content
local, bounded, and reviewable. Do not build artifact versioning, rich editors,
external publishing, or search.

If this phase changes any visible desktop UI, including artifact chips,
artifact lists, timeline cards, inspector tab content, or preview states, first
generate UI design artifacts and screenshots before production code changes.
After the artifacts exist, implement the UI to match the design unless the user
explicitly asked for a review stop, then complete desktop UI verification.

Update docs/product.md and docs/architecture.md. Add focused tests for artifact
metadata and existing run_artifact compatibility. Run targeted tests plus pnpm
typecheck when practical. Commit, push, and open a PR.
```

## Phase 7: Memory and Decisions Workspace

### Goal

Provide a Knowledge / Memory workspace that governs proposals, approved memory,
thread summaries, decisions, source links, and audit history.

### Current Baseline

- `memory_items` already support proposed, approved, and rejected states.
- Thread summaries are local and not automatically promoted.
- Review decisions are stored as run artifacts.

### Scope

- Add a Knowledge / Memory screen.
- Show:
  - memory proposals
  - approved memory
  - rejected memory
  - thread summaries
  - review decisions
  - decision-like records
- Add source links back to room messages, tasks, and runs where metadata exists.
- Keep approval explicit and user-gated.
- Optionally model decisions as memory items with metadata first; defer a
  dedicated `decisions` table until source links and filtering prove stable.

### UI Impact

This is a UI phase. Apply the UI Design Gate before production UI changes.

### Non-goals

- Do not auto-approve memory.
- Do not inject proposed or rejected memory into future context packs.
- Do not add embeddings or semantic search.
- Do not add multi-reviewer approval workflow yet.

### Acceptance Criteria

- Knowledge screen lists proposals and approved/rejected memory.
- Memory approval/rejection still updates local SQLite only.
- Thread summaries are visible as thread-local context, not approved memory.
- Decision records are auditable and source-linked where possible.
- UI verification summary is saved.

### Implementation Prompt

```text
Read AGENTS.md, docs/product.md, docs/architecture.md, and
docs/local-ai-workgroup-roadmap.md. Implement Phase 7 only.

This phase changes desktop UI. First generate UI design artifacts and screenshots
before production code changes. The design should show a Knowledge / Memory
workspace with filters for all items, decisions, summaries, proposals, approved
memory, rejected memory, source messages, related tasks/runs, and an audit
panel. Save design artifacts under docs/ui-design/.

After the artifacts exist, implement the Knowledge / Memory workspace using
existing memory_items, conversation_thread_summaries, and review_decision run
artifacts where practical unless the user explicitly asked for a review stop.
Keep memory approval explicit and local. Proposed and rejected memory must never
be injected as approved memory. Thread summaries must remain thread-local unless
explicitly promoted through the memory workflow.

Update docs/product.md and docs/architecture.md. Add focused tests for memory
listing, approval/rejection, thread summary separation, and decision display
mapping. Rebuild the desktop app, open the running UI, verify the affected
workflow manually, write docs/ui-verification/<date>-phase-7-knowledge.md, and
include that file path in the final summary. Commit, push, and open a PR.
```

## Phase 8: Team and Custom Role Configuration v0

### Goal

Let users inspect, create, and edit the local workgroup team. Preset roles
provide a starting point, but users can define custom roles with their own
handle, capability, persona, instructions, permissions, context policy,
approval policy, and executor binding.

### Current Baseline

- Agent profiles exist but are adapter-oriented.
- Phase 1 provides a generic role/executor contract and preset role templates.
- No full UI exists for custom role configuration.

### Scope

- Add Team screen.
- Show preset and user-defined role table:
  - handle
  - display name
  - purpose
  - capability summary
  - persona summary
  - executor kind
  - adapter
  - permission summary
  - context policy summary
  - approval policy summary
  - status
  - recent activity
- Add role profile and edit panels for safe fields:
  - handle
  - display name
  - purpose
  - capability summary
  - persona
  - default instructions
  - permissions
  - context policy
  - approval policy
  - executor kind
  - executor config reference
  - enabled/disabled
  - default room
  - tags
- Persist project-level custom roles and preset overrides locally.
- Keep permission enforcement conservative. Enforce only permissions that map
  to existing hard safety boundaries; store the rest as auditable policy
  metadata until runtime support exists.
- Keep executor support narrow:
  - `agent_adapter` can run through current adapters.
  - `llm_api`, `workflow`, and `human` can be configured or represented only if
    they are clearly marked unavailable/reserved and do not execute yet.

### UI Impact

This is a UI phase. Apply the UI Design Gate before production UI changes.

### Non-goals

- Do not implement untrusted plugin code or arbitrary executable role runtime.
- Do not implement a plugin marketplace.
- Do not allow roles, agents, workflows, or humans to grant themselves
  permissions.
- Do not store secrets in role config.
- Do not execute direct LLM API, workflow, or human assignment backends until
  their runtime phases are explicitly designed.

### Acceptance Criteria

- Team screen lists preset and user-defined roles.
- Users can create and edit local custom roles without writing to the target
  repository.
- Selecting a role shows profile, capability, persona, allowed actions,
  approval requirements, default instructions, executor binding, recent tasks,
  and linked memory where available.
- Executor mapping is clear and local, including reserved unavailable executor
  types when shown.
- Renderer remains sandboxed.
- UI verification summary is saved.

### Implementation Prompt

```text
Read AGENTS.md, docs/product.md, docs/architecture.md, and
docs/local-ai-workgroup-roadmap.md. Implement Phase 8 only.

This phase changes desktop UI. First generate UI design artifacts and screenshots
before production code changes. The design should show a Team / Role
Configuration screen with preset and custom roles, role table, create/edit role
flow, role profile panel, capability summary, persona, permissions summary,
context policy summary, approval policy summary, executor binding, default
instructions, recent tasks, and linked memories. The design must make clear that
a role can be backed by an agent adapter today and may later be backed by LLM
API, workflow, or human executors. Save design artifacts under docs/ui-design/.

After the artifacts exist, implement a Team screen backed by the role/executor
contract and existing local repositories unless the user explicitly asked for a
review stop. Support local creation and editing of custom roles and safe preset
overrides. Validate role config through core validators and main-process IPC. Do
not add plugin marketplace, untrusted runtime code, cloud services, secret
storage, or executable LLM API/workflow/human backends in this phase. Reserved
executor kinds may be displayed or stored only if they are clearly non-runnable.

Update docs/product.md and docs/architecture.md. Add focused tests for preset
role listing, custom role creation/editing, profile mapping, safe settings or
repository persistence, and executor binding validation. Rebuild the desktop
app, open the running UI, verify the affected workflow manually, write
docs/ui-verification/<date>-phase-8-team.md, and include that file path in the
final summary. Commit, push, and open a PR.
```

## Phase 9: Controlled Collaboration Workflows

### Goal

Support bounded multi-participant collaboration modes without allowing infinite
agent-to-agent or participant-to-participant chatter.

### Scope

- Add workflow modes:
  - `handoff`
  - `review_loop`
  - `panel_discussion`
- Each mode must define:
  - participants
  - participant type and executor availability
  - max rounds
  - stop condition
  - expected outputs
  - user-visible summary
- Implement using existing TaskRunner runs, conversation briefs, and optional
  continuation.
- Persist workflow state as task/run/message metadata first.
- Add timeline events for handoff, review requested, review completed, and
  workflow completed.

### UI Impact

This is a UI phase. Apply the UI Design Gate before production UI changes.

### Non-goals

- Do not implement autonomous endless collaboration.
- Do not let agents, workflows, LLM API-backed roles, or human assignments run
  without user-visible task scope.
- Do not add remote queues.
- Do not auto-apply outputs.

### Acceptance Criteria

- User can start a bounded collaboration mode from a room command or UI action.
- Workflow produces visible timeline events and linked runs.
- Max rounds are enforced.
- Review loop does not mutate files outside isolated worktrees.
- UI verification summary is saved.

### Implementation Prompt

```text
Read AGENTS.md, docs/product.md, docs/architecture.md, and
docs/local-ai-workgroup-roadmap.md. Implement Phase 9 only.

This phase changes desktop UI. First generate UI design artifacts and screenshots
before production code changes. The design should show how a user starts a
handoff, review loop, or panel discussion from a room; how bounded rounds are
displayed; and how the timeline reports handoffs, reviewer findings, and final
summaries. Save design artifacts under docs/ui-design/.

After the artifacts exist, implement bounded collaboration modes using existing
TaskRunner runs, conversation briefs, run cards, and metadata unless the user
explicitly asked for a review stop. Enforce max rounds and explicit stop
conditions. Persist workflow state locally and render timeline events. Treat
non-runnable participant/executor types as assigned or waiting rather than
executing hidden work. Do not allow autonomous endless agent chatter,
participant chatter, remote queues, automatic apply/merge/push, or hidden side
effects.

Update docs/product.md and docs/architecture.md. Add focused tests for workflow
state, max-round enforcement, and timeline metadata. Rebuild the desktop app,
open the running UI, verify the affected workflow manually, write
docs/ui-verification/<date>-phase-9-collaboration.md, and include that file path
in the final summary. Commit, push, and open a PR.
```

## Phase 10: CLI Parity for Rooms and Roles

### Goal

Keep the product CLI-first by exposing room, role, participant, and executor
workflows in the CLI, not only in desktop.

### Scope

- Add CLI commands or chat slash commands for:
  - list rooms
  - create room
  - use room
  - list team roles
  - inspect role
  - create or update local custom role
  - show role executor binding
  - send message to a room with role mentions
  - show room timeline
- Keep `agent-hub run` stateless unless explicit continuation is supplied.
- Keep `agent-hub chat` as the persistent conversation/room path.

### UI Impact

No desktop UI required.

### Non-goals

- Do not remove existing thread commands until compatibility path exists.
- Do not add terminal UI dependencies.
- Do not implement full board/task management CLI yet.

### Acceptance Criteria

- CLI can operate the same room, role, participant, and executor concepts used
  by desktop.
- Existing `chat`, `threads`, and `run` behavior remains backward compatible.
- Docs include direct commands.
- CLI smoke tests cover new commands.

### Implementation Prompt

```text
Read AGENTS.md, docs/product.md, docs/architecture.md, and
docs/local-ai-workgroup-roadmap.md. Implement Phase 10 only.

Add CLI parity for the room, role, participant, and executor concepts
introduced in earlier phases. Expose lightweight commands or chat slash
commands to list rooms, create a room, use a room, list team roles, inspect a
role, create/update a local custom role, show a role's executor binding, send a
message to a room with role mentions, and show a room timeline. Preserve
agent-hub run as stateless unless explicit continuation is supplied. Keep
agent-hub chat as the persistent room/conversation path.

Do not add TUI dependencies, hosted services, remote execution, or full board
management. Keep output human-facing and concise. Update docs/product.md and
docs/architecture.md with direct commands. Add CLI smoke tests and targeted
service tests. Run targeted tests plus pnpm typecheck when practical. Commit,
push, and open a PR.
```

## Phase 11: Pack Boundaries

### Goal

Keep the core product general-purpose while allowing engineering, research,
writing, analysis, and operations vocabulary to appear in pack-specific
surfaces.

### Scope

- Define pack metadata:
  - id
  - display name
  - artifact types
  - check types
  - risk categories
  - default role templates
  - executor capabilities
  - context section providers
- Add built-in pack definitions for:
  - Core Workgroup
  - Engineering
  - Research
  - Writing
  - Analysis
  - Operations
- Move engineering-specific labels such as diff, tests, worktree, PR, and CI
  behind Engineering Pack sections where possible.
- Do not make pack registry editable yet.

### UI Impact

This phase can be metadata-only. If the implementation changes any visible
labels, navigation, inspector grouping, pack badges, or artifact/check/risk
presentation, apply the UI Design Gate before production UI implementation.

### Non-goals

- Do not add plugin marketplace.
- Do not load untrusted third-party pack code.
- Do not add remote integrations.

### Acceptance Criteria

- Core UI uses general terms: Brief, Context, Artifacts, Checks, Risks, Memory.
- Engineering terms appear only inside engineering-specific panels or labels.
- Pack definitions are deterministic local data and may seed role templates,
  but they do not limit user-defined roles.
- Tests cover pack lookup and label mapping.

### Implementation Prompt

```text
Read AGENTS.md, docs/product.md, docs/architecture.md, and
docs/local-ai-workgroup-roadmap.md. Implement Phase 11 only.

Add local built-in pack definitions for Core Workgroup, Engineering, Research,
Writing, Analysis, and Operations. Keep packs as deterministic local metadata;
do not add plugin marketplace or third-party code loading. Packs may provide
role templates, artifact types, check types, risk categories, and executor
capability hints, but user-defined roles must remain possible outside the
preset pack templates. Use pack metadata to separate core UI vocabulary from
engineering-specific details. Core surfaces should prefer Brief, Context,
Artifacts, Checks, Risks, and Memory. Engineering terms such as diff, tests,
worktree, PR, and CI should appear only in engineering-pack contexts.

If this phase changes any visible desktop UI, including labels, navigation,
inspector grouping, pack badges, or artifact/check/risk presentation, first
generate UI design artifacts and screenshots before production code changes.
After the artifacts exist, implement the UI to match the design unless the user
explicitly asked for a review stop, then complete desktop UI verification.

Update docs/product.md and docs/architecture.md. Add tests for pack metadata,
lookup, and label mapping. Run targeted tests plus pnpm typecheck when
practical. Commit, push, and open a PR.
```

## Phase 12: Explicit Apply and Lifecycle Controls

### Goal

Add human-gated workflows for applying accepted work, managing retained
worktrees, and cleaning up local artifacts without weakening safety boundaries.

### Scope

- Add explicit worktree lifecycle controls:
  - inspect retained worktree
  - mark keep
  - clean up selected worktree
- Add explicit apply workflow for engineering outputs:
  - preview
  - risk check
  - user confirmation
  - local apply only
- Keep push, PR creation, and merge as separate explicit future commands if
  ever added.
- Record every decision as audit artifacts and timeline events.

### UI Impact

This is a UI phase. Apply the UI Design Gate before production UI changes.

### Non-goals

- Do not automatically apply accepted runs.
- Do not automatically push, create PRs, merge, or delete branches.
- Do not clean worktrees without explicit user confirmation.
- Do not bypass blocking risk reports.

### Acceptance Criteria

- User can inspect lifecycle state before cleanup.
- Cleanup requires explicit confirmation and records an audit event.
- Apply workflow requires preview and confirmation.
- Blocking risks prevent apply unless a later explicit override policy is
  designed and approved.
- UI verification summary is saved.

### Implementation Prompt

```text
Read AGENTS.md, docs/product.md, docs/architecture.md, and
docs/local-ai-workgroup-roadmap.md. Implement Phase 12 only.

This phase changes desktop UI and local side-effect workflows. First generate UI
design artifacts and screenshots before production code changes. The design
should show retained worktree inspection, explicit cleanup confirmation, apply
preview, risk gate, and audit trail. Save design artifacts under
docs/ui-design/.

After the artifacts exist, implement explicit worktree lifecycle controls and a
human-gated local apply workflow unless the user explicitly asked for a review
stop. Every side effect must require explicit user confirmation and must record
an audit event or review artifact. Do not automatically apply accepted runs. Do
not automatically push, create PRs, merge, delete branches, or bypass blocking
risks.

Keep the renderer sandboxed. All filesystem, Git, and shell operations must run
through Electron main-process IPC and shared local services. Update
docs/product.md and docs/architecture.md. Add focused safety and service tests.
Rebuild the desktop app, open the running UI, verify the affected workflow
manually, write docs/ui-verification/<date>-phase-12-lifecycle.md, and include
that file path in the final summary. Commit, push, and open a PR.
```

## Recommended First Three PRs

1. Phase 1: role and executor foundation.
2. Phase 2 design artifact only, followed by approved implementation PR.
3. Phase 3: mention-to-task grouping.

This order creates the smallest coherent product shift:

- Users can mention preset and custom roles.
- The desktop begins to look like rooms instead of generic threads.
- Multi-agent work shares one task and one audit context.

## Later Schema Split Triggers

Avoid adding many new tables up front. Split to first-class domain tables only
when these triggers appear:

- Add `rooms` table when thread metadata can no longer support room settings,
  filtering, archiving, and default-room lifecycle cleanly.
- Add `roles` / `participants` / `role_executors` tables when role config,
  custom role lifecycle, executor bindings, or human/workflow assignments need
  first-class queries beyond local settings or metadata.
- Add `task_assignments` table when assignment state needs first-class queries,
  reviewer routing, non-runnable participant tracking, or historical lifecycle.
- Add `timeline_events` table when message metadata is insufficient for search,
  pagination, replay, or cross-room activity feeds.
- Add `artifacts` table when artifacts need project-level listing,
  versioning, source links, preview state, or non-run origins.
- Add `decisions` table when decision records need status transitions,
  replacement/superseding, source linking, and review workflow independent from
  approved memory.
- Add `packs` tables only after built-in pack metadata proves stable.

## Verification Matrix

Each implementation phase should choose the smallest sufficient validation set:

- Domain/model changes: `pnpm typecheck` and focused domain tests.
- SQLite schema changes: focused SQLite integration tests with temporary DBs.
- Context changes: context compiler tests and snapshot/budget tests.
- CLI changes: CLI smoke tests and direct command verification.
- Desktop service changes: focused service tests through IPC handler factories
  where practical.
- Desktop UI changes: desktop build, running UI verification, screenshot or
  manual summary under `docs/ui-verification/`.
- Safety-sensitive changes: safety tests, risk report tests, and diff/check
  redaction tests.

Full-suite validation remains preferred before merging:

```sh
./node_modules/.bin/pnpm typecheck
./node_modules/.bin/pnpm test
./node_modules/.bin/pnpm lint
```
