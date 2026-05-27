# Architecture

Agent Hub uses a CLI-first architecture with shared local packages for the CLI
and desktop shell.

Current workspace boundaries:

- `packages/shared`: shared enums, DTOs, JSON/value types, ID/time helpers,
  process environment helpers, context bundle contracts, shell/diff/
  verification/workspace result contracts, agent kinds, workgroup role and
  executor contracts, context delivery modes, memory states, and risk levels.
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
`window.agentHub.projects.list/open/selectDirectory` for local project registration,
`window.agentHub.threads.*` for conversation orchestration, and
`window.agentHub.runs.get/cancel/onEvent` for on-demand card hydration,
cancellation, and live stream subscriptions; the preload hides channel names
and returns unsubscribe functions for live event listeners. Run subscriptions
register with the main-process emitter before replaying persisted run events,
with event-id de-duplication, so renderer cards do not miss fast fake-run
events that were written before the subscription attached. IPC handlers
validate inputs and manage per-window subscriptions, but do not own run
lifecycle logic. If the project list is empty, renderer onboarding forms either
accept a pasted local path or ask the Electron main process to open the system
directory picker, then submit the selected path through the same project-open
IPC service before creating a starter thread through the thread service.
The renderer composer remains a local control surface: it reads enabled role
summaries through `window.agentHub.team.getWorkspace(projectId)`, builds
autocomplete suggestions and target chips in React, and still submits only the
prompt text plus context mode through `window.agentHub.threads.sendMessage`.
Role authority stays in the Electron main-process thread service, which
re-resolves all role handles before task/run creation.

Desktop review inspection is split across narrow Electron main-process
services. `ReviewService` aggregates run summary, verification, logs, memory
proposal counts, local accept/reject decision artifacts, the latest persisted
conversation brief artifact, bounded artifact metadata derived from existing
`run_artifacts`, and the latest persisted TaskRunner safety report when one
exists. The desktop-facing inspector maps that evidence to compact workgroup
tabs named Brief, Evidence, Artifacts, Memory, and Audit. Evidence is a
renderer grouping over existing review IPC for verification, risk, context
availability, and lifecycle summary; Deep mode exposes the longer lifecycle
controls while leaving the default drawer narrow. Full conversation-brief
content remains available through artifact evidence rather than a separate
top-level tab. Artifacts are exposed by
`ReviewService.getArtifacts(runId)`, which maps persisted run artifacts into a
local metadata model with title, type, source run/task ids, optional thread id,
creator, summary, availability, and a capped content preview. This Phase 6
model intentionally reuses `run_artifacts` instead of adding an artifact table,
so existing task briefs, conversation briefs, diffs, review decisions, and
provenance records remain readable. The renderer may shorten long artifact kind
labels in the inventory for fit, but it keeps the original kind in the artifact
model and element title. `git_diff` artifact previews apply
sensitive-path patch redaction before content crosses IPC, matching the diff
review boundary while preserving raw run evidence in local persistence.
Handoff, comparison, and diff data remain inside the Artifacts tab as
engineering evidence. Persisted non-placeholder risk reports take precedence
over the deterministic desktop fallback, including `blocking` levels and
mapped finding/risk-factor evidence, so desktop review does not downgrade
scanner output from sensitive path changes or dangerous instructions.
`DiffService`
uses persisted diff artifacts when available and can read retained worktrees
with read-only Git commands through
`DiffCollector`, `NodeShellExecutor`, and safe Git configuration. It redacts
patch text before returning desktop review data when changed-file metadata or
diff headers identify sensitive paths. `ReviewService` also owns the retained
worktree handoff boundary: it validates retained worktree metadata, cleanup
state, absolute paths, recorded workspace path matches, and Agent Hub workspace
base containment before returning a path, branch, refs, changed files, and
review-only local commands. Opening a worktree or copying handoff values uses
injected Electron shell/clipboard helpers behind IPC so the renderer never
chooses arbitrary clipboard content or opens filesystem paths directly.
`RiskService`
is deterministic and evidence based; it classifies changed paths, verification
failures, large diffs, dependency/config changes, generated files, and
source-without-tests conditions without calling an LLM when no persisted
safety report is available. `LifecycleService` owns explicit post-run local
actions. It reuses `ReviewService` for retained-worktree, diff, and risk
evidence; validates workspace ownership before cleanup; requires exact
confirmation phrases for cleanup and apply; records every keep, cleanup,
preview, blocked apply, failed apply, and completed apply decision as a
`lifecycle_audit` run artifact plus a lifecycle run event; and appends a linked
room timeline event when a conversation message is associated with the run.
Cleanup invokes hardened `git worktree remove --force` only for a retained
Agent Hub-owned worktree. Apply writes raw persisted diff content, not the
bounded or redacted inspector preview, to a temporary Agent Hub process path,
runs safe `git apply --check`, then safe `git apply` against the local project
checkout only when the latest risk level is not `blocking` and the
confirmation phrase matches. The service does not commit, merge, push, delete
branches, create pull requests, approve memory, or export repository context.
`MemoryService` lists and generates a small number
of conservative pending proposals, serializes generation per run, deduplicates
proposal content, and caps generated proposals for a run before mapping
ignore to the rejected memory item state. Its explicit approve path moves items
to `approved`, appends them to the Agent Hub-owned approved-memory context file
through the shared context-compiler helper, and returns the local writeback path
for inspector confirmation. `KnowledgeService` is a read model over existing
repositories: `memory_items`, `conversation_thread_summaries`,
conversation threads/messages, task runs, tasks, and `review_decision`
`run_artifacts`. It returns project-scoped knowledge rows with bounded
previews, source links, audit entries, and counts for proposed, approved,
rejected, summary, and decision records. It does not add a decisions table,
promote thread summaries, approve memory, or read files. The renderer opens the
workspace through `window.agentHub.knowledge.getWorkspace(projectId)` and still
uses the existing explicit memory approve/reject IPC methods for proposed
memory actions. All of these services sit behind preload IPC methods, so the
renderer still has no Node.js, filesystem, SQLite, shell, child-process, or Git
access.

Run review decisions are stored as local `run_artifacts` entries of kind
`review_decision`. They are not execution status transitions and they do not
mutate branches, merge output, push code, apply patches, clean worktrees,
delete files, or write repository-side context files. Retained-worktree handoff
is manual review assistance only. The separate `LifecycleService` provides the
only desktop cleanup and local apply paths, and both remain explicit,
audited, confirmation-gated IPC operations.

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

Desktop rooms are currently metadata-backed conversation threads, not a
separate table. `roomType`, `roomHandle`, `description`, `pinned`, and
`sharedContextEnabled` live in `conversation_threads.metadata`, and the
desktop thread service seeds `#general`, `#planning`, `#research`, `#review`,
and `#knowledge` for each known project with shared context enabled by
default. Legacy conversation threads that do not have room metadata are mapped
as readable custom rooms with shared context enabled so the room navigation
does not invalidate existing transcript data.

`agent-hub chat` is the CLI path over the same durable conversation boundary.
It resolves the local project, creates or resumes a conversation thread or
metadata-backed room, writes one user message per natural-language line, runs
the selected agent through the existing `TaskRunner`, writes a run-card message
plus a bounded assistant message, and persists the generated conversation
brief as run evidence. Leading enabled adapter prefixes such as `@codex` and
`@claude-code` choose the agent for one turn; otherwise chat uses the selected
default enabled agent. `@fake` is accepted only when the internal
debug/development agent availability policy enables it.
Enabled workgroup role mentions such as `@researcher` or custom saved roles
resolve through the CLI role store, create one shared task with assignment
metadata, and execute each runnable `agent_adapter` participant through
TaskRunner with `taskStatusMode: "shared_task"`. Non-runnable `human`,
`llm_api`, and `workflow` role executors stay as assignment metadata only.
Shared-task aggregation consults executable assignment metadata as well as run
rows, so an assignment that fails before creating a run can still let the task
leave `running` once no executable assignment is pending.
The chat slash commands include room and role controls: `/thread new`,
`/thread use <id>`, `/threads`, `/rooms`, `/room use <handle>`,
`/room create <handle> [title]`, `/room timeline`, `/roles`, `/role <handle>`,
`/history`, and `/exit`. After each completed chat turn, the CLI refreshes the
thread-local summary deterministically from bounded transcript messages.
`threads show <thread-id>` and `rooms timeline` render the ordered transcript.
The existing `agent-hub run` command and bare interactive shell remain
stateless and do not read or write conversation threads.
CLI chat adds one-shot code-state continuation controls with `/continue run
<id>`, `/continue message <id>`, and `/continue clear`; these controls only
populate the next `TaskRunner` input and do not promote thread context or
accept any parent branch.

The CLI room and role commands are thin repository operations over the same
local SQLite model. `rooms list`, `rooms create`, `rooms use`, `rooms send`,
and `rooms timeline` seed or read `conversation_threads.metadata` room records
without adding a separate room table. `team roles list`, `team roles show`,
`team roles save`, and `team roles executor` read and write preset overrides
or custom roles in the same project settings key used by the desktop Team
workspace. This keeps role handles, executor bindings, and reserved executor
states consistent across CLI and desktop without moving orchestration into the
renderer or adding a terminal UI dependency.

`apps/desktop/electron/services/thread-service.ts` is the desktop conversation
facade over those repositories. It parses enabled adapter mentions
(`@codex`, `@claude`, and `@claude-code`, plus `@fake` only when enabled) plus
enabled workgroup role mentions from the shared preset/custom role contract.
Project-level custom
roles and preset overrides are resolved through `TeamService` before mention
parsing, so renderer code never performs role lookup or executor decisions.
`sendMessage` appends one
durable user message, stores resolved role metadata on that message when
present, creates one shared task for the turn, stores local task assignment
metadata, appends task-created and participants-assigned system messages, and
creates one run per executable adapter or role participant through `RunService`.
It also accepts bounded collaboration workflow input, either as structured IPC
metadata from the room launcher or as a `/workflow <mode>` room command.
Workflow state is stored first as JSON metadata on the user message, shared
task, and workflow timeline messages. Supported modes are `handoff`,
`review_loop`, and `panel_discussion`; each persists participants, max rounds,
stop condition, expected outputs, executor availability, and local status. The
service enforces the per-mode round bounds before any run is created and never
starts hidden follow-up work. Workflow timeline events reuse conversation
messages with explicit kinds for handoff, review requested, review completed,
and workflow completed. When linked executable runs reach terminal state,
selected-room reconciliation reads run snapshots through `RunService`, updates
the workflow state, and appends review/completion events without mutating
worktrees, applying changes, merging, pushing, or creating remote jobs.
Reserved non-executable role executors remain assignment metadata only until a
future executor exists. When the caller does not provide a thread id, the
service resolves the project's seeded `#general` room instead of creating a
prompt-titled chat thread. Role-targeted run-card and assistant-output messages
persist the compact role metadata, the shared task id, and the executor mapping
so review and transcript surfaces can attribute local agent output to the
requested participant without giving the renderer access to role resolution
logic. The renderer-facing
`window.agentHub.threads.*` contract stays a narrow preload boundary for
create, update, get, list, and send-message operations; service state is loaded
from SQLite through lightweight thread reads. Thread lists do not reconcile
every thread or hydrate full run details; they derive run-card display status
and active counts from `RunService.listRunStatuses()`. Selected room details
reconcile only pending assistant-output placeholders, and
finalized assistant messages are treated as stable transcript rows. When a run
reaches `completed`, `failed`, or `cancelled`, reconciliation uses
`RunService.getConversationRunSnapshot()`, which reads run rows and events only,
to produce bounded agent-facing output or a concise empty/failure result when
no agent-facing output exists. Adapter exit-code lines and TaskRunner terminal
summaries carry `assistantOutput: false` or remain terminal event metadata, so
they are audit evidence rather than assistant transcript text. Raw logs, diffs,
verification output, and risk evidence remain on the run model and load through
review IPC only when the user opens the inspector. If an older database has
runs but no conversation threads, the service performs a one-time compatibility
import into conversation rows so existing desktop run records stay inspectable.
Completed no-change run cards are hidden from the default transcript once a
durable assistant message exists; file-changing, failed, cancelled, or
comparison-ready runs remain visible as review affordances. Active routine chat
cards use the latest agent-facing message rather than lifecycle text as their
primary activity copy. The renderer displays bounded assistant transcript text
and live agent-facing card text through a sandboxed Markdown component using
GFM parsing without raw-HTML plugins; logs, diffs, lifecycle events, and other
review evidence continue to render only through their inspector-specific views.
The visual hierarchy pass remains renderer presentation over this same IPC
boundary. `ChatView` derives only a lightweight local display state from
already-loaded messages and run details so CSS can weight idle, running,
failed, and review-ready surfaces differently. `AgentRunCard` derives only the
agent label, status, conclusion line, high-level facts, and state-specific
review actions from persisted run events plus compact review summaries already
available to the card. It does not retry runs, apply patches, approve memory,
read logs directly, or bypass the inspector; card buttons only open existing
review surfaces such as Brief, Evidence, Audit, Artifacts, and Memory. Sidebar
and header hierarchy changes are likewise renderer-only navigation/copy
changes over the same project, thread, team, settings, and review IPC services.
The renderer keeps chat scrolling as local layout state: switching rooms jumps
to the newest transcript item, live updates follow only while the scrollport is
already near the bottom, and user scrollback prevents run-detail updates from
pulling the transcript downward. Historical terminal run cards defer full
run/review hydration until they approach the visible scroll area, while active
run cards continue subscribing immediately for live progress.
The renderer-only sidebar projection keeps project switching and project
registration inside one disclosure whose collapsed state exposes only the
active project name. It also re-sorts the visible room list by each room
summary's latest `updatedAt` activity, so selecting a room changes only
selection state and does not promote that room above newer conversations.
The room page also keeps layout state renderer-only: the header, message list,
workflow launcher, and composer share a centered maximum-width conversation
column, the workflow launcher renders a compact summary row when idle, and the
context-mode selector is only a quiet local composer control. These changes do
not alter thread persistence, workflow metadata, or context injection.

Composer autocomplete is implemented as renderer-only input assistance. The
helper in `apps/desktop/src/lib/composer-controls.ts` derives active `@` and
`/` trigger ranges, filters adapter/role/command suggestions, applies selected
suggestions into the textarea value, resolves visible target chips, and counts
expected run fan-out from known adapter mentions plus executable role mentions.
Unknown mentions are intentionally ignored by the helper and remain ordinary
prompt text, matching the main-process mention parser. Slash suggestions insert
prompt text only; they do not create a new command execution backend.
The Cmd/Ctrl+K command palette is also renderer-only. It receives a bounded
list of local UI actions from `App`, filters and navigates them in React, and
invokes existing component callbacks such as opening the room form, switching
workspaces, opening settings, or toggling sidebar density. It does not execute
shell commands, call adapters, read files, or bypass the existing preload IPC
surface.

Desktop UI preferences are stored only in renderer browser storage through the
sanitizing helper in `apps/desktop/src/lib/local-preferences.ts`. The persisted
shape is limited to harmless IDs and enums: selected project/thread ids,
active workspace, context mode, inspector tab, sidebar density, and recent
agent or role handles. The helper rejects arbitrary object shapes, unsafe id
characters, unknown agents, and invalid role handles, and it never stores
prompts, transcripts, logs, diffs, repository paths, command text, secrets, or
approved memory.

The multi-turn architecture has persisted thread/message repositories, thread
summary storage, the desktop thread service separated from task runs, and a
package-level conversation context builder. The builder runs outside the
renderer, applies deterministic message-count and character budgets, and
produces a conversation brief that is injected through the runtime context
bundle and persisted as a `conversation_brief` run artifact. Context ordering
is current turn, participant-filtered recent messages, participant-scoped thread
summary, then project context. A zero recent-message budget includes no prior
thread messages, and recent messages are reduced when needed so summaries and
project references remain inside the total brief budget. Desktop first-turn
runs reload the retitled thread before building the brief so pre-created empty
threads do not inject stale `New Chat` titles. If a room has
`sharedContextEnabled: false`, the desktop thread service passes no prior room
messages and no thread summary to the builder for that run while preserving the
current turn, role context, project context references, approved memory handled
by the context compiler, and explicit continuation provenance. Project context,
thread context, current-turn context, and run context remain distinct layers so
thread-local decisions do not automatically promote into project approved
memory. Follow-up turns prefer terminal assistant messages from the same
participant identity over run-card summaries for runs that have finished;
same-participant run-card summaries remain available for pending runs and
compatibility imports. Role-backed participants are keyed by role handle, while
direct adapter participants are keyed by adapter id. Other roles' or direct
agents' prior prompts and assistant text are not injected as raw recent-message
context or into the participant summary unless the user chooses an explicit
continuation path.

The service maps desktop-facing agent IDs (`fake`, `codex`, `claude`) and run
statuses (`queued`, `running`, `verifying`, `completed`, `failed`,
`cancelled`) onto the existing core/SQLite contracts where possible. Desktop
continuation uses the same explicit intent shape over safe IPC:
renderer run cards can select a parent run/message, the composer shows a
clearable one-shot continuation chip, and `ThreadService` resolves
message-linked runs before passing parent ids to `RunService`. If both a run id
and message id are supplied, `ThreadService` validates that the message is still
linked to that parent run before forwarding the pair. The renderer does not
receive filesystem, shell, Git, or SQLite access. For untrusted markdown links, renderer `window.open` calls are intercepted by `BrowserWindow.webContents.setWindowOpenHandler` and denied, then approved external protocols (`http`, `https`, `mailto`) are opened through `shell.openExternal`; direct in-window navigation is prevented with `will-navigate`. Current desktop
TaskRunner-backed paths require a retained parent worktree before continuing
code state and otherwise fail with a clear system message.
SQLite still stores the core run status enum, so the desktop-only `verifying` phase
is represented by live run events while the persisted core run remains
`running`; core `succeeded` is exposed to the desktop renderer as `completed`.

Desktop real execution now enters the shared `TaskRunner` from the Electron
main process. `RunService` can either create a new single-run task or attach a
queued run row to an existing thread-created task for mention fan-out. It then
constructs TaskRunner with the same SQLite repositories and a desktop ID
generator that reuses the queued run id. Shared desktop tasks use TaskRunner's
aggregate task-status mode so one finished run does not complete the task while
sibling runs are still queued or running. `@fake` executes through
`FakeAgentAdapter` in an isolated worktree only when fake is enabled by the
internal availability policy, while `@codex` and `@claude` use the
process-backed Codex and Claude Code adapters, including local preflight. If a
CLI is unavailable or unauthenticated, the run fails inspectably through
persisted events and review evidence instead of crashing the service. Only
agent-facing output is promoted into bounded assistant transcript messages for
future thread context; terminal summaries, exit codes, and adapter diagnostics
remain review evidence. TaskRunner accepts a progress hook and abort signal for
desktop execution. The hook lets `RunService` persist and
emit context, worktree, adapter, verification, and terminal lifecycle events
while the run is active, then replay those same rows to late subscribers. The
abort signal flows through adapters into `NodeProcessRunner` and verification
shell execution; running desktop cancellation sends `SIGTERM` to process-backed
agents or verification commands and records cancelled state only for runs that
were actually stopped or had not started.

For Codex follow-up turns, the thread service scans prior run-card events in
the same room and participant identity. If it finds a prior Codex
`thread.started` event, it passes that session id through `RunService` and
`TaskRunner` as adapter input. The Codex adapter then invokes
`codex exec resume --json <session-id> -` so same-role desktop chat continues
the CLI conversation while still using Agent Hub's local run evidence and
review boundaries.

When a desktop run is created from a workgroup role mention, `RunService`
validates the compact role metadata received over IPC, saves it in the legacy
run metadata repository for compatibility with existing review paths, and
derives TaskRunner `userConstraints` and `executionHints` from the role persona,
default instructions, permissions, context policy, and approval policy. The
TaskRunner still receives a normal local adapter kind for execution, so Phase 1
does not introduce a new runner branch, remote executor, browser server, or
renderer-owned orchestration path. Reserved `llm_api`, `workflow`, and `human`
executor kinds remain typed contracts until a later phase adds explicit local
execution semantics.

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

Debug rendering remains opt-in. `--debug` or `AGENT_HUB_DEBUG=1` also enables
the internal debug/development agent availability policy, including `fake`, and
appends the run summary, run boundaries, context artifact paths, verification
stdout/stderr, changed file summaries, and a truncated diff preview after the
normal agent output. It does not otherwise alter adapter behavior, persistence,
or exit status.

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

The default agent registry includes fake, Codex, and Claude Code adapters, but
an internal agent availability policy decides which adapters are visible and
accepted for a run. Normal mode exposes Codex and Claude Code and hides fake;
debug, development, test, or hidden env configuration can enable fake. The
same policy can disable any adapter through per-agent environment switches or
the internal `AGENT_HUB_ENABLED_AGENTS` / `AGENT_HUB_DISABLED_AGENTS` lists.
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
Process adapter detection results also carry bounded CLI diagnostics:
executable name, detect command, user-facing verify command, cwd, and inherited
PATH entries. Failed preflight run events persist those diagnostics in metadata
for desktop review. The renderer extracts them with a pure helper and renders
an actionable preflight panel on the run card, but it never reruns detection,
reads the environment, or shells out from the sandboxed renderer.

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

Global skills use the same `SKILL.md` parser but are stored outside project
context stores at `<agent-hub-app-data>/skills/<skill-id>/SKILL.md`. The
scoped skill resolver combines project-store skills, global skills, role
default skill references, and task/run selected skill references with
deterministic precedence: task/run selected references, then role references,
then project skills, then global skills. Project skills are included for
backward-compatible project context builds, while global skills require an
explicit task or role reference unless a caller opts into global default
inclusion. A same-id project skill overrides the global skill by default; an
explicit `global:<id>` reference can intentionally select the global version.
The shared type model reserves `task` and `role` skill scopes for future scoped
stores, but the current resolver rejects those scopes explicitly instead of
silently resolving a same-id project or global skill.
Resolved skill evidence is copied into the context pack as `injectedSkills`
and persisted by the task runner as a `skill_inventory` run artifact with the
skill id, source scope, display metadata, source path when local, and
content SHA-256 hash.

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
Before applying migration version 9, initialization checks for databases that
already have `task_runs.parent_run_id` and `task_runs.parent_message_id` but do
not have the version 9 marker. This repairs local databases created by
intermediate desktop builds by creating the parent-run indexes if needed and
recording the migration marker instead of attempting duplicate `ALTER TABLE`
statements.
Migration version 10 adds nullable `role_json` to `run_metadata` so existing
run review flows can associate a run with the resolved role handle, display
name, executor kind, adapter kind, permissions, context policy, and approval
policy without rebuilding the core `task_runs` table.
Migration version 11 adds nullable `metadata_json` to `tasks`. Desktop uses
that JSON field for room/thread provenance, source user message id, assignment
role, role handle, executor kind, executable state, and linked run ids for
shared mention fan-out tasks.

Repository implementations enforce the imported state diagrams before writing
status updates. Tasks may move `open -> running -> completed`, return from
`running` to `open` after a failed run, or cancel from `open`/`running`; task
runs move through `queued -> running -> succeeded` or `failed`, with
cancellation from `queued` or `running`; memory items move only from `proposed`
to `approved` or `rejected`. Repeating the same status remains idempotent, but
invalid terminal transitions are rejected in both SQLite and in-memory
repositories, including the in-memory task-run `updateStatus()` path used by
focused runner tests and injected runtimes. Shared desktop tasks still use this
narrow task status enum; the aggregate rule is computed from linked task runs:
any queued/running run keeps the task `running`, all succeeded runs complete
the task, and any failed/cancelled final mix returns it to `open`.

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
project repository. The shared append helper is idempotent by memory id and by
identical approved content, so repeated desktop or CLI approval does not
duplicate approved-memory entries. The context compiler reads approved memory
only from that file provider and treats the default `# Approved Memory` heading
as an empty placeholder; proposed and rejected database rows are not injected,
and placeholder content does not become a context-pack memory section.
After a task run is finalized and persisted as `succeeded`, the task runner
reloads durable run evidence through repositories before generating memory
proposals. The generator uses conservative signals such as persisted
verification commands, diff changed-file metadata, and the latest risk report;
it skips secret-like verification command text, does not inspect transient
adapter state, and does not write to the approved-memory context store.
Generated items are deduplicated by normalized project content, capped per
task, and created only as `proposed` memory rows. A generation failure is
reported as a run warning without changing the completed run status.
Desktop memory proposal generation reuses the same verification-command safety
predicate before turning persisted verification rows into proposal content, so
the desktop review surface cannot persist secret-like command text as memory
through its separate proposal service.

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
Desktop comparison review is a thin main-process service over that shared
helper. `ComparisonService` validates that both selected runs are terminal and
either share a task id or appear in the same multi-agent desktop turn by
inspecting durable conversation run-card messages. Same-task comparisons use
the normal task-scoped helper contract. Same-turn desktop comparisons allow the
candidate run to have a different task id only after the conversation grouping
is proven, then persist a `desktopScope` marker in `comparison_reports.details`
for later reads. Renderer components call only `window.agentHub.comparison.*`
through preload IPC; they do not calculate scores, read SQLite, inspect
conversation tables, or mutate agent output.
The renderer may derive a lightweight compare affordance from the already
loaded room transcript and run status map so terminal same-task or same-turn
peers are visible from compact run cards. That affordance only opens the
inspector Artifacts context; the main-process comparison service remains the
authority for candidate validation and report creation.

The first desktop runtime integration is deliberately narrow. `apps/desktop`
uses SQLite-backed services for project registration, run listing/detail,
inspector review tabs, verification rows, risk reports, comparison reports,
and memory proposal decisions. `runs.create` records a queued desktop run
through repository interfaces, then the main process calls TaskRunner with
those same repositories.
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
Renderer verification-setting empty and error states only explain this existing
settings boundary, show skipped-check consequences and example commands, and
route the user back to the Settings panel; they do not parse prompts into shell
commands or create alternate execution paths. The renderer compares the draft
command list to the last loaded settings payload so Save changes is disabled
until local form state actually changes.

All adapters run against an isolated worktree and refuse to run when that
directory is the original project root or when the generated task brief is
outside the isolated directory. Codex is invoked as `codex exec --json -` for a
fresh run and as `codex exec resume --json <session-id> -` when the desktop
thread service provides a prior Codex session id for the same role or direct
agent target.
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
Default `HEAD`-based worktree creation also verifies that the source repository
has a committed `HEAD`, so empty or unborn repositories fail with an actionable
workspace error before `git worktree add`.
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

The local AI workgroup transformation is documented in
`docs/local-ai-workgroup-roadmap.md`. The current implementation layers room,
configurable role/participant, executor, timeline, artifact, decision,
knowledge, pack, workflow, and lifecycle semantics on top of the existing local
conversation and run evidence boundaries instead of starting with a broad
schema rewrite. `ConversationThread` currently serves as the room timeline
record. Role records are not a closed enum: preset roles seed defaults, while
user-defined roles carry capability, persona, permission, context, approval,
and executor metadata. The first runnable executor maps to existing adapter
kinds, and the role model leaves space for future LLM API, local workflow, and
human executors. Run artifacts/review evidence back the first artifact, check,
risk, lifecycle, and memory inspector panels. New first-class tables such as
`rooms`, `roles`, `participants`, `role_executors`, `task_assignments`,
`timeline_events`, `artifacts`, `decisions`, or `packs` should be added only
when the metadata-backed model no longer satisfies a specific query, lifecycle,
or governance need. The roadmap also defines longer-term extension horizons:
roles, executors, workflows, artifacts, knowledge, packs, and optional
sync/collaboration should evolve through stable local contracts rather than
short-lived MVP-only enums or UI assumptions.

The interaction simplification and post-MVP UX phases are documented in
`docs/interaction-optimization-roadmap.md`. Those phases should remain layered
over the same local boundaries: the renderer stays sandboxed, room shared
context is metadata-driven and distinct from approved memory, global skills
stay in Agent Hub-owned app data unless explicitly exported, agent answers in
the default transcript come from agent-facing output rather than terminal
process summaries, and run details remain review evidence behind IPC-backed
inspector surfaces.

Phase 1 implements the first of those contracts without adding a role
configuration UI or broad room schema. `packages/shared/src/workgroup-roles.ts`
defines preset role templates, normalization/resolution helpers, the compact
run-metadata shape, and the executor-kind union. `packages/core` validates role
objects for tests and future persistence callers. The desktop service consumes
those contracts from the main process, so role mentions are a local orchestration
input layered over existing conversation messages and TaskRunner runs.

Phase 2 implements the first room layer over that same boundary. The desktop
sidebar presents project selection, rooms, compact utility navigation, and
small local run-status counts, while the center timeline still reads and
writes durable conversation messages and run cards through
`window.agentHub.threads.*`.
Because rooms are conversation-thread metadata, the renderer gets no direct
SQLite, filesystem, Git, shell, or orchestration access, and CLI chat continues
to use the existing conversation repositories during the transition.

Phase 3 groups one mentioned workgroup instruction into one local task. The
task keeps thread provenance and assignment metadata in `tasks.metadata_json`;
executable assignments create linked task runs, while reserved non-executable
assignments stay visible as local task metadata without creating runs. The
renderer groups consecutive run-card messages that share a task id, and all
privileged task/run creation remains in Electron main-process services.

Phase 4 adds timeline event semantics without introducing a separate event
store. `conversation_messages.metadata_json` may include a bounded
`timelineEvent` object with an event kind, actor, compact linked ids, status,
and small display chips. The Electron thread service writes these semantics for
user rows, task-created rows, assignment rows, run cards, run terminal updates,
and assistant participant output. The renderer maps that metadata plus lazy
review summaries into audit-stream cards and grouped card evidence for status,
checks, risks, logs/audit, lifecycle, artifacts, review decisions, and memory.
Raw logs, diffs, verification rows, risk reports, memory details, context
previews, and comparison data remain on run evidence repositories and continue
to load through review IPC only when the user opens the relevant inspector
context.
Inline run cards compute a renderer-only Prepare/Run/Verify/Review stage model
from persisted run status and event types. The model controls compact progress,
last-activity, wait-state, disabled-action, and compare-entry display only; it
does not create new persistence, duplicate raw event streams into the
transcript, or bypass inspector IPC for review data. Terminal cards use review
IPC only for the compact summary/artifact metadata needed by grouped card
evidence; deeper checks, risks, logs, context, memory, and comparison payloads
remain inspector-loaded.

Phase 5 keeps the inspector as a renderer-only shell over those IPC services
but changes its visible vocabulary from run-centric tabs to the workgroup
structure. Existing links that still request legacy tabs such as Summary, Diff,
Tests, Risk, Compare, Handoff, or Logs are normalized in the renderer to Brief,
Artifacts, Evidence, Evidence, Artifacts, Artifacts, or Audit so older timeline
metadata remains openable while the visible tab bar stays at Brief, Evidence,
Artifacts, Memory, and Audit. Evidence internally loads the same verification,
risk, context, and lifecycle IPC payloads; the drawer width and Deep mode are
renderer layout state only.
The Brief tab is the default conclusion surface. It derives a renderer-only
review conclusion from the loaded review summary and the existing risk IPC
payload, pins blocking findings above the summary when present, and exposes
manual next-action buttons that only switch inspector tabs. It does not create
new review scores or write decisions; refreshing the Brief tab reloads both
summary and risk payloads so the conclusion cannot remain pinned to stale risk
state while a run is still settling. Accept/reject continue to call the existing
review IPC and record audit-only review state.
The inspector header separates local panel controls from review decisions:
Close stays a renderer-only panel control, Refresh is a lower-priority utility,
and Accept/Reject remain the only decision actions. The Brief metrics are
rendered as two compact renderer summary sections, Outcome and Review, without
adding new review fields or showing the suggested decision as a metric.

Phase 6 adds an artifact model v0 without changing storage ownership. The
Electron main process reads existing `run_artifacts`, derives desktop-facing
artifact metadata in `ReviewService`, and serves it through preload IPC. The
renderer displays named artifact chips on run-card timelines and a local
artifact inventory in the Artifacts inspector tab, while full artifact content
stays local and bounded before crossing into the sandboxed renderer.

Phase 7 adds a Knowledge workspace as a desktop read model over the existing
local evidence tables. `KnowledgeService` composes memory items, thread
summaries, summary decisions, and review-decision artifacts into one bounded
project workspace served over Electron IPC. The renderer filters those rows,
shows source links back to rooms and runs, and delegates proposed-memory
approval/rejection to the existing explicit `MemoryService` methods. Proposed
and rejected memory are never injected as approved memory, and thread summaries
remain thread-local records.

Phase 8 adds project-level Team role configuration without introducing a new
runtime executor or repository export path. `TeamService` stores safe preset
overrides and custom `WorkgroupRole` records in the existing local `settings`
table under a project-scoped key, validates them with the core role validator,
and returns a bounded Team workspace read model over roles, recent assignment
metadata, and linked memory references. Electron exposes this through
`window.agentHub.team.*` preload IPC. The renderer can edit role profile fields,
policy metadata, enabled state, and executor bindings, but only
`agent_adapter` roles become runnable through existing fake, Codex, or Claude
Code adapters. The role list is a scan surface over Role, Purpose, Executor,
and Status only; permissions, policies, activity, and linked memory remain in
the right-side Role Profile accordions. Save Role is enabled by renderer draft
comparison only and still persists through the same validated IPC path.
Reserved `llm_api`, `workflow`, and `human` roles are stored and rendered as
non-runnable assignment metadata until later runtime phases define explicit
local executors.

Phase 9 adds bounded collaboration workflow metadata without autonomous agent
chatter or remote queues. `ThreadService` stores `handoff`, `review_loop`, and
`panel_discussion` workflow state on conversation messages and shared task
metadata, enforces local round bounds before run creation, and appends
workflow timeline events as executable participants reach terminal state.
Runnable participants still use normal TaskRunner runs; reserved non-runnable
participants stay as visible assignment metadata.

Phase 10 adds CLI parity for rooms and roles. `rooms list`, `rooms create`,
`rooms use`, `rooms send`, and `rooms timeline` operate on metadata-backed
conversation rooms, while `team roles list`, `team roles show`, `team roles
save`, and `team roles executor` read and write the same project-scoped role
settings used by the desktop Team workspace. CLI chat and `rooms send` route
role mentions through the shared role resolution and shared-task fan-out path
while leaving command-mode `agent-hub run` stateless.

Phase 11 adds deterministic pack metadata in
`packages/shared/src/workgroup-packs.ts`. Built-in packs cover Core Workgroup,
Engineering, Research, Writing, Analysis, and Operations. A pack is a local
metadata object with artifact type definitions, check types, risk categories,
default role template handles, executor capability hints, context section
provider metadata, and labels. The registry is read-only code, not a
marketplace, plugin loader, or remote integration boundary. Pack metadata is
exported through `packages/shared` and re-exported by `packages/core`, so CLI,
desktop main-process services, and future local packages can share lookup and
label mapping without giving the renderer authority to load code. Core label
mapping returns Brief, Context, Artifacts, Checks, Risks, and Memory; terms
such as Diff, Tests, Worktree, PR, and CI resolve to those general surfaces
unless the Engineering pack is explicitly selected.

Phase 12 adds explicit lifecycle controls around retained worktrees and local
apply. `LifecycleService` validates retained-worktree ownership, requires
exact confirmation phrases for cleanup and apply, records lifecycle audit
artifacts/events, blocks apply on `blocking` risk, and runs local `git apply
--check` plus `git apply` against the selected project checkout only after the
human confirmation. It does not commit, merge, push, create pull requests,
delete branches, approve memory, or export repository context.

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
records review decisions only, while retained-worktree handoff exposes local
paths, branches, changed files, and review commands through validated IPC.
Lifecycle cleanup and local apply are now separate, audited, confirmation-gated
IPC workflows. Merge, push, PR creation, branch deletion, and repository
context export remain outside desktop apply. Desktop memory approval is an
explicit context-store writeback, not a run acceptance side effect.
