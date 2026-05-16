# Architecture

The rebuild preserves the CLI-first architecture from the imported specs while
starting from a minimal root TypeScript package.

Current module boundaries under `src/`:

- `domain`: validated domain entities, enums, and value objects
- `agent-adapters`: common adapter contract and `FakeAgentAdapter`
- `task-runner`: minimal fake-agent orchestration
- `cli`: command parsing and output rendering
- `agent-parser`: `@agent` prompt parsing

The CLI calls the runner and adapters rather than owning orchestration logic.
The fake adapter runs against an isolated temporary run directory and refuses to
run when that directory is the original project root or when the generated task
brief is outside the isolated directory.

No real external agent process, shell command execution, SQLite database, API
server, desktop shell, Codex adapter, or Claude Code adapter is present in this
slice.

