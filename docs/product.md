# Product

Agent Hub is a local-first CLI-first developer tool for orchestrating coding
agents on a developer machine.

The current verified rebuild slice supports registered projects, registered
tasks, Agent Hub-owned context stores, context artifact build/export,
deterministic fake-agent runs, process-backed Codex and Claude Code runs, and
cross-process SQLite-backed run inspection:

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
agent-hub [--db <path>] run --task <task-id> --agent fake|codex|claude-code
agent-hub run [--repo <path>] [--workspace-base <path>] [--retain-on-failure] "@fake|@codex|@claude-code <task>"
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
to the selected adapter, creates an isolated git worktree outside the original
project checkout, materializes runtime task brief/context-pack files inside
that workspace, runs the adapter with the context payload, collects git diff
metadata, runs explicitly configured verification commands, generates a
structured risk report, captures events, applies the workspace cleanup policy,
and prints a concise summary. `runtime_injection` remains the default delivery
mode. Codex and Claude Code receive the task brief/context through stdin-driven
runtime injection and do not require repository-level `AGENTS.md` or
`CLAUDE.md`. `worktree_overlay` is opt-in and writes generated `AGENTS.md`,
`CLAUDE.md`, and skill copies only inside the isolated worktree, never the
original checkout.

The process-backed adapters use direct executable-plus-args spawning:

- Codex runs `codex exec --json -` in the isolated worktree.
- Claude Code runs `claude --print --output-format stream-json` in the isolated
  worktree.
- Detection calls lightweight version commands and reports missing CLI or setup
  failures as unavailable reasons instead of crashing.
- stdout and stderr are captured as run events; structured JSONL output is
  parsed into message/status/error events when possible, while raw output is
  preserved.
- non-zero process exits and signal exits make the run fail, but the task run,
  events, artifacts, verification rows, and risk report remain inspectable.
- unsafe permission-bypass flags are not used.

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
files, those files are included in the diff. Git worktree and diff operations
apply hardened Git invocation defaults and reject repository-local Git config
keys that can execute helpers, hooks, filters, external diff commands, or
included config before Agent Hub invokes Git in the selected repository or
generated worktree. The scan covers both `.git/config` and per-worktree
`config.worktree` files in the resolved worktree git directory and common Git
directory before any Agent Hub Git command runs.

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

Deferred product capabilities include richer Codex/Claude structured event
mapping, real comparison generation, memory approval workflows, and the desktop
shell.
