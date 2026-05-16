# Overnight Report

## Completed

- Imported `AGENTS.md` and `specs/imported/*.md` as the source-of-truth baseline.
- Consolidated the imported specs into `docs/SPEC_LOCK.md`.
- Created `docs/REBUILD_PLAN.md`.
- Created `docs/OPEN_QUESTIONS.md`.
- Created `docs/product.md` and `docs/architecture.md`.
- Initialized a TypeScript, Node.js, pnpm, and Vitest project.
- Added the minimal core domain model with runtime validation.
- Added the shared adapter contract and `FakeAgentAdapter`.
- Added a minimal task runner that creates an isolated fake run directory,
  writes a task brief, runs the fake adapter, captures events, and returns a
  structured result.
- Added `@agent` prompt parsing.
- Added the minimal CLI command:

```sh
agent-hub run "@fake <task>"
```

- Added tests for the domain model, fake adapter, task runner, and `@agent`
  parsing.
- Created focused local commits for the baseline, docs, skeleton, and fake run
  slice.

## Commands Run

```sh
pnpm typecheck
pnpm test
pnpm lint
pnpm build
node dist/cli.js run "@fake smoke test the fake adapter"
```

Because `pnpm` was not installed globally and Corepack failed package-manager
signature verification, validation was run with the repo-local pnpm binary on
`PATH` after bootstrapping dependencies with repo-local cache and store paths.

## Failures Fixed

- `pnpm` was not available globally.
  - Fixed by bootstrapping `pnpm@10.10.0` with npm cache, temp, and pnpm store
    paths inside this repository.
- Corepack failed with a package-manager signature verification error.
  - Avoided Corepack and used the repo-local pnpm bootstrap instead.
- `vitest@4.1.6` failed at startup because the Rolldown native optional binding
  was unavailable for this install.
  - Fixed by pinning `vitest@1.6.0`, which uses the older Vite/esbuild path.
- pnpm 10 initially blocked the `esbuild` build script.
  - Fixed by explicitly allowing only `esbuild` in the local `pnpm`
    `onlyBuiltDependencies` allow-list and rebuilding it.

## Verification Result

- `pnpm typecheck`: passed.
- `pnpm test`: passed, 4 test files and 17 tests.
- `pnpm lint`: passed.
- CLI smoke run after `pnpm build`: passed.

## Remaining Gaps

- SQLite persistence is not implemented.
- Real git worktree creation is not implemented.
- Real shell verification commands are not implemented.
- `CodexAdapter` is not implemented.
- `ClaudeCodeAdapter` is not implemented.
- Context store initialization, context packs, repo export, and managed blocks
  are not implemented.
- Risk report generation and safety scanners are not implemented.
- Memory proposal, approval, rejection, and approved-memory writeback are not
  implemented.
- Comparison reports are not implemented.
- Desktop UI is not implemented.

## Next Recommended Phase

Implement real git worktree task isolation before adding SQLite or real agent
adapters. The next phase should validate git repository detection, deterministic
branch and worktree path generation, original-checkout preservation, and fake
adapter execution inside a real worktree.

