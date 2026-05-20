# Desktop TaskRunner Phase 1 UI Verification

Date: 2026-05-20

Rebuilt app:

- `./node_modules/.bin/pnpm --filter desktop build`
- Output checked from `apps/desktop/out/main/main.js` and `apps/desktop/out/renderer/`

Launch command:

- `AGENT_HUB_HOME=$(mktemp -d /tmp/agent-hub-ui-XXXXXX) ./node_modules/.bin/pnpm --filter desktop preview`

Tested workflows:

- Registered `/Users/lan/agent-hub` as a local project through the rebuilt Electron UI.
- Sent `@fake verify TaskRunner desktop fake path` from the conversation composer.
- Observed the inline `@fake` run card reach `COMPLETED`, show `fake agent completed`, show the new TaskRunner copy, and expose `Tests skipped`, `Risk medium`, `Diff 1 files`, memory count, and log count.
- Sent `@codex verify unavailable adapter evidence` to confirm the run card enters the TaskRunner-backed real-adapter state with the new `Local TaskRunner run for @codex...` copy.

Observed result:

- The rebuilt UI renders the new TaskRunner-backed copy.
- Fake runs complete from the desktop conversation surface with persisted evidence visible on the inline card.
- Real adapter mentions are no longer displayed as "not wired yet" placeholders.

Remaining UI risks or gaps:

- Live TaskRunner streaming and process-level cancellation remain follow-up work.
- The local Codex CLI was available on this machine, so the `@codex` manual check started a real local adapter run. The preview process and child Codex process were stopped after verifying the TaskRunner-backed running state.
- Launching against the existing default desktop app data hit a stale local SQLite migration error (`duplicate column name: parent_run_id`); verification used a clean temporary `AGENT_HUB_HOME`.
