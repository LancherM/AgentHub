# TUI Optimization Roadmap

Status: active implementation; OPT-0 through OPT-2 implemented
Last updated: 2026-06-04
Baseline: `origin/main` at `0a69476`

This document records the next TUI optimization slice after the Ink rewrite,
conversation-terminal Work surface, composer polish, low-flicker refresh loop,
and active-run box hardening have landed. It is not a replacement for
`docs/tui-roadmap.md`, `docs/tui-ink-rewrite-roadmap.md`, or
`docs/tui-conversation-terminal-roadmap.md`; it narrows the remaining product
and implementation work to terminal usability.

The current TUI direction is sound: `agent-hub tui` is a current-context,
conversation-first terminal workbench backed by shared read models and local
CLI callbacks. The remaining problem is operating quality. At normal width it
is usable; at narrow width and during noisy status states, the screen still
feels like a dense render of correct data instead of a calm tool for repeated
work.

## Current Evidence

The baseline was checked with:

```sh
stty cols 80 rows 24
node apps/cli/dist/cli.js tui --once

stty cols 48 rows 20
node apps/cli/dist/cli.js tui --once
```

Observed strengths:

- Work is correctly conversation-first and keeps full agent replies visible by
  default.
- Active runs render as bounded boxes rather than raw logs.
- Composer behavior is now prompt-first, with history, multiline editing,
  mention completion, and safer uppercase focus shortcuts.
- The renderer stays inside `apps/cli/src/tui-ink`; SQLite, git, shell, and
  adapter execution remain behind CLI/read-model callbacks.
- Review decisions, memory approval, apply, merge, push, PR creation, context
  export, and cleanup remain outside automatic TUI side effects.

Observed gaps:

- The footer still tries to do too much in one line: focus hints, local session
  flags, and long equivalent CLI commands compete for the same narrow space.
- At 48 columns, tab labels and wrapped conversation lines can break structural
  affordances such as `[W]ork`, left bars, and active-run frames.
- The first screen lacks a stable attention strip for pending reviews,
  blocking risk, waiting approval/context, stale active runs, and failed
  verification.
- Review and next-action state can be visible in the conversation but still
  easy to miss after scroll or in narrow terminals.
- The runtime still emits Node JSON module experimental warnings before the TUI
  frame in the current one-shot smoke, polluting the first screen.
- Some labels are implementation-shaped rather than operator-shaped, for
  example `[E]am` for Team and long command hints in the always-visible
  status bar.

## Optimization Principles

- Preserve the current product boundary: current-context workbench, not project
  browser, desktop clone, raw log viewer, or apply/merge surface.
- Keep Work prompt-first. Review actions live in Review, while Work shows
  prompts, agent-facing output, active progress, and concise next-action
  signals.
- Do not collapse full agent replies by default. Use scrolling, row budgets,
  and auxiliary views instead of hiding completed answers.
- Treat narrow terminals as a first-class target. A 48x20 PTY must remain
  coherent even if it shows less detail.
- Put long ids and full CLI commands in Palette or focused detail panes, not in
  permanent chrome.
- Make the most urgent state explicit and stable: blocked risk, failed checks,
  pending review, waiting approval/context, stale active run, and unavailable
  agent CLI.
- Keep all data derived from existing persisted evidence and shared read
  models unless a specific query proves a new model field is needed.

## Target Surface

The optimized shell keeps the same logical regions but changes their priority:

```text
Header        project, room/thread when useful, target, iter, risk
Attention     only urgent state: review, checks, waiting, stale, blocked
Work          full conversation plus active run boxes
Composer      target preview and editable prompt
Footer        short keys first; long commands only on demand
Tabs          compact focus map, responsive by width
```

### Header

The header should stay one line and degrade from right to left:

```text
agent-hub  @codex  iter 0  risk medium
agent-hub  @codex  risk medium
agent-hub  risk medium
```

The clock is optional at narrow widths. Risk must stay visible before
decorative or low-value metadata.

### Attention Strip

Add a compact row immediately below warnings/status when any urgent state
exists:

```text
needs review 2 | checks failed 1 | risk medium | stale run 1
```

Rules:

- Hide the row when there is no actionable state.
- Keep it derived from the current TUI read model.
- Do not make it clickable or side-effecting.
- `V` opens Review, `R` opens Runs, and `G` opens Graph; the strip may mention
  those keys but must not steal prompt text.
- At very narrow widths, show only the highest priority item plus `: more`.

Priority order:

1. blocking risk;
2. failed verification;
3. waiting approval or waiting context;
4. pending review;
5. active run older than a threshold;
6. unavailable executor or missing agent CLI;
7. proposed memory count.

### Work Conversation

Work remains a full-output conversation. The optimization is layout discipline,
not answer folding:

- Preserve full completed agent replies.
- Bottom-anchor by default and keep scroll state predictable.
- Add a small range indicator only while scrolled away from the bottom.
- Keep left bars, timestamps, inline diffs, and path highlighting readable when
  wrapping.
- Prefer truncating structural labels over breaking borders, tab brackets, or
  status markers.
- Avoid mixing languages in generated hints unless the surrounding product copy
  is intentionally localized.

### Active Run Area

Active boxes should be stable under terminal height pressure:

- Full boxes are useful at normal width, but narrow/short terminals should use
  a compact 3 to 4 line variant.
- Stale active runs should be visually marked after a threshold such as one
  hour without useful output, using existing persisted timestamps/events.
- Older active runs should collapse before the newest run loses visibility.
- Full output stays in the read model and focused Runs/Review surfaces; Work
  active boxes choose an appropriate visible tail.

### Footer And Tabs

Footer redesign is the highest-leverage polish:

```text
keys: Tab focus | : commands | ? help | X exit
next: agent-hub runs show run_1234
```

Rules:

- At narrow widths, show only keys on the permanent footer.
- Move long equivalent CLI commands into Palette or a second line that appears
  only when there is width.
- Make the footer focus-specific, not a global dump of every available action.
- Shorten tabs responsively:

```text
wide:   [W]ork [R]uns [V]iew [G]raph [T]asks [M]em [Team] ?
medium: W Work | R Runs | V View | G Graph | T Tasks | M Mem | Team | ?
narrow: W R V G T M Team ?
```

The Team key should read as `Team`, not `[E]am`.

### Warning Hygiene

One-shot and interactive TUI output should not start with runtime warnings that
are unrelated to Agent Hub state. The JSON module experimental warning seen in
the current smoke should be eliminated through build/runtime changes or
captured in tests as an output cleanliness requirement.

## Roadmap

### Phase OPT-0: Planning Documents

Status: this document.

Scope:

- Add the public optimization roadmap.
- Add a local ignored implementation prompt companion at
  `docs/tui-optimization-implementation-prompts.md`.
- Cross-link the roadmap from product, architecture, and the main TUI roadmap.
- Do not change runtime behavior.

Acceptance:

- `git diff --check` passes.
- The prompt companion remains ignored by git.

### Phase OPT-1: Footer And Command Hint Hierarchy

Status: implemented.

Goal: reduce permanent chrome and make commands discoverable without crowding
the first screen.

Scope:

- Split bottom guidance into permanent short keys plus optional command hints.
- Move full ids and long commands into Palette or focused panes.
- Update Help and Palette copy so users can still discover equivalent CLI
  commands.
- Replace awkward tab labels such as `[E]am` with responsive labels.

Acceptance:

- 80-column and 48-column `--once` output shows coherent footer text.
- No permanent footer line truncates before the primary keys are readable.
- Palette still exposes current-context run, review, RoleCall, memory, and team
  commands.

Verification:

```sh
pnpm build
./node_modules/.bin/vitest run tests/cli-tui-ink.test.mts
node apps/cli/dist/cli.js tui --once
```

### Phase OPT-2: Narrow-Terminal Layout Budget

Status: implemented.

Goal: make 48x20 and other narrow PTY sessions coherent.

Scope:

- Add explicit width/height row budgets for Work.
- Use compact active-run boxes on narrow or short terminals.
- Ensure tab labels, borders, and left bars do not hard-wrap into broken
  structure.
- Add render coverage for 48 columns, 64 columns, 80 columns, and 120 columns.

Acceptance:

- 48x20 output keeps header, Work content, composer, footer, and tabs readable.
- Structural labels truncate or compact before they wrap into malformed UI.
- Full agent replies remain available in Work scrolling or focused surfaces;
  completed agent replies are not collapsed by default.

Verification:

```sh
pnpm build
./node_modules/.bin/vitest run tests/cli-tui-ink.test.mts
stty cols 48 rows 20
node apps/cli/dist/cli.js tui --once
```

### Phase OPT-3: Attention Strip And Next-Action State

Goal: make urgent work visible without turning Work into a dashboard.

Scope:

- Derive an attention summary from existing review, run, verification, risk,
  RoleCall, task, team, and memory summaries.
- Render one compact row only when something requires attention.
- Add copy for Review/Runs/Graph navigation hints without automatic actions.

Acceptance:

- Pending review, failed checks, blocking risk, waiting approval/context, and
  unavailable executor states produce deterministic attention text.
- Empty or healthy contexts do not show an attention row.
- The strip does not add persistence, shell execution, or side effects.

Verification:

```sh
./node_modules/.bin/vitest run tests/tui-read-model.test.ts tests/cli-tui-ink.test.mts
```

### Phase OPT-4: Warning Hygiene And Stale Run Signals

Goal: keep TUI output clean and make suspicious active runs inspectable.

Scope:

- Remove or suppress the Node JSON module experimental warning from TUI smoke
  output.
- Add an explicit stale-active-run label derived from persisted timestamps and
  recent useful output.
- Surface the equivalent Runs/Review command path for stale active runs.

Acceptance:

- `node apps/cli/dist/cli.js tui --once` begins with the TUI frame, not a Node
  runtime warning.
- Long-running active runs show stale state without changing run status.
- Stale state is presentation-only and does not cancel or clean worktrees.

Verification:

```sh
pnpm build
node apps/cli/dist/cli.js tui --once
./node_modules/.bin/vitest run tests/cli-tui-ink.test.mts
```

### Phase OPT-5: Copy, Help, And Localization Consistency

Goal: make the terminal language operator-shaped and consistent.

Scope:

- Normalize generated hints to one language per surface.
- Replace implementation terms in always-visible copy with operator terms.
- Update Help to explain Work, Review, Runs, Graph, Palette, Search, Timeline,
  Notify, and Team without exposing internal contracts.
- Keep detailed architecture and governance explanation in docs, not in the TUI
  frame.

Acceptance:

- No mixed-language generated hints appear in default English UI output.
- Help fits inside narrow and normal terminals.
- Operator copy preserves safety: review is audit-only, memory approval remains
  CLI-only, and apply/merge/push are not implied.

Verification:

```sh
./node_modules/.bin/vitest run tests/cli-tui-ink.test.mts
node apps/cli/dist/cli.js tui --once
```

### Phase OPT-6: Manual Terminal QA Contract

Goal: make future TUI polish hard to regress.

Scope:

- Rebuild before manual judgment.
- Verify `--once` and an interactive PTY launch at normal and narrow sizes.
- Cover launch, exit, help, palette, focus navigation, composer typing,
  composer clear/cancel, search, timeline, notify toggle, Review, Runs, Graph,
  Tasks, Memory, and Team surfaces relevant to the change.
- Write manual TUI verification notes under ignored `docs/ui-verification/`.

Acceptance:

- Every UI-affecting TUI PR includes automated focused tests plus a local
  manual verification note.
- Final summaries include the note path and any residual UI risk.

Verification:

```sh
pnpm build
pnpm typecheck
pnpm lint
pnpm test
git diff --check
```

## Implementation Boundaries

Likely files:

- `apps/cli/src/tui-ink/App.mts`
- `apps/cli/src/tui-ink/state.mts`
- `apps/cli/src/tui-ink/format.mts`
- `apps/cli/src/tui.ts`
- `packages/core/src/tui-read-model.ts`
- `tests/cli-tui-ink.test.mts`
- `tests/cli-tui.test.ts`
- `tests/tui-read-model.test.ts`
- `docs/product.md`
- `docs/architecture.md`

Avoid:

- new servers, browser UI, cloud services, daemons, or remote execution;
- moving orchestration into Ink components;
- direct SQLite, git, filesystem, shell, or adapter access from the renderer;
- automatic apply, merge, push, PR creation, branch deletion, context export,
  worktree cleanup, or memory approval;
- hiding completed agent replies behind collapse controls by default;
- adding persistence tables before a concrete read-model query requires them.

## Risks

- Narrow-terminal fixes can accidentally remove high-value context from normal
  terminals if width breakpoints are not tested separately.
- Attention summaries can become noisy if they include informational states.
  Keep the strip absent unless there is action-worthy state.
- Footer simplification can hide useful CLI commands. Palette and focused panes
  must remain reliable discovery surfaces.
- Warning suppression must not hide Agent Hub errors; it should target runtime
  implementation warnings only.
