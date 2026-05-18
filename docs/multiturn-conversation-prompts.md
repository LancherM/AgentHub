# Multi-Turn Conversation Implementation Prompts

This document breaks the real multi-turn conversation work into small,
verifiable implementation prompts. It is a planning artifact only; do not treat
the phases below as implemented behavior until the corresponding code, tests,
and documentation updates land.

## Target Outcome

Agent Hub should own conversation continuity locally. A user can keep sending
messages in one thread, and each new agent run receives a bounded conversation
context built from the current turn, the thread history, and the project-level
context store.

The target model separates durable concepts:

- `Thread`: conversation metadata and project binding.
- `Message`: ordered user, assistant, system, and run-card messages.
- `TaskRun`: execution record, events, verification, diff, risk, and artifacts.
- `RunContextSnapshot`: the exact context pack and conversation brief injected
  into one run.

Do not rely on Codex or Claude Code remote/session thread state for the product
contract. The canonical conversation transcript belongs to Agent Hub's local
SQLite database.

## Context Layers

Use the following precedence when building context for a run:

```text
Current turn
> Thread context
> Project context and approved memory
> Imported specs and repository docs
> Generic Agent Hub defaults
```

Layer responsibilities:

- Project context: stable project facts, architecture, conventions, testing,
  security notes, approved memory, and skills from the Agent Hub-owned context
  store.
- Thread context: the local conversation goal, recent messages, summarized
  decisions, open items, failed attempts, and prior assistant outputs for this
  thread only.
- Turn context: the current user message, selected agents, context mode,
  delivery mode, and any new constraints stated in the current turn.
- Run context: a derived, persisted snapshot of what Agent Hub injected into
  one agent run. This is audit evidence, not the durable source of truth.

Thread context must not automatically promote into project context or approved
memory. Promotion still requires explicit user approval.

## Global Constraints

Every phase must preserve these boundaries:

- Keep Agent Hub local-first and CLI-first.
- Keep desktop as a shell over shared local packages and Electron main-process
  services.
- Do not add cloud sync, login, remote execution, hosted dashboards, or a web
  API server.
- Do not write `AGENTS.md`, `CLAUDE.md`, `.claude/skills`, or `.agents/skills`
  to user repositories by default.
- Do not merge, push, or accept agent output automatically.
- Preserve isolated git worktree execution for runs.
- Persist run events, diffs, verification, risk, and review evidence on the
  run model rather than bloating message rows.
- Bound all conversation injection by message count and character budget.
- Update `docs/product.md` and `docs/architecture.md` in every implementation
  phase that changes behavior or boundaries.

## Phase 0 Prompt: Current-State Audit

Goal: produce a source-level audit before editing so the implementation starts
from the live code rather than stale docs.

Prompt:

```text
Audit the current Agent Hub conversation implementation without editing files.

Inspect apps/desktop/electron/services/thread-service.ts,
apps/desktop/src/App.tsx, apps/cli/src/cli.ts, packages/core, packages/db,
packages/context-compiler, packages/task-runner, tests, docs/product.md, and
docs/architecture.md.

Report:
- where threads and messages are currently modeled
- where state is in-memory only
- where runs are created from a desktop message
- where CLI interactive mode starts a fresh run per line
- what existing repository interfaces and SQLite migration patterns should be
  reused
- the smallest safe implementation order for persisted multi-turn support

Do not implement code in this phase.
Use only concrete file paths and observed code evidence.
```

Acceptance:

- The audit identifies the current in-memory desktop thread boundary.
- The audit identifies the current stateless CLI interactive behavior.
- The audit lists exact files to change in Phase 1.

## Phase 1 Prompt: Core Thread And Message Persistence

Goal: add durable thread/message storage without changing runtime injection yet.

Prompt:

```text
Implement persistent Agent Hub conversation threads and messages.

Scope:
- Add Thread and Message domain types in packages/core.
- Add repository interfaces for ThreadRepository and MessageRepository.
- Add in-memory repository implementations for tests.
- Add SQLite migration tables in packages/db:
  - conversation_threads
  - conversation_messages
- Add SQLite repository implementations.
- Add tests for validation, ordering, persistence across repository instances,
  and uniqueness constraints.

Suggested fields:
- thread: id, projectId, title, createdAt, updatedAt, archivedAt optional,
  metadata optional.
- message: id, threadId, sequence, role, kind, content, agentId optional,
  runId optional, status optional, metadata optional, createdAt.

Roles should cover user, assistant, system, and tool/run-card style records.
Keep run events, diffs, verification, risk, and logs in the existing run
repositories, not in message content.

Do not change desktop UI behavior beyond switching services to the new
repositories if that is needed for tests. Do not add context injection yet.
Update docs/product.md and docs/architecture.md to describe the persisted
thread/message storage boundary.
```

Acceptance:

- Threads and messages survive SQLite repository re-instantiation.
- Messages list in deterministic `threadId + sequence` order.
- A message can reference a run id without duplicating run evidence.
- Existing tests still pass.

## Phase 2 Prompt: Desktop Thread Service Over Repositories

Goal: make desktop thread orchestration use durable repositories instead of an
in-memory Map.

Prompt:

```text
Refactor the desktop ThreadService to use the core thread/message repositories.

Scope:
- Replace the in-memory thread/message Map in
  apps/desktop/electron/services/thread-service.ts with repository-backed
  reads and writes.
- Keep the renderer contract through window.agentHub.threads.* stable.
- Preserve createThread, listThreads, getThread, and sendMessage behavior.
- On sendMessage:
  - append one user message to the selected thread
  - create one run per selected agent through RunService
  - append one run-card or assistant placeholder message per run
- Keep existing run status refresh behavior, but derive display status from
  run ids rather than storing live-only state.
- Keep old persisted runs inspectable. If legacy run synthesis is still needed,
  make it a compatibility import/fallback instead of the primary store.

Do not yet inject prior messages into agent runs. This phase is persistence and
service-boundary work only.
Update desktop service tests and docs.
```

Acceptance:

- Sending two messages in one desktop thread creates one durable thread with
  two user messages and the matching run-card messages.
- Restarting/recreating services over the same SQLite database preserves the
  thread and ordered messages.
- Existing run inspector and run event subscriptions still work.

## Phase 3 Prompt: Conversation Context Builder

Goal: build bounded thread context and inject it into each run.

Prompt:

```text
Add a ConversationContextBuilder and wire it into desktop sendMessage.

Scope:
- Build a package-level service, preferably outside the renderer, that can
  assemble:
  - current turn context
  - recent thread messages
  - compact prior assistant output summaries
  - project context references
  - explicit token/character budget metadata
- Use deterministic truncation rules:
  - max recent messages
  - max total characters
  - max per-message characters
  - omit debug/lifecycle run events
- Produce a conversation brief that can be included in TaskRunner/context
  compiler input.
- Persist the generated conversation brief as a run artifact so review can show
  exactly what was injected.

Inject conversation context through runtime_injection by default. Do not write
conversation files to the original project checkout. Worktree overlay may
materialize only inside the isolated run worktree if that delivery mode is
selected.
```

Acceptance:

- The second message in a thread creates a run whose persisted context snapshot
  includes the first user message and the prior assistant/run summary.
- The snapshot excludes raw debug lifecycle noise and sensitive run evidence.
- Character limits are covered by tests.
- `repo_export` remains unavailable as a task-run delivery mode.

## Phase 4 Prompt: Assistant Output Messages

Goal: turn completed run outputs into durable assistant messages that future
turns can use.

Prompt:

```text
Persist agent-facing run output as assistant messages.

Scope:
- Reuse the existing CLI output extraction rules where practical.
- After a run reaches a terminal state, append/update an assistant message for
  that run with:
  - agent id
  - run id
  - terminal status
  - agent-facing final output or concise failure summary
- Do not store full stdout/stderr, raw JSONL lifecycle events, diffs, logs, or
  verification output in the message body.
- Keep full evidence in run_events, run_artifacts, verification results, and
  risk reports.
- For multi-agent turns, write one assistant message per agent/run with stable
  ordering.
- Ensure failed runs contribute a short failure summary to future thread
  context instead of a huge event dump.
```

Acceptance:

- Future turns receive prior assistant answers, not just prior user prompts.
- Failed runs are visible in the transcript and context as compact summaries.
- Multi-agent turns preserve deterministic message order.
- Existing run review evidence remains accessible through the inspector/CLI.

## Phase 5 Prompt: CLI Chat And Thread Resume

Goal: provide a CLI path for real multi-turn conversation without breaking
stateless `agent-hub run`.

Prompt:

```text
Add CLI thread commands while preserving the existing stateless run command.

Scope:
- Add commands:
  - agent-hub threads list
  - agent-hub threads show <thread-id>
  - agent-hub chat
  - agent-hub chat --thread <thread-id>
- In chat mode, maintain a selected thread and send each natural-language line
  through the same thread/message/conversation-context service used by desktop.
- Keep slash commands small and local:
  - /thread new
  - /thread use <id>
  - /threads
  - /history
  - /exit
- Keep `agent-hub run` and the current task-run command behavior stateless.
- Update CLI tests for thread resume and context injection.
```

Acceptance:

- A CLI chat session can send multiple messages to one persistent thread.
- A later CLI process can resume the same thread by id.
- `agent-hub run ...` still creates a single run without requiring a thread.
- Desktop and CLI use the same core repositories and context builder.

## Phase 6 Prompt: Thread Summaries And Local Thread Memory

Goal: add scalable thread-level summaries after the basic transcript path works.

Prompt:

```text
Add conservative thread summaries and thread-local memory.

Scope:
- Add optional persisted thread summary storage or message-derived summary
  artifacts.
- Track decisions, open items, constraints, and last-known user goal for the
  thread.
- Keep thread memory local to the thread; do not promote it into project
  approved memory without explicit user approval.
- Refresh summaries deterministically or through an explicit local summarizer
  flow. Do not call a cloud service or create background remote jobs.
- Make context injection prefer:
  - current turn
  - recent messages
  - thread summary
  - project context
```

Acceptance:

- Long threads remain within context budgets.
- The summary is inspectable and auditable.
- Thread-local decisions do not leak into other threads or project memory.

## Phase 7 Prompt: Continue From Prior Run Worktree

Goal: add code-state continuity as an explicit mode, separate from conversation
continuity.

Prompt:

```text
Design and implement an explicit continue-from-run mode.

Scope:
- Keep the default behavior as conversation continuity only: each run still
  uses an isolated worktree.
- Add an explicit option to continue from a retained run/worktree or fork from
  a message-linked run.
- Preserve review boundaries:
  - no automatic merge
  - no automatic push
  - no automatic branch acceptance
  - no mutation of the original project checkout
- Persist provenance so users can see which run or message a new worktree
  continued from.

Do not implement this until Phases 1-5 are stable. This phase touches worktree
lifecycle, branch naming, diff inheritance, and review semantics.
```

Acceptance:

- Users must opt in before continuing code state from a prior run.
- The new run records its parent run/message provenance.
- Original project checkout remains unchanged.
- Review and risk reports remain scoped to the new run.

## Recommended First Vertical Slice

The smallest useful shipped slice is Phases 1-4:

1. Persist threads and messages.
2. Make desktop thread service repository-backed.
3. Inject bounded conversation context into the second and later runs.
4. Persist assistant outputs back into the transcript.

This gives real multi-turn desktop behavior while preserving CLI stateless runs.
CLI `chat` can follow once the shared service boundary is proven.
