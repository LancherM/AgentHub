import { describe, expect, it } from "vitest";
import {
  conservativeDelegationPolicy,
  conservativePermissionSet,
  defaultRoleExecutionPolicy,
  deterministicRoleCallIntake,
  InMemoryRoleCallEventRepository,
  InMemoryRoleCallRepository,
  InMemoryRoleTodoRepository,
  RoleCallOrchestrator,
  type RoleCall,
  type RoleDefinition,
  type RoleIntent
} from "@agent-hub/core";
import { validateRoleCallPolicy } from "@agent-hub/safety";

const createdAt = "2026-05-28T00:00:00.000Z";

function role(overrides: Partial<RoleDefinition>): RoleDefinition {
  return {
    id: "role_analyst",
    handle: "analyst",
    displayName: "Analyst",
    purpose: "Analyze evidence.",
    defaultInstructions: "Analyze evidence.",
    capabilities: ["analysis"],
    permissions: { ...conservativePermissionSet },
    contextPolicy: {
      scope: "current_thread_and_project_context",
      includeApprovedMemory: true,
      includeThreadSummary: true,
      instructions: ["Use runtime context."]
    },
    approvalPolicy: {
      requiredFor: [],
      summary: "No automatic side effects."
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

function createRepositories(): {
  roleTodoRepository: InMemoryRoleTodoRepository;
  roleCallRepository: InMemoryRoleCallRepository;
  roleCallEventRepository: InMemoryRoleCallEventRepository;
} {
  const roleTodoRepository = new InMemoryRoleTodoRepository();
  return {
    roleTodoRepository,
    roleCallRepository: new InMemoryRoleCallRepository(roleTodoRepository),
    roleCallEventRepository: new InMemoryRoleCallEventRepository()
  };
}

function createIdFactory(): (prefix: string) => string {
  const counts = new Map<string, number>();
  return (prefix: string) => {
    const next = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, next);
    return `${prefix}_${next}`;
  };
}

const analyst = role({
  id: "role_analyst",
  handle: "analyst",
  delegationPolicy: {
    canInitiateRoleCalls: true,
    allowedIntentTypes: ["delegate", "request_review"],
    allowedTargetRoles: ["operator", "reviewer"]
  }
});
const operator = role({
  id: "role_operator",
  handle: "operator",
  displayName: "Operator",
  capabilities: ["implementation"]
});
const reviewer = role({
  id: "role_reviewer",
  handle: "reviewer",
  displayName: "Reviewer",
  capabilities: ["review"]
});

function delegateIntent(targetRole = "operator", task = "Inspect failure evidence."): RoleIntent {
  return {
    type: "delegate",
    targetRole,
    task,
    reason: "The caller needs role-specific help.",
    expectedOutput: { format: "summary" }
  };
}

function createOrchestrator(input: {
  decisionsByRole?: Parameters<typeof deterministicRoleCallIntake>[0];
  maxDepth?: number;
  repositories?: ReturnType<typeof createRepositories>;
} = {}): RoleCallOrchestrator {
  const repositories = input.repositories ?? createRepositories();
  return new RoleCallOrchestrator({
    repositories,
    roles: [analyst, operator, reviewer],
    idFactory: createIdFactory(),
    now: () => createdAt,
    intakeDecider: deterministicRoleCallIntake(input.decisionsByRole ?? {}),
    policyValidator: (policyInput) =>
      validateRoleCallPolicy({
        ...policyInput,
        executionPolicy: {
          ...defaultRoleExecutionPolicy,
          maxDepth: input.maxDepth ?? 3,
          allowedDelegations: { analyst: ["operator", "reviewer"] }
        }
      })
  });
}

describe("role call orchestrator ledger runtime", () => {
  it("creates role calls, events, decisions, and accepted todos from valid intents", async () => {
    const repositories = createRepositories();
    const orchestrator = createOrchestrator({ repositories });

    await expect(
      orchestrator.processRoleIntents({
        threadId: "thread_1",
        callerRole: "analyst",
        intents: [delegateIntent()],
        userGoal: "Fix a failed run."
      })
    ).resolves.toEqual([
      expect.objectContaining({
        roleCallId: "role_call_1",
        status: "accepted",
        targetRole: "operator"
      })
    ]);

    await expect(repositories.roleCallRepository.get("role_call_1")).resolves.toEqual(
      expect.objectContaining({
        id: "role_call_1",
        callerRole: "analyst",
        calleeRole: "operator",
        status: "accepted",
        todoId: "role_todo_1",
        decision: expect.objectContaining({ disposition: "accepted" })
      })
    );
    await expect(repositories.roleTodoRepository.get("role_todo_1")).resolves.toEqual(
      expect.objectContaining({
        role: "operator",
        status: "in_progress",
        sourceRoleCallId: "role_call_1"
      })
    );
    await expect(
      repositories.roleCallEventRepository.listByRoleCallId("role_call_1")
    ).resolves.toEqual([
      expect.objectContaining({ type: "created" }),
      expect.objectContaining({ type: "assessment_started" }),
      expect.objectContaining({ type: "accepted" }),
      expect.objectContaining({ type: "todo_created" })
    ]);
  });

  it("creates deferred callee todos and caller-visible summaries", async () => {
    const repositories = createRepositories();
    const orchestrator = createOrchestrator({
      repositories,
      decisionsByRole: {
        reviewer: {
          disposition: "deferred",
          reason: "Reviewer is waiting for operator evidence.",
          suggestedResumeCondition: "after operator evidence is available",
          todo: { title: "Review operator evidence" }
        }
      }
    });

    const summaries = await orchestrator.processRoleIntents({
      threadId: "thread_1",
      callerRole: "analyst",
      intents: [delegateIntent("reviewer", "Review the operator findings.")],
      userGoal: "Fix a failed run."
    });

    expect(summaries).toEqual([
      expect.objectContaining({
        status: "deferred",
        message: expect.stringContaining("Reviewer is waiting")
      })
    ]);
    await expect(repositories.roleTodoRepository.get("role_todo_1")).resolves.toEqual(
      expect.objectContaining({
        role: "reviewer",
        status: "deferred",
        title: "Review operator evidence"
      })
    );
  });

  it("persists rejected calls as collaboration state instead of failed execution", async () => {
    const repositories = createRepositories();
    const orchestrator = createOrchestrator({
      repositories,
      decisionsByRole: {
        operator: {
          disposition: "rejected",
          reason: "This request asks for unrelated work."
        }
      }
    });

    const summaries = await orchestrator.processRoleIntents({
      threadId: "thread_1",
      callerRole: "analyst",
      intents: [delegateIntent()],
      userGoal: "Fix a failed run."
    });

    expect(summaries[0]).toMatchObject({
      status: "rejected",
      message: expect.stringContaining("not failed")
    });
    await expect(repositories.roleCallRepository.get("role_call_1")).resolves.toEqual(
      expect.objectContaining({
        status: "rejected",
        decision: expect.objectContaining({ disposition: "rejected" })
      })
    );
    await expect(repositories.roleTodoRepository.get("role_todo_1")).resolves.toEqual(
      expect.objectContaining({ status: "rejected", completedAt: createdAt })
    );
  });

  it("uses policy guards to prevent depth, cycle, and duplicate runaway graphs", async () => {
    const repositories = createRepositories();
    await repositories.roleCallRepository.create(existingCall("call_duplicate"));
    await repositories.roleCallRepository.create({
      ...existingCall("call_cycle"),
      callerRole: "operator",
      calleeRole: "analyst",
      task: "Ask analyst again."
    });
    const orchestrator = createOrchestrator({ repositories });

    const duplicate = await orchestrator.processRoleIntents({
      threadId: "thread_1",
      callerRole: "analyst",
      intents: [delegateIntent()],
      userGoal: "Fix a failed run."
    });
    expect(duplicate[0]).toMatchObject({
      status: "blocked",
      reasons: expect.arrayContaining([
        "Duplicate active role call detected."
      ])
    });
    await expect(repositories.roleCallRepository.list({ threadId: "thread_1" }))
      .resolves.toHaveLength(2);

    const depthRepositories = createRepositories();
    await depthRepositories.roleCallRepository.create({
      ...existingCall("call_parent"),
      depth: 1
    });
    const depthOrchestrator = createOrchestrator({
      repositories: depthRepositories,
      maxDepth: 1
    });
    const depth = await depthOrchestrator.processRoleIntents({
      threadId: "thread_1",
      callerRole: "analyst",
      parentRoleCallId: "call_parent",
      intents: [delegateIntent("reviewer", "Review evidence.")],
      userGoal: "Fix a failed run."
    });

    expect(depth[0]).toMatchObject({
      status: "blocked",
      reasons: expect.arrayContaining([
        "Role call depth 2 exceeds max depth 1."
      ])
    });
    await expect(depthRepositories.roleCallRepository.list({ threadId: "thread_1" }))
      .resolves.toHaveLength(1);
  });
});

function existingCall(id: string): RoleCall {
  return {
    id,
    threadId: "thread_1",
    callerRole: "analyst",
    calleeRole: "operator",
    task: "Inspect failure evidence.",
    context: { userGoal: "Fix a failed run." },
    permissions: { ...conservativePermissionSet },
    expectedOutput: { format: "summary" },
    priority: "normal",
    depth: 1,
    status: "running",
    createdAt
  };
}
