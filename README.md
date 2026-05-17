# Agent Hub

Agent Hub is a local-first, CLI-first developer tool for orchestrating coding
agents in isolated git worktrees. The current implementation uses the imported
workspace shape: `apps/cli` is a thin CLI over local packages in `packages/`.
The desktop shell is intentionally deferred until the CLI, core APIs, and
package boundaries are stable.

## Repository Layout

```text
apps/cli                 CLI parser, interactive shell, command rendering
packages/shared          Shared types, enums, and utility contracts
packages/core            Domain validation and repository interfaces
packages/db              SQLite schema, migrations, and repositories
packages/context-compiler Context stores, context packs, briefs, and export
packages/task-runner     Worktrees, verification, diffs, risk orchestration
packages/agent-adapters  Fake, Codex, and Claude Code adapters
packages/safety          Dangerous-command, sensitive-path, and risk scanning
tests                    Cross-package Vitest coverage
```

There is no desktop app yet. Future desktop work should live under
`apps/desktop` and call the same local core/task-runner APIs rather than adding
a web server or duplicating orchestration logic.

## Commands

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
agent-hub runs show <run-id>
agent-hub risks show <run-id>
agent-hub [--db <path>] memory list --project-id <project-id>
agent-hub [--db <path>] memory propose --project-id <project-id> --category <category> --content <text>
agent-hub [--db <path>] memory approve --memory-id <memory-id>
agent-hub [--db <path>] memory reject --memory-id <memory-id>
agent-hub [--db <path>] compare --task-id <task-id> --baseline <run-id> --candidate <run-id>
```

## Current Capabilities

- Uses SQLite by default for local project, task, run, event, artifact,
  verification, risk, memory, comparison, skill, and settings persistence.
- Keeps in-memory repositories available for injected tests and focused runner
  verification.
- Builds non-invasive task context and task briefs from Agent Hub-owned context
  stores.
- Supports explicit repository context export with dry-run preview and managed
  blocks.
- Runs fake, Codex, and Claude Code adapters inside isolated worktrees.
- Injects task brief/context at runtime by default; optional worktree overlays
  stay inside the isolated worktree.
- Captures run events, verification results, git diffs, run artifacts, and risk
  reports.
- Allows manual event recording with `run event add`; appended events use the
  next sequence number for the selected run.
- Supports explicit memory proposal, approval, rejection, and approved-memory
  writeback.
- Generates persisted comparison reports for two runs of a task.
- Does not add cloud sync, accounts, remote execution, automatic merges,
  automatic pushes, or automatic pull requests.

## Current Gaps

- Desktop app.
- Automatic memory proposal generation from completed runs.
- Richer comparison scoring beyond the persisted textual summary.

## Validation

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
