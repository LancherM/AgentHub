# Product

Last audited against `origin/main` at `9f00576` on 2026-06-10.

Agent Hub is a local-first, CLI-first tool for orchestrating coding agents on a
developer machine. It manages local projects, task briefs, context packs,
skills, memory proposals, isolated git worktrees, agent runs, verification
results, diffs, risk reports, comparison reports, desktop review evidence, and
auditable role collaboration.

Agent Hub is not a SaaS product. It does not add a cloud backend, browser-only
dashboard, account system, remote execution queue, automatic merge, automatic
push, or automatic pull request creation.

## Current Product Shape

Agent Hub has two user-facing surfaces over the same local core:

- `apps/cli`: the primary interface. It supports project registration, context
  store management, task creation, agent runs, chat/rooms, team roles, RoleCall
  audit commands, run review, risk review, memory governance, and comparison
  reports.
- `apps/desktop`: an Electron + React desktop shell. It provides room-based
  local project chat, inline run cards, role-aware collaboration, review
  inspector tabs, Knowledge and Team workspaces, verification settings,
  retained-worktree handoff, explicit cleanup, and human-gated local apply.

The CLI and desktop both call local packages under `packages/`. The desktop
renderer stays sandboxed behind `window.agentHub`; orchestration, filesystem,
SQLite, shell, git, and agent execution remain in Electron main-process services
or shared local packages.

`agent-hub tui` is a current-context terminal workbench shell. It renders a
conversation-first Work surface plus bounded run, RoleCall, review, task,
team-role, memory, and skill summaries from shared read models, supports
launch by thread or room, and submits composer prompts through the same local
CLI chat path. Loop continuation, memory approval, apply, merge, push, and PR
creation stay outside the TUI; review writes are audit-only `review_decision`
records.
Its Runs and Tasks focus modes are current-context operating views: they show
active/recent run status, stage, checks, risk, diff counts, retained-worktree
state, linked CLI commands, assignments, RoleTodos, deferred/rejected follow-up
signals, and the next action without exposing raw logs or full patches. Compact
run stage/latest summaries use the same TUI presentation filter as active-run
boxes, so internal setup or Codex diagnostic lines remain in raw evidence rather
than the operator-facing summary.
The RoleCall graph shows bounded loop state, including iteration count,
pending/waiting/active counts, convergence reason, max-iteration stops,
blocking-risk stops, and waiting-for-approval or waiting-for-context stops.
Continuation helpers prepare an explicit composer prompt; they do not continue
work in the background.
Review decisions can be recorded with `agent-hub reviews accept|reject` or the
TUI review shortcuts. These decisions create local `review_decision` artifacts
only; they do not apply files, alter run status, merge, push, approve memory,
clean worktrees, or delete branches.
The Memory focus mode is a governance indicator, not a browser: it shows
proposed/approved/rejected counts, the approved-memory source, explicit
approval/rejection command hints, selected skills, available skill identifiers,
and the current context delivery mode.
The Team read-model pane is available from the default tab cycle, the `Team`
tab label, the uppercase `E` focus shortcut, typing `/team` in the composer,
or the command palette. It shows the current project's resolved preset,
preset-overridden, and custom roles from the same role settings used by
`team roles list`, including enabled/runnable counts, executor labels, default
rooms, and the equivalent CLI list command.
The command palette (`:`) collects current-context CLI command hints for runs,
RoleCalls, review, and memory. It is a terminal aid only; it does not add
project or room browsing.
TUI hardening keeps failure states local and recoverable: missing project
registration, failed context reads, unavailable agent CLIs, reserved role
executors, and missing linked-run evidence render concise status text plus
equivalent CLI recovery commands instead of opening broad browsers or applying
side effects.
The Work focus is a conversation terminal. User messages, RoleCall
delegations, completed or failed terminal run output, verification summaries,
and risk summaries are folded into a chronological conversation flow. Role
backed runs display the role handle from linked RoleCalls, run/message metadata,
or task assignments before falling back to the adapter kind. Running runs appear
as active-run boxes with full agent-facing output preserved in the read model
and rendered as a terminal-bounded latest-output tail, falling back to
observable runtime events plus the active cursor indicator. When an adapter has
not emitted assistant text or useful runtime
activity yet, the active box shows `agent thinking...` while filtering raw JSON
protocol frames, setup lifecycle noise, internal agent protocol summaries,
runtime warnings, Codex internal diagnostics, and skill activation noise. Runs awaiting local review with changed
files leave the active box and render their completed output plus
verification/risk summaries and a final `[V]iew` review hint. Runs with no
changed files render as completed output without an awaiting-review prompt.
The Work conversation uses a terminal-native visual grammar: the header is a
reverse-color status bar with project, selected agent, iteration, risk, and the
current clock; high/blocking risk turns the header red and medium risk turns it
yellow. Idle sessions show a low-flicker `◈` indicator that does not drive a
constant screen repaint, while active sessions use the running marker. Agent
and role-backed run entries use a colored left `┃` bar, role/run/status
metadata, elapsed time, optional token/cost usage, and a timestamp. User
messages stay plain with a timestamp. The Work viewport budgets fixed chrome
rows for the header, warnings/status/attention strip, composer, tabs, and
status bar before slicing the visible conversation tail, so long agent output
does not push earlier visible rows under the header. Conversation content
keeps file paths underlined and blue with safe OSC 8 file links when the
terminal supports them, shell-command lines bold, and fenced code blocks lightly
highlighted for keywords, strings, and comments. Agent output content is not
truncated; long lines wrap in the terminal surface using display-width-aware
breaks so CJK/full-width text, Markdown links, paths, and inline code keep
their visible tail instead of relying on Ink truncation. Conversation entries
are separated by terminal divider lines, and gaps of five minutes or more add a
compact timeline anchor so long Work histories remain scannable without
collapsing agent output.
Active run boxes use rounded frames that grow to fit wrapped visible output.
Titles show the compact run identity, role/agent handle, a static running
marker, running status, elapsed time, and live token usage when the run emits
usage metadata. The footer keeps an active cursor when no reliable progress
exists, or a best-effort progress bar when recent output includes an obvious
percentage or `N/M` pattern. At most three active runs render as full boxes;
older active runs collapse to one-line titles. A chatty active run keeps the
newest wrapped lines visible and adds an omitted-line marker when the full box
would crowd out the Work conversation. Completion and failure state is shown
through refreshed read-model rows rather than timed renderer flashes, so the
terminal does not repaint only to clear decorative feedback.
When the latest agent result is visible and the composer is empty, Work may show
two or three dim quick replies such as running more tests, fixing verification,
reviewing risk, continuing, or fixing similar issues. Pressing `1`, `2`, or `3`
submits the selected suggestion through the same prompt callback as manual
composer text; numeric keys remain normal text while the composer is non-empty.
Typing hides suggestions, and `C` prepares a continuation prompt without
submitting it.
Small run diffs are projected directly into Work when the collected git diff
has five or fewer changed lines; file/hunk headers are dim, additions are
green, deletions are red, and context stays plain. The Ink renderer wraps these
inline diffs in a compact diff mini card; larger diffs use the same card shape
around a `(+N/-M in F files)` summary. Inline TUI diff projections use the same
sensitive-path guard as review patch previews and redact patch text when
changed-file metadata or diff headers identify `.env`, key, token, credential,
or secret paths. Dense runs of more than three pending reviews collapse into a
single Work line with a `[V]iew` hint. In Review, `Enter` or `Space` expands the
selected run diff and `Esc` collapses it; `s` shows a read-only split compare
summary only when the selected task has at least two runs.
Search is local to the TUI renderer. `Ctrl+F` or `/search` opens a search
overlay over rendered conversation text, shows match count/current match, and
uses Up/Down to move between matches; `Esc` closes it without corrupting the
composer. The command palette accepts input, fuzzy filters safe focus actions
and existing local CLI command hints, highlights matches, and uses `Enter` to
either switch focus or prepare the selected command in the composer.
The optional mini timeline is also local renderer state. `/timeline` or
empty-composer `L` opens a compact chronological view over the current rendered
conversation, active runs, and recent runs; `Esc` or `L` closes it. `/notify`
toggles in-memory completion notifications for the current terminal session
only. When enabled, the TUI emits a terminal bell plus OSC 9 notification only
after a previously active run leaves the active list and had been running for
more than 30 seconds. Notifications and timeline state do not persist settings,
alter run behavior, or invoke external services. Startup splash is explicit:
`--splash` prints a short prelude before the interactive Ink frame, so the live
frame does not need a delayed splash-removal repaint; `--no-splash` suppresses
it.
The default tab bar matches the conversation-terminal scheme: Work, Runs, View,
Graph, Tasks, Memory, Team, and Help stay one key away instead of being
embedded into the first screen.
One-shot TUI renders (`--once`) are intended for quick smoke checks and return
to the shell after printing the current workbench. Normal `agent-hub tui`
launches stay open when stdin/stdout are an interactive terminal with raw-mode
support. The TUI renderer is now an Ink component tree under
`apps/cli/src/tui-ink`, loaded by the CLI command boundary and backed by the
same shared read models and action callbacks. The legacy hand-rendered string
workbench has been removed as a runtime path; the remaining TUI roadmap work is
interaction polish, scroll behavior, and broader state coverage without
changing the governance boundaries above.
The current optimization plan is tracked in
`docs/tui-optimization-roadmap.md`. It keeps the same TUI boundaries and
focuses on footer command hierarchy, narrow-terminal layout, attention/next
action summaries, warning hygiene, stale active-run signals, and copy/help
consistency.
The next proposed TUI refactor is tracked in `docs/tui-v3-roadmap.md`. It keeps
the current Ink/read-model boundary but moves toward a denser three-region
terminal workbench: persistent side navigation, a main workflow surface, and a
selected-object detail panel for Work, Memory, and Team. The plan explicitly
marks bottom-layer gaps such as generic detail payloads, structured tool-call
events, memory proposal evidence rows, delegation matrices, role profiles, and
audited memory action callbacks so later implementation phases do not fake
unsupported evidence.
The TUI composer is prompt-first while editing: printable lowercase keys append
to the prompt from any focus, uppercase tab shortcuts switch
Work/Runs/View/Graph/Tasks/Memory/Team, `/team` opens the Team roles view
without submitting a prompt, `Enter` submits non-command prompts when a
submission callback is available, `Esc` clears the in-progress prompt, and
empty-composer `Enter` does not switch panes. `Tab` remains available for focus
navigation except while an active `@` mention completion is open. The composer
shows a submit preview with the target agent or role, current thread, and
context mode; keeps an in-session submitted prompt history on Up/Down; supports
explicit multiline editing with `Ctrl+O`; and lists selected agent, built-in
agent, and enabled team-role completions while editing an `@` token. It also
supports cursor movement plus Home/End, Backspace/Delete, and Ctrl+A/E/U/D
editing controls. Empty-composer Work shortcuts that would steal normal prompt
text use uppercase keys, including `C` for continue and `L` for the mini
timeline. Runs, RoleCalls, and Tasks show selected rows with a visible `▌`
marker plus inverse row styling, and the bottom shortcut hint changes by focus
instead of showing one global command string. The permanent footer is
width-aware: narrow terminals keep only primary keys visible, while full
current-context CLI commands remain in the command palette, focused detail
panes, or explicit command-print status messages. The Work surface uses
explicit width/height row budgets: 48-column terminals keep header, Work
content, composer, footer, and tabs readable; structural conversation prefixes
are repeated on wrapped lines; and narrow or short terminals render active
runs as compact four-line boxes while normal terminals keep the fuller active
run frame. When actionable state exists, a single attention strip appears below
warnings/status with deterministic, read-only summaries for blocking risk,
failed checks, waiting RoleCalls, pending review, unavailable executors, and
proposed memory. Narrow terminals show only the highest-priority item plus a
`: more` hint; the strip does not execute actions or steal prompt text. Active
runs older than the stale threshold and still lacking useful output are marked
as `stale` in Work and summarized as `stale run <n> R` in the attention strip;
this is inspect-only and does not cancel, fail, or mutate the run. One-shot and
interactive TUI entry suppress implementation-level JSON-module runtime
warnings from Ink dependencies so the first visible line is the TUI frame or an
Agent Hub state message, not a Node warning. Generated TUI copy stays in a
single English operator voice: Review hints use `open [V]iew for details`,
context delivery is shown as `context runtime` instead of implementation enum
names, Team roles show labels such as `runs with codex` or `manual`, and Memory
uses readable labels for approved memory, skill source, and context.
Interactive
submit and review-decision actions show bounded busy states without locking the
keyboard: users can still switch focus, open command hints, and draft the next
prompt while the current local action is running. Composer submit returns after
the local chat turn is recorded and the background run is started or queued; it
does not wait for agent execution to finish. Review-decision writes remain
single-flight until that local action finishes or times out.
Prompt submission keeps the terminal workbench in control of the screen: agent
stdout, run debug details, and raw adapter text are persisted through the normal
chat/run records and then shown through TUI panes, not dumped directly into the
Ink alternate screen during an interactive submit.
Role-backed prompt submissions preserve role order per project: consecutive
turns targeting the same `@role` queue behind that role's active run, while
different roles and direct adapter mentions may run concurrently. Queued
role-backed desktop runs keep their execution input as local run evidence so a
later desktop service instance can start the older queued run before accepting
new same-role work.
Interactive TUI sessions periodically refresh the same current-context read
model so externally changing run, task, conversation, RoleCall, and review
state can appear without a manual keypress. Active-run refreshes stay
responsive, idle refreshes use a slower cadence, and refreshes with no
renderable read-model change are ignored to avoid unnecessary full-screen
redraws. New conversation or active-run output anchors Work back to the bottom.
TaskRunner persists run events as they are produced, so running boxes can show
live progress from the local evidence store instead of waiting for final run
completion. The conversation can scroll back by
rendered line from Work focus, Runs and Tasks panes expand on taller terminals,
uppercase focus keys switch Work/Runs/View/Graph/Tasks/Memory/Team when the
composer is empty, and the Review reject shortcut is uppercase `R` so
vim-style `j` remains navigation rather than an audit write.
When the graph has no selected RoleCall, the TUI command hint and command
palette surface `agent-hub team roles list --project-id <project-id>` as the
next useful role command; `/team` is the in-TUI shortcut for viewing that list
directly.
TUI validation is expected to work from a clean checkout: root typecheck and
lint scripts check the Ink renderer through TypeScript build-mode references,
allowing required local `dist` declarations to be generated during validation
instead of assuming they already exist.
CI also publishes a report-only Vitest full-coverage summary and coverage
artifact from the required Validate job. Pull requests additionally run a
blocking diff-coverage check over changed executable source lines with an
initial 70% threshold; non-source, test, documentation, workflow, and
non-executable line changes are ignored while the project establishes
package-level full-coverage baselines.
Every visible TUI workflow change also carries a manual terminal QA contract:
rebuild the CLI first, smoke `tui --once`, launch the rebuilt interactive TUI in
normal and narrow PTY sizes, cover the affected core loop, and write an
untracked note under `docs/ui-verification/` with the commands, observations,
and remaining UI risks.

## Core Concepts

Projects are local repository roots registered in Agent Hub's SQLite database.
SQLite and context stores live in Agent Hub-owned application data by default,
not inside the target repository. SQLite access is in-process through a native
local driver, so normal CLI and desktop usage does not require a system
`sqlite3` executable.

Tasks are local work items. Task runs execute one agent adapter inside an
isolated git worktree and persist events, artifacts, verification rows, risk
reports, and metadata for later review.

Context stores are Agent Hub-owned directories containing project context,
approved memory, and project skills. Runtime context delivery is non-invasive by
default: generated task briefs and context packs are injected into the adapter
run rather than written into the source checkout.
Task runs also persist a typed `runtime_context_pack` artifact alongside the
existing task brief and conversation brief evidence so later review can inspect
context layers, trust labels, source ids, source hashes, compression metadata,
and diagnostics. The selected runtime pack is also rendered back into the task
brief, worktree overlay payload, and adapter runtime markdown so retrieval
results that survive policy and budget checks are the context the agent sees.
Each run also records a deterministic `context_plan` artifact with the
rule-based task type, required layers, retrieval routes, layer trust policy,
budget policy, and compression policy used to assemble runtime context evidence.
Runs now also persist a `context_retrieval_candidates` artifact for
already-selected explicit sources such as the current task, selected or
role-default skills, selected files, selected runs, and current thread
continuity. The same retrieval boundary also emits deterministic `task_rule`
candidates for compiled project context and approved memory sections whose
layers are required by the current context plan. This is inspectable audit
evidence and feeds the runtime context selector before agent execution. If
retrieval or selection fails after a run row is created, the run is finalized as
failed and the task returns to `open` instead of remaining stuck in `running`.
Agent Hub also maintains local SQLite index storage for stable text sources:
project context docs, approved memory, project skills, and global skills. The
index rebuild path is deterministic per project and tracks source hashes so
unchanged sources are not rewritten; run evidence and thread summaries are not
indexed in this stable-source path. The default CLI and desktop TaskRunner
paths refresh this stable-source index before run retrieval when a project
context store is available. Indexed retrieval is keyed by the TaskRunner task
project id, so normal CLI and desktop runs still search the freshly refreshed
index when repository metadata uses its default `repo_<name>` id.
When a project has stable-source index data available, retrieval can add BM25
ranked candidates to the same `context_retrieval_candidates` artifact. These
ranked candidates include lexical score diagnostics, matched query terms, layer
and trust metadata, and duplicate omissions when BM25 finds a source already
selected through the explicit route. Indexed project or global skills are only
eligible through BM25 when the task or role selected the matching skill
reference; otherwise they are omitted as unrequested skills. Unscoped skill
references follow the same project-first resolver used by context compilation;
global skills require an explicit `global:<id>` reference.
Retrieval also produces bounded recency candidates for volatile local evidence:
recent run summaries, verification outcomes, risk summaries, changed-file
summaries, and thread summaries. Run evidence is medium trust; thread summaries
remain low-trust continuity. Raw logs, raw diffs, full verification output
bodies, full risk finding bodies, and full conversation transcripts are not
included in recency candidates.
Agent Hub also builds a deterministic local TypeScript code graph for source and
test files when a code graph repository is configured. The graph is persisted in
local SQLite for the default CLI and desktop paths and records imports, exports,
symbols, package boundaries, source-to-test relationships, and changed-file
proximity so graph retrieval can add high-trust code or test candidates with
graph proximity diagnostics. Graph search uses the same task project id as the
index refresh path. This remains local-only and does not require embeddings or
a cloud index.
Semantic retrieval is optional. Runs may configure a local embedding retriever
and a local reranker, both guarded by capability detection. With no configured
provider, Agent Hub records a skip diagnostic and continues with deterministic
explicit, task-rule, BM25, graph, and recency retrieval. Hybrid fusion can combine
same-source route signals such as BM25 plus embedding without introducing a
cloud dependency or secret storage.
Completed runs also record local context evaluation events linked to run
outcome, verification status, risk level, omitted context, compression/noise
signals, and explicit review decisions. The CLI can inspect a run's context
plan, selected runtime context sections, omissions, and eval events through
`agent-hub context plan|selected|omissions|eval <run-id>`. Eval events are
audit evidence only and do not automatically approve or promote memory.
The typed `runtime_context_pack` now selects policy-allowed retrieval candidates
from explicit, task-rule, BM25, embedding, graph, and recency routes after hard
filtering, ranking, and layer-budget checks. The selector applies
deterministic, source-aware compression before omitting over-budget project
docs, run evidence, or conversation continuity, and records requested/used
layer budgets plus compression counts in runtime pack diagnostics.
Conversation compression keeps the low-trust override limits and preserves
representative freeform continuity body lines when no structured summary
headings are present. Selected candidates are appended to the typed pack with
source ids, hashes, trust labels, compression metadata, and inclusion reasons;
omitted candidates are recorded with reasons.
The current task and runtime policy remain pinned, and adapter-facing markdown
injection remains compatible with the existing task brief path while using the
selected runtime sections as its source.
Runtime context assembly applies hard local policy before memory and skills are
included: proposed or rejected memory, secret-like source paths,
repository-root agent instruction exports, and unsupported task/role skill
scopes are filtered with diagnostics. Secret-like selected files are filtered by
all path segments, and indexed approved memory is deduplicated against the base
approved-memory section before runtime injection. Conversation context is rendered as
low-trust continuity and explicitly cannot override the current task, project
facts, code, tests, approved memory, or runtime policy.
Role-backed runs add an injected role envelope to that same runtime payload:
the running adapter receives its role handle, persona/instructions, safe
permission summary, compact team list, and collaboration rules that require
RoleCall-based delegation instead of simulating other roles.
Accepted executable RoleCalls use the same injection path and include the
callee role's default skill references when Agent Hub builds runtime context.

Skills are explicit `SKILL.md` files. Project skills live in the project
context store. Global skills live in Agent Hub app data and are selected by task
or role reference. Skills stay separate from approved memory. Runtime injection
also tells role-backed adapters to ignore user-installed global skills or
repository-local agent instructions unless Agent Hub explicitly injected them.

Rooms are metadata-backed conversation threads. Rooms group user messages,
run-card messages, assistant output, timeline events, role assignments, and
workflow metadata around one registered project.

Roles are local workgroup participant definitions. Presets include
`@researcher`, `@writer`, `@analyst`, `@operator`, `@reviewer`, `@engineer`,
and `@memory`. Users can save project-level role overrides or custom roles.
Only `agent_adapter` roles are executable today; reserved `human`, `llm_api`,
and `workflow` roles remain visible metadata until explicit local executors are
implemented.
Advanced users may keep project role configuration in `.agent-hub/team.yaml`.
Agent Hub reads that file only when it already exists in the registered project
or when a user explicitly imports/exports it. Merge precedence is presets,
SQLite role settings, then YAML overrides/custom roles. `team roles save`
continues to write SQLite by default; `team roles export` previews YAML unless
`--write` is supplied, and `team roles import` writes back to SQLite only with
`--write`.

Adaptive Role Calls are an auditable local collaboration graph. A role-backed
assistant response can emit line-start syntax such as `@reviewer check the
risk evidence`. Agent Hub parses the intent, validates policy, persists
RoleCall, RoleTodo, and RoleCallEvent records, and executes accepted
`agent_adapter` calls through the same TaskRunner path. CLI chat, TUI prompt
submission, and desktop room turns all use this same closed loop after a
role-backed assistant message is persisted. Custom roles such as `@pm` can
initiate bounded RoleCalls to other local roles only when their team-role
`delegationPolicy` explicitly allows those targets or capabilities.
The preset `@engineer` role can use the same line-start `@role task`
delegation syntax for bounded calls to `@operator` and `@reviewer`.
The injected `available_role_calls` directory advertises only targets that the
caller can reach through that line-start `delegate` protocol, so custom roles
with other intent types are not shown as shorthand-callable.

## CLI Surface

The current CLI exposes these command groups:

- Project and task setup: `project add`, `project list`, `task create`,
  `task list`, `task history`.
- Context and skills: `context init`, `context show`, `context build`,
  `context export`, `skills global create`, `skills global list`.
- Agent execution: `run --task ...`, ad-hoc `run "@codex ..."`,
  `run "@claude-code ..."`, `run event add`, and explicit continuation with
  `--continue-from-run` or `--continue-from-message`. Runs can select explicit
  skills with `--skill [scope:]id`.
- Persistent chat and rooms: bare `agent-hub` interactive mode, `chat`,
  `threads list`, `threads show`, `rooms list`, `rooms create`, `rooms use`,
  `rooms send`, and `rooms timeline`.
- Terminal workbench: `tui` opens a keyboard-first read-only view over the
  current thread or room context, with focus modes for work, RoleCalls, runs,
  review, tasks, memory, and help.
- Team roles: `team roles list`, `team roles show`, `team roles save`, and
  `team roles executor`. Saved roles can reference default skills with
  `--skill [scope:]id`, and custom RoleCall fan-out is configured with
  `--can-call-role`, `--role-call-target`, `--role-call-capability`, and
  `--role-call-intent`.
- Run review: `runs list`, `runs show`, `runs events`, `runs diff`, and
  `risks show`.
- Review decisions: `reviews show`, `reviews accept`, and `reviews reject`
  record audit-only accept/reject artifacts for a run.
- RoleCall audit: `role-calls list`, `role-calls show`, `role-todos list`, and
  `role-events list`, each with JSON output where useful for local scripts.
- Memory and comparison: `memory list`, `memory propose`, `memory approve`,
  `memory reject`, and `compare`.

The CLI command dispatcher is backed by a single route registry that defines
command patterns, aliases, help usage lines, and handler callbacks together.
This keeps generated help and top-level command dispatch aligned as new local
commands are added.

Normal `run` output is optimized for humans: it prints the final agent-facing
answer after the run completes. Lifecycle events, raw logs, metadata, diffs,
verification output, and risk evidence are persisted for review commands and
debug output instead of being mixed into the default answer.

Bare `agent-hub` starts a lightweight interactive shell over the same run path.
`agent-hub chat` is the persistent conversation mode. Chat and room sends can
route one turn to an adapter mention such as `@codex` or to enabled role
handles such as `@engineer`. Runnable participants create TaskRunner-backed
runs; non-runnable role executors remain assignment metadata.

## Agent Runs

TaskRunner is the execution boundary for CLI, desktop, and executable role
calls. For every run it:

- validates the project repository and local git safety boundary;
- compiles a task brief and context pack;
- creates an isolated git worktree outside the original checkout;
- materializes runtime files only inside that worktree;
- invokes the selected adapter from the worktree cwd, including role/team
  runtime metadata when the run was created from a role mention or accepted
  RoleCall;
- captures and incrementally persists stdout, stderr, parsed structured
  messages, status, error, and exit events;
- runs configured verification commands in the worktree;
- collects staged, unstaged, and untracked diffs;
- persists task brief, conversation brief, git diff, skill inventory,
  provenance, lifecycle, and review artifacts;
- generates and stores a risk report;
- generates conservative proposed memory for successful runs when evidence
  supports it;
- applies the configured cleanup policy without merging, pushing, deleting
  branches, or accepting output automatically.

Supported adapters are:

- `fake`: deterministic local adapter for tests, debug, and development.
- `codex`: process-backed `codex exec --json -`, with desktop follow-up support
  for `codex exec resume --json <session-id> -`.
- `claude-code`: process-backed `claude --print --output-format stream-json`.

Normal mode exposes Codex and Claude Code when enabled. The fake adapter is
hidden unless debug, development, test, or hidden agent-availability settings
enable it.

## Context, Skills, And Memory

The default context delivery mode is `runtime_injection`. It sends the generated
task brief and context pack to the adapter without writing repository-level
agent files. `worktree_overlay` is opt-in and writes generated `AGENTS.md`,
`CLAUDE.md`, and skill copies only inside the isolated run worktree.

`repo_export` is an explicit `context export` workflow. It previews repository
writes and, only with `--write`, updates managed blocks in repository export
targets. Runtime task runs reject `repo_export` as a delivery mode.

Approved memory is read from the Agent Hub context store at
`memory/approved.md`. Proposed and rejected memory rows stay in SQLite and are
not injected into future runs. Memory rows now carry optional local audit
metadata so future automation can explain source run, policy, and writeback
decisions. Approving memory is still explicit by default and writes only to the
Agent Hub-owned context store unless the project opts into a local automation
policy. TaskRunner finalization and desktop explicit generation use the same deterministic
proposal generator, while listing proposals remains read-only.

The CLI includes a read-only memory automation dry run:
`agent-hub memory automation evaluate --run-id <run-id>`. It evaluates stored
proposals generated from that run against the default local policy,
verification, risk, duplicate, and category gates, then prints allow/block
reasons without approving or writing memory. Review-gated policies remain
blocked in dry-run output unless the run is being evaluated from an accepted
review path.

Projects can opt into `auto_after_review_accept` with
`agent-hub memory policy set --project-id <project-id> --mode auto_after_review_accept`.
When enabled, an explicit CLI or desktop review acceptance auto-approves only
eligible proposed memory and writes it through the Agent Hub-owned approved
memory path. The default remains `suggest_only`.
Projects can also explicitly opt into `auto_safe_on_success`. In that mode,
TaskRunner waits until successful run finalization has persisted verification,
risk, artifact, metadata, and proposed-memory evidence, then approves only
eligible proposals within the configured risk, verification, category, and
per-run limits. This mode is never enabled by default.
Approved memory can be retired with
`agent-hub memory retire --memory-id <memory-id> --reason <text>`. Retirement
keeps the SQLite row and approved-memory file audit trail, marks the managed
approved-memory block as retired, and prevents retired memory from entering
future runtime context or stable context indexes. The CLI only updates the
SQLite row after the approved-memory file block has been successfully marked
retired.
The desktop Project Settings panel exposes the same project policy for local
operators: users can keep proposals queued, opt into auto-after-review or
auto-safe-on-success, choose the risk threshold, per-run limit,
skipped-verification behavior, and allowed memory categories without giving the
renderer direct SQLite or filesystem access.

## Desktop Experience

The desktop app is a local conversation console. It opens registered projects,
seeds default rooms (`#general`, `#planning`, `#research`, `#review`,
`#knowledge`), and centers work around a room transcript and composer.

The composer supports adapter mentions, role mentions, target chips, `@`
autocomplete, `/` prompt suggestions, a room shared-context switch, and bounded
workflow metadata for `handoff`, `review_loop`, and `panel_discussion`. These
controls do not add a remote workflow engine or autonomous hidden follow-up
runs.
Submitting a new desktop prompt does not wait for active runs to complete.
Role-backed desktop runs preserve order per project: a second run for the same
`@role` remains queued until that role's active run reaches a terminal status,
while different roles and direct adapter mentions can proceed independently.
When a same-role queued run is still present after a desktop service restart,
the next same-role submission drains the older queued run from persisted local
execution input instead of leaving the queue blocked on in-memory state.

Inline run cards show compact status, agent or role attribution, current
agent-facing output, and review affordances. Routine completed no-change runs
can collapse behind the durable assistant answer; file-changing, failed,
cancelled, delegated RoleCall, or comparison-ready runs remain visible.
While a desktop run is queued, running, or verifying, run detail reads stay
lightweight: they replay persisted events and placeholder check/risk state
without collecting worktree diffs or risk evidence. Full diff, verification,
risk, and memory proposal evidence is loaded after the run reaches a terminal
status.

The workgroup inspector exposes review evidence through Brief, Evidence,
Artifacts, Memory, and Audit tabs. It loads data lazily through IPC and keeps
raw logs, diffs, verification rows, risk reports, memory proposals, and
artifact previews out of the normal transcript.

Desktop lifecycle actions are explicit and audited:

- accept/reject records review decisions and, when the project explicitly opts
  into memory automation, review acceptance may approve eligible memory;
- memory approval writes approved memory to Agent Hub's context store;
- retained-worktree handoff exposes local review evidence and review-only
  commands;
- cleanup requires exact confirmation before removing an Agent Hub-owned
  retained worktree;
- local apply requires preview, latest risk review, exact confirmation, and
  `git apply --check` before applying a persisted patch to the local checkout.

Desktop apply does not commit, merge, push, create pull requests, delete
branches, export repository context, or approve memory.

The Knowledge workspace surfaces memory governance evidence. Auto-approved
memory is tagged in the memory list, its detail pane shows the applied policy,
risk level, verification status, and approved-memory path, and the audit trail
records the local auto-approval event alongside normal memory lifecycle events.
Retired memory remains visible for audit but is not injected into future task
briefs.

## Safety And Review

Agent Hub treats generated output as reviewable local evidence, not accepted
code. Safety checks cover sensitive paths, dangerous command text, risky diff
shape, large deletions, binary changes, failed or skipped verification, and
dangerous generated instructions in run events.

Blocking risks remain blocking. They prevent automatic acceptance and block
desktop local apply. Patch previews are redacted when changed-file metadata or
diff headers identify sensitive paths such as `.env`, private keys, tokens,
secrets, or credentials; TUI inline diff summaries apply the same redaction
before rendering small patch projections.

Verification commands are structured executable-plus-args entries. Dangerous
commands are represented as failed verification results. Desktop verification
settings reject secret-like option names before persistence.

Child processes receive a narrow environment allowlist plus explicit
overrides. Agent Hub does not pass arbitrary `process.env` into adapters or
verification commands.

## Local Persistence

SQLite stores projects, agent profiles, tasks, task runs, run events, run
artifacts, verification results, risk reports, conversation threads, messages,
thread summaries, memory items, comparison reports, skills, settings, status
transitions, role calls, role todos, and role call events.
The storage layer uses a native local SQLite driver with WAL/busy-timeout
configuration instead of a spawned SQLite CLI session.

`AGENT_HUB_HOME` changes the Agent Hub app-data directory. `AGENT_HUB_DB_PATH`
or CLI `--db <path>` can point to a specific database for testing or local
development.

## Deferred Capabilities

Not implemented as product behavior today:

- cloud sync, accounts, hosted dashboards, browser-only UI, billing, or
  marketplace features;
- automatic merge, push, pull request creation, branch deletion, or memory
  promotion;
- first-class remote collaboration or multi-user permissions;
- executable `llm_api`, `workflow`, or `human` role backends;
- first-class room, participant, artifact, decision, or pack tables beyond the
  current metadata-backed model;
- richer Codex/Claude structured event mapping beyond the current persisted
  stdout/status/message/error model.
- bounded loop continuation and TUI review decision writes beyond the current
  workbench shell.

Roadmaps for future work live in `docs/local-ai-workgroup-roadmap.md`,
`docs/interaction-optimization-roadmap.md`, `docs/tui-roadmap.md`,
`docs/tui-conversation-terminal-roadmap.md`,
`docs/tui-optimization-roadmap.md`, `docs/tui-v3-roadmap.md`,
`docs/memory-automation-roadmap.md`, and the Adaptive Role Calls specification
documents. Those files describe
direction; this document describes the current product state. The
conversation-terminal TUI roadmap now records the
implemented Work-view direction and remaining hardening guidance: the current
TUI keeps the Ink/local read-model boundary while presenting a
conversation-first Work surface, moving Runs, Review, Graph, Tasks, and Memory
into explicit auxiliary tabs, and keeping Team behind slash-command access.
