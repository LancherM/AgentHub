# Overnight Reports

## Night 2 Report

### Completed

- Implemented the non-invasive `ContextCompiler`.
- Added `ContextBundle`, `ContextSection`, `ContextSource`, `MemoryProvider`,
  `SkillProvider`, `ProjectContextProvider`, and `ContextFormatter`
  abstractions.
- Added `InMemoryMemoryProvider`, `InMemorySkillProvider`,
  `StaticProjectContextProvider`, and `MarkdownContextFormatter`.
- Refactored `FakeAgentAdapter` so it receives compiled context and includes
  fake output in its exit metadata.
- Implemented `TaskRunner` with injectable id generation, clock, context
  compiler, formatter, repositories, and agent registry.
- Added `TaskRepository`, `TaskRunRepository`, `AgentRegistry`, `RunResult`, and
  in-memory repository/registry implementations.
- Extended the CLI with:

```sh
agent-hub run "@fake <task>"
agent-hub tasks list
agent-hub runs list
```

- Added `README.md`.
- Added tests for Phase 3 and Phase 4 behavior.

### Files Changed

- `README.md`
- `docs/SPEC_LOCK.md`
- `docs/REBUILD_PLAN.md`
- `docs/product.md`
- `docs/architecture.md`
- `docs/OVERNIGHT_REPORT.md`
- `src/context-compiler.ts`
- `src/storage.ts`
- `src/agent-adapters.ts`
- `src/agent-parser.ts`
- `src/task-runner.ts`
- `src/cli.ts`
- `src/index.ts`
- `tests/context-compiler.test.ts`
- `tests/cli.test.ts`
- `tests/fake-adapter.test.ts`
- `tests/task-runner.test.ts`
- `tests/helpers.ts`

### Commands Run

```sh
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

### Test Results

- `pnpm typecheck`: passed.
- `pnpm test`: passed, 6 test files and 32 tests.
- `pnpm lint`: passed.
- `pnpm build`: passed.

### Design Decisions

- Context compilation returns generated payloads and does not write target
  repository files.
- Context bundles use stable section ordering and deterministic IDs derived
  from bundle content.
- Provider failures become bundle warnings so missing or broken optional
  context sources do not abort compilation.
- Storage remains in-memory for Night 2.
- The CLI defaults to the fake agent for plain prompts and accepts explicit
  `@fake` routing.
- `codex` and `claude-code` remain domain values but are not registered or
  executable.

### Remaining Gaps

- SQLite persistence is not implemented.
- Real git worktrees are not implemented.
- Real shell verification commands are not implemented.
- `CodexAdapter` is not implemented.
- `ClaudeCodeAdapter` is not implemented.
- Repo export and managed block writing are not implemented.
- Risk reports, memory approval flows, comparison reports, and desktop UI are
  not implemented.

### Recommended Night 3 Scope

Implement real git worktree isolation with the fake adapter only. Add tests for
git repository validation, branch/worktree path generation, original checkout
preservation, and fake adapter execution inside the worktree. Keep SQLite and
real agent adapters deferred until worktree isolation is verified.

## Night 1 Report

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
