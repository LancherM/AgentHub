# Open Questions

## Phase Numbering

The imported roadmap starts at Phase 1 and calls Phase 2 "Core Domain And
SQLite". The direct rebuild request asks for Phase 0, Phase 1, and Phase 2, but
also says to implement only the core domain model and fake-agent run path.

Current decision: Phase 0 is spec consolidation, Phase 1 is project skeleton,
and Phase 2 is the minimal fake-agent vertical slice. SQLite is deferred.

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
and `repo_export`.

## Worktree Timing

The full product requires git worktrees for agent runs, but this rebuild slice
also says not to implement real shell execution yet.

Current decision: the fake run creates an isolated temporary run directory
outside the original checkout. Real git worktree creation is the recommended
next phase.

## Package Layout Timing

The imported architecture targets a monorepo with `apps/` and `packages/`.
The direct completion criteria for this slice require a minimal `src/` tree.

Current decision: keep one root TypeScript package for the first verified
vertical slice, with clear module boundaries under `src/`. Split into packages
when persistence, context compilation, or real adapters need package-level
boundaries.

