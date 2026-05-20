# Open Questions

This file is a decision log, not the current implementation status. Use
`docs/product.md`, `docs/architecture.md`, and `docs/SPEC_LOCK.md` for the
current baseline.

## Phase Numbering

The imported roadmap starts at Phase 1 and calls Phase 2 "Core Domain And
SQLite". Earlier rebuild prompts used narrower "Night" slices that stopped at
fake-agent execution or deferred SQLite.

Current decision: phase numbers are historical planning labels only. The
current code has moved beyond the fake-only slice and includes the `apps/` plus
`packages/` workspace split, SQLite, real process adapters, safety/risk
reports, memory workflows, automatic proposed-memory generation, structured
comparison scoring, manual run-event recording, and the first local desktop
shell. Do not infer missing capabilities from older Night 1 through Night 3
reports without checking the code.

## Run Status Naming

The CLI spec shows `status: review_ready`, while the domain model lists
`queued`, `running`, `succeeded`, `failed`, and `cancelled`.

Current decision: the domain model uses `succeeded` and `failed`. A future CLI
can render a successful run as review-ready without adding a persisted
`review_ready` status.

## Context Delivery Values

The specs use prose labels such as "runtime injection" and flag values such as
`runtime_injection`. They also use both `repository export` and `repo_export`.

Current decision: internal values are `runtime_injection`, `worktree_overlay`,
and `repo_export`. `repo_export` is valid only for explicit export commands,
not task runs.

## Worktree Timing

The full product requires git worktrees for agent runs, while early rebuild
notes deferred real shell execution.

Current decision: every current task run uses an isolated git worktree through
the workspace manager. Runtime files are written inside the worktree, not the
original checkout.

## CLI Live Run-Event Streaming

The imported adapter and desktop flows describe live event streams, while
current command mode writes normal output only after a local task run finishes.

Current decision: MVP command mode intentionally keeps post-run rendering.
`TaskRunner.run()` collects and persists adapter events, then the CLI prints
the final agent-facing output once. Operators can inspect persisted events with
`runs events` and use `--debug` for post-run metadata. A future live terminal
status stream must be additive and must not add a server, websocket layer,
remote execution, or browser UI.

## Package Layout Timing

The imported architecture targets a monorepo with `apps/` and `packages/`.

Current decision: the physical workspace split is complete. Current code uses
`apps/cli` for command-line behavior, `apps/desktop` for the thin Electron
shell, and local core packages under `packages/`. Any older references to a
single root `src/` package are historical notes, not current architecture.

## Desktop Execution Scope

The current repository includes the first Electron + React desktop conversation
console, so older notes saying "desktop UI is not implemented" are stale.

Current decision: desktop remains a thin local shell over Electron main-process
IPC and SQLite-backed services. Real desktop TaskRunner integration for
Codex/Claude execution, real verification configuration, approved-memory
writeback confirmation, multi-agent comparison review, worktree lifecycle
management, and explicit merge/apply workflows remain deferred follow-up work.
