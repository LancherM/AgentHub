# Architecture

The rebuild preserves the CLI-first architecture from the imported specs and
now uses the imported workspace package layout for the local CLI and core
services.

Current workspace boundaries:

- `packages/shared`: shared enums, DTOs, JSON/value types, ID/time helpers,
  process environment helpers, context bundle contracts, shell/diff/
  verification/workspace result contracts, agent kinds, context delivery
  modes, memory states, and risk levels.
- `packages/core`: domain validation, state transition helpers, repository
  interfaces, and in-memory repository implementations. Core depends only on
  shared and does not import db, task-runner, adapters, context-compiler,
  safety, or CLI.
- `packages/safety`: dangerous-command detection, deterministic safety
  scanners, risk aggregation, and risk report generation.
- `packages/agent-adapters`: the common adapter contract, adapter registry,
  `FakeAgentAdapter`, `CodexAdapter`, `ClaudeCodeAdapter`, process runner, and
  `@agent` prompt parsing. Adapters do not depend on CLI rendering.
- `packages/context-compiler`: Agent Hub-owned context store init/show/build/
  export, context pack and task brief generation, managed block handling,
  worktree overlay materialization, and approved-memory writeback helpers.
- `packages/db`: SQLite migrations, schema initialization, default database
  path resolution, and SQLite repository implementations for the core
  repository interfaces.
- `packages/task-runner`: worktree management, shell execution, git safety,
  diff collection, verification command execution, risk report orchestration,
  persisted run review aggregation, comparison summary generation, and task-run
  orchestration.
- `apps/cli`: command parsing, interactive console input, command dispatch,
  output rendering, debug rendering, and manual run-event recording. The CLI is
  thin over local package APIs and does not own orchestration logic.

Desktop remains architectural only and deferred until these CLI, core, and
package boundaries are stable. No desktop app, Electron/Tauri shell, browser
UI, web server, login, cloud backend, or remote execution path is introduced in
this phase.

Child process environment policy is explicit by default. `ProcessRunner` and
`ShellExecutor` build child environments from a small inherited allowlist
needed for local CLI execution: path lookup, home/config/cache locations,
temporary directories, locale/terminal flags, CI, and required Windows process
variables. They do not pass all of `process.env`, so secrets such as arbitrary
API keys or tokens are not inherited accidentally. Callers may still provide
explicit per-process environment overrides; an override value of `undefined`
removes an allowlisted variable for that child.

The CLI calls the runner rather than owning orchestration logic. The runner
compiles context, creates a worktree workspace through a `WorkspaceManager`,
selects adapters through a registry, passes generated context to the adapter as
a payload, materializes runtime task brief/context-pack artifacts inside the
worktree, collects diff metadata, runs configured verification commands,
generates a risk report, persists run metadata and structured run records
through repository interfaces, records run status transitions, and applies
workspace cleanup policy. The default cleanup policy is `never`, so worktrees
are retained unless a caller explicitly selects cleanup behavior.

Runner finalization is deliberately defensive after the task run row has been
created. Post-adapter stages catch and convert failures from diff collection,
verification, risk generation, artifact/result persistence, metadata
persistence, and workspace cleanup into diagnostic error events and run
warnings. The runner uses synthetic failed diff or verification results when a
stage cannot produce its normal output, marks the run `failed`, returns the
task to `open`, persists every available partial record, and still attempts
workspace cleanup according to policy. Event persistence is the last best-effort
write; if it fails after an otherwise successful run, the run is downgraded to
`failed` so it is not reported as cleanly complete without its event stream.

Interactive CLI mode is a shell over the same command/runtime path. Bare
`agent-hub` reads line-oriented input, handles slash commands locally, and
routes natural language prompts or `@agent` prompts through the existing run
command and `TaskRunner`. It keeps selected agent and project state in the CLI
layer only; it does not create a second orchestration implementation.

Run output rendering is also a CLI concern. Normal `run` output shows the
agent-facing output extracted from fake output, structured message/error
events, or raw non-JSON stdout/stderr fallbacks. Structured lifecycle/status
events are persisted for inspection and debug output but are not rendered as
normal agent output. Parser promotion is limited to assistant/agent/result
payloads, so lifecycle summaries and non-assistant message items remain status
events. It does not show Agent Hub run metadata by default, and interactive
mode does not echo prompt dispatch lines unless debug rendering is enabled.

Debug rendering remains opt-in. `--debug` or `AGENT_HUB_DEBUG=1` appends the
run summary, run boundaries, context artifact paths, verification
stdout/stderr, changed file summaries, and a truncated diff preview after the
normal agent output. It does not alter runner inputs, adapter behavior,
persistence, or exit status.

Manual run-event recording is a CLI persistence operation, not an adapter or
runner behavior. `run event add` loads the target run through
`TaskRunRepository`, validates the event type against the domain enum, appends
the event through `RunEventRepository`, and derives the next sequence number
from existing events for that run. This keeps manual notes in the same ordered
event stream as adapter-captured output while avoiding any task execution.

Persisted run review aggregation lives in `packages/task-runner`. The CLI
parses `runs events <run-id>` and `runs diff <run-id> [--stat|--patch]`, then
delegates repository-backed loading of ordered events, latest `git_diff`
artifacts, changed-file metadata, diff stats, and patch truncation to the local
package. This keeps review commands read-only and process-independent while
avoiding comparison or artifact aggregation logic in the CLI layer.

Safety review is separated from report rendering. `SafetyScanner` scans the
collected diff, changed-file metadata, verification command text, and captured
adapter run-event text and returns structured findings. Sensitive path changes
and dangerous command findings use `level: blocking`; aggregation preserves
that level instead of coercing it to high. Dangerous command detection is shared
by `SafetyScanner` and `ShellExecutor`, so configured verification commands and
generated/diff text use the same rules for `sudo`, `rm -rf /`, `chmod -R 777`,
`curl | sh`, `wget | sh`, `git push --force`, and `git clean -fdx`, including
common `sh -c` and `bash -lc` wrappers. `RiskReportGenerator` adds verification
and manual-review context around those scanner findings and the task runner
persists the resulting report to `risk_reports` for both successful and failed
runs.

The MVP risk input boundary is intentionally bounded. The runner scans adapter
stdout, stderr, parsed structured messages, error/status events, and exit
metadata because those are persisted as ordered run events. It does not
recursively read arbitrary files from the retained worktree or scan every
artifact blob beyond the diff and the event stream in this phase; future
artifact types can opt into the same `SafetyScanner` text boundary when they
become first-class logs.

The default agent registry includes fake, Codex, and Claude Code adapters.
Real adapters run only inside the isolated worktree cwd. They use
`ProcessRunner` to spawn executables with argument arrays and stdin; no shell
interpolation is used. Runtime injection remains the default: task brief and
context are sent through stdin, while the generated worktree-local
`.agent-hub/tasks/<task-id>/` files are available for inspection. The adapters
do not use permission-bypass flags, do not push, do not merge, and do not delete
branches.

Process detection is non-fatal and is part of real-adapter run preflight.
`CodexAdapter.detect()` runs `codex --version` and
`ClaudeCodeAdapter.detect()` runs `claude --version`; missing commands,
non-zero exits, or setup/authentication failures return `available: false` with
a reason. `CodexAdapter.run()` and `ClaudeCodeAdapter.run()` validate the
worktree and generated task brief boundary before run-scoped detection, and
that detection runs from the isolated worktree cwd with the run environment.
Unavailable adapters emit an error event and failed exit event without
launching the executable. Available adapters emit a preflight status event,
then stdout and stderr become `RunEvent` rows. Valid
JSONL stdout lines are additionally mapped to message/status/error events,
malformed structured output remains preserved as raw stdout, and exit events
record both exit code and signal metadata. A non-zero exit marks the run failed,
and the failed run is still persisted through the same repositories as
successful runs.

The context compiler owns the boundary for generated context artifacts. It can
initialize and inspect context stores, read external context from Agent
Hub-owned app data by default, build typed context packs and task briefs, and
perform explicit repository exports. Missing optional context files are
reported as warnings rather than causing context builds to fail. The default
external store path is:

```text
<agent-hub-app-data>/context-stores/<project-id>/
  context/project.md
  context/architecture.md
  context/conventions.md
  context/testing.md
  context/security.md
  memory/approved.md
  skills/<skill-name>/SKILL.md
```

Repo-local context stores remain opt-in through `--mode repo_local`. Repository
export remains opt-in through `context export --dry-run` or
`context export --write`; dry-run produces previews without writing, while
write mode updates managed blocks in `AGENTS.md` and optionally `CLAUDE.md`.
Managed block replacement preserves user-authored content outside the block and
does not treat fenced code examples of the markers as real blocks.

`runtime_injection` is still the default delivery mode. In this mode the runner
writes only worktree-local runtime files under `.agent-hub/tasks/<task-id>/` and
passes the generated context to the adapter. `worktree_overlay` additionally
materializes managed `AGENTS.md`, `CLAUDE.md`, and skill copies under
`.claude/skills` and `.agents/skills`, but only inside the isolated worktree.
The CLI validates `context build` and task run delivery modes against that
two-value set, and the task runner enforces the same boundary for runs.
`repo_export` is reserved for explicit repository export flows and is rejected
outside those flows.
Existing non-empty skill files are not overwritten without warning. All runtime
artifact writes reject symlink path components before writing so a generated
artifact path cannot escape the worktree or export root. Persisted task brief
artifacts use the generated in-memory task brief content rather than rereading
worktree runtime files, so a failed materialization path cannot disclose a
symlink target into Agent Hub storage.

Overlay materialization returns generated-file baselines and warnings to the
runner. Baselines are passed into diff collection so unchanged Agent Hub
generated files are excluded, while agent-modified generated files stay
reviewable. Overlay warnings are propagated through `RunResult.warnings` and
normal CLI summary output.

Diff collection records untracked symlinks as symlinks while omitting their
targets from changed-file metadata, synthetic diff text, and file summaries.
This keeps review metadata useful without disclosing absolute target paths from
outside the isolated worktree.

The repository interfaces remain the storage boundary. In-memory repositories
are kept for focused tests and injected runtimes. The CLI default runtime uses
SQLite repositories, initialized by simple versioned migrations, with the
database stored under Agent Hub application data by default:

- macOS: `~/Library/Application Support/Agent Hub/agent-hub.sqlite`
- Windows: `%LOCALAPPDATA%/Agent Hub/agent-hub.sqlite`
- Linux: `$XDG_DATA_HOME/agent-hub/agent-hub.sqlite` or
  `~/.local/share/agent-hub/agent-hub.sqlite`

`AGENT_HUB_HOME` overrides the app data directory, `AGENT_HUB_DB_PATH`
overrides the exact database file, and the CLI global `--db <path>` selects a
database file for that invocation. These paths are Agent Hub-owned storage and
are not written into the target repository.

The SQLite schema is initialized through versioned migrations. It covers
`projects`, `agent_profiles`, `tasks`, `task_runs`, `run_events`,
`run_artifacts`, `verification_results`, `risk_reports`, `memory_items`,
`comparison_reports`, `skills`, `settings`, `status_transitions`, and legacy
`run_metadata`. The task runner writes adapter events to `run_events`, diff
payloads to `run_artifacts`, verification command rows to
`verification_results`, and generated risk reports to `risk_reports`. The
legacy aggregate `run_metadata` remains for compatibility with existing show
paths and is no longer the only persisted source for run inspection.

Migration version 3 rebuilds the early `tasks` and `task_runs` tables to add
the imported database constraints that SQLite cannot add in place. Existing
valid rows are copied forward, `tasks.project_id` cascades from `projects`,
`task_runs.agent_profile_id` references `agent_profiles` with delete-to-null
semantics, task statuses and run statuses use enum-like `CHECK` constraints,
and task-run agent kinds are checked at the table boundary. The migration
guards abort before rebuilding if existing rows would violate those
relationships or enum values.

Repository implementations enforce the imported state diagrams before writing
status updates. Tasks may move `open -> running -> completed`, return from
`running` to `open` after a failed run, or cancel from `open`/`running`; task
runs move through `queued -> running -> succeeded` or `failed`, with
cancellation from `queued` or `running`; memory items move only from `proposed`
to `approved` or `rejected`. Repeating the same status remains idempotent, but
invalid terminal transitions are rejected in both SQLite and in-memory
repositories.

When the CLI executes an ad-hoc SQLite-backed run, it first looks up a project
by the resolved repository root. The first legacy ad-hoc root can keep the
`adhoc_project` id for compatibility; if that id already belongs to a different
root, the CLI creates a deterministic root-scoped ad-hoc project id before
calling the runner. That preserves the task-to-project foreign-key contract
without attaching later ad-hoc tasks or memory writeback to the wrong local
repository. During SQLite migration 3, legacy task project ids that do not yet
have a `projects` row are backfilled as local legacy projects before the task
tables are rebuilt with foreign-key constraints.

Memory items remain SQLite domain records until the user explicitly acts.
`memory propose` creates a `proposed` row, `memory reject` moves it to
`rejected`, and `memory approve` moves it to `approved` and appends the memory
content to the Agent Hub-owned context store under `memory/approved.md`.
Approved-memory writeback uses the same context store path resolution as
context init/build, so the default destination is app data rather than the
project repository. The context compiler reads approved memory only from that
file provider and treats the default `# Approved Memory` heading as an empty
placeholder; proposed and rejected database rows are not injected, and
placeholder content does not become a context-pack memory section.

Comparison reports are generated from persisted run data rather than process
memory or UI state. `packages/task-runner` loads each selected run, diff
artifacts or legacy metadata, verification rows, and latest risk reports, then
returns a textual summary that the CLI stores in `comparison_reports`. The
summary includes changed-file overlap, per-run diff stats, verification
summaries, per-command verification outcomes, failed checks, risk levels, risk
factors, and summary tradeoffs. Comparison is review-only and performs no
accept, merge, branch delete, or push action.

All adapters run against an isolated worktree and refuse to run when that
directory is the original project root or when the generated task brief is
outside the isolated directory. Codex is invoked as `codex exec --json -`.
Claude Code is invoked as `claude --print --output-format stream-json`.

The diff collector first reads git status, then filters generated files against
the baselines returned by context overlay materialization. Generated files are
hidden only when their current content still matches the Agent Hub baseline; if
the agent changes them, they become normal reviewable diff entries. Raw diff
commands are scoped to the filtered tracked paths, and bounded untracked text
files get synthetic patch content. Before reading untracked files, the collector
uses `lstat` to avoid dereferencing symlinks, records symlink targets via
`readlink`, verifies readable real paths remain inside the isolated worktree,
and omits synthetic content for oversized files. Binary files are represented
with metadata such as binary status and byte size. CLI debug rendering redacts
the raw diff preview when the risk report contains a blocking sensitive-path
finding, or when the diff changed-file metadata itself matches a sensitive path
before a risk report is available.

Shell usage is limited to `ShellExecutor` and `ProcessRunner` implementations.
Git worktree, git diff, verification commands, and real agent processes use
executable-plus-args calls with explicit cwd; task prompts are never
interpreted as shell commands. Git operations additionally go through the
Git safety helpers, which set non-interactive/hardened Git environment and
command-line config overrides, disable external diff/textconv for diff
collection, and reject repository-local Git config keys such as `core.fsmonitor`,
`core.hooksPath`, executable filters, external diff drivers, textconv commands,
and config includes before invoking Git. The local Git config scanner checks the
repository config, common config, and worktree config files, and its parser
accepts Git-style section comments and subsection names that contain dots so
filter and diff driver helpers cannot bypass the pre-flight gate.

Workspace creation performs collision preflights before `git worktree add`.
An existing target worktree path fails before invoking Git, and an existing
deterministic task/agent branch fails with a clear workspace error instead of
attempting automatic cleanup, branch deletion, merge, push, or acceptance.
Verification commands run with the isolated worktree as cwd. Dangerous command
rejection is represented as a failed verification command, and shell results
carry timeout and signal metadata so callers can distinguish command failures
from process termination.

The physical package split is present, but it is still an MVP boundary rather
than a desktop platform boundary. Cross-package contracts flow through
`packages/shared` and `packages/core`; task-runner consumes context compiler,
agent adapters, safety, and core repositories; apps/cli calls the local package
APIs instead of duplicating orchestration. Future restructuring should preserve
that direction and keep desktop work separate until these boundaries remain
stable under feature work.

Repository CI/CD lives in `.github/workflows/ci-cd.yml` and stays outside the
Agent Hub runtime. The workflow installs the pinned pnpm and Node versions from
the root package, runs the same local validation commands documented for
developers, uploads a built CLI package artifact for `main` and manual runs,
and publishes that artifact to GitHub Releases only for `v*.*.*` tags. The
artifact includes the workspace package sources, tests, CI workflow, and root
TypeScript/Vitest configs so the root package scripts remain executable after
extraction. Release publishing uses the repository-scoped `GITHUB_TOKEN` with
`contents: write` on the release job only. There is no deployment target,
external backend, custom secret, remote task execution, or automatic code push
in the CI/CD path.

Desktop preparation remains architectural only. The future desktop app should
live under `apps/desktop`, call local core/task-runner APIs through Electron
IPC or Tauri commands, and render projects, tasks, runs, diffs, verification,
risk, memory, and comparison data from local repositories. No API server or
desktop UI implementation is present in this slice.
