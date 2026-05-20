# Desktop MVP Implementation Prompts

This document turns the remaining desktop MVP work into small, verifiable
implementation prompts. It is a planning artifact only. Do not treat a phase as
implemented behavior until the corresponding code, tests, documentation, and UI
verification have landed.

## Target Outcome

Agent Hub Desktop should be a local Electron shell over the existing CLI-first
core. A user can register a local project, start a conversation, mention
`@fake`, `@codex`, or `@claude`, inspect the resulting run evidence, compare
multi-agent results, approve proposed memory explicitly, and decide how to
handle generated code without automatic merge, push, or repository context
export.

The desktop MVP is complete when the desktop can run real local adapters through
the shared `TaskRunner` path while preserving these product boundaries:

- Agent execution happens in isolated git worktrees.
- Context delivery defaults to runtime injection.
- The renderer has no direct Node, shell, filesystem, SQLite, or Git access.
- Real Codex and Claude Code execution stays local and non-interactive.
- Review decisions are audit records, not automatic code application.
- Memory approval is explicit and writes only to the Agent Hub-owned context
  store.
- No cloud backend, hosted web app, login, remote execution, or automatic pull
  request creation is introduced.

## Current Baseline To Verify Before Each Phase

Before implementing any phase, inspect the live code instead of relying only on
this document. At the current baseline:

- `apps/desktop/electron/services/run-service.ts` creates desktop task/run rows,
  streams fake-agent events, records placeholder diffs/risks, and fails
  `@codex` or `@claude` with a safe "not wired yet" message.
- `apps/desktop/electron/services/thread-service.ts` persists conversation
  threads/messages, builds bounded conversation briefs, creates one run card per
  selected agent, and appends assistant output after terminal runs.
- `apps/desktop/electron/services/review-service.ts`,
  `diff-service.ts`, `risk-service.ts`, and `memory-service.ts` expose local
  review evidence to the renderer.
- `packages/task-runner/src/task-runner.ts` already owns real worktree
  creation, context compilation, adapter execution, verification, diff
  collection, risk persistence, run metadata, and proposed memory generation.
- `packages/agent-adapters/src/agent-adapters.ts` already contains
  `FakeAgentAdapter`, `CodexAdapter`, and `ClaudeCodeAdapter`.
- CLI chat and `agent-hub run` already call `TaskRunner`; desktop must reuse
  that shared path instead of duplicating orchestration in the renderer.

## Global Rules For Every Phase

- Create a focused branch before editing.
- Keep the desktop renderer sandboxed behind the existing preload API.
- Keep orchestration in Electron main-process services or shared packages.
- Do not add Next.js, Express/Fastify/Koa, Postgres, Redis, cloud sync, login,
  hosted dashboards, or remote job queues.
- Do not write `AGENTS.md`, `CLAUDE.md`, `.claude/skills`, or `.agents/skills`
  to a target repository by default.
- Do not merge, push, delete worktrees, export repo context, approve memory, or
  apply code automatically.
- Update `docs/product.md` and `docs/architecture.md` in every implementation
  phase that changes product behavior or architecture.
- For desktop UI changes, run the required desktop build and manual UI
  verification, then write a concise summary under `docs/ui-verification/`.

Suggested minimum checks for implementation phases:

```sh
./node_modules/.bin/pnpm --filter desktop typecheck
./node_modules/.bin/pnpm exec vitest run tests/desktop-services.test.ts
./node_modules/.bin/pnpm test
```

If the full suite is too expensive for a phase, run the most relevant targeted
tests and explain the gap.

## Phase 0 Prompt: Source-Level Desktop MVP Audit

Goal: confirm the current source-level gap before changing code.

Prompt:

```text
Audit the current Agent Hub desktop MVP gap without editing files.

Inspect:
- apps/desktop/electron/services/run-service.ts
- apps/desktop/electron/services/thread-service.ts
- apps/desktop/electron/services/review-service.ts
- apps/desktop/electron/services/diff-service.ts
- apps/desktop/electron/preload.ts
- apps/desktop/electron/ipc-handlers.ts
- apps/desktop/src/App.tsx
- apps/desktop/src/components/inspector/RunInspectorModal.tsx
- packages/task-runner/src/task-runner.ts
- packages/agent-adapters/src/agent-adapters.ts
- apps/cli/src/cli.ts
- tests/desktop-services.test.ts
- tests/task-runner.test.ts
- docs/product.md
- docs/architecture.md

Report:
- which desktop flows already persist conversation, run, review, risk, diff,
  verification, and memory evidence
- exactly where desktop still uses fake-only execution or unavailable real-agent
  placeholders
- which existing TaskRunner inputs and repositories can be reused by desktop
- what event streaming or cancellation limitations exist in the current
  TaskRunner API
- the smallest safe implementation order for real desktop adapter execution

Do not implement code in this phase. Use concrete file paths and observed code
evidence only.
```

Acceptance:

- The audit names the current desktop fake-only boundary.
- The audit identifies the shared `TaskRunner` path that desktop should reuse.
- The audit lists exact files expected to change in Phase 1.

## Phase 1 Prompt: TaskRunner-Backed Desktop Run Service

Goal: route desktop run creation through the shared local `TaskRunner` for all
agent kinds while keeping the renderer contract stable.

Prompt:

```text
Wire desktop RunService to the shared TaskRunner path.

Scope:
- Add or refactor an Electron main-process execution service that calls
  TaskRunner with the desktop SQLite repositories.
- Keep window.agentHub.runs.* and window.agentHub.threads.* stable.
- Keep one canonical run row per desktop run card. Do not pre-create a
  placeholder run and then let TaskRunner create a second disconnected run; use
  the TaskRunner-created run id for the thread run card, or extend TaskRunner
  with an explicit caller-supplied run id before wiring desktop to it.
- Preserve the current fake desktop UX, but run fake through TaskRunner rather
  than apps/desktop/electron/services/fake-agent-runner.ts when this can be done
  without regressing tests.
- Make @codex and @claude create real TaskRunner runs instead of placeholder
  "not wired yet" failures.
- Pass the desktop conversation brief into TaskRunner as conversationBrief.
- Use runtime_injection by default.
- Use a workspace base path outside the original project root.
- Persist and expose TaskRunner artifacts, events, verification results, diff,
  risk report, run metadata, and proposed memory through existing repositories.
- Map core statuses to desktop statuses without changing the renderer type
  contract.

Do not add automatic merge, push, PR creation, repo export, or memory approval.
Do not give the renderer direct filesystem, shell, Git, SQLite, or process
access.

Update tests, docs/product.md, and docs/architecture.md.
```

Acceptance:

- A desktop `@fake` run uses TaskRunner evidence and still renders a completed
  run card, assistant output, diff, verification, risk, logs, and memory
  proposals.
- The run id visible through the desktop run card is the same run id that owns
  TaskRunner events, artifacts, diff, verification, risk, and memory proposals.
- A desktop `@codex` run attempts the real local Codex adapter through
  TaskRunner. If Codex is unavailable, the run fails inspectably with persisted
  events rather than a service crash.
- A desktop `@claude` run attempts the real local Claude Code adapter through
  TaskRunner. If Claude Code is unavailable, the run fails inspectably with
  persisted events rather than a service crash.
- Runs never execute in the original project root.
- Desktop service tests cover the success path with fake and the unavailable
  real-adapter preflight path.

Suggested verification:

```sh
./node_modules/.bin/pnpm --filter desktop typecheck
./node_modules/.bin/pnpm exec vitest run tests/desktop-services.test.ts tests/task-runner.test.ts tests/process-adapters.test.ts
```

## Phase 2 Prompt: Real Run Progress, Cancellation, And Event Replay

Goal: make real TaskRunner-backed desktop runs observable and safely
cancellable from the current inline run-card UI.

Prompt:

```text
Improve desktop run progress and cancellation for TaskRunner-backed runs.

Scope:
- Preserve the existing runs.onEvent subscription contract.
- Emit deterministic desktop lifecycle events for queued, running, verification,
  completed, failed, and cancelled states.
- Replay persisted events to late subscribers.
- If TaskRunner cannot stream adapter stdout/stderr live yet, add explicit
  progress events around TaskRunner stages and document that real adapter output
  appears after final persistence.
- If live real adapter streaming is feasible with a small TaskRunner callback or
  event sink, add that shared-package hook and use it from desktop and tests.
- Add cancellation support only where it is technically real. If process-level
  cancellation requires a new TaskRunner abort signal, add the smallest shared
  API needed and test it. Otherwise keep cancellation disabled or clearly fail
  with an inspectable message for non-cancellable runs.
- Keep fake run cancellation covered.

Do not fake successful cancellation for a real adapter process unless the
process was actually stopped or never started.

Update docs/product.md, docs/architecture.md, and UI verification notes.
```

Acceptance:

- Active run cards update promptly through the desktop event subscription.
- Late subscribers receive persisted events exactly once.
- Cancelling queued or fake runs remains safe and inspectable.
- Real adapter cancellation behavior is honest: supported paths stop execution;
  unsupported paths return a clear local error.
- Desktop UI verification confirms run-card progress and event replay in the
  rebuilt app.

Suggested verification:

```sh
./node_modules/.bin/pnpm --filter desktop build
./node_modules/.bin/pnpm --filter desktop typecheck
./node_modules/.bin/pnpm exec vitest run tests/desktop-services.test.ts tests/task-runner.test.ts
```

## Phase 3 Prompt: Desktop Verification Configuration

Goal: let desktop users configure real verification commands without deriving
shell commands from prompts.

Prompt:

```text
Add local desktop verification configuration for TaskRunner-backed runs.

Scope:
- Store verification command configuration locally through existing settings or
  a narrowly scoped new repository field.
- Surface the configuration in desktop main-process services through validated
  IPC.
- Keep commands structured as executable plus args. Do not accept a raw shell
  string from a task prompt.
- Pass configured verification commands into TaskRunner.
- Preserve TaskRunner dangerous-command validation.
- Show skipped, passed, and failed verification states in the existing
  inspector Tests tab.
- Keep the default behavior explicit: if no commands are configured, the run is
  inspectable and verification is skipped with a clear message.

Do not add project-level cloud settings or read secrets from .env files.

Update tests, docs/product.md, and docs/architecture.md.
```

Acceptance:

- A configured desktop verification command runs with cwd set to the isolated
  worktree.
- Missing verification configuration is shown as skipped, not as a silent pass.
- Dangerous verification commands are refused and produce an inspectable failed
  run or failed verification result.
- The renderer cannot execute commands directly.

Suggested verification:

```sh
./node_modules/.bin/pnpm --filter desktop typecheck
./node_modules/.bin/pnpm exec vitest run tests/desktop-services.test.ts tests/verification.test.ts tests/task-runner.test.ts
```

## Phase 4 Prompt: Retained Worktree Review And Explicit Apply Handoff

Goal: give users a safe desktop path from review evidence to manual code
handling without automatic merge or push.

Prompt:

```text
Add a desktop retained-worktree review and explicit apply handoff.

Scope:
- Expose retained worktree path, branch name, base ref, changed files, and
  cleanup status in the run inspector.
- Add a clear local action for opening or copying the retained worktree path or
  branch name through main-process IPC.
- If an "apply" action is introduced, make it explicit and local-only:
  - preview the diff and risk state first
  - block on blocking risk
  - never push
  - never merge automatically
  - never delete the retained worktree automatically
- Prefer a conservative MVP handoff if automatic apply semantics are too broad:
  display exact local review commands and the retained worktree branch.
- Keep review accept/reject as audit-only unless a separate explicit apply
  action is selected.

Update tests, docs/product.md, docs/architecture.md, and UI verification notes.
```

Acceptance:

- Users can see where a real run's code changes live.
- Accept/reject still records only review state.
- No desktop action merges, pushes, or deletes generated work without an
  explicit user command.
- Blocking risk prevents any automatic acceptance path.
- UI verification confirms the retained-worktree evidence is visible in the
  rebuilt desktop inspector.

Suggested verification:

```sh
./node_modules/.bin/pnpm --filter desktop build
./node_modules/.bin/pnpm --filter desktop typecheck
./node_modules/.bin/pnpm exec vitest run tests/desktop-services.test.ts tests/diff-collector.test.ts tests/risk-report.test.ts
```

## Phase 5 Prompt: Desktop Multi-Agent Comparison Review

Goal: expose the existing local comparison report flow in desktop for runs from
the same task or conversation turn.

Prompt:

```text
Add desktop multi-agent comparison review.

Scope:
- Reuse packages/task-runner comparison helpers instead of duplicating scoring
  logic in the renderer.
- Add main-process IPC for creating and reading comparison reports.
- Let users compare two terminal runs that belong to the same task or the same
  multi-agent desktop turn.
- Show the human summary and structured signals:
  - status outcome
  - risk level
  - verification outcome
  - diff footprint
  - deterministic score and winner when available
- Persist comparison reports in the existing comparison_reports table.
- Keep comparison review-only. It must not accept, merge, push, or apply code.

Update tests, docs/product.md, docs/architecture.md, and UI verification notes.
```

Acceptance:

- Comparing a completed `@fake` run and an unavailable real-adapter run produces
  a persisted comparison report.
- Comparing runs from different tasks is rejected unless the product explicitly
  supports a conversation-turn grouping.
- The desktop comparison view matches the CLI comparison semantics.
- No comparison action mutates agent output.

Suggested verification:

```sh
./node_modules/.bin/pnpm --filter desktop build
./node_modules/.bin/pnpm --filter desktop typecheck
./node_modules/.bin/pnpm exec vitest run tests/desktop-services.test.ts tests/cli.test.ts
```

## Phase 6 Prompt: Approved Memory Writeback From Desktop

Goal: make desktop memory approval update the Agent Hub-owned context store, not
only SQLite status.

Prompt:

```text
Complete desktop memory approval writeback.

Scope:
- Keep generated memory items proposed by default.
- On explicit desktop approval, update SQLite status and append approved memory
  to the Agent Hub-owned context store for the project.
- Use the same approved-memory formatting and writeback helper used by the CLI.
- Show enough confirmation in the desktop memory inspector for users to
  understand what was approved and where it was written.
- If the context store is missing, initialize or require explicit project
  context-store setup according to existing CLI behavior.
- Rejected or ignored memory must never be injected into future context.

Do not write approved memory into the target repository by default.
Do not approve memory automatically after a successful run.

Update tests, docs/product.md, and docs/architecture.md.
```

Acceptance:

- Approved desktop memory appears in future context builds for the same project.
- Ignored/rejected memory does not appear in future context builds.
- Approval is idempotent and does not duplicate identical approved entries.
- The writeback target is outside the repository unless the project explicitly
  uses repo-local context mode.

Suggested verification:

```sh
./node_modules/.bin/pnpm --filter desktop typecheck
./node_modules/.bin/pnpm exec vitest run tests/desktop-services.test.ts tests/context-compiler.test.ts tests/cli.test.ts
```

## Phase 7 Prompt: Desktop MVP Hardening And Release Candidate

Goal: tighten the desktop MVP after real execution, verification, comparison,
and memory writeback are wired.

Prompt:

```text
Harden Agent Hub Desktop as an MVP release candidate.

Scope:
- Run a source-level pass over the complete desktop workflow:
  project registration -> thread prompt -> real adapter run -> review inspector
  -> diff/tests/risk/logs/memory -> comparison -> explicit handoff.
- Fix any stale docs or UI labels that still describe real desktop execution as
  unavailable.
- Verify sensitive diff redaction still applies to persisted and retained
  worktree diffs.
- Verify no renderer code imports Node, fs, child_process, SQLite, or Git APIs.
- Verify all privileged operations go through Electron main-process IPC.
- Verify no desktop flow writes AGENTS.md, CLAUDE.md, agent skills, or approved
  memory into the target repository by default.
- Rebuild the desktop app and manually test the MVP workflow.
- Write a UI verification summary under docs/ui-verification/.

Do not expand into plugin marketplaces, hosted dashboards, team workflows,
automatic PRs, automatic merge, or cloud sync.

Update docs/product.md, docs/architecture.md, README.md, and AGENTS.md only if
they are stale against the verified behavior.
```

Acceptance:

- Typecheck, targeted desktop tests, and the full test suite pass or any skipped
  command is explicitly justified.
- The rebuilt desktop app has a written UI verification summary.
- Current docs no longer claim real desktop adapter execution is unavailable
  after it has shipped.
- The MVP constraints remain local-first, CLI-first, and auditable.

Suggested verification:

```sh
./node_modules/.bin/pnpm typecheck
./node_modules/.bin/pnpm test
./node_modules/.bin/pnpm lint
./node_modules/.bin/pnpm --filter desktop build
```

## Recommended Cut Line

The smallest useful real desktop MVP is Phases 1 through 4:

1. Use `TaskRunner` from desktop.
2. Make real run progress and cancellation behavior honest.
3. Pass configured verification into TaskRunner.
4. Show retained worktree evidence and provide an explicit local handoff.

Phases 5 and 6 complete the richer review loop by adding desktop comparison and
approved-memory writeback. Phase 7 is the release-candidate hardening pass.
