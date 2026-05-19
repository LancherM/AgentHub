# Agent Hub TODO

This file tracks the remaining MVP and post-MVP work after a source-level check
of the current `apps/` and `packages/` implementation against `specs/imported/`.

Each item is written as a prompt that can be given directly to an implementation
agent. Keep every change small, CLI-first, local-only, and covered by focused
tests. For behavior changes, update both `docs/product.md` and
`docs/architecture.md` in the same task.

## P0 - MVP Correctness And Safety

### 1. Enforce in-memory task-run lifecycle transitions

Status: done
Done: 2026-05-18 via codex/todo-1-inmemory-run-lifecycle; PR: https://github.com/LancherM/AgentHub/pull/31

Prompt:

You are working in `/Users/lan/agent-hub`. Align
`InMemoryTaskRunRepository.updateStatus()` with the imported task-run lifecycle.
SQLite already rejects invalid transitions such as `queued -> failed`; the
in-memory repository must enforce the same rules so tests and injected runtimes
cannot bypass the domain contract.

Scope:

- Update `packages/core/src/storage.ts` only as needed.
- Use the existing `validateTaskRunStatusTransition()` helper.
- Preserve idempotent same-status updates.
- Add or extend focused tests for invalid and valid in-memory transitions.

Acceptance:

- `queued -> running -> succeeded` works.
- `queued -> failed` is rejected in both SQLite and in-memory repositories.
- Repeating the current status remains a no-op success.

Verification:

```sh
pnpm typecheck
pnpm test -- tests/domain.test.ts tests/sqlite-storage.test.ts
pnpm lint
```

### 2. Add a default verification command timeout

Status: done
Done: 2026-05-18 via codex/todo-2-default-verification-timeout; PR: https://github.com/LancherM/AgentHub/pull/35

Prompt:

You are working in `/Users/lan/agent-hub`. Add a conservative default timeout
for verification commands so every verification process has a timeout even when
the individual command does not provide `timeoutMs`.

Scope:

- Keep per-command `timeoutMs` as an override.
- Put the default in the task-runner verification path, not in CLI parsing.
- Preserve existing timeout and signal metadata in persisted verification rows.
- Add tests proving the default is passed to `ShellExecutor` and explicit
  command timeouts still win.

Acceptance:

- A verification command without `timeoutMs` receives the default timeout.
- A verification command with `timeoutMs` receives its explicit timeout.
- Existing dangerous-command rejection and dry-run behavior are unchanged.

Verification:

```sh
pnpm typecheck
pnpm test -- tests/verification.test.ts tests/task-runner.test.ts
pnpm lint
```

### 3. Guard local settings against secrets

Status: done
Done: 2026-05-18 via codex/todo-3-secret-settings; PR: https://github.com/LancherM/AgentHub/pull/37

Prompt:

You are working in `/Users/lan/agent-hub`. Enforce the imported database rule
that local settings must not store secrets, API keys, tokens, private keys, or
credential material.

Scope:

- Add shared secret-like key/value validation at the domain/repository boundary
  used by both in-memory and SQLite settings.
- Prefer an allowlist of safe setting categories if that fits the current
  setting model better than a broad denylist.
- Do not read or inspect real credential files.
- Add tests for rejected key names and rejected string values.

Acceptance:

- Setting keys such as `api_key`, `token`, `password`, `private_key`, and
  `credentials.*` are rejected.
- Secret-like string values are rejected where practical.
- Non-secret settings such as UI/local behavior flags still persist.

Verification:

```sh
pnpm typecheck
pnpm test -- tests/domain.test.ts tests/sqlite-storage.test.ts
pnpm lint
```

### 4. Make missing verification commands a run warning

Status: done
Done: 2026-05-18 via codex/todo-4-missing-verification-warning; PR: https://github.com/LancherM/AgentHub/pull/39

Prompt:

You are working in `/Users/lan/agent-hub`. When a task run has no configured
verification commands, keep the verification result as `skipped`, but also add a
clear run warning so the operator sees the validation gap without opening the
risk report.

Scope:

- Update the task-runner result path.
- Do not fail the run solely because verification is missing.
- Preserve existing risk report behavior for skipped verification.
- Add focused task-runner and CLI rendering tests if needed.

Acceptance:

- `RunResult.warnings` contains a missing-verification warning when no commands
  are configured.
- Runs with configured verification commands do not get that warning.
- Normal and debug CLI output remain consistent with the current output policy.

Verification:

```sh
pnpm typecheck
pnpm test -- tests/task-runner.test.ts tests/cli.test.ts
pnpm lint
```

## P1 - MVP Usability And Spec Alignment

### 5. Make context export flags semantically strict

Status: done
Done: 2026-05-18 via codex/todo-5-context-export-flags; PR: https://github.com/LancherM/AgentHub/pull/44

Prompt:

You are working in `/Users/lan/agent-hub`. Tighten `agent-hub context export`
flag semantics to match `specs/imported/CLI_SPEC.md` while preserving the
explicit opt-in repo export boundary.

Scope:

- Parse and validate `--target repo`; reject missing or unsupported targets if a
  target flag is provided.
- Decide and implement exact `--include-approved-memory` semantics. If approved
  memory is always included in the managed context block, lock that behavior in
  product and architecture docs and make the CLI output explicit.
- Keep `repo_export` exclusive to `context export`; do not allow it as a task
  run or context-build delivery mode.
- Add CLI and context-compiler tests.

Acceptance:

- `context export --target repo --dry-run` succeeds.
- Unsupported targets fail with a clear error.
- Approved-memory behavior is tested and documented.
- Export still previews before writing unless `--write` is present.

Verification:

```sh
pnpm typecheck
pnpm test -- tests/cli.test.ts tests/context-compiler.test.ts
pnpm lint
```

### 6. Parse skill metadata and warn on malformed skills

Status: done
Done: 2026-05-19 via codex/todo-6-skill-metadata-23e0; PR: https://github.com/LancherM/AgentHub/pull/48

Prompt:

You are working in `/Users/lan/agent-hub`. Make context-store skill loading
respect the imported skill contract: every skill must have `name` and
`description`, and malformed skill metadata should be warned about or skipped
instead of silently treated as generic text.

Scope:

- Update `packages/context-compiler/src/context-compiler.ts`.
- Support the current skill files under `skills/<skill-name>/SKILL.md`.
- Prefer a simple metadata format that matches existing skill conventions.
- Preserve stable ordering for valid skills.
- Add tests for valid metadata, missing metadata, empty files, and export or
  overlay behavior with malformed skills.

Acceptance:

- Valid skills appear in context packs with their declared name and description.
- Malformed skills produce warnings and are skipped or safely downgraded by a
  documented rule.
- Existing non-empty worktree skill-file conflict handling remains intact.

Verification:

```sh
pnpm typecheck
pnpm test -- tests/context-compiler.test.ts tests/task-runner.test.ts
pnpm lint
```

### 7. Add explicit task-run environment override plumbing

Status: done
Done: 2026-05-19 via codex/todo-7-env-overrides; PR: https://github.com/LancherM/AgentHub/pull/50

Prompt:

You are working in `/Users/lan/agent-hub`. Expose intentional environment
overrides from `RunTaskInput` through the task runner into process-backed agent
adapters while preserving the current default environment allowlist.

Scope:

- Add an explicit environment override field to the task-runner input contract.
- Pass overrides to Codex and Claude Code adapter runs.
- Do not inherit arbitrary `process.env`.
- Do not add secret storage or read credential files.
- Add tests proving explicit overrides are passed and unrelated host secrets are
  not inherited by default.

Acceptance:

- Process adapters can receive a caller-provided safe env override.
- Default runs still use the allowlisted inherited environment only.
- Existing adapter detection preflight remains in the isolated worktree.

Verification:

```sh
pnpm typecheck
pnpm test -- tests/task-runner.test.ts tests/process-adapters.test.ts tests/process-runner.test.ts
pnpm lint
```

### 8. Decide first-class tool-call event support

Status: done
Done: 2026-05-19 via codex/todo-8-tool-event-scope; PR: https://github.com/LancherM/AgentHub/pull/52

Prompt:

You are working in `/Users/lan/agent-hub`. Resolve the drift between imported
adapter specs, which mention tool-call events, and the current persisted event
model, which has `stdout`, `stderr`, `message`, `status`, `error`, and `exit`.

Scope:

- Choose one path:
  - add a first-class `tool_call` run event type with parser, persistence, CLI,
    and tests; or
  - explicitly narrow the locked MVP docs to keep tool calls inside generic
    metadata/status events.
- If adding `tool_call`, update shared types, domain validation, SQLite checks,
  adapter parsers, manual event validation, and review rendering.
- Keep the change local-only and review-only; do not add acceptance/merge/push
  behavior.

Acceptance:

- The chosen event model is consistent across shared types, repositories,
  adapters, CLI output, docs, and tests.
- Malformed structured agent output remains preserved safely as raw stdout or a
  warning-like event.

Verification:

```sh
pnpm typecheck
pnpm test -- tests/process-adapters.test.ts tests/cli.test.ts tests/sqlite-storage.test.ts
pnpm lint
```

## P2 - Post-MVP Hardening And Polish

### 9. Add automatic memory proposal generation from completed runs

Status: done
Done: 2026-05-19 via codex/todo-9-auto-memory-proposals; PR: https://github.com/LancherM/AgentHub/pull/55

Prompt:

You are working in `/Users/lan/agent-hub`. Add automatic memory proposal
generation from completed task runs while preserving the conservative memory
lifecycle: generated items must start as `proposed` and must never be injected
until the user explicitly approves them.

Scope:

- Generate proposals from persisted run data, not transient process memory.
- Keep proposal content conservative and auditable.
- Do not auto-approve, auto-write, or inject proposed memory.
- Add CLI visibility for generated proposals only if needed to make the workflow
  usable.

Acceptance:

- Successful runs can create proposed memory items.
- Rejected and proposed memory never appear in future context packs.
- Approved memory still writes back only through the existing approval path.

Verification:

```sh
pnpm typecheck
pnpm test -- tests/task-runner.test.ts tests/cli.test.ts tests/context-compiler.test.ts
pnpm lint
```

### 10. Add structured comparison details and scoring

Prompt:

You are working in `/Users/lan/agent-hub`. Extend the persisted comparison
workflow beyond the current textual summary with structured comparison details
and simple scoring that helps review Claude Code vs Codex outputs without
accepting, merging, or pushing changes.

Scope:

- Build on `packages/task-runner/src/run-review.ts`; keep CLI as parsing and
  rendering.
- Compare changed files, diff size, verification outcomes, failed checks, risk
  levels, risk factors, and material tradeoffs.
- Persist structured details if the current schema can support it safely, or add
  a focused migration if needed.
- Keep the scoring explainable and deterministic.

Acceptance:

- `agent-hub compare` stores and prints both summary and structured comparison
  signals.
- No branch acceptance, merge, delete, or push behavior is introduced.
- Tests cover baseline/candidate mismatch, risk differences, verification
  differences, and changed-file overlap.

Verification:

```sh
pnpm typecheck
pnpm test -- tests/cli.test.ts tests/sqlite-storage.test.ts
pnpm lint
```

### 11. Decide live run-event streaming scope

Prompt:

You are working in `/Users/lan/agent-hub`. Decide whether MVP command mode
should stream run events live or intentionally keep the current post-run
rendering contract, then implement or document that decision.

Scope:

- If implementing streaming, preserve persisted run events, inspectable failed
  runs, debug output, and normal agent-facing output behavior.
- If deferring streaming, update stale imported/spec-lock docs so they no longer
  imply a live stream is already implemented.
- Do not add a server, websocket layer, remote execution, or browser UI.

Acceptance:

- The CLI behavior, docs, and tests agree on live streaming vs post-run
  rendering.
- Interactive mode remains a shell over the same local task-runner path.

Verification:

```sh
pnpm typecheck
pnpm test -- tests/cli.test.ts tests/task-runner.test.ts
pnpm lint
```

### 12. Broaden focused hardening coverage

Prompt:

You are working in `/Users/lan/agent-hub`. Add targeted regression coverage for
high-risk local-first boundaries without broad refactors.

Scope:

- Cover dirty checkout surfacing, non-git rejection, safe-diff false positives,
  tracked binary diffs, adapter detection non-zero exits, sanitized workspace
  path edge cases, repo-local context stores, and run-artifact-oriented safety
  scanning.
- Add missing domain validator tests for agent profiles, run events, artifacts,
  verification results, comparison reports, risk reports, skills, settings,
  context packs, and task briefs.
- Tighten SQLite JSON constraints where practical, especially ensuring
  `risk_reports.findings_json` is a JSON array.

Acceptance:

- New tests exercise the boundaries above without changing unrelated behavior.
- Any behavior change is documented in product and architecture docs.
- No cloud, server, account, or desktop scope is introduced.

Verification:

```sh
pnpm typecheck
pnpm test
pnpm lint
```

### 13. Clean stale historical docs

Prompt:

You are working in `/Users/lan/agent-hub`. Clean or clearly mark stale
historical docs so they no longer conflict with the current workspace layout
and implemented MVP behavior.

Scope:

- Review `docs/SPEC_LOCK.md`, `docs/OPEN_QUESTIONS.md`, and
  `docs/OVERNIGHT_REPORT.md`.
- Remove or mark obsolete references to the old single-package `src/` layout.
- Remove or mark obsolete claims that comparison, memory workflows, safety, run
  review, or package splitting are not implemented.
- Keep `specs/imported/*` as imported references unless the task explicitly
  asks to modify them.

Acceptance:

- Current docs consistently describe `apps/cli` plus `packages/*`.
- Historical notes are visibly historical and cannot be mistaken for current
  product status.
- Desktop remains explicitly deferred.

Verification:

```sh
pnpm typecheck
pnpm test -- tests/ci-cd.test.ts
pnpm lint
```

## Deferred Scope

- Desktop app: intentionally deferred until the CLI, core APIs, and package
  boundaries are stable enough to support a thin Electron/Tauri shell.
- Cloud sync, accounts, hosted dashboards, team collaboration, remote execution,
  automatic pull requests, automatic merges, and automatic pushes remain
  explicit non-goals for the MVP.
