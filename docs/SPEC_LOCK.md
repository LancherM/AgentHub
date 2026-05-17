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

All three adapters are implemented. `fake` is deterministic and always
available. `codex` and `claude-code` are process-backed adapters that run only
inside the isolated worktree and report unavailable status when their external
CLIs cannot be detected.

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

## Current Baseline Status

The repository has moved beyond the original fake-only rebuild slice. The
current baseline includes the root TypeScript package, domain models, SQLite
repositories, context store init/show/build/export, git worktree task runs,
fake/Codex/Claude Code adapters, verification, diff collection, safety
scanning, risk report persistence, memory workflows, comparison reports,
interactive CLI mode, and manual run-event recording.

The current physical layout is still a single root package with module
boundaries under `src/`. The imported `apps/` and `packages/` monorepo layout
remains a target architecture, not the current filesystem shape.

Still deferred:

- Desktop app.
- Physical monorepo package split.
- Automatic memory proposal generation from completed runs.
- Richer comparison scoring beyond the current persisted textual summary.

## Hard Constraints For This Slice

- Do not add desktop UI.
- Do not restructure into `apps/` and `packages/`.
- Do not introduce cloud, account, backend, login, team, automatic merge,
  automatic push, or automatic pull request behavior.
- Do not run shell commands outside the `ShellExecutor` or `ProcessRunner`
  boundaries.
- Do not execute shell commands derived directly from task prompts.
- Keep all real agent execution inside isolated task worktrees.
- Do not delete files outside this repository.
- Do not modify files outside this repository.
- Do not introduce heavy frameworks without documenting why.
- Keep commits small and reviewable.

## Minimal Run Behavior

The implemented run commands include:

```sh
agent-hub run --task <task-id> --agent fake|codex|claude-code
agent-hub run "@fake|@codex|@claude-code <task>"
agent-hub run event add --run-id <run-id> --type <type> --message <message>
```

Task runs create an isolated git worktree under the configured workspace base,
write generated runtime files only inside that worktree, run the selected
adapter, collect git diff metadata, run configured verification commands,
generate a structured risk report, capture adapter events, persist run data,
clean up according to the workspace cleanup policy, and print a concise run
summary. The run summary includes `context_delivery` and `branch_name` along
with worktree path, task brief path, verification summary, risk level, retained
workspace, warnings, and event count.

Manual event recording validates the run, validates the event type, appends a
`run_events` row through `RunEventRepository`, and preserves event ordering by
using the next sequence number after existing events for the run.

## Historical Phase Notes

The Night 2 and Night 3 sections below are retained as historical reports. Their
deferred-gap lists describe earlier rebuild boundaries and must not be read as
the current implementation status.

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
