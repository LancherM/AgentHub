# UI Verification: Phase 4 Assistant Output Messages

Date: 2026-05-19

Rebuilt app / launch command:

```sh
./node_modules/.bin/pnpm --filter desktop build
HOME=/tmp/agent-hub-desktop-home.Ek6uny ./node_modules/.bin/pnpm --filter desktop preview
```

The preview loaded `apps/desktop/out/renderer/index.html` in Electron. Electron
still resolved the app data path to the normal local Agent Hub support
directory, so the verification created local desktop test records but did not
modify repository files.

Tested workflows:

- Registered `/Users/lan/agent-hub` through the desktop project onboarding form.
- Sent `@fake verify assistant output message` from the conversation composer.
- Waited for the fake run to complete and verified that the thread timeline rendered the completed run card plus a durable assistant bubble with `Fake run completed successfully`.
- Sent `@codex verify placeholder failure summary` in the same thread.
- Verified that the placeholder Codex run failed without invoking a real adapter and that the transcript rendered a compact assistant failure message.
- Verified that the thread sidebar preview updated to the latest assistant message and that raw run log lines stayed inside the run card rather than the assistant transcript bubble.

Observed result:

- Assistant output messages render in the thread timeline after terminal runs.
- Completed fake output and failed placeholder summaries are visible as assistant messages.
- The desktop remains a local Electron shell over preload IPC; no repository files were modified by the UI verification runs.

Remaining UI risks or gaps:

- This was a manual Electron preview check, not an automated renderer test.
- Real Codex/Claude desktop execution remains intentionally unwired in this phase.
