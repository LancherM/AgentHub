# Product

## Product Positioning

Agent Hub is a local-first developer tool for coordinating coding agents from a command-line interface first, with a desktop shell planned as a later presentation layer.

It acts as a local control plane for:

- registering local projects
- creating task briefs
- compiling reusable project context
- running coding agents in isolated git worktrees
- capturing run logs, verification output, diffs, risks, and comparison material
- managing proposed and approved memory with human approval

The product is not a hosted service. It should work on a developer machine without accounts, remote execution, cloud storage, or a browser-only dashboard.

Assumption: the rebuild should preserve the CLI-first product shape and local persistence model, but does not need to reproduce exact implementation details from the original project.

## Target Users

Primary users:

- individual software engineers who use coding agents on local repositories
- developers who want reusable project context across agent runs
- developers who want agent output isolated from their original checkout
- developers who want repeatable task history, verification records, and diffs
- developers comparing multiple agent outputs before deciding what to keep

Secondary users:

- tool builders experimenting with new agent adapters
- developers who want a desktop view over local task runs after the CLI is stable

Out of scope for the first rebuild:

- teams
- non-technical users
- hosted usage
- account-based workflows
- remote workers

## Core Workflows

### Register A Project

A user registers a local git repository with a friendly project name. Agent Hub stores the project path and metadata in local persistence.

### Prepare Project Context

A user initializes or updates a local context store owned by Agent Hub. The context store may contain project notes, architecture notes, conventions, testing guidance, security notes, approved memory, and skills.

Default behavior must not write agent context files into the user's repository.

### Build A Task Context Pack

For a specific task, Agent Hub compiles a task-specific context pack and a task brief. The pack includes selected context sections, approved memory, and skill summaries.

### Run A Task

Agent Hub creates an isolated git worktree, injects the task brief and context at runtime, runs the selected agent inside the worktree, streams run events, runs verification commands, and collects the resulting diff.

The original project checkout must remain untouched by the agent run.

### Review Results

The user reviews:

- agent messages
- stdout and stderr
- verification results
- diff summary and diff content
- warnings
- risk findings when implemented

Agent Hub never merges, pushes, or accepts changes automatically.

### Compare Agent Runs

For the same task, multiple agent runs can be compared by diff size, changed files, verification result, risk level, and qualitative summary.

Assumption: comparison report generation is part of the intended product but may be implemented after the first working task-run slice.

### Manage Memory

Agent Hub may propose memory items from completed work. The user must approve or reject each item. Only approved memory can be injected into future task briefs.

## Non-Goals

Agent Hub must not become:

- a cloud service
- a hosted task runner
- a multi-user collaboration product
- an account system
- a billing product
- a browser-only application
- a remote job queue
- an automatic pull request creator
- an automatic merge tool
- an automatic push tool
- an agent marketplace
- a secret manager
- a repository rewriting tool

The first rebuild should avoid large UI work until the CLI and local core are stable.
