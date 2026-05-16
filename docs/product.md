# Product

Agent Hub is a local-first CLI-first developer tool for orchestrating coding
agents on a developer machine.

The current verified rebuild slice supports registered projects, registered
tasks, Agent Hub-owned context stores, context artifact build/export,
deterministic fake-agent runs, and cross-process SQLite-backed run inspection:

```sh
agent-hub [--db <path>] project add --name <name> --root <path>
agent-hub [--db <path>] project list
agent-hub [--db <path>] task create --project-id <project-id> --title <title> [--description <text>]
agent-hub [--db <path>] task list [--project-id <project-id>]
agent-hub [--db <path>] task history --task-id <task-id>
agent-hub context init --project-root <path> --project-id <project-id>
agent-hub context show --project-root <path> --project-id <project-id>
agent-hub context build --project-root <path> --project-id <project-id> --task-id <task-id> --title <title> --prompt <prompt>
agent-hub context export --project-root <path> --project-id <project-id> --dry-run|--write
agent-hub [--db <path>] run --task <task-id> --agent fake
agent-hub run [--repo <path>] [--workspace-base <path>] [--retain-on-failure] "@fake <task>"
agent-hub tasks list
agent-hub runs list
agent-hub runs show <run-id>
agent-hub risks show <run-id>
```

The context commands initialize and inspect a project context store, build a
task-specific context pack and task brief, and explicitly export managed
repository context only when requested. External context stores are the default
and live under Agent Hub application data rather than the user repository.
Missing optional context files are surfaced as build/export warnings.
Supported store files are:

- `context/project.md`
- `context/architecture.md`
- `context/conventions.md`
- `context/testing.md`
- `context/security.md`
- `memory/approved.md`
- `skills/<skill-name>/SKILL.md`

`context export --dry-run` previews repository writes. `context export --write`
uses Agent Hub managed blocks in `AGENTS.md` and optionally `CLAUDE.md`,
preserves user-authored content outside those blocks, and ignores marker
examples inside fenced code blocks. Runtime context files are generated in
Agent Hub-owned artifacts or inside isolated worktrees; default context build
does not write repository-level agent files.

The run command validates the task input, compiles non-invasive context, routes
to the fake adapter, creates an isolated git worktree outside the original
project checkout, materializes runtime task brief/context-pack files inside
that workspace, runs the fake adapter with the context payload, collects git
diff metadata, runs explicitly configured verification commands, generates a
structured risk report, captures events, applies the workspace cleanup policy,
and prints a concise summary. `runtime_injection` remains the default delivery
mode. `worktree_overlay` is opt-in and writes generated `AGENTS.md`,
`CLAUDE.md`, and skill copies only inside the isolated worktree, never the
original checkout.

The list/show/history commands read from local SQLite storage by default, so
projects, tasks, runs, run details, and risk reports remain visible across CLI
processes. Ad hoc fake runs remain supported for the older vertical slice.

SQLite is stored in Agent Hub-owned application data by default, not in the
target project repository. `AGENT_HUB_HOME` can point Agent Hub at an alternate
app data directory, and `AGENT_HUB_DB_PATH` can point at an explicit database
file for local testing or development. In-memory repositories remain available
for injected tests and focused runner verification.

Persisted run metadata currently covers:

- workspace path, branch, source repository, and worktree ownership details
- workspace cleanup result; workspaces are retained by default unless an
  explicit cleanup policy is selected
- collected diff metadata and summaries for staged, unstaged, and untracked
  changes
- verification suite result
- generated risk report

Diff collection records binary file metadata, synthesizes reviewable patches
for untracked text files, and excludes generated overlay files only while they
still match their Agent Hub baseline. If an agent modifies generated overlay
files, those files are included in the diff.

Structured run data is now also persisted in first-class SQLite tables:

- adapter event streams in `run_events`
- git diff artifacts in `run_artifacts`
- verification command rows in `verification_results`
- risk reports in `risk_reports`

The initialized SQLite schema covers the imported MVP table set: projects,
agent profiles, tasks, task runs, run events, run artifacts, verification
results, risk reports, memory items, comparison reports, skills, settings, and
status transitions.

The product remains local-only. This rebuild does not add cloud sync, accounts,
team features, hosted dashboards, automatic pull requests, automatic merges, or
automatic pushes.

Deferred product capabilities include Claude Code adapter work, real comparison
generation, memory approval workflows, and the desktop shell.
