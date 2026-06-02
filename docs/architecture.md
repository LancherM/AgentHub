# Architecture

Last audited against `origin/main` at `8052f3d` on 2026-06-01.

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
  output extraction, RoleCall parsing, RoleCall orchestration, RoleCall context,
  RoleResult helpers, graph convergence helpers, and bounded current-context
  TUI read models over existing persisted evidence.
- `packages/db` owns SQLite migrations, default database path resolution, a
  queued `sqlite3` session driver, and SQLite implementations of the core
  repository interfaces.
- `packages/context-compiler` owns Agent Hub context stores, context pack and
  task brief generation, conversation brief building, managed-block export,
  worktree overlay materialization, approved-memory writeback, and project or
  global skill resolution.
- `packages/agent-adapters` owns the adapter interface, adapter registry,
  `FakeAgentAdapter`, `CodexAdapter`, `ClaudeCodeAdapter`, process preflight,
  JSONL event mapping, and direct process spawning through `ProcessRunner`.
- `packages/task-runner` owns worktree creation, git safety preflight, adapter
  execution, progress events, verification, diff collection, risk report
  persistence, memory proposal generation, comparison report aggregation,
  code-state continuation, RoleCall TaskRunner execution, and cleanup policy.
- `packages/safety` owns dangerous-command detection, diff/event safety scans,
  risk report generation, and RoleCall policy validation.
- `apps/cli` owns command parsing, interactive shell behavior, persistent chat
  and room command UX, the read-only TUI renderer/key handling, output
  rendering, debug rendering, and CLI-only persistence operations such as
  manual run-event recording.
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
4. Create an isolated git worktree under the configured Agent Hub worktree base.
5. Materialize generated runtime files inside the worktree.
6. Run the adapter from the worktree cwd with runtime-injected context.
7. Persist ordered run events and progress events as they are produced.
8. Run structured verification commands in the worktree.
9. Collect diff metadata and a bounded persisted patch artifact.
10. Generate and persist a safety/risk report.
11. Persist run artifacts, run metadata, status transitions, and warnings.
12. Generate conservative proposed memory from durable evidence for successful
    runs.
13. Apply cleanup policy without accepting, merging, pushing, or deleting
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
their targets. Sensitive patch text is redacted before CLI or desktop review
rendering.

Verification uses structured executable-plus-args commands. Dangerous commands
are refused by `ShellExecutor` and represented as failed verification results.
Default command timeout is 10 minutes unless a command provides its own
`timeoutMs`. Abort signals flow through adapters and verification so desktop
cancellation can terminate process-backed runs or checks with `SIGTERM`.

## Persistence

The default SQLite database is in Agent Hub app data. `AGENT_HUB_HOME`,
`AGENT_HUB_DB_PATH`, and CLI `--db` provide local overrides.

The current schema covers:

- `projects`, `agent_profiles`, `tasks`, `task_runs`, `status_transitions`;
- `run_events`, `run_artifacts`, legacy `run_metadata`;
- `verification_results`, `risk_reports`, `comparison_reports`;
- `conversation_threads`, `conversation_messages`,
  `conversation_thread_summaries`;
- `memory_items`, `skills`, `settings`;
- `role_calls`, `role_todos`, `role_call_events`.

SQLite migrations add constraints that mirror the domain model: task and run
status checks, agent-kind checks, project/run relationships, JSON column
validation, risk-list array constraints, parent-run provenance, role metadata,
task metadata, and RoleCall audit indexes. In-memory repositories enforce the
same state transitions for tests and injected runtimes.

Settings reject secret-like keys and values at the domain/repository boundary.
Desktop verification command settings also reject secret-like option names in
args before storage.

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

CLI chat, room sends, and desktop room turns resolve role handles in the local
service layer. Runnable participants create TaskRunner-backed runs under one
shared task when appropriate; non-runnable participants stay visible in
assignment metadata.

## Adaptive Role Calls

Adaptive Role Calls are the local control-plane for role-to-role delegation.
They are not direct role chat and not a remote workflow engine.

The flow is:

1. A role-backed assistant response emits line-start `@role task` syntax.
2. The Electron main-process thread service parses the output with the core
   RoleCall parser, ignoring fenced code and unknown roles.
3. The RoleCall orchestrator validates caller/callee roles, policy, graph
   limits, duplicate suppression, todo capacity, permissions, approval gates,
   executor capability, and dangerous command text through safety policy.
4. Accepted, deferred, rejected, waiting-context, or waiting-approval decisions
   are persisted as RoleCall and RoleCallEvent records. Callee todos are
   created or updated where applicable.
5. Accepted executable `agent_adapter` calls are started through
   `RoleCallTaskRunnerExecutor`, which reuses the normal TaskRunner path and
   links the resulting `task_run` to the RoleCall.
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
  resolution, workflow metadata, assistant-output reconciliation, RoleCall
  parsing, and delegated run-card creation.
- `RunService`: run creation, TaskRunner integration, live event subscription,
  cancellation, continuation, and RoleCall execution bridge.
- `ReviewService`, `DiffService`, and `RiskService`: inspector summary,
  artifacts, logs, diffs, verification, risk, retained-worktree handoff, and
  fallback deterministic risk.
- `LifecycleService`: explicit keep, cleanup, preview apply, and confirmed
  local apply.
- `MemoryService`: proposal listing/generation, explicit approve, and ignore.
- `ComparisonService`: same-task or same-turn local run comparison.
- `KnowledgeService`: project-scoped memory, summary, and decision read model.
- `TeamService`: preset overrides and custom role settings.
- `SettingsService`: validated per-project verification command settings.

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
status, branches, files, memory, or cleanup state.

Lifecycle actions are separate audited operations. Cleanup validates retained
worktree ownership and exact confirmation before removing an Agent Hub-owned
worktree. Local apply validates latest risk, blocks `blocking` risk, writes the
raw persisted patch to an Agent Hub temp path, runs `git apply --check`, and
then runs `git apply` only after human confirmation. It does not commit, merge,
push, create pull requests, delete branches, export context, or approve memory.

Memory approval is explicit. Approved items are appended idempotently to the
Agent Hub-owned context store; proposed and rejected SQLite rows are never
injected.

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
pnpm build
pnpm desktop:build
pnpm desktop:dist:mac
```

GitHub CI runs local validation and builds CLI package artifacts and macOS DMG
artifacts. Release workflows publish repository artifacts only; they do not
deploy services or change the local-first runtime model.

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
  automatic acceptance, merge, push, PR creation, or memory promotion.

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
moves the shortcut-labelled Work/Runs/View/Graph/Tasks/Memory/Help tabs below
the composer, and uses Ink components for terminal layout instead of
hand-wrapped string panels.
Active-run boxes cover running runs only. They use a fixed eight-line shape:
title border, five output/progress lines, cursor indicator, and bottom border.
They prefer structured assistant output, then fall back to recent lifecycle,
adapter, stdout, and stderr events while filtering raw JSON protocol frames.
Verification, risk, diff, and review evidence stay out of active boxes.
Terminal pending-review runs fold into the conversation projection as a single
awaiting-review line pointing to the View pane, while completed or failed runs
with a recorded review decision render their agent-facing output plus
verification and risk summary lines. The Work view remains prompt-first, and
printable keys do not trigger audit mutations.
The direct CLI entrypoint exits after command completion, so one-shot TUI smoke
renders do not leave local SQLite helper processes holding the terminal open.
For interactive launches, the CLI default IO includes `process.stdin`, and the
TUI also falls back to `process.stdin` for TTY/raw-mode detection when a custom
test IO object omits stdin. This keeps `agent-hub tui` interactive in a real
terminal while preserving deterministic `--once` and non-TTY smoke renders.
Composer editing is handled in the Ink component state before shortcut
dispatch: printable keys update the composer, `/team` clears the composer and
switches to the Team view, `Enter` submits other non-empty composer text,
empty-composer `Enter` is a no-op, `Esc` clears composer text or returns
auxiliary panes to Work, and `Tab` remains a focus-navigation key even while
text is present. This keeps role/review shortcuts from stealing normal prompt
text without trapping focus inside the composer.
Interactive TUI prompt submission reuses the CLI chat/task-runner path with a
buffered CLI IO adapter. The run still persists messages, run cards, run
events, diffs, risks, and review evidence through the shared repositories, but
agent stdout and debug text do not write directly to the Ink terminal surface;
the TUI refreshes from the persisted read model instead. Because TaskRunner now
persists emitted run events before final completion, the refresh loop can show
active adapter progress without adding a separate live-log channel.
The Ink app never reads SQLite, git, shell, or filesystem directly. It receives
`loadModel`, `submitPrompt`, and `recordReviewDecision` callbacks from the CLI
boundary, wraps interactive submit/review callbacks in bounded UI timeouts, and
uses a lightweight polling interval to reload the same read model for live-ish
terminal updates. Polling is a renderer refresh of persisted local evidence; it
does not add an event daemon, remote worker, or incremental orchestration path.
Busy submit/review state remains local Ink state too: the renderer keeps
keyboard navigation and composer editing active, but gates additional submit or
review-decision writes until the in-flight callback finishes. Scrollable
conversation state is line-based and re-anchors to the bottom when new
conversation or active-run output appears. Active-run selection and
terminal-height list windows remain local Ink state, while selected runs,
tasks, and RoleCalls continue to resolve through the existing read-model
summaries.
Review decision callbacks resolve the selected run through the Ink focus state
before using the read-model review default, keeping audit writes tied to the run
the Review pane displays as selected.
The command hint helper falls back from an absent selected RoleCall to
`agent-hub team roles list --project-id <project-id>`, the command palette
includes the same role-list command beside run, review, and memory commands, and
the `/team` slash command changes local Ink focus to the Team read-model pane.
Because the Ink renderer is a NodeNext composite TypeScript project that imports
workspace package types, root validation runs its TUI check through
`tsc -b apps/cli/tsconfig.tui-ink.json` so project references emit the required
local declarations in clean CI checkouts without requiring prebuilt package
`dist` directories. Under Vitest, the CLI TUI loader may import the source
`apps/cli/src/tui-ink/entry.mts` entrypoint when ignored CLI build output is
absent; production CLI loading continues to use built `.mjs` entrypoints.
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
