# Product

Agent Hub is a local-first CLI-first developer tool for orchestrating coding
agents on a developer machine.

The current verified rebuild slice supports registered projects, registered
tasks, Agent Hub-owned context stores, context artifact build/export,
debug/development fake-agent runs, process-backed Codex and Claude Code runs, and
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
agent-hub [--project <path>] [--agent codex|claude-code]
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
agent-hub [--db <path>] run --task <task-id> --agent codex|claude-code
agent-hub run [--repo <path>] [--workspace-base <path>] [--retain-on-failure] [--continue-from-run <run-id>|--continue-from-message <message-id>] "@codex|@claude-code <task>"
agent-hub [--db <path>] run event add --run-id <run-id> --type <type> --message <message>
agent-hub [--db <path>] threads list
agent-hub [--db <path>] threads show <thread-id>
agent-hub [--db <path>] rooms list --project-id <project-id>
agent-hub [--db <path>] rooms create --project-id <project-id> --handle <handle> --title <title> [--description <text>]
agent-hub [--db <path>] rooms use --project-id <project-id> --room <handle-or-thread-id>
agent-hub [--db <path>] rooms send --project-id <project-id> --room <handle-or-thread-id> --message <text>
agent-hub [--db <path>] rooms timeline --project-id <project-id> --room <handle-or-thread-id>
agent-hub [--db <path>] chat [--thread <thread-id>|--room <handle-or-thread-id>]
agent-hub [--db <path>] team roles list --project-id <project-id>
agent-hub [--db <path>] team roles show --project-id <project-id> --role <handle>
agent-hub [--db <path>] team roles save --project-id <project-id> --handle <handle> [--display-name <name>] [--executor codex|claude-code|human|llm_api|workflow]
agent-hub [--db <path>] team roles executor --project-id <project-id> --role <handle>
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

Interactive mode accepts natural language prompts plus enabled adapter prefixes
such as `@codex` and `@claude-code`. It supports `/help`, `/agents`, `/use`,
`/context`, `/context init`, `/clear`, `/exit`, and `/quit`. Interactive task
execution calls the same task runner and repositories as command mode, so it
does not duplicate orchestration logic or create a separate execution path.
This bare interactive shell remains stateless: each prompt is dispatched as a
single run and no conversation thread rows are created.

`agent-hub chat` is the explicit persistent conversation mode. It creates or
resumes a local SQLite-backed conversation thread, can enter a room with
`--room <handle-or-thread-id>`, persists ordered user, run-card, and bounded
assistant-output messages, and accepts `/thread new`, `/thread use <id>`,
`/threads`, `/rooms`, `/room use <handle>`, `/room create <handle> [title]`,
`/room timeline`, `/roles`, `/role <handle>`, `/history`,
`/continue run <id>`, `/continue message <id>`, `/continue clear`, and
`/exit`. Natural-language chat turns use the selected default agent, while
leading enabled adapter prefixes such as `@codex` or `@claude-code` route that turn to a
specific adapter. Chat and `rooms send` also resolve enabled role handles such
as `@researcher`, `@writer`, or custom saved roles, create one shared local
task with assignment metadata, and run each executable `agent_adapter`
participant through the same local `TaskRunner` and isolated worktree path as
command-mode runs. Reserved `human`, `llm_api`, and `workflow` role executors
remain visible assignment metadata and do not start hidden work.

The CLI exposes the same room and team-role concepts used by desktop:
`rooms list`, `rooms create`, `rooms use`, `rooms send`, and `rooms timeline`
operate metadata-backed conversation rooms, while `team roles list`,
`team roles show`, `team roles save`, and `team roles executor` inspect and
persist preset overrides or custom local roles in the same SQLite settings
namespace as the desktop Team workspace. Each chat turn builds a bounded
conversation brief from prior thread messages with the shared
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

Agent availability is controlled by an internal configuration policy, not by a
visible product setting. Normal CLI and desktop surfaces expose Codex and
Claude Code when enabled and hide the deterministic fake adapter. The fake
adapter is available only in debug, development, and test modes, or when an
operator explicitly enables it through hidden environment configuration such
as `AGENT_HUB_AGENT_FAKE_ENABLED=1`. Any adapter can be disabled with the same
per-agent pattern, for example `AGENT_HUB_AGENT_CODEX_ENABLED=0`, or with the
internal allow/block list variables `AGENT_HUB_ENABLED_AGENTS` and
`AGENT_HUB_DISABLED_AGENTS`.

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

Reusable global skills can also live in Agent Hub-owned app data under
`<agent-hub-app-data>/skills/<skill-name>/SKILL.md`. Global skills are created
and listed with `agent-hub skills global create/list`; they are considered for
runtime injection only through explicit task/run selections or role default
skill references. Project context-store skills still load from the project
context store and override same-id global skills unless a task or role
explicitly selects a scoped global skill. Injected skill ids, scopes, display
names, and content hashes are recorded in run evidence as a `skill_inventory`
artifact. `project:<id>` and `global:<id>` are the currently resolvable skill
scopes; reserved `task:<id>` and `role:<id>` references are rejected with a
clear error instead of falling back to another same-id skill. Skills remain
separate from approved memory.

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
worktree checkout, confirms the source repository has a committed `HEAD` before
default `HEAD`-based runs, creates an isolated git worktree outside the original
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
according to the selected cleanup policy. Finalization failures are classified
as failed before cleanup policy evaluation, so `retain_on_failure` preserves
the inspectable worktree. Cleanup-result metadata and final-event persistence
are best-effort after cleanup has already followed that policy; failures there
emit warnings but do not retroactively turn a cleaned successful run into a
failed one. Dangerous verification commands are
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

`--debug` is opt-in. It enables the internal debug/development agent
availability policy, including the fake adapter, for task runs, chat, and
context-build agent selection. For supported run
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
- Runtime injection payloads have a local stdin size guard. Oversized briefs or
  context packs fail inspectably before the external adapter process is
  launched.
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
Agent Hub Desktop exposes the same review-only comparison flow from the run
inspector. A desktop comparison can be created for two terminal runs from the
same task, or for two terminal runs from the same multi-agent desktop turn even
when each agent run has its own task row. The Electron main process validates
that grouping, reuses the shared comparison scoring helper, persists the report
in `comparison_reports`, and returns the human summary plus structured signals
through sandboxed IPC. Desktop comparison actions do not accept, merge, push,
apply code, or change retained worktrees.

Agent Hub's next product direction is the local AI workgroup roadmap in
`docs/local-ai-workgroup-roadmap.md`. The roadmap evolves the existing
conversation/run evidence model into room-based collaboration with configurable
role-based participants, task grouping, timeline events, structured
inspectors, artifacts, checks, risks, decisions, and memory governance. Preset
roles are templates rather than a closed role set: users should be able to
define custom role handles, capabilities, personas, permissions, context
policies, approval policies, and executor bindings. The first executable role
backend maps to existing local agent adapters, while the model leaves room for
future LLM API, workflow, and human executors. The near-term strategy is
incremental: reuse SQLite-backed conversation threads/messages, TaskRunner
runs, run artifacts, verification results, risk reports, review decisions, and
memory proposals before introducing larger domain splits. The phase roadmap is
not only an MVP plan: it also defines long-term extension horizons for
configurable roles, executor backends, workflow templates, artifact and
knowledge models, pack metadata, and optional sync/collaboration surfaces while
preserving local-first operation as the default.

The Adaptive Role Calls product specification is documented in
`docs/adaptive-role-calls.en.md` and `docs/adaptive-role-calls.zh.md`. It
extends the workgroup direction with dynamic, orchestrator-owned role
collaboration: roles may request help, reject or defer requests, maintain
per-role todo lists, and complete work through an auditable RoleCall graph
without turning role mentions into free-form multi-agent chat or fixed workflow
templates. Custom roles do not receive ambient delegation rights; the
Orchestrator determines call authority from role delegation policy, callee
intake policy, project-level limits, and explicit approval state. The main
conversation must stay concise: RoleCall DAGs, todo lists, events, commands,
and evidence are available through collapsed review surfaces rather than shown
inline by default.
The implementation sequence is tracked in
`docs/adaptive-role-calls-implementation-roadmap.md`.
The first implementation slice adds shared/core Adaptive Role Call contracts and
runtime validators for role definitions, intents, calls, decisions, todos,
events, results, and state transitions without changing run behavior yet.
The persistence slice stores RoleCalls, RoleCallEvents, and RoleTodos as
first-class local SQLite audit records with thread, message, run, parent-call,
role, status, and todo-state queries.
The parser/policy slice adds line-start role-call intent parsing and
deterministic authorization checks for delegation, intake, project limits,
graph limits, todo capacity, approval requirements, and dangerous command text.
The ledger-runtime slice introduces a local RoleCall Orchestrator service that
turns authorized intents into persisted RoleCalls, intake decisions, events,
and callee todos with deterministic test intake, but still does not execute
Codex, Claude, or other role workers.

The companion interaction optimization plan lives in
`docs/interaction-optimization-roadmap.md`. It records the near-term
experience corrections for reducing visible complexity: quiet room transcripts,
agent-output-only answers, same-participant multi-turn room context, discoverable
project and room creation, room-level shared-context governance, global skill
scope, composer autocomplete, button/control states, run progress, inspector
hierarchy, error states, preferences, and keyboard polish. These changes should
keep internal run evidence auditable while presenting the default product
surface as a small set of user concepts: rooms, roles, skills, runs, and
decisions.

Built-in workgroup pack metadata is now defined locally for Core Workgroup,
Engineering, Research, Writing, Analysis, and Operations. Packs are
deterministic product metadata, not a marketplace or third-party code loading
surface. Each pack can contribute artifact type definitions, check types, risk
categories, default role template handles, executor capability hints, context
section provider metadata, and labels. Core labels stay general: Brief,
Context, Artifacts, Checks, Risks, and Memory. Engineering-specific vocabulary
such as Diff, Tests, Worktree, PR, and CI is available only through the
Engineering pack label metadata and maps back to general core surfaces outside
that context. Packs may seed preset roles, but they do not restrict custom
roles.

The first workgroup role foundation is now available in the local desktop
conversation service. Shared role contracts describe a stable handle, display
name, purpose, capability summary, persona, default instructions, permissions,
context policy, approval policy, enabled state, and executor binding. Preset
roles include `@researcher`, `@writer`, `@analyst`, `@operator`, `@reviewer`,
`@engineer`, and `@memory`, and user-defined role shapes such as `@qa`,
`@pm`, `@legal`, or `@customer` can use the same contract. The currently
runnable executor kind is `agent_adapter`, which maps role turns to existing
local fake, Codex, or Claude Code adapters. Reserved executor kinds for
`llm_api`, `workflow`, and `human` are representable but not executed yet.

The desktop Team workspace now exposes that role contract as local project
configuration. Users can inspect preset roles, save safe preset overrides, and
create custom roles with a handle, display name, purpose, capability summary,
persona, default instructions, permissions, context policy, approval policy,
executor binding, enabled state, default room, and tags. Role configuration is
stored in Agent Hub's local SQLite settings for the selected project; it does
not write to the target repository or export `AGENTS.md`, `CLAUDE.md`, or skill
folders. The role list is optimized for scanning with only Role, Purpose,
Executor, and Status columns; longer permissions, policy metadata, and
activity live in the right-side Role Profile panel. The profile panel groups
fields into Basic, Executor, Permissions, Policies, and Advanced accordions,
keeps Basic and Executor open by default, and enables Save Role only when the
draft differs from the stored role. The UI clearly marks `agent_adapter` roles
as runnable through the existing local adapters and keeps `llm_api`,
`workflow`, and `human` roles as reserved non-runnable metadata in this phase.

Desktop rooms now support the first bounded collaboration workflow metadata.
Users can start `handoff`, `review_loop`, or `panel_discussion` workflows from
the room workflow launcher, and power users can also start one with a
`/workflow <mode>` room command. A workflow records participants, executor
availability, max rounds, stop condition, expected outputs, and a visible
summary on the shared task/message metadata. Runnable participants still create
normal TaskRunner-backed local runs with conversation briefs and isolated
worktrees; non-runnable participants remain assigned or waiting. The workflow
does not create autonomous agent chatter, remote queues, hidden follow-up runs,
automatic apply, merge, or push behavior. Timeline events show handoff or
review start, review completion when linked runs finish, and workflow
completion once all executable participants reach terminal state or the
workflow contains only non-runnable participants.
If a runnable assignment fails before its run row can be created, the shared
task can still leave `running` once all executable assignments are terminal.

Agent Hub Desktop is now available as a local conversation console under
`apps/desktop`. It starts with `pnpm --filter desktop dev` and presents a
room-based project shell: project selection and room navigation on the left, a
conversation timeline in the center, and a bottom composer as the primary
interaction surface. Each registered project receives default local rooms
`#general`, `#planning`, `#research`, `#review`, and `#knowledge`, displayed
inside a sidebar hierarchy split into Project, Rooms, and Utilities. The
Utilities zone links to Knowledge, Team, Settings, and sidebar density controls
and carries room/running/run counts as one compact status line instead of a
full status panel. The Project section shows only the active project name in
its collapsed state; project switching and additional project registration sit
inside that same disclosure. A project rooted at `~` is labeled `Home` in the
selector. Rooms show title, a compact last-activity time, a one-line
description, and compact metadata, and the room list is ordered strictly by
latest room activity rather than by the currently selected room.
When there
are no registered projects, the desktop renders local project path registration
controls in the project sidebar and the empty conversation pane; users can
either paste a path or open the system folder picker through the sandboxed
preload API. Submitting either control calls the existing
`window.agentHub.projects.open` IPC path and selects the project's `#general`
room after default room seeding. The empty conversation pane keeps the project
registration card close to the bottom composer and shows a short
register-then-run flow so first-time setup points toward the primary chat
surface instead of reading like a static splash page.
The room header uses product-facing context copy: project, room type, and
`local desktop` are shown as one compact line, while `Context: runtime
injection` stays visible as secondary context with detailed explanation in the
tooltip. This preserves the runtime-injection truth without making the header
read like internal state output.
The sidebar keeps an Add project disclosure visible after setup so additional
local repositories can be registered without returning to onboarding. The
selected project also has an inline custom-room creation flow for title,
optional handle, and optional description; newly created rooms are selected
immediately and start with room shared context enabled.
Empty desktop states are action-oriented rather than explanatory dead ends:
project setup, empty room lists, filtered Team and Knowledge results, empty
artifact inventory, and missing inspector details each show the next local
action such as adding a project, creating a room or role, clearing a filter, or
opening settings. The desktop also includes a renderer-only command palette
opened with Cmd/Ctrl+K for primary local actions such as creating a room,
opening Knowledge or Team workspaces, opening verification settings, and
toggling sidebar density. Harmless local preferences persist in browser
storage for the selected project and room, active workspace, context mode,
inspector tab, sidebar density, and recent agent or role targets. These
preferences do not store prompts, logs, diffs, secrets, repository paths, or
approved memory.

The composer accepts mention-based prompts such as `@codex ...` or multi-agent
mentions, and it now also accepts enabled role handles such as `@researcher`
or `@engineer` through the same text path. Enabled adapter mentions
(`@codex`, `@claude`, and `@claude-code`, plus `@fake` only when the internal
debug/development policy enables it) remain supported. The
desktop composer provides `@` autocomplete for adapters, enabled preset roles,
enabled custom roles, and recent targets; `/` suggestions surface common room,
review, memory, comparison, continuation, and workflow prompt patterns without
adding a new command backend. Unknown mentions stay in the prompt text and do
not block submission. Target chips show the expected selected agents/roles,
can pin fallback targets as explicit mentions, and can remove explicit
mentions before the turn is submitted. Applying autocomplete and removing
target chips preserve prompt formatting outside the affected mention token so
indented code, YAML, and aligned text are not rewritten. Context mode uses
quiet segmented controls, and the submit button reports the expected local run
fan-out as the only high-emphasis composer action. The room workflow launcher
stays compact when idle, showing a single-line summary such as
`Workflow: Review Loop · max 2 rounds` with a low-priority Start affordance on
the right. The room header, transcript, workflow launcher, and composer share a
centered conversation column on wide screens so long responses read as a
thread rather than scattered dashboard cards. Role mentions are resolved in
the Electron main process, persisted on
the user message and run-card metadata, and copied to run metadata so review
surfaces can show which role and executor produced a run. The renderer sends
prompt text through the safe `window.agentHub.threads.sendMessage` preload API;
the Electron main-process thread service resolves project-level Team workspace
roles, strips known agent or role mentions from the task body, persists
one ordered user message in the selected SQLite-backed room thread, creates one
shared task for the instruction, records task-created and participants-assigned
system timeline events, then creates one run per executable assignment through
`RunService`. Non-executable reserved role executors such as `human`,
`workflow`, or `llm_api` remain assigned on the task without starting a run.
The timeline groups linked run cards under the shared task and persists one
hidden pending assistant-output message per run. When a run reaches a terminal
state, the pending assistant message is updated with the agent-facing final
output or a concise failure/cancel summary while preserving the resolved role
assignment, so the room transcript presents role-backed replies as `@role` with
the local executor shown separately. If no room is selected, the message
goes to the project's default `#general` room. If no agent or role is mentioned
or supplied by the caller, desktop falls back to the current default enabled
adapter.

Timeline rows now carry bounded event semantics in message metadata. User
messages, participant responses, task-created rows, assignment rows, system
events, run cards, checks, risks, artifacts, review decisions, and memory
proposal signals render as distinct audit-stream cards or chips while still
using the existing conversation message and run evidence records. Linked task,
run, and assignment ids are stored as compact metadata so a visible event can
open the relevant inspector context without copying raw logs, diffs,
verification output, risk reports, or memory details into the room transcript.

Active inline run cards subscribe to the existing desktop run event stream and
replay already-persisted events when a subscription starts after a fast run has
advanced. Routine one-agent chat turns render as compact participant activity
and prefer the latest agent-facing natural-language output over lifecycle
details. Agent-facing transcript output and live compact run output render
Markdown, including lists, code blocks, links, tables, and other common GFM
syntax, while raw HTML remains disabled. Raw event lines stay behind the
inspector's Audit view by default. The transcript follows new room or live run
updates only while the user is already near the bottom; scrolling up to inspect
older messages disables automatic follow-scroll until the user returns to the
bottom.
Once a completed run has a durable assistant answer and no changed files, the
default transcript hides the run card entirely and keeps the answer as the main
visible row. Runs that modify files, fail, are cancelled, need review, or have
comparison peers remain visible as review affordances. Main run cards stay
compact: they show agent, status, one conclusion line, a few high-level facts,
and state-specific actions such as Review, View failure, View live log,
Cancel, Accept, Reject, or Artifacts. Detailed checks, risks, lifecycle, audit
counts, memory proposals, artifacts, and raw logs remain in the inspector
instead of the card body. Checks, risks, memory proposals, brief data, context
previews, comparison reports, and audit logs load lazily when the user opens
the on-demand workgroup inspector drawer.
The chat surface also derives a lightweight visual state from the latest
visible run. Idle rooms keep the composer and workflow controls inviting,
running rooms emphasize live run progress, failed rooms make the incident card
dominant while keeping composer/workflow usable, and review-ready rooms return
attention to the transcript and review affordance.
Existing persisted run records are
synthesized into thread-shaped conversations only as a compatibility import
when no durable conversation threads exist yet, so old desktop run data remains
inspectable without making run synthesis the primary thread store. Desktop
thread lists and details now read from the core conversation repositories, use
a lightweight run status map for run-card status/counts, and reconcile
assistant output only for the selected room. Older conversation threads without
room metadata remain readable as custom rooms. Run records, events, skipped or
configured verification rows, collected diffs, and risk review rows remain
SQLite-backed.

Verification setup failures in the desktop point back to the Settings panel
instead of leaving a generic room error. Empty verification settings include
an explicit no-commands state, the skipped-check consequence, examples such as
`pnpm test`, `npm run lint`, and `npm run typecheck`, and an Add Command
primary action. Save changes stays disabled until the command draft changes
and the renderer-side draft has a unique command id, executable, and valid
timeout. Validation errors are shown as product-facing settings messages before
IPC, while the main-process settings service still enforces the same boundary
before persistence. Errors explain that commands should be split into
executable and argument fields and that secret-like option names are rejected
before persistence.

Agent Hub keeps project context, thread context, current-turn context, and
per-run context snapshots as separate layers. Desktop follow-up turns build a
bounded conversation brief before each run. The brief includes the current
turn, prior user messages for the same direct adapter or resolved role
participant, terminal assistant answers from the same participant, compact run
summaries for that participant when no assistant answer exists yet, a
participant-scoped deterministic thread summary, project context-store
references, and explicit character-budget metadata. Other roles' and direct
agents' prior prompts and outputs stay out of the raw recent-message list and
the injected thread summary unless the user chooses an explicit continuation
path. Each room has a local shared-context switch, defaulting on. If
the switch is off, new desktop runs in that room still receive the current
prompt, approved project context, role instructions, selected skills, and any
explicit continuation, but prior room messages and the room summary are left
out of the generated conversation brief. Role-targeted desktop turns add the
resolved role handle, display name, executor, persona, default instructions,
permissions, default skill references, context policy, and approval policy to
that same brief and to TaskRunner constraints/hints before execution. Follow-up
Codex turns to the same role or direct `@codex` target also pass the prior
Codex CLI session id when a previous `thread.started` event exists, so the
process-backed adapter resumes the CLI conversation instead of starting a fresh
Codex session. A zero
recent-message budget includes no prior messages, and the first message in an
empty thread uses the retitled thread name in the injected brief. Agent Hub
persists that exact brief as a
`conversation_brief` run artifact so review can inspect what was injected. The
brief excludes raw lifecycle/debug events, logs,
diffs, verification output, risk evidence, and other review artifacts. Full
evidence remains on the run model; assistant messages store only bounded
transcript text for future turns. Thread summaries are generated locally from
transcript text only and are never written to approved memory automatically.
Terminal process summaries such as adapter exit-code lines remain review
evidence and are not promoted into assistant transcript answers. Successful
terminal runs with no agent-facing output get a concise empty-output message
and a review affordance instead of a fabricated answer.

The workgroup inspector is the desktop drill-down surface for review evidence.
Its top-level tabs use compact product vocabulary: Brief, Evidence, Artifacts,
Memory, and Audit. The default drawer is a narrow detail panel, with an
optional Deep mode for long audit logs, lifecycle controls, and artifact diffs.
Evidence groups checks, risks, context availability, and lifecycle summary;
full conversation-brief content remains reachable through artifact evidence
instead of occupying the default narrow panel. Brief is conclusion-first: it
shows any
blocking risk at the top, then the review conclusion and short suggested
direction as text. The header treats Close as a panel control, keeps Refresh
as a lower-priority utility, and separates Accept and Reject as decision
actions. Brief summarizes run evidence in two compact sections: Outcome
contains changed files, checks, risk, and duration; Review contains agent,
review state, memory proposal count, and parent run. Suggestions stay in the
conclusion or manual next-action area rather than appearing as metrics. It still shows the goal,
status, assignee, acceptance-criteria placeholder, and decision boundary below
the conclusion. Artifacts begins with a local artifact inventory derived from
persisted `run_artifacts`.
Each artifact has bounded metadata for title, artifact type, source run, source
task, thread id when known, creator, summary, local availability, and a capped
content preview. The artifact inventory uses compact visible labels for long
artifact kinds such as conversation briefs while preserving the full kind as
metadata.
`git_diff` artifact previews use the same sensitive-path redaction boundary as
the Diff review so secret-bearing patches are not copied into artifact chips or
the sandboxed renderer.
Important run outputs can also appear as named artifact chips on timeline run
cards, linking back to the Artifacts inspector tab without copying raw evidence
into the room transcript. The same tab still contains engineering-specific
evidence such as changed-file stats, bounded unified diffs, retained-worktree
handoff, and local comparison reports, keeping those labels out of the
top-level navigation. Evidence shows captured verification rows, persisted
TaskRunner safety reports or deterministic fallback findings, and
retained-worktree lifecycle summary; Deep mode exposes explicit cleanup and
local apply controls. Memory shows conservative proposals, and Audit shows
bounded raw logs.
All of this
loads through `window.agentHub.review.*`, `window.agentHub.comparison.*`, and
`window.agentHub.lifecycle.*`, and `window.agentHub.memory.*` IPC methods.
Blocking persisted safety reports keep
their `blocking` level and mapped evidence in the inspector so sensitive-path
or dangerous-instruction findings are not downgraded by the desktop fallback
risk classifier. Fake desktop runs explicitly show that no real repository
files were modified and do not invent changed files. When a retained worktree
exists, desktop diff loading uses read-only Git inspection from the Electron
main process only; renderer code never receives shell, filesystem, SQLite, or
Git access. Manual handoff still exposes the worktree path, branch, base/head
refs, cleanup status, changed files, and exact local review commands inside
Artifacts. Open/copy actions are validated IPC calls handled by the main
process, and the copied commands are review-only commands such as `git status`
and `git diff`; Agent Hub does not generate merge, push, apply, or cleanup
commands from manual handoff. Lifecycle actions are separate explicit IPC calls:
mark keep records user intent, cleanup requires the exact `cleanup <run-id>`
confirmation phrase before removing a retained local worktree, and apply first
previews the bounded patch, checks the latest risk report, blocks `blocking`
risk, requires `apply <run-id>`, and then runs local `git apply --check` plus
`git apply` only against the local project checkout. Apply execution reads the
raw persisted patch in the Electron main process rather than the bounded,
redacted inspector preview. It does not commit, push, merge, create pull
requests, approve memory, or export repository context.
Each lifecycle decision writes a `lifecycle_audit` run artifact, a lifecycle
run event, and a linked room timeline event when the run belongs to a thread.
Desktop memory proposal generation is idempotent for each run:
summary cards, run-detail loading, and the memory tab can refresh in parallel
without duplicating the same proposal content or growing beyond the bounded
proposal set for that run. Verification-command memory proposals use the same
secret-like command filter in desktop and task runner paths, so commands
containing token, API key, password, credential, or similar terms are skipped
instead of being persisted as proposed memory.

The desktop Knowledge workspace is the project-level memory and decision
browser. It is opened from the local sidebar and lists approved, proposed, and
rejected memory items alongside thread-local summaries, decisions captured from
thread summaries, and audit review decisions stored as `review_decision`
artifacts. Filters cover all records, decisions, summaries, proposed memory,
approved memory, and rejected memory. Each record keeps source links to a
thread/message, task, run, or artifact when that metadata exists. Run links
open the existing workgroup inspector; thread and message links return to the
source room. Approval and rejection remain explicit user actions for proposed
memory only. Thread summaries stay visible as thread-local context and are not
treated as approved project memory unless a user explicitly promotes equivalent
content through the memory approval workflow.

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
Electron. Desktop markdown links are treated as untrusted content: renderer links request `window.open`, while the Electron main process denies new in-app windows and routes only `http`, `https`, and `mailto` URLs to `shell.openExternal`.

The current desktop execution path is TaskRunner-backed in the Electron main
process. `RunService` can now attach a queued desktop run to an existing
thread-created task, so multi-role desktop turns share one task id while each
executable assignment keeps its own run id and local worktree. `@fake` runs
through `FakeAgentAdapter` in an isolated worktree only when fake is enabled by
debug/development or internal agent availability configuration
and exposes real diff, skipped verification, risk, logs, metadata, and proposed
memory evidence. Mentioned `@codex` and `@claude` runs invoke the local
process-backed adapter preflight through TaskRunner; unavailable CLIs fail as
inspectable persisted run events instead of service crashes. Desktop runs do
not write Agent Hub context files into the target repository root, merge, push,
export repository context, apply code, or approve memory automatically. Failed
Codex or Claude preflight events include the adapter's detection reason,
executable name, verification command, worktree cwd, and PATH entries when
available; inline run cards surface that evidence so the user can fix the local
CLI installation or authentication without opening raw logs first. Explicit
desktop memory approval writes only to Agent Hub's context store and confirms
the local approved-memory path in the inspector. Current
desktop paths accept run-linked or message-linked continuation requests,
validate that supplied message ids still belong to the requested parent run,
require a retained worktree before continuing code state, and otherwise fail
with a clear system message. Desktop verification settings are local and
per-project; they are edited through validated IPC and then run by TaskRunner in
the isolated worktree. The run inspector can also compare terminal same-task or
same-turn runs and show persisted status, risk, verification, diff footprint,
score, and winner signals. Explicit desktop memory approval writes only to Agent
Hub's approved-memory context store. Worktree lifecycle management is now
explicit in the inspector, and local apply is a human-gated review workflow;
merge, push, pull request creation, and branch deletion remain outside the
desktop apply flow.

SQLite is stored in Agent Hub-owned application data by default, not in the
target project repository. `AGENT_HUB_HOME` can point Agent Hub at an alternate
app data directory, and `AGENT_HUB_DB_PATH` can point at an explicit database
file for local testing or development. In-memory repositories remain available
for injected tests and focused runner verification. The current SQLite runtime
uses a persistent queued `sqlite3` CLI session per database, initializes WAL
mode for file databases, and closes that session when the database is closed.
This removes the previous per-statement process startup cost while keeping the
storage API local and swappable.

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
- task briefs, conversation briefs, git diffs, review decisions, provenance,
  lifecycle audit decisions, and other local run evidence in `run_artifacts`
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

Tasks include an optional JSON metadata field. The desktop thread service uses
that field for local room/thread provenance, the source user message, and
assignment metadata such as role handle, executor kind, executable state, and
linked run id. The metadata is local audit data; it does not approve memory,
apply code, or create remote collaboration state.

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
Desktop thread compatibility import of legacy runs is retried after transient
run-list failures rather than being treated as permanently complete.
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
successful run can complete the task, or the user can cancel it. For shared
desktop tasks, task status is aggregated across linked runs: queued or running
assignments keep the task `running`, all-succeeded runs complete it, and any
failed or cancelled final state returns it to `open` for review.

The product remains local-only. This rebuild does not add cloud sync, accounts,
multi-user team collaboration, hosted dashboards, automatic pull requests,
automatic merges, or automatic pushes.

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
mapping, additional local executor backends, first-class schema splits when the
metadata-backed workgroup model no longer fits, and explicit merge, push, pull
request, or branch-deletion workflows outside desktop local apply.
