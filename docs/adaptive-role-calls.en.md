# Adaptive Role Calls Product Specification

## Product Positioning

Adaptive Role Calls is Agent Hub's local-first role collaboration mechanism. It
lets roles such as `@analyst`, `@operator`, `@reviewer`, and `@engineer`
dynamically request help, assign work, reject or defer unsuitable requests, and
collaborate on the same local task graph until the user's goal is handled.

This is not free-form multi-agent chat, and it is not a rigid workflow engine.
Roles may freely express collaboration intent, but Agent Hub's Orchestrator
must own parsing, validation, scheduling, persistence, and auditability.

Core principles:

- Roles freely express intent; the Orchestrator executes reality.
- Roles cannot directly call each other; they can only emit structured intents.
- Every collaboration request is an auditable `RoleCall`.
- Every role owns a `RoleTodo` list for active, deferred, rejected, blocked, and
  completed work.
- Rejection and deferral are normal collaboration events, not exceptional
  failures.
- Callers must observe callee acceptance, rejection, deferral, context requests,
  approval requests, and final results.
- The system grows a dynamic collaboration graph instead of applying fixed
  stage templates.

## Non-Goals

- No free-form role-to-role chat.
- No `@orchestrator` role and no visible Orchestrator persona.
- No automatic merge, push, pull request creation, memory approval, or writes to
  the user's repository root by default.
- No cloud execution, login system, remote queue, or team SaaS.
- No requirement that users manually configure a fixed workflow before role
  collaboration works.

## User Experience

The user still starts from a simple goal:

```text
Find out why this desktop run failed, fix it, and assess the risk.
```

The analyst may produce a plan and express collaboration intent:

```text
@operator Inspect the latest failed desktop run logs, identify the failure point, and propose a verifiable fix.
@reviewer Review the operator's fix plan for local-first boundaries, test coverage, and regression risk.
```

The UI should not render this as several roles chatting. It should render a
dynamic collaboration task graph:

```text
User goal
└─ analyst
   ├─ operator: inspect desktop run failure
   │  ├─ accepted
   │  ├─ running
   │  └─ succeeded: root cause and patch summary
   └─ reviewer: review fix risk
      ├─ deferred: waiting for operator patch
      └─ todo: review patch after tests complete
```

If the reviewer raises a bug while the operator is actively editing code, the
operator may accept, defer, or reject that request:

```json
{
  "disposition": "deferred",
  "reason": "I am currently applying the persistence patch. Interrupting now risks mixing unrelated changes.",
  "suggestedResumeCondition": "after current patch is written and focused tests are run",
  "todo": {
    "title": "Investigate reviewer finding after current patch",
    "priority": "normal"
  }
}
```

The caller then receives this context:

```text
Role call to @operator was deferred.
Reason: operator is completing the current patch and queued the reviewer finding as a todo.
```

## Core Objects

### RoleDefinition

A role definition describes what a role can do, its default context, default
permissions, executor, and output requirements.

```ts
type RoleTrustLevel = "preset" | "user_defined" | "restricted";

interface DelegationPolicy {
  canInitiateRoleCalls: boolean;
  allowedIntentTypes: RoleIntentType[];
  allowedTargetRoles?: string[];
  allowedTargetCapabilities?: string[];
  requiresApprovalForTargets?: string[];
}

interface IntakePolicy {
  acceptsRoleCalls: boolean;
  acceptedCallerRoles?: string[];
  acceptedCallerCapabilities?: string[];
  acceptedIntentTypes: RoleIntentType[];
  canReject: boolean;
  canDefer: boolean;
}

interface RoleDefinition {
  id: string;
  handle: string;
  displayName: string;
  purpose: string;
  defaultInstructions: string;
  capabilities: RoleCapability[];
  permissions: PermissionSet;
  contextPolicy: RoleContextPolicy;
  approvalPolicy: RoleApprovalPolicy;
  delegationPolicy: DelegationPolicy;
  intakePolicy: IntakePolicy;
  executor: RoleExecutor;
  trustLevel: RoleTrustLevel;
  enabled: boolean;
}
```

Preset roles may ship with fuller default policies. User-defined roles must use
conservative defaults: by default they cannot initiate RoleCalls, or they can
only request low-risk review/analysis. Targets involving operator, engineer,
file writes, shell, network, or external side effects require explicit user
configuration or approval.

### RoleIntent

A role intent is a structured collaboration request emitted by a role. It is
not an execution record; only the Orchestrator can turn it into a `RoleCall`,
`RoleApprovalRequest`, `RoleTodo`, or risk event.

```ts
type RoleIntent =
  | {
      type: "delegate";
      targetRole: string;
      task: string;
      reason: string;
      expectedOutput: ExpectedOutputSpec;
      priority?: RolePriority;
    }
  | {
      type: "request_review";
      targetRole: string;
      artifactId?: string;
      task: string;
      reason: string;
    }
  | {
      type: "request_evidence";
      targetRole: string;
      question: string;
      requiredEvidence?: string[];
    }
  | {
      type: "request_approval";
      approvalType: string;
      reason: string;
      requestedAction: string;
    }
  | {
      type: "report_result";
      result: RoleResult;
    }
  | {
      type: "raise_risk";
      risk: string;
      evidence: string[];
    }
  | {
      type: "update_todo";
      todoId?: string;
      status: RoleTodoStatus;
      note: string;
    };
```

### RoleCall

A RoleCall is the work request record created after the Orchestrator accepts a
collaboration intent. It is a request, not a command. The callee role may
accept it, reject it, defer it, request more context, or request approval.

```ts
type RoleCallStatus =
  | "proposed"
  | "assessing"
  | "accepted"
  | "queued"
  | "running"
  | "deferred"
  | "rejected"
  | "waiting_context"
  | "waiting_approval"
  | "succeeded"
  | "failed"
  | "cancelled";

interface RoleCall {
  id: string;
  threadId: string;
  parentMessageId?: string;
  parentRoleCallId?: string;
  callerRole: string;
  calleeRole: string;
  task: string;
  reason?: string;
  context: RoleCallContext;
  permissions: PermissionSet;
  expectedOutput: ExpectedOutputSpec;
  priority: RolePriority;
  depth: number;
  status: RoleCallStatus;
  decision?: RoleCallDecision;
  result?: RoleResult;
  taskRunId?: string;
  todoId?: string;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}
```

### RoleCallDecision

The callee must make an intake decision before execution. Rejections and
deferrals must be persisted and returned to the caller.

```ts
type RoleCallDisposition =
  | "accepted"
  | "rejected"
  | "deferred"
  | "needs_context"
  | "needs_approval";

interface RoleCallDecision {
  disposition: RoleCallDisposition;
  reason: string;
  evidence?: string[];
  requiredContext?: string[];
  suggestedResumeCondition?: string;
  alternativeTask?: string;
  risk?: string;
  todo?: {
    title: string;
    priority?: RolePriority;
    dueHint?: string;
  };
}
```

### RoleTodo

Each role owns a todo list. This is not a general user task list; it is a role
runtime work ledger. Deferred RoleCalls must appear on the callee role's todo
list, and the caller must see the linked event.

```ts
type RoleTodoStatus =
  | "open"
  | "in_progress"
  | "deferred"
  | "blocked"
  | "done"
  | "rejected"
  | "cancelled";

interface RoleTodo {
  id: string;
  threadId: string;
  role: string;
  sourceRoleCallId?: string;
  parentTodoId?: string;
  title: string;
  description?: string;
  status: RoleTodoStatus;
  priority: RolePriority;
  reason?: string;
  blockedBy?: string[];
  relatedRoleCallIds: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}
```

Todo behavior:

- An accepted RoleCall may create or update an `in_progress` todo.
- A deferred RoleCall must create or update a `deferred` todo.
- A rejected RoleCall may create a `rejected` todo to preserve the reason and
  audit trail.
- A succeeded RoleCall should mark the linked todo as `done`.
- A cancelled RoleCall should mark the linked todo as `cancelled` unless the
  user chooses to keep it open.
- The caller's later context must include summaries of callee todo and decision
  events.

### RoleCallEvent

RoleCallEvent is the basis for caller awareness and UI timeline rendering.

```ts
type RoleCallEventType =
  | "created"
  | "assessment_started"
  | "accepted"
  | "deferred"
  | "rejected"
  | "context_requested"
  | "approval_requested"
  | "queued"
  | "started"
  | "todo_created"
  | "todo_updated"
  | "result_reported"
  | "failed"
  | "cancelled";

interface RoleCallEvent {
  id: string;
  roleCallId: string;
  threadId: string;
  type: RoleCallEventType;
  actorRole?: string;
  message: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}
```

### RoleResult

RoleResult is the structured output from completed work. All executable roles
must return validated JSON.

```ts
interface RoleResult {
  summary: string;
  evidence: string[];
  commandsRun?: {
    command: string;
    exitCode: number | null;
    outputSummary: string;
  }[];
  filesRead?: string[];
  filesTouched?: string[];
  patchSummary?: string;
  risks?: string[];
  nextSteps?: string[];
  rawOutput?: string;
}
```

## Orchestrator

The Orchestrator is a runtime component, not a role. It does not produce
user-facing analysis text, does not join discussion, and should not appear in
`@` autocomplete.

Responsibilities:

- Parse structured intents and line-start mention syntax from role output.
- Validate whether the caller may request that type of work.
- Validate callee capability, permissions, context budget, depth, concurrency,
  and cycle risk.
- For custom roles, read `delegationPolicy`, `intakePolicy`, project policy,
  and approval state to decide call authority with deterministic rules.
- Create `RoleCall`, `RoleCallEvent`, and required `RoleTodo` records.
- Build compact `RoleCallContext` for each call instead of passing the full
  thread.
- Start callee intake decisions.
- Execute, defer, reject, request context, or request approval based on the
  decision.
- Start local TaskRunner or another local executor for executable calls.
- Validate the `RoleResult` schema.
- Inject decision, result, and todo events into the caller's later context.
- Keep SQLite audit records and the UI call graph consistent.

The Orchestrator hardcodes the decision algorithm, not the concrete role
relationships. To decide whether one role may call another, it must check:

1. The caller role exists, is enabled, and is not blocked or cancelled.
2. The callee role exists, is enabled, and declares that it accepts RoleCalls.
3. The caller has `delegationPolicy.canInitiateRoleCalls`.
4. The caller allows the current intent type, such as `delegate`,
   `request_review`, or `request_evidence`.
5. The caller's `allowedTargetRoles` includes the callee directly, or its
   `allowedTargetCapabilities` match the callee's capabilities.
6. The callee's `intakePolicy` accepts the caller role, caller capability, and
   current intent type.
7. Requested permissions do not exceed project policy, caller permissions,
   callee permissions, or executor capabilities.
8. Depth, concurrency, per-turn call count, cycle detection, duplicate task
   suppression, and todo capacity all pass.
9. If the target or permissions match `requiresApprovalForTargets` or project
   approval rules, the RoleCall enters `waiting_approval` instead of executing.
10. Even when policy allows the call, the callee may still return accepted,
    rejected, deferred, needs_context, or needs_approval during intake.

For example, whether a user-defined `@qa` role may call `@analyst` is determined
by the caller and callee policies, not inferred by the Orchestrator:

```ts
const qaRole = {
  handle: "qa",
  capabilities: ["test_planning", "regression_detection"],
  delegationPolicy: {
    canInitiateRoleCalls: true,
    allowedIntentTypes: ["request_analysis", "request_review"],
    allowedTargetCapabilities: ["analysis", "review"]
  }
};

const analystRole = {
  handle: "analyst",
  capabilities: ["analysis", "planning"],
  intakePolicy: {
    acceptsRoleCalls: true,
    acceptedIntentTypes: ["request_analysis", "delegate"],
    acceptedCallerCapabilities: ["test_planning", "implementation", "review"],
    canReject: true,
    canDefer: true
  }
};
```

In this example, `@qa -> @analyst` with `request_analysis` is allowed because
the caller may initiate that intent, the target capability matches `analysis`,
and analyst accepts callers with `test_planning`. If a new `@random` role lacks
an explicit delegation policy, it cannot call `@analyst` by default; the user
must grant that ability in role configuration or approve the specific RoleCall.

## Dynamic Collaboration Graph

The system generates a RoleCall DAG, not a fixed workflow template.

```text
RoleCallGraph
├─ nodes: RoleCall[]
├─ edges: caller -> callee
├─ todos: RoleTodo[]
├─ events: RoleCallEvent[]
└─ policies: RoleExecutionPolicy[]
```

Allowed dynamic expansion examples:

- An analyst delegates investigation to an operator.
- An operator requests reviewer review for a patch.
- A reviewer requests additional evidence from an operator.
- An engineer requests risk review from a reviewer.
- A memory role proposes memory candidates but cannot auto-approve them.

Constraints are policy-driven, not template-driven:

- Maximum call depth.
- Maximum new calls per turn.
- Concurrency limits.
- Role capability graph.
- Read/write permissions.
- Shell, network, file-write, and external side-effect approval.
- Dangerous command blocking.
- Duplicate task suppression.
- Role todo capacity and blocked state.

## Permissions And Policy

Permissions must affect prompts, executor constraints, and Orchestrator policy.
Agent Hub must not rely on prompt text alone for permissions.

```ts
interface PermissionSet {
  canReadFiles: boolean;
  canEditFiles: boolean;
  canRunCommands: boolean;
  canUseNetwork: boolean;
  canAskUser: boolean;
  requiresApprovalForShell: boolean;
  requiresApprovalForFileWrite: boolean;
  allowedCommandPatterns?: string[];
  deniedCommandPatterns?: string[];
}

interface RoleExecutionPolicy {
  maxDepth: number;
  maxSubtasksPerTurn: number;
  maxConcurrentRoleCalls: number;
  maxContextTokensPerRoleCall: number;
  requireStructuredResult: boolean;
  requireEvidenceForResult: boolean;
  requireApprovalForFileWrite: boolean;
  requireApprovalForDangerousShell: boolean;
  blockDangerousCommands: boolean;
  allowedDelegations: Record<string, string[]>;
  defaultUserDefinedRoleTrustLevel: RoleTrustLevel;
}
```

`RoleExecutionPolicy.allowedDelegations` is a project-level ceiling or
compatibility setting. It must not replace `RoleDefinition.delegationPolicy` and
`RoleDefinition.intakePolicy`. A final decision must satisfy the project
ceiling, caller delegation policy, callee intake policy, and current approval
state.

Dangerous command patterns must include at least:

- `rm -rf`
- `sudo`
- `chmod -R`
- `curl | sh`
- `wget | sh`
- `git push`
- `git reset --hard`
- `docker system prune`

These checks should reuse and extend Agent Hub's existing safety scanner rather
than duplicating a separate implementation.

## Parser Rules

Line-start mentions are UI syntax, not the internal call protocol.

Supported syntax:

```text
@operator run tests and report failures
@reviewer review the patch for regression risks
```

Requirements:

- Detect only line-start mentions.
- Ignore mentions inside fenced code blocks.
- Ignore unknown roles or surface them as non-blocking validation warnings.
- Return `RoleIntent` records, not direct executions.
- Do not reuse the normal composer mention fan-out parser.

## Context Governance

Each RoleCall receives compact, independent context:

```ts
interface RoleCallContext {
  userGoal: string;
  currentPlan?: string;
  relevantFiles?: string[];
  recentFindings?: string[];
  constraints?: string[];
  previousRoleResults?: RoleResult[];
  callerTodoState?: RoleTodo[];
  calleeTodoState?: RoleTodo[];
  repoState?: {
    branch?: string;
    changedFiles?: string[];
    testStatus?: string;
  };
  tokenBudget?: number;
}
```

Context requirements:

- Do not pass the full thread verbatim to every role.
- Explicitly inject caller goal, task, constraints, relevant results, and todo
  state.
- Reviewers read results, diffs, risks, and test evidence by default; they do
  not modify files.
- Operators do not ask users directly by default; when needed, the Orchestrator
  turns the need into an approval or context request.
- Approved memory is never updated automatically because of a RoleCall.

## UI Requirements

The UI should offer two levels:

1. Default user view: final answer, current collaboration state, and required
   user approvals.
2. Audit view: RoleCall graph, RoleTodo lists, events, evidence, commands,
   files, risks, and errors.

RoleCallCard displays:

- callerRole -> calleeRole
- task
- status
- decision/disposition
- rejection or deferral reason
- linked todo
- permissions summary
- result summary
- evidence
- commands run
- files touched
- risks
- error
- retry/cancel/approve placeholders

RoleTodoPanel displays:

- Each role's open, in-progress, deferred, blocked, done, and rejected work.
- Each todo's linked RoleCall, events, and result.
- Resume conditions for deferred todos.
- Whether the caller has observed the callee's deferral or rejection.

## Local-First Boundaries

All execution preserves Agent Hub's existing boundaries:

- Local SQLite persistence.
- Local TaskRunner execution.
- Isolated git worktrees.
- Sandboxed desktop renderer.
- Privileged work through Electron main-process IPC.
- No automatic merge, push, pull request creation, memory approval, or repo
  context export.
- No intentional reading or exposure of `.env`, private keys, tokens, or
  credential files.

## Acceptance Criteria

- Line-start `@operator` and `@reviewer` mentions in role output produce
  structured RoleIntent records.
- Mentions inside code blocks do not produce RoleIntent records.
- The Orchestrator turns valid RoleIntent records into persisted RoleCalls.
- A callee can accept, reject, defer, request context, or request approval for a
  RoleCall.
- Rejection and deferral events are visible to the caller and injected into
  later caller context.
- Every role has an independent RoleTodo list.
- Deferred RoleCalls create or update deferred todos for the callee.
- Succeeded, cancelled, and rejected RoleCalls update related todo status.
- The RoleCallGraph prevents infinite recursion and cyclic calls.
- Policy enforces depth, concurrency, per-turn call counts, permissions, and
  dangerous command rules.
- Operators and reviewers must return structured RoleResult JSON; invalid
  schema fails the call audibly and auditably.
- The UI shows RoleCallCard, RoleTodoPanel, and the call graph.
- Execution still goes through local TaskRunner, SQLite, safety, context
  compiler, and IPC boundaries.
