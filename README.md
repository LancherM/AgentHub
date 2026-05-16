# Agent Hub

Agent Hub is a local-first, CLI-first developer tool for orchestrating coding
agents. The current rebuild is intentionally narrow and uses only the
deterministic fake adapter.

## Commands

```sh
agent-hub run [--repo <path>] [--workspace-base <path>] [--retain-on-failure] "@fake <task>"
agent-hub tasks list
agent-hub runs list
agent-hub runs show <run-id>
agent-hub risks show <run-id>
```

Task, run, and run metadata storage is still in-memory. List/show commands are
useful within the same CLI process or test runtime; persistent SQLite storage is
still deferred.

## Current Capabilities

- Builds a non-invasive context bundle from task prompt, agent selection,
  repository metadata, project summary, relevant memories, relevant skills,
  user constraints, and execution hints.
- Formats context bundles as readable markdown.
- Runs the fake adapter with the compiled context payload.
- Creates an isolated git worktree under the configured workspace base.
- Collects changed files, diff stats, raw diff text, and simple file summaries.
- Runs explicitly configured verification commands inside the workspace.
- Generates a structured risk report with verification summary, failed checks,
  risk factors, manual review checklist, and acceptance recommendation.
- Persists task and run metadata through in-memory repositories.
- Records task run status transitions.
- Does not run Codex or Claude Code.
- Keeps shell execution behind the `ShellExecutor` abstraction and never turns
  task prompt text into shell commands.

## Validation

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```
