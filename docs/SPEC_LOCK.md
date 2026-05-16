# Agent Hub Spec Lock

This document consolidates the imported markdown specs into the locked rebuild
baseline for the current repository.

## Source Documents

- `AGENTS.md`
- `specs/imported/PRODUCT.md`
- `specs/imported/ARCHITECTURE.md`
- `specs/imported/ROADMAP.md`
- `specs/imported/MASTER_REBUILD_PROMPT.md`
- `specs/imported/MODULES.md`
- `specs/imported/DOMAIN_MODEL.md`
- `specs/imported/ADAPTER_SPEC.md`
- `specs/imported/CLI_SPEC.md`
- `specs/imported/DATABASE_SPEC.md`
- `specs/imported/TEST_PLAN.md`

## Locked Product Definition

Agent Hub is a local-first CLI-first developer tool for orchestrating coding
agents on a developer machine. The desktop app is a later shell over the same
local core and must not own orchestration logic.

Agent Hub is not a web SaaS product. The rebuild must not add account login,
remote task execution, cloud storage, remote workers, automatic pull requests,
automatic merges, automatic pushes, or team collaboration for the MVP.

## Locked Architecture Direction

The preferred direction remains:

```text
CLI
  -> local core
  -> task runner
  -> agent adapters

Desktop shell, later
  -> local core
  -> task runner
  -> agent adapters
```

The current rebuild slice uses a single TypeScript `src/` tree while preserving
module boundaries in code. A workspace or package split can be introduced after
the first verified vertical slice if the next phase needs it.

## Context Delivery

The default context delivery mode is runtime injection. Generated task context
must not be written to the original project checkout during a normal run.

Supported delivery modes are normalized to these internal values:

- `runtime_injection`
- `worktree_overlay`
- `repo_export`

`repo_export` is not valid for task runs.

## Agent Kinds

Supported domain values are:

- `fake`
- `codex`
- `claude-code`

Only `fake` is implemented in this rebuild slice. `codex` and `claude-code`
remain domain values but must not run yet.

## Domain Values

The current domain model validates these values:

- task status: `open`, `running`, `completed`, `cancelled`
- task run status: `queued`, `running`, `succeeded`, `failed`, `cancelled`
- run event type: `stdout`, `stderr`, `message`, `status`, `error`, `exit`
- verification status: `passed`, `failed`, `skipped`
- memory category: `project_fact`, `workflow_rule`, `user_preference`,
  `temporary_note`
- memory status: `proposed`, `approved`, `rejected`
- risk level: `low`, `medium`, `high`, `blocking`

## Current Phase Boundary

The imported roadmap labels Phase 2 as "Core Domain And SQLite", but the direct
rebuild task explicitly says to implement only the core domain model plus the
fake adapter, minimal runner, minimal CLI, and tests.

For this repository state:

- Phase 0 is spec consolidation and planning.
- Phase 1 is TypeScript, Node.js, pnpm, Vitest, and CLI skeleton setup.
- Phase 2 is the minimal local fake-agent vertical slice.

SQLite persistence, real git worktrees, real shell verification, CodexAdapter,
ClaudeCodeAdapter, safety scanning, comparison reports, memory workflows, and
desktop UI are deferred.

## Hard Constraints For This Slice

- Do not implement `CodexAdapter`.
- Do not implement `ClaudeCodeAdapter`.
- Do not implement real shell execution.
- Do not push to a remote.
- Do not delete files outside this repository.
- Do not modify files outside this repository.
- Do not introduce heavy frameworks without documenting why.
- Keep commits local, small, and reviewable.

## Minimal Run Behavior

The implemented CLI command is:

```sh
agent-hub run "@fake <task>"
```

It parses the `@fake` route, creates an isolated temporary run directory outside
the original project checkout, writes a generated task brief there, runs the
deterministic fake adapter, captures adapter events, and prints a concise run
summary.

This is not yet a real git worktree runner. Real worktree creation is deferred
to the next runner phase because this slice explicitly avoids real shell
execution.

