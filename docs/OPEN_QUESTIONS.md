# Open Questions

This file is a decision log, not the current implementation status. Use
`docs/product.md`, `docs/architecture.md`, and `docs/SPEC_LOCK.md` for the
current baseline.

## Phase Numbering

The imported roadmap starts at Phase 1 and calls Phase 2 "Core Domain And
SQLite". Earlier rebuild prompts used narrower "Night" slices that stopped at
fake-agent execution or deferred SQLite.

Current decision: phase numbers are historical planning labels only. The
current code has moved beyond the fake-only slice and includes SQLite, real
process adapters, safety/risk reports, memory workflows, comparison reports,
and manual run-event recording. Do not infer missing capabilities from older
Night 1 through Night 3 reports without checking the code.

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

## Package Layout Timing

The imported architecture targets a monorepo with `apps/` and `packages/`.
The current implementation remains a single root TypeScript package with clear
module boundaries under `src/`.

Current decision: keep the root package layout for this baseline. Split into
physical packages only when the user explicitly asks for that work or when a
separate task first extracts stable shared contracts.
