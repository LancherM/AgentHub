# Product

Agent Hub is a local-first CLI-first developer tool for orchestrating coding
agents on a developer machine.

The current verified rebuild slice supports registered projects, registered
tasks, Agent Hub-owned context stores, context artifact build/export,
deterministic fake-agent runs, process-backed Codex and Claude Code runs, and
cross-process SQLite-backed run inspection, manual run-event recording, memory
workflows, comparison reports, and explicit threaded CLI chat/resume.
Running `agent-hub` with no subcommand starts a stateless interactive shell
over the same local core services:

The implementation now uses the imported workspace shape for the CLI, local
core packages, and first desktop shell. `apps/cli` contains CLI parsing,
interactive mode, command dispatch, and output rendering. `apps/desktop`
contains the Electron + React shell over the same local persistence/review
interfaces. Shared contracts and local services live under `packages/shared`,
`packages/core`, `packages/db`, `packages/context-compiler`,
`packages/task-runner`, `packages/agent-adapters`, and `packages/safety`.
The desktop app is not a hosted web app and does not add an API server, login,
cloud sync, remote execution, automatic merge, automatic push, or repository
export behavior.

```sh
agent-hub [--project <path>] [--agent fake|codex|claude-code]
agent-hub [--debug] run ...
agent-hub [--db <path>] project add --name <name> --root <path>
agent-hub [--db <path>] project list
agent-hub [--db <path>] task create --project-id <project-id> --title <title> [--description <text>]
agent-hub [--db <path>] task list [--project-id <project-id>]
agent-hub [--db <path>] task history --task-id <task-id>
agent-hub context init --project-root <path> --project-id <project-id>
agent-hub context show --project-root <path> --project-id <project-id>
agent-hub context build --project-root <path> --project-id <project-id> --task-id <task-id> --title <title> --prompt <prompt>
agent-hub context export --project-root <path> --project-id <project-id> [--target repo] --dry-run|--write
agent-hub [--db <path>] run --task <task-id> --agent fake|codex|claude-code
agent-hub run [--repo <path>] [--workspace-base <path>] [--retain-on-failure] [--continue-from-run <run-id>|--continue-from-message <message-id>] "@fake|@codex|@claude-code <task>"
agent-hub [--db <path>] run event add --run-id <run-id> --type <type> --message <message>
agent-hub [--db <path>] threads list
agent-hub [--db <path>] threads show <thread-id>
agent-hub [--db <path>] chat [--thread <thread-id>]
agent-hub tasks list
agent-hub runs list
agent-hub runs events <run-id>
agent-hub runs diff <run-id> [--stat|--patch] [--full]
agent-hub runs show <run-id>
agent-hub risks show <run-id>
agent-hub [--db <path>] memory list --project-id <project-id>
agent-hub [--db <path>] memory propose --project-id <project-id> --category <category> --content <text>
agent-hub [--db <path>] memory approve --memory-id <memory-id>
agent-hub [--db <path>] memory reject --memory-id <memory-id>
agent-hub [--db <path>] compare --task-id <task-id> --baseline <run-id> --candidate <run-id>
```

Interactive mode accepts natural language prompts plus `@fake`, `@codex`, and
`@claude-code` prompt prefixes. It supports `/help`, `/agents`, `/use`,
`/context`, `/context init`, `/clear`, `/exit`, and `/quit`. Interactive task
execution calls the same task runner and repositories as command mode, so it
does not duplicate orchestration logic or create a separate execution path.
This bare interactive shell remains stateless: each prompt is dispatched as a
single run and no conversation thread rows are created.

`agent-hub chat` is the explicit persistent conversation mode. It creates or
resumes a local SQLite-backed conversation thread, persists ordered user,
run-card, and bounded assistant-output messages, and accepts `/thread new`,
`/thread use <id>`, `/threads`, `/history`, `/continue run <id>`, `/continue
message <id>`, `/continue clear`, and `/exit`. Natural-language chat
turns use the selected default agent, while leading `@fake`, `@codex`, or
`@claude-code` prefixes route that turn to a specific adapter. Each chat turn
builds a bounded conversation brief from prior thread messages with the shared
`ConversationContextBuilder`, injects it through `runtime_injection`, and
persists the exact brief as a `conversation_brief` run artifact. Chat also
maintains a conservative thread-local summary with decisions, open items,
constraints, and the last known user goal. `threads show <thread-id>` renders
that summary for inspection. Thread summaries stay scoped to the thread and do
not become approved project memory unless the user explicitly promotes them
through the memory workflow. Full logs, diffs, verification results, risks, and
memory proposals remain on the run evidence model rather than in message
bodies. Chat code-state continuation is one-shot: a `/continue` command applies
only to the next natural-language turn and then clears. `agent-hub run` remains
stateless and does not require or create a thread unless an explicit
message-linked continuation id is supplied.

The context commands initialize and inspect a project context store, build a
task-specific context pack and task brief, and explicitly export managed
repository context only when requested. External context stores are the default
and live under Agent Hub application data rather than the user repository.
Missing optional context files are surfaced as build/export warnings.
Supported store files are:

- `context/project.md`
- `context/architecture.md`
- `context/conventions.md`
- `context/testing.md`
- `context/security.md`
- `memory/approved.md`
- `skills/<skill-name>/SKILL.md`

Skill files must include YAML-style frontmatter with `name` and `description`.
Malformed or empty skills are skipped and surfaced as build/export warnings
instead of being silently injected as generic text. Skill display names are
used in rendered context, while export and overlay file paths stay anchored to
the context-store skill directory name.

`context export --target repo --dry-run` previews repository writes.
`context export --target repo --write` uses Agent Hub managed blocks in
`AGENTS.md` and optionally `CLAUDE.md`, preserves user-authored content
outside those blocks, and ignores marker examples inside fenced code blocks.
If `--target` is provided, its only supported value is `repo`, and the flag may
only be provided once; omitting it keeps the same repo-export default for
compatibility. Approved memory from the
Agent Hub-owned context store is included in the managed context block when it
contains non-placeholder content, and `--include-approved-memory` is accepted
as an explicit acknowledgement of that default. Runtime context files are
generated in Agent Hub-owned artifacts or inside isolated worktrees; default
context build does not write repository-level agent files. The context build
`--delivery-mode` flag accepts only `runtime_injection` and
`worktree_overlay`; `repo_export` remains exclusive to `context export`.

The run command validates the task input, compiles non-invasive context, routes
to the selected adapter, rejects unsafe repository-local Git config before any
worktree checkout, creates an isolated git worktree outside the original
project checkout, materializes runtime task brief/context-pack files inside
that workspace, runs the adapter with the context payload, collects git diff
metadata, runs explicitly configured verification commands, generates a
structured risk report from safety scanner findings, captures events, applies
the workspace cleanup policy, and returns a finalized local result to the CLI.
Command mode intentionally uses post-run rendering for the MVP: it waits for
the task run to finish, then prints the final agent-facing output once. The
pre-flight Git config check covers worktree-local config files, inline section
comments, and dotted filter or diff driver names that could otherwise enable
executable Git helpers during checkout. Repository-local `core.hooksPath`
settings are allowed for normal developer repositories because Agent Hub's own
Git calls override hooks to `/dev/null`.

Code-state continuation is explicit opt-in only. `agent-hub run
--continue-from-run <run-id>` and `agent-hub run --continue-from-message
<message-id>` create a new isolated child worktree at the retained parent run's
HEAD, copy safe changed regular files from the retained parent worktree, apply
parent deletions, and then run the selected adapter in the child worktree.
Continuation rejects non-terminal parents, missing or cleaned worktrees,
sensitive paths, `.git`/`.agent-hub` paths, path escapes, symlinks detected by
diff metadata or preflight filesystem inspection, and unsupported renames
before creating a child run. The child run stores
`parent_run_id`, optional `parent_message_id`, and a `code_state_provenance`
artifact with copied/deleted file lists and source HEAD. Review, risk, diff,
verification, and memory evidence remain scoped to the child run. Continuation
does not merge, push, accept branches, mutate the original checkout, or export
repository context files.

`runtime_injection` remains the default delivery mode. Codex and Claude Code
receive the task brief/context through stdin-driven runtime injection and do
not require repository-level `AGENTS.md` or `CLAUDE.md`. `worktree_overlay` is
opt-in and writes generated `AGENTS.md`, `CLAUDE.md`, and skill copies only
inside the isolated worktree, never the original checkout. Task runs accept
only `runtime_injection` and `worktree_overlay`; `repo_export` remains an
explicit `context export` action and is rejected as a run delivery mode.

Task runs are inspectable even when later execution stages fail. After a run
row exists, failures in diff collection, verification execution, risk report
generation, artifact persistence, metadata persistence, or workspace cleanup
are converted into diagnostic run events and warnings. The task run is
finalized as `failed`, the task is returned to `open`, partial structured
outputs are returned when available, and workspace cleanup is still attempted
according to the selected cleanup policy. Dangerous verification commands are
reported as failed verification results instead of bypassing finalization;
verification commands receive a 10-minute default timeout unless an explicit
command timeout is configured, and timeout or process signal details are
preserved in the command result.
Runs without configured verification commands still record skipped verification
and include a run warning so the missing validation is visible in run metadata
and debug output without opening the risk report.
Desktop users can configure per-project verification commands from the local
Settings panel. These commands are stored in Agent Hub SQLite settings as
structured executable-plus-args entries, validated through main-process IPC,
and passed to TaskRunner for isolated-worktree execution. Secret-like option
names such as API key, token, password, private-key, and client-secret flags
are rejected before persistence; prompts are never parsed into shell commands.
Task brief artifacts are persisted from Agent Hub's generated brief content,
not by rereading worktree paths after materialization, so malicious symlinks in
an untrusted worktree cannot be captured as task brief artifact contents.

Normal run output is optimized for CLI use and shows the agent-facing output
only. Agent Hub extracts fake-agent output, structured message/error events,
or raw non-JSON stdout/stderr fallbacks instead of printing run metadata or
adapter lifecycle events after every task. Structured lifecycle summaries and
non-assistant message items remain persisted status events rather than normal
agent output. Command mode does not stream intermediate run events live in this
slice; operators inspect the persisted event stream with `runs events` or opt
into post-run debug metadata with `--debug`. Interactive mode follows the same
rule and does not echo `run: <prompt>` in normal mode.

Manual event recording is available for persisted task runs:
`run event add --run-id ... --type ... --message ...`. The command validates
the run exists, validates the event type, appends through the
`RunEventRepository`, and assigns the next sequence number after existing
events for that run.
For the locked MVP event model, the only first-class persisted run event types
are `stdout`, `stderr`, `message`, `status`, `error`, and `exit`. Structured
tool-call output from agent CLIs remains auditable as raw stdout and, when it
can be parsed safely, as a `status` event with the original structured payload
in metadata. Agent Hub does not promote tool-call records into assistant
messages and does not add a separate `tool_call` event type in the MVP.

Persisted run review is explicit and read-only. `runs events <run-id>` prints
the ordered adapter/manual event stream stored in `run_events` across CLI
processes. `runs diff <run-id> --stat` prints stored changed-file and diff-stat
metadata, while `runs diff <run-id> --patch` prints the stored git diff artifact
with default truncation and an explicit `--full` flag for complete local output.
Patch output is still redacted when persisted changed-file metadata or diff
headers identify sensitive paths such as `.env`, key, token, secret, or
credential files.
These commands inspect SQLite-backed evidence only; they do not rerun agents,
modify worktrees, accept output, merge branches, or push code.

`--debug` is opt-in and does not change run behavior. For supported run
commands it appends the detailed run summary, selected `context_delivery` mode,
`branch_name`, run boundary details, context artifact paths, verification
stdout/stderr, changed-file summaries, warnings, and a truncated diff preview
to the normal agent output. `AGENT_HUB_DEBUG=1` or `AGENT_HUB_DEBUG=true`
enables the same debug rendering for local troubleshooting.

The process-backed adapters use direct executable-plus-args spawning:

- Codex runs `codex exec --json -` in the isolated worktree.
- Claude Code runs `claude --print --output-format stream-json` in the isolated
  worktree.
- Before launching Codex or Claude Code for a run, Agent Hub first validates
  the isolated worktree and runtime task brief boundary, then runs adapter
  detection from that worktree with the run environment. Missing CLI,
  authentication, or setup failures become failed run events and no real
  adapter process is started.
- Task runs may provide explicit `environmentOverrides` for process-backed
  adapters. Child processes receive only those overrides plus a small inherited
  allowlist for path lookup, home/config/cache paths, temp directories,
  locale/terminal flags, CI, required Windows process variables, and existing
  local CLI bin directories commonly omitted when the desktop app is launched
  outside a login shell. An explicit `PATH: undefined` override still removes
  path lookup for that child process.
- stdout and stderr are captured as run events; structured JSONL output is
  parsed into message/status/error events when possible, while raw output is
  preserved.
- structured tool-call-like JSONL output is preserved as stdout and summarized
  as `status` metadata, not persisted as a first-class `tool_call` event.
- non-zero process exits and signal exits make the run fail, but the task run,
  events, artifacts, verification rows, and risk report remain inspectable.
- unsafe permission-bypass flags are not used.

The list/show/history commands read from local SQLite storage by default, so
projects, tasks, runs, run details, and risk reports remain visible across CLI
processes. Ad hoc fake runs remain supported for the older vertical slice.

Risk reports are backed by a standalone safety scanner. It checks sensitive
paths, dangerous commands in generated diffs or configured verification
commands, dangerous generated instructions in captured adapter run events,
risky diff shape, large deletion volume, and binary file changes. The dangerous
command rules are shared with verification command rejection and cover direct
and common shell-wrapped variants of `sudo`, `rm -rf /`, `chmod -R 777`,
`curl | sh`, `wget | sh`, `git push --force`, and `git clean -fdx`. Blocking
findings remain `blocking` in the aggregated risk level and are surfaced in
`risks show`; they are not downgraded to high. Agent Hub still does not
automatically accept, merge, or push any run output. Debug run output redacts
the raw diff preview when a blocking sensitive-path finding exists, or when
changed-file metadata identifies a sensitive path before a risk report is
available.

The memory workflow is explicit and user-approved. `memory propose` creates a
SQLite memory item in `proposed` state, `memory list` shows project memory
items, `memory approve` marks an item approved and appends it to the Agent
Hub-owned context store at `memory/approved.md`, and `memory reject` marks it
rejected. Successful task runs may also generate a small number of
conservative proposed memory items from persisted run evidence such as
verification rows and diff metadata, while skipping secret-like verification
command text. These generated items are visible through the same `memory list`
command and still start as `proposed`; Agent Hub does not auto-approve,
auto-write, or inject them. Context builds read approved memory only from the
context store and ignore the default `# Approved Memory` placeholder, so
proposed, rejected, and empty placeholder memory items are not injected into
future task briefs.

The compare workflow generates a persisted comparison report for two runs of a
task. `compare --task-id ... --baseline ... --candidate ...` compares changed
files, diff stats, verification summaries, per-command verification outcomes,
failed checks, risk levels, risk factors, and summary tradeoffs from persisted
run artifacts and reports, then stores both a readable summary and structured
comparison details in `comparison_reports`. The structured details include
changed-file overlap, diff-size deltas, verification and risk deltas, and a
deterministic review score with explainable penalties. Comparison is a review
aid only; it does not accept, merge, delete branches, or push changes.
Missing risk evidence is treated conservatively in tradeoff wording and
structured risk deltas: it ranks above persisted `low` and `medium` risk but
below persisted `high` and `blocking` risk.

Agent Hub Desktop is now available as a local conversation console under
`apps/desktop`. It starts with `pnpm --filter desktop dev` and presents a
thread-first shell: threads and projects on the left, a conversation timeline
in the center, and a bottom composer as the primary interaction surface. When
there are no registered projects, the desktop renders local project path
registration controls in the project sidebar and the empty conversation pane;
submitting either control calls the existing `window.agentHub.projects.open`
IPC path and seeds a new conversation for the registered project.

The composer accepts mention-based prompts such as `@fake ...` or multi-agent
mentions. The renderer sends prompt text through the safe
`window.agentHub.threads.sendMessage` preload API; the Electron main-process
thread service strips known agent mentions from the task body, persists one
ordered user message in the selected SQLite-backed conversation thread, creates
one run per selected agent through `RunService`, and persists one inline run
card message plus one hidden pending assistant-output message per run. When a
run reaches a terminal state, the pending assistant message is updated with
the agent-facing final output or a concise failure/cancel summary. If no agent
is mentioned or supplied by the caller, desktop falls back to `@fake`.

Active inline run cards subscribe to the existing desktop run event stream and
replay already-persisted events when a subscription starts after a fast run has
advanced. They show agent identity, status, the latest streamed line, compact
review pills, and an expandable event log. Terminal cards do not load full run
review evidence when a thread is merely selected; diff, tests, risk, memory
proposals, summary, and full logs load lazily when the user expands a card or
opens the on-demand run inspector drawer. Existing persisted run records are
synthesized into thread-shaped conversations only as a compatibility import
when no durable conversation threads exist yet, so old desktop run data remains
inspectable without making run synthesis the primary thread store. Desktop
thread lists and details now read from the core conversation repositories, use
a lightweight run status map for run-card status/counts, and reconcile
assistant output only for the selected thread. Run records, events, simulated
verification, placeholder diffs, and risk review rows remain SQLite-backed.

Agent Hub keeps project context, thread context, current-turn context, and
per-run context snapshots as separate layers. Desktop follow-up turns build a
bounded conversation brief before each run. The brief includes the current
turn, recent thread messages, the latest conservative thread summary, terminal
assistant answers from prior runs, compact prior run summaries when no
assistant answer exists yet, project context-store references, and explicit
character-budget metadata. A zero recent-message budget includes no prior
messages, and the first message in an empty thread uses the retitled thread
name in the injected brief. Agent Hub persists that exact brief as a
`conversation_brief` run artifact so review can inspect what was injected. The
brief excludes raw lifecycle/debug events, logs,
diffs, verification output, risk evidence, and other review artifacts. Full
evidence remains on the run model; assistant messages store only bounded
transcript text for future turns. Thread summaries are generated locally from
transcript text only and are never written to approved memory automatically.

The run inspector is the desktop drill-down surface for review evidence. It
loads review summaries, changed-file stats, bounded unified diffs, captured
verification rows, persisted TaskRunner safety reports when present,
deterministic fallback risk findings, conservative memory proposals, and
bounded raw logs through `window.agentHub.review.*` and
`window.agentHub.memory.*` IPC methods. Blocking persisted safety reports keep
their `blocking` level and mapped evidence in the inspector so sensitive-path
or dangerous-instruction findings are not downgraded by the desktop fallback
risk classifier. Fake desktop runs explicitly show that no real repository
files were modified and do not invent changed files. When a retained worktree
exists, desktop diff loading uses read-only Git inspection from the Electron
main process only; renderer code never receives shell, filesystem, SQLite, or
Git access. The inspector also exposes a manual handoff view for retained
worktrees: the worktree path, branch, base/head refs, cleanup status, changed
files, and exact local review commands. Open/copy actions are validated IPC
calls handled by the main process, and the copied commands are review-only
commands such as `git status` and `git diff`; Agent Hub does not generate
merge, push, apply, or cleanup commands. Desktop memory proposal generation is
idempotent for each run: summary cards, run-detail loading, and the memory tab
can refresh in parallel without duplicating the same proposal content or
growing beyond the bounded proposal set for that run.

Inspector accept/reject actions are audit decisions only. Accepting a run
records `accepted` review state and shows "Accepted for record. No merge was
performed." Rejecting records `rejected` review state and shows "Rejected for
record. No files were deleted or reverted." Neither action merges, pushes,
resets, cleans, deletes worktrees, reverts files, writes repository context
files, or creates pull requests. Memory proposals remain pending until the
user approves or ignores them. Desktop approval is explicit and writes the
approved entry to the same Agent Hub-owned `memory/approved.md` context-store
file used by the CLI, while ignored proposals remain rejected SQLite records
and are never injected into future context.

The selected run timeline receives persisted TaskRunner events through the
existing desktop subscription API. TaskRunner now emits deterministic progress
events while a run is active, including context compilation, isolated worktree
readiness, adapter output, verification start/finish, and terminal
completion/failure/cancellation. Late run-card or inspector subscribers replay
the persisted timeline exactly once. Running cancellation is backed by an
`AbortSignal`: fake runs stop cooperatively, process-backed Codex/Claude runs
send `SIGTERM` through the shared process runner, verification commands receive
the same signal through the shared shell executor, and the desktop records
cancelled status only when execution was stopped or had not started.

The renderer only calls the safe `window.agentHub` preload API. It has no
direct Node.js, shell, filesystem, SQLite, or git access; privileged
operations go through Electron main-process IPC registered in
`apps/desktop/electron/ipc.ts`. The IPC handler factory is kept in
`apps/desktop/electron/ipc-handlers.ts` so service-level validation and
subscription behavior remain testable in the root Vitest suite without loading
Electron.

The current desktop execution path is TaskRunner-backed in the Electron main
process. `RunService` still creates the queued desktop task/run rows needed for
stable renderer IDs, then calls the shared `TaskRunner` with the desktop SQLite
repositories. `@fake` runs through `FakeAgentAdapter` in an isolated worktree
and exposes real diff, skipped verification, risk, logs, metadata, and proposed
memory evidence. Mentioned `@codex` and `@claude` runs invoke the local
process-backed adapter preflight through TaskRunner; unavailable CLIs fail as
inspectable persisted run events instead of service crashes. Desktop runs do
not write Agent Hub context files into the target repository root, merge, push,
export repository context, apply code, or approve memory automatically. Explicit
desktop memory approval writes only to Agent Hub's context store and confirms
the local approved-memory path in the inspector. Current
desktop paths accept run-linked or message-linked continuation requests,
validate that supplied message ids still belong to the requested parent run,
require a retained worktree before continuing code state, and otherwise fail
with a clear system message. Desktop verification settings are local and
per-project; they are edited through validated IPC and then run by TaskRunner in
the isolated worktree. Multi-agent comparison review, worktree lifecycle
management, and explicit merge/apply workflows remain follow-up desktop wiring
tasks.

SQLite is stored in Agent Hub-owned application data by default, not in the
target project repository. `AGENT_HUB_HOME` can point Agent Hub at an alternate
app data directory, and `AGENT_HUB_DB_PATH` can point at an explicit database
file for local testing or development. In-memory repositories remain available
for injected tests and focused runner verification.

Persisted run metadata currently covers:

- workspace path, branch, source repository, and worktree ownership details
- workspace cleanup result; workspaces are retained by default unless an
  explicit cleanup policy is selected
- collected diff metadata and summaries for staged, unstaged, and untracked
  changes
- verification suite result
- generated risk report

Diff collection records binary file metadata, synthesizes reviewable patches
for bounded untracked text files, and excludes generated overlay files only
while they still match their Agent Hub baseline. Untracked symlinks are recorded
as symlinks without dereferencing their targets, oversized untracked files have
their contents omitted, and synthetic untracked file reads are constrained to
real paths inside the isolated worktree. If an agent modifies generated overlay
files, those files are included in the diff. Git worktree and diff operations
apply hardened Git invocation defaults and reject repository-local Git config
keys that can execute helpers, hooks, filters, external diff commands, or
included config before Agent Hub invokes Git in the selected repository or
generated worktree.

Structured run data is now also persisted in first-class SQLite tables:

- adapter event streams in `run_events`
- manually recorded run events in `run_events`
- git diff artifacts in `run_artifacts`
- verification command rows in `verification_results`
- risk reports in `risk_reports`
- thread-local conversation summaries in `conversation_thread_summaries`
- memory proposals and decisions in `memory_items`
- run comparison summaries in `comparison_reports`

The initialized SQLite schema covers the imported MVP table set: projects,
agent profiles, tasks, task runs, run events, run artifacts, verification
results, risk reports, conversation threads, conversation messages,
thread-local conversation summaries, memory items, comparison reports, skills,
settings, and status transitions.

SQLite now enforces the important imported storage constraints at the database
boundary. Tasks reference projects with cascade delete, task runs reference
agent profiles when one is selected, task and run status values are checked,
agent kinds are checked, JSON columns reject invalid JSON, risk report list
fields are constrained to JSON arrays, and run event sequence numbers remain
unique per run. Local settings reject secret-like keys,
including delimiter-separated and camelCase names such as `api_key`,
`openaiApiKey`, `authToken`, and `clientSecret`, and reject secret-like string
values before they can be stored in SQLite or in-memory test repositories, so
settings remain limited to safe local behavior preferences such as desktop
verification command configuration. Desktop verification command args also
reject secret-like option names before the structured command list is stored.
SQLite initialization also includes an idempotent conversation-summary table
backfill so local databases that recorded an intermediate migration marker can
still gain `conversation_thread_summaries` on upgrade.
Ad-hoc CLI runs reuse an existing project for the same repository root. The
first legacy ad-hoc root may still use `adhoc_project` for compatibility;
additional ad-hoc roots get deterministic root-scoped project ids so tasks and
later memory writeback stay attached to the correct local repository. Upgrades
from older SQLite databases also backfill missing legacy task project rows,
including pre-change ad-hoc tasks, before adding the stricter task foreign key.

Task, task-run, and memory status changes follow the imported lifecycle rather
than arbitrary enum changes in both SQLite and injected in-memory
repositories. Same-status updates remain idempotent. Failed task runs remain
inspectable and return the parent task from `running` back to `open` so task
lists and later `--task` runs reflect that no run is currently active. A later
successful run can complete the task, or the user can cancel it.

The product remains local-only. This rebuild does not add cloud sync, accounts,
team features, hosted dashboards, automatic pull requests, automatic merges, or
automatic pushes.

GitHub CI/CD is available for repository maintenance. Pull requests to `main`
run the validation suite (`pnpm typecheck`, `pnpm lint`, `pnpm test`,
`pnpm build`, and the desktop Electron/Vite bundle build). Pushes to `main`
and manual workflow runs build a packaged CLI artifact from the workspace app/
package directories, root scripts, tests, the CI workflow, root package
metadata, `README.md`, workspace/lock files, and root TypeScript/Vitest config
files needed by those advertised validation scripts. They also build ad-hoc signed macOS desktop DMG
artifacts for x64 and arm64 on GitHub-hosted macOS runners. Version tags that
match `v*.*.*` create or update a GitHub Release with both the workspace
package artifact and the DMG artifacts. The workflow publishes local release
assets only; it does not deploy a hosted service, notarize the desktop app, or
change Agent Hub's local-first product model.

Deferred product capabilities include richer Codex/Claude structured event
mapping, multi-agent comparison review, and explicit desktop apply/merge
workflows.
