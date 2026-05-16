# Test Plan

## Unit Tests

### Core Domain

Cover:

- valid entity parsing
- required fields
- enum validation
- timestamp validation
- task status values
- run status values
- memory category and status values
- risk level values

Acceptance:

- invalid domain objects fail deterministically
- valid domain objects preserve input data

### Context Compiler

Cover:

- external context store resolution
- repo-local context store resolution
- missing optional context files become warnings
- context pack creation
- task brief creation
- skill summary extraction
- approved memory inclusion
- proposed or rejected memory exclusion
- managed block insertion
- managed block replacement
- fenced marker examples ignored
- dry-run repository export
- write-mode repository export

Acceptance:

- default build mode does not write repository-level agent files
- repository export preserves user content outside managed blocks

### Task Runner Helpers

Cover:

- git repository validation
- non-git path rejection
- dirty checkout detection
- worktree path generation
- branch name generation
- existing branch rejection
- existing worktree path rejection
- runtime context writing
- worktree overlay writing
- symlink rejection for runtime artifact paths
- diff collection for tracked files
- diff collection for untracked files
- binary diff preservation
- generated overlay diff exclusion rules

Acceptance:

- original checkout stays unchanged
- generated files are not hidden if modified by the agent

### Safety

Cover:

- sensitive path detection
- dangerous command detection
- large deletion detection
- binary file finding
- risk level aggregation

Acceptance:

- blocking patterns produce blocking findings
- safe diffs do not produce high-severity false positives

## Integration Tests

### Database

Use temporary SQLite databases.

Cover:

- schema initialization
- project creation and listing
- duplicate project root rejection
- task creation and listing
- task run creation and update
- run event sequence persistence
- artifact persistence
- verification result persistence
- risk report persistence
- task history aggregation
- cascade delete behavior
- JSON metadata round trip

Acceptance:

- no test uses a persistent user database
- database handles are closed after tests

### Task Run With Fake Agent

Use a temporary git repository.

Cover:

- create worktree
- build context pack
- write runtime task brief
- run fake adapter
- run verification command
- collect diff
- produce review-ready result

Acceptance:

- fake output is written only inside the worktree
- original repository is unchanged
- run result includes events, verification results, diff, status, and warnings

### Worktree Overlay Mode

Use a temporary git repository.

Cover:

- generated overlay files appear only in the worktree
- overlay files are excluded from diff when unchanged
- overlay files are included when modified by the agent
- existing non-empty skill file conflicts are warned and not overwritten

Acceptance:

- overlay mode never modifies the original checkout

### Registered Task Run

Use temporary database and temporary git repository.

Cover:

- registered project lookup
- task lookup
- task run row creation
- task run finalization
- event persistence
- verification persistence
- diff artifact persistence
- failure finalization on thrown error

Acceptance:

- failed runs still leave inspectable persisted records

## CLI Tests

### Command Smoke Tests

Cover:

- help output
- unknown command
- missing required option
- project add
- project list
- context init
- context show
- context build
- context export dry-run
- task create
- task list
- task history
- run with fake agent
- run event add
- compare placeholder
- memory placeholder commands

Acceptance:

- commands return expected exit codes
- output is concise and stable

### Interactive CLI Tests

Cover:

- parsing plain task prompt
- parsing `@agent` prompt
- `/help`
- `/agents`
- `/use`
- `/context`
- `/context init`
- `/clear`
- `/exit`
- `/quit`
- invalid slash command
- task execution path calls the task runner

Acceptance:

- interactive mode remains a shell over core services
- no orchestration logic is duplicated in tests through UI-only behavior

### Debug Output Tests

Cover:

- normal run output omits verbose details
- `--debug` prints run input boundaries
- environment variable debug mode works if supported
- verification stdout and stderr render only in debug mode
- diff text is truncated if necessary

Acceptance:

- debug mode does not alter run result

## Mocked Shell Execution Tests

### Adapter Process Tests

Mock child process spawning.

Cover:

- adapter detection success
- adapter detection command missing
- adapter detection non-zero exit
- spawn uses worktree as current directory
- task brief is passed through stdin
- stdin is closed
- stdout is streamed
- stderr is streamed
- structured output is parsed when valid
- malformed structured output is preserved safely
- non-zero exit is emitted
- signal exit is emitted
- unsafe flags are absent

Acceptance:

- tests do not require real external agent CLIs
- tests assert worktree-scoped execution

### Verification Command Tests

Mock or use simple local commands in temporary directories.

Cover:

- passed command
- failed command
- timeout
- stdout capture
- stderr capture
- signal capture
- working directory is worktree

Acceptance:

- failed verification fails the task run status
- captured output is available for debug rendering

## Manual Verification

Before considering a rebuild phase complete, run the relevant commands:

```sh
pnpm typecheck
pnpm test
pnpm lint
```

If the full suite is too expensive, run targeted package tests and document what was skipped.
