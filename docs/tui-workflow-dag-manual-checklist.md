# TUI Workflow DAG Manual Verification Checklist

Use this checklist for changes that affect `Graph - Workflow DAG`,
`apps/cli/src/tui.ts`, `apps/cli/src/tui-ink/`, terminal renderer behavior, or
visible graph workflow behavior.

## Setup

- Rebuild the CLI before testing:

```sh
npm exec --yes --package=pnpm@10.10.0 -- pnpm build
```

- Verify static output:

```sh
node apps/cli/dist/cli.js tui --once
```

- Launch a real PTY:

```sh
node apps/cli/dist/cli.js tui
```

## Core TUI Loop

- Launch and exit cleanly.
- Open Help with `?`.
- Move focus with Tab and direct focus keys.
- Move selection with arrow keys or `j`/`k`.
- Type in the composer, clear it with Esc or Ctrl+U, and submit only safe local commands.

## Graph Workflow

- Open `Graph - Workflow DAG`.
- Verify Overlay, Plan, and Trace modes with `m`.
- Verify label modes with `l`.
- Verify fold/group behavior with `f` and `/graph fold <group-id>`.
- Verify zoom density with `Z`.
- Verify `/graph focus <node-id>` selects the target node and only changes local graph state.
- Verify selected-node details show read-only commands and prepare-only actions.
- Verify structural mini-map rank/lane occupancy, selected marker, zoom text, and viewport coverage.
- Verify narrow terminals fall back to compact rows with bounded line width.
- Verify Graph never runs agents, applies files, merges, pushes, creates pull requests, or approves memory.

## Evidence

- Write a concise local note under `docs/ui-verification/`.
- Keep verification notes untracked unless the user explicitly asks to publish them.
