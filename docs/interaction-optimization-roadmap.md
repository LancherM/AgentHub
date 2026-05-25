# Interaction Optimization Roadmap

Status: planning
Last updated: 2026-05-25

This document records the interaction, UI, conversation, memory, and skill
optimization work identified after the MVP. It complements
`docs/local-ai-workgroup-roadmap.md`: the workgroup roadmap describes the
longer product model, while this document keeps the near-term user experience
small, legible, and implementation-ready.

The main product correction is:

> Keep the system rigorous underneath, but make the surface feel like a simple
> local room conversation with roles, skills, runs, and decisions.

The desktop and CLI can continue storing tasks, run events, context packs,
task briefs, diffs, verification, risk reports, comparison reports, worktree
handoff data, and memory proposals. The default user-facing flow should not
make every internal artifact feel like a first-class concept.

## Experience Principles

- Default visible objects are `Room`, `Role`, `Skill`, `Run`, and `Decision`.
- Internal evidence stays inspectable but secondary: task briefs, context
  packs, logs, diffs, checks, risks, memory proposal details, run events,
  comparison records, lifecycle records, and handoff commands belong behind
  review/inspector surfaces.
- The room transcript should read like a conversation. It should show the user
  message and the agent's answer. It should not permanently show lifecycle
  events, raw stdout, adapter preflight details, or terminal summaries such as
  `Codex exited with code 0`.
- A status surface may show that an agent is working, verifying, cancelled, or
  failed, but completion should collapse back to the agent output and review
  entry points.
- Same-room follow-up turns to the same agent should behave as multi-turn
  conversation by default. Code-state continuation from a retained worktree is
  a separate explicit action.
- Room shared context is a room setting, not approved memory. Turning shared
  context off should stop room history and room summaries from entering new
  runs while leaving approved project memory and explicit role/skill rules
  intact.
- Global skills are user-level methods in Agent Hub-owned app data. They must
  not write into target repositories or sync into `.claude/skills` or
  `.agents/skills` unless the user explicitly runs a previewed export.
- Creation paths must always be visible. Users should be able to add another
  project and create a named room after the first project is registered.
- Controls should explain what will happen: selected agents/roles, context
  mode, shared-context state, no repo-root writes, and number of runs.
- UI polish should reduce decision cost. Button hierarchy, active states,
  segmented controls, keyboard navigation, and progress states should make the
  next action obvious without adding a larger design system.

## Backlog

### Surface Simplification

- Reduce the default surface to Room, Role, Skill, Run, and Decision.
- Move `task brief`, `context pack`, `runtime injection`, raw events, diff,
  logs, verification details, risk details, memory proposal details, and
  comparison details into inspector/review surfaces.
- Use user-facing labels in the main shell: `Context: Auto`,
  `Evidence saved`, `Project unchanged`, and `Review ready`.
- Keep CLI normal output focused on the agent-facing answer; keep debug and
  evidence commands explicit.

### Composer and Targeting

- Add `@` autocomplete for adapters and roles: `@fake`, `@codex`, `@claude`,
  preset roles such as `@engineer` and `@reviewer`, and later custom roles.
- Support keyboard navigation for mention autocomplete: up/down, Enter, Esc,
  and pointer selection.
- Keep unknown mentions as normal text rather than blocking the prompt.
- Add `/` command suggestions for common room controls: `/continue`,
  `/compare`, `/memory`, `/review`, `/workflow`, and room commands where
  applicable.
- Make target chips interactive so users can add/remove agents or roles before
  running.
- Replace context-mode selects with segmented controls for `Auto`, `Minimal`,
  `Full`, and `Workspace`.
- Change submit copy based on the selected targets, for example `Run 2 agents`.

### Quiet Transcript and Multi-Turn Agent Context

- The room transcript should show assistant/agent output as the durable visible
  answer.
- Agent run cards may exist as compact progress/review affordances while a run
  is active, but they should not dominate the transcript after completion.
- Do not promote terminal adapter messages such as `Codex exited with code 0`
  into assistant output.
- If a successful run has no agent-facing output, show a small empty-result
  state or review affordance, not a fabricated answer.
- If a run fails before producing output, show a concise human message and put
  exit code, signal, stderr, and raw events in the inspector.
- Same-room repeated prompts to the same agent should inject the relevant
  prior room conversation for that agent, plus room summary when enabled.
- Other agents' prior outputs may be injected as compact conclusions when
  shared context is enabled, but raw run evidence should stay out of the
  conversation brief unless explicitly requested.
- Worktree/code-state continuation remains explicit through continue-from-run
  or continue-from-message controls.

### Project and Room Creation

- Keep `Add project` visible even after one or more projects already exist.
- Keep room creation visible for the selected project.
- Room creation should ask for at least a handle/title and optionally a
  description.
- Newly created rooms should be selected immediately.
- Default rooms should be protected from accidental destructive actions.
- Custom rooms should be editable and eventually archivable, but delete/cleanup
  should remain explicit and local.

### Room Shared Context

- Add a room-level `sharedContextEnabled` setting, defaulting to `true`.
- When enabled, the room can provide bounded prior messages, same-agent
  assistant output, room summary, and compact cross-agent conclusions to future
  runs.
- When disabled, future runs receive only the current prompt, project context,
  approved memory, selected role instructions, selected skills, and explicit
  continuation data.
- This setting must not approve memory, reject memory, write project context
  files, export repo files, or change worktree continuation behavior.
- The UI should explain the setting in simple language: "Use this room's prior
  conversation in future agent runs."

### Skills and Memory

- Add a global skill library in Agent Hub-owned app data.
- Keep project skills in the project context store.
- Allow role default skills and task/run selected skills.
- Resolve skill scope in a deterministic order, for example:
  `task > role > project > global`.
- Persist the skill ids, scopes, and versions or content hashes used for each
  run so review can explain what method was injected.
- Keep global skills and project skills separate from approved memory.
- Proposed memory remains proposed-only until explicit approval.
- Approved memory remains governed and is injected only from the approved
  context store.

### Run Cards, Progress, and Review

- Add a compact stage bar: `Preparing -> Running -> Verifying -> Review ready`.
- Show last activity and current wait state for long runs, such as waiting for
  agent output, verification, preflight, or cancellation.
- Make run-card actions hierarchical. Primary: `View review` and active
  `Cancel`. Secondary: `Continue from here`, `Compare`, and `Open handoff`.
- Use clear disabled explanations for actions that require retained worktrees
  or terminal runs.
- Auto-offer `Compare results` when multiple runs in the same task or turn are
  terminal and comparable.
- Keep review evidence lazy-loaded.

### Inspector and Knowledge

- Make the inspector first screen conclusion-first: what changed, checks,
  risks, suggested decision, and next manual action.
- Pin blocking risk at the top when present.
- Keep raw logs, raw events, full diffs, context pack previews, and terminal
  metadata behind secondary tabs.
- Keep Memory/Knowledge views source-linked to rooms, runs, decisions, and
  proposals.

### Empty, Error, and Preference States

- Empty project state should focus on path input and recent/local project
  choices.
- Agent CLI unavailable states should show detection result, relevant PATH
  evidence, and a local command to verify the CLI.
- Verification-setting failures should point to settings.
- Busy states should say what is loading, submitting, cancelling, or refreshing.
- Remember harmless local preferences: last used agents/roles, context mode,
  inspector tab, sidebar width/collapse state, selected project, and selected
  room.

### Keyboard and Command Palette

- Keep `Cmd+Enter` as run/submit.
- Use `Esc` to close autocomplete, popovers, and inspector.
- Add `Cmd+K` command palette for project, room, role, review, memory, and
  settings actions.
- Use arrow keys for mention and command suggestions.
- Add focus movement shortcuts only after the primary controls are stable.

## Phase Sequence

| Phase | Theme | UI Impact | Primary Outcome |
| --- | --- | --- | --- |
| UX-0 | Interaction optimization documentation | No | This roadmap and implementation prompts |
| UX-1 | Quiet transcript and same-agent room context | Yes | Main room shows agent answers, not run internals |
| UX-2 | Project and room creation, shared context toggle | Yes | Users can add projects, create rooms, and govern room context |
| UX-3 | Composer autocomplete and control states | Yes | Mentions, target chips, segmented context, and submit copy are clear |
| UX-4 | Run progress and action hierarchy | Yes | Run cards are compact, staged, and review-oriented |
| UX-5 | Conclusion-first inspector | Yes | Review opens on findings and decisions before raw evidence |
| UX-6 | Global skill library and scoped skill resolution | Conditional | Shared methods can apply across projects without repo writes |
| UX-7 | Empty/error states, preferences, and keyboard polish | Yes | Repeated use becomes faster and less ambiguous |

## Phase UX-0: Interaction Optimization Documentation

### Goal

Record the post-MVP optimization plan, keep it aligned with the local
workgroup roadmap, and provide implementation prompts that future agents can
execute phase by phase.

### Scope

- Add this document.
- Cross-reference it from product and architecture docs.
- Include all currently identified optimization points:
  simplification, global skills, role/skill/task context, room creation,
  project creation, room shared context, quiet transcript, no terminal exit
  text in assistant answers, same-agent multi-turn context, mention
  autocomplete, controls, run progress, inspector improvements, empty/error
  states, preferences, and keyboard polish.

### Acceptance Criteria

- The roadmap exists in `docs/interaction-optimization-roadmap.md`.
- `docs/product.md` and `docs/architecture.md` link to it.
- No runtime code changes are made.
- `git diff --check` passes.

### Implementation Prompt

```text
Read AGENTS.md, docs/product.md, docs/architecture.md,
docs/local-ai-workgroup-roadmap.md, and
docs/interaction-optimization-roadmap.md. This is a docs-only phase.

Update the interaction optimization roadmap with the latest agreed UX and
conversation improvements. Keep it implementation-oriented, local-first, and
aligned with the existing room/role/run evidence model. Do not change runtime
code. Cross-link only concise references from product and architecture docs.

Verify with git diff --check. Commit, push, and open a PR.
```

## Phase UX-1: Quiet Transcript and Same-Agent Room Context

### Goal

Make the room transcript feel like an agent conversation while preserving all
run evidence in review surfaces.

### Scope

- Hide or collapse completed run-detail cards from the default transcript when
  a durable assistant output exists.
- Keep active runs visible as compact progress rows.
- Ensure assistant messages use only agent-facing output.
- Prevent terminal adapter messages such as `Codex exited with code 0` from
  becoming assistant output.
- Add a concise failure/empty-output message only when no agent-facing output
  exists.
- Ensure same-room repeated prompts to the same agent receive bounded prior
  conversation for that agent by default.
- Keep code-state continuation explicit through existing continue controls.

### Non-goals

- Do not remove run evidence, run events, logs, diffs, verification, risk, or
  comparison data from storage.
- Do not automatically continue from retained worktrees.
- Do not introduce remote execution, sync, merge, push, or PR creation.

### Acceptance Criteria

- Completed successful runs with assistant output render as agent answers in
  the room transcript.
- `exited with code 0` and similar terminal adapter summaries are not visible
  as assistant messages.
- Inspector/audit surfaces still expose exit code and raw events.
- A second `@codex` or role-backed Codex message in the same room receives the
  prior relevant Codex assistant output when shared context is enabled.
- Tests cover output extraction, transcript rendering, and conversation brief
  inclusion/exclusion.

### Implementation Prompt

```text
Read AGENTS.md, docs/product.md, docs/architecture.md,
docs/local-ai-workgroup-roadmap.md, and
docs/interaction-optimization-roadmap.md. Implement Phase UX-1 only.

This phase changes desktop UI. First generate UI design artifacts and
screenshots under docs/ui-design/ for the quiet room transcript: active runs may
show compact progress, completed runs should leave the agent answer as the main
visible transcript row, and review evidence should remain reachable through a
small review affordance. After artifacts exist, implement the UI and service
changes unless the user explicitly asked for a review stop.

Ensure desktop and CLI conversation outputs promote only agent-facing content
into assistant transcript messages. Terminal adapter events such as "Codex
exited with code 0" must remain audit evidence and must not become assistant
answers. If a terminal run has no agent-facing output, show a concise
empty-result or failure summary and keep raw details in the inspector.

Make same-room follow-up turns to the same agent multi-turn by default through
the conversation brief. Include bounded prior user turns and assistant outputs
for that agent when room shared context is enabled. Other agents' prior outputs
may be included only as compact conclusions or thread summary, never as raw
run events. Do not change code-state continuation semantics; retained-worktree
continuation remains explicit.

Keep the renderer sandboxed. Do not remove persisted run evidence. Update
docs/product.md and docs/architecture.md. Add focused tests for output
extraction, desktop transcript rendering, and conversation brief behavior.
Rebuild the desktop app, open the running UI, manually verify the affected
workflow, write docs/ui-verification/<date>-quiet-transcript.md, and include
that path in the final summary. Commit, push, and open a PR.
```

## Phase UX-2: Project and Room Creation, Shared Context Toggle

### Goal

Make project and room creation discoverable, and let each room govern whether
its prior conversation is shared with future agent runs.

### Scope

- Keep `Add project` visible even when projects already exist.
- Add room creation UI for handle/title and optional description.
- Select a newly created room immediately.
- Add room metadata for `sharedContextEnabled`, default `true`.
- Add a room-level UI toggle labeled in user-facing language.
- When disabled, exclude room prior messages and room summary from new
  conversation briefs while preserving current prompt, approved project memory,
  role instructions, selected skills, and explicit continuation data.

### Non-goals

- Do not implement room deletion or cleanup unless explicitly scoped.
- Do not add a separate `rooms` table unless metadata is insufficient.
- Do not change approved-memory lifecycle.
- Do not write context files into target repositories.

### Acceptance Criteria

- A user can add another project after one project already exists.
- A user can create a named custom room from the desktop sidebar.
- A newly created room is selected and ready for a message.
- Room shared context can be toggled on and off.
- Runs in a room with shared context off do not include prior room transcript or
  room summary in the conversation brief.
- Tests cover project-add visibility where practical, room metadata defaults,
  room creation, and shared-context brief behavior.

### Implementation Prompt

```text
Read AGENTS.md, docs/product.md, docs/architecture.md,
docs/local-ai-workgroup-roadmap.md, and
docs/interaction-optimization-roadmap.md. Implement Phase UX-2 only.

This phase changes desktop UI. First generate UI design artifacts and
screenshots under docs/ui-design/ for the sidebar project add affordance, room
creation flow, selected new room state, and room shared-context toggle. After
artifacts exist, implement the UI and service changes unless the user
explicitly asked for a review stop.

Keep Add project visible after projects exist. Add a room creation flow with
handle/title and optional description. Use ConversationThread metadata as the
room storage boundary unless it cannot safely support the phase. Add
sharedContextEnabled to room metadata with a default of true. In the
ConversationContextBuilder call path, honor the room setting: when disabled,
do not pass prior room messages or thread summary into the generated
conversation brief. Current prompt, approved project memory, selected role
instructions, selected skills, and explicit continue-from-run data still apply.

This setting is room context governance, not approved memory. It must not
approve, reject, write, export, merge, push, or clean anything. Keep all
privileged behavior in Electron main-process services and shared packages.

Update docs/product.md and docs/architecture.md. Add focused tests for room
metadata defaults, room creation, and shared-context brief behavior. Rebuild
the desktop app, open the running UI, manually verify project add, room create,
and shared-context toggle workflows, write
docs/ui-verification/<date>-room-creation-shared-context.md, and include that
path in the final summary. Commit, push, and open a PR.
```

## Phase UX-3: Composer Autocomplete and Control States

### Goal

Turn the composer into a clear command surface for selecting agents, roles,
context mode, and common room commands.

### Scope

- Add `@` autocomplete for adapters, preset roles, enabled custom roles, and
  recent targets.
- Add keyboard and pointer support for autocomplete.
- Keep unknown mentions as normal text.
- Add `/` suggestions for common commands.
- Make target chips interactive.
- Replace context-mode select with segmented controls.
- Update submit copy to reflect selected run count.
- Add clear busy, hover, selected, disabled, and pressed states.

### Non-goals

- Do not add a new command execution backend.
- Do not add global command palette yet.
- Do not change adapter execution semantics.

### Acceptance Criteria

- Users can discover and insert known agents and roles from `@`.
- Users can navigate suggestions by keyboard.
- Selected targets are visible and adjustable before submission.
- Context mode is selected through a segmented control.
- Submit copy communicates expected run fan-out.
- Tests cover parsing/insertion behavior and target resolution.

### Implementation Prompt

```text
Read AGENTS.md, docs/product.md, docs/architecture.md,
docs/local-ai-workgroup-roadmap.md, and
docs/interaction-optimization-roadmap.md. Implement Phase UX-3 only.

This phase changes desktop UI. First generate UI design artifacts and
screenshots under docs/ui-design/ for mention autocomplete, target chips,
context segmented controls, and submit-button states. After artifacts exist,
implement the UI unless the user explicitly asked for a review stop.

Add @ autocomplete for adapters, preset roles, enabled project roles, and
recent targets. Support ArrowUp, ArrowDown, Enter, Esc, and pointer selection.
Unknown mentions should remain prompt text instead of blocking submission. Add
basic / command suggestions for room/review/memory workflows without adding a
new command runtime. Make target chips interactive where the existing data
flow supports it. Replace the context select with a segmented control and make
the submit label reflect the target count.

Keep renderer behavior behind the existing preload API. Do not add shell,
filesystem, SQLite, or git access to React components. Update docs/product.md
and docs/architecture.md. Add focused component/unit tests where practical.
Rebuild the desktop app, open the running UI, manually verify autocomplete and
control states, write docs/ui-verification/<date>-composer-controls.md, and
include that path in the final summary. Commit, push, and open a PR.
```

## Phase UX-4: Run Progress and Action Hierarchy

### Goal

Make active runs easy to understand without making run internals the main
conversation content.

### Scope

- Add compact stage display for active runs.
- Show last activity and current wait state.
- Reorder run-card actions by importance.
- Move raw events behind inspector/audit by default.
- Offer comparison when comparable same-task or same-turn runs are terminal.

### Non-goals

- Do not remove persisted events.
- Do not automatically accept, merge, push, clean worktrees, or create PRs.
- Do not duplicate inspector data into the transcript.

### Acceptance Criteria

- Active runs show progress through stable stages.
- Completed runs present review affordances without flooding the room.
- Disabled actions explain why they are unavailable.
- Comparable multi-agent runs show a clear compare entry point.
- Tests cover stage mapping and compare affordance eligibility where practical.

### Implementation Prompt

```text
Read AGENTS.md, docs/product.md, docs/architecture.md,
docs/local-ai-workgroup-roadmap.md, and
docs/interaction-optimization-roadmap.md. Implement Phase UX-4 only.

This phase changes desktop UI. First generate UI design artifacts and
screenshots under docs/ui-design/ for active run progress, compact completed
run affordances, action hierarchy, and compare entry points. After artifacts
exist, implement the UI unless the user explicitly asked for a review stop.

Add a compact stage model such as Preparing, Running, Verifying, and Review
ready. Map existing persisted/live events into these stages without changing
TaskRunner semantics. Show last activity and current wait state for active
runs. Reorder actions so View review and active Cancel are primary, while
Continue, Compare, and Handoff are secondary. Keep raw events behind inspector
or audit views. Offer Compare results only when same-task or same-turn runs are
terminal and the comparison service allows them.

Update docs/product.md and docs/architecture.md. Add focused tests for stage
mapping and compare-entry eligibility where practical. Rebuild the desktop app,
open the running UI, manually verify the run card workflow, write
docs/ui-verification/<date>-run-progress-actions.md, and include that path in
the final summary. Commit, push, and open a PR.
```

## Phase UX-5: Conclusion-First Inspector

### Goal

Make review start with conclusions and decisions before raw evidence.

### Scope

- Put summary, changed output, checks, risks, suggested decision, and manual
  next actions at the top.
- Pin blocking risks.
- Keep raw logs, raw events, context previews, full diffs, exit metadata, and
  handoff details behind secondary tabs.
- Keep all actions review-only unless an explicit later apply/lifecycle phase
  says otherwise.

### Non-goals

- Do not implement automatic apply, merge, push, PR creation, or cleanup.
- Do not add LLM-based review scoring.
- Do not change persisted run evidence schemas unless needed for display.

### Acceptance Criteria

- Opening review shows the most important result and risk state first.
- Blocking risk is visible without switching tabs.
- Raw evidence remains available.
- Accept/reject remains audit-only.
- Tests cover tab defaults and risk prominence where practical.

### Implementation Prompt

```text
Read AGENTS.md, docs/product.md, docs/architecture.md,
docs/local-ai-workgroup-roadmap.md, and
docs/interaction-optimization-roadmap.md. Implement Phase UX-5 only.

This phase changes desktop UI. First generate UI design artifacts and
screenshots under docs/ui-design/ for the conclusion-first inspector and
blocking-risk state. After artifacts exist, implement the UI unless the user
explicitly asked for a review stop.

Rework the inspector default surface so the user sees what changed, checks,
risks, suggested decision, and manual next action before raw evidence. Pin
blocking risks at the top. Keep raw logs, raw events, context previews, full
diffs, exit metadata, and handoff details behind secondary tabs. Accept and
reject remain local review decisions only and must not merge, push, clean,
apply, export, or write repository context.

Update docs/product.md and docs/architecture.md. Add focused tests where
practical. Rebuild the desktop app, open the running UI, manually verify the
inspector workflow, write docs/ui-verification/<date>-conclusion-inspector.md,
and include that path in the final summary. Commit, push, and open a PR.
```

## Phase UX-6: Global Skill Library and Scoped Resolution

### Goal

Make reusable work methods available across projects without writing them into
target repositories by default.

### Scope

- Add global skill storage in Agent Hub-owned app data.
- Keep project skills in project context stores.
- Allow role default skill references and task/run selected skill references.
- Resolve skills with explicit scope and precedence.
- Persist injected skill identities and content hashes in run evidence.
- Keep export to `.claude/skills` and `.agents/skills` explicit and previewed.

### Non-goals

- Do not add a plugin marketplace.
- Do not run untrusted third-party code.
- Do not auto-sync skills into user repositories.
- Do not treat skills as approved memory.

### Acceptance Criteria

- A global skill can be created/listed and considered for context injection.
- Project or role scope can override or supplement global skills in a
  deterministic way.
- Run review can show which skills were injected.
- Repo export remains opt-in with preview.
- Tests cover scope resolution, malformed skills, export boundaries, and run
  evidence metadata.

### Implementation Prompt

```text
Read AGENTS.md, docs/product.md, docs/architecture.md,
docs/local-ai-workgroup-roadmap.md, and
docs/interaction-optimization-roadmap.md. Implement Phase UX-6 only.

Introduce a global skill library in Agent Hub-owned app data. Keep project
skills in project context stores, role default skills on role configuration,
and task/run selected skills on execution inputs or run metadata. Define
deterministic skill scope resolution, for example task > role > project >
global, and persist the actual skill ids, scopes, and content hashes injected
into each run so review can explain the method used.

Global skills must not write to target repositories and must not sync into
.claude/skills or .agents/skills by default. Repo export remains an explicit
preview/write operation. Skills are not approved memory; approved memory
continues to come only from the approved context-store memory path after user
approval.

If this phase changes desktop UI, first generate UI design artifacts and
screenshots under docs/ui-design/. Update docs/product.md and
docs/architecture.md. Add tests for scope resolution, malformed skills, export
boundaries, and run evidence metadata. Run targeted tests plus typecheck when
practical. Commit, push, and open a PR.
```

## Phase UX-7: Empty/Error States, Preferences, and Keyboard Polish

### Goal

Make repeated local work faster and failure states more actionable.

### Scope

- Improve empty states for project, room, team, knowledge, and inspector
  screens.
- Add actionable local diagnostics for unavailable Codex/Claude CLIs.
- Improve verification setting error paths.
- Persist harmless UI preferences locally.
- Add `Cmd+K` command palette after primary actions are stable.
- Keep `Cmd+Enter`, `Esc`, and arrow navigation consistent.

### Non-goals

- Do not add accounts, sync, or cross-device preference storage.
- Do not store secrets in SQLite.
- Do not add remote diagnostics.

### Acceptance Criteria

- Empty states lead to the next local action.
- CLI unavailable errors include enough local evidence to self-diagnose.
- Safe preferences survive app restart.
- Keyboard flows are documented and tested where practical.

### Implementation Prompt

```text
Read AGENTS.md, docs/product.md, docs/architecture.md,
docs/local-ai-workgroup-roadmap.md, and
docs/interaction-optimization-roadmap.md. Implement Phase UX-7 only.

This phase changes desktop UI. First generate UI design artifacts and
screenshots under docs/ui-design/ for empty states, actionable error states,
and command palette or keyboard polish. After artifacts exist, implement the
UI unless the user explicitly asked for a review stop.

Improve empty states for project, room, team, knowledge, and inspector screens.
Improve Codex/Claude unavailable errors with detection result, relevant PATH
evidence, and a local command to verify the CLI. Improve verification settings
errors by pointing users to settings. Persist harmless local preferences such
as last used agents/roles, context mode, inspector tab, selected project,
selected room, and sidebar layout. Add Cmd+K only after the primary actions are
available and stable. Keep secrets out of SQLite.

Update docs/product.md and docs/architecture.md. Add focused tests where
practical. Rebuild the desktop app, open the running UI, manually verify the
affected workflows, write docs/ui-verification/<date>-states-preferences.md,
and include that path in the final summary. Commit, push, and open a PR.
```
