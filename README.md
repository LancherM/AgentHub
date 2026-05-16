# Agent Hub

Agent Hub is a local-first, CLI-first developer tool for orchestrating coding
agents. The current rebuild is intentionally narrow and uses only the
deterministic fake adapter.

## Commands

```sh
agent-hub run "@fake <task>"
agent-hub tasks list
agent-hub runs list
```

During Night 2, task and run storage is in-memory. Lists are useful within the
same CLI process or test runtime; persistent SQLite storage is still deferred.

## Current Capabilities

- Builds a non-invasive context bundle from task prompt, agent selection,
  repository metadata, project summary, relevant memories, relevant skills,
  user constraints, and execution hints.
- Formats context bundles as readable markdown.
- Runs the fake adapter with the compiled context payload.
- Persists task and run metadata through in-memory repositories.
- Records task run status transitions.
- Does not run Codex, Claude Code, shell commands, or git worktrees.

## Validation

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

