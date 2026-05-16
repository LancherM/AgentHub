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
report, records run metadata, captures events, applies the workspace cleanup
policy, and prints a concise summary. The list/show commands read from local
SQLite storage by default, so tasks, runs, run details, and risk reports remain
visible across CLI processes.

SQLite is stored in Agent Hub-owned application data by default, not in the
target project repository. `AGENT_HUB_HOME` can point Agent Hub at an alternate
app data directory, and `AGENT_HUB_DB_PATH` can point at an explicit database
file for local testing or development. In-memory repositories remain available
for injected tests and focused runner verification.

Persisted run metadata currently covers:

- workspace path, branch, source repository, and worktree ownership details
- workspace cleanup result
- collected diff metadata and summaries
- verification suite result
- generated risk report

The product remains local-only. This rebuild does not add cloud sync, accounts,
team features, hosted dashboards, automatic pull requests, automatic merges, or
automatic pushes.

Deferred product capabilities include registered projects, registered tasks,
file-backed context stores, Codex and Claude Code adapters, comparison reports,
memory workflows, and the desktop shell.
