# Agent Hub

[中文说明](README_CN.md)

Agent Hub is a local-first, CLI-first workbench for running coding agents such
as Codex and Claude Code against your projects, keeping every run isolated,
reviewable, and comparable.

> Status: Agent Hub is in early development. It is useful for local
> experimentation and focused workflows, but it is not yet a stable production
> tool.

## Why Agent Hub?

Coding agents are most useful when the surrounding workflow is disciplined:
the agent needs the right context, the run needs to be isolated from your main
checkout, and the result needs a real review trail.

Agent Hub gives you that local workflow:

- Build task-specific context packs and task briefs without rewriting your
  repository by default.
- Run Codex or Claude Code in isolated git worktrees.
- Capture logs, structured run events, verification results, diffs, artifacts,
  and risk reports.
- Compare multiple agent runs for the same task.
- Govern long-term memory through explicit propose, approve, and reject steps.
- Use a CLI, terminal TUI, or Electron desktop shell over the same local core.

Agent Hub is not a SaaS product. It does not add login, cloud sync, remote job
queues, hosted dashboards, automatic merge, automatic push, or automatic pull
request creation.

## What Works Today

| Area | Current support |
| --- | --- |
| Projects and tasks | Register local projects, create tasks, list history, and keep local SQLite evidence. |
| Context | Build Agent Hub-owned context packs and task briefs; default delivery is runtime injection. |
| Agents | Run Codex and Claude Code through adapters; use the deterministic fake adapter in debug and test workflows. |
| Isolation | Create per-run git worktrees outside the original checkout and collect diffs from the isolated result. |
| Review | Inspect run summaries, logs, artifacts, verification, risk reports, and bounded diffs. |
| Conversations | Use persistent chat threads, rooms, role mentions, continuation, and review-only decisions. |
| TUI | Launch `agent-hub tui` for a conversation-first terminal workbench over current project evidence. |
| Desktop GUI | Use an Electron + React shell for rooms, inline run cards, review inspector panels, Team and Knowledge workspaces, memory approval, lifecycle controls, and explicit local apply. The GUI is available, but the TUI is currently the more complete day-to-day surface. |
| Memory and skills | Propose, approve, reject, and inject approved memory; create and select global skills. |

Still in progress:

- Richer Codex and Claude Code structured event mapping.
- More local executor backends for reserved role executor types.
- First-class schema splits where metadata-backed storage stops being enough.
- Explicit merge, push, pull-request, and branch-deletion workflows.
- Dedicated desktop skills management.

## Quick Start

### Requirements

- Node.js 22 or newer.
- pnpm 10.10.0. The repository declares this through `packageManager`.
- Git.
- Codex CLI and/or Claude Code CLI installed and authenticated if you want real
  agent runs.

### Install From Source

```sh
git clone https://github.com/LancherM/AgentHub.git
cd AgentHub
corepack enable
pnpm install
pnpm build
```

When working from the source checkout, use the built CLI entrypoint directly:

```sh
agent-hub-dev() {
  node "$PWD/apps/cli/dist/cli.js" "$@"
}

agent-hub-dev --help
```

### Register A Project

```sh
agent-hub-dev project add --name my-app --root /path/to/my-app
agent-hub-dev project list
```

Keep the returned `project_id`; many commands use it explicitly.

### Create Context

```sh
agent-hub-dev context init \
  --project-root /path/to/my-app \
  --project-id <project-id>

agent-hub-dev context show \
  --project-root /path/to/my-app \
  --project-id <project-id>
```

By default, context lives in Agent Hub app data and is injected at runtime. Agent
Hub does not write `AGENTS.md`, `CLAUDE.md`, `.claude/skills`, or
`.agents/skills` into your repository unless you run an explicit export command
with preview/write flags.

### Run An Agent

```sh
agent-hub-dev run --repo /path/to/my-app "@codex add the focused change"
agent-hub-dev runs list
agent-hub-dev runs show <run-id>
agent-hub-dev runs diff <run-id> --stat
```

For Claude Code:

```sh
agent-hub-dev run --repo /path/to/my-app "@claude-code investigate the failing test"
```

For deterministic debug runs:

```sh
agent-hub-dev --debug run --repo /path/to/my-app "@fake create a safe sample output"
```

### Use Chat Or The TUI

```sh
agent-hub-dev chat
agent-hub-dev tui
agent-hub-dev tui --once
```

The chat path persists local threads. The TUI renders a current-context terminal
workbench with Work, Runs, Review, Graph, Tasks, Memory, Team, and Help views.

## TUI Workbench

Because the desktop GUI is still catching up, `agent-hub tui` is the best place
to understand the current product direction. It is a keyboard-first terminal
workspace over the same local evidence used by the CLI and desktop.

The TUI is intentionally not a project browser, raw log dump, or apply/merge
surface. It focuses on the current project, thread, or room; shows the agent
conversation and run state; and keeps review actions audit-only.

### Launch Modes

```sh
agent-hub-dev tui
agent-hub-dev tui --room <handle-or-thread-id>
agent-hub-dev tui --thread <thread-id>
agent-hub-dev tui --agent codex
agent-hub-dev tui --once
agent-hub-dev tui --submit "review the current failure" --dry-run
```

Useful flags:

| Flag | Use it for |
| --- | --- |
| `--thread <id>` | Open a specific persisted chat thread. |
| `--room <handle-or-id>` | Open a room in the current registered project. |
| `--agent codex|claude-code|fake` | Select the default prompt target; `fake` is for debug/test workflows. |
| `--submit <prompt>` | Send one prompt through the TUI composer path, then render. |
| `--dry-run` | Create submitted runs without adapter execution. |
| `--workspace-base <path>` | Choose where submitted-run worktrees are created. |
| `--retain-on-failure` | Keep failed submitted-run worktrees for inspection. |
| `--accept-run <id>` / `--reject-run <id>` | Record an audit-only review decision. |
| `--once` | Render once and exit, useful for smoke checks or scripts. |

### Views

| View | What it is for |
| --- | --- |
| Work | The main conversation terminal. It shows user prompts, full completed agent replies, active run boxes, verification and risk summaries, inline small diffs, quick replies, and next-action hints. |
| Runs | A current-context operating view for active and recent runs, including stage, checks, risk, diff counts, retained-worktree state, and equivalent CLI commands. |
| Review | The focused review surface. It can expand bounded diffs, show comparison summaries, and record local accept/reject decisions without applying code. |
| Graph | RoleCall and delegation state: waiting, active, completed, blocked, iteration counts, convergence reasons, and linked run evidence. |
| Tasks | Task and RoleTodo status, assignments, deferred or rejected follow-up signals, and the next local action. |
| Memory | Governance state for proposed, approved, and rejected memory, selected skills, available skill identifiers, and context delivery mode. |
| Team | Project role configuration, executor labels, enabled/runnable counts, default rooms, selected skills, and the equivalent team-role CLI command. |
| Help | A compact reminder for view keys, palette, search, timeline, notify, and review shortcuts. |

### Keyboard Model

The TUI keeps prompt entry as the default action. Printable text goes into the
composer; view-switching shortcuts use uppercase keys when the composer is
empty so normal typing is not stolen.

| Key or command | Behavior |
| --- | --- |
| Type text | Edit the prompt in the composer. |
| `@` | Show agent and role mention completion while editing. |
| `Enter` | Submit the prompt when the composer has text. Empty `Enter` does not switch panes. |
| `Ctrl+J` | Submit the current prompt. |
| `Ctrl+O` | Insert a newline in the composer. |
| `Esc` | Clear the composer, close search or palette, or return from focused panes. |
| `Up` / `Down` | Navigate rows, or cycle composer history while editing. |
| `Tab` / `Shift+Tab` | Move through focus modes. |
| `W`, `R`, `V`, `G`, `T`, `M`, `E`, `?` | Open Work, Runs, Review, Graph, Tasks, Memory, Team, or Help. |
| `:` | Open the command palette with safe focus actions and equivalent CLI commands. |
| `Ctrl+F` or `/search` | Search rendered conversation text. |
| `L` or `/timeline` | Toggle the mini timeline for current conversation and run events. |
| `/notify` | Toggle in-session completion notifications. |
| `C` | Prepare a continuation prompt in Work. |
| `a` / `R` in Review | Record audit-only accept or reject for the selected run. |
| `Enter` / `Space` in Review | Expand or collapse the selected run diff. |
| `s` in Review | Toggle comparison mode when another run is available. |
| `p` in focused panes | Print the equivalent local CLI command hint. |
| `x`, `q`, or `Ctrl+C` | Exit when the composer is empty. |

### TUI Boundaries

- It reads from persisted local evidence and shared read models.
- It submits prompts through the same local CLI chat/run path.
- It preserves full completed agent output instead of collapsing answers by
  default.
- It keeps memory approval, apply, merge, push, PR creation, context export,
  cleanup, and background continuation outside automatic side effects.
- Review shortcuts create local `review_decision` artifacts only.

### Start The Desktop GUI

```sh
pnpm --filter desktop dev
```

The desktop GUI is useful for inspecting rooms, run cards, review panels,
memory proposals, lifecycle controls, and Team/Knowledge surfaces, but it is
not yet as complete or polished as the TUI. The renderer is sandboxed behind
`window.agentHub`; privileged work runs through Electron main-process IPC and
shared local packages, not directly from React.

## Common Workflows

| Goal | Commands |
| --- | --- |
| Add a project | `agent-hub-dev project add --name <name> --root <path>` |
| Create a task | `agent-hub-dev task create --project-id <id> --title <title>` |
| Run a saved task | `agent-hub-dev run --task <task-id> --agent codex` |
| Run an ad hoc prompt | `agent-hub-dev run --repo <path> "@codex <task>"` |
| Continue from evidence | `agent-hub-dev run --continue-from-run <run-id> --repo <path> "@codex <task>"` |
| Review a run | `agent-hub-dev runs show <run-id>` and `agent-hub-dev reviews show <run-id>` |
| Inspect output | `agent-hub-dev runs events <run-id>` and `agent-hub-dev runs diff <run-id> --patch` |
| Record a review decision | `agent-hub-dev reviews accept <run-id>` or `agent-hub-dev reviews reject <run-id>` |
| Compare two runs | `agent-hub-dev compare --task-id <task-id> --baseline <run-id> --candidate <run-id>` |
| Manage memory | `agent-hub-dev memory list/propose/approve/reject ...` |
| Manage roles | `agent-hub-dev team roles list --project-id <id>` |
| Manage rooms | `agent-hub-dev rooms list --project-id <id>` |
| Use global skills | `agent-hub-dev skills global create ...` and `agent-hub-dev run --skill global:<id> ...` |

Run `agent-hub-dev --help` for the full command list.

## Safety Model

Agent Hub is designed to keep agent work local, explicit, and inspectable:

- Real agent runs execute from an isolated git worktree, not the original
  project directory.
- Runtime context injection is the default. Repository export is opt-in and has
  preview/write controls.
- Verification commands are structured executable-plus-args commands and pass
  through dangerous-command checks.
- Sensitive paths and risky diffs are flagged in risk reports, and sensitive
  patch text is redacted before review surfaces render it.
- Review decisions are local audit records. They do not merge, push, approve
  memory, or create pull requests.
- Desktop local apply is explicit and confirmation-gated. It does not commit,
  merge, push, create pull requests, approve memory, or export repository
  context.

## Local Data

Agent Hub stores data locally:

- SQLite database: Agent Hub app data by default.
- Context stores: Agent Hub app data by default.
- Run worktrees: the configured workspace base, or the local task-runner default
  outside the original project.

Useful overrides:

```sh
AGENT_HUB_HOME=/path/to/agent-hub-home agent-hub-dev project list
AGENT_HUB_DB_PATH=/path/to/agent-hub.sqlite agent-hub-dev project list
agent-hub-dev --db /path/to/agent-hub.sqlite project list
agent-hub-dev run --workspace-base /path/to/worktrees --repo /path/to/my-app "@codex <task>"
```

## Repository Layout

```text
apps/cli                  CLI, chat, TUI command boundary, and output rendering
apps/desktop              Electron + React desktop shell
packages/shared           Shared types, agent kinds, roles, and DTOs
packages/core             Domain models, repository contracts, read models
packages/db               SQLite migrations and repository implementations
packages/context-compiler Context stores, context packs, briefs, memory, skills
packages/agent-adapters   Fake, Codex, and Claude Code process adapters
packages/task-runner      Worktrees, adapter execution, verification, diffs
packages/safety           Dangerous-command, sensitive-path, and risk scanning
tests                     Cross-package Vitest coverage
docs                      Product, architecture, and design notes
```

## Development

```sh
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm lint
pnpm build
```

If a global `pnpm` is unavailable, the repo-local binary is usually available
after install:

```sh
./node_modules/.bin/pnpm typecheck
./node_modules/.bin/pnpm test
./node_modules/.bin/pnpm test:coverage
./node_modules/.bin/pnpm lint
./node_modules/.bin/pnpm build
```

Build or preview the desktop shell:

```sh
pnpm desktop:build
pnpm --filter desktop preview
```

## Architecture In One Screen

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

The CLI and desktop share the same local core. The desktop app is a graphical
shell, not a separate orchestration backend.
