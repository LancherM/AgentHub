# Roadmap

## Phase 1: Repository Skeleton

Goal: establish the CLI-first monorepo and local package boundaries.

Build:

- workspace configuration
- TypeScript configuration
- CLI package
- core package
- database package
- context compiler package
- task runner package
- agent adapter package
- safety package placeholder
- shared package
- baseline tests

Acceptance criteria:

- install succeeds
- typecheck succeeds
- test runner starts
- CLI help prints
- package dependencies follow the architecture direction

## Phase 2: Core Domain And SQLite

Goal: stabilize the local data model.

Build:

- domain schemas and types
- SQLite schema
- project repository operations
- task repository operations
- task run repository operations
- run event persistence
- verification result persistence
- task history query

Acceptance criteria:

- projects can be added and listed
- tasks can be created and listed
- task history includes runs, events, artifacts, verification results, and risk reports
- database tests use temporary files
- no secrets are stored by design

## Phase 3: Context Store And Task Briefs

Goal: support non-invasive context compilation.

Build:

- external context store initialization
- repo-local context store initialization as opt-in
- context store inspection
- context pack generation
- task brief generation
- approved memory inclusion
- skill reference inclusion
- repository export dry-run
- repository export write mode with managed blocks

Acceptance criteria:

- default context build does not write repository-level agent files
- repo export requires an explicit command
- export preview shows intended changes
- user-authored content outside managed blocks is preserved
- optional missing context files become warnings

## Phase 4: Worktree Task Runner With Fake Agent

Goal: execute a full local task run without external agents.

Build:

- git repo validation
- worktree creation
- runtime context writing
- fake adapter
- verification command runner
- diff collector
- structured run result

Acceptance criteria:

- every run uses an isolated worktree
- original checkout remains unchanged
- fake agent writes only inside the worktree
- verification results are captured
- diffs include tracked and untracked changes
- missing verification commands produce a warning

## Phase 5: Real Agent Adapters

Goal: add real coding-agent execution behind the shared adapter contract.

Build:

- Codex-compatible adapter
- Claude Code-compatible adapter
- adapter detection
- stdin task brief injection
- event stream mapping
- spawn error handling
- non-zero exit handling
- mocked process tests

Acceptance criteria:

- adapters run with the worktree as current directory
- adapters consume generated task brief content
- adapters do not require repository-level context files in default mode
- unsafe bypass flags are absent
- unavailable agents produce clear messages

## Phase 6: Registered Runs And CLI Polish

Goal: connect CLI task runs to persisted task history.

Build:

- registered task run command
- ad hoc task run command
- run row creation and finalization
- event persistence
- verification persistence
- diff artifact persistence
- concise normal output
- opt-in debug output
- interactive CLI task execution

Acceptance criteria:

- registered runs are visible in task history
- failed runs remain inspectable
- debug mode prints details without changing behavior
- interactive mode uses the same task runner as command mode

## Phase 7: Safety And Risk Reports

Goal: make review safer before user acceptance.

Build:

- sensitive path scanner
- dangerous command scanner
- diff scanner
- risk level aggregation
- risk report persistence
- CLI risk summary

Acceptance criteria:

- sensitive file changes are flagged
- dangerous commands are flagged
- blocking risk is clearly surfaced
- risk reports are stored with task runs
- safety scanner has unit tests

## Phase 8: Memory Workflow

Goal: make long-term memory explicit and user-approved.

Build:

- memory proposal creation
- memory listing
- memory approval
- memory rejection
- approved-memory writeback to context store
- context pack inclusion of approved memory only

Acceptance criteria:

- proposed memory is never injected as approved memory
- approved memory appears in future context packs
- rejected memory is ignored
- user action is required for approval

## Phase 9: Comparison Reports

Goal: help users compare multiple agent outputs.

Build:

- run selection
- changed-file comparison
- verification comparison
- risk comparison
- summary generation
- persisted comparison reports
- CLI compare command

Acceptance criteria:

- comparison report can be generated for two task runs
- report references verification and risk differences
- report does not merge or accept changes

## Phase 10: Desktop Shell

Goal: add a graphical shell after CLI and core are stable.

Build:

- local desktop app shell
- project list view
- task list view
- run details view
- log view
- diff view
- verification and risk view
- memory approval view
- settings view

Acceptance criteria:

- desktop calls the same local core
- desktop does not introduce a server requirement
- desktop does not duplicate task orchestration
- CLI remains fully functional without desktop
