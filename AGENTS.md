# AGENTS.md

## Project Name

Agent Hub

## Product Definition

Agent Hub is a local-first CLI and desktop application for orchestrating coding agents such as Claude Code and Codex.

The product manages shared project context, skills, memory proposals, task briefs, isolated git worktrees, task runs, logs, verification results, diffs, risk reports, and comparison reports.

Agent Hub is not a web SaaS product.

## Architecture Principle

Build CLI-first.

The CLI and desktop app must share the same local core packages.

The desktop app is a graphical shell over the local core. It must not contain the core orchestration logic.

Build context delivery as non-invasive runtime injection by default.

Agent Hub must not require users to modify their repositories to benefit from
shared context, skills, or approved memory. The canonical context store belongs
to Agent Hub and should live outside the user repository by default unless the
user explicitly chooses repo-local storage.

Supported context delivery modes:

- `runtime_injection`: default mode. Agent Hub builds a task-specific context
  pack and task brief, then adapters inject them into each agent run using
  stdin, prompt files, SDK options, command arguments, or another
  adapter-specific mechanism.
- `worktree_overlay`: optional mode. Agent Hub may materialize generated context
  files only inside the isolated task worktree for agents that require files on
  disk. The original project checkout must remain unchanged.
- `repo_export`: opt-in mode. Agent Hub may export `AGENTS.md`, `CLAUDE.md`, or
  agent-specific skill folders into the user repository only after explicit
  user action and preview.

Preferred architecture:

```text
CLI
  -> Local Core
  -> Task Runner
  -> Agent Adapters
  -> Claude Code / Codex CLI

Desktop App
  -> Electron IPC or Tauri Commands
  -> Local Core
  -> Task Runner
  -> Agent Adapters
  -> Claude Code / Codex CLI
```

## Non-negotiable Constraints

- This is a local-first application.
- Do not introduce a cloud backend.
- Do not introduce remote task execution.
- Do not introduce account login.
- Do not introduce team collaboration in the MVP.
- Do not use Next.js.
- Do not add an Express/Fastify/Koa API server unless explicitly requested.
- Do not add Postgres, Redis, or cloud databases.
- Use SQLite for local persistence.
- Use git worktrees for task isolation.
- Never modify the original project directory directly during an agent run.
- Never write Agent Hub context files to the user repository root by default.
- Never generate or update `AGENTS.md` or `CLAUDE.md` by default.
- Never sync skills into `.claude/skills` or `.agents/skills` by default.
- Never automatically merge agent-generated code.
- Never automatically push code to a remote repository.
- Never automatically write long-term memory without user approval.
- Never store API keys or secrets in SQLite.
- Never intentionally read or expose `.env`, private keys, tokens, or credential files.
- Never commit or push local planning notes, automation queues, manual
  verification records, imported private specs, or one-off implementation
  prompts to GitHub unless the user explicitly asks to publish them.
- Keep each implementation task small and verifiable.

## Agent Collaboration

For complex tasks that benefit from parallel investigation, codebase exploration,
test verification, or independently scoped implementation work, Codex may use
subagents by default.

Use subagents for bounded side tasks with clear ownership, and keep final
integration, verification, and user-facing summary in the main thread.

## Commit Rules

Do not make changes directly on `main`, `master`, or any default branch.

Before starting any implementation or documentation change, create or switch to
a dedicated feature branch for that task.

After every completed change, create a local git commit for that change, push
the branch to the remote, and create a pull request.

When a task contains multiple independent module or feature changes, split them
into separate focused commits.

## MVP Scope

The MVP must support:

- Registering a local project.
- Creating and listing tasks.
- Building task-specific context packs.
- Generating task-specific task briefs.
- Injecting task briefs and context into agent runs at runtime.
- Running a task with a fake agent.
- Running a task with Claude Code.
- Running a task with Codex.
- Creating isolated git worktrees per task run.
- Capturing logs and run events.
- Running verification commands.
- Collecting git diffs.
- Generating risk reports.
- Comparing Claude Code and Codex results.
- Proposing memory items.
- Approving or rejecting memory items.
- Opt-in repository export for `AGENTS.md`, `CLAUDE.md`, and agent-specific
  skill folders, with preview before writing.
- Providing a desktop UI after the CLI and local core are stable.

## Current Implementation Status

The current implementation is a CLI-first pnpm workspace with `apps/cli`,
`apps/desktop`, and local core packages under `packages/`. The physical
CLI/core package split is present, and the Electron + React desktop shell has
evolved into a room-based local workgroup UI over main-process IPC.

Implemented:

- Root workspace scripts with strict typechecking, Vitest tests, build
  references, and clear package boundaries under `apps/` and `packages/`.
- `apps/cli` as the thin command-line and interactive shell over local package
  APIs.
- Domain models, SQLite persistence, context compilation, task running, agent
  adapters, safety scanning, risk report generation, and shared types.
- CLI commands for project registration/listing, context store init/show,
  context pack build, runtime context plan/selection/omission/eval inspection,
  optional repo export, task creation/listing/history, task runs, manual
  run-event recording, threaded chat, metadata-backed rooms, team role
  management, terminal TUI review, RoleCall audit workflows, global skill
  create/list workflows, review decisions, memory workflows, and run
  comparison.
- Interactive CLI with `@agent` prompts, `/agents`, `/use`, `/context`,
  `/context init`, `/clear`, `/exit`, and `/quit`.
- Git worktree creation for task runs.
- Runtime context pack and task brief generation, worktree-local runtime file
  writing, verification command execution, agent event capture, and diff
  collection.
- Typed runtime context plans, explicit/BM25/recency/code-graph retrieval,
  optional local semantic retrieval hooks, runtime context selection,
  deterministic context compression, and local context eval evidence.
- Opt-in `worktree_overlay` delivery for task runs. It materializes generated
  context files inside the isolated worktree only and excludes those overlay
  files from collected diffs.
- `FakeAgentAdapter`.
- `CodexAdapter` using non-interactive `codex exec` inside the task worktree.
- `ClaudeCodeAdapter` using non-interactive `claude --print` inside the task
  worktree.
- Registered `agent-hub run --task ...` creates and finalizes SQLite task run
  rows, persists mapped agent events, verification results, and git diff run
  artifacts.
- Safety scanning and risk report persistence for sensitive paths, dangerous
  commands, risky diffs, large deletions, and binary file changes.
- Memory proposal, listing, approval, rejection, approved-memory writeback to
  the Agent Hub-owned context store, and conservative automatic proposed-memory
  generation from completed task-runner evidence.
- Persisted comparison report generation for two runs of a task, including
  structured comparison details and deterministic review scoring.
- Local AI workgroup metadata for preset/custom roles, built-in workgroup
  packs, metadata-backed rooms, shared-task role fan-out, bounded workflows,
  timeline events, participant-scoped context, Adaptive RoleCall records,
  todos, events, artifact review, knowledge browsing, and lifecycle audit
  records without adding a cloud service or broad schema split.
- `apps/desktop` Electron + React shell with a room-based project layout, safe
  `window.agentHub` preload API, Electron main-process IPC handlers,
  SQLite-backed project/thread/message/run/review/memory/team/knowledge
  service facades, sidebar room/project navigation, inline run cards, bounded
  role-attributed assistant output messages, participant-scoped conversation
  brief artifacts, TaskRunner-backed fake/Codex/Claude desktop runs in isolated
  worktrees, Adaptive RoleCall parsing and delegated run summaries, live run
  event replay, desktop cancellation, retained-worktree handoff, local run
  comparison, explicit memory writeback, lifecycle cleanup controls,
  human-gated local apply, and a workgroup inspector with Brief, Evidence,
  Artifacts, Memory, and Audit surfaces covering context, checks, risks,
  lifecycle, and logs.
- Per-project desktop verification command configuration through validated IPC
  and local SQLite settings, with configured commands passed to TaskRunner for
  isolated-worktree execution.

Not yet implemented:

- Richer Codex/Claude structured event mapping, additional local executor
  backends for reserved `llm_api`/`workflow`/`human` roles, first-class
  room/role/artifact/decision tables when metadata-backed storage no longer
  fits, and explicit merge, push, pull request, or branch-deletion workflows.

## Explicit Non-goals for MVP

Do not implement:

- Cloud sync
- User accounts
- Team workspaces
- Hosted dashboards
- Browser-only UI
- Plugin marketplace
- Billing
- Multi-user permissions
- Remote job queues
- Automatic pull request creation
- Automatic merge
- Automatic git push
- Agent marketplace
- Enterprise policy management

## Repository Structure

Current physical layout:

```text
agent-hub/
  apps/
    cli/
    desktop/

  packages/
    core/
    db/
    agent-adapters/
    context-compiler/
    task-runner/
    safety/
    shared/

  tests/
  docs/
```

Do not do a larger package restructure or introduce a browser/server
architecture unless the user asks for that specific work. Future desktop work
must stay inside `apps/desktop` and keep orchestration in shared local packages
or Electron main-process services.

## Package Responsibilities

### apps/cli

Command-line interface.

The CLI is the first user-facing interface and must be able to run without the desktop app.

Implemented commands:

- `agent-hub`
- `agent-hub project add`
- `agent-hub project list`
- `agent-hub context init`
- `agent-hub context show`
- `agent-hub context build`
- `agent-hub context export`
- `agent-hub context plan`
- `agent-hub context selected`
- `agent-hub context omissions`
- `agent-hub context eval`
- `agent-hub skills global create`
- `agent-hub skills global list`
- `agent-hub task create`
- `agent-hub task list`
- `agent-hub task history`
- `agent-hub tui`
- `agent-hub run`
- `agent-hub run event add`
- `agent-hub chat`
- `agent-hub threads list`
- `agent-hub threads show`
- `agent-hub rooms list`
- `agent-hub rooms create`
- `agent-hub rooms use`
- `agent-hub rooms send`
- `agent-hub rooms timeline`
- `agent-hub team roles list`
- `agent-hub team roles show`
- `agent-hub team roles save`
- `agent-hub team roles executor`
- `agent-hub role-calls list`
- `agent-hub role-calls show`
- `agent-hub role-todos list`
- `agent-hub role-events list`
- `agent-hub tasks list`
- `agent-hub runs list`
- `agent-hub runs events`
- `agent-hub runs diff`
- `agent-hub runs show`
- `agent-hub risks show`
- `agent-hub reviews show`
- `agent-hub reviews accept`
- `agent-hub reviews reject`
- `agent-hub compare`
- `agent-hub memory list`
- `agent-hub memory propose`
- `agent-hub memory approve`
- `agent-hub memory reject`

### apps/desktop

Desktop shell.

The first desktop app is implemented as an Electron + React + Vite workspace
package. It provides UI for:

- Projects
- Rooms and conversation threads
- Team role configuration
- Knowledge workspace
- Inline run cards
- Assistant output messages
- Logs
- Diff review
- Verification
- Risk reports
- Artifact inventory
- Memory proposals
- Per-project verification settings
- Manual retained-worktree handoff
- Local multi-agent comparison review
- Explicit retained-worktree cleanup and human-gated local apply

The desktop app must call the local core through Electron main-process IPC. The
renderer must not directly access Node.js, shell, filesystem, SQLite, or git.
It must not duplicate task orchestration logic.

Current desktop runs are TaskRunner-backed through the Electron main process
and persist SQLite task/run/event, conversation, and review records. Normal
desktop surfaces expose Codex and Claude Code when enabled and hide the
deterministic fake adapter; when the internal debug/development availability
policy enables it, `@fake` uses `FakeAgentAdapter` in an isolated worktree.
`@codex` and `@claude` use process-backed adapter preflight and fail
inspectably when the local CLI is unavailable or unauthenticated. Desktop runs
must not write Agent Hub context files to target repository roots, export
context, merge, push, create pull requests, approve memory, or apply code
automatically. Explicit desktop memory approval writes to the Agent Hub-owned
context store, comparison review remains read-only, and retained-worktree
handoff only exposes local review evidence behind the same IPC boundary.
Worktree lifecycle cleanup and local apply are explicit, audited,
confirmation-gated IPC workflows; merge, push, pull request creation, branch
deletion, repository context export, and automatic acceptance remain outside
desktop apply.

### packages/core

Domain models and application services.

Contains:

- Project
- AgentProfile
- Task
- TaskRun
- RunEvent
- VerificationResult
- ComparisonReport
- RoleCall
- RoleTodo
- RoleCallEvent
- MemoryItem
- RiskReport
- Skill

### packages/db

SQLite schema and repositories.

Contains local persistence only.

Do not add cloud database support.

### packages/agent-adapters

Agent adapter abstraction and implementations.

Required adapters:

- FakeAgentAdapter
- CodexAdapter
- ClaudeCodeAdapter

Current status:

- `FakeAgentAdapter`, `CodexAdapter`, and `ClaudeCodeAdapter` are implemented.

All real adapters must run inside the task worktree.

### packages/context-compiler

Builds Agent Hub-owned context into task-specific context packs and task briefs.

Responsible for:

- Reading canonical context from the Agent Hub context store
- Reading approved memory and skills
- Reading reusable global skills from Agent Hub-owned app data when a task or
  role explicitly references them
- Building a task-specific context pack
- Task brief generation
- Runtime-injection payload generation for adapters
- Optional worktree overlays for agents that require files on disk
- Optional repo export for `AGENTS.md`, `CLAUDE.md`, and agent-specific skill
  folders

`runtime_injection` is the default context delivery mode. In this mode, the
context compiler must not write `AGENTS.md`, `CLAUDE.md`, `.claude/skills`, or
`.agents/skills` into the user repository.

`worktree_overlay` writes generated files inside the isolated task worktree
only. It materializes `.agent-hub/tasks/<task-id>/brief.md`,
`.agent-hub/tasks/<task-id>/context-pack.json`, managed `AGENTS.md` and
`CLAUDE.md` blocks, and runtime skill copies under `.claude/skills` and
`.agents/skills`. It must not modify the original project checkout.

`repo_export` is an explicit user action. It must show a preview before writing
export targets into the repository.

When repo export modifies user-visible files, use managed blocks and preserve
user-authored content outside those blocks.

Managed block format for exported files:

```html
<!-- agent-hub:start -->
# Agent Hub Shared Context

This content is exported from the Agent Hub context store.
Preserve user-authored content outside this managed block.

_No project context is available yet._
<!-- agent-hub:end -->
```

Do not overwrite user-authored content outside managed blocks.

### packages/task-runner

Responsible for:

- Creating git worktrees
- Running agent adapters
- Capturing run events
- Running verification commands
- Collecting git diffs
- Persisting context plans, retrieval candidates, selected runtime context
  packs, and local context eval events
- Producing task run summaries
- Producing comparison reports
- Executing accepted RoleCalls through the same isolated TaskRunner path

Current status:

- Worktree creation, adapter execution, verification commands, diff collection,
  and task run summaries are implemented.
- Runtime context planning, explicit/BM25/recency/code-graph retrieval,
  optional local embedding/reranker hooks, candidate selection, compression,
  and context eval persistence are implemented.
- Accepted `agent_adapter` RoleCalls can be linked to TaskRunner runs and
  persisted back to local RoleCall evidence.
- Automatic proposed-memory generation and comparison report aggregation run
  from persisted local run evidence. Comparison remains review-only and local;
  do not accept, merge, or push changes.

### packages/safety

Responsible for:

- Command denylist
- Sensitive file detection
- Diff scanning
- Risk report generation
- RoleCall policy validation

Current status:

- Safety scanners and risk report generation are implemented for sensitive file
  paths, dangerous command text, risky diffs, large deletion volume, and binary
  file changes.
- RoleCall policy validation is implemented for delegation permissions,
  bounded graph limits, duplicate suppression, todo capacity, executor
  capability, and dangerous command text.

### packages/shared

Shared TypeScript types, role/workgroup contracts, RoleCall contracts, and
utilities that do not depend on app-specific code.

## Technical Defaults

Use:

- TypeScript
- pnpm workspaces
- Vitest
- SQLite
- Zod for runtime validation
- Node.js `child_process` for CLI adapter execution
- simple-git or git CLI for git operations
- Electron + React + Vite for the desktop shell

Avoid:

- Next.js
- Express
- Remote APIs
- Cloud databases
- Background cloud workers
- Complex UI libraries in MVP

## Documentation Requirements

Every future code change, behavior change, or new feature must update both:

- `docs/product.md`
- `docs/architecture.md`

Keep these documentation updates in the same task as the implementation so product behavior and architecture decisions stay current.

## Agent Adapter Rules

All adapters must implement a common interface similar to:

```ts
export interface AgentAdapter {
  kind: AgentKind;
  displayName: string;

  detect(): Promise<AgentDetectionResult>;

  run(input: AgentRunInput): AsyncIterable<AgentRunEvent>;
}
```

Agent runs must:

- Use the worktree path as cwd.
- Receive the generated task brief and context pack through runtime injection by
  default.
- Read generated files only when the selected delivery mode explicitly
  materializes them in the worktree.
- Stream stdout and stderr into run events.
- Capture exit code.
- Never run in the original project root.
- Never push, merge, or delete branches automatically.

## Git Worktree Rules

Every task run must use an isolated git worktree.

Branch naming convention:

```text
agent-hub/<task-id>/<agent-kind>
```

Worktree path convention:

```text
~/.agent-hub/worktrees/<project-name>/<task-id>-<agent-kind>
```

Do not modify the original project checkout during task execution.

## Context Rules

Project context lives in the Agent Hub-owned context store.

Default storage should be outside the user repository, for example under the
Agent Hub application data directory. A project may opt into repo-local storage,
but this must be an explicit user choice.

Suggested context files inside the context store:

```text
context/project.md
context/architecture.md
context/conventions.md
context/testing.md
context/security.md
```

Approved memory lives in the Agent Hub context store by default:

```text
memory/approved.md
```

Repo-local mode may use `.agent-hub/context/` and `.agent-hub/memory/approved.md`,
but these paths are not required for the default runtime-injection workflow.

Proposed memory lives in SQLite until approved.

Task briefs are generated per task run in Agent Hub-owned run artifacts and are
injected into adapters at runtime by default.

Optional worktree overlays may materialize task briefs under:

```text
.agent-hub/tasks/<task-id>/brief.md
.agent-hub/tasks/<task-id>/context-pack.json
AGENTS.md
CLAUDE.md
.claude/skills/<skill-name>/SKILL.md
.agents/skills/<skill-name>/SKILL.md
```

This path is not a default write to the original project checkout.

Repo export targets include:

```text
AGENTS.md
CLAUDE.md
.claude/skills/<skill-name>/SKILL.md
.agents/skills/<skill-name>/SKILL.md
```

These files are export targets only. Export requires explicit user action and a
preview.

Local planning notes, automation queues, manual verification records, imported
private specs, and one-off implementation prompts should stay untracked unless
the user explicitly asks to publish them.

## Skill Rules

Canonical skills live in the Agent Hub context store by default:

```text
skills/<skill-name>/SKILL.md
```

Reusable global skills may also live in Agent Hub-owned app data:

```text
<agent-hub-app-data>/skills/<skill-name>/SKILL.md
```

Global skills are created and listed through
`agent-hub skills global create/list`. They are injected only when explicitly
selected for a task/run or referenced by a role default skill list. Project
context-store skills override same-id global skills by default; an explicit
`global:<id>` reference selects the global skill. Skills remain separate from
approved memory.

Repo-local mode may use `.agent-hub/skills/<skill-name>/SKILL.md`, but this is
not required for the default workflow.

The context compiler may export skills to agent-specific folders only in
`repo_export` mode:

- `.claude/skills/<skill-name>/SKILL.md`
- `.agents/skills/<skill-name>/SKILL.md`

Every skill must include:

- `name`
- `description`
- Clear usage conditions
- Concrete workflow steps

## Memory Rules

Memory must be conservative.

Do not automatically promote memory.

Memory lifecycle:

- `proposed -> approved -> injected into future task briefs`
- `proposed -> rejected -> ignored`

Memory categories:

- `project_fact`
- `workflow_rule`
- `user_preference`
- `temporary_note`

Only approved memory can be included in task briefs.

## Safety Rules

Detect and flag sensitive file modifications.

Sensitive patterns include:

- `.env`
- `.env.*`
- `*.pem`
- `*.key`
- `id_rsa`
- `id_ed25519`
- `secrets.*`
- `credentials.*`
- `token.*`

Flag dangerous commands or generated instructions involving:

- `sudo`
- `rm -rf /`
- `chmod -R 777`
- `curl | sh`
- `wget | sh`
- `git push --force`
- `git clean -fdx`

Risk levels:

- `low`
- `medium`
- `high`
- `blocking`

Blocking risk must prevent automatic acceptance.

## Testing Requirements

Every package should have tests.

Minimum expectations:

- Core models have validation tests.
- DB repositories have integration tests using temporary SQLite databases.
- Context compiler has snapshot tests.
- FakeAgentAdapter has event and file output tests.
- Task runner has integration tests using temporary git repositories.
- Safety scanner has unit tests.
- CLI commands have smoke tests.
- Desktop IPC/service behavior has focused tests where practical.

Before completing a task, run the most relevant commands:

```sh
pnpm typecheck
pnpm test
pnpm lint
```

If the full suite is expensive, run the targeted package tests and explain what was run.

### UI Verification Requirements

For every change that modifies the desktop UI, renderer behavior, UI styling,
or visible user workflow:

- Rebuild the desktop app before judging the change.
- Open the rebuilt Agent Hub desktop app and verify the affected workflow in
  the running UI.
- Write a concise UI test summary to disk before finishing. The summary must
  include the rebuilt app path or launch command, tested workflows, observed
  results, and any remaining UI risks or gaps.
- Include the UI test summary file path and the manual UI verification result
  in the final task summary.

### TUI Verification Requirements

For every change that modifies `agent-hub tui`, `apps/cli/src/tui.ts`,
`apps/cli/src/tui-ink/`, terminal renderer behavior, keyboard handling, or any
visible terminal workflow:

- Rebuild the CLI and TUI output before judging the change.
- Run automated TUI coverage, including focused CLI/TUI tests where practical.
- Manually launch the rebuilt TUI in a real terminal or PTY, not only through
  `--once`.
- Manually verify the affected workflow plus the core TUI loop: launch,
  `--once`, exit, help, command palette, focus navigation, selection movement,
  composer typing, composer clear/cancel, prompt submission path when safe,
  review shortcuts when safe, and Runs/Review/RoleCalls/Tasks/Memory views
  relevant to the change.
- Write a concise manual TUI test summary to a local untracked verification
  note before finishing. The summary must include the launch command, tested
  workflows, observed results, and any remaining risks or gaps.
- Include the manual TUI verification result and summary file path in the final
  task summary.

Manual TUI verification notes are manual verification records. Keep them
untracked unless the user explicitly asks to publish them.

## Implementation Style

- Prefer small vertical slices.
- Keep modules focused.
- Avoid global mutable state.
- Prefer explicit types.
- Use dependency injection for adapters and repositories.
- Avoid over-engineering.
- Do not introduce abstractions before there are at least two real use cases.
- Do not mix UI logic with task orchestration logic.
- Keep the CLI functional even if the desktop app is absent.

## Review Checklist

Before considering a task complete, check:

- Does this preserve the CLI-first architecture?
- Did it avoid adding web SaaS concepts?
- Does it avoid modifying files outside the intended scope?
- Does it keep agent runs inside worktrees?
- Does it avoid automatic merge or push?
- Does it include tests?
- Does it update relevant docs if behavior changed?
- Does it keep the MVP scope tight?

## Expected Response Format for Coding Tasks

When completing a coding task, summarize:

```text
Changed files:
- ...

Verification:
- ...

Risks:
- ...

Follow-up:
- ...
```

Keep summaries brief and concrete.
