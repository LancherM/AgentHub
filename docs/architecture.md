# Architecture

Agent Hub uses a CLI-first architecture with shared local packages for the CLI
and desktop shell.

Current workspace boundaries:

- `packages/shared`: shared enums, DTOs, JSON/value types, ID/time helpers,
  process environment helpers, context bundle contracts, shell/diff/
  verification/workspace result contracts, agent kinds, context delivery
  modes, memory states, and risk levels.
- `packages/core`: domain validation, state transition helpers, repository
  interfaces, and in-memory repository implementations. Core depends only on
  shared and does not import db, task-runner, adapters, context-compiler,
  safety, or CLI.
- `packages/safety`: dangerous-command detection, deterministic safety
  scanners, risk aggregation, and risk report generation.
- `packages/agent-adapters`: the common adapter contract, adapter registry,
  `FakeAgentAdapter`, `CodexAdapter`, `ClaudeCodeAdapter`, process runner, and
  `@agent` prompt parsing. Adapters do not depend on CLI rendering.
- `packages/context-compiler`: Agent Hub-owned context store init/show/build/
  export, context pack and task brief generation, managed block handling,
  worktree overlay materialization, and approved-memory writeback helpers.
- `packages/db`: SQLite migrations, schema initialization, default database
  path resolution, and SQLite repository implementations for the core
  repository interfaces.
- `packages/task-runner`: worktree management, shell execution, git safety,
  diff collection, verification command execution, risk report orchestration,
  persisted run review aggregation, automatic proposed-memory generation,
  comparison summary generation, and task-run orchestration.
- `apps/cli`: command parsing, stateless interactive console input, threaded
  chat input, command dispatch, output rendering, debug rendering, and manual
  run-event recording. The CLI is thin over local package APIs and does not
  own orchestration logic.
- `apps/desktop`: Electron main/preload plus React renderer for the first
  local desktop shell. Main process services call the existing local
  repositories and review helpers; the renderer calls only `window.agentHub`
  and does not import Node.js, shell, filesystem, SQLite, git, or privileged
  Agent Hub packages directly.

Desktop remains a thin local shell. It does not add a web server, login, cloud
backend, remote execution path, automatic merge, automatic push, or automatic
repository export. Electron IPC registration stays in
`apps/desktop/electron/ipc.ts`, while the pure handler factory lives in
`apps/desktop/electron/ipc-handlers.ts` so shared service validation can be
tested without loading Electron. Preload uses `contextBridge` rather than
exposing `ipcRenderer`.

The desktop conversation console keeps the main-process `RunService` boundary
for run creation, live event streaming, cancellation, lightweight conversation
snapshots, and repository-backed review loading. Renderer components call
`window.agentHub.projects.list/open` for local project registration,
`window.agentHub.threads.*` for conversation orchestration, and
`window.agentHub.runs.get/cancel/onEvent` for on-demand card hydration,
cancellation, and live stream subscriptions; the preload hides channel names
and returns unsubscribe functions for live event listeners. Run subscriptions
register with the main-process emitter before replaying persisted run events,
with event-id de-duplication, so renderer cards do not miss fast fake-run
events that were written before the subscription attached. IPC handlers
validate inputs and manage per-window subscriptions, but do not own run
lifecycle logic. If the project list is empty, renderer onboarding forms submit
a local path through the same project-open IPC service before creating a starter
thread through the thread service.

Desktop review inspection is split across narrow Electron main-process
services. `ReviewService` aggregates run summary, verification, logs, memory
proposal counts, local accept/reject decision artifacts, and the latest
persisted TaskRunner safety report when one exists. Persisted non-placeholder
risk reports take precedence over the deterministic desktop fallback, including
`blocking` levels and mapped finding/risk-factor evidence, so desktop review
does not downgrade scanner output from sensitive path changes or dangerous
instructions. `DiffService` uses persisted diff artifacts when available and
can read retained worktrees with read-only Git commands through
`DiffCollector`, `NodeShellExecutor`, and safe Git configuration. It redacts
patch text before returning desktop review data when changed-file metadata or
diff headers identify sensitive paths. `RiskService`
is deterministic and evidence based; it classifies changed paths, verification
failures, large diffs, dependency/config changes, generated files, and
source-without-tests conditions without calling an LLM when no persisted
safety report is available. `MemoryService` lists and generates a small number
of conservative pending proposals, serializes generation per run, deduplicates
proposal content, and caps generated proposals for a run before mapping
approve/ignore to the existing local memory item states. All of these services
sit behind preload IPC methods, so the renderer still has no Node.js,
filesystem, SQLite, shell, child-process, or Git access.

Run review decisions are stored as local `run_artifacts` entries of kind
`review_decision`. They are not execution status transitions and they do not
mutate branches, merge output, push code, clean worktrees, delete files, or
write repository-side context files. This keeps Phase 4 review auditable while
leaving any explicit apply/merge workflow for a later phase.

`packages/core` and `packages/db` now include durable conversation thread and
message repositories backed by local SQLite tables. They store thread metadata,
ordered user/assistant/system/tool messages, optional run-card links, and JSON
metadata separately from run evidence, so run events, diffs, verification,
risks, and logs continue to live on the existing task-run model. The thread
repository also updates thread metadata, including display title and
`updatedAt`, when desktop or CLI chat appends durable messages. A separate
`conversation_thread_summaries` repository stores conservative thread-local
summaries: decisions, open items, constraints, the last known user goal, and
source-message metadata. These summaries are local audit data for one thread
only; they are not approved project memory and are not injected into other
threads.

`agent-hub chat` is the CLI path over the same durable conversation boundary.
It resolves the local project, creates or resumes a conversation thread, writes
one user message per natural-language line, runs the selected agent through the
existing `TaskRunner`, writes a run-card message plus a bounded assistant
message, and persists the generated conversation brief as run evidence.
Leading `@fake`, `@codex`, and `@claude-code` prefixes choose the agent for one
turn; otherwise chat uses the selected default agent. The chat slash commands
are local thread controls only: `/thread new`, `/thread use <id>`, `/threads`,
`/history`, and `/exit`. After each completed chat turn, the CLI refreshes the
thread-local summary deterministically from bounded transcript messages.
`threads show <thread-id>` renders that summary beside the ordered transcript.
The existing `agent-hub run` command and bare interactive shell remain
stateless and do not read or write conversation threads.
CLI chat adds one-shot code-state continuation controls with `/continue run
<id>`, `/continue message <id>`, and `/continue clear`; these controls only
populate the next `TaskRunner` input and do not promote thread context or
accept any parent branch.

`apps/desktop/electron/services/thread-service.ts` is the desktop conversation
facade over those repositories. It parses safe `@fake`, `@codex`, and
`@claude` mentions, implements `sendMessage` by appending one durable user
message, creating one run per selected agent through `RunService`, and
appending one durable run-card message plus one hidden pending assistant-output
message per run. The renderer-facing `window.agentHub.threads.*` contract
remains unchanged, but service state is loaded from SQLite through lightweight
thread reads. Thread lists do not reconcile every thread or hydrate full run
details; they derive run-card display status and active counts from
`RunService.listRunStatuses()`. Selected thread details reconcile only pending
assistant-output placeholders, and finalized assistant messages are treated as
stable transcript rows. When a run reaches `completed`, `failed`, or
`cancelled`, reconciliation uses `RunService.getConversationRunSnapshot()`,
which reads run rows and events only, to produce bounded agent-facing output or
a concise terminal summary. Raw logs, diffs, verification output, and risk
evidence remain on the run model and load through review IPC only when the user
expands a card or opens the inspector. If an older database has runs but no
conversation threads, the service performs a one-time compatibility import into
conversation rows so existing desktop run records stay inspectable.

The multi-turn architecture has persisted thread/message repositories, thread
summary storage, the desktop thread service separated from task runs, and a
package-level conversation context builder. The builder runs outside the
renderer, applies deterministic message-count and character budgets, and
produces a conversation brief that is injected through the runtime context
bundle and persisted as a `conversation_brief` run artifact. Context ordering
is current turn, recent messages, thread summary, then project context. A zero
recent-message budget includes no prior thread messages, and recent messages
are reduced when needed so thread summaries and project references remain
inside the total brief budget. Desktop first-turn runs reload the retitled
thread before building the brief so pre-created empty threads do not inject
stale `New Chat` titles. Project
context, thread context, current-turn context, and run context remain distinct
layers so thread-local decisions do not automatically promote into project
approved memory. Follow-up turns prefer terminal assistant messages over
run-card summaries for runs that have finished; run-card summaries remain
available for pending runs and compatibility imports.

The service maps desktop-facing agent IDs (`fake`, `codex`, `claude`) and run
statuses (`queued`, `running`, `verifying`, `completed`, `failed`,
`cancelled`) onto the existing core/SQLite contracts where possible. Desktop
continuation uses the same explicit intent shape over safe IPC:
renderer run cards can select a parent run/message, the composer shows a
clearable one-shot continuation chip, and `ThreadService` resolves
message-linked runs before passing parent ids to `RunService`. If both a run id
and message id are supplied, `ThreadService` validates that the message is still
linked to that parent run before forwarding the pair. The renderer does not
receive filesystem, shell, Git, or SQLite access. Current desktop
TaskRunner-backed paths require a retained parent worktree before continuing
code state and otherwise fail with a clear system message.
SQLite still stores the core run status enum, so the desktop-only `verifying` phase
is represented by live run events while the persisted core run remains
`running`; core `succeeded` is exposed to the desktop renderer as `completed`.

Desktop real execution now enters the shared `TaskRunner` from the Electron
main process. `RunService` pre-creates the queued task/run rows for stable
renderer IDs, then constructs TaskRunner with the same SQLite repositories and
a desktop ID generator that reuses the queued run id. `@fake` executes through
`FakeAgentAdapter` in an isolated worktree, while `@codex` and `@claude` use the
process-backed Codex and Claude Code adapters, including local preflight. If a
CLI is unavailable or unauthenticated, the run fails inspectably through
persisted events and review evidence instead of crashing the service. Terminal
run output is also promoted into bounded assistant transcript messages for
future thread context, but that promotion does not change execution semantics or
duplicate full evidence into message bodies. TaskRunner accepts a progress hook
and abort signal for desktop execution. The hook lets `RunService` persist and
emit context, worktree, adapter, verification, and terminal lifecycle events
while the run is active, then replay those same rows to late subscribers. The
abort signal flows through adapters into `NodeProcessRunner` and verification
shell execution; running desktop cancellation sends `SIGTERM` to process-backed
agents or verification commands and records cancelled state only for runs that
were actually stopped or had not started.

Desktop packaging is a local release concern layered over that shell. The
workspace keeps Electron/Vite bundling in `apps/desktop`, then uses
Electron Builder through `scripts/build-macos-dmg.sh` to package the generated
`out/` application into macOS DMG artifacts under `apps/desktop/release/`.
Local `@agent-hub/*` packages are bundled into the Electron main/preload output
so the packaged app does not depend on pnpm workspace symlinks at runtime. The
GitHub workflow builds x64 and arm64 DMG artifacts on macOS runners with
signing auto-discovery disabled and ad-hoc signing enabled; certificate-backed
signing and notarization are separate distribution configuration, not a
requirement for the local-first MVP packaging path.

Child process environment policy is explicit by default. `ProcessRunner` and
`ShellExecutor` build child environments from a small inherited allowlist
needed for local CLI execution: path lookup, home/config/cache locations,
temporary directories, locale/terminal flags, CI, and required Windows process
variables. They do not pass all of `process.env`, so secrets such as arbitrary
API keys or tokens are not inherited accidentally. `RunTaskInput` exposes an
explicit `environmentOverrides` field for process-backed task runs; those
overrides are forwarded to adapter detection and execution, and an override
value of `undefined` removes an allowlisted variable for that child.
`ProcessRunner` also expands `PATH` with existing local CLI directories such as
`~/.local/bin`, `~/bin`, discovered `~/.nvm/versions/node/*/bin` entries,
`/opt/homebrew/bin`, and `/usr/local/bin`. This keeps GUI-launched desktop
processes able to find locally installed `codex` and `claude` binaries without
using a shell or inheriting arbitrary environment variables. An explicit
`PATH: undefined` override disables this lookup for that child process.

The CLI calls the runner rather than owning orchestration logic. The runner
compiles context, creates a worktree workspace through a `WorkspaceManager`,
selects adapters through a registry, passes generated context to the adapter as
a payload, materializes runtime task brief/context-pack artifacts inside the
worktree, collects diff metadata, runs configured verification commands,
generates a risk report, persists run metadata and structured run records
through repository interfaces, records run status transitions, and applies
workspace cleanup policy. The default cleanup policy is `never`, so worktrees
are retained unless a caller explicitly selects cleanup behavior.

Explicit code-state continuation is modeled on the run, not on the conversation
transcript. `TaskRun` rows can reference `parentRunId` and optional
`parentMessageId`; SQLite persists those links as nullable `task_runs`
provenance columns. When `RunTaskInput.continueFrom` is supplied, the runner
requires a terminal parent run with retained worktree metadata, resolves the
parent worktree HEAD, creates a new isolated child worktree from that commit,
and copies only safe parent changed regular files into the child worktree before
adapter execution. Deletions are applied as deletions. Sensitive paths,
`.git`/`.agent-hub`, path escapes, symlinks detected by diff metadata or
preflight `lstat`, and unsupported renames reject the continuation before a
child run is created. The child run records a
`code_state_provenance` artifact with parent ids, source worktree, source HEAD,
and copied/deleted file lists; diff, verification, risk, and review records are
still generated for the child run itself.

Runner finalization is deliberately defensive after the task run row has been
created. Post-adapter stages catch and convert failures from diff collection,
verification, risk generation, artifact/result persistence, metadata
persistence, and workspace cleanup into diagnostic error events and run
warnings. The runner uses synthetic failed diff or verification results when a
stage cannot produce its normal output, marks the run `failed`, returns the
task to `open`, persists every available partial record, and still attempts
workspace cleanup according to policy. Event persistence is the last best-effort
write; if it fails after an otherwise successful run, the run is downgraded to
`failed` so it is not reported as cleanly complete without its event stream.

Interactive CLI mode is a shell over the same command/runtime path. Bare
`agent-hub` reads line-oriented input, handles slash commands locally, and
routes natural language prompts or `@agent` prompts through the existing run
command and `TaskRunner`. It keeps selected agent and project state in the CLI
layer only; it does not create a second orchestration implementation.

Run output rendering is also a CLI concern. `TaskRunner.run()` returns a
completed `RunResult`; command mode does not receive a live event callback or
stream intermediate adapter events to the terminal in this MVP slice. Normal
`run` output shows the agent-facing output extracted through the shared core
helper from fake output, structured message/error events, or raw non-JSON
stdout/stderr fallbacks after the run finalizes. Structured lifecycle/status
events are persisted for inspection and debug output but are not rendered as
normal agent output. Parser promotion is limited to assistant/agent/result
payloads, so lifecycle summaries and non-assistant message items remain status
events. It does not show Agent Hub run metadata by default, and interactive
mode does not echo prompt dispatch lines unless debug rendering is enabled.

Debug rendering remains opt-in. `--debug` or `AGENT_HUB_DEBUG=1` appends the
run summary, run boundaries, context artifact paths, verification
stdout/stderr, changed file summaries, and a truncated diff preview after the
normal agent output. It does not alter runner inputs, adapter behavior,
persistence, or exit status.

Manual run-event recording is a CLI persistence operation, not an adapter or
runner behavior. `run event add` loads the target run through
`TaskRunRepository`, validates the event type against the domain enum, appends
the event through `RunEventRepository`, and derives the next sequence number
from existing events for that run. This keeps manual notes in the same ordered
event stream as adapter-captured output while avoiding any task execution.
The persisted MVP event enum is intentionally closed to `stdout`, `stderr`,
`message`, `status`, `error`, and `exit`. Agent CLI tool-call records are not a
first-class storage type in this slice; process adapters preserve the original
JSONL line as stdout and may emit a `status` event whose metadata contains the
parsed adapter payload. Domain validation, SQLite checks, manual CLI event
validation, and review rendering all use that same six-type model.

Persisted run review aggregation lives in `packages/task-runner`. The CLI
parses `runs events <run-id>` and `runs diff <run-id> [--stat|--patch]`, then
delegates repository-backed loading of ordered events, latest `git_diff`
artifacts, changed-file metadata, diff stats, and patch truncation to the local
package. That package redacts patch text for sensitive paths before CLI
rendering, even when `--full` is requested. This keeps review commands
read-only and process-independent while
avoiding comparison or artifact aggregation logic in the CLI layer.

Safety review is separated from report rendering. `SafetyScanner` scans the
collected diff, changed-file metadata, verification command text, and captured
adapter run-event text and returns structured findings. Sensitive path changes
and dangerous command findings use `level: blocking`; aggregation preserves
that level instead of coercing it to high. Dangerous command detection is shared
by `SafetyScanner` and `ShellExecutor`, so configured verification commands and
generated/diff text use the same rules for `sudo`, `rm -rf /`, `chmod -R 777`,
`curl | sh`, `wget | sh`, `git push --force`, and `git clean -fdx`, including
common `sh -c` and `bash -lc` wrappers. `RiskReportGenerator` adds verification
and manual-review context around those scanner findings and the task runner
persists the resulting report to `risk_reports` for both successful and failed
runs.

The MVP risk input boundary is intentionally bounded. The runner scans adapter
stdout, stderr, parsed structured messages, error/status events, and exit
metadata because those are persisted as ordered run events. It does not
recursively read arbitrary files from the retained worktree or scan every
artifact blob beyond the diff and the event stream in this phase; future
artifact types can opt into the same `SafetyScanner` text boundary when they
become first-class logs.

The default agent registry includes fake, Codex, and Claude Code adapters.
Real adapters run only inside the isolated worktree cwd. They use
`ProcessRunner` to spawn executables with argument arrays and stdin; no shell
interpolation is used. Runtime injection remains the default: task brief and
context are sent through stdin, while the generated worktree-local
`.agent-hub/tasks/<task-id>/` files are available for inspection. The adapters
do not use permission-bypass flags, do not push, do not merge, and do not delete
branches.

Process detection is non-fatal and is part of real-adapter run preflight.
`CodexAdapter.detect()` runs `codex --version` and
`ClaudeCodeAdapter.detect()` runs `claude --version`; missing commands,
non-zero exits, or setup/authentication failures return `available: false` with
a reason. `CodexAdapter.run()` and `ClaudeCodeAdapter.run()` validate the
worktree and generated task brief boundary before run-scoped detection, and
that detection runs from the isolated worktree cwd with the run environment.
Unavailable adapters emit an error event and failed exit event without
launching the executable. Available adapters emit a preflight status event,
then stdout and stderr become `RunEvent` rows. Valid
JSONL stdout lines are additionally mapped to message/status/error events,
malformed structured output remains preserved as raw stdout, and exit events
record both exit code and signal metadata. A non-zero exit marks the run failed,
and the failed run is still persisted through the same repositories as
successful runs.

The context compiler owns the boundary for generated context artifacts. It can
initialize and inspect context stores, read external context from Agent
Hub-owned app data by default, build typed context packs and task briefs, and
perform explicit repository exports. Missing optional context files are
reported as warnings rather than causing context builds to fail. The default
external store path is:

```text
<agent-hub-app-data>/context-stores/<project-id>/
  context/project.md
  context/architecture.md
  context/conventions.md
  context/testing.md
  context/security.md
  memory/approved.md
  skills/<skill-name>/SKILL.md
```

File-backed skills are parsed from YAML-style `SKILL.md` frontmatter. A valid
skill must declare both `name` and `description`; the context compiler uses the
declared values in context bundles and skips empty or malformed skill files
with deterministic warnings. Export and worktree overlay flows reuse the same
parser, so malformed skills are not copied into `.claude/skills` or
`.agents/skills`. Export and overlay paths use the context-store directory id,
not the frontmatter display name, so a malformed-looking display name cannot
collapse paths outside the intended skill folder.

Repo-local context stores remain opt-in through `--mode repo_local`. Repository
export remains opt-in through `context export --target repo --dry-run` or
`context export --target repo --write`; dry-run produces previews without
writing, while write mode updates managed blocks in `AGENTS.md` and optionally
`CLAUDE.md`. The CLI and context-compiler export boundary only accept the
`repo` target, repeated `--target` flags are rejected, and omitting `--target`
keeps that repo-export default for compatibility. Approved memory is part of
the rendered context store export
when `memory/approved.md` contains non-placeholder content; the
`--include-approved-memory` flag does not broaden the boundary and only makes
that default explicit in command output. Managed block replacement preserves
user-authored content outside the block and does not treat fenced code examples
of the markers as real blocks.

`runtime_injection` is still the default delivery mode. In this mode the runner
writes only worktree-local runtime files under `.agent-hub/tasks/<task-id>/` and
passes the generated context to the adapter. `worktree_overlay` additionally
materializes managed `AGENTS.md`, `CLAUDE.md`, and skill copies under
`.claude/skills` and `.agents/skills`, but only inside the isolated worktree.
The CLI validates `context build` and task run delivery modes against that
two-value set, and the task runner enforces the same boundary for runs.
`repo_export` is reserved for explicit repository export flows and is rejected
outside those flows.
Existing non-empty skill files are not overwritten without warning. All runtime
artifact writes reject symlink path components before writing so a generated
artifact path cannot escape the worktree or export root. Persisted task brief
artifacts use the generated in-memory task brief content rather than rereading
worktree runtime files, so a failed materialization path cannot disclose a
symlink target into Agent Hub storage.

Overlay materialization returns generated-file baselines and warnings to the
runner. Baselines are passed into diff collection so unchanged Agent Hub
generated files are excluded, while agent-modified generated files stay
reviewable. Overlay warnings are propagated through `RunResult.warnings` and
normal CLI summary output.

Diff collection records untracked symlinks as symlinks while omitting their
targets from changed-file metadata, synthetic diff text, and file summaries.
This keeps review metadata useful without disclosing absolute target paths from
outside the isolated worktree.

The repository interfaces remain the storage boundary. In-memory repositories
are kept for focused tests and injected runtimes. The CLI default runtime uses
SQLite repositories, initialized by simple versioned migrations, with the
database stored under Agent Hub application data by default:

- macOS: `~/Library/Application Support/Agent Hub/agent-hub.sqlite`
- Windows: `%LOCALAPPDATA%/Agent Hub/agent-hub.sqlite`
- Linux: `$XDG_DATA_HOME/agent-hub/agent-hub.sqlite` or
  `~/.local/share/agent-hub/agent-hub.sqlite`

`AGENT_HUB_HOME` overrides the app data directory, `AGENT_HUB_DB_PATH`
overrides the exact database file, and the CLI global `--db <path>` selects a
database file for that invocation. These paths are Agent Hub-owned storage and
are not written into the target repository.

The SQLite schema is initialized through versioned migrations. It covers
`projects`, `agent_profiles`, `tasks`, `task_runs`, `run_events`,
`run_artifacts`, `verification_results`, `risk_reports`,
`conversation_threads`, `conversation_messages`,
`conversation_thread_summaries`, `memory_items`, `comparison_reports`,
`skills`, `settings`, `status_transitions`, and legacy `run_metadata`. The
task runner writes adapter events to `run_events`, diff payloads to
`run_artifacts`, verification command rows to `verification_results`, and
generated risk reports to `risk_reports`. The legacy aggregate `run_metadata`
remains for compatibility with existing show paths and is no longer the only
persisted source for run inspection.

Migration version 3 rebuilds the early `tasks` and `task_runs` tables to add
database constraints that SQLite cannot add in place. Existing
valid rows are copied forward, `tasks.project_id` cascades from `projects`,
`task_runs.agent_profile_id` references `agent_profiles` with delete-to-null
semantics, task statuses and run statuses use enum-like `CHECK` constraints,
and task-run agent kinds are checked at the table boundary. The migration
guards abort before rebuilding if existing rows would violate those
relationships or enum values.

Migration version 7 rebuilds `risk_reports` so list-shaped risk evidence is
constrained as JSON arrays at the SQLite boundary. Existing legacy scalar or
object-shaped risk list payloads are normalized to empty arrays during the
local migration rather than being exposed through the typed repositories.
Migration version 8 repeats the `conversation_thread_summaries` table creation
with `IF NOT EXISTS` as a compatibility backfill for databases that recorded an
intermediate version 6 marker before the thread-summary migration reached
`main`.

Repository implementations enforce the imported state diagrams before writing
status updates. Tasks may move `open -> running -> completed`, return from
`running` to `open` after a failed run, or cancel from `open`/`running`; task
runs move through `queued -> running -> succeeded` or `failed`, with
cancellation from `queued` or `running`; memory items move only from `proposed`
to `approved` or `rejected`. Repeating the same status remains idempotent, but
invalid terminal transitions are rejected in both SQLite and in-memory
repositories, including the in-memory task-run `updateStatus()` path used by
focused runner tests and injected runtimes.

Settings use the same domain validation before repository writes. Both
in-memory and SQLite settings repositories reject secret-like key names such as
API keys, tokens, secrets, passwords, private keys, and credentials across
delimiter-separated and camelCase setting names, and they also reject string
values that look like embedded secret assignments, bearer tokens, common
service tokens, or private key blocks. Safe local UI and behavior flags,
including per-project desktop verification command lists, remain valid setting
values. Desktop verification command validation rejects secret-like option
names inside structured args before the list reaches the settings repository.

When the CLI executes an ad-hoc SQLite-backed run, it first looks up a project
by the resolved repository root. The first legacy ad-hoc root can keep the
`adhoc_project` id for compatibility; if that id already belongs to a different
root, the CLI creates a deterministic root-scoped ad-hoc project id before
calling the runner. That preserves the task-to-project foreign-key contract
without attaching later ad-hoc tasks or memory writeback to the wrong local
repository. During SQLite migration 3, legacy task project ids that do not yet
have a `projects` row are backfilled as local legacy projects before the task
tables are rebuilt with foreign-key constraints.

Memory items remain SQLite domain records until the user explicitly acts.
`memory propose` creates a `proposed` row, `memory reject` moves it to
`rejected`, and `memory approve` moves it to `approved` and appends the memory
content to the Agent Hub-owned context store under `memory/approved.md`.
Approved-memory writeback uses the same context store path resolution as
context init/build, so the default destination is app data rather than the
project repository. The context compiler reads approved memory only from that
file provider and treats the default `# Approved Memory` heading as an empty
placeholder; proposed and rejected database rows are not injected, and
placeholder content does not become a context-pack memory section.
After a task run is finalized and persisted as `succeeded`, the task runner
reloads durable run evidence through repositories before generating memory
proposals. The generator uses conservative signals such as persisted
verification commands, diff changed-file metadata, and the latest risk report;
it skips secret-like verification command text, does not inspect transient
adapter state, and does not write to the approved-memory context store.
Generated items are deduplicated by normalized project content, capped per
task, and created only as `proposed` memory rows. A generation failure is
reported as a run warning without changing the completed run status.

Comparison reports are generated from persisted run data rather than process
memory or UI state. `packages/task-runner` loads each selected run, diff
artifacts or legacy metadata, verification rows, and latest risk reports, then
returns a readable summary plus structured comparison details that the CLI
stores in `comparison_reports`. The details JSON captures changed-file
overlap, diff-size deltas, verification counts and failed-check deltas, risk
rank deltas, risk factors, and a deterministic review score. Missing risk data
is ranked conservatively above persisted `low` and `medium` risk and below
persisted `high` and `blocking` risk for tradeoff wording. The score starts
from 100 and applies explainable penalties for non-succeeded status, higher
risk, failed checks, skipped verification, and larger diff footprint; it is a
review signal, not an acceptance decision. Comparison is review-only and
performs no accept, merge, branch delete, or push action.

The first desktop runtime integration is deliberately narrow. `apps/desktop`
uses SQLite-backed services for project registration, run listing/detail,
inspector review tabs, verification rows, risk reports, and memory proposal
decisions. `runs.create` records a queued desktop run through repository
interfaces, then the main process calls TaskRunner with those same repositories.
TaskRunner creates the isolated worktree, materializes runtime-only task
artifacts, runs `FakeAgentAdapter`, `CodexAdapter`, or `ClaudeCodeAdapter`,
collects diffs, records skipped verification when no commands are configured,
persists risk and metadata, and generates proposed memory for successful runs.
It does not export repository context, merge, push, approve memory, or apply
code automatically.

Desktop verification configuration is owned by a main-process settings service.
The renderer can only read or save per-project command lists through the
sandboxed preload API. Saved commands are structured as executable plus args,
persisted in the local `settings` table under a project-scoped key, validated
for shape and secret-like content, including API key, token, password,
private-key, and client-secret option names inside args, and loaded by
`RunService` immediately before invoking TaskRunner. TaskRunner remains the
execution boundary and continues to run verification in the isolated worktree
with dangerous-command validation.

All adapters run against an isolated worktree and refuse to run when that
directory is the original project root or when the generated task brief is
outside the isolated directory. Codex is invoked as `codex exec --json -`.
Claude Code is invoked as `claude --print --output-format stream-json`.

The diff collector first reads git status, then filters generated files against
the baselines returned by context overlay materialization. Generated files are
hidden only when their current content still matches the Agent Hub baseline; if
the agent changes them, they become normal reviewable diff entries. Raw diff
commands are scoped to the filtered tracked paths, and bounded untracked text
files get synthetic patch content. Before reading untracked files, the collector
uses `lstat` to avoid dereferencing symlinks, records symlink targets via
`readlink`, verifies readable real paths remain inside the isolated worktree,
and omits synthetic content for oversized files. Binary files are represented
with metadata such as binary status and byte size. CLI debug rendering redacts
the raw diff preview when the risk report contains a blocking sensitive-path
finding, or when the diff changed-file metadata itself matches a sensitive path
before a risk report is available.

Shell usage is limited to `ShellExecutor` and `ProcessRunner` implementations.
Git worktree, git diff, verification commands, and real agent processes use
executable-plus-args calls with explicit cwd; task prompts are never
interpreted as shell commands. Git operations additionally go through the
Git safety helpers, which set non-interactive/hardened Git environment and
command-line config overrides, disable external diff/textconv for diff
collection, and reject repository-local Git config keys such as `core.fsmonitor`,
executable filters, external diff drivers, textconv commands, and config
includes before invoking Git. Repository-local `core.hooksPath` is allowed
because Agent Hub Git invocations explicitly override it with `/dev/null`. The
local Git config scanner checks the
repository config, common config, and worktree config files, and its parser
accepts Git-style section comments and subsection names that contain dots so
filter and diff driver helpers cannot bypass the pre-flight gate.

Workspace creation performs collision preflights before `git worktree add`.
An existing target worktree path fails before invoking Git, and an existing
deterministic task/agent branch fails with a clear workspace error instead of
attempting automatic cleanup, branch deletion, merge, push, or acceptance.
Verification commands run with the isolated worktree as cwd. Dangerous command
rejection is represented as a failed verification command, and shell results
rejection is represented as a failed verification command. `VerificationRunner`
passes a 10-minute timeout to `ShellExecutor` when a command omits `timeoutMs`,
while explicit command timeouts remain overrides. Desktop abort signals are
forwarded to `ShellExecutor`, so cancellation can terminate a running
verification command and preserve the run as `cancelled`. Shell results carry
timeout and signal metadata so callers can distinguish command failures from
process termination. If a run has no configured verification commands, the
verification suite remains skipped and the task runner adds a warning to
`RunResult.warnings`; normal CLI output stays agent-facing, while debug output
renders the warning through the existing run-summary path.
Desktop runs source configured verification commands from the selected
project's local settings and pass `undefined` to TaskRunner when the saved list
is empty, so the inspector shows skipped verification rather than a silent pass.

The physical package split is present and now includes both user-facing app
packages. Cross-package contracts flow through `packages/shared` and
`packages/core`; task-runner consumes context compiler, agent adapters, safety,
and core repositories; `apps/cli` and `apps/desktop` call local package APIs or
main-process services instead of duplicating orchestration. Future
restructuring should preserve that direction and keep desktop orchestration
logic outside the renderer.

The planned local AI workgroup transformation is documented in
`docs/local-ai-workgroup-roadmap.md`. Architecturally, the first phases should
layer room, configurable role/participant, executor, timeline, artifact,
decision, and knowledge semantics on top of the existing local conversation and
run evidence boundaries instead of starting with a broad schema rewrite.
`ConversationThread` can initially serve as the room timeline record. Role
records should not be a closed enum: preset roles can seed defaults, while
user-defined roles carry capability, persona, permission, context, approval,
and executor metadata. The first runnable executor maps to existing adapter
kinds, and the role model should leave space for future LLM API, local
workflow, and human executors. Run artifacts/review evidence can back the first
artifact, check, risk, and memory inspector panels. New first-class tables such
as `rooms`, `roles`, `participants`, `role_executors`, `task_assignments`,
`timeline_events`, `artifacts`, `decisions`, or `packs` should be added only
when the metadata-backed model no longer satisfies a specific query, lifecycle,
or governance need.

Repository CI/CD lives in `.github/workflows/ci-cd.yml` and stays outside the
Agent Hub runtime. The workflow installs the pinned pnpm and Node versions from
the root package, runs the same local validation commands documented for
developers, uploads a built CLI package artifact for `main` and manual runs,
and publishes that artifact to GitHub Releases only for `v*.*.*` tags. The
artifact includes the workspace package sources, root scripts, tests, CI
workflow, and root TypeScript/Vitest configs so the root package scripts remain
executable after extraction. Release publishing uses the repository-scoped `GITHUB_TOKEN` with
`contents: write` on the release job only. There is no deployment target,
external backend, custom secret, remote task execution, or automatic code push
in the CI/CD path.

Desktop is no longer architectural only. The first shell lives under
`apps/desktop`, calls local services through Electron IPC, and renders projects,
conversation threads, inline run cards, diffs, verification, risk, and memory
proposal data from local SQLite repositories. It does not add an API server.
Desktop run creation now reuses TaskRunner and the shared fake/Codex/Claude
adapter layer from the Electron main process. The inspector accept/reject flow
records review decisions only; merge, push, PR creation, worktree cleanup,
repository context export, and code application remain explicit future
workflows.
