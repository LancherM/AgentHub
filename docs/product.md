# Product

Last audited against `origin/main` at `6780688` on 2026-06-01.

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
- Team roles: `team roles list`, `team roles show`, `team roles save`, and
  `team roles executor`. Saved roles can reference default skills with
  `--skill [scope:]id`.
- Run review: `runs list`, `runs show`, `runs events`, `runs diff`, and
  `risks show`.
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
- captures stdout, stderr, parsed structured messages, status, error, and exit
  events;
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

Roadmaps for future work live in `docs/local-ai-workgroup-roadmap.md`,
`docs/interaction-optimization-roadmap.md`, `docs/tui-roadmap.md`, and the
Adaptive Role Calls specification documents. Those files describe direction;
this document describes the current product state.
