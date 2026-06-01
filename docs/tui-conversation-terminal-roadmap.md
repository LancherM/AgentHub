# TUI Conversation Terminal Roadmap

Status: planned
Last updated: 2026-06-01

This document translates the TUI conversation-terminal proposal into an
implementation plan for the existing Ink-based `agent-hub tui` command.

The current TUI already has the important foundations:

- `apps/cli/src/tui.ts` resolves launch context and owns CLI action callbacks.
- `apps/cli/src/tui-ink/App.mts` renders the Ink component tree.
- `apps/cli/src/tui-ink/state.mts` owns focus, selection, scroll, palette, and
  composer state.
- `packages/core/src/tui-read-model.ts` builds bounded current-context models
  from existing local repositories.
- Runs, Review, RoleCalls, Tasks, Memory, Help, prompt submission, polling, and
  audit-only review shortcuts already exist behind local CLI boundaries.

The next redesign changes the default `Work` surface from a multi-pane
operating dashboard into a conversation terminal. Auxiliary panes remain
available through tabs, but they stop competing with the first screen.

## Product Intent

The target experience is:

```text
my-project - @codex - iter 2/5 - risk low

user
  Fix the login validation bug

@codex run_2798 ok
  Found issue in auth.ts:42 and patched it.
  check passed: pnpm test
  risk medium: .env.example modified

user
  Now fix the logout handler too

+-- @codex run_3012 running ------------------------------+
| Reading logout.ts...                                    |
| Found stale session cleanup missing                     |
| Editing logout.ts:28-35                                 |
| Running tests...                                        |
| 4 tests passed                                          |
| _                                                       |
+---------------------------------------------------------+

> @codex prompt
[W]ork [R]uns [V]iew [G]raph [T]asks [M]em ?help
```

Design goals:

- make the conversation flow the default mental model;
- show active agent work as stable boxed objects;
- keep run/check/risk/review events inline with the conversation;
- move Runs, Review, Graph, Tasks, and Memory to explicit auxiliary tabs;
- preserve all existing local-first and audit-only boundaries.

Non-goals:

- no project or room browser inside the TUI;
- no web server, browser dashboard, cloud backend, login, or remote execution;
- no raw log, full diff, task brief, context pack, or memory browser by
  default;
- no automatic apply, merge, push, pull request creation, branch deletion,
  repository context export, worktree cleanup, or memory approval;
- no new SQLite tables unless a later implementation proves the current records
  cannot answer a concrete query.

## Technical Design

### Read Model Extensions

Extend `TuiCurrentContextModel` with two Work-specific projections:

```ts
interface TuiCurrentContextModel {
  // existing fields remain unchanged
  conversation: TuiConversationEntry[];
  activeRuns: TuiActiveRunBox[];
}

type TuiConversationEntryType =
  | "user_message"
  | "assistant_message"
  | "agent_completed"
  | "agent_failed"
  | "review_decided"
  | "delegation";

interface TuiConversationEntry {
  id: string;
  type: TuiConversationEntryType;
  timestamp: string;
  author: string;
  content: string;
  agent?: string;
  runId?: string;
  roleCallId?: string;
  statusLabel?: string;
  verificationLine?: string;
  riskLine?: string;
  decision?: "accepted" | "rejected";
}

interface TuiActiveRunBox {
  runId: string;
  agent: string;
  state: "queued" | "running" | "awaiting_review";
  tone: "green" | "yellow" | "red";
  title: string;
  outputLines: string[];
  evidenceLines: string[];
  actionHint?: string;
  createdAt: string;
  updatedAt: string;
}
```

Build rules:

- Derive `conversation` from persisted conversation messages, terminal run
  summaries, RoleCall creation/delegation events, and `review_decision`
  artifacts.
- Keep ordering timestamp-stable and deterministic. Conversation messages use
  message sequence first, then timestamp; run and review entries use run or
  artifact timestamps.
- Exclude runs represented in `activeRuns` from folded `agent_completed` or
  `agent_failed` entries to prevent duplicate first-screen state.
- Treat queued/running task runs as active boxes.
- Treat the newest terminal run with `reviewDecision.status === "pending"` as
  an optional `awaiting_review` box when it is the current selected or most
  recent actionable run.
- Populate `outputLines` from the latest bounded `RunEvent` messages of type
  `stdout`, `stderr`, `message`, `status`, or `error`.
- Populate `evidenceLines` from existing verification, risk, and diff
  summaries. Do not read raw patches or full logs for the Work view.
- Bound line counts and characters at the read-model layer so the renderer can
  remain simple and deterministic.

No persistence schema change is required for the first implementation.

### Renderer Changes

Keep the existing Ink entrypoint and callback boundary. The renderer still
receives models and explicit callbacks from `apps/cli/src/tui.ts`; it must not
read SQLite, filesystem, git, shell, or adapter APIs directly.

Change `TuiInkFrame` ordering to:

```text
HeaderBar
Warnings/status
MainView
Composer
FocusTabs
StatusBar
```

`WorkView` becomes the conversation terminal:

- `ConversationFlow` renders bounded historical entries and scroll state.
- `ActiveRunBox` renders active or awaiting-review runs after the latest
  conversation entry.
- Auxiliary panes are not shown inside Work.
- Runs, Review, Graph, Tasks, Memory, Help, and Palette keep using the existing
  pane components as focused auxiliary views.

`HeaderBar` should compress to one line:

```text
project - @agent - iter N/M - risk level
```

Narrow terminals hide fields from the right side first: risk, iteration, agent.

`ActiveRunBox` behavior:

- fixed height by default: one title line, six content lines, one action or
  cursor line;
- truncate long lines rather than wrapping them into layout shifts;
- green for queued/running, yellow for awaiting review, red only for failed
  active-state errors;
- show at most three boxes; if more exist, collapse the oldest boxes to title
  lines.

`ConversationFlow` behavior:

- bottom-anchored by default;
- `up/down`, `j/k`, `page_up/page_down`, `home/end` scroll the conversation in
  Work focus;
- show a compact range indicator when history is scrolled;
- render run summaries with check and risk lines, not raw event streams.

### Keyboard And State

Keep the existing reducer-driven `TuiInkState`, then add Work-specific state:

```ts
interface TuiInkState {
  // existing fields remain
  selectedActiveRunIndex: number;
  conversationScrollOffset: number;
}
```

Keyboard rules:

- `enter` submits the composer when non-empty.
- `esc` clears the composer when non-empty.
- `w/r/v/g/t/m` switch Work, Runs, Review, Graph, Tasks, and Memory when the
  composer is empty. The implementation can distinguish lowercase `r` for
  Runs from uppercase `R` for reject.
- `?` opens Help; `:` opens Palette.
- `tab` and `shift-tab` keep cycling focus modes.
- `a` accepts the current awaiting-review run only through the existing
  audit-only review decision callback.
- `R` rejects the current awaiting-review run only through the existing
  audit-only review decision callback.
- `c` prepares an explicit continuation prompt; it does not start background
  work.
- `x`, `q`, and `ctrl+c` exit only when doing so will not discard visible
  composer text unexpectedly.

Review decisions keep the same safety boundary: they write review artifacts
only and never apply files, alter run status, approve memory, clean worktrees,
merge, push, or open pull requests.

### Auxiliary Panes

Auxiliary panes remain current-context views:

- `Runs`: active/recent run list plus detail and CLI commands.
- `Review`: selected run or RoleCall evidence.
- `Graph`: RoleCall graph and loop state.
- `Tasks`: current tasks, assignments, RoleTodos, and follow-ups.
- `Memory`: memory counts, approved source, selected skills, and explicit CLI
  commands.
- `Help`: keyboard help and command mapping.
- `Palette`: current-context CLI commands.

These panes may be visually polished, but the first implementation should keep
their data sources and side-effect rules unchanged.

## Implementation Roadmap

### Phase CT-0: Design Documents

Status: this document.

Scope:

- Add this technical roadmap.
- Add a local ignored prompt companion at
  `docs/tui-conversation-terminal-implementation-prompts.md`.
- Link the roadmap from existing TUI, product, and architecture docs.
- Do not change runtime code.

Acceptance:

- `git diff --check` passes.

### Phase CT-1: Conversation And Active-Run Read Models

Scope:

- Add `conversation` and `activeRuns` to `TuiCurrentContextModel`.
- Build folded terminal run entries and review-decision entries from existing
  persisted evidence.
- Build active run boxes from queued/running runs and newest actionable pending
  review run.
- Add unit coverage in `tests/tui-read-model.test.ts`.

Acceptance:

- Empty, running, succeeded, failed, pending-review, review-decided, and
  delegated RoleCall states produce deterministic read models.
- Existing TUI model fields remain backward-compatible for auxiliary panes.

Verification:

```sh
pnpm typecheck
pnpm test tests/tui-read-model.test.ts
```

### Phase CT-2: WorkView Conversation Renderer

Scope:

- Replace the Work dashboard layout in `apps/cli/src/tui-ink/App.mts` with
  `ConversationFlow` and `ActiveRunBox`.
- Move `FocusTabs` below the composer.
- Keep auxiliary focus panes unchanged.
- Add Ink render tests for 80, 100, and 140 column layouts.

Acceptance:

- The Work first screen reads as a conversation terminal.
- Runs/Review/Graph panes are accessible only through focus switches, not
  embedded inside Work.
- Active boxes keep stable dimensions and truncate long output lines.

Verification:

```sh
pnpm typecheck
pnpm test tests/cli-tui-ink.test.mts
```

### Phase CT-3: Live Active Boxes And Awaiting Review

Scope:

- Tail recent run event messages into `ActiveRunBox.outputLines`.
- Render queued/running and awaiting-review states with distinct tones.
- Wire Work-level `a` and `R` shortcuts to the existing review-decision
  callback for the current awaiting-review run.
- Refresh immediately after review decisions.

Acceptance:

- Running boxes update through the existing polling path.
- Awaiting-review boxes disappear after accept/reject and become folded
  conversation entries.
- Review shortcuts remain audit-only.

Verification:

```sh
pnpm typecheck
pnpm test tests/cli-tui-ink.test.mts tests/cli-tui.test.ts
```

### Phase CT-4: Keyboard, Tabs, And Scroll Polish

Scope:

- Add direct `w/r/v/g/t/m` focus keys.
- Make Work scroll operate on `conversationScrollOffset`.
- Preserve selection and scroll state across model refreshes.
- Tighten StatusBar hints for composer, Work, auxiliary panes, and
  awaiting-review state.

Acceptance:

- Composer text is never stolen by global shortcuts.
- Work scroll is bottom-anchored by default and recoverable with `end`.
- The tab bar accurately reflects available focus modes and shortcuts.

Verification:

```sh
pnpm typecheck
pnpm test tests/cli-tui-ink.test.mts
```

### Phase CT-5: Hardening And Manual Terminal QA

Scope:

- Cover small terminals, many active runs, long lines, missing linked-run
  evidence, unavailable agent CLIs, failed refresh, and no-current-context
  fallback models.
- Rebuild the CLI.
- Manually verify `agent-hub tui --once` and an interactive launch in a real
  terminal.
- Update `docs/product.md` and `docs/architecture.md` with implemented
  behavior.

Acceptance:

- No primary Work content is hidden behind empty auxiliary panels.
- The terminal exits cleanly and restores input after submit, refresh failure,
  review decision, and timeout paths.
- A concise UI verification note is written under `docs/ui-verification/` as a
  local ignored artifact unless explicitly requested for publication.

Verification:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
node apps/cli/dist/cli.js tui --once
```

## Implementation Risks

- Conversation folding can duplicate state if active runs are not excluded from
  terminal summaries.
- Pending-review boxes need a clear selection rule because review state is an
  artifact, not a separate `TaskRunStatus`.
- Lowercase focus keys and uppercase review rejection must be handled
  explicitly so `r` can switch Runs while `R` rejects.
- Fixed-height boxes need terminal-height fallbacks for very small terminals.
- The read model must keep output bounded; otherwise stdout-heavy runs can make
  Ink rendering unstable.

## File Touch Map

Expected implementation files:

- `packages/core/src/tui-read-model.ts`
- `tests/tui-read-model.test.ts`
- `apps/cli/src/tui-ink/App.mts`
- `apps/cli/src/tui-ink/state.mts`
- `apps/cli/src/tui-ink/format.mts`
- `tests/cli-tui-ink.test.mts`
- `tests/cli-tui.test.ts`
- `docs/product.md`
- `docs/architecture.md`

The first implementation should stay a small vertical slice: read model,
WorkView renderer, tests, and documentation. Broader pane redesigns should be
separate tasks.
