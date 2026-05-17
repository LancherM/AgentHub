# Architecture

The rebuild preserves the CLI-first architecture from the imported specs while
starting from a minimal root TypeScript package.

Current module boundaries under `src/`:

- `domain`: validated domain entities, enums, and value objects
- `agent-adapters`: common adapter contract, `FakeAgentAdapter`,
  `CodexAdapter`, and `ClaudeCodeAdapter`
- `context-compiler`: Agent Hub-owned context store init/show/build/export,
  context pack and task brief generation, managed block handling, and optional
  worktree overlay materialization
- `process-runner`: direct child-process spawning with stdin, streaming
  stdout/stderr, exit code and signal capture, and CLI detection helpers
- `process-environment`: allowlisted child-process environment construction
- `shell-executor`: explicit shell command boundary with cwd, stdout/stderr,
  exit code, duration, timeout, dry-run, and dangerous-command checks
- `workspace`: workspace abstractions and safe git worktree session management
- `diff-collector`: staged, unstaged, untracked, and binary-aware git diff
  collection from an isolated workspace
- `verification`: configured verification command execution inside the
  workspace
- `safety`: standalone scanners for sensitive paths, dangerous commands,
  risky diffs, large deletions, binary files, and risk level aggregation
- `dangerous-commands`: shared dangerous-command matching rules for shell
  execution rejection and safety scanning
- `risk-report`: structured risk report generation from safety scanner output,
  diff metadata, and verification results
- `storage`: repository abstractions and in-memory implementations for
  projects, agent profiles, tasks, runs, events, artifacts, verification
  results, risk reports, memory items, comparison reports, skills, settings,
  run metadata, and agent registry
- `sqlite-storage`: SQLite migration/init logic and local repository
  implementations for the MVP persistence tables
- `task-runner`: adapter orchestration with context compilation and
  repository-backed persistence
- `cli`: command parsing, interactive console input, output rendering, and
  opt-in debug rendering, including manual run-event recording
- `agent-parser`: `@agent` prompt parsing

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

Debug rendering is also a CLI concern. `--debug` or `AGENT_HUB_DEBUG=1` appends
run boundaries, context artifact paths, verification stdout/stderr, changed
file summaries, and a truncated diff preview after the normal run summary. It
does not alter runner inputs, adapter behavior, persistence, or exit status.

Manual run-event recording is a CLI persistence operation, not an adapter or
runner behavior. `run event add` loads the target run through
`TaskRunRepository`, validates the event type against the domain enum, appends
the event through `RunEventRepository`, and derives the next sequence number
from existing events for that run. This keeps manual notes in the same ordered
event stream as adapter-captured output while avoiding any task execution.

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
a reason. `CodexAdapter.run()` and `ClaudeCodeAdapter.run()` call detection
before invoking the real process. Unavailable adapters emit an error event and
failed exit event without launching the executable. Available adapters emit a
preflight status event, then stdout and stderr become `RunEvent` rows. Valid
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
Existing non-empty skill files are not overwritten without warning. All runtime
artifact writes reject symlink path components before writing so a generated
artifact path cannot escape the worktree or export root.

Overlay materialization returns generated-file baselines and warnings to the
runner. Baselines are passed into diff collection so unchanged Agent Hub
generated files are excluded, while agent-modified generated files stay
reviewable. Overlay warnings are propagated through `RunResult.warnings` and
normal CLI summary output.

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
status updates. Tasks may move `open -> running -> completed` or cancel from
`open`/`running`; task runs move through `queued -> running -> succeeded` or
`failed`, with cancellation from `queued` or `running`; memory items move only
from `proposed` to `approved` or `rejected`. Repeating the same status remains
idempotent, but terminal or reverse transitions are rejected in both SQLite and
in-memory repositories.

When the CLI executes an ad-hoc SQLite-backed run, it creates the local
`adhoc_project` project row before calling the runner. That preserves the
historical ad-hoc task id surface while satisfying the new task-to-project
foreign key.

Memory items remain SQLite domain records until the user explicitly acts.
`memory propose` creates a `proposed` row, `memory reject` moves it to
`rejected`, and `memory approve` moves it to `approved` and appends the memory
content to the Agent Hub-owned context store under `memory/approved.md`.
Approved-memory writeback uses the same context store path resolution as
context init/build, so the default destination is app data rather than the
project repository. The context compiler reads approved memory only from that
file provider; proposed and rejected database rows are not injected into context
packs.

Comparison reports are generated from persisted run data rather than process
memory or UI state. The CLI loads each selected run, diff artifacts or legacy
metadata, verification rows, and latest risk reports, then writes a textual
summary to `comparison_reports`. The summary includes changed-file overlap,
per-run diff stats, verification summaries, per-command verification outcomes,
failed checks, risk levels, risk factors, and summary tradeoffs. Comparison is
review-only and performs no accept, merge, branch delete, or push action.

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
with metadata such as binary status and byte size.

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

The physical monorepo split is intentionally deferred in this slice. The
runtime behavior is stable, but the current single-package type graph still has
contracts that cross the target dependency direction: repository interfaces
reference adapter, diff, verification, and workspace result types, and adapter
inputs reference context compiler bundle types. A mechanical file move now
would bake those reverse dependencies into package APIs. The next safe
extraction order is:

1. move shared enums and DTOs that are imported by every package into
   `packages/shared`
2. move domain validation and repository contracts into `packages/core`
3. move SQLite repositories into `packages/db`
4. move context compiler, safety, adapters, and task runner behind core/shared
   contracts
5. move CLI into `apps/cli`

Repository CI/CD lives in `.github/workflows/ci-cd.yml` and stays outside the
Agent Hub runtime. The workflow installs the pinned pnpm and Node versions from
the root package, runs the same local validation commands documented for
developers, uploads a built CLI package artifact for `main` and manual runs,
and publishes that artifact to GitHub Releases only for `v*.*.*` tags. Release
publishing uses the repository-scoped `GITHUB_TOKEN` with `contents: write` on
the release job only. There is no deployment target, external backend, custom
secret, remote task execution, or automatic code push in the CI/CD path.

Desktop preparation remains architectural only. The future desktop app should
live under `apps/desktop`, call local core/task-runner APIs through Electron
IPC or Tauri commands, and render projects, tasks, runs, diffs, verification,
risk, memory, and comparison data from local repositories. No API server or
desktop UI implementation is present in this slice.
