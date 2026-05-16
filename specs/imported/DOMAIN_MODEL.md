# Domain Model

## Entities

### Project

A registered local repository.

Fields in prose:

- stable ID
- display name
- absolute root path
- creation timestamp
- update timestamp

Constraints:

- root path is required
- root path should be unique
- project should point to a git repository for task runs

### Agent Profile

A configured agent kind and optional command metadata.

Fields in prose:

- stable ID
- agent kind
- display name
- optional command
- enabled flag
- timestamps

Constraints:

- agent kind must be one of the supported adapter kinds
- disabled profiles should not be selected by default

### Task

A user request associated with a project.

Fields in prose:

- stable ID
- project ID
- title
- optional description or prompt
- status
- timestamps

### Task Run

One attempt to execute a task with a specific agent.

Fields in prose:

- stable ID
- task ID
- optional agent profile ID
- agent kind
- run status
- worktree path
- branch name
- start and completion timestamps
- timestamps

### Run Event

An ordered event emitted during a task run.

Fields in prose:

- stable ID
- task run ID
- sequence number
- event type
- message
- metadata
- creation timestamp

### Run Artifact

An artifact collected after or during a run.

Fields in prose:

- stable ID
- task run ID
- artifact kind
- content
- metadata
- creation timestamp

### Verification Result

The result of one verification command.

Fields in prose:

- stable ID
- task run ID
- command text
- status
- optional exit code
- optional stdout
- optional stderr
- start and completion timestamps
- creation timestamp

### Comparison Report

A report comparing two or more task runs for one task.

Fields in prose:

- stable ID
- task ID
- optional baseline run ID
- optional candidate run ID
- summary
- creation timestamp

### Memory Item

A proposed or approved memory entry.

Fields in prose:

- stable ID
- project ID
- optional task ID
- category
- status
- content
- timestamps

### Risk Report

A structured safety assessment for a task run.

Fields in prose:

- stable ID
- task run ID
- risk level
- summary
- findings
- creation timestamp

### Skill

A reusable workflow instruction known to Agent Hub.

Fields in prose:

- stable ID
- optional project ID
- name
- description
- path in the context store
- timestamps

### Context Pack

A task-specific bundle of selected context.

Fields in prose:

- stable ID
- project ID
- task ID
- optional task title
- optional task prompt
- delivery mode
- context sections
- approved memory sections
- skill references
- creation timestamp

### Task Brief

A generated instruction document for one agent run.

Fields in prose:

- task ID
- task title
- task prompt
- rendered content
- context pack ID
- creation timestamp

## Value Objects

### Agent Kind

Supported values:

- fake
- codex
- claude-code

### Context Delivery Mode

Supported values:

- runtime injection
- worktree overlay
- repository export

Repository export is not valid for task runs.

### Context Store Mode

Supported values:

- external store
- repository-local store

External store is the default assumption.

### Task Status

Typical values:

- open
- running
- completed
- cancelled

### Task Run Status

Typical values:

- queued
- running
- succeeded
- failed
- cancelled

### Run Event Type

Typical values:

- stdout
- stderr
- message
- status
- error

### Verification Status

Typical values:

- passed
- failed
- skipped

### Memory Category

Typical values:

- project fact
- workflow rule
- user preference
- temporary note

### Memory Status

Typical values:

- proposed
- approved
- rejected

### Risk Level

Typical values:

- low
- medium
- high
- blocking

## State Transitions

### Task

```text
open -> running -> completed
open -> cancelled
running -> completed
running -> cancelled
```

Assumption: failed task runs do not necessarily fail or close the parent task.

### Task Run

```text
queued -> running -> succeeded
queued -> running -> failed
queued -> cancelled
running -> cancelled
```

### Memory Item

```text
proposed -> approved
proposed -> rejected
```

Approved memory can be injected into future task briefs. Rejected memory is ignored.

### Context Delivery

```text
runtime injection -> no repository writes
worktree overlay -> generated files only inside task worktree
repository export -> explicit preview and write operation
```

### Risk Handling

```text
scan -> findings -> risk report -> user review
```

Blocking risk must prevent automatic acceptance. Since automatic acceptance is not a product goal, blocking risk should at minimum be surfaced prominently.

## Important Constraints

- Agent runs must happen inside isolated worktrees.
- Original project checkouts must not be modified by normal task runs.
- Repository context export must be explicit and previewable.
- Agent Hub must not store secrets in SQLite.
- Agent Hub must not intentionally read credential files.
- Agent Hub must not automatically merge, push, or open remote changes.
- Memory must not become approved without user action.
- CLI and desktop must share the same local core.
