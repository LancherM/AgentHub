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
- `storage`: task/run repository abstractions, in-memory repositories, and agent
  registry plus in-memory run metadata storage
- `task-runner`: fake-agent orchestration with context compilation and
  in-memory persistence
- `cli`: command parsing and output rendering
- `agent-parser`: `@agent` prompt parsing

The CLI calls the runner rather than owning orchestration logic. The runner
compiles context, creates a worktree workspace through a `WorkspaceManager`,
selects adapters through a registry, passes generated context to the adapter as
a payload, collects diff metadata, runs configured verification commands,
generates a risk report, persists run metadata through repository interfaces,
records run status transitions, and applies workspace cleanup policy.

The fake adapter runs against an isolated worktree and refuses to run when that
directory is the original project root or when the generated task brief is
outside the isolated directory.

Shell usage is limited to `ShellExecutor` implementations. Git worktree, git
diff, and verification commands use executable-plus-args calls with explicit
cwd; task prompts are never interpreted as shell commands.

No real external agent process, SQLite database, API server, desktop shell,
Codex adapter, or Claude Code adapter is present in this slice.
