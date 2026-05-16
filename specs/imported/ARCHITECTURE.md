# Architecture

## High-Level Architecture

Agent Hub is a local-first monorepo with a CLI entry point, local core packages, agent adapters, a task runner, and local persistence.

Target shape:

```text
CLI
  -> local core services
  -> context compiler
  -> task runner
  -> agent adapters
  -> external agent CLIs

Desktop shell
  -> local core services
  -> task runner
  -> agent adapters
```

The CLI is the primary interface. The desktop app, when added, must call the same local core and must not duplicate orchestration logic.

## Context Delivery

The default delivery mode is runtime injection. Agent Hub builds a task-specific task brief and context pack, then supplies them to the selected adapter using stdin, prompt files, command arguments, SDK options, or another adapter-specific mechanism.

Supported delivery modes:

- `runtime_injection`: default. Context is injected during the run without writing repository-level agent files.
- `worktree_overlay`: optional. Generated context files are materialized only inside the isolated worktree.
- `repo_export`: explicit user action. Context can be exported into the repository only after preview and user confirmation.

The original project checkout must not receive generated agent context files during normal task runs.

## Module Boundaries

### CLI Module

Owns argument parsing, interactive console input, output formatting, debug rendering, and command dispatch. It should call package APIs rather than implement orchestration itself.

### Core Domain Module

Owns validated domain entities, state enums, and shared domain contracts.

### Database Module

Owns local SQLite schema, migrations, and repository methods. It should expose typed operations rather than raw SQL to higher layers.

### Context Compiler Module

Owns context store discovery, context pack generation, task brief generation, optional worktree overlay materialization plans, and explicit repository export behavior.

### Task Runner Module

Owns git repository validation, worktree creation, runtime context writing, adapter execution, verification command execution, diff collection, and run summary construction.

### Agent Adapter Module

Owns common adapter contracts and implementations for supported agents. Adapters translate Agent Hub run input into concrete external agent process behavior.

### Safety Module

Owns dangerous command detection, sensitive path detection, diff scanning, and risk report generation. Early rebuild phases may start with types and expand into scanners.

### Shared Module

Owns small shared constants and types that are safe for any package to import.

## Dependency Direction

Allowed direction:

```text
apps
  -> packages

task runner
  -> context compiler
  -> core
  -> shared

task runner
  -> agent adapters

database
  -> core
  -> shared

CLI
  -> database
  -> context compiler
  -> task runner
  -> agent adapters
```

Avoid reverse dependencies:

- packages must not import from CLI or desktop apps
- core must not import from persistence, task runner, or adapters
- adapter implementations must not depend on CLI rendering
- desktop UI must not own task orchestration

## Extension Points

### Agent Adapters

Add new agents by implementing the adapter contract:

- detection
- display name and kind
- async event stream
- worktree-scoped execution
- clear exit status

### Context Store Modes

The default store is outside the user repository. A repo-local store may be supported as an explicit opt-in mode.

### Context Delivery Modes

New delivery modes may be added only if they preserve original checkout safety and make repository writes explicit.

### Verification Providers

Verification starts with shell commands executed in the worktree. Future providers can add structured test runners, lint runners, or language-specific adapters.

### Safety Scanners

Risk scanning can expand through independent scanners for sensitive paths, dangerous commands, large deletions, binary changes, generated files, and unusual permission changes.

### Report Generators

Risk reports, comparison reports, and memory proposals should be generated from persisted run data and artifacts, not from UI state.
