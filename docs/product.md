# Product

Agent Hub is a local-first CLI-first developer tool for orchestrating coding
agents on a developer machine.

The current verified rebuild slice supports a deterministic fake-agent run:

```sh
agent-hub run [--repo <path>] [--workspace-base <path>] [--retain-on-failure] "@fake <task>"
agent-hub tasks list
agent-hub runs list
agent-hub runs show <run-id>
agent-hub risks show <run-id>
```

The run command validates the task input, compiles non-invasive context, routes
to the fake adapter, creates an isolated git worktree outside the original
project checkout, writes generated runtime files inside that workspace, runs
the fake adapter with the context payload, collects git diff metadata, runs
explicitly configured verification commands, generates a structured risk
report, records run metadata in memory, captures events, applies the workspace
cleanup policy, and prints a concise summary. The list/show commands read from
the same in-memory process storage.

The product remains local-only. This rebuild does not add cloud sync, accounts,
team features, hosted dashboards, automatic pull requests, automatic merges, or
automatic pushes.

Deferred product capabilities include SQLite persistence, registered projects,
registered tasks, file-backed context stores, Codex and Claude Code adapters,
comparison reports, memory workflows, and the desktop shell.
