# CLI Specification

## General

The executable is assumed to be named `agent-hub`.

Global behavior:

- no subcommand starts interactive mode
- command mode is scriptable
- `--db <path>` may select a local database file
- `--debug` expands output for supported run commands
- examples use generic placeholder paths and IDs

Expected output should be plain text, stable enough for humans, and avoid leaking secrets.

## Interactive Mode

### Command

```sh
agent-hub
```

Optional flags:

- `--project <path>`
- `--agent <agent-kind>`

### Input Forms

```text
summarize this project
@codex implement the requested change
@claude-code review the current diff
@fake simulate the task
```

### Slash Commands

- `/help`: show interactive help
- `/agents`: list available agents
- `/use <agent-kind>`: set default agent
- `/context`: show context status
- `/context init`: prepare context store
- `/clear`: clear visible session output
- `/exit`: exit
- `/quit`: exit

### Expected Output

Interactive output should show the active workspace, selected agent, context status, task status, streamed agent messages, task brief path, worktree path, run summary, and warnings.

## Project Commands

### Register Project

```sh
agent-hub project add --name sample-project --root /path/to/repository
```

Expected output:

```text
Added project
id: project_...
name: sample-project
root: /path/to/repository
```

### List Projects

```sh
agent-hub project list
```

Expected output:

```text
project_...    sample-project    /path/to/repository
```

If empty:

```text
No projects found.
```

## Context Commands

### Initialize Context Store

```sh
agent-hub context init --project-root /path/to/repository --project-id project_...
```

Optional flags:

- `--mode external`
- `--mode repo_local`
- `--agent-hub-home /path/to/app-data`

Expected output:

```text
Initialized context store
project_root: /path/to/repository
project_id: project_...
mode: external
store_root: /path/to/context-store
```

### Show Context Store

```sh
agent-hub context show --project-root /path/to/repository --project-id project_...
```

Expected output:

```text
Context store
project_root: /path/to/repository
project_id: project_...
mode: external
store_root: /path/to/context-store
files:
  - context/project.md
```

### Build Context Artifacts

```sh
agent-hub context build \
  --project-root /path/to/repository \
  --project-id project_... \
  --task-id task_... \
  --title "Fix failing test" \
  --prompt "Find and fix the failing test"
```

Optional flags:

- `--delivery-mode runtime_injection`
- `--delivery-mode worktree_overlay`

Expected output:

```text
Built context artifacts
project_root: /path/to/repository
project_id: project_...
task_id: task_...
delivery_mode: runtime_injection
context_pack_path: /path/to/context-pack.json
task_brief_path: /path/to/brief.md
```

### Export Context To Repository

```sh
agent-hub context export \
  --project-root /path/to/repository \
  --project-id project_... \
  --target repo \
  --dry-run
```

Write mode:

```sh
agent-hub context export \
  --project-root /path/to/repository \
  --project-id project_... \
  --target repo \
  --write
```

Optional flags:

- `--include-agents-md`
- `--include-claude-md`
- `--include-skills`
- `--include-approved-memory`

Expected output:

```text
Previewed repo context export
project_root: /path/to/repository
project_id: project_...
target: repo
dry_run: true
changed_files:
  - AGENTS.md
warnings:
  - none
```

## Task Commands

### Create Task

```sh
agent-hub task create --project-id project_... --title "Fix failing test"
```

Optional flags:

- `--description <text>`

Expected output:

```text
Created task
id: task_...
project_id: project_...
title: Fix failing test
```

### List Tasks

```sh
agent-hub task list --project-id project_...
```

Expected output:

```text
task_...    open    project_...    Fix failing test
```

If empty:

```text
No tasks found.
```

### Task History

```sh
agent-hub task history --task-id task_...
```

Expected output:

```text
Task task_...
title: Fix failing test
status: open
runs: 1

Run run_...
agent: codex
status: succeeded
events: 3
```

## Run Commands

### Run A Registered Task

```sh
agent-hub run --task task_... --agent codex
```

Supported agents:

- fake
- codex
- claude-code

Optional flags:

- `--delivery-mode runtime_injection`
- `--delivery-mode worktree_overlay`
- `--debug`
- `--verify <command>` repeated for verification commands

Expected output:

```text
Task run completed
task_id: task_...
agent: codex
status: review_ready
context_delivery: runtime_injection
worktree_path: /path/to/worktree
branch_name: agent-hub/task-id/agent
task_brief_path: /path/to/brief.md
diff: changes detected
warnings: none
```

### Run An Ad Hoc Task

```sh
agent-hub run \
  --project /path/to/repository \
  --task-id task_001 \
  --title "Make a documentation update" \
  --prompt "Update the local development notes" \
  --agent fake
```

Expected behavior:

- create an isolated worktree
- inject task context
- run the selected adapter
- run verification commands if provided
- collect diff
- print summary and warnings

### Record A Manual Run Event

```sh
agent-hub run event add --run-id run_... --type stdout --message "example event"
```

Expected output:

```text
Recorded run event
id: event_...
run_id: run_...
sequence: 0
type: stdout
```

## Comparison Commands

### Compare Runs

```sh
agent-hub compare --task-id task_...
```

Expected first rebuild behavior:

```text
compare: not implemented yet
```

Target behavior:

- compare changed files
- compare verification outcomes
- compare risk findings
- summarize tradeoffs
- persist a comparison report

## Memory Commands

### List Memory Items

```sh
agent-hub memory list --project-id project_...
```

Target output:

```text
memory_...    proposed    workflow_rule    Keep task runs isolated.
```

### Approve Memory

```sh
agent-hub memory approve --memory-id memory_...
```

Target output:

```text
Approved memory
id: memory_...
status: approved
```

### Reject Memory

```sh
agent-hub memory reject --memory-id memory_...
```

Target output:

```text
Rejected memory
id: memory_...
status: rejected
```

## Error Output

Errors should be concise:

```text
error: missing required option --task-id
```

Common errors:

- missing required option
- invalid enum value
- project not found
- task not found
- selected agent unavailable
- target path is not a git repository
- worktree path already exists
- verification failed
