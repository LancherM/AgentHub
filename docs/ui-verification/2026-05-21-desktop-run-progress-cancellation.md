# Desktop Run Progress And Cancellation UI Verification

Date: 2026-05-21

## Rebuilt app

- `./node_modules/.bin/pnpm --filter desktop build`
- Verified through `./node_modules/.bin/pnpm --filter desktop preview`, loading the rebuilt Electron output from `apps/desktop/out/main/main.js` and `apps/desktop/out/renderer/`.

## Launch commands

- `AGENT_HUB_HOME=$(mktemp -d /tmp/agent-hub-ui-XXXXXX) ./node_modules/.bin/pnpm --filter desktop preview`
- `AGENT_HUB_HOME=$(mktemp -d /tmp/agent-hub-ui-cancel-XXXXXX) PATH=/tmp/agent-hub-mock-bin-wW0Fv7:$PATH ./node_modules/.bin/pnpm --filter desktop preview`

## Tested workflows

- Registered `/Users/lan/agent-hub` in clean desktop app data.
- Sent `@fake verify live progress and replay`.
- Observed the inline run card move through live `RUNNING` progress to `COMPLETED`, including context compilation, TaskRunner start, fake-agent output, verification stage, and final completion events.
- Switched to a new chat and returned to the original thread; the completed run card and log timeline replayed from persistence without duplicate visible events.
- Launched with a temporary mock `codex` shim, sent `@codex verify cancellable mock process`, observed live process output, clicked `Cancel`, and observed final `CANCELLED` status.
- Opened the run inspector and confirmed signaled cancellation evidence in the summary and logs: `mock codex terminated`, `Codex exited by signal SIGTERM`, verification skipped, and `Run cancelled.`

## Observed result

Desktop run cards now reflect live TaskRunner progress before final run persistence, persisted events replay after thread switching, and active process-backed cancellation records inspectable cancelled evidence instead of a generic failure.

## Remaining UI risks or gaps

- Verification command configuration remains follow-up work, so the Tests view stays skipped or unknown when no verification commands are configured.
- Real Codex and Claude structured output mapping is still conservative; this phase verifies process lifecycle, cancellation, replay, and inspector evidence.
