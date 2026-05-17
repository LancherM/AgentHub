# Approved Nightly Tasks

This file tracks product and technical improvements approved for future
nightly automation runs. Each task should remain small, CLI-first, local-only,
and independently verifiable.

## 2026-05-17: Persisted Run Review CLI

Status: approved

Source: `product-and-technical-optimize`

### Product Change

Add a read-only CLI review surface for persisted task-run evidence:

- `agent-hub runs events <run-id>`
- `agent-hub runs diff <run-id> [--stat|--patch]`

The goal is to make logs, adapter events, verification output, and collected
diff artifacts inspectable from local SQLite-backed run records without
requiring debug reruns or retained worktree spelunking.

### Technical Change

Move comparison and review-data aggregation out of `apps/cli` and into a local
package service, likely under `packages/task-runner`. Keep the CLI responsible
for argument parsing and rendering only.

### Why This Fits Agent Hub

- Strengthens the CLI-first review loop.
- Improves local auditability from persisted run data.
- Builds on isolated worktree runs, verification, risk reports, and comparison.
- Does not add a web dashboard, hosted service, login, remote execution,
  marketplace, automatic merge, or automatic push.

### Suggested Scope

- Add repository-backed readers for run events and git diff artifacts.
- Add CLI commands for event and diff inspection.
- Preserve concise normal `run` output; make deeper inspection explicit.
- Extract comparison snapshot and summary generation from `apps/cli`.
- Update `docs/product.md`, `docs/architecture.md`, and focused tests.

### Acceptance Criteria

- `runs events` shows ordered persisted events for a run across CLI processes.
- `runs diff --stat` shows persisted changed-file and diff-stat metadata.
- `runs diff --patch` prints the persisted diff artifact with safe truncation or
  an explicit full-output flag.
- Existing `runs show`, `risks show`, and `compare` behavior remains compatible.
- Comparison generation no longer lives in `apps/cli/src/cli.ts`.
- No repository write, merge, push, pull request, or acceptance action is added
  to the product workflow.
- Relevant tests pass with the repo-local pnpm binary.
