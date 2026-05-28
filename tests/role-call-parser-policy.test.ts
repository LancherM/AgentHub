import { describe, expect, it } from "vitest";
import {
  conservativeDelegationPolicy,
  conservativePermissionSet,
  defaultRoleExecutionPolicy,
  parseRoleCallIntents,
  type RoleCall,
  type RoleDefinition,
  type RoleIntent,
  type RoleTodo
} from "@agent-hub/core";
import { validateRoleCallPolicy } from "@agent-hub/safety";

function role(overrides: Partial<RoleDefinition>): RoleDefinition {
  return {
    id: "role_analyst",
    handle: "analyst",
    displayName: "Analyst",
    purpose: "Analyze evidence.",
    defaultInstructions: "Analyze evidence and summarize tradeoffs.",
    capabilities: ["analysis"],
    permissions: { ...conservativePermissionSet },
    contextPolicy: {
      scope: "current_thread_and_project_context",
      includeApprovedMemory: true,
      includeThreadSummary: true,
      instructions: ["Use runtime context."]
    },
    approvalPolicy: {
      requiredFor: ["external_side_effects"],
      summary: "External side effects require approval."
    },
    delegationPolicy: { ...conservativeDelegationPolicy },
    intakePolicy: {
      acceptsRoleCalls: true,
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

const analyst = role({ handle: "analyst", capabilities: ["analysis", "planning"] });
const operator = role({
  id: "role_operator",
  handle: "operator",
  displayName: "Operator",
  capabilities: ["implementation", "local_execution"],
  permissions: {
    ...conservativePermissionSet,
    canRunCommands: true
  },
  intakePolicy: {
    acceptsRoleCalls: true,
    acceptedIntentTypes: ["delegate", "request_analysis"],
    canReject: true,
    canDefer: true
  }
});
const reviewer = role({
  id: "role_reviewer",
  handle: "reviewer",
  displayName: "Reviewer",
  capabilities: ["review", "risk"]
});

describe("role call parser and policy", () => {
  it("parses line-start role calls without using broad mention fan-out", () => {
    const result = parseRoleCallIntents(
      [
        "Intro text mentions @operator but is not a role call.",
        "  @operator Inspect the failed run logs.",
        "  Include stderr and exit code evidence.",
        "",
        "```",
        "@reviewer inside code fence must be ignored",
        "```",
        "@ghost This role is unknown.",
        "@operator Inspect the failed run logs.",
        "Include stderr and exit code evidence.",
        "@reviewer Review the operator findings for regression risk."
      ].join("\n"),
      { knownRoles: [analyst, operator, reviewer] }
    );

    expect(result.intents.map((entry) => entry.intent)).toEqual([
      expect.objectContaining({
        type: "delegate",
        targetRole: "operator",
        task: "Inspect the failed run logs.\nInclude stderr and exit code evidence."
      }),
      expect.objectContaining({
        type: "delegate",
        targetRole: "reviewer",
        task: "Review the operator findings for regression risk."
      })
    ]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "unknown_role", role: "ghost" }),
        expect.objectContaining({ type: "duplicate_intent", role: "operator" })
      ])
    );
  });

  it("allows explicit custom qa to analyst policy and denies default random delegation", () => {
    const qa = role({
      id: "role_qa",
      handle: "qa",
      displayName: "QA",
      capabilities: ["test_planning", "regression_detection"],
      trustLevel: "user_defined",
      delegationPolicy: {
        canInitiateRoleCalls: true,
        allowedIntentTypes: ["request_analysis", "request_review"],
        allowedTargetCapabilities: ["analysis", "review"]
      }
    });
    const analystForQa = role({
      id: "role_analyst",
      handle: "analyst",
      capabilities: ["analysis", "planning"],
      intakePolicy: {
        acceptsRoleCalls: true,
        acceptedIntentTypes: ["request_analysis", "delegate"],
        acceptedCallerCapabilities: ["test_planning", "implementation", "review"],
        canReject: true,
        canDefer: true
      }
    });
    const intent: RoleIntent = {
      type: "request_analysis",
      targetRole: "analyst",
      task: "Analyze flaky regression signal.",
      reason: "QA needs planning input.",
      expectedOutput: { format: "summary" }
    };

    expect(
      validateRoleCallPolicy({
        callerRole: qa,
        calleeRole: analystForQa,
        intent,
        executionPolicy: {
          ...defaultRoleExecutionPolicy,
          allowedDelegations: { qa: ["analyst"] }
        }
      })
    ).toMatchObject({ allowed: true, status: "allowed" });

    const random = role({
      id: "role_random",
      handle: "random",
      displayName: "Random",
      capabilities: ["misc"],
      trustLevel: "user_defined",
      delegationPolicy: { ...conservativeDelegationPolicy }
    });

    expect(
      validateRoleCallPolicy({
        callerRole: random,
        calleeRole: analystForQa,
        intent
      })
    ).toMatchObject({
      allowed: false,
      status: "blocked",
      reasons: expect.arrayContaining([
        "Caller role @random cannot initiate role calls."
      ])
    });
  });

  it("returns approval-required and blocked decisions deterministically", () => {
    const caller = role({
      id: "role_qa",
      handle: "qa",
      displayName: "QA",
      capabilities: ["test_planning"],
      delegationPolicy: {
        canInitiateRoleCalls: true,
        allowedIntentTypes: ["delegate"],
        allowedTargetRoles: ["operator"],
        requiresApprovalForTargets: ["operator"]
      }
    });
    const delegateIntent: RoleIntent = {
      type: "delegate",
      targetRole: "operator",
      task: "Run the focused verification command.",
      reason: "QA needs command output.",
      expectedOutput: { format: "summary" }
    };

    expect(
      validateRoleCallPolicy({
        callerRole: caller,
        calleeRole: operator,
        intent: delegateIntent
      })
    ).toMatchObject({
      allowed: false,
      status: "approval_required",
      approvalReasons: ["target @operator"]
    });

    expect(
      validateRoleCallPolicy({
        callerRole: {
          ...caller,
          delegationPolicy: {
            canInitiateRoleCalls: true,
            allowedIntentTypes: ["delegate"],
            allowedTargetRoles: ["operator"]
          }
        },
        calleeRole: operator,
        intent: {
          ...delegateIntent,
          task: "Run rm -rf build-output before tests."
        }
      })
    ).toMatchObject({
      allowed: false,
      status: "blocked",
      dangerousCommands: [
        expect.objectContaining({
          summary: "Recursive deletion command detected."
        })
      ]
    });
  });

  it("blocks depth, concurrency, cycle, duplicate, and todo-capacity violations", () => {
    const caller = role({
      id: "role_analyst",
      handle: "analyst",
      delegationPolicy: {
        canInitiateRoleCalls: true,
        allowedIntentTypes: ["delegate"],
        allowedTargetRoles: ["operator"]
      }
    });
    const intent: RoleIntent = {
      type: "delegate",
      targetRole: "operator",
      task: "Inspect failure evidence.",
      reason: "Need local evidence.",
      expectedOutput: { format: "summary" }
    };
    const existingCall: RoleCall = {
      id: "call_existing",
      threadId: "thread_1",
      callerRole: "analyst",
      calleeRole: "operator",
      task: "Inspect failure evidence.",
      context: { userGoal: "Fix failure." },
      permissions: { ...conservativePermissionSet },
      expectedOutput: { format: "summary" },
      priority: "normal",
      depth: 1,
      status: "running",
      createdAt: "2026-05-28T00:00:00.000Z"
    };
    const cycleCall: RoleCall = {
      ...existingCall,
      id: "call_cycle",
      callerRole: "operator",
      calleeRole: "analyst",
      task: "Ask analyst again."
    };
    const todo: RoleTodo = {
      id: "todo_1",
      threadId: "thread_1",
      role: "operator",
      title: "Existing operator work",
      status: "open",
      priority: "normal",
      relatedRoleCallIds: [],
      createdAt: "2026-05-28T00:00:00.000Z",
      updatedAt: "2026-05-28T00:00:00.000Z"
    };

    const result = validateRoleCallPolicy({
      callerRole: caller,
      calleeRole: operator,
      intent,
      currentDepth: 1,
      activeRoleCalls: [existingCall],
      existingRoleCalls: [existingCall, cycleCall],
      roleTodos: [todo],
      executionPolicy: {
        ...defaultRoleExecutionPolicy,
        maxDepth: 1,
        maxConcurrentRoleCalls: 1,
        maxTodosPerRole: 1
      }
    });

    expect(result.status).toBe("blocked");
    expect(result.reasons.join("\n")).toContain("exceeds max depth");
    expect(result.reasons.join("\n")).toContain("concurrency limit");
    expect(result.reasons.join("\n")).toContain("Duplicate active role call");
    expect(result.reasons.join("\n")).toContain("Potential role-call cycle");
    expect(result.reasons.join("\n")).toContain("todo capacity");
  });
});
