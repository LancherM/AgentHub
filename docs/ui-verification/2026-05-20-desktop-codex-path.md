# Desktop Codex PATH Verification

Date: 2026-05-20

Rebuilt app path or launch command:

```sh
node_modules/.bin/pnpm --filter desktop build
AGENT_HUB_DB_PATH=/tmp/agent-hub-codex-path-ui/agent-hub.sqlite node_modules/.bin/pnpm --filter desktop preview
```

Tested workflows:

- Rebuilt the Electron main, preload, and renderer bundles after the process runner PATH change.
- Launched the rebuilt desktop preview with an isolated SQLite database path.
- Verified the preview starts the Electron main process and renderer without startup errors.
- Verified the desktop TaskRunner-backed `@codex` path through focused service tests, including real-adapter preflight plumbing.

Observed results:

- `electron-vite build` completed successfully for main, preload, and renderer bundles.
- `electron-vite preview` rebuilt and started the Electron app successfully.
- `tests/desktop-services.test.ts` passed as part of the targeted and full test runs.
- `tests/process-runner.test.ts` covers GUI-style PATH lookup by adding an nvm Node bin directory under a fake home directory.

Remaining UI risks or gaps:

- This pass did not manually submit a live `@codex` prompt in the Electron window because that would launch a real local Codex agent run. The exercised path is covered by desktop service tests and process runner tests.
