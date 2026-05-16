# Modules

## CLI

### Responsibility

The CLI is the primary user interface. It supports scriptable commands and an interactive console.

It handles:

- parsing commands and flags
- resolving project and task inputs
- selecting an agent
- rendering normal and debug output
- persisting run boundaries for registered tasks
- calling lower-level modules

### Public Interfaces In Prose

The CLI exposes commands for project registration, context store management, context build/export, task creation/listing/history, task runs, manual run events, comparison placeholders, and memory placeholders.

Interactive mode accepts natural language task prompts, optional `@agent` routing, and slash commands for help, agent selection, context status, context initialization, clearing the screen, and exit.

### Important Invariants

- CLI must remain usable without the desktop app.
- CLI must not contain core orchestration logic.
- Debug output must not change run behavior.
- Interactive mode must call the same task runner as command mode.

### Failure Modes

- missing required arguments
- unknown command
- unavailable selected agent
- project not found
- task not found
- invalid context delivery mode
- database open failure

## Core Domain

### Responsibility

Core defines validated domain entities, value types, enums, and aggregate result shapes.

### Public Interfaces In Prose

Core exposes models for projects, agent profiles, tasks, task runs, run events, run artifacts, verification results, comparison reports, memory items, risk reports, skills, settings, context packs, and task briefs.

### Important Invariants

- IDs must be non-empty.
- Required timestamps use ISO-style strings.
- State fields must use known enum values.
- Memory can only affect future tasks after approval.

### Failure Modes

- invalid input shape
- missing required fields
- unsupported enum value
- invalid timestamp

## Database

### Responsibility

The database module owns local SQLite persistence and repository-style operations.

### Public Interfaces In Prose

It opens the local database, initializes schema if needed, creates and lists projects, creates and lists tasks, creates and updates task runs, records run events and artifacts, records verification results, records risk reports, and reads task history.

### Important Invariants

- foreign keys must be enabled
- project root paths should be unique
- run event sequence must be unique per run
- deleting a project should remove dependent task data
- JSON metadata must remain parseable

### Failure Modes

- database file cannot be created
- unique constraint violation
- foreign key violation
- JSON serialization or parsing failure
- migration failure

## Context Compiler

### Responsibility

The context compiler turns canonical project context into task-specific context packs and task briefs.

It also handles explicit repository export with managed blocks and optional worktree overlay file plans.

### Public Interfaces In Prose

It exposes operations to initialize a context store, show context store contents, build a context pack, build a task brief, build worktree overlay files, and export repository context with dry-run preview or write mode.

### Important Invariants

- runtime injection is the default
- normal task runs must not write context files into the original repository
- repo export requires explicit action and preview support
- managed exports preserve user-authored content outside managed blocks
- markers inside fenced documentation examples must not be treated as live managed regions

### Failure Modes

- missing optional context files, reported as warnings
- malformed skill metadata, reported as warnings or skipped input
- unable to write context artifacts
- conflicting export options
- unsafe export target

## Task Runner

### Responsibility

The task runner owns end-to-end execution of a task run.

It validates the project repository, creates a worktree, builds runtime context, runs the adapter, runs verification, collects diffs, and returns a structured result.

### Public Interfaces In Prose

It exposes a `run task` operation plus focused helper operations for git validation, worktree creation, runtime context writing, verification command execution, worktree inspection, and diff collection.

### Important Invariants

- every agent run must happen in an isolated worktree
- the original project checkout must not be modified by the run
- repository export is not a task-run delivery mode
- generated runtime files should not hide user or agent modifications
- worktree paths and branch names should be deterministic and sanitized
- automatic merge, push, and cleanup are forbidden

### Failure Modes

- target path is not a git repository
- worktree path already exists
- branch already exists
- runtime directory is unsafe
- adapter exits non-zero
- verification command fails or times out
- diff collection fails

## Agent Adapters

### Responsibility

Agent adapters provide a common interface for running different coding agents.

### Public Interfaces In Prose

Each adapter can detect availability and run with a standard input object containing project root, worktree path, task brief path, optional context pack path, task metadata, and environment overrides. The run returns an async stream of stdout, stderr, agent messages, tool calls, system events, errors, and exit information.

### Important Invariants

- adapters run inside the worktree
- adapters receive generated runtime context without requiring repository-level context files
- adapters stream events incrementally
- adapters must not bypass sandboxing or permissions with unsafe flags

### Failure Modes

- external CLI not installed
- external CLI not authenticated
- task brief missing
- task brief outside worktree
- child process spawn failure
- malformed event stream
- non-zero exit

## Safety

### Responsibility

Safety detects risky output before the user accepts an agent result.

### Public Interfaces In Prose

The safety module should expose scanners that accept commands, paths, diffs, or run artifacts and return structured findings with risk levels.

### Important Invariants

- sensitive file changes must be flagged
- dangerous commands must be flagged
- blocking risk must prevent automatic acceptance
- scanners should be deterministic and testable

### Failure Modes

- scanner misses a risky pattern
- scanner creates excessive false positives
- diff is too large to inspect fully
- binary content cannot be inspected safely

## Desktop Shell

### Responsibility

The desktop shell is a future graphical interface over the same local core.

### Public Interfaces In Prose

It should display projects, tasks, run details, logs, diffs, verification results, comparison reports, memory approval, and settings.

### Important Invariants

- desktop must not duplicate orchestration logic
- desktop must call local APIs only
- desktop must not introduce cloud requirements

### Failure Modes

- local core invocation failure
- database access failure
- stale view of run status
- rendering large logs or diffs inefficiently
