# Architecture

The rebuild preserves the CLI-first architecture from the imported specs while
starting from a minimal root TypeScript package.

Current module boundaries under `src/`:

- `domain`: validated domain entities, enums, and value objects
- `agent-adapters`: common adapter contract and `FakeAgentAdapter`
- `context-compiler`: generated context bundle assembly and markdown formatting
- `shell-executor`: explicit shell command boundary with cwd, stdout/stderr,
  exit code, duration, timeout, dry-run, and dangerous-command checks
- `workspace`: workspace abstractions and safe git worktree session management
- `diff-collector`: git status/diff/stat collection from an isolated workspace
- `verification`: configured verification command execution inside the
  workspace
- `risk-report`: structured risk report generation from diff and verification
  results
- `storage`: repository abstractions and in-memory implementations for
  projects, agent profiles, tasks, runs, events, artifacts, verification
  results, risk reports, memory items, comparison reports, skills, settings,
  run metadata, and agent registry
- `sqlite-storage`: SQLite migration/init logic and local repository
  implementations for the MVP persistence tables
- `task-runner`: fake-agent orchestration with context compilation and
  repository-backed persistence
- `cli`: command parsing and output rendering
- `agent-parser`: `@agent` prompt parsing

The CLI calls the runner rather than owning orchestration logic. The runner
compiles context, creates a worktree workspace through a `WorkspaceManager`,
selects adapters through a registry, passes generated context to the adapter as
a payload, collects diff metadata, runs configured verification commands,
generates a risk report, persists run metadata and structured run records
through repository interfaces, records run status transitions, and applies
workspace cleanup policy.

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

The fake adapter runs against an isolated worktree and refuses to run when that
directory is the original project root or when the generated task brief is
outside the isolated directory.

Shell usage is limited to `ShellExecutor` implementations. Git worktree, git
diff, and verification commands use executable-plus-args calls with explicit
cwd; task prompts are never interpreted as shell commands.

No real external agent process, API server, desktop shell, Codex adapter, or
Claude Code adapter is present in this slice.
