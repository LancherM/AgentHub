# Memory Automation Roadmap

Status: planning
Last updated: 2026-06-09

This roadmap defines how Agent Hub can reduce manual memory approval work
without weakening local auditability, runtime context policy, or explicit user
control.

Today Agent Hub already generates conservative proposed memory from successful
run evidence, but promotion to approved memory is always explicit. The target
state is configurable memory automation: safe, evidence-backed items can move
from proposal to approved memory automatically under a project policy, while
higher-risk items remain queued for human review.

This roadmap changes future direction only. It does not describe implemented
runtime behavior until the phases below land.

## Product Goal

Make memory useful by default without turning Agent Hub into an agent that
silently rewrites long-term project context.

The intended user experience is:

- successful runs can produce memory candidates without extra user work;
- users can choose how much automation a project allows;
- safe workflow facts can be approved automatically when policy permits;
- preferences, temporary notes, conversation summaries, and risky evidence stay
  manual unless the user explicitly says to remember them;
- every automatic decision is visible, source-linked, and reversible.

## Current Baseline

Current memory flow:

1. TaskRunner completes a run.
2. Successful runs generate conservative proposed memory from durable evidence.
3. Proposed memory stays in SQLite.
4. Manual CLI or desktop approval changes the item to approved.
5. Approval writes an entry into the Agent Hub-owned context store at
   `memory/approved.md`.
6. Future context builds read only approved memory from the context store.

Important current boundaries:

- proposed and rejected memory must not be injected into future runs;
- thread summaries are local continuity and must not be promoted into project
  memory automatically;
- approved memory is stored outside the target repository by default;
- desktop renderer code must not approve memory directly or access filesystem
  APIs;
- automatic merge, push, pull request creation, branch deletion, and repository
  context export remain out of scope.

## Design Principles

- Opt-in automation: the default remains proposal-only until a project policy
  enables automation.
- Evidence first: every automatic approval must cite the run, task, category,
  policy mode, and reason.
- Policy before prompt: automation must be deterministic service logic, not a
  prompt instruction to an adapter.
- Review remains available: users can still approve, reject, disable, or retire
  memory manually.
- Read operations stay read-only: listing memory must not create or approve
  new items.
- Local-first only: no cloud classifier, remote memory service, account login,
  hosted queue, or external policy backend.
- Context hygiene: automatic memory should reduce repeated friction, not
  summarize every run.

## Policy Modes

Project-level memory automation should support these modes:

| Mode | Default | Behavior |
| --- | --- | --- |
| `suggest_only` | Yes | Generate proposed memory only. Manual approval remains required. |
| `auto_after_review_accept` | No | Auto-approve eligible proposals only after the run receives an explicit accepted review decision. |
| `auto_safe_on_success` | No | Auto-approve eligible proposals after successful run finalization. |

`auto_after_review_accept` is the recommended first automation mode because it
keeps automatic memory promotion behind an existing human review action while
removing the second memory-specific approval step.

## Eligibility Gates

Automatic approval should require all of the following:

- run status is `succeeded`;
- verification is passed or skipped only when policy explicitly allows skipped
  verification;
- latest risk level is no higher than the configured threshold, default `low`;
- no blocking risk findings;
- no sensitive path findings;
- no secret-like command text or secret-like memory content;
- content is not already approved or proposed for the project after
  normalization;
- category is allowed by policy;
- proposal count stays within the per-run limit.

Default eligible categories:

- `workflow_rule`
- selected `project_fact` items only when generated from deterministic local
  evidence

Default manual-only categories:

- `user_preference`, unless the user explicitly requested remembering the
  preference in the current turn
- `temporary_note`

Always manual-only sources:

- conversation thread summaries;
- low-trust conversation continuity;
- raw logs, raw diffs, raw verification output, and full transcripts;
- agent claims without durable run, task, verification, risk, or diff evidence.

## Data Model Direction

The current `MemoryItem` shape is intentionally small. Automation needs a
minimal audit envelope.

Recommended shared type addition:

```ts
interface MemoryItem {
  id: string;
  projectId: string;
  taskId?: string;
  category: MemoryCategory;
  status: MemoryStatus;
  content: string;
  metadata?: JsonObject;
  createdAt: string;
  updatedAt: string;
}
```

Recommended metadata fields:

```ts
{
  sourceRunId?: string;
  sourceTaskId?: string;
  sourceKind?: "run" | "verification" | "diff" | "risk" | "manual";
  generatedBy?: "task_runner" | "desktop_review" | "cli_manual";
  confidence?: "low" | "medium" | "high";
  autoApproval?: {
    policyMode: "auto_after_review_accept" | "auto_safe_on_success";
    approvedAt: string;
    reason: string;
    riskLevel?: string;
    verificationStatus?: string;
    writebackPath?: string;
  };
}
```

Recommended SQLite migration:

- add nullable `metadata_json TEXT CHECK (metadata_json IS NULL OR
  json_valid(metadata_json))` to `memory_items`;
- keep existing `status` values for the MVP;
- keep `approved` terminal for injection safety, but add a separate retire or
  disable flow before broad automation.

Recommended later lifecycle extension:

- add `retired` as a non-injected status, or add an `active` flag to approved
  memory;
- update `memory/approved.md` managed entries so retired memory can be hidden
  or marked inactive without editing user-authored content.

## Service Boundary

Automation should live in shared local services, not in desktop components.

Recommended service shape:

```ts
interface MemoryPolicyService {
  getProjectPolicy(projectId: string): Promise<MemoryAutomationPolicy>;
  saveProjectPolicy(policy: MemoryAutomationPolicy): Promise<MemoryAutomationPolicy>;
}

interface MemoryAutomationService {
  evaluateRun(runId: string): Promise<MemoryAutomationEvaluation>;
  applyRunPolicy(runId: string, trigger: "run_finalized" | "review_accepted"): Promise<MemoryAutomationResult>;
}
```

The implementation can start inside `packages/task-runner` because TaskRunner
already owns run finalization and depends on the context compiler. If the
service grows beyond TaskRunner, move it into a core-facing local package
without adding app-specific orchestration.

Desktop may expose settings and decision results through main-process IPC.
The renderer should only call safe preload methods.

## CLI Surface

Suggested CLI additions:

```sh
agent-hub memory policy show --project-id <project-id>
agent-hub memory policy set --project-id <project-id> --mode suggest_only
agent-hub memory policy set --project-id <project-id> --mode auto_after_review_accept
agent-hub memory policy set --project-id <project-id> --mode auto_safe_on_success --max-risk low
agent-hub memory automation evaluate --run-id <run-id>
agent-hub memory retire --memory-id <memory-id> --reason <text>
```

The `evaluate` command should be dry-run by default. It should explain why each
candidate is eligible, blocked, duplicate, or manual-only.

## Desktop Surface

Add memory automation controls under the existing local project settings or
Knowledge workspace:

- segmented policy control: `Suggest only`, `Auto after review accept`,
  `Auto safe on success`;
- risk threshold selector;
- category toggles;
- per-run proposal limit;
- preview of the approved memory file path;
- last automation result summary.

In run inspector and Knowledge:

- label `pending`, `manual approved`, `auto approved`, `ignored`, and later
  `retired`;
- show source run, policy mode, evidence summary, and writeback path;
- preserve existing `Approve selected` and `Ignore selected` actions.

## Phase Plan

| Phase | Theme | UI Impact | Primary Outcome |
| --- | --- | --- | --- |
| MA-0 | Roadmap and prompt planning | No | Public roadmap plus local implementation prompts |
| MA-1 | Memory metadata and policy contracts | No | Shared types, validators, SQLite metadata, policy parsing |
| MA-2 | Shared proposal generation consolidation | No | One deterministic proposal generator for CLI, TaskRunner, and desktop |
| MA-3 | Policy evaluation and dry-run audit | No | Explainable eligibility decisions without auto-approval |
| MA-4 | Auto after review accept | Conditional | Accepted review decisions can auto-approve eligible memory |
| MA-5 | Project settings and desktop visibility | Yes | Users can configure and audit memory automation locally |
| MA-6 | Auto safe on success and retirement | Conditional | Stronger opt-in automation plus reversible approved memory lifecycle |

## Phase MA-0: Roadmap and Prompt Planning

### Goal

Create the durable implementation roadmap and a local prompt companion.

### Scope

- Add this roadmap.
- Create `docs/memory-automation-implementation-prompts.md` as the local
  implementation prompt companion.
- Cross-link the roadmap from product and architecture docs.
- Keep the prompt companion ignored by git unless explicitly published.

### Acceptance Criteria

- Roadmap exists at `docs/memory-automation-roadmap.md`.
- Local prompt companion exists at
  `docs/memory-automation-implementation-prompts.md`.
- `docs/product.md` and `docs/architecture.md` mention the roadmap.
- No runtime behavior changes are made.
- `git diff --check` passes.

## Phase MA-1: Memory Metadata and Policy Contracts

### Goal

Add the data contracts required to explain automated memory decisions without
changing runtime behavior.

### Scope

- Add `metadata?: JsonObject` to `MemoryItem`.
- Extend validators, in-memory repositories, SQLite row mapping, and tests.
- Add a SQLite migration for `memory_items.metadata_json`.
- Define `MemoryAutomationPolicy`, policy modes, eligibility reasons, and
  evaluation result types in shared/core boundaries.
- Add parser helpers for policy settings values.

### Acceptance Criteria

- Existing memory propose/list/approve/reject behavior is unchanged.
- Metadata round-trips through in-memory and SQLite repositories.
- Invalid policy settings are rejected before persistence.
- Proposed and rejected memory remain excluded from runtime context.
- Focused domain, SQLite, CLI, and context compiler tests pass.

## Phase MA-2: Shared Proposal Generation Consolidation

### Goal

Remove app-specific proposal drift before adding automation.

### Scope

- Keep proposal generation in a shared TaskRunner/core-facing service.
- Replace desktop-only candidate logic with the shared generator or a shared
  wrapper.
- Keep desktop `listProposals` from creating new proposals when possible; add
  explicit generation or ensure generation happens at run finalization.
- Preserve idempotency and duplicate suppression.
- Preserve secret-like command filtering.

### Acceptance Criteria

- CLI, TaskRunner, desktop review, and Knowledge list the same proposals for a
  completed run.
- Reading proposals does not approve memory.
- Repeated run review loads do not create duplicates.
- Secret-like verification commands and sensitive paths are not proposed.

## Phase MA-3: Policy Evaluation and Dry-Run Audit

### Goal

Introduce deterministic policy evaluation before any automatic writeback.

### Scope

- Add a `MemoryAutomationEvaluator` that receives run evidence, project policy,
  proposals, verification results, and risk report.
- Return per-item decisions: eligible, blocked, duplicate, manual-only, or
  already-approved.
- Record evaluation diagnostics as run artifacts or context eval events when
  useful.
- Add `agent-hub memory automation evaluate --run-id <run-id>`.

### Acceptance Criteria

- Evaluation is read-only by default.
- CLI output explains every allow/block reason.
- Evaluation blocks high or blocking risk, sensitive paths, unsafe commands,
  unsupported categories, and duplicates.
- No approved memory file is written during evaluation.

## Phase MA-4: Auto After Review Accept

### Goal

Reduce manual approval friction while keeping automation behind explicit human
review.

### Scope

- Add project policy mode `auto_after_review_accept`.
- On CLI `reviews accept` and desktop `acceptRun`, run the memory automation
  service with trigger `review_accepted`.
- Auto-approve only eligible proposals.
- Write approved items to Agent Hub context store through the existing
  approved-memory writeback path.
- Record writeback path and policy result in memory metadata.
- Preserve manual approval and rejection actions.

### Acceptance Criteria

- Default `suggest_only` projects do not auto-approve.
- `auto_after_review_accept` projects auto-approve eligible memory after run
  acceptance only.
- Rejected and manual-only items remain untouched.
- Duplicate content is not written twice.
- CLI and desktop summaries show how many items were auto-approved and why
  others were skipped.

## Phase MA-5: Project Settings and Desktop Visibility

### Goal

Make automation understandable and configurable from the desktop shell while
keeping privileged work in the main process.

### Scope

- Add safe IPC for reading and saving project memory policy.
- Add a Memory Automation settings panel.
- Add policy badges and evidence summaries in run inspector and Knowledge.
- Add renderer validation for settings input.
- Keep all filesystem and SQLite writes in main-process services.

### Acceptance Criteria

- Renderer has no direct Node, shell, filesystem, SQLite, or git access.
- UI clearly shows policy mode and automatic approval source.
- Users can switch back to `suggest_only`.
- Existing manual approve/ignore controls still work.
- Desktop typecheck, focused service tests, and UI verification pass.

## Phase MA-6: Auto Safe on Success and Retirement

### Goal

Support the stronger opt-in automation mode safely.

### Scope

- Add project policy mode `auto_safe_on_success`.
- Apply eligible memory during run finalization after verification and risk
  report persistence.
- Add memory retirement or disable flow before broad opt-in use.
- Ensure retired or disabled memory is not injected into future context.
- Add CLI and desktop audit affordances for retirement.

### Acceptance Criteria

- `auto_safe_on_success` is never enabled by default.
- Automation happens only after durable run evidence is persisted.
- Retired memory stops entering future runtime context.
- Existing approved memory remains readable unless retired.
- The approved-memory file remains managed and idempotent.

## Testing Strategy

Minimum focused tests:

- domain validation for memory metadata and policy modes;
- SQLite migration and metadata round-trip;
- context compiler still filters proposed/rejected/retired memory;
- proposal generator idempotency and secret filtering;
- policy evaluator allow/block reason coverage;
- CLI policy show/set/evaluate smoke tests;
- review accept auto-approval flow;
- desktop settings service and IPC validation;
- desktop renderer validation for memory policy settings.

For UI changes, follow the desktop verification requirements: rebuild the app,
verify the affected workflow in the running desktop app, and write an untracked
manual UI verification note.

## Risks

- Memory pollution: mitigated by opt-in policy, eligibility gates, low default
  limits, and review visibility.
- Irreversible writeback: mitigated by a retirement flow before broad
  automation.
- Read-path side effects: mitigated by moving generation and approval out of
  proposal listing.
- Policy drift across CLI and desktop: mitigated by shared service logic.
- Secret leakage: mitigated by existing secret-like command checks plus content
  and sensitive-path gates.
- Overbroad project facts: mitigated by keeping `project_fact` automation
  limited to deterministic local evidence.

## Prompt Companion

The local prompt companion for this roadmap lives at:

```text
docs/memory-automation-implementation-prompts.md
```

That file is intentionally ignored by git because implementation prompt
documents are local planning artifacts in this repository. Do not commit or
push it unless the user explicitly asks to publish implementation prompts.
