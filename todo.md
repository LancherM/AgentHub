# Agent Hub TODO

This list is based on a source-level scan of the current `apps/` and `packages/`
implementation against `specs/imported/`. It tracks concrete drift and follow-up
work; entries here are planning notes only and should be implemented in small,
verified slices.

## P0 - Spec/Safety Correctness

- Reject `repo_export` for task runs.
  - Spec basis: `repo_export` is an explicit context export action, not a task-run delivery mode.
  - Current drift: `ContextDeliveryMode` includes `repo_export`, and CLI/task-runner paths accept it for `run`.
  - Expected work: narrow run delivery parsing/validation to `runtime_injection` and `worktree_overlay`; add CLI and task-runner regression tests.

- Validate in-memory task-run status transitions.
  - Spec basis: task runs follow `queued -> running -> succeeded|failed` plus cancellation paths.
  - Current drift: SQLite validates transitions, but `InMemoryTaskRunRepository.updateStatus()` can bypass invalid direct transitions.
  - Expected work: apply `validateTaskRunStatusTransition()` in the in-memory repository and cover invalid transitions in unit tests.

- Add a default verification timeout.
  - Spec basis: verification commands should enforce timeouts.
  - Current drift: timeouts are only applied when an individual verification command supplies `timeoutMs`.
  - Expected work: define a conservative default timeout, preserve per-command override, and test timeout behavior.

- Resolve normal `run` output contract.
  - Spec basis: `CLI_SPEC.md` shows run summaries in normal output, while roadmap polish asks for concise normal output and debug detail.
  - Current drift: CLI normal mode prints agent-facing output only and reserves run metadata for `--debug`.
  - Expected work: either make terse output the locked contract and update stale spec docs, or restore a concise non-debug summary with tests.

## P1 - MVP Completion Gaps

- Make context export flags semantically strict.
  - Current drift: `context export --target repo` is not parsed or validated, and `--include-approved-memory` only adds a warning because approved memory is always part of rendered store context.
  - Expected work: parse/validate `--target repo`; decide exact include semantics for approved memory; add CLI and compiler tests.

- Guard settings against secrets.
  - Spec basis: settings and SQLite storage must not store secrets, API keys, tokens, private keys, or credentials.
  - Current drift: settings validate shape/JSON but do not reject secret-like keys or values.
  - Expected work: add shared sensitive-key/value checks at domain and repository boundaries, or explicitly document and enforce allowed setting categories.

- Surface missing verification commands as a run warning.
  - Spec basis: missing verification commands should produce a warning.
  - Current drift: verification is marked skipped and risk is elevated, but `RunResult.warnings` is not updated.
  - Expected work: add a warning in the runner and cover it in task-runner/CLI tests.

- Add review commands for persisted logs and diffs.
  - Spec basis: review workflows include logs/stdout/stderr, verification output, diffs, risk reports, and comparison material.
  - Current drift: `runs show` and `risks show` are summarized; there is no direct CLI command to inspect full run events or diff artifacts.
  - Expected work: add focused local commands such as `runs events <run-id>` and `runs diff <run-id>` without adding acceptance, merge, or push behavior.

- Decide first-class tool-call event support.
  - Spec basis: adapter event streams include tool call summaries or payloads.
  - Current drift: run event types are `stdout`, `stderr`, `message`, `status`, `error`, and `exit`; tool calls are only possible inside generic metadata.
  - Expected work: either add a `tool_call` event type and parser coverage, or narrow the spec/locked docs to the current generic event model.

- Move comparison generation out of the CLI layer.
  - Spec basis: CLI should dispatch to lower-level modules and avoid owning orchestration/report logic.
  - Current drift: comparison loading and summary generation live in `apps/cli/src/cli.ts`.
  - Expected work: extract a local core/task-runner comparison service and keep CLI as argument parsing plus rendering.

- Add skill metadata parsing and malformed-skill warnings.
  - Spec basis: malformed skill metadata should be reported as warnings or skipped.
  - Current drift: context compiler reads any non-empty `SKILL.md` and uses the first non-empty line as description.
  - Expected work: parse required `name` and `description` metadata, warn/skip malformed skills, and update context compiler tests.

- Add task-runner environment override plumbing.
  - Spec basis: adapter run input allows intentional environment overrides.
  - Current drift: process adapters support `environment`, but `RunTaskInput` does not expose it end to end.
  - Expected work: add explicit environment override support with allowlist behavior and tests that no secret environment is inherited by default.

## P2 - Hardening And Follow-Up

- Expand domain validator tests.
  - Cover agent profiles, events, artifacts, verification results, comparison reports, risk reports, skills, settings, context packs, and task briefs.

- Tighten SQLite JSON constraints where practical.
  - In particular, ensure `risk_reports.findings_json` is a JSON array rather than merely valid JSON.

- Add repo-local context-store tests.
  - `repo_local` remains a supported opt-in mode, but coverage is lighter than the external store path.

- Decide project registration git validation.
  - Current behavior accepts any absolute path at `project add`; git validation happens later during worktree creation.
  - Either validate at registration or document the deferred validation contract.

- Add structured comparison details and scoring.
  - Current comparison reports persist a textual summary; imported specs and current docs still point to richer scoring/details as deferred.

- Add automatic memory proposal generation from completed runs.
  - Manual memory propose/list/approve/reject is implemented; automatic proposal generation remains deferred and must still require user approval.

- Decide live run-event streaming scope.
  - Current CLI awaits `TaskRunner.run()` and renders after completion; imported product prose says run events stream.
  - Implement streaming only if it can preserve persistence and local-only boundaries, otherwise lock the current post-run rendering behavior.

- Broaden safety and adapter coverage.
  - Add targeted coverage for dirty checkout surfacing, non-git rejection, safe-diff false positives, tracked binary diffs, adapter detection non-zero exits, sanitized workspace path edge cases, and run-artifact-oriented safety scanning.

- Clean stale historical docs.
  - `docs/SPEC_LOCK.md`, `docs/OPEN_QUESTIONS.md`, and `docs/OVERNIGHT_REPORT.md` still contain older notes about a single root `src/` package layout and deferred package splitting.
  - Update or clearly mark those sections as historical so they no longer conflict with the current `apps/` and `packages/` workspace.

## Intentional Or Superseded Spec Drift

- `compare: not implemented yet` is obsolete; persisted comparison reports exist, though richer scoring remains deferred.
- `memory placeholder` wording is obsolete; manual memory proposal, approval, rejection, and approved-memory writeback exist.
- `safety package placeholder` and “risk findings when implemented” wording are obsolete; scanners and persisted risk reports exist.
- `review_ready` should not be treated as a persisted run status unless explicitly reintroduced; current domain statuses are `succeeded` and `failed`.
- Risk reports are richer than the imported minimal model. Keep the richer model unless a future migration intentionally simplifies it.
- `running -> open` after a failed run is current behavior. If this remains intended, lock it in docs as an extension to the imported lifecycle; otherwise remove it with a focused migration/test change.
- Workspace cleanup policies are implemented as explicit opt-in behavior with default retention. This preserves the no-automatic-cleanup intent while giving callers controlled cleanup options.
