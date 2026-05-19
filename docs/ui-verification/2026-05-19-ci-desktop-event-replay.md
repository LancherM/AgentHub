# UI Verification: CI Desktop Event Replay

Date: 2026-05-19

Rebuilt app path / launch command:

```sh
AGENT_HUB_DB_PATH=/tmp/agent-hub-ci-fix-ui/agent-hub.sqlite ./node_modules/.bin/pnpm --filter desktop preview
```

Tested workflow:

- Launched the rebuilt Electron preview from `apps/desktop/out`.
- Registered `/Users/lan/agent-hub` through the desktop project registration UI using the temporary SQLite database above.
- Sent `@fake verify event replay` from the thread composer.
- Observed the inline run card transition through running/verifying/completed states.
- The run card event log showed the persisted event stream, including fake-run start, context, agent steps, simulated verification, and final completion.
- Terminal card pills updated to `Tests passed`, `Risk none`, `Diff 0 files`, `Memory 2`, and `12 logs`.

Observed result:

The rebuilt desktop app received and rendered run events in the active run card and displayed the completed fake run without repository writes.

Remaining UI risks:

- This was a manual smoke check of the fake-run desktop path only. Real Codex/Claude desktop execution remains intentionally unavailable in this phase.
