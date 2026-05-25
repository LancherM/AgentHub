> ⚠️ Note: Agent Hub is still in early development and is not yet ready for production or stable day-to-day workflows.

# Agent Hub

[中文说明](README_CN.md)

Agent Hub is a **local-first, CLI-first** developer tool for orchestrating coding agents (such as Codex, Claude Code, and Fake Agent) in isolated git worktrees, then reviewing and comparing their outputs.

The repository is already runnable and includes core workflows, but it is still evolving quickly.

## What problem does this project solve?

In multi-agent coding workflows, teams and individuals often run into the same issues:

- Task context is fragmented and hard to reuse.
- Agent execution is difficult to trace end-to-end.
- Running agents directly in the main checkout can pollute the working tree.
- Risky changes (sensitive files, dangerous commands) are not consistently scanned.

Agent Hub addresses these problems with local, auditable workflows:

- Build task-specific context packs and briefs.
- Run agents in isolated worktrees and collect logs, verification, diffs, and risks.
- Compare multiple runs for the same task.
- Manage long-term memory through a proposal → approval lifecycle.

## Core principles

- **Local-first**: local persistence by default (SQLite + local files)
- **CLI-first**: CLI is the primary interface; desktop is a local graphical shell
- **Non-invasive context delivery**: runtime injection by default instead of rewriting user repos
- **Clear safety boundaries**: runs stay in isolated worktrees, with no automatic merge / push / PR creation

## Repository layout

```text
apps/cli                  CLI entrypoint and interactive workflows
apps/desktop              Electron + React desktop shell
packages/shared           Shared types and utilities
packages/core             Domain models and service interfaces
packages/db               SQLite schema and repositories
packages/context-compiler Context compilation, briefs, and export logic
packages/task-runner      Worktrees, task execution, verification, and diff collection
packages/agent-adapters   Fake/Codex/Claude Code adapters
packages/safety           Risk scanning and safety checks
tests                     Cross-package test coverage
```

## Current capabilities (high-level)

- CLI workflows for projects, tasks, runs, events, risks, memory, and comparison
- Local SQLite persistence for project/task/run/event/risk/memory/comparison data
- Context build pipeline that compiles Agent Hub-owned context into brief/context pack artifacts
- Adapter-based execution for Fake, Codex, and Claude Code in isolated worktrees
- Run artifacts including logs, verification results, git diffs, and risk reports
- Memory workflow: propose, approve/reject, and approved-memory writeback
- Desktop shell with room navigation, TaskRunner-backed run cards,
  cancellation, inspector panels, retained-worktree handoff, comparison review,
  lifecycle controls, human-gated local apply, Team and Knowledge workspaces,
  and explicit memory approval writeback
- Per-project desktop verification command settings stored locally and executed
  through the shared TaskRunner path

## Areas still in progress

- Richer Codex/Claude structured event mapping
- Additional local executor backends and first-class schema splits when the
  metadata-backed model no longer fits
- Explicit merge, push, and pull-request workflows outside desktop local apply
- Dedicated desktop skills management UI

## Quick start

### 1) Install dependencies

```sh
pnpm install
```

### 2) Run common checks

```sh
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

If global `pnpm` is unavailable, use the repo-local binary:

```sh
./node_modules/.bin/pnpm typecheck
./node_modules/.bin/pnpm test
./node_modules/.bin/pnpm lint
```

### 3) Start the desktop shell (dev mode)

```sh
./node_modules/.bin/pnpm --filter desktop dev
```

## CLI command reference

```sh
agent-hub [--project <path>] [--agent fake|codex|claude-code]
agent-hub [--db <path>] project add --name <name> --root <path>
agent-hub [--db <path>] project list
agent-hub [--db <path>] task create --project-id <project-id> --title <title> [--description <text>]
agent-hub [--db <path>] task list [--project-id <project-id>]
agent-hub [--db <path>] task history --task-id <task-id>
agent-hub context init --project-root <path> --project-id <project-id>
agent-hub context show --project-root <path> --project-id <project-id>
agent-hub context build --project-root <path> --project-id <project-id> --task-id <task-id> --title <title> --prompt <prompt>
agent-hub context export --project-root <path> --project-id <project-id> --dry-run|--write
agent-hub [--db <path>] run --task <task-id> --agent fake|codex|claude-code
agent-hub run [--repo <path>] [--workspace-base <path>] [--retain-on-failure] "@fake|@codex|@claude-code <task>"
agent-hub [--db <path>] run event add --run-id <run-id> --type <type> --message <message>
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
