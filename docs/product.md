# Product

Last audited against `origin/main` at `1bf5455` on 2026-06-01.

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
signals, and the next action without exposing raw logs or full patches.
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
The Team read-model pane is available from the default tab cycle, the `[E]am`
tab shortcut, typing `/team` in the composer, or the command palette. It shows the current
project's resolved preset, preset-overridden, and custom roles from the same
role settings used by `team roles list`, including enabled/runnable counts,
executor labels, default rooms, and the equivalent CLI list command.
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
and risk summaries are folded into a chronological conversation flow. Running
runs appear as stable fixed-height active-run boxes with only the latest
agent-facing output or observable runtime events plus the active cursor
indicator. When an adapter has not emitted assistant text yet, the active box
shows recent lifecycle, adapter, stdout, and stderr lines while filtering raw
JSON protocol frames. Runs awaiting local review leave the active box and
become a single awaiting-review conversation line pointing at `[V]iew`, so the
Review pane can handle accept/reject without stealing prompt text.
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
The TUI composer is prompt-first while editing: printable lowercase keys append
to the prompt from any focus, uppercase tab shortcuts switch
Work/Runs/View/Graph/Tasks/Memory/Team, `/team` opens the Team roles view
without submitting a prompt, `Enter` submits non-command prompts when a
submission callback is available, `Esc` clears the in-progress prompt, and
empty-composer `Enter` does not switch panes. `Tab` remains available for focus
navigation, and the composer supports cursor movement plus Home/End,
Backspace/Delete, and Ctrl+A/E/U/D editing controls. Interactive
submit and review-decision actions show bounded busy states without locking the
keyboard: users can still switch focus, open command hints, and draft the next
prompt while the current local action is running. The TUI only blocks duplicate
submits or duplicate review-decision writes until that action finishes or times
out.
Prompt submission keeps the terminal workbench in control of the screen: agent
stdout, run debug details, and raw adapter text are persisted through the normal
chat/run records and then shown through TUI panes, not dumped directly into the
Ink alternate screen during an interactive submit.
Interactive TUI sessions periodically refresh the same current-context read
model so externally changing run, task, conversation, RoleCall, and review
state can appear without a manual keypress. New conversation or active-run
output anchors Work back to the bottom. TaskRunner persists run events as they
are produced, so running boxes can show live progress from the local evidence
store instead of waiting for final run completion. The conversation can scroll back by
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

## Core Concepts

Projects are local repository roots registered in Agent Hub's SQLite database.
SQLite and context stores live in Agent Hub-owned application data by default,
not inside the target repository.

Tasks are local work items. Task runs execute one agent adapter inside an
isolated git worktree and persist events, artifacts, verification rows, risk
reports, and metadata for later review.

Context stores are Agent Hub-owned directories containing project context,
approved memory, and project skills. Runtime context delivery is non-invasive by
default: generated task briefs and context packs are injected into the adapter
run rather than written into the source checkout.

Skills are explicit `SKILL.md` files. Project skills live in the project
context store. Global skills live in Agent Hub app data and are selected by task
or role reference. Skills stay separate from approved memory.

Rooms are metadata-backed conversation threads. Rooms group user messages,
run-card messages, assistant output, timeline events, role assignments, and
workflow metadata around one registered project.

Roles are local workgroup participant definitions. Presets include
`@researcher`, `@writer`, `@analyst`, `@operator`, `@reviewer`, `@engineer`,
and `@memory`. Users can save project-level role overrides or custom roles.
Only `agent_adapter` roles are executable today; reserved `human`, `llm_api`,
and `workflow` roles remain visible metadata until explicit local executors are
implemented.

Adaptive Role Calls are an auditable local collaboration graph. A role-backed
assistant response can emit line-start syntax such as `@reviewer check the
risk evidence`. Agent Hub parses the intent, validates policy, persists
RoleCall, RoleTodo, and RoleCallEvent records, and executes accepted
`agent_adapter` calls through the same TaskRunner path.

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
  `--skill [scope:]id`.
- Run review: `runs list`, `runs show`, `runs events`, `runs diff`, and
  `risks show`.
- Review decisions: `reviews show`, `reviews accept`, and `reviews reject`
  record audit-only accept/reject artifacts for a run.
- RoleCall audit: `role-calls list`, `role-calls show`, `role-todos list`, and
  `role-events list`, each with JSON output where useful for local scripts.
- Memory and comparison: `memory list`, `memory propose`, `memory approve`,
  `memory reject`, and `compare`.

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
- invokes the selected adapter from the worktree cwd;
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
not injected into future runs. Approving memory is always explicit from CLI or
desktop review and writes only to the Agent Hub-owned context store by default.

## Desktop Experience

The desktop app is a local conversation console. It opens registered projects,
seeds default rooms (`#general`, `#planning`, `#research`, `#review`,
`#knowledge`), and centers work around a room transcript and composer.

The composer supports adapter mentions, role mentions, target chips, `@`
autocomplete, `/` prompt suggestions, a room shared-context switch, and bounded
workflow metadata for `handoff`, `review_loop`, and `panel_discussion`. These
controls do not add a remote workflow engine or autonomous hidden follow-up
runs.

Inline run cards show compact status, agent or role attribution, current
agent-facing output, and review affordances. Routine completed no-change runs
can collapse behind the durable assistant answer; file-changing, failed,
cancelled, delegated RoleCall, or comparison-ready runs remain visible.

The workgroup inspector exposes review evidence through Brief, Evidence,
Artifacts, Memory, and Audit tabs. It loads data lazily through IPC and keeps
raw logs, diffs, verification rows, risk reports, memory proposals, and
artifact previews out of the normal transcript.

Desktop lifecycle actions are explicit and audited:

- accept/reject records review decisions only;
- memory approval writes approved memory to Agent Hub's context store;
- retained-worktree handoff exposes local review evidence and review-only
  commands;
- cleanup requires exact confirmation before removing an Agent Hub-owned
  retained worktree;
- local apply requires preview, latest risk review, exact confirmation, and
  `git apply --check` before applying a persisted patch to the local checkout.

Desktop apply does not commit, merge, push, create pull requests, delete
branches, export repository context, or approve memory.

## Safety And Review

Agent Hub treats generated output as reviewable local evidence, not accepted
code. Safety checks cover sensitive paths, dangerous command text, risky diff
shape, large deletions, binary changes, failed or skipped verification, and
dangerous generated instructions in run events.

Blocking risks remain blocking. They prevent automatic acceptance and block
desktop local apply. Patch previews are redacted when changed-file metadata or
diff headers identify sensitive paths such as `.env`, private keys, tokens,
secrets, or credentials.

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
`docs/tui-conversation-terminal-roadmap.md`, and the Adaptive Role Calls
specification documents. Those files describe direction; this document
describes the current product state. The conversation-terminal TUI roadmap now
records the implemented Work-view direction and remaining hardening guidance:
the current TUI keeps the Ink/local read-model boundary while presenting a
conversation-first Work surface, moving Runs, Review, Graph, Tasks, and Memory
into explicit auxiliary tabs, and keeping Team behind slash-command access.
