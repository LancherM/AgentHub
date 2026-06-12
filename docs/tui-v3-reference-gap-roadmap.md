# TUI V3 Reference Gap Roadmap

Status: proposed follow-up
Last updated: 2026-06-12

This document audits the current `codex/tui-v3-roadmap` branch against the V3
reference screens and defines the next implementation pass. The current branch
implements important V3 mechanics: the Ink shell frame, side navigation,
selection details, Work blocks, live run detail, Memory rows, Team role
profiles, fold controls, and verification hardening. The remaining gap is not
mainly data plumbing. It is reference fidelity: density, borders, master/detail
composition, view-specific detail semantics, and deterministic visual QA.

## Current Branch Snapshot

The current branch one-shot output at a wide terminal roughly renders as:

```text
agent-hub · @codex · iter 0 · risk low                                         14:07
attention: executor unavailable 6 T | memory proposed 8 M
> Work 2      > user 04:51:30                         Block Detail
  Graph 0       Check wrapping smoke...                | user message
  Runs 1        ────────────────────────────           | Message
  Review 0      ┃ @fake run_bf2172c1 ✓ completed       |   Check wrapping...
  Tasks 1     ┃   @fake completed without output.      | Tool Calls (collapsed)
  Memory 8    ┃   ~ verification passed (1 checks)     | Artifacts (collapsed)
  Team 7      ┃   ⚠ risk low: No changed files...
  Help ?      ┃   [1] Continue
send @codex thread ...
> @codex prompt
[W]ork [R]uns [V]iew [G]raph [T]asks [M]em Team ?
keys: type prompt | @ agents | C continue | L timeline | : palette | ? help | x exit
```

This confirms the branch has V3 building blocks, but the screen still reads as
the previous conversation-terminal UI with a left nav and a generic detail
column attached. It does not yet match the reference console.

## Reference Gap Summary

### Shell Chrome

Current:

- Header is compact but generic: `agent-hub · @codex · iter 0 · risk low`.
- It omits the reference's explicit brand, project display name, room, role,
  context mode, focused view, and right status/clock rhythm.
- Side nav and bottom focus tabs duplicate navigation.
- Main/detail regions are adjacent text columns without full panel borders.
- Attention and status rows are functional but not integrated into the framed
  shell.

Reference target:

- Header line:
  `AGENT HUB | project | room | role | mode | focus | clock/status`.
- Full-width framed shell with visible horizontal separators.
- Left nav, main panel, and detail panel use consistent vertical borders.
- Bottom area has three distinct bands: composer, hotkeys, status.
- Once side nav is present, bottom focus tabs should become a compact hotkey
  map or disappear to avoid duplicate navigation.

### Work View

Current:

- Work still renders through `ConversationFlow` with older `┃` agent-line
  styling.
- The selected row marker is subtle and not a rectangular selected block.
- There is no clear time gutter, speaker column, right status-dot column, or
  block card boundary.
- Tool-call and artifact evidence exists mostly as detail sections or inferred
  metadata, not as compact inline block affordances.
- The main panel has no title row like `Work - Conversation` with status/counts.

Reference target:

- Main panel title row: `Work - Conversation` plus mode/status/count metadata.
- Each block has a stable shape:
  `time | speaker | folded summary | status dot`.
- Selected block uses a cyan rectangular outline or equivalent terminal-safe
  selection frame.
- Completed and final-report blocks show evidence refs and fix snippets as
  foldable inline affordances.
- Running blocks show live state, spinner, elapsed, tool-call count, and
  output tail without becoming raw logs.

### Detail Panel

Current:

- The right panel always says `Block Detail`.
- Sections are rendered as plain `| Section` lines and values, with only
  collapsed labels.
- Detail content is capped uniformly and lacks divider hierarchy.
- Work, live run, Memory, Team, Review, and RoleCall details share too much
  visual language.

Reference target:

- View-specific titles:
  - Work selected block: `Block Detail`.
  - Running block: `Live Block Detail`.
  - Memory row: `Proposal Detail`.
  - Team row: `Role Profile`.
  - Review/final output: `Final Report Detail`.
- Detail sections use visible dividers and section colors.
- Tool Calls, Commands, Artifacts, Evidence, Fix Snippet, Controls, and
  Related sections have stable ordering.
- Details need their own scroll budget or paging behavior instead of silently
  slicing each section to six lines.

### Memory View

Current:

- Memory uses a row list, but it is still a simple pane.
- It does not show the reference's stacked structure:
  memory inbox controls, proposal table, evidence excerpts, approved-memory
  index, and side proposal detail.
- Columns do not match the reference: `ID`, `Category`, `Status`, `Conf`,
  `Source Run`, `Summary`, `Action`.
- Detail title and controls are generic.
- Related skills/memory are unavailable placeholders.

Reference target:

- Memory main panel has three bands:
  1. `Memory Inbox` filter/search/table.
  2. `Evidence Excerpts (selected: ...)`.
  3. `Approved Memory Index`.
- Right panel is `Proposal Detail`, not generic block detail.
- Controls show explicit disabled/enabled states for `[a] Approve`,
  `[R] Reject`, `[e] Edit`, `[o] Open Source`.
- Unsupported related skills/memory should stay explicit, but the visual slot
  should exist.

### Team View

Current:

- Team has role rows, recent RoleCalls, delegation matrix rows, and selected
  role detail.
- The main panel is not yet a dense table plus matrix plus recent list with
  reference-like column separators.
- Delegation matrix is row text, not a caller/callee grid.
- The local-only badge and role-profile detail are not visually emphasized.

Reference target:

- Team main panel:
  1. Roles table with columns `role`, `executor`, `status`, `active`,
     `max calls`, `default skills`, `can delegate`, `verification profile`.
  2. Delegation matrix as a true grid.
  3. Recent RoleCalls table.
- Right panel title is `Role Profile`.
- Role detail uses stable sections: Mission, Boundaries, Allowed Tools,
  Context Policy, Default Skills, Verification Commands, Limits, Recent
  Failures, Next Suggested Action.

### Visual QA

Current:

- Tests verify render snippets, widths, and unsupported placeholders.
- Manual verification notes exist.
- There is no deterministic fixture that produces screens matching the
  reference scenarios.

Reference target:

- Add seeded TUI fixture models for Work, live Work, Memory, and Team that
  intentionally mirror the reference screenshots.
- Generate text snapshots/contact sheets at reference-like sizes such as
  `154x42`, `160x48`, `120x36`, and `80x24`.
- Make the visual-diff acceptance criteria explicit: panel borders, titles,
  nav counts, detail titles, bottom bands, selected row/block, and CJK wrapping
  must be present.

## Follow-Up Roadmap

### Phase V3R-0: Reference Gap Spec

Goal: record the current-branch gap against the reference screens.

Scope:

- Add this follow-up roadmap.
- Add a local ignored implementation prompt companion at
  `docs/tui-v3-reference-gap-implementation-prompts.md`.
- Cross-link the follow-up from product and architecture docs.
- Do not change runtime behavior.

Acceptance:

- `git diff --check` passes.
- Prompt companion remains ignored by `docs/*-implementation-prompts.md`.

### Phase V3R-1: Framed Shell Fidelity

Goal: make the shell match the reference console before changing view content.

Scope:

- Replace the generic header with a branded metadata header:
  `AGENT HUB | project | room | role | mode | focus | clock/status`.
- Add terminal-safe panel borders around side nav, main view, and detail panel.
- Split bottom chrome into composer, hotkey, and status bands.
- Remove or demote bottom focus tabs when side nav is visible.
- Ensure attention/status rows sit inside the shell rather than floating above
  the frame.

Data support:

- Mostly renderer work.
- Room/role/mode/focus already exist partially in read-model/context and state,
  but header copy may need small read-model additions for selected role and
  room fallback labels.

Acceptance:

- Wide Work output visibly matches the reference layout skeleton.
- Narrow output remains coherent and does not add overlapping borders.

### Phase V3R-2: Work Block Renderer Rewrite

Goal: stop rendering Work through legacy `ConversationFlow` lines and render a
real block list.

Scope:

- Introduce a dedicated `WorkBlockList` renderer.
- Add a title/status row: `Work - Conversation`, `Normal`, block count, and
  scroll mode.
- Render a time gutter, speaker column, content column, and status-dot column.
- Render selected blocks with a cyan rectangular outline or equivalent
  terminal-safe frame.
- Render folded inline affordances for tool calls, files read/updated,
  evidence refs, snippets, and final reports.
- Keep full message output scrollable; do not replace answers with summaries.

Data support:

- Current `TuiWorkBlock` is enough for first pass.
- True typed tool-call duration/status remains unavailable unless adapters
  persist structured events. Continue to label inferred tool summaries.

Acceptance:

- The Work screenshot no longer reads as the old `┃` conversation view.
- Selected block and status dots are obvious at `154x42`, `120x36`, and
  `80x24`.

### Phase V3R-3: Detail Panel Semantics And Scrolling

Goal: make details view-specific and reference-like.

Scope:

- Map selected detail kinds to titles:
  `Block Detail`, `Live Block Detail`, `Proposal Detail`, `Role Profile`,
  `Final Report Detail`.
- Add section dividers and consistent section order.
- Add detail scroll/paging state instead of per-section silent six-line caps.
- Render Controls sections with enabled/disabled state.
- Preserve unavailable-data placeholders, but style them as deliberate empty
  slots rather than incidental text.

Data support:

- Existing `TuiSelectionDetail` covers most content.
- State needs a detail scroll offset or selected-section cursor.

Acceptance:

- Right panel has the same information hierarchy as the references.
- Long details remain inspectable without hiding arbitrary section tails.

### Phase V3R-4: Memory Reference Workbench

Goal: make Memory match the reference inbox/proposal workflow.

Scope:

- Render `Memory Inbox` controls: view, status, confidence, search.
- Render the proposal table with reference columns:
  `ID`, `Category`, `Status`, `Conf`, `Source Run`, `Summary`, `Action`.
- Add a lower `Evidence Excerpts` table for the selected row.
- Add an `Approved Memory Index` band.
- Use `Proposal Detail` right panel with Controls and related slots.

Data support:

- Current memory rows support a first pass.
- Search/filter UI can be local renderer state.
- Related skills/memory joins remain unsupported unless a new read-model helper
  is added.
- Approve/reject/edit/open remain disabled unless audited callbacks are added.

Acceptance:

- The Memory view visually resembles the reference, even when related sections
  are unavailable.
- No memory lifecycle mutation happens without explicit audited callbacks.

### Phase V3R-5: Team Reference Workbench

Goal: make Team match the reference roles/matrix/profile workflow.

Scope:

- Render a dense Roles table with reference columns.
- Add a visible `local-only` badge.
- Render the delegation matrix as a caller/callee grid where terminal width
  allows, falling back to rows on narrow terminals.
- Render Recent RoleCalls as a table.
- Use `Role Profile` right panel with reference section names and ordering.

Data support:

- Current Team read model has enough for role rows and recent calls.
- True matrix fidelity depends on role `delegationPolicy`; missing policy must
  render as unavailable, not inferred.
- `max calls`, verification profile, allowed tools, and limits are only real
  when role metadata provides them.

Acceptance:

- Team no longer looks like a simple list with appended sections.
- Matrix deny/allow values are backed by policy evidence or explicitly marked
  unavailable.

### Phase V3R-6: Reference Fixtures And Visual QA

Goal: make "looks like the reference" testable.

Scope:

- Add deterministic model fixtures for:
  - Work completed block detail.
  - Work live block detail.
  - Memory proposal detail.
  - Team role profile.
- Render them through the Ink app at `154x42`, `160x48`, `120x36`, and
  `80x24`.
- Add snapshot expectations for:
  - branded header;
  - side/main/detail borders;
  - view-specific detail titles;
  - bottom composer/hotkey/status bands;
  - selected block/row styling;
  - reference table headers;
  - CJK wrapping.
- Write manual PTY notes with the same fixture data.

Acceptance:

- A future implementation cannot pass by merely exposing the data model; the
  visible terminal composition must match the reference contract.

### Phase V3R-7: Interaction Polish

Goal: align keyboard behavior with the reference once layout is stable.

Scope:

- Normalize visible hotkeys to:
  `up/down/j/k move`, `Enter/o detail`, `>/< fold`, `za all fold`,
  `O all open`, `? help`, `/ palette`.
- Keep printable prompt input safe.
- Add detail close behavior that matches `[x]` in the right panel.
- Ensure Work, Memory, and Team each expose focus-specific status text in the
  bottom status band.

Acceptance:

- Hotkey text matches actual behavior.
- No duplicate or contradictory navigation hints remain.
