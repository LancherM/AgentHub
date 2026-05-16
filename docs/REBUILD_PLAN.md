# Rebuild Plan

## Phase 0: Spec Baseline

Goal: turn the imported markdown specs into an explicit local rebuild baseline.

Deliverables:

- `docs/SPEC_LOCK.md`
- `docs/REBUILD_PLAN.md`
- `docs/OPEN_QUESTIONS.md`
- `docs/product.md`
- `docs/architecture.md`
- existing `AGENTS.md` preserved

Validation:

- specs are readable from `specs/imported/*.md`
- phase boundary contradictions are documented

## Phase 1: TypeScript Project Skeleton

Goal: create the smallest CLI-first TypeScript project that can be installed,
typechecked, tested, and linted with pnpm.

Deliverables:

- `package.json`
- `tsconfig.json`
- `vitest.config.ts`
- `.gitignore`
- `src/` module layout
- `tests/` coverage for the first slice

Validation:

- `pnpm typecheck`
- `pnpm test`
- `pnpm lint`

## Phase 2: Minimal Fake-Agent Vertical Slice

Goal: implement the smallest local run path that exercises domain validation,
agent routing, fake adapter behavior, task runner orchestration, and CLI output.

Deliverables:

- core domain model validators
- `FakeAgentAdapter`
- minimal task runner
- `@agent` prompt parser
- `agent-hub run "@fake <task>"`
- tests for domain model, fake adapter, task runner, and parser

In scope:

- runtime task brief generation inside an isolated temporary run directory
- deterministic fake output written only inside that isolated directory
- event capture and final run status

Out of scope:

- SQLite
- real git worktrees
- real shell verification commands
- CodexAdapter
- ClaudeCodeAdapter
- desktop UI

## Phase 3: Non-Invasive Context Compiler

Status: complete in Night 2.

Goal: build generated context payloads without writing into the target
repository.

Deliverables:

- `ContextCompiler`
- `ContextBundle`
- `ContextSection`
- `ContextSource`
- `MemoryProvider`
- `SkillProvider`
- `ProjectContextProvider`
- `ContextFormatter`
- in-memory/static provider implementations
- markdown formatter
- tests for task-only bundles, project summary, memories, skills, empty
  providers, deterministic ordering, markdown formatting, provider failures,
  and target-repository non-modification

## Phase 4: Fake Task Runner With Storage Abstractions

Status: complete in Night 2, without git worktrees by direct scope.

Goal: coordinate a fake-agent run through context compilation, adapter
selection, in-memory task/run persistence, status transitions, and concise CLI
output.

Deliverables:

- `TaskRunner`
- `TaskRepository`
- `TaskRunRepository`
- `AgentRegistry`
- `RunResult`
- in-memory repositories
- default fake-only agent registry
- `agent-hub run "@fake <task>"`
- `agent-hub tasks list`
- `agent-hub runs list`
- tests for successful fake runs, failed fake runs, missing agents, context
  handoff, task persistence, run persistence, status transitions, and CLI
  parsing/errors

## Phase 5: Workspace / Git Worktree / Diff

Status: complete in Night 3.

Goal: create isolated task workspaces through safe git worktree management and
collect reviewable diff metadata after a fake-agent run.

Deliverables:

- `ShellExecutor` abstraction and Node implementation
- `WorkspaceManager`, `Workspace`, `WorkspaceSession`, `WorkspaceConfig`, and
  `WorkspaceCleanupPolicy`
- `GitWorktreeWorkspaceManager` with safe path validation, dry-run support, and
  cleanup policies
- `DiffCollector` for changed files, diff stat, raw diff, clean worktrees, and
  git failure reporting
- mocked-shell tests for workspace and diff behavior

## Phase 6: Verification + Risk Report

Status: complete in Night 3.

Goal: run configured verification commands inside the isolated workspace and
produce a structured risk report for the run.

Deliverables:

- `VerificationCommand`, `VerificationResult`-style command results,
  `VerificationSuiteResult`, and `VerificationStatus`
- `VerificationRunner` with success, failure, mixed, missing-config, and dry-run
  handling
- `RiskReportGenerator` with changed files, verification summary, failed checks,
  risk factors, manual review checklist, and acceptance recommendation
- Task runner integration for fake-agent runs only
- CLI summaries plus `runs show` and `risks show`

## Recommended Next Phase

Night 4 should add durable local persistence for runs, run metadata, verification
results, diffs, and risk reports before adding real Codex or Claude Code
adapters. SQLite should be introduced behind repository abstractions while
keeping the current fake-agent worktree pipeline as the regression contract.
