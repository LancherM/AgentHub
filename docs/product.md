# Product

Agent Hub is a local-first CLI-first developer tool for orchestrating coding
agents on a developer machine.

The current verified rebuild slice supports a deterministic fake-agent run:

```sh
agent-hub run "@fake <task>"
agent-hub tasks list
agent-hub runs list
```

The run command validates the task input, compiles non-invasive context, routes
to the fake adapter, creates an isolated temporary run directory outside the
original project checkout, writes a generated task brief there, runs the fake
adapter with the context payload, records task/run metadata in memory, captures
events, and prints a concise summary. The list commands read from the same
in-memory process storage.

The product remains local-only. This rebuild does not add cloud sync, accounts,
team features, hosted dashboards, automatic pull requests, automatic merges, or
automatic pushes.

Deferred product capabilities include SQLite persistence, registered projects,
registered tasks, file-backed context stores, real git worktrees, real
verification commands, Codex and Claude Code adapters, safety reports,
comparison reports, memory workflows, and the desktop shell.
