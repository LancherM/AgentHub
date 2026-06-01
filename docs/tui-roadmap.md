# TUI Roadmap

Status: implementation in progress
Last updated: 2026-06-01

This roadmap defines a future terminal UI for Agent Hub. The TUI should be a
complete keyboard-first workbench for the current Agent Hub context, not a
terminal clone of the desktop app and not a replacement for scriptable CLI
commands.

The target product shape is:

> Agent Hub TUI lets a user work inside the current project/thread/room context:
> send prompts, choose agents and roles, watch runs progress, understand the
> RoleCall graph, inspect the most important local evidence, record lightweight
> decisions, and continue work without leaving the terminal.

RoleCall graph visibility is central, but it is not the whole TUI. The TUI also
needs the practical operating surface around the graph: composer, targets,
runs, tasks, minimal review, memory prompts, skills/context indicators, and
keyboard commands.

Implementation note: the initial hand-rendered string TUI validated the shared
read-model and command boundaries, but it has been replaced as a runtime path.
The current implementation direction is the component-based Ink rewrite
described in `docs/tui-ink-rewrite-roadmap.md`. The next Work-view redesign is
the conversation-terminal plan in `docs/tui-conversation-terminal-roadmap.md`.

Project registration, broad project browsing, room management, deep audit,
comparison reports, raw logs, full diffs, knowledge browsing, and lifecycle
apply controls remain explicit CLI or desktop workflows. The TUI may show the
current project and room as context, but it should not spend primary screen
space on project/room navigation.

## Product Positioning

The TUI has one job: make day-to-day local agent work efficient in the
terminal.

It should show:

- current context: project name/path, thread or room label, selected defaults;
- prompt composer with agent and role targeting;
- compact transcript;
- active and recent run status;
- RoleCall graph and loop state;
- selected run or selected RoleCall summary;
- minimal review signals: changed files, verification summary, risk level,
  latest event, final result, waiting reason, and blocking condition;
- proposed memory count and explicit approval reminder;
- selected skills and context mode indicators;
- command palette/help for deeper CLI commands.

It should not show by default:

- project or room sidebars;
- compare boards or comparison report details;
- raw run events, raw adapter logs, stdout/stderr streams, full patches, task
  briefs, context packs, lifecycle metadata, or retained-worktree controls;
- knowledge browsing;
- desktop-style tabbed inspectors;
- automatic apply, merge, push, pull request creation, repository context
  export, or memory approval.

The existing CLI remains the canonical place to inspect or change global
context:

```sh
agent-hub project list
agent-hub rooms list --project-id <project-id>
agent-hub rooms use --project-id <project-id> --room <handle-or-thread-id>
agent-hub threads list
agent-hub runs show <run-id>
agent-hub runs diff <run-id> --stat
agent-hub risks show <run-id>
agent-hub role-calls list --thread-id <thread-id>
agent-hub role-calls show <role-call-id>
agent-hub compare --task-id <task-id> --baseline <run-id> --candidate <run-id>
```

The TUI may accept launch selectors:

```sh
agent-hub tui [--thread <thread-id>|--room <handle-or-thread-id>] \
  [--agent codex|claude-code] [--max-iterations <n>] [--debug]
```

These selectors choose the starting context; they do not make the TUI a
project or room browser.

## Ralph-Style Influence

The TUI should borrow the useful part of Ralph-style loops: persistent,
bounded iteration over a task with visible progress, verification, retries, and
resume state. It should not import unbounded autonomous execution.

References:

- Ralph loop methodology: https://ralph-cli.dev/docs/core-concepts/ralph-loop/
- Ralph Loops portable package format: https://ralphloops.io/

Agent Hub's loop shape should be:

```text
user goal
-> prompt targets
-> agent or role run
-> RoleCall intents
-> Orchestrator validation
-> RoleCall graph update
-> TaskRunner-backed runs where needed
-> checks and risk
-> RoleResult, run output, or decision
-> graph convergence
-> next prompt, next role call, user input, or stop
```

The loop is bounded by local policy and user-visible stop conditions:

- all RoleCalls reached terminal status;
- no runnable pending calls remain;
- max iteration count was reached;
- blocking risk was detected;
- a RoleCall is waiting for user approval;
- a RoleCall is waiting for user context;
- the user cancelled the loop.

## Experience Principles

- Complete workbench, compact surface: cover the normal terminal workflow, but
  keep deep audit behind explicit commands.
- Current context first: show the active project/room/thread as a header, not a
  navigation tree.
- Composer first: prompting, target selection, and continuation must be fast.
- RoleCall graph always visible when calls exist.
- Runs are visible as status objects, not raw logs.
- Minimal evidence: show the strongest audit signal and provide CLI commands
  for deeper inspection.
- Keyboard first: common actions should be one or two keystrokes.
- Bounded autonomy: show iteration progress and stop reasons; never hide loops
  in the background.
- No acceptance side effects: accept/reject records review state only; it does
  not apply code or approve memory.
- Scriptable CLI parity: every TUI evidence action should have an equivalent
  CLI command or add one before the TUI depends on it.

## Information Architecture

The TUI should have a stable shell with four regions:

```text
Header: current context, selected defaults, loop/risk summary
Main:   transcript or selected focus view
Side:   graph/run/task summary, depending on focus
Bottom: composer and command hints
```

Primary focus modes:

- `Work`: transcript, composer, active run strip, and compact graph.
- `Graph`: larger RoleCall graph and selected-call summary.
- `Runs`: active/recent runs with minimal review signals.
- `Review`: selected run or RoleCall evidence summary.
- `Tasks`: current task/goal, assignments, pending follow-ups, and todos.
- `Memory`: proposed-memory count and explicit approve/reject commands.
- `Help`: shortcuts and equivalent CLI commands.

Focus modes are not project/room navigation. They are views over the current
context.

## Primary Screen

Wide terminal layout:

```text
Agent Hub  agent-hub  #review  @codex  ctx Auto  iter 2/5  risk medium

Transcript                                      Focus: RoleCall Graph
You                                             @engineer [running]
  Fix retained-run cleanup summary.             |-- @operator [ok] run_42
                                                 |   checks 2/2 risk low
Engineer                                        |-- @reviewer [running] run_43
  I changed the cleanup summary and              |   checks done risk medium
  delegated review.                              `-- @memory [waiting]
                                                     approval needed

Runs
run_43 @reviewer running    checks done   risk medium
run_42 @operator succeeded  checks 2/2    risk low

Selected
@engineer -> @reviewer
Task: Review retained-run cleanup summary and risk evidence.
Evidence: 3 files changed, checks passed, risk medium.

Actions: tab focus  enter open  r review  c continue  h hide done  ? help

> @reviewer check whether the medium risk blocks acceptance
```

Narrow terminal layout should preserve the same objects:

```text
Agent Hub  #review  @codex  iter 2/5  risk medium

Graph
@engineer [running]
|-- @operator [ok] run_42 checks 2/2 risk low
|-- @reviewer [running] run_43 checks done risk medium
`-- @memory [waiting] approval needed

Runs
run_43 @reviewer running risk medium
run_42 @operator ok risk low

Transcript
You: Fix retained-run cleanup summary.
Engineer: I changed it and delegated review.

>
```

## Composer And Targeting

The composer should support:

- natural-language prompts;
- adapter mentions such as `@codex` and `@claude-code`;
- role mentions such as `@engineer`, `@reviewer`, and custom roles;
- selected default agent;
- current context mode indicator;
- selected skill ids as compact chips or text;
- continuation from the selected run or selected RoleCall when explicitly
  requested.

Unknown mentions should remain prompt text instead of blocking submission.

The TUI should reuse CLI chat semantics and TaskRunner boundaries. If the
current CLI chat implementation is too app-specific, the shared prompt/run
submission service should be extracted before TUI depends on it.

## Runs View

The TUI should expose active and recent runs enough for operating decisions:

```text
Runs
> run_43 @reviewer running
  task: Review retained-run cleanup summary
  stage: verifying
  checks: 2 passed
  risk: medium
  latest: verification finished

  commands:
    agent-hub runs show run_43
    agent-hub runs diff run_43 --stat
    agent-hub risks show run_43
```

Runs view should not show raw logs, full patches, or context packs. It may show
the CLI command needed to inspect them.

## RoleCall Graph

The RoleCall graph should be derived from persisted RoleCall records. Initial
phases can use a tree projection by `parentRoleCallId`. Later phases may add a
DAG-aware layout if shared or related calls become important.

Default ordering:

1. active calls: `running`, `queued`, `accepted`, `assessing`, `proposed`;
2. blocked calls: `waiting_approval`, `waiting_context`, `failed`;
3. deferred and rejected calls;
4. succeeded and cancelled calls.

The default view should collapse terminal succeeded calls when there are many
nodes, while keeping failed, rejected, deferred, and waiting nodes visible.

Suggested status labels:

```text
[new]       proposed or assessing
[queued]    accepted or queued
[running]   active TaskRunner execution
[waiting]   waiting_context or waiting_approval
[deferred]  deferred by callee
[rejected]  rejected by callee or policy
[ok]        succeeded
[failed]    failed
[cancelled] cancelled
```

## Review View

Review is intentionally shallow:

```text
Review run_43

Changed
  3 files, +82 -19

Checks
  passed: pnpm typecheck, targeted vitest
  skipped: full pnpm test

Risk
  medium
  reason: verification is partial

Next
  run full test before accepting

Actions: a accept-record  j reject-record  d diff-stat  e events  esc back
```

Accept/reject records review state only. It must not apply patches, merge,
push, create pull requests, approve memory, delete branches, export context, or
clean retained worktrees.

Compare remains outside the default TUI. If comparable runs exist, the review
view may show the command:

```text
Compare: agent-hub compare --task-id <task-id> --baseline <run-a> --candidate <run-b>
```

## Tasks View

The Tasks view is current-context only. It should show:

- current user goal or thread title;
- active task id when available;
- role assignments;
- pending RoleTodos;
- deferred/rejected follow-ups;
- next action.

It should not become a global task board. Use CLI commands for global listing.

## Memory And Skills View

Memory and skills should be visible as governance indicators, not full
browsers:

```text
Memory
proposed: 2
approved: injected from Agent Hub context store
next: run agent-hub memory list --project-id <project-id>

Skills
selected: project:reviewer-checklist, global:typescript-safety
source: injected at runtime
```

The TUI may provide a shortcut to print approval/rejection commands, but memory
approval remains explicit and separate.

## Minimal Audit Model

The TUI should summarize evidence at run and RoleCall level:

```ts
interface TuiEvidenceSummary {
  linkedRunId?: string;
  latestEvent?: string;
  resultSummary?: string;
  waitingReason?: string;
  checks?: {
    passed: number;
    failed: number;
    skipped: number;
    failedNames: string[];
  };
  risk?: {
    level: "low" | "medium" | "high" | "blocking";
    primaryReason?: string;
  };
  diff?: {
    changedFiles: number;
    insertions?: number;
    deletions?: number;
  };
}
```

This should be an aggregation read model over existing persisted data:

- conversation threads and messages for the current context;
- tasks and task runs;
- run events, artifacts, metadata, verification, and risk reports;
- role calls, role call events, and role todos;
- memory proposal counts;
- selected skill evidence.

No new persistence table should be added until the TUI has a concrete query or
resume need that the existing records cannot support.

## Keyboard Model

Default keys:

```text
tab / shift-tab   move focus mode
up/down           move selected row or graph node
left/right        collapse or expand graph subtree
enter             open selected summary
ctrl+enter        submit prompt
r                 open review summary
c                 continue selected run or RoleCall
k                 cancel selected running item when supported
h                 toggle hide completed graph nodes
m                 memory summary
s                 skills/context summary
:                 command palette
?                 help
esc               close focused panel
x                 exit
ctrl+c            exit
```

## Architecture Direction

The TUI should live under `apps/cli` at first. It is a CLI surface, not a new
desktop package and not a server.

Preferred boundary:

```text
apps/cli command parser
-> apps/cli TUI renderer and key handling
-> shared TUI read models
-> core/db repositories
-> TaskRunner and RoleCall services where needed
-> local SQLite evidence
```

Rules:

- Keep all command-line subcommands functional without the TUI.
- Keep normal `agent-hub run` and `agent-hub chat` output human-facing and
  scriptable.
- Do not move orchestration into the TUI renderer.
- Reuse RoleCall parser, Orchestrator, convergence helpers, repositories, and
  TaskRunner execution boundaries.
- Extract any desktop-only RoleCall orchestration service needed by the TUI
  into shared local packages or a CLI-reusable service before depending on it.
- Do not add a web server, browser dashboard, cloud backend, account system, or
  remote execution.
- Do not add project/room navigation state to the TUI beyond launch context
  and current-context display.

## Dependency Strategy

The render-model-first spike proved the shared read model and command
boundaries, but the hand-rendered string layout was not maintainable enough for
focus, resizing, and evidence prioritization. The TUI now uses Ink as the
terminal rendering dependency:

- `apps/cli/src/tui.ts` stays the CLI launch and action boundary.
- `apps/cli/src/tui-ink/*.mts` is the ESM Ink 7 / React 19 renderer.
- `apps/cli/tsconfig.tui-ink.json` compiles the renderer to
  `apps/cli/dist/tui-ink/*.mjs`.
- Node 22+ is the supported runtime line for the CLI/TUI dependency set.

Future TUI dependency additions still need a concrete need such as scrollable
panes, reliable keyboard handling, or terminal rendering correctness. They
must stay inside the CLI/local package boundary and must not introduce a
server, browser UI, or orchestration logic in the renderer.

## Phase Sequence

| Phase | Theme | UI Impact | Primary Outcome |
| --- | --- | --- | --- |
| TUI-0 | Roadmap and prompt planning | No | This roadmap and local implementation prompts |
| TUI-1 | TUI read models | No | Current-context transcript, runs, RoleCalls, review, memory, and skills summaries |
| TUI-2 | Read-only workbench shell | Yes | Header, focus modes, graph, runs, transcript, summaries, help |
| TUI-3 | Composer and prompt submission | Yes | Current-context prompts run through existing CLI chat/TaskRunner boundaries |
| TUI-4 | Runs and task operating view | Yes | Active/recent run monitor plus current task/todo summary |
| TUI-5 | RoleCall graph and bounded loop controls | Yes | Graph-first role collaboration, convergence, continue, cancel, stop reasons |
| TUI-6 | Minimal review and decisions | Yes | Shallow evidence summary plus audit-only accept/reject records |
| TUI-7 | Memory, skills, and context indicators | Yes | Governance signals and CLI command hints without browsers |
| TUI-8 | Command palette and terminal polish | Yes | Keyboard-first operation, resize handling, empty/error states |
| TUI-9 | Hardening and validation | Conditional | Smoke tests, snapshots, docs, and regression coverage |

## Phase TUI-0: Roadmap and Prompt Planning

### Goal

Record the complete TUI product direction and create local implementation
prompts for future phased work.

### Scope

- Add this roadmap.
- Create `docs/tui-implementation-prompts.md` as a local ignored prompt
  companion.
- Link this roadmap from product and architecture docs.
- Do not change runtime behavior.

### Acceptance Criteria

- Roadmap exists in `docs/tui-roadmap.md`.
- Local prompt companion exists at `docs/tui-implementation-prompts.md`.
- `docs/product.md` and `docs/architecture.md` mention the roadmap.
- No runtime code changes are made.
- `git diff --check` passes.

## Phase TUI-1: TUI Read Models

### Goal

Create reusable current-context summary read models that can power the complete
TUI without pulling deep audit logic into terminal rendering.

### Scope

- Summarize current transcript messages.
- Summarize active and recent runs.
- Summarize RoleCall graph nodes and RoleTodos.
- Summarize selected run or selected RoleCall review evidence.
- Summarize proposed-memory counts and selected skill evidence.
- Add deterministic ordering and bounded output.
- Add focused tests with in-memory repositories.

### Non-Goals

- No terminal UI yet.
- No new SQLite tables.
- No desktop UI changes.
- No compare behavior.

### Acceptance Criteria

- Read models return bounded summaries for transcript, runs, RoleCalls, review,
  tasks, memory, and skills in one current context.
- Tests cover empty, active, waiting, failed, rejected, deferred, and completed
  states.

## Phase TUI-2: Read-Only Workbench Shell

### Goal

Add a read-only terminal workbench that renders current-context summaries.

### Scope

- Add `agent-hub tui`.
- Support launch selectors `--thread` and `--room`.
- Render header, focus modes, transcript, runs, RoleCall graph, selected
  summary, and help.
- Support keyboard focus switching, selection, graph collapse, hide-done, help,
  and exit.
- Keep project and room navigation out of the UI.

### Non-Goals

- No prompt submission yet.
- No loop continuation yet.
- No review decision writes.
- No compare, full diff, raw logs, memory browser, or lifecycle controls.

### Acceptance Criteria

- Read-only TUI opens on a thread or room and displays the complete workbench
  shell.
- Narrow terminal layout keeps core objects visible.
- Snapshot or smoke tests cover empty, active, waiting, and completed states.

## Phase TUI-3: Composer And Prompt Submission

### Goal

Let the user submit prompts in the current context from the TUI while
preserving existing CLI chat semantics.

### Scope

- Add a prompt composer.
- Reuse CLI chat parsing for adapter and role mentions.
- Submit turns through the same local TaskRunner-backed path as CLI chat, or
  extract a shared service first.
- Refresh transcript, runs, and RoleCall graph after submission.
- Keep unknown mentions as text.

### Non-Goals

- No project/room picker.
- No autonomous loop continuation.
- No new role executor backend.
- No automatic apply, merge, push, PR, memory approval, or repository export.

### Acceptance Criteria

- A prompt submitted from TUI creates the same persisted records as a CLI chat
  prompt in the same context.
- Role-backed output that emits RoleCall syntax updates the graph when the
  underlying shared service supports it.

## Phase TUI-4: Runs And Task Operating View

### Goal

Make active work visible without exposing raw run internals.

### Scope

- Add Runs focus mode with active/recent run status, stage, checks, risk,
  latest event, and linked CLI commands.
- Add Tasks focus mode with current goal, task id, assignments, RoleTodos,
  deferred/rejected follow-ups, and next action.
- Keep global run and task listing in CLI commands.

### Non-Goals

- No full log viewer.
- No full diff viewer.
- No global task board.
- No compare board.

### Acceptance Criteria

- Runs view gives enough information to decide whether to wait, continue,
  cancel, or inspect deeper through CLI.
- Tasks view stays current-context only.

## Phase TUI-5: RoleCall Graph And Bounded Loop Controls

### Goal

Make role collaboration visible and controllable as a bounded loop.

### Scope

- Keep RoleCall graph visible when calls exist.
- Show iteration state: current/max, pending count, waiting count, active
  count, and stop reason.
- Use existing RoleCall convergence helpers.
- Add explicit continue behavior for the current loop or selected call.
- Add cancellation where the underlying runner supports it.
- Stop visibly on max iterations, blocking risk, waiting approval, waiting
  context, or no runnable pending calls.

### Non-Goals

- No daemon.
- No overnight/unbounded loop.
- No background continuation after TUI exit.
- No remote execution.

### Acceptance Criteria

- TUI displays convergence reason for terminal, pending, waiting, and blocked
  graphs.
- Continue respects max iterations and visible stop conditions.

## Phase TUI-6: Minimal Review And Decisions

### Goal

Provide enough evidence for lightweight decisions while keeping deep audit in
CLI/desktop review workflows.

### Scope

- Add Review focus mode for selected run or selected RoleCall.
- Show changed-file count/stat, check summary, risk level/reason, next action,
  and linked CLI commands.
- Move accept/reject review decision recording into a shared package boundary
  if it is currently desktop-only.
- Add CLI commands for recording and showing review decisions if needed.
- Wire TUI shortcuts to audit-only accept/reject.

### Non-Goals

- No local apply.
- No merge, push, PR, branch deletion, cleanup, memory approval, or context
  export.
- No full diff pager or raw log viewer.

### Acceptance Criteria

- Review view stays bounded and points to CLI commands for deep evidence.
- TUI accept/reject produces the same review artifact shape as desktop
  decisions and does not alter files, branches, memory, cleanup, or run status.

## Phase TUI-7: Memory, Skills, And Context Indicators

### Goal

Make governance state visible without turning the TUI into a knowledge browser.

### Scope

- Show proposed-memory count, approved-memory source, and explicit CLI command
  hints.
- Show selected skills, scopes, and runtime-injection source.
- Show context mode as a compact status.
- Add shortcuts to print relevant CLI commands.

### Non-Goals

- No memory browser.
- No automatic memory approval.
- No skill editor.
- No repo export.

### Acceptance Criteria

- TUI makes memory/skill/context state understandable at a glance.
- Any mutation still routes through explicit CLI or shared governed services.

## Phase TUI-8: Command Palette And Terminal Polish

### Goal

Make the complete TUI efficient for repeated terminal use.

### Scope

- Add command palette for current-context actions.
- Add stable keyboard help.
- Handle resize and narrow terminals.
- Preserve focus across refreshes where possible.
- Add copy/print commands for equivalent CLI commands.

### Non-Goals

- No project/room browser.
- No settings dashboard.
- No desktop UI work.

### Acceptance Criteria

- Common actions are discoverable through keyboard help and command palette.
- Narrow terminal layouts remain usable.

## Phase TUI-9: Hardening And Validation

### Goal

Make the TUI reliable for daily use without broadening its product scope.

### Scope

- Handle empty graphs, missing context, missing project registration,
  unavailable agent CLI, unavailable role executor, failed database reads,
  failed linked runs, and cancellation races.
- Add deterministic render snapshots for representative states.
- Add smoke tests for launch and immediate exit.
- Update product and architecture docs after behavior lands.

### Non-Goals

- No cloud, server, sync, account, remote execution, marketplace, or browser
  dashboard concept.

### Acceptance Criteria

- Failure states are concise and point to CLI recovery commands.
- Relevant validation commands pass.
