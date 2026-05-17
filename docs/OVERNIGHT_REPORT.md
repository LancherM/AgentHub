# Overnight Reports

## Current Baseline Note

The Night 1 through Night 3 reports below are historical implementation logs.
Their "remaining gaps" and "recommended next scope" sections are stale for the
current repository and must not be used as the active implementation status.

As of the current baseline, the code includes SQLite persistence, context
init/show/build/export, git worktree task runs, fake/Codex/Claude Code
adapters, verification, diff collection, safety scanning, risk report
persistence, memory propose/list/approve/reject flows, comparison report
generation, interactive CLI mode, and manual `run event add` recording.

Still deferred: desktop UI, physical `apps/` and `packages/` restructuring,
automatic memory proposal generation, and richer comparison scoring.

## Night 3 Report

### Completed

- Implemented `ShellExecutor` and `NodeShellExecutor` as the only production
  boundary for child process execution.
- Implemented `WorkspaceManager`, `Workspace`, `WorkspaceSession`,
  `WorkspaceConfig`, `WorkspaceCleanupPolicy`, and
  `GitWorktreeWorkspaceManager`.
- Added safe workspace path validation, predictable worktree paths, git
  worktree creation, dry-run support, cleanup policies, and retain-on-failure.
- Implemented `DiffCollector` for changed files, diff stat, raw diff, file
  summaries, clean worktrees, and git failure reporting.
- Implemented `VerificationRunner` for configured verification commands,
  stop/continue behavior, dry-run handling, and missing-command config.
- Implemented `RiskReportGenerator` for low/medium/high classification,
  changed files, verification summary, failed checks, risk factors, manual
  review checklist, and acceptance recommendation.
- Integrated workspace creation, fake-agent execution, diff collection,
  verification, risk report generation, run metadata storage, and cleanup into
  `TaskRunner`.
- Extended the CLI with run/risk details:

```sh
agent-hub runs show <run-id>
agent-hub risks show <run-id>
```

### Files Changed

- `README.md`
- `docs/SPEC_LOCK.md`
- `docs/REBUILD_PLAN.md`
- `docs/OPEN_QUESTIONS.md`
- `docs/product.md`
- `docs/architecture.md`
- `docs/OVERNIGHT_REPORT.md`
- `src/shell-executor.ts`
- `src/workspace.ts`
- `src/diff-collector.ts`
- `src/verification.ts`
- `src/risk-report.ts`
- `src/domain.ts`
- `src/storage.ts`
- `src/task-runner.ts`
- `src/cli.ts`
- `src/index.ts`
- `tests/workspace.test.ts`
- `tests/diff-collector.test.ts`
- `tests/verification.test.ts`
- `tests/risk-report.test.ts`
- `tests/task-runner.test.ts`
- `tests/cli.test.ts`
- `tests/helpers.ts`

### Commands Run

```sh
./node_modules/.bin/pnpm typecheck
./node_modules/.bin/pnpm test
./node_modules/.bin/pnpm lint
./node_modules/.bin/pnpm build
rg "child_process|spawn\(|exec\(|execFile|rm -rf|git push|CodexAdapter|ClaudeCodeAdapter" src tests README.md docs
```

`pnpm` was still not available globally, so validation used the repo-local
binary at `./node_modules/.bin/pnpm`.

### Test Results

- Baseline before changes: `typecheck`, `test`, `lint`, and `build` passed.
- Final `./node_modules/.bin/pnpm typecheck`: passed.
- Final `./node_modules/.bin/pnpm test`: passed, 10 test files and 51 tests.
- Final `./node_modules/.bin/pnpm lint`: passed.
- Final `./node_modules/.bin/pnpm build`: passed.
- Shell-boundary scan found `child_process` only in `src/shell-executor.ts`.

### Design Decisions

- The default runner now uses `GitWorktreeWorkspaceManager`, but only the fake
  adapter is registered and executable.
- Shell commands are modeled as executable plus args with explicit `cwd`; task
  prompt text is never used as shell command input.
- Verification commands are accepted only as explicit configuration passed to
  the runner. The CLI does not parse arbitrary verification command strings.
- Runtime task brief files remain inside `.agent-hub/tasks/<task-id>/` in the
  isolated worktree and are excluded from diff collection.
- Run metadata remains in-memory until SQLite persistence is introduced.

### Safety Decisions

- Workspace base paths inside the source repository are rejected.
- Workspace cleanup validates that the target path is inside the configured
  workspace base before invoking git worktree removal.
- Cleanup supports always-clean, on-success, retain-on-failure, never, and
  dry-run behavior.
- Dangerous shell patterns such as `sudo`, `rm -rf /`, `chmod -R 777`,
  `curl | sh`, `wget | sh`, `git push --force`, and `git clean -fdx` are
  rejected at the shell boundary.
- No CodexAdapter or ClaudeCodeAdapter was implemented or invoked.
- No remote push was performed.

### Remaining Gaps

- SQLite persistence is not implemented.
- Real Codex and Claude Code adapters are not implemented.
- Comparison report generation is not implemented.
- Memory proposal, approval, rejection, and approved-memory writeback are not
  implemented.
- Desktop UI is not implemented.
- The CLI show commands read in-memory metadata only within the same process.

### Recommended Night 4 Scope

Add SQLite persistence behind the existing repository abstractions for tasks,
runs, run metadata, verification results, diff artifacts, and risk reports.
Keep the fake-agent worktree pipeline as the regression contract before adding
real Codex or Claude Code execution.

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
