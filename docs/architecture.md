# Architecture

Last audited against `origin/main` at `9f00576` on 2026-06-10.

Agent Hub is a CLI-first local application built from shared TypeScript
packages. The desktop app is an Electron shell over the same local services and
repositories. There is no web API server, cloud backend, hosted job queue,
account system, or remote execution plane.

```text
CLI
  -> local package APIs
  -> TaskRunner
  -> Agent adapters
  -> isolated git worktree
  -> local SQLite evidence

Desktop renderer
  -> sandboxed preload window.agentHub
  -> Electron IPC handlers
  -> main-process services
  -> local package APIs / TaskRunner
  -> isolated git worktree
  -> local SQLite evidence
```

## Workspace Boundaries

- `packages/shared` owns primitive shared types, enums, DTOs, context delivery
  modes, agent availability helpers, role/workgroup contracts, RoleCall
  contracts, process-environment helpers, and built-in workgroup pack metadata.
- `packages/core` owns domain validation, lifecycle state-transition guards,
  repository interfaces, in-memory repository implementations, agent-facing
  output extraction, RoleCall parsing, RoleCall orchestration, assistant-output
  RoleCall reconciliation, RoleCall context, WorkgroupRole-to-RoleDefinition
  mapping, RoleResult helpers, graph convergence helpers, and bounded
  current-context TUI read models over existing persisted evidence.
- `packages/db` owns SQLite migrations, default database path resolution, a
  native `better-sqlite3` connection, and SQLite implementations of the core
  repository interfaces.
- `packages/context-compiler` owns Agent Hub context stores, context pack and
  task brief generation, managed-block export, worktree overlay materialization,
  approved-memory writeback, and project or global skill resolution. Conversation
  brief building, managed-block replacement, task-brief rendering, and context
  policy filtering live in separate package modules under the same boundary.
- `packages/agent-adapters` owns the adapter interface, adapter registry,
  `FakeAgentAdapter`, `CodexAdapter`, `ClaudeCodeAdapter`, process preflight,
  JSONL event mapping, and direct process spawning through `ProcessRunner`.
- `packages/task-runner` owns worktree creation, git safety preflight, adapter
  execution, progress events, verification, diff collection, risk report
  persistence, memory proposal generation, comparison report aggregation,
  code-state continuation, RoleCall TaskRunner execution, and cleanup policy.
- `packages/safety` owns dangerous-command detection, diff/event safety scans,
  risk report generation, and RoleCall policy validation.
- `apps/cli` owns a declarative command route registry, interactive shell
  behavior, persistent chat and room command UX, the read-only TUI renderer/key
  handling, output rendering, debug rendering, and CLI-only persistence
  operations such as manual run-event recording.
- `apps/desktop` owns Electron main/preload, React renderer, desktop layout,
  local UI preferences, IPC service facades, and desktop-only presentation
  state. It does not own task orchestration.

The rule is that orchestration belongs in shared packages or Electron
main-process services. The renderer never imports privileged packages or calls
Node, shell, filesystem, SQLite, child process, or git APIs directly.

## Primary Runtime Flow

For a CLI, desktop, or executable RoleCall run, `TaskRunner` performs the same
core sequence:

1. Resolve the project root and requested agent.
2. Reject unsupported delivery modes and unsafe repository-local git config.
3. Build the task-specific context pack and task brief.
4. Refresh local stable-source and TypeScript code graph indexes when the
   configured repositories are available.
5. Create an isolated git worktree under the configured Agent Hub worktree base.
6. Materialize generated runtime files inside the worktree.
7. Run the adapter from the worktree cwd with runtime-injected context and,
   for role-backed runs, role/team metadata.
8. Persist ordered run events and progress events as they are produced.
9. Run structured verification commands in the worktree.
10. Collect diff metadata and a bounded persisted patch artifact.
11. Generate and persist a safety/risk report.
12. Persist run artifacts, run metadata, status transitions, and warnings.
13. Generate conservative proposed memory from durable evidence for successful
    runs through the shared proposal generator used by TaskRunner and desktop
    explicit generation. Proposal listing and review summary reads stay
    read-only. Proposed memory rows may carry local audit metadata and typed
    automation policy contracts.
14. Evaluate memory automation dry-runs through a deterministic local evaluator
    that reads run status, verification results, risk reports, duplicate
    memory, and policy gates. Evaluation is scoped to proposals whose
    `metadata.sourceRunId` matches the requested run; review-accept automation
    is eligible only when the accepted-review path supplies that gate.
    Evaluation is read-only and does not write approved memory.
15. Apply the project memory policy only at bounded local gates:
    `auto_after_review_accept` runs after explicit review acceptance, while
    `auto_safe_on_success` runs after successful TaskRunner finalization has
    persisted verification, risk, artifact, metadata, and proposed-memory
    evidence. Both modes write back only through the Agent Hub-owned
    approved-memory store and are off by default.
16. Apply cleanup policy without accepting, merging, pushing, or deleting
    branches automatically.

After a task-run row exists, finalization is defensive. Diff, verification,
risk, artifact, metadata, memory-proposal, or cleanup failures become persisted
diagnostic events and warnings where possible. Failed finalization returns the
task to `open` and keeps partial evidence inspectable.
Live event persistence is best-effort during adapter execution so CLI TUI
polling can render current progress. Finalization still backfills any missing
event sequences before cleanup and records persistence failures as warnings or
diagnostic events according to the existing failure boundary.

## Context Delivery

`runtime_injection` is the default delivery mode. The context compiler builds a
typed context pack and task brief, and adapters receive that payload at runtime.
Repository-level `AGENTS.md`, `CLAUDE.md`, `.claude/skills`, and
`.agents/skills` are not written by default.
TaskRunner additionally derives a typed `runtime_context_pack` run artifact
from the compiled context bundle. The artifact records each section's context
layer, trust level, source item ids, source hashes, compression mode, rendered
character counts, omissions, and diagnostics. After runtime selection, TaskRunner
renders the selected runtime sections back into the task brief, worktree overlay
payload, and adapter `contextMarkdown`.
Before writing the runtime pack, TaskRunner creates a deterministic
`context_plan` artifact from a rule-based task classifier. The plan records the
task type, required context layers, planned retrieval routes, trust policy,
layer budgets, compression policy, and classifier diagnostics. The plan drives
retrieval and selection before adapter execution.
TaskRunner also runs a `ContextRetriever` boundary before artifact persistence.
The explicit route emits candidates for sources already selected by the run,
including the current task, selected and role-default skills, selected files,
selected runs, and low-trust thread continuity. The `task_rule` route emits
deterministic candidates for already-compiled project context and approved
memory sections whose layers are required by the current plan. These candidates
are persisted as `context_retrieval_candidates` for inspection and then passed
into runtime selection. If retrieval or selection throws after the run row
exists, TaskRunner records error/run-failed events, marks the run failed, and
returns the task to `open`.
SQLite includes a `context_index_entries` metadata table plus
`context_text_fts` FTS5 storage for stable text sources. The CR4 stable-index
rebuild reads only Agent Hub context-store project docs, approved memory,
project skills, and global skills; it skips secret-like paths, proposed or
rejected memory rows, run evidence, thread summaries, logs, diffs, embeddings,
and code-graph data. Rebuilds compare source hashes and leave unchanged rows
and FTS entries untouched. The default CLI and desktop TaskRunner paths provide
a `ContextIndexRefresher`, so stable context-store sources are refreshed before
retrieval without requiring a separate manual `context build` step.
When a `ContextIndexRepository` is supplied, the retriever builds lexical query
terms from the current task prompt plus selected file/run hints and queries the
stable-source FTS index through BM25. BM25 candidates are appended to
`context_retrieval_candidates` with rank, lexical score, matched terms, layer,
trust, source ids, and inclusion reasons. Candidates that duplicate explicit
sources by source id and content hash are omitted with diagnostics. Indexed
project and global skills are filtered out unless the task or role selected the
matching skill reference. Unscoped references match project skills by default;
global BM25 skill hits require an explicit `global:<id>` reference. BM25 lookup
uses the TaskRunner task project id, matching the stable-index refresh key even
when context-bundle repository metadata falls back to `repo_<name>`.
The recency route is separate from stable-source indexing. TaskRunner can
collect recent terminal run evidence from persisted task runs, diff artifact
metadata, verification result statuses, and risk report summaries, then render
bounded medium-trust `run_evidence` candidates. Thread summaries are rendered as
low-trust continuity candidates only when thread context policy allows them.
Raw run events, raw logs, raw diff bodies, stdout/stderr verification bodies,
full risk finding details, and full conversation transcripts are deliberately
excluded.
The code graph route is backed by a deterministic local TypeScript parser and
an injectable `CodeGraphRepository`. SQLite stores graph entries in
`code_graph_entries`; the TaskRunner refreshes the project graph before
retrieval when a repository is configured. The index records TS/TSX files by
package boundary, imports, exports, symbols, test-file status, related tests,
and changed-file relationships. Graph retrieval expands from task terms,
selected file seeds, and recent changed files, then emits high-trust `code` or
`test` candidates with graph proximity diagnostics. Graph lookup uses the same
task project id as the rebuild path. Unconfigured repositories leave the graph
route disabled without affecting other retrieval paths.
Optional semantic retrieval is modeled as injectable local capabilities:
`ContextEmbeddingRetriever` and `ContextCandidateReranker`. Each capability is
detected before use; unavailable or unconfigured providers produce info
diagnostics and do not block the run. Candidate fusion happens after route
retrieval and optional reranking, combining same-source route evidence such as
BM25 plus embedding while preserving source ids, route lists, and diagnostics.
No cloud embedding service, hosted vector database, or secret persistence is
part of the default runtime.
CR8 adds first-class `context_eval_events` local persistence. TaskRunner writes
events for run outcome, verification, risk, missing context, and noisy/compressed
context after final run status is known; review accept/reject commands append
`review_decision` events. These rows link to project, task, run, and context
plan ids and store selected/omitted context item ids as JSON arrays. CLI
inspection commands read persisted artifacts and eval rows only; they do not
rerun retrieval and do not promote memory.
TaskRunner now runs a runtime selection step over explicit, task-rule, BM25,
embedding, graph, and recency candidates before persisting
`runtime_context_pack`. The selector applies hard policy first, ranks allowed
candidates with relevance, layer priority, trust, freshness, and
graph-proximity signals, then enforces layer character budgets.
Budget enforcement runs across the typed pack sections and uses deterministic
compression for project docs, run evidence, and conversation continuity before
omitting over-budget items. Compression preserves source ids, source hashes,
compression mode, original/rendered character counts, and omission counts, with
budget usage diagnostics stored in the artifact. Conversation compression keeps
the explicit low-trust override limits while retaining representative freeform
body lines when a thread summary has no structured headings. Selected candidates are
appended to the typed runtime pack and become the source of adapter-facing
runtime markdown. The synthetic `runtime_policy` section and current task
sections are pinned and cannot be evicted by retrieval candidates.
The context compiler applies hard policy before adding memory or skill sections.
It filters proposed/rejected memory, secret-like source paths, repository-root
agent instruction export targets, and unsupported task/role skill scopes, then
records warnings plus structured `RuntimeContextPack.omitted` entries. Runtime
retrieval scans all selected-file path segments for secret-like names before
creating candidates, and source-aware selection deduplicates indexed
`memory/approved.md` candidates against the base approved-memory section. The
conversation section is rendered as `Conversation Continuity [trust=low]` with
explicit override limits so thread context remains continuity evidence rather
than a source of project facts.
When a run is created from a CLI role mention or accepted RoleCall, `TaskRunner`
passes safe `WorkgroupRoleRunMetadata` into the adapter input. Process-backed
adapters render a `## Your Role` section, collaboration rules, and a compact
team list into stdin before the task brief. Direct adapter runs without role
metadata omit that section.
Role-backed runs and accepted executable RoleCalls also pass the callee role's
default skill references into context compilation so role-selected project or
global skills are injected through the same runtime payload.

`worktree_overlay` is a run mode that writes generated `AGENTS.md`, `CLAUDE.md`,
briefs, context packs, and skill copies only inside the isolated worktree.
Generated-file baselines are passed to diff collection so unchanged overlays are
hidden while agent-modified overlays remain reviewable.

`repo_export` is limited to the explicit `context export` command. It previews
or writes managed blocks to repository export targets while preserving
user-authored content outside those blocks. Task runs reject `repo_export`.

Context stores are external by default:

```text
<agent-hub-app-data>/context-stores/<project-id>/
  context/project.md
  context/architecture.md
  context/conventions.md
  context/testing.md
  context/security.md
  memory/approved.md
  skills/<skill-id>/SKILL.md
```

Global skills live at `<agent-hub-app-data>/skills/<skill-id>/SKILL.md`.
Current resolvable skill scopes are `project` and `global`; `task` and `role`
are reserved and rejected until first-class scoped stores exist.
Task runs and team-role configuration can select explicit skill references, and
the resolver records injected skill scope, display metadata, source path where
available, and content hash as run evidence.

## Adapter Boundary

Adapters implement a common interface with detection and async run events.
Real adapters always run in the isolated worktree cwd and validate that the
generated task brief path stays inside the worktree before launch.

- `FakeAgentAdapter` writes deterministic output inside the worktree and is
  available only under debug/development/test or explicit hidden config.
- `CodexAdapter` runs `codex exec --json -` for fresh runs and can run
  `codex exec resume --json <session-id> -` for desktop follow-up turns.
- `ClaudeCodeAdapter` runs `claude --print --output-format stream-json`.

Process adapters use executable-plus-args spawning, not shell interpolation.
They perform run-scoped preflight with the run environment; missing CLI,
authentication, or setup failures become persisted error/exit events instead of
service crashes. JSONL stdout is parsed into bounded message/status/error
events where possible, while raw stdout/stderr remains preserved.
The runtime prompt explicitly tells role-backed process adapters that Agent Hub
coordinates roles externally, delegation must be requested through RoleCalls,
and user-installed global skills or repository-local agent instructions should
be ignored unless they were injected by Agent Hub for that run.

`ProcessRunner` builds child environments from a small allowlist and explicit
overrides. It can add common local CLI directories to `PATH` for GUI-launched
desktop processes, and `PATH: undefined` still removes path lookup for that
child process.

## Git, Diff, And Verification

Worktree creation uses deterministic task/agent branches and fails fast on
existing target paths or branch collisions. Empty repositories without a
committed `HEAD` fail before `git worktree add`.

Git calls use hardened command arguments and environment. The git safety layer
rejects repository-local config that can execute helpers, filters, external
diff commands, textconv commands, fsmonitor hooks, or includes. Repository-local
`core.hooksPath` is allowed because Agent Hub's own git invocations override
hooks to `/dev/null`.

Diff collection reads git status, filters unchanged generated overlays, captures
tracked/staged/unstaged changes, synthesizes bounded patches for untracked text
files, records binary metadata, and records untracked symlinks without reading
their targets. Sensitive patch text is redacted before CLI, desktop review, or
TUI inline-diff rendering.

Verification uses structured executable-plus-args commands. Dangerous commands
are refused by `ShellExecutor` and represented as failed verification results.
Default command timeout is 10 minutes unless a command provides its own
`timeoutMs`. Abort signals flow through adapters and verification so desktop
cancellation can terminate process-backed runs or checks with `SIGTERM`.

## Persistence

The default SQLite database is in Agent Hub app data. `AGENT_HUB_HOME`,
`AGENT_HUB_DB_PATH`, and CLI `--db` provide local overrides.
SQLite access is in-process through `better-sqlite3`; Agent Hub no longer
depends on a system `sqlite3` executable or stdout/stderr protocol parsing for
normal CLI, desktop, or test storage access. The desktop package rebuilds native
bindings during packaging and unpacks `.node` files from the app archive.

The current schema covers:

- `projects`, `agent_profiles`, `tasks`, `task_runs`, `status_transitions`;
- `run_events`, `run_artifacts`, legacy `run_metadata`;
- `verification_results`, `risk_reports`, `comparison_reports`;
- `conversation_threads`, `conversation_messages`,
  `conversation_thread_summaries`;
- `memory_items`, `skills`, `settings`;
- `role_calls`, `role_todos`, `role_call_events`;
- `context_index_entries`, `context_text_fts`, `code_graph_entries`, and
  `context_eval_events`.

The default SQLite CLI and desktop runtimes wire the same local repository
bundle into TaskRunner, including the context index repository, context index
refresher, code graph repository, and conversation thread summary repository,
so normal `agent-hub run` executions can retrieve persisted BM25 context,
graph context, and saved thread summaries without manual dependency injection.

SQLite migrations add constraints that mirror the domain model: task and run
status checks, agent-kind checks, project/run relationships, JSON column
validation, risk-list array constraints, parent-run provenance, role metadata,
task metadata, and RoleCall audit indexes. In-memory repositories enforce the
same state transitions for tests and injected runtimes.

Settings reject secret-like keys and values at the domain/repository boundary.
Desktop verification command settings also reject secret-like option names in
args before storage.
Desktop memory automation policy settings are validated in the main-process
`SettingsService` before storage. The renderer can save only bounded project
policy fields, including the opt-in `auto_safe_on_success` mode.

## Conversations, Rooms, And Roles

Conversation threads and messages are first-class local records. Rooms are
stored as thread metadata (`roomType`, `roomHandle`, `description`, `pinned`,
`sharedContextEnabled`) rather than a separate room table.

The conversation context builder creates bounded `conversation_brief` artifacts
for runs. It includes the current turn, participant-scoped prior messages,
participant-scoped thread summary, role context, selected skills, approved
project context, and explicit continuation provenance. It excludes raw logs,
diffs, verification output, risk reports, lifecycle events, and unrelated role
or direct-agent chatter.

Role configuration is project-scoped local settings. Preset and custom roles
share one contract: handle, display name, purpose, persona, instructions,
permissions, context policy, approval policy, default skill references, enabled
state, and executor. `agent_adapter` roles map to existing adapters. Reserved
`human`, `llm_api`, and `workflow` roles are stored and displayed but do not
execute.
CLI role resolution can also read `.agent-hub/team.yaml` from a registered
project when that file already exists or when a user explicitly imports or
exports it. YAML is schema-validated, then merged after SQLite settings, so the
documented precedence is presets -> SQLite overrides/custom roles -> YAML
overrides/custom roles. `team roles save` still writes SQLite only. `team roles
export` prints a preview unless `--write` is passed, and `team roles import`
persists YAML roles into SQLite only with `--write`. Team-role
`delegationPolicy` is the explicit local configuration surface for whether a
role can initiate RoleCalls and which targets or capabilities it can call.

CLI chat, room sends, and desktop room turns resolve role handles in the local
service layer. Runnable participants create TaskRunner-backed runs under one
shared task when appropriate. CLI and desktop role participants pass their role
metadata and the enabled team roster into `TaskRunner`; non-runnable
participants stay visible in assignment metadata.

## Adaptive Role Calls

Adaptive Role Calls are the local control-plane for role-to-role delegation.
They are not direct role chat and not a remote workflow engine.

The flow is:

1. A role-backed assistant response emits line-start `@role task` syntax.
2. CLI chat, TUI prompt submission, and the Electron main-process thread service
   pass assistant output through the shared core RoleCall output processor,
   which parses with the core parser while ignoring fenced code and unknown
   roles.
3. The RoleCall orchestrator validates caller/callee roles, policy, graph
   limits, duplicate suppression, todo capacity, permissions, approval gates,
   executor capability, and dangerous command text through safety policy.
   Preset roles use core defaults, while custom roles such as `@pm` can
   initiate bounded RoleCalls only when their team-role `delegationPolicy`
   explicitly enables targets or capabilities. The preset `@engineer`
   delegation default accepts line-start `delegate` intents only for
   `@operator` and `@reviewer`. CLI and desktop prompt construction use the
   core intent-aware delegation helper, so `available_role_calls` lists only
   targets permitted for the line-start `delegate` protocol rather than every
   target allowed by another intent type.
4. Accepted, deferred, rejected, waiting-context, or waiting-approval decisions
   are persisted as RoleCall and RoleCallEvent records. Callee todos are
   created or updated where applicable.
5. Accepted executable `agent_adapter` calls are started through
   `RoleCallTaskRunnerExecutor`, which reuses the normal TaskRunner path and
   links the resulting `task_run` to the RoleCall. The callee role is converted
   into the same safe runtime role metadata used by CLI role mentions, and its
   default skill references are forwarded into TaskRunner context compilation.
6. RoleResult JSON is parsed when available; the summary is promoted to the
   transcript while raw structured payload stays in local evidence.
7. Caller reinjection and convergence helpers summarize decisions, results,
   todos, and events only when bounded continuation is allowed.

CLI `role-calls`, `role-todos`, and `role-events` commands read the same local
records and can output stable JSON for scripts.

## Desktop IPC Boundary

The desktop browser window is created with `nodeIntegration: false`,
`contextIsolation: true`, and `sandbox: true`. Preload exposes only the
`window.agentHub` API through `contextBridge`.

Electron main-process services own privileged operations:

- `ProjectService`: project registration and selection.
- `ThreadService`: room/thread reads and writes, message sending, role
  resolution, workflow metadata, same-project role-run queueing,
  queued-role drain recovery, assistant-output reconciliation, RoleCall
  parsing, and delegated run-card creation.
- `RunService`: run creation, TaskRunner integration, live event subscription,
  lightweight non-terminal run details, durable desktop execution-input
  artifacts for queued runs, cancellation, continuation, and RoleCall execution
  bridge.
- `ReviewService`, `DiffService`, and `RiskService`: inspector summary,
  artifacts, logs, diffs, verification, risk, retained-worktree handoff, and
  fallback deterministic risk.
- `LifecycleService`: explicit keep, cleanup, preview apply, and confirmed
  local apply.
- `MemoryService`: proposal listing/generation, explicit approve, and ignore.
- `ComparisonService`: same-task or same-turn local run comparison.
- `KnowledgeService`: project-scoped memory, summary, and decision read model.
- `TeamService`: preset overrides and custom role settings.
- `SettingsService`: validated per-project verification command settings and
  memory automation policy settings.

Renderer state is presentation-only: navigation, sidebar density, scroll
behavior, target chips, autocomplete, command palette, inspector tab selection,
and safe local preferences. Local preferences intentionally exclude prompts,
transcripts, logs, diffs, repository paths, command text, secrets, and approved
memory.

Markdown rendered in desktop is sandboxed and does not allow raw HTML. New
window and navigation requests are denied in-app; only approved external
protocols (`http`, `https`, `mailto`) are opened through Electron shell helpers.

## Review, Lifecycle, Memory, And Comparison

Run review is read-only by default. `runs events`, `runs diff`, `runs show`,
`risks show`, desktop review tabs, and comparison views inspect persisted local
evidence. They do not rerun agents or mutate worktrees.

Accept/reject decisions are `review_decision` artifacts. They do not alter run
status, branches, files, or cleanup state. Review acceptance can trigger memory
automation only for projects whose stored policy explicitly selects
`auto_after_review_accept`. Successful TaskRunner finalization can trigger
memory automation only for projects whose stored policy explicitly selects
`auto_safe_on_success`.

Lifecycle actions are separate audited operations. Cleanup validates retained
worktree ownership and exact confirmation before removing an Agent Hub-owned
worktree. Local apply validates latest risk, blocks `blocking` risk, writes the
raw persisted patch to an Agent Hub temp path, runs `git apply --check`, and
then runs `git apply` only after human confirmation. It does not commit, merge,
push, create pull requests, delete branches, export context, or approve memory.

Memory approval is explicit unless a project has opted into
`auto_after_review_accept` and a human records review acceptance, or a project
has opted into `auto_safe_on_success` and a run finishes through the successful
TaskRunner finalization path. Approved items are appended idempotently to the
Agent Hub-owned context store; proposed, rejected, and retired SQLite rows are
never injected. Retiring approved memory marks the managed
`memory/approved.md` block with local retirement metadata so FileMemoryProvider
and stable context indexing skip it while retaining the audit trail. The CLI
marks the approved-memory file first and only moves the SQLite row to
`retired` after the managed block was found and updated. Auto-approved rows
carry policy, risk, verification, and writeback metadata that desktop memory
and Knowledge read models expose as local audit evidence.

Comparison reports are generated from persisted run evidence: statuses, changed
files, diff stats, verification results, risk levels, risk factors, and
deterministic review scores. Comparison is advisory and never accepts output.

## Safety Model

Safety scanning is deterministic and local. It inspects changed paths, diff
text, verification command text, and persisted adapter events. Blocking
findings include sensitive paths and dangerous commands. Risk aggregation keeps
`blocking` severity rather than downgrading it.

Sensitive examples include `.env`, `.env.*`, `*.pem`, `*.key`, `id_rsa`,
`id_ed25519`, `secrets.*`, `credentials.*`, and `token.*`.

Dangerous command detection covers direct and common shell-wrapped forms of
`sudo`, `rm -rf /`, `chmod -R 777`, `curl | sh`, `wget | sh`,
`git push --force`, and `git clean -fdx`.

The MVP scanning boundary is intentionally bounded to persisted run events,
diffs, verification commands, and review artifacts. It does not recursively
read arbitrary retained-worktree files.

## Testing And CI

The root workspace uses TypeScript project references and Vitest. Important
coverage areas include domain validation, SQLite repositories and migrations,
context compiler behavior, fake and process adapters, TaskRunner integration,
diff collection, verification, safety/risk reporting, CLI smoke and persistence
flows, desktop services, desktop UI helpers, workgroup roles, RoleCalls, and
CI/CD packaging rules.

Root scripts:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm test:coverage
pnpm coverage:diff
pnpm build
pnpm desktop:build
pnpm desktop:dist:mac
```

GitHub CI runs local validation and builds CLI package artifacts and macOS DMG
artifacts. The Validate job also runs a report-only Vitest coverage pass,
writes the aggregate totals to the GitHub Actions step summary, and uploads the
`coverage/` directory as an artifact. Full-repository coverage thresholds are
intentionally not enforced yet; the report is used to establish a baseline
before package-specific gates are introduced. Pull request validation then runs
a blocking diff-coverage gate over changed executable source lines that are
present in `coverage/lcov.info`. The initial diff threshold is 70%. Non-source
changes, test files, docs, workflow files, and non-executable changed lines are
ignored by the diff gate. Release workflows publish repository artifacts only;
they do not deploy services or change the local-first runtime model.

## Extension Rules

Future changes should preserve these boundaries:

- keep CLI behavior functional without the desktop;
- keep any future terminal UI inside the CLI/local package boundary as a
  complete current-context workbench, not a project/room browser or desktop
  inspector clone;
- keep desktop orchestration out of the renderer;
- prefer local core packages over app-specific orchestration;
- keep generated context out of target repository roots unless explicitly
  exported;
- add first-class tables only when metadata-backed storage no longer supports a
  concrete query, lifecycle, or governance need;
- add new executor backends only behind explicit local execution semantics and
  review boundaries;
- never turn review, comparison, role collaboration, or memory proposals into
  automatic acceptance, merge, push, PR creation, or memory promotion unless a
  future opt-in local memory policy explicitly implements the bounded automation
  described in `docs/memory-automation-roadmap.md`.

The planned terminal UI direction is captured in `docs/tui-roadmap.md`. It
should reuse persisted transcript, task, run, RoleCall, verification, risk,
memory, skill, and review evidence while keeping deep audit in explicit CLI or
desktop review commands. The first shared package boundary for that work is a
core read-model layer; it adds no persistence tables and performs no terminal
orchestration. That read model now includes Work-specific `conversation` and
`activeRuns` projections in addition to the existing transcript, run, RoleCall,
review, task, team, memory, and skill summaries. The `agent-hub tui` command
lives in `apps/cli`, renders those read models as a terminal shell, and
delegates composer submission back to the existing CLI chat turn path.
Continuation and governance mutations remain outside the TUI renderer. Runs
and Tasks focus modes are still
read-model projections over existing task, run, RoleCall, RoleTodo,
verification, risk, metadata, and artifact repositories; they do not introduce
new persistence or raw log/diff rendering.
The V3 TUI plan in `docs/tui-v3-roadmap.md` keeps the same boundary while
introducing a shared shell frame, selected-object detail contract, and
table/detail primitives for Work, Memory, and Team. `TuiInkFrame` composes a
shared shell with header, persistent side navigation at normal and wide widths,
the existing main view, a wide-width detail rail, medium/narrow detail overlay,
composer, tab map, and bottom shortcut/status chrome. That shell passes
column-adjusted terminal dimensions into the existing view renderers and does
not add storage access or persistence.
The selected-object detail contract lives in `packages/core/src/tui-read-model.ts`
as presentation DTOs (`TuiSelectionDetail`, `TuiDetailSection`, and
`TuiDetailAction`). Core builds detail payloads from existing summary data for
Work blocks, runs, RoleCalls, tasks, team roles, and memory governance; Ink only
selects and renders those payloads from local state. `Enter` or empty-composer
`o` opens detail, while `Esc` closes the detail overlay before returning focus.
V3 Work blocks are also presentation DTOs in the same read model. Core derives
`TuiWorkBlock` rows from the existing `conversation` and `activeRuns`
projections, including stable ids, source kind, speaker, timestamp, status,
message lines, conservative inferred tool summaries, file refs, command-like
lines, evidence lines, and inline diff references. Ink renders selected Work
rows and folded metadata from those DTOs, while detail sections for tools,
commands, file refs, inline diffs, and fix snippets are built in core from the
same persisted evidence.
For active-run Work blocks, core builds a live detail section from the same
polling evidence already used by active run boxes: speaker, running state,
started timestamp, elapsed/usage labels, spinner state, streaming output tail,
inferred tool text, inferred active commands, and pending-artifact
placeholders. The command section explicitly says queued/running command status
is unavailable unless persisted evidence provides it; no socket, daemon, or
direct adapter channel is added.
Several reference-screen features still require new read-model projections
before they can be rendered truthfully: structured tool-call lifecycle rows,
normalized block artifacts, memory proposal evidence excerpts,
approved-memory writeback targets, role delegation matrices, selected role
profiles, and audited memory action callbacks. Until those
projections or callbacks exist, the renderer shows unavailable/disabled
sections and command hints rather than fabricating data or reading lower-level
stores directly.
RoleCall loop controls reuse the core convergence helper plus TUI risk
summaries. The CLI renderer can prepare an explicit continuation prompt, but it
does not run an autonomous background loop or add a daemon.
Audit-only review decision recording lives in `packages/task-runner` so CLI,
TUI, and desktop-facing services can share the same `review_decision` artifact
shape. Recording a decision writes a run artifact only and does not mutate task
run status, workspace cleanup, repository files, branches, memory, or lifecycle
state.
Memory, skill, context, and team-role indicators are rendered from core
read-model summaries. The TUI may show command hints such as
`agent-hub memory list`, but memory approval and skill editing remain explicit
CLI/context-store workflows. Team-role summaries reuse preset roles plus the
project's existing `desktop.project.<project-id>.workgroupRoles` settings value;
they add no role table and do not invoke shell commands from the renderer.
The command palette is renderer state in `apps/cli`; it reuses the same
current-context read model and does not add new repositories, project browsing,
or background workers.
TUI hardening stays at the CLI/read-model boundary. `apps/cli` converts launch
and read failures into renderable fallback models with recovery commands, while
`packages/core` keeps missing linked-run evidence readable in the RoleCall
summary. Reserved role executors are surfaced from existing task assignment
metadata; no executor backend, database table, daemon, or desktop behavior is
added for the TUI.
Terminal polish is also contained in the CLI renderer. It compacts identifiers,
renders the Work view as a conversation flow plus bounded active-run boxes,
moves the shortcut-labelled Work/Runs/View/Graph/Tasks/Memory/Team/Help tabs
below the composer, renders a focus-specific shortcut hint as the bottom line,
uses width-aware tab/footer labels so narrow terminals keep primary keys
readable, and uses Ink components for terminal layout instead of hand-wrapped
string panels. Full current-context CLI commands stay in Palette, focused
detail panes, or explicit command-print status messages rather than permanent
footer chrome. Work layout budgets are calculated from terminal width/height
after reserving fixed chrome rows for the header, warnings/status, attention
strip, composer, tabs, and status bar: conversation rows are sliced after
renderer-side display-width-aware wrapping has repeated structural prefixes,
so CJK/full-width text and long Markdown/path/code tokens do not fall through
to Ink truncation. Active-run boxes switch to a compact four-line variant only
on narrow or short terminals. The
full output remains in the read model; the renderer only bounds the visible
window. The attention strip is also renderer-owned:
it derives ordered read-only items from existing run evidence, review
decisions, RoleCall loop state, task assignments, team executors, and memory
counts, then truncates to the highest-priority item at narrow width. It does
not add persistence, shell execution, or navigation side effects. The TUI Ink
entrypoint loads React/Ink/App modules after installing a scoped warning filter
that suppresses only Node's JSON-module ExperimentalWarning from Ink's
`cli-boxes` dependency, then restores normal warning behavior. Operator copy is
mapped in the renderer where it is purely presentational: context delivery enum
values become compact labels, team executor labels are translated away from
`agent_adapter`, and generated review hints stay in English.
The Ink renderer owns only presentation grammar: reverse-color risk-aware
headers, a low-flicker idle `◈` indicator, agent-message left bars,
timestamp/elapsed/usage metadata display, conversation separators, five-minute
timeline anchors, diff mini-card framing, selected-row inverse styling,
path/command/code highlighting, and safe OSC 8 file-link wrapping. The core TUI
read model exposes derived elapsed and usage labels from persisted run
timestamps and run-event metadata, and derives compact run stage/latest text
from presentation-filtered events; it does not change event persistence,
adapter execution, run status, or review semantics.
Active-run boxes cover running runs only. They use rounded frames whose content
area grows to fit wrapped visible output until it reaches the terminal-derived
row budget; when output is longer, the renderer keeps the newest wrapped lines
and inserts an omitted-line marker while the read model and run evidence retain
the full agent-facing output. Tight width or height still uses the compact
latest-tail variant plus progress. If no useful assistant or runtime activity
is visible yet, the read model emits `agent thinking...`. The renderer uses a
static running marker, live elapsed calculation from the run start timestamp,
presentation-only stale labeling after the threshold when the box still has no
useful output, and best-effort percentage or `N/M` progress parsing.
Completion/failure visibility comes from the refreshed read model instead of
short-lived renderer feedback timers. None of that state is persisted or sent
back into adapters.
They prefer structured assistant output, then fall back to recent adapter,
stdout, and stderr events while filtering raw JSON protocol frames, setup
lifecycle lines, internal agent protocol summaries, runtime warnings, Codex
internal diagnostics, and skill activation noise. The core read model preserves
complete visible agent-output lines; the Ink renderer wraps long lines in the
terminal surface. Verification, risk, diff, and
review evidence stay out of active boxes. Role-backed run display is
resolved in the core read model from linked RoleCalls, run/message role
metadata, and task assignment metadata before falling back to adapter kind. The
read model also forwards run start timestamps and usage labels to active boxes,
derived from existing run rows and run-event
metadata. Terminal pending-review runs with changed files fold into the
conversation projection with their agent-facing output,
verification/risk summaries, and a final View-pane review hint. Terminal runs
without changed files render as completed output instead of awaiting review.
The Work view remains prompt-first, and printable keys do not trigger audit
mutations.
Quick replies are derived in the core TUI read model for only the latest visible
agent-result conversation entry. They are prompt templates, not actions:
`1`/`2`/`3` route through the same CLI `submitPrompt` callback used by manual
composer submissions, and they are disabled as soon as the composer contains
text or the Work conversation is scrolled away from the bottom. The `C`
shortcut only prepares a continuation prompt in local Ink state.
Inline diff display is also a read-model projection over existing `git_diff`
run artifacts or run metadata. Small diffs with five or fewer changed lines are
projected into bounded file/add/delete/context lines; larger diffs expose only
a stat summary. Before projecting patch lines, the core read model checks
changed-file metadata and diff headers for sensitive paths and replaces matching
patches with a redacted summary. The Ink renderer frames inline and summary
diff projections as mini cards, can group dense adjacent pending-review entries,
expand/collapse Review-pane diff lines, and show a read-only compare summary
for tasks with multiple runs, but it does not generate comparison reports,
apply patches, or mutate review decisions.
Search and command-palette input are local Ink state. Conversation search reads
only the rendered read-model text already present in memory, highlights matches,
and never mutates composer contents. Palette filtering is fuzzy over safe focus
items and existing CLI command hints; `Enter` either changes TUI focus or copies
a command hint into the composer for explicit user submission. It never invokes
shell commands directly.
Notifications, timeline, and splash remain CLI renderer concerns.
`/notify` toggles an in-memory flag for the current Ink session; when enabled,
the renderer may write only terminal escape output (bell plus OSC 9) after a
previously active run disappears from the active-run projection and its recorded
start time is more than 30 seconds old. `/timeline` and empty-composer `L`
render a compact chronological overlay from the same read model.
`--splash`/`--no-splash` only affect whether the CLI prints a short prelude
before starting the interactive Ink frame; the live frame does not mount a
splash component and therefore does not repaint later just to remove it.
Unchanged read-model refreshes are discarded before `setModel`, idle polling
uses a slower cadence than active-run polling, and active-run markers do not
advance from an internal animation timer. None of these states adds tables,
settings, filesystem writes, shell execution, adapter calls, or run lifecycle
mutations.
The direct CLI entrypoint exits after command completion, so one-shot TUI smoke
renders do not leave local SQLite connections holding the terminal open.
For interactive launches, the CLI default IO includes `process.stdin`, and the
TUI also falls back to `process.stdin` for TTY/raw-mode detection when a custom
test IO object omits stdin. This keeps `agent-hub tui` interactive in a real
terminal while preserving deterministic `--once` and non-TTY smoke renders.
Composer editing is handled in the Ink component state before shortcut
dispatch: printable lowercase keys update the composer from any focus,
uppercase tab shortcuts switch Work/Runs/View/Graph/Tasks/Memory/Team,
`/team` clears the composer and switches to the Team view, `Enter` submits
other non-empty composer text, empty-composer `Enter` is a no-op, `Esc` clears
composer text or returns auxiliary panes to Work, and `Tab` remains a
focus-navigation key unless an active `@` completion token is open. The composer
tracks a cursor offset for left/right, Home/End, Backspace/Delete, and
Ctrl+A/E/U/D editing; `Ctrl+O` inserts a newline; Up/Down read an in-memory
submitted-prompt history; and mention completion is derived from the selected
agent, built-in agent kinds, and enabled team-role handles already present in
the current read model. The renderer also shows a submit preview derived from
the selected target, thread metadata, and context mode. This keeps normal prompt
text from being stolen by global focus shortcuts without trapping focus inside
the composer.
Interactive TUI prompt submission reuses the CLI chat/task-runner path with a
buffered CLI IO adapter. One-shot `--submit --once` remains blocking for smoke
checks and scripts, while interactive composer submission returns after the
local user message and task are persisted and the background chat turn has
started. The run still persists messages, run cards, run events, diffs, risks,
and review evidence through the shared repositories, but agent stdout and debug
text do not write directly to the Ink terminal surface; the TUI refreshes from
the persisted read model instead. Because TaskRunner persists emitted run
events before final completion, the refresh loop can show active adapter
progress without adding a separate live-log channel. Role-backed CLI/TUI runs
use a project+role promise queue so consecutive turns for the same `@role`
execute in order without blocking unrelated prompt submissions.
Desktop queued role runs additionally persist a `desktop_run_input` artifact at
run creation time, allowing a later main-process service instance to rehydrate
TaskRunner input for a queued run before draining newer same-role work.
The Ink app never reads SQLite, git, shell, or filesystem directly. It receives
`loadModel`, `submitPrompt`, and `recordReviewDecision` callbacks from the CLI
boundary, wraps interactive submit/review callbacks in bounded UI timeouts, and
uses a lightweight polling interval to reload the same read model for live-ish
terminal updates. Polling is a renderer refresh of persisted local evidence; it
uses a faster interval while runs are active and a slower interval while the
workbench is idle, and does not add an event daemon, remote worker, or
incremental orchestration path.
Busy submit/review state remains local Ink state too: the renderer keeps
keyboard navigation and composer editing active, but only review-decision writes
remain single-flight while their callback is in flight. Prompt submission
callbacks are expected to return after local enqueue/start work, leaving active
agent execution to the CLI background turn and read-model polling. Scrollable
conversation state is line-based and re-anchors to the bottom when new
conversation or active-run output appears. Active-run selection and
terminal-height list windows remain local Ink state, while selected runs,
tasks, and RoleCalls continue to resolve through the existing read-model
summaries.
The command hint helper falls back from an absent selected RoleCall to
`agent-hub team roles list --project-id <project-id>`, the command palette
includes the same role-list command beside run, review, and memory commands,
the readable `Team` tab participates in the default focus cycle with the
uppercase `E` shortcut, and the `/team` slash command changes local Ink focus
to the Team read-model pane.
Because the Ink renderer is a NodeNext composite TypeScript project that imports
workspace package types, root validation runs its TUI check through
`tsc -b apps/cli/tsconfig.tui-ink.json` so project references emit the required
local declarations in clean CI checkouts without requiring prebuilt package
`dist` directories.
Visible TUI workflow changes must be judged against the rebuilt CLI artifact,
not source assumptions alone: local verification rebuilds the workspace, smokes
`node apps/cli/dist/cli.js tui --once`, launches the rebuilt interactive TUI in
normal and narrow PTY sizes, and records the result in an ignored
`docs/ui-verification/` note. This is a validation contract for the existing
CLI renderer boundary; it does not add a background runtime, renderer shell
access, or any automatic review/apply behavior.
The hand-rendered string layout has been removed from the TUI runtime path.
The current renderer direction is documented in
`docs/tui-ink-rewrite-roadmap.md`: keep the core read model and CLI action
callbacks, use a Node 22+ Ink 7 / React 19 component tree inside the CLI
boundary, and keep the ESM-only Ink code in a separate `apps/cli/src/tui-ink`
build target. The CommonJS CLI command boundary dynamically imports the
compiled `apps/cli/dist/tui-ink/entry.mjs` entrypoint; the renderer still does
not access SQLite, filesystem, git, shell, or agent adapters directly.
The Work-view conversation-terminal architecture is documented in
`docs/tui-conversation-terminal-roadmap.md`. It extends the same core read
model with conversation and active-run projections, then keeps the Ink Work
surface scoped to `ConversationFlow` and `ActiveRunBox` components. Auxiliary
Runs, Review, Graph, Tasks, Memory, Help, Palette, and the slash-command Team
pane continue to use the existing local evidence and callback boundaries.
The follow-on TUI optimization plan is documented in
`docs/tui-optimization-roadmap.md`. It remains renderer/read-model work inside
the same CLI boundary: footer command hierarchy, narrow-terminal row budgets,
attention summaries, warning hygiene, stale active-run presentation, and copy
consistency. It does not introduce new persistence, a server, background
execution, renderer-side shell access, automatic review acceptance, memory
approval, apply, merge, push, or pull request creation.
The V3 TUI refactor plan is documented in `docs/tui-v3-roadmap.md`. It proposes
the next shared shell and detail contract before changing Work, Memory, or Team
behavior. Its local implementation prompt companion is
`docs/tui-v3-implementation-prompts.md`; that prompt pack is intentionally kept
under the ignored implementation-prompt convention unless the user explicitly
asks to publish it.
