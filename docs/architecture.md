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
- `storage`: task/run/run-metadata repository abstractions, in-memory
  repository implementations, and agent registry
- `sqlite-storage`: SQLite migration/init logic and local repository
  implementations for tasks, task runs, status transitions, and run metadata
- `task-runner`: fake-agent orchestration with context compilation and
  repository-backed persistence
- `cli`: command parsing and output rendering
- `agent-parser`: `@agent` prompt parsing

The CLI calls the runner rather than owning orchestration logic. The runner
compiles context, creates a worktree workspace through a `WorkspaceManager`,
selects adapters through a registry, passes generated context to the adapter as
a payload, collects diff metadata, runs configured verification commands,
generates a risk report, persists run metadata through repository interfaces,
records run status transitions, and applies workspace cleanup policy.

The repository interfaces remain the storage boundary. In-memory repositories
are kept for focused tests and injected runtimes. The CLI default runtime uses
SQLite repositories, initialized by simple versioned migrations, with the
database stored under Agent Hub application data by default:

- macOS: `~/Library/Application Support/Agent Hub/agent-hub.sqlite`
- Windows: `%LOCALAPPDATA%/Agent Hub/agent-hub.sqlite`
- Linux: `$XDG_DATA_HOME/agent-hub/agent-hub.sqlite` or
  `~/.local/share/agent-hub/agent-hub.sqlite`

`AGENT_HUB_HOME` overrides the app data directory and `AGENT_HUB_DB_PATH`
overrides the exact database file. These paths are Agent Hub-owned storage and
are not written into the target repository. The SQLite schema persists `tasks`,
`task_runs`, `status_transitions`, and `run_metadata`; run metadata stores the
workspace, cleanup result, diff result, verification result, and risk report as
JSON payloads keyed by run id.

The fake adapter runs against an isolated worktree and refuses to run when that
directory is the original project root or when the generated task brief is
outside the isolated directory.

Shell usage is limited to `ShellExecutor` implementations. Git worktree, git
diff, and verification commands use executable-plus-args calls with explicit
cwd; task prompts are never interpreted as shell commands.

No real external agent process, API server, desktop shell, Codex adapter, or
Claude Code adapter is present in this slice.
