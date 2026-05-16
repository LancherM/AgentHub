# Master Rebuild Prompt

Paste this prompt into Codex on a new computer to rebuild the project from scratch.

---

You are rebuilding a clean-room local-first developer tool named Agent Hub.

Do not copy source code from any existing repository. Implement from the product and architecture intent below. Use generic names only. Do not include secrets, private URLs, internal company names, or proprietary logic.

## Product Goal

Build a CLI-first local application for orchestrating coding agents on a developer machine.

Agent Hub should:

- register local git projects
- create and list tasks
- manage a local context store
- build task-specific context packs
- generate task-specific task briefs
- inject task context into agent runs at runtime
- run tasks in isolated git worktrees
- support a fake test agent
- support a Codex-compatible CLI adapter
- support a Claude Code-compatible CLI adapter
- capture stdout, stderr, agent messages, tool calls, errors, and exit status
- run verification commands inside the worktree
- collect git diffs from the worktree
- persist task runs, events, artifacts, and verification results in SQLite
- later generate risk reports, comparison reports, and memory approval flows

The CLI is the primary interface. A desktop shell may be added later, but it must call the same local core packages and must not duplicate orchestration logic.

## Non-Negotiable Constraints

- Local-first only.
- No cloud backend.
- No remote task execution.
- No account login.
- No team collaboration in the MVP.
- No hosted dashboard.
- No browser-only product.
- No automatic merge.
- No automatic push.
- No automatic pull request creation.
- No automatic long-term memory approval.
- No secrets in SQLite.
- Do not intentionally read credential files.
- Every agent run must use an isolated git worktree.
- Normal task runs must not modify the original project checkout.
- Default context delivery is runtime injection.
- Do not write repository-level agent context files by default.
- Repository export must be explicit and previewable.

## Recommended Stack

- TypeScript
- Node.js
- pnpm workspace
- Vitest
- SQLite
- Zod or another runtime validation library
- child process spawning for external CLIs
- git CLI or a lightweight git library

Do not use a web framework or remote API server for the MVP.

## Target Package Layout

Create a monorepo with:

- `apps/cli`: command-line and interactive interface
- `packages/core`: domain models and validation
- `packages/db`: SQLite schema and repositories
- `packages/context-compiler`: context packs, task briefs, export preview/write
- `packages/task-runner`: worktrees, adapter execution, verification, diff collection
- `packages/agent-adapters`: fake, Codex-compatible, and Claude Code-compatible adapters
- `packages/safety`: scanners and risk report generation
- `packages/shared`: shared constants and simple types
- optional `apps/desktop` later, after CLI/core stability

## Build Order

1. Scaffold the workspace, package configs, TypeScript configs, and test runner.
2. Implement shared constants for agent kinds, context delivery modes, context store modes, and risk levels.
3. Implement core domain models for projects, tasks, task runs, run events, run artifacts, verification results, comparison reports, memory items, risk reports, skills, context packs, and task briefs.
4. Implement SQLite persistence with tables for projects, agent profiles, tasks, task runs, run events, run artifacts, verification results, comparison reports, memory items, risk reports, skills, and settings.
5. Implement CLI commands for project add/list, task create/list/history, and manual run event recording.
6. Implement context store init/show/build/export. Default store should be outside the repository. Repo-local store is opt-in. Export must support dry-run preview and explicit write mode.
7. Implement managed block export behavior that preserves user-authored content outside generated blocks and ignores marker examples inside fenced code blocks.
8. Implement git repository validation and worktree creation. Worktree branch names should include task ID and agent kind. Worktree paths should be deterministic and sanitized.
9. Implement runtime context writing inside the worktree. Runtime injection is default. Worktree overlay is optional. Repository export is not a task-run delivery mode.
10. Implement the fake adapter. It should always detect as available, read the task brief, refuse to run in the original project root, refuse task briefs outside the worktree, write a small output file inside the worktree, and stream events.
11. Implement verification command execution inside the worktree with stdout, stderr, exit code, signal, started/completed timestamps, and timeout handling.
12. Implement diff collection for tracked, staged, and untracked changes. Preserve useful metadata and warnings. Do not hide generated files if the agent modifies them.
13. Implement the task runner orchestration: create worktree, build context, write runtime context, run adapter, run verification, collect diff, compute status, return a structured result.
14. Implement CLI `run` for registered tasks and ad hoc tasks. Persist registered run boundaries, events, verification results, and git diff artifacts.
15. Implement Codex-compatible and Claude Code-compatible adapters with mocked process tests. They must spawn external CLIs in the worktree, pass task brief content through stdin or equivalent runtime injection, stream output, and avoid unsafe bypass flags.
16. Implement interactive CLI mode with `@agent` routing and slash commands for help, agents, use agent, context status, context initialization, clear, exit, and quit.
17. Implement opt-in debug rendering. Debug mode can print run input boundaries, context paths, live event details, verification output, and diff text, but must not change run behavior.
18. Implement safety scanners for sensitive paths, dangerous commands, and risky diffs. Persist risk reports.
19. Implement memory proposal, list, approve, reject, and approved-memory writeback. Only approved memory can enter future context packs.
20. Implement comparison report generation for two task runs.
21. Add desktop shell only after the CLI and local core are stable.

## CLI Command Surface

Implement these commands:

- `agent-hub`
- `agent-hub project add`
- `agent-hub project list`
- `agent-hub context init`
- `agent-hub context show`
- `agent-hub context build`
- `agent-hub context export`
- `agent-hub task create`
- `agent-hub task list`
- `agent-hub task history`
- `agent-hub run`
- `agent-hub run event add`
- `agent-hub compare`
- `agent-hub memory list`
- `agent-hub memory approve`
- `agent-hub memory reject`

Interactive commands:

- `/help`
- `/agents`
- `/use <agent-kind>`
- `/context`
- `/context init`
- `/clear`
- `/exit`
- `/quit`

## Adapter Contract

Each adapter must expose:

- agent kind
- display name
- detection method
- run method returning an async event stream

Run input should include:

- original project root
- worktree path
- task brief path
- optional context pack path
- optional runtime directory
- task ID
- task title
- task prompt
- optional environment overrides

Run events should include:

- stdout
- stderr
- agent message
- tool call
- system event
- error
- exit

## Testing Requirements

Write tests for:

- core model validation
- database repositories with temporary SQLite files
- context store initialization and build behavior
- managed block export behavior
- repository export preview and write mode
- git repository validation
- worktree creation
- fake adapter event order and output location
- task runner integration with a temporary git repository
- verification command pass/fail/timeout
- diff collection
- CLI smoke commands
- interactive parser
- registered run persistence
- mocked Codex-compatible process execution
- mocked Claude Code-compatible process execution
- safety scanner findings

Before finishing each phase, run:

- `pnpm typecheck`
- `pnpm test`
- `pnpm lint`

If full verification is expensive, run targeted tests and document exactly what was run.

## Completion Standard

For every phase:

- keep the implementation small and verifiable
- preserve CLI-first architecture
- avoid cloud or SaaS concepts
- keep agent runs inside worktrees
- do not modify the original checkout during task runs
- do not automatically merge or push
- update product and architecture documentation when behavior changes
- create focused local commits when the work is complete

End each implementation report with:

```text
Changed files:
- ...

Verification:
- ...

Risks:
- ...

Follow-up:
- ...
```
