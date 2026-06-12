# TUI V3 Roadmap

Status: implementation in progress; V3-1 through V3-5 implemented
Last updated: 2026-06-12

This roadmap defines the next major terminal UI refactor for Agent Hub. It is
based on the current Ink TUI and the V3 reference direction: a dense,
conversation-first local workbench with a persistent navigation rail, a main
workflow surface, a selected-object detail panel, and bottom composer/hotkey
chrome.

The goal is not to make a desktop clone. The TUI remains a keyboard-first
current-context terminal workbench over local persisted evidence. It still
must not become a project browser, raw log viewer, apply/merge surface, PR
creator, memory auto-approver, cloud dashboard, server, or remote execution
client.

## Target Experience

The V3 shell should feel like a compact operations console:

```text
AGENT HUB | AgentHub | room:core/tui | role:@implementer | mode:runtime_injection | Work | 14:32
----------------------------------------------------------------------------------------------
 Work [12]   | Work - Conversation                         | Block Detail                  [x]
 Graph [core]| 14:17 user                                  | Selected: 14:24 @implementer
 Runs [7]    |   current TUI is too sparse...              | ------------------------------
 Review [2]  |                                             | Message
 Tasks [18]  | 14:19 @researcher  > 9 files read           | Render WorkView as conversation
 Memory [3]  |   audit found density and diff issues       | blocks with folded tool calls.
 Team [6]    |   apps/cli/src/tui-ink/App.mts:1216         |
 Help [?]    |                                             | Tool Calls (5)
             | >14:24 @implementer  > 5 tool calls         | > read_file App.mts
             |   I will move WorkView from dashboard...    | > write_file WorkView.mts
             |                                             | Commands
----------------------------------------------------------------------------------------------
 > @codex refine Work conversation stream...
 keys: up/down/j/k move | Enter/o detail | >/< fold tools | za fold all | ? help | / palette
 Work: 24 blocks | online | normal | unread 0 | abnormal 0
```

The same shell should host focused workbenches for Memory and Team:

- `Work`: conversation blocks, active blocks, folded tool calls, file refs,
  final report blocks, selected block details, and evidence refs.
- `Memory`: proposal table, evidence excerpts, approved-memory index, selected
  proposal details, and explicit approve/reject/edit/open controls only when
  wired through audited local actions.
- `Team`: roles table, delegation matrix, recent RoleCalls, selected role
  profile, verification profile, boundaries, limits, and recent failures.

## Design Rules

- Keep the visual language terminal-native: box borders, compact tables,
  status dots, readable selected-row emphasis, and stable column budgets.
- Use cyan for focus and paths, green for healthy/approved/runnable, yellow for
  pending/proposed/stale, red for rejected/failed/denied/blocking, purple only
  for secondary metadata such as skills.
- Preserve current full-output guarantees. Completed agent replies should
  remain scrollable instead of being destroyed by summaries.
- Fold noisy structures, not human-facing content. Tool-call lists, evidence
  refs, artifacts, and snippets can fold; final answers and user prompts remain
  readable.
- Prefer text tables where comparison matters. The renderer must account for
  CJK and display-width wrapping so table borders, row selections, and side
  panels do not break.
- Keep Work prompt-first. Mutation-heavy actions stay in Review, Memory, Team,
  or explicit detail panes.
- Long ids and full CLI commands belong in detail panels or the palette, not
  permanent footer chrome.

## Current Support And Gaps

The current code already supports these foundations:

- Ink renderer boundary under `apps/cli/src/tui-ink`.
- Core TUI read model under `packages/core/src/tui-read-model.ts`.
- Current-context fields for `conversation`, `activeRuns`, typed Work blocks,
  transcript, runs, RoleCalls, review, tasks, team, memory, skills, and
  warnings.
- Work conversation flow plus bounded active-run boxes.
- Display-width-aware wrapping for mixed CJK/code/path output.
- Team focus mode as a simple read-model summary pane, and Memory focus mode
  as a proposal governance table with selected-row detail.
- Command palette, search, timeline, composer history, mention completion, and
  non-blocking interactive prompt submission.
- Read-model polling over persisted local evidence; no renderer direct access
  to SQLite, git, shell, filesystem, or adapters.

The reference UI requires functionality that is only partially supported:

- A persistent side navigation rail exists conceptually through focus modes,
  but the current renderer does not use a stable left rail across all views.
- The right detail panel is not a generic selected-object contract. Current
  views render details inline and inconsistently.
- Work blocks now have a typed presentation model with stable ids, speaker,
  timestamp, status, message lines, inferred tool summaries, file refs,
  command lines, evidence lines, and inline diff references. Structured
  tool-call lifecycle data such as exact status and duration remains
  unavailable unless adapters persist it.
- Per-block artifacts are still limited by the current read model. Commands,
  file refs, evidence refs, inline diff summaries, and fix snippets are
  projected only when existing conversation, active-run, or diff evidence can
  support them.
- Live run detail now shows speaker, running state, started time, elapsed
  label, spinner state, streaming output tail, inferred tool-call text,
  inferred active commands, and pending-artifact placeholders. It still does
  not expose typed tool-call lifecycle rows or queued/running command status
  unless those become persisted evidence.
- Memory now exposes bounded proposal rows with category, lifecycle status,
  confidence, source run/task, summary, update time, recommended action,
  evidence excerpts, writeback target when stored, source commands, and
  selected-row details. Related skills/memory joins and editable action state
  remain unavailable.
- Team is currently a role summary list. It does not expose a delegation matrix,
  selected role profile, allowed tools, verification commands, limits, recent
  failures, or next action as first-class TUI fields.
- Table sorting, table filters, and per-view search controls are not generic
  primitives.
- Approve/reject/edit/open controls for memory proposals must not be added as
  renderer-side shortcuts until they have explicit audited local action
  callbacks. Showing equivalent CLI commands is acceptable before callbacks
  exist.

The reference UI asks for capabilities that should remain out of scope unless a
future explicit product decision changes the boundary:

- automatic memory approval;
- automatic code apply, merge, push, PR creation, branch deletion, or worktree
  cleanup;
- raw logs or full patches in the default Work view;
- direct renderer access to repositories, filesystem, shell, git, SQLite, or
  adapter processes;
- new persistence tables just to satisfy a visual layout before a concrete
  query or lifecycle need is proven.

## Architecture Direction

V3 should keep the existing boundary:

```text
apps/cli/src/tui.ts
  -> packages/core/src/tui-read-model.ts
  -> apps/cli/src/tui-ink/App.mts
  -> explicit callbacks for prompt submit / review decision / future audited actions
```

New renderer primitives should be local to the Ink island first:

- `ShellFrame`: header, side nav, main region, detail region, composer,
  hotkeys, status.
- `SideNav`: focus modes with counts and compact labels.
- `WorkbenchLayout`: wide two/three-column layout and narrow single-column
  fallback.
- `DetailPane`: selected-object panel with section blocks.
- `DataTable`: fixed-width terminal table with selected row, scroll offset,
  default sort label, and display-width-safe truncation.
- `FoldableSection`: collapsed/expanded section chrome.
- `EvidenceList`: links, snippets, commands, and artifacts rendered with safe
  truncation and existing sensitive-path redaction.

Read-model additions should be typed and presentation-oriented, not
renderer-owned data access:

```ts
interface TuiSelectionDetail {
  id: string;
  kind: "work_block" | "run" | "role_call" | "memory" | "team_role" | "task";
  title: string;
  subtitle?: string;
  sections: TuiDetailSection[];
  commands: string[];
  actions: TuiDetailAction[];
}

interface TuiDetailSection {
  id: string;
  title: string;
  tone?: "normal" | "success" | "warning" | "danger" | "info";
  lines: string[];
  collapsedByDefault?: boolean;
}

interface TuiDetailAction {
  key: string;
  label: string;
  kind: "focus" | "prepare_command" | "callback";
  disabledReason?: string;
}
```

The exact shape can change during implementation, but the important contract is
that the renderer consumes detail payloads and invokes explicit callbacks; it
does not assemble detail data through direct storage access.

## Roadmap

### Phase V3-0: Spec And Prompt Pack

Goal: capture the V3 refactor and capability gaps before changing runtime
behavior.

Scope:

- Add this roadmap.
- Add a local ignored implementation prompt companion at
  `docs/tui-v3-implementation-prompts.md`.
- Cross-link the plan from `docs/product.md` and `docs/architecture.md`.
- Explicitly mark unsupported or partially supported bottom-layer features.

Acceptance:

- `git diff --check` passes.
- The prompt companion remains ignored unless the user explicitly asks to
  publish implementation prompts.

### Phase V3-1: Unified Shell Frame

Status: implemented.

Goal: make all focus modes share the reference shell.

Scope:

- Add header, left nav, main region, optional right detail region, composer,
  hotkey bar, and status bar primitives.
- Preserve the existing Work, Runs, Review, Graph, Tasks, Memory, Team, Help,
  palette, search, timeline, and composer behavior.
- Add responsive rules:
  - wide: nav + main + detail;
  - medium: nav + main with collapsible detail;
  - narrow: single main column, detail opens as a focused panel.
- Keep row-budget logic explicit so content never overlaps fixed chrome.

Acceptance:

- Existing focused renderer tests still pass.
- `80x24`, `120x36`, and `48x20` one-shot renders keep header, view body,
  composer, hotkeys, and status coherent.
- No renderer direct access to local stores or shell is introduced.

### Phase V3-2: Selection And Detail Contract

Status: implemented.

Goal: add a common detail model before rebuilding individual views.

Scope:

- Extend reducer state with selected work block, selected memory item, selected
  team role, detail visibility, and fold state.
- Add read-model detail builders for existing runs, RoleCalls, tasks, team
  roles, and memory summary placeholders.
- Render detail sections consistently on the right.
- Use placeholder detail sections for unsupported data rather than inventing
  fake evidence.

Acceptance:

- `Enter/o` opens detail for the selected object.
- Missing bottom-layer data is shown as "not available in current read model"
  with equivalent CLI commands when available.
- Selection does not jump during polling refresh.

### Phase V3-3: Work Conversation Blocks

Status: implemented.

Goal: match the Work reference surface.

Scope:

- Convert rendered conversation entries into block rows with stable ids,
  speaker, timestamp, status dot, foldable sections, and selected styling.
- Add block details for message text, tool-call text summaries, commands,
  artifacts, evidence refs, inline diff summary, and fix snippets where the
  underlying persisted evidence exists.
- Preserve current filtering of protocol noise such as `thread.*`,
  `assistant.*`, `turn.*`, and `session.*`.
- Keep completed agent content visible and scrollable by default.

Unsupported data to call out in UI/tests:

- structured tool-call durations may be unavailable;
- command lists may only be inferred from verification commands or run output;
- artifacts may be incomplete unless run artifacts exist;
- fix snippets should render only when derived from existing diff/review data.

Acceptance:

- Work looks like a conversation stream, not a table dashboard.
- Selected block detail is useful even when some sections are unavailable.
- CJK, code fences, file paths, and inline links wrap without breaking borders.

### Phase V3-4: Live Run Detail

Status: implemented.

Goal: make running blocks inspectable without raw-log noise.

Scope:

- Add live block detail for speaker, state, started time, elapsed time,
  spinner, folded tool calls, streaming output tail, active commands, and
  pending artifacts.
- Keep active output derived from persisted run events and the existing
  readability filter.
- Preserve non-blocking interactive submit and per-project same-role queueing.

Unsupported data to call out:

- true tool-call lifecycle requires structured adapter events. Until then,
  render inferred tool-call lines as text with "inferred" labels.
- queued command status may be absent unless verification or run events expose
  it.

Acceptance:

- Polling updates do not reset selection or fold state.
- Active-run rendering does not flicker or force the composer to wait for
  agent completion.

### Phase V3-5: Memory Workbench

Goal: replace the Memory summary pane with proposal governance.

Status: implemented. The read model now emits bounded `TuiMemoryRow` records
and selected-row detail payloads; the Ink Memory pane renders the rows with
status coloring, source/update/action columns, and safe CLI commands. Direct
approve/reject/edit callbacks remain disabled until audited local actions exist.

Scope:

- Extend the read model with memory proposal rows: id, category, status,
  confidence, source run/task, summary, updated time, and recommended action.
- Add selected proposal detail: memory text, why it matters, evidence excerpts,
  writeback target, related skills, related memory, source commands, and
  controls.
- Add evidence excerpt rows only from stored local evidence. Do not synthesize
  unsupported proof.
- Wire approve/reject/edit/open only through explicit audited callbacks if
  those callbacks exist. Otherwise render safe CLI commands in detail.

Unsupported data to call out:

- related skills and related memory may require new read-model joins;
- writeback target may need context-store path resolution;
- edit-in-TUI requires an explicit callback and validation flow;
- approve/reject shortcuts require audited local action callbacks, not direct
  renderer mutation.

Acceptance:

- Proposed, approved, rejected, and retired/stale audit rows render distinctly.
- The TUI never implies memory has been approved unless the local lifecycle
  record says so.

### Phase V3-6: Team Workbench

Goal: replace the Team summary pane with a local role operations view.

Scope:

- Extend the read model with role rows, a delegation matrix, recent RoleCalls,
  and selected role profile detail.
- Role profile should include executor, status, active calls, delegation
  ability, verification profile, mission, boundaries, allowed tools, context
  policy, default skills, verification commands, limits, recent failures, and
  next suggested action where supported.
- Reuse preset/custom roles and existing RoleCall evidence.

Unsupported data to call out:

- mission, boundaries, allowed tools, verification profile, and limits may not
  exist as normalized persisted fields for every role;
- recent failures may need to be derived from run and RoleCall summaries;
- delegation matrix may require policy summary helpers in core/safety;
- verification commands per role may need existing role metadata to be
  normalized before the TUI can display them reliably.

Acceptance:

- Team gives the operator a clear local role map without adding a new role
  persistence surface.
- Deny/allow matrix data is real policy evidence or explicitly marked
  unavailable.

### Phase V3-7: Table, Fold, Search, And Help Polish

Goal: make the V3 shell efficient for repeated keyboard use.

Scope:

- Add shared table selection, scroll, default sort labels, and compact filters.
- Add fold controls for tool calls, evidence refs, snippets, and detail
  sections.
- Normalize hotkeys:
  - `Tab` focus;
  - `Up/Down/j/k` move;
  - `Enter/o` detail;
  - `Space` or `>`/`<` fold;
  - `za` fold all;
  - `O` open all;
  - `/` palette;
  - `?` help;
  - `x` close detail or exit overlay.
- Update Help and Palette so every visible action has an equivalent local
  command or an explicit callback boundary.

Acceptance:

- Hotkeys do not steal normal composer text.
- Narrow output remains structurally coherent.
- Help fits normal and narrow terminals.

### Phase V3-8: Verification And Release Hardening

Goal: make V3 changes hard to regress.

Scope:

- Add focused read-model and renderer tests for Work, Memory, Team, detail
  panels, wide/narrow layouts, CJK wrapping, and unsupported-data placeholders.
- Rebuild before manual UI judgment.
- Perform manual PTY checks and write an ignored verification note under
  `docs/ui-verification/`.

Expected verification:

```sh
./node_modules/.bin/tsc -b apps/cli/tsconfig.tui-ink.json
./node_modules/.bin/vitest run tests/cli-tui-ink.test.mts tests/tui-read-model.test.ts tests/cli-tui.test.ts
./node_modules/.bin/pnpm build
./node_modules/.bin/pnpm typecheck
./node_modules/.bin/pnpm lint
./node_modules/.bin/pnpm test
git diff --check
```

Manual smoke should include rebuilt `--once` and interactive PTY launches at
normal and narrow sizes:

```sh
stty cols 120 rows 36
node apps/cli/dist/cli.js tui --once

stty cols 80 rows 24
node apps/cli/dist/cli.js tui --once

stty cols 48 rows 20
node apps/cli/dist/cli.js tui --once
```

## Prompt Pack Summary

The detailed implementation prompts live in the local prompt companion:

```text
docs/tui-v3-implementation-prompts.md
```

At a high level:

1. implement the shell frame without changing behavior;
2. add the selection/detail contract with unsupported-data placeholders;
3. rebuild Work as conversation blocks;
4. add live run detail;
5. upgrade Memory into a governance table and detail view;
6. upgrade Team into a role operations view;
7. polish tables/folds/search/help;
8. complete focused tests and manual PTY verification.
