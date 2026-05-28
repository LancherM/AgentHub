import { describe, expect, it } from "vitest";
import {
  DomainStateTransitionError,
  DomainValidationError,
  conservativeDelegationPolicy,
  conservativeIntakePolicy,
  conservativePermissionSet,
  validateRoleCall,
  validateRoleCallDecision,
  validateRoleCallEvent,
  validateRoleCallStatusTransition,
  validateRoleDefinition,
  validateRoleIntent,
  validateRoleResult,
  validateRoleTodo,
  validateRoleTodoStatusTransition,
  type RoleCall,
  type RoleDefinition,
  type RoleTodo
} from "@agent-hub/core";

const createdAt = "2026-05-28T00:00:00.000Z";
const updatedAt = "2026-05-28T00:00:01.000Z";

function baseRoleDefinition(
  overrides: Partial<RoleDefinition> = {}
): RoleDefinition {
  return {
    id: "role_analyst",
    handle: "analyst",
    displayName: "Analyst",
    purpose: "Analyze bounded evidence.",
    defaultInstructions: "Compare evidence and summarize risks.",
    capabilities: ["analysis", "planning"],
    permissions: { ...conservativePermissionSet },
    contextPolicy: {
      scope: "current_thread_and_project_context",
      includeApprovedMemory: true,
      includeThreadSummary: true,
      instructions: ["Use runtime-injected context."]
    },
    approvalPolicy: {
      requiredFor: ["external_side_effects"],
      summary: "Approval is required for external side effects."
    },
    delegationPolicy: {
      canInitiateRoleCalls: true,
      allowedIntentTypes: ["request_review"],
      allowedTargetRoles: ["reviewer"],
      allowedTargetCapabilities: ["review"],
      requiresApprovalForTargets: ["operator", "engineer"]
    },
    intakePolicy: {
      acceptsRoleCalls: true,
      acceptedCallerCapabilities: ["analysis", "review"],
      acceptedIntentTypes: ["delegate", "request_analysis", "request_review"],
      canReject: true,
      canDefer: true
    },
    executor: { kind: "agent_adapter", adapter: "fake" },
    trustLevel: "preset",
    enabled: true,
    ...overrides
  };
}

function baseRoleTodo(overrides: Partial<RoleTodo> = {}): RoleTodo {
  return {
    id: "todo_1",
    threadId: "thread_1",
    role: "operator",
    sourceRoleCallId: "call_1",
    title: "Inspect failed run",
    status: "open",
    priority: "normal",
    relatedRoleCallIds: ["call_1"],
    createdAt,
    updatedAt,
    ...overrides
  };
}

function baseRoleCall(overrides: Partial<RoleCall> = {}): RoleCall {
  return {
    id: "call_1",
    threadId: "thread_1",
    parentMessageId: "message_1",
    callerRole: "analyst",
    calleeRole: "operator",
    task: "Inspect the failed desktop run and summarize the failure point.",
    reason: "The analyst needs local run evidence.",
    context: {
      userGoal: "Fix the failed desktop run.",
      constraints: ["Stay local-first"],
      previousRoleResults: [
        {
          summary: "The failure happens during verification.",
          evidence: ["run event 4"]
        }
      ],
      callerTodoState: [baseRoleTodo({ role: "analyst" })],
      calleeTodoState: [baseRoleTodo()],
      repoState: {
        branch: "codex/example",
        changedFiles: ["apps/desktop/src/App.tsx"],
        testStatus: "pending"
      },
      tokenBudget: 2000
    },
    permissions: { ...conservativePermissionSet },
    expectedOutput: {
      format: "json",
      description: "Structured root cause summary.",
      requiredEvidence: ["run event id"]
    },
    priority: "normal",
    depth: 1,
    status: "proposed",
    createdAt,
    ...overrides
  };
}

describe("adaptive role call domain contracts", () => {
  it("validates role definitions and keeps custom role delegation explicit", () => {
    expect(validateRoleDefinition(baseRoleDefinition())).toMatchObject({
      handle: "analyst",
      trustLevel: "preset"
    });

    expect(
      validateRoleDefinition(
        baseRoleDefinition({
          id: "role_random",
          handle: "random",
          displayName: "Random",
          trustLevel: "user_defined",
          delegationPolicy: { ...conservativeDelegationPolicy },
          intakePolicy: { ...conservativeIntakePolicy }
        })
      )
    ).toMatchObject({
      handle: "random",
      delegationPolicy: { canInitiateRoleCalls: false }
    });

    expect(() =>
      validateRoleDefinition(
        baseRoleDefinition({
          id: "role_ambient",
          handle: "ambient",
          trustLevel: "user_defined",
          delegationPolicy: {
            canInitiateRoleCalls: true,
            allowedIntentTypes: ["delegate"]
          }
        })
      )
    ).toThrow(DomainValidationError);
  });

  it("validates role intents without turning them into execution records", () => {
    expect(
      validateRoleIntent({
        type: "delegate",
        targetRole: "operator",
        task: "Run focused tests and summarize failures.",
        reason: "The caller needs verification evidence.",
        expectedOutput: { format: "json" },
        priority: "high"
      })
    ).toMatchObject({
      type: "delegate",
      targetRole: "operator"
    });

    expect(() =>
      validateRoleIntent({
        type: "delegate",
        targetRole: "@Operator",
        task: "Run tests",
        reason: "",
        expectedOutput: { format: "xml" }
      } as never)
    ).toThrow(DomainValidationError);
  });

  it("validates role calls, decisions, todos, events, and results", () => {
    expect(validateRoleCall(baseRoleCall())).toMatchObject({
      id: "call_1",
      context: { userGoal: "Fix the failed desktop run." }
    });

    expect(
      validateRoleCallDecision({
        disposition: "deferred",
        reason: "The operator is finishing the current patch first.",
        suggestedResumeCondition: "after focused tests complete",
        todo: {
          title: "Review deferred operator request",
          priority: "normal"
        }
      })
    ).toMatchObject({
      disposition: "deferred"
    });

    expect(validateRoleTodo(baseRoleTodo({ status: "deferred" }))).toMatchObject({
      role: "operator",
      status: "deferred"
    });

    expect(
      validateRoleCallEvent({
        id: "event_1",
        roleCallId: "call_1",
        threadId: "thread_1",
        type: "created",
        actorRole: "analyst",
        message: "Created role call for operator.",
        metadata: { intentType: "delegate" },
        createdAt
      })
    ).toMatchObject({
      type: "created"
    });

    expect(
      validateRoleResult({
        summary: "Focused tests passed.",
        evidence: ["pnpm vitest tests/role-calls-domain.test.ts"],
        commandsRun: [
          {
            command: "pnpm vitest tests/role-calls-domain.test.ts",
            exitCode: 0,
            outputSummary: "1 file passed"
          }
        ],
        filesRead: ["tests/role-calls-domain.test.ts"],
        risks: ["No UI coverage in this phase."]
      })
    ).toMatchObject({
      summary: "Focused tests passed."
    });
  });

  it("rejects malformed role decisions, todos, and results", () => {
    expect(() =>
      validateRoleCallDecision({
        disposition: "needs_context",
        reason: "Need more evidence."
      } as never)
    ).toThrow(DomainValidationError);

    expect(() =>
      validateRoleTodo(baseRoleTodo({ role: "@Operator", status: "waiting" as never }))
    ).toThrow(DomainValidationError);

    expect(() =>
      validateRoleResult({
        summary: "No evidence supplied.",
        evidence: "missing" as never
      })
    ).toThrow(DomainValidationError);
  });

  it("enforces role call and todo state transitions", () => {
    expect(() =>
      validateRoleCallStatusTransition("proposed", "assessing")
    ).not.toThrow();
    expect(() =>
      validateRoleCallStatusTransition("succeeded", "running")
    ).toThrow(DomainStateTransitionError);

    expect(() =>
      validateRoleTodoStatusTransition("open", "in_progress")
    ).not.toThrow();
    expect(() =>
      validateRoleTodoStatusTransition("done", "open")
    ).toThrow(DomainStateTransitionError);
  });
});
