# Product

Agent Hub is a local-first CLI-first developer tool for orchestrating coding
agents on a developer machine.

The first verified rebuild slice supports a deterministic fake-agent run:

```sh
agent-hub run "@fake <task>"
```

This command is intentionally small. It validates the task input, routes to the
fake adapter, creates an isolated temporary run directory outside the original
project checkout, writes a generated task brief there, runs the fake adapter,
captures events, and prints a concise summary.

The product remains local-only. This rebuild does not add cloud sync, accounts,
team features, hosted dashboards, automatic pull requests, automatic merges, or
automatic pushes.

Deferred product capabilities include SQLite persistence, registered projects,
registered tasks, context stores, real git worktrees, real verification
commands, Codex and Claude Code adapters, safety reports, comparison reports,
memory workflows, and the desktop shell.

