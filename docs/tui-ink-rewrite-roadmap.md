# TUI Ink Rewrite Roadmap

Status: implementation in progress
Last updated: 2026-06-01

This document replaces the current hand-rendered TUI implementation plan with a
component-based terminal UI plan. The product scope from `docs/tui-roadmap.md`
still stands: the TUI is a current-context workbench, not a project browser,
desktop clone, raw log viewer, or autonomous apply/merge surface.

## Why Reset The Renderer

The current `agent-hub tui` renderer proves that the shared read model and CLI
submission boundaries can work, but its rendering model is wrong. It builds the
screen as hand-wrapped strings, so it cannot reliably allocate space, preserve
selection context, scroll panes, or keep high-priority evidence visible on
narrow terminals.

The observed failure mode is structural:

- empty RoleCall state can take prime screen space;
- long task titles and run ids crowd out useful state;
- risk/check/diff summaries read like logs instead of operating signals;
- `-- more hidden --` can hide important lower sections;
- keyboard focus exists as state, but the screen is not composed from real
  focusable terminal widgets.

The next implementation should keep the read model, command semantics, and
governance boundaries, but replace the rendering layer.

## Framework Decision

Use Ink for the rewrite, with the CLI/TUI runtime moved to Node 22+:

```json
{
  "ink": "7.0.5",
  "ink-testing-library": "4.x",
  "react": "19.2.x",
  "@types/react": "19.2.x",
  "react-devtools-core": "7.x"
}
```

As of 2026-06-01, `ink@7.0.5` requires Node `>=22`, React `>=19.2`, and ESM.
Agent Hub now treats Node 22+ as the supported CLI/TUI runtime line so the TUI
can use the current Ink API instead of pinning to the older Node 20-compatible
Ink 5 line. The desktop package remains a separate Electron/React surface; the
TUI dependency does not move desktop orchestration or renderer policy.

### Why Ink

- Ink uses React components and Yoga/Flexbox layout, which matches the
  component model Agent Hub already uses in the desktop renderer.
- It supports both interactive apps and one-shot render flows.
- It has testing support through `ink-testing-library`, allowing deterministic
  snapshots for terminal states and keyboard input.
- It lets the TUI be a real component tree instead of a string concatenation
  routine.

### Rejected Options

- `terminal-kit`: powerful low-level terminal toolkit, but it would keep layout
  and focus management imperative and custom.
- `blessed` / `react-blessed`: provides widgets, but the ecosystem is older and
  more mutable-state oriented than Ink.
- `inquirer`: good for prompt flows, not for a persistent multi-pane workbench.

## Architecture

Keep the existing data boundary:

```text
CLI command
  -> TUI launch/context resolver
  -> packages/core TUI read model
  -> Ink renderer
  -> existing CLI chat/review callbacks
```

The Ink layer must not directly access SQLite, filesystem, git, shell, or agent
adapters. It receives `TuiCurrentContextModel` plus callback props for explicit
actions.

The first rewrite uses a small ESM island for Ink rather than converting the
whole CLI package to ESM:

```text
apps/cli/src/tui.ts                  current CommonJS command boundary
apps/cli/src/tui-ink/entry.mts       dynamic Ink entrypoint
apps/cli/src/tui-ink/App.mts         top-level TUI state and layout
apps/cli/src/tui-ink/state.mts       focus and selection reducer
apps/cli/src/tui-ink/format.mts      compact ids and evidence labels
apps/cli/tsconfig.tui-ink.json       NodeNext ESM build target
```

`apps/cli/src/tui.ts` remains the CLI command boundary. It resolves launch
options, builds the read model, dynamically loads the Ink entrypoint, and
passes explicit callback props for prompt submission and review decisions.
There is no hand-rendered string fallback.

The Ink build target should compile to ESM under `apps/cli/dist/tui-ink/`.
The existing CommonJS CLI can then load it with dynamic `import()` at runtime.
This avoids a whole-package ESM migration in the first phase while still using
Ink's ESM package format correctly.

Current implementation status:

- `agent-hub tui` renders through Ink for both `--once` and interactive
  terminal launches.
- `--once` uses Ink `renderToString` and exits after printing the current
  workbench.
- The legacy string workbench renderer and its snapshots have been removed.
- The renderer receives read models and action callbacks only; it does not
  access SQLite, filesystem, git, shell, or agent adapters directly.
- Focus, id-stable selection, pane scroll offsets, command palette, composer,
  and review-decision shortcuts exist in the Ink reducer.

## Product Layout

The first screen must prioritize operating usefulness over model completeness.
Runs and Review are the primary surfaces; RoleCalls are prominent only when
they exist or are blocking.

### Wide Terminals, 120+ Columns

```text
Agent Hub  AgentHub  #general       @codex  runtime  iter 0  risk blocking

Runs                               Review                              RoleCalls
> run_27984312  codex  ok          Current run                         none
  checks 0/0/1  risk blocking      Codex exited with code 0            stop blocking_risk
  files 0                         checks skipped 1                     pending 0

  run_2f244f91  fake  ok           commands                            Transcript
  risk medium  files 1             runs show run_27984312              user: ...

Composer
> @codex ...

tab focus  j/k move  enter detail  : commands  ? help  x exit
```

### Medium Terminals, 90-119 Columns

```text
Runs + Review                      RoleCalls + Transcript
```

### Narrow Terminals, Less Than 90 Columns

```text
Agent Hub  #general  @codex  risk blocking

Runs
> run_27984312  codex ok  checks 0/0/1  risk blocking  files 0

Review
Current run: Codex exited with code 0
checks skipped 1  files 0
commands: runs show run_27984312

RoleCalls
none  stop blocking_risk

Composer
> @codex ...
```

The narrow layout must never show an empty RoleCall panel before Runs and
Review.

## Component Plan

Core components:

- `TuiApp`: owns reducer state, refresh lifecycle, and callbacks.
- `HeaderBar`: project, room/thread, selected agent, context mode, loop, risk.
- `FocusTabs`: `Work`, `Graph`, `Runs`, `Review`, `Tasks`, `Memory`, `Help`.
- `WorkView`: responsive dashboard for daily operation.
- `RunsPane`: active/recent runs with compact status chips.
- `ReviewPane`: selected run or RoleCall evidence and commands.
- `RoleCallsPane`: graph when calls exist; compact stop state when empty.
- `TranscriptPane`: recent transcript, bounded and scrollable.
- `TasksPane`: current tasks, assignments, role todos, follow-ups.
- `MemoryPane`: counts, approved source, explicit CLI commands.
- `CommandPalette`: current-context commands only.
- `Composer`: prompt editing, target chips, submit status.
- `StatusBar`: keys, errors, current command hints.

State modules:

- `state.mts`: focus, selection, palette, composer, status, and command hints.
- `format.mts`: short ids, risk labels, check labels, bounded text.
- `App.mts`: terminal width breakpoints and pane ordering.
- future `layout.mts` / `theme.mts`: extract only if the component tree grows
  enough to justify them.

## Interaction Rules

Keyboard defaults:

- `tab` / `shift-tab`: switch focus panes.
- `j/k` and arrow keys: move within the focused pane.
- `enter`: open focused detail or switch Review to selected item.
- `:`: command palette.
- `c`: prepare an explicit continuation prompt; no background execution.
- `a` / `j`: accept/reject selected run for record only, preserving current
  review-decision semantics.
- `ctrl+j`: submit composer.
- `esc`: close palette or return to Work.
- `x` / `ctrl+c`: exit.

The command palette lists equivalent CLI commands and should be the only place
where full ids and long commands dominate screen space.

## Implementation Phases

### Phase Ink-0: Spike And Dependency Boundary

Status: done

Goal: prove Ink can run inside the current CLI without migrating the whole CLI
package to ESM.

Tasks:

- Add an Ink entrypoint behind the `agent-hub tui` command boundary.
- Verify `node apps/cli/dist/cli.js tui --once` exits cleanly.
- Verify TypeScript build output and dynamic import behavior.
- Remove the old renderer as a fallback once Ink owns `--once`.

Acceptance:

- `pnpm typecheck`, focused TUI tests, and build pass.
- A one-screen Ink render can display a static current-context model.

### Phase Ink-1: Read-Only Work View

Status: done for the initial Work view; polish remains

Goal: replace the current Work view with Ink components.

Tasks:

- Render header, focus tabs, Runs, Review, RoleCalls, Transcript, Composer.
- Implement responsive layouts for `<90`, `90-119`, and `120+` columns.
- Compact ids and hide full commands outside detail/palette surfaces.
- Add snapshots for empty, active, failed, blocking-risk, and many-runs states.

Acceptance:

- First screen always contains Runs, Review, and Composer.
- Empty RoleCalls never appear before Runs and Review on narrow terminals.
- No `-- more hidden --` equivalent hides primary evidence.

### Phase Ink-2: Focus, Selection, And Scrolling

Status: done for runs, RoleCalls, and tasks; transcript scroll can be added
later if needed

Goal: make the app feel like a real TUI instead of a static dashboard.

Tasks:

- Add reducer-backed focus and selection.
- Add scroll offsets per pane.
- Preserve selection across refreshes by ids where possible.
- Use `useInput` for keyboard handling.

Acceptance:

- Selection remains stable when the model refreshes.
- Keyboard navigation is covered by tests.

### Phase Ink-3: Composer And Refresh

Status: partially implemented

Goal: restore prompt submission with a component composer.

Tasks:

- Reuse existing CLI chat submission callback.
- Keep unknown mentions as prompt text.
- Show submit progress and failure recovery in `StatusBar`.
- Refresh the read model after submission completes.

Acceptance:

- TUI-submitted prompt persists the same records as CLI chat.
- Unavailable Codex/Claude CLI failures are visible and inspectable.

### Phase Ink-4: Review, Memory, And Command Palette

Status: partially implemented

Goal: restore governed actions without adding side effects.

Tasks:

- Wire accept/reject review shortcuts to the shared review-decision service.
- Render memory governance indicators.
- Render command palette with full ids and CLI commands.
- Keep memory approval as explicit CLI commands only.

Acceptance:

- Review decisions write only `review_decision` artifacts.
- No apply, merge, push, PR, cleanup, memory approval, or context export is
  introduced.

### Phase Ink-5: Remove String Renderer

Status: done for runtime removal; final parity hardening remains

Goal: delete the legacy rendering path after parity is proven.

Tasks:

- Move shared formatters into Ink-specific modules where appropriate.
- Remove obsolete string-render snapshots.
- Keep `--once` support through Ink render output.
- Update docs and tests to make Ink the only TUI renderer.

Acceptance:

- Full validation passes.
- Manual smoke against a real local project shows usable first-screen layout.

## Testing Strategy

Use Ink's `renderToString` for one-shot layout tests and
`ink-testing-library` for interactive keyboard tests as those interactions
grow:

- render snapshots at 80, 100, and 140 columns;
- keyboard tests for focus, selection, palette, composer, and exit;
- model-state tests for empty graph, active runs, completed runs, failed runs,
  blocking risk, missing project, and failed context reads;
- smoke test for `agent-hub tui --once`;
- no direct SQLite, filesystem, git, shell, or adapter calls from components.

Keep the existing read-model tests in `tests/tui-read-model.test.ts`; the Ink
tests should verify presentation and interaction, not duplicate repository
logic.

## Non-Goals

- Do not add a server, browser dashboard, cloud backend, account, sync, remote
  execution, or marketplace.
- Do not turn the TUI into project/room navigation.
- Do not show raw logs, full diffs, context packs, or task briefs by default.
- Do not add automatic apply, merge, push, PR creation, cleanup, or memory
  approval.
- Do not migrate the whole CLI package to ESM as part of the first Ink spike.

## Open Questions

- Whether scroll offsets should be pane-local state only or selection-derived
  state that follows refreshed run and RoleCall ids.
- Whether color should be enabled by default or only when `stdout.isTTY` and
  color support are detected.
- Whether mouse support is worth adding later. It is not required for MVP.
