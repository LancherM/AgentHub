# Architecture

The rebuild preserves the CLI-first architecture from the imported specs while
starting from a minimal root TypeScript package.

Current module boundaries under `src/`:

- `domain`: validated domain entities, enums, and value objects
- `agent-adapters`: common adapter contract and `FakeAgentAdapter`
- `context-compiler`: generated context bundle assembly and markdown formatting
- `storage`: task/run repository abstractions, in-memory repositories, and agent
  registry
- `task-runner`: fake-agent orchestration with context compilation and
  in-memory persistence
- `cli`: command parsing and output rendering
- `agent-parser`: `@agent` prompt parsing

The CLI calls the runner rather than owning orchestration logic. The runner
compiles context, selects adapters through a registry, persists task/run
metadata through repository interfaces, records run status transitions, and
passes generated context to the adapter as a payload.

The fake adapter runs against an isolated temporary run directory and refuses to
run when that directory is the original project root or when the generated task
brief is outside the isolated directory.

No real external agent process, shell command execution, SQLite database, API
server, desktop shell, Codex adapter, or Claude Code adapter is present in this
slice.
