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

SQLite persistence, CodexAdapter, ClaudeCodeAdapter, comparison reports, memory
workflows, and desktop UI are deferred.

Night 3 introduces safe shell execution boundaries, git worktree workspace
management, diff collection, verification command execution, and structured
risk report generation. These capabilities are wired only through the fake
adapter run path.

## Hard Constraints For This Slice

- Do not implement `CodexAdapter`.
- Do not implement `ClaudeCodeAdapter`.
- Do not run shell commands outside the `ShellExecutor` abstraction.
- Do not execute shell commands derived directly from task prompts.
- Keep real agent execution deferred.
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

It parses the `@fake` route, creates an isolated git worktree under the
configured workspace base, writes generated runtime files only inside that
worktree, runs the deterministic fake adapter, collects git diff metadata, runs
configured verification commands, generates a structured risk report, captures
adapter events, cleans up according to the workspace cleanup policy, and prints
a concise run summary.

Codex and Claude Code remain unsupported by the runner in this rebuild slice.

## Night 2 Phase Boundary

Night 2 adds Phase 3 and Phase 4 behavior under the direct instruction to keep
git worktrees and real shell execution deferred.

Phase 3 implements a non-invasive `ContextCompiler`. It creates a generated
`ContextBundle` and markdown payload from task, agent, repository, project,
memory, skill, constraint, and hint inputs. It does not write to the target
repository and does not modify `AGENTS.md`, `CLAUDE.md`, `README.md`, or other
project files.

Phase 4 implements a fake-agent task runner pipeline with in-memory task and
task-run repositories. The runner compiles context, selects an adapter through
an agent registry, passes the compiled context to `FakeAgentAdapter`, records
status transitions, and returns a structured result.

Storage is intentionally in-memory for this phase. SQLite remains deferred.
Night 3 replaces the isolated temporary run directory with a safe
`GitWorktreeWorkspaceManager` for the default runner path.

## Night 3 Phase Boundary

Night 3 adds Phase 5 and Phase 6 behavior without introducing real Codex or
Claude Code execution.

Phase 5 implements `ShellExecutor`, `GitWorktreeWorkspaceManager`, and
`DiffCollector`. Git worktree and diff commands run through the shell
abstraction with explicit `cwd`, captured stdout/stderr/exit code/duration, path
validation, dry-run support, and cleanup policies.

Phase 6 implements `VerificationRunner` and `RiskReportGenerator`. Verification
commands are configured explicitly, run inside the workspace cwd, and are never
derived from task prompts. Risk reports summarize changed files, verification,
failed checks, risk factors, manual review checklist, and acceptance
recommendation.
