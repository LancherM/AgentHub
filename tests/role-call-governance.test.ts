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
  type DelegateRoleIntent,
  type PermissionSet,
  type RoleDefinition,
  type RoleIntent,
  type RoleTodo
} from "@agent-hub/core";
import { validateRoleCallPolicy } from "@agent-hub/safety";

const createdAt = "2026-05-28T00:00:00.000Z";

function permissionSet(overrides: Partial<PermissionSet> = {}): PermissionSet {
  return {
    ...conservativePermissionSet,
    ...overrides
  };
}

function role(overrides: Partial<RoleDefinition>): RoleDefinition {
  return {
    id: "role_analyst",
    handle: "analyst",
    displayName: "Analyst",
    purpose: "Analyze evidence.",
    defaultInstructions: "Analyze evidence and summarize tradeoffs.",
    capabilities: ["analysis"],
    permissions: permissionSet(),
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
  capabilities: ["analysis", "planning"],
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
  capabilities: ["implementation", "local_execution"],
  permissions: permissionSet({ canRunCommands: true }),
  delegationPolicy: {
    canInitiateRoleCalls: true,
    allowedIntentTypes: ["request_review"],
    allowedTargetRoles: ["reviewer"]
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
  capabilities: ["review", "risk"],
  intakePolicy: {
    acceptsRoleCalls: true,
    acceptedIntentTypes: ["request_review", "delegate"],
    acceptedCallerRoles: ["analyst", "operator"],
    canReject: true,
    canDefer: true
  }
});

function createOrchestrator(input: {
  repositories?: ReturnType<typeof createRepositories>;
  maxTodosPerRole?: number;
} = {}): RoleCallOrchestrator {
  const repositories = input.repositories ?? createRepositories();
  return new RoleCallOrchestrator({
    repositories,
    roles: [analyst, operator, reviewer],
    idFactory: createIdFactory(),
    now: () => createdAt,
    intakeDecider: deterministicRoleCallIntake({
      reviewer: {
        disposition: "deferred",
        reason: "Reviewer is waiting for operator evidence.",
        suggestedResumeCondition: "operator evidence is ready",
        todo: { title: "Review operator evidence" }
      }
    }),
    policyValidator: (policyInput) =>
      validateRoleCallPolicy({
        ...policyInput,
        executionPolicy: {
          ...defaultRoleExecutionPolicy,
          allowedDelegations: {
            analyst: ["operator", "reviewer"],
            operator: ["reviewer"]
          },
          maxTodosPerRole: input.maxTodosPerRole ?? 20
        }
      })
  });
}

function delegateIntent(
  targetRole: string,
  task = "Inspect failed run evidence."
): DelegateRoleIntent {
  return {
    type: "delegate",
    targetRole,
    task,
    reason: "The caller needs role-specific help.",
    expectedOutput: { format: "summary" }
  };
}

function reviewIntent(task = "Review operator evidence."): RoleIntent {
  return {
    type: "request_review",
    targetRole: "reviewer",
    task,
    reason: "Operator wants independent risk review.",
    priority: "normal"
  };
}

describe("adaptive role call governance hardening", () => {
  it("runs an analyst -> operator -> reviewer ledger loop with retry and cancellation", async () => {
    const repositories = createRepositories();
    const orchestrator = createOrchestrator({ repositories });

    const operatorSummaries = await orchestrator.processRoleIntents({
      threadId: "thread_1",
      callerRole: "analyst",
      intents: [delegateIntent("operator")],
      userGoal: "Fix a failed verification run."
    });
    expect(operatorSummaries[0]).toMatchObject({
      roleCallId: "role_call_1",
      status: "accepted",
      targetRole: "operator"
    });

    await expect(
      orchestrator.markRoleCallSucceeded("role_call_1", {
        summary: "Operator found the failing command evidence.",
        evidence: ["task_run:run_1"],
        commandsRun: [
          {
            command: "pnpm test -- --runInBand",
            exitCode: 1,
            outputSummary: "One regression failed."
          }
        ]
      })
    ).resolves.toMatchObject({
      roleCallId: "role_call_1",
      status: "accepted"
    });
    await expect(repositories.roleTodoRepository.get("role_todo_1")).resolves.toEqual(
      expect.objectContaining({ status: "done" })
    );

    const reviewerSummaries = await orchestrator.processRoleIntents({
      threadId: "thread_1",
      callerRole: "operator",
      parentRoleCallId: "role_call_1",
      intents: [reviewIntent()],
      userGoal: "Fix a failed verification run."
    });
    expect(reviewerSummaries[0]).toMatchObject({
      roleCallId: "role_call_2",
      status: "deferred",
      targetRole: "reviewer"
    });
    await expect(repositories.roleTodoRepository.get("role_todo_2")).resolves.toEqual(
      expect.objectContaining({
        role: "reviewer",
        status: "deferred",
        title: "Review operator evidence"
      })
    );

    await expect(
      orchestrator.retryRoleCall(
        "role_call_2",
        "Operator evidence is available; resume review."
      )
    ).resolves.toMatchObject({
      roleCallId: "role_call_2",
      status: "accepted"
    });
    await expect(repositories.roleCallRepository.get("role_call_2")).resolves.toEqual(
      expect.objectContaining({
        status: "accepted",
        decision: expect.objectContaining({ disposition: "accepted" })
      })
    );
    await expect(repositories.roleTodoRepository.get("role_todo_2")).resolves.toEqual(
      expect.objectContaining({ status: "in_progress" })
    );
    await expect(
      repositories.roleCallEventRepository.listByRoleCallId("role_call_2")
    ).resolves.toContainEqual(
      expect.objectContaining({
        type: "accepted",
        metadata: expect.objectContaining({
          retry: true,
          previousStatus: "deferred"
        })
      })
    );

    await expect(
      orchestrator.cancelRoleCall("role_call_2", "Reviewer cancelled by user.")
    ).resolves.toMatchObject({
      roleCallId: "role_call_2",
      status: "ignored"
    });
    await expect(repositories.roleCallRepository.get("role_call_2")).resolves.toEqual(
      expect.objectContaining({ status: "cancelled" })
    );
    await expect(repositories.roleTodoRepository.get("role_todo_2")).resolves.toEqual(
      expect.objectContaining({ status: "cancelled" })
    );
  });

  it("authorizes explicit custom roles and gates file, shell, network, and high-risk targets", () => {
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
        acceptedCallerCapabilities: ["test_planning"],
        canReject: true,
        canDefer: true
      }
    });
    const analysisIntent: RoleIntent = {
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
        intent: analysisIntent,
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
        intent: analysisIntent
      })
    ).toMatchObject({
      allowed: false,
      status: "blocked",
      reasons: expect.arrayContaining([
        "Caller role @random cannot initiate role calls."
      ])
    });

    const powerfulCaller = role({
      id: "role_powerful_caller",
      handle: "powerfulcaller",
      displayName: "Powerful Caller",
      permissions: permissionSet({
        canEditFiles: true,
        canRunCommands: true,
        canUseNetwork: true
      }),
      delegationPolicy: {
        canInitiateRoleCalls: true,
        allowedIntentTypes: ["delegate"],
        allowedTargetRoles: ["operator"]
      }
    });
    const powerfulOperator = role({
      ...operator,
      permissions: permissionSet({
        canEditFiles: true,
        canRunCommands: true,
        canUseNetwork: true
      }),
      approvalPolicy: {
        requiredFor: ["network"],
        summary: "Network access requires explicit approval."
      }
    });
    const operatorIntent = delegateIntent("operator", "Run governed local work.");

    expect(
      validateRoleCallPolicy({
        callerRole: powerfulCaller,
        calleeRole: powerfulOperator,
        intent: operatorIntent,
        requestedPermissions: permissionSet({ canEditFiles: true })
      })
    ).toMatchObject({
      allowed: false,
      status: "approval_required",
      approvalReasons: expect.arrayContaining(["file write permission"])
    });

    expect(
      validateRoleCallPolicy({
        callerRole: powerfulCaller,
        calleeRole: powerfulOperator,
        intent: operatorIntent,
        requestedPermissions: permissionSet({ canRunCommands: true })
      })
    ).toMatchObject({
      allowed: false,
      status: "approval_required",
      approvalReasons: expect.arrayContaining(["shell command permission"])
    });

    expect(
      validateRoleCallPolicy({
        callerRole: powerfulCaller,
        calleeRole: powerfulOperator,
        intent: operatorIntent,
        requestedPermissions: permissionSet({ canUseNetwork: true })
      })
    ).toMatchObject({
      allowed: false,
      status: "approval_required",
      approvalReasons: expect.arrayContaining(["network permission"])
    });

    expect(
      validateRoleCallPolicy({
        callerRole: {
          ...powerfulCaller,
          delegationPolicy: {
            canInitiateRoleCalls: true,
            allowedIntentTypes: ["delegate"],
            allowedTargetRoles: ["operator"],
            requiresApprovalForTargets: ["operator"]
          }
        },
        calleeRole: powerfulOperator,
        intent: operatorIntent
      })
    ).toMatchObject({
      allowed: false,
      status: "approval_required",
      approvalReasons: expect.arrayContaining(["target @operator"])
    });

    expect(
      validateRoleCallPolicy({
        callerRole: powerfulCaller,
        calleeRole: powerfulOperator,
        intent: {
          ...operatorIntent,
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

  it("suppresses duplicate active calls and enforces callee todo capacity", async () => {
    const duplicateRepositories = createRepositories();
    const duplicateOrchestrator = createOrchestrator({
      repositories: duplicateRepositories
    });

    await duplicateOrchestrator.processRoleIntents({
      threadId: "thread_1",
      callerRole: "analyst",
      intents: [delegateIntent("operator")],
      userGoal: "Fix a failed verification run."
    });
    const duplicate = await duplicateOrchestrator.processRoleIntents({
      threadId: "thread_1",
      callerRole: "analyst",
      intents: [delegateIntent("operator")],
      userGoal: "Fix a failed verification run."
    });

    expect(duplicate[0]).toMatchObject({
      status: "blocked",
      reasons: expect.arrayContaining(["Duplicate active role call detected."])
    });
    await expect(duplicateRepositories.roleCallRepository.list()).resolves.toHaveLength(1);

    const capacityRepositories = createRepositories();
    await capacityRepositories.roleTodoRepository.create(openReviewerTodo());
    const capacityOrchestrator = createOrchestrator({
      repositories: capacityRepositories,
      maxTodosPerRole: 1
    });
    const capacity = await capacityOrchestrator.processRoleIntents({
      threadId: "thread_1",
      callerRole: "analyst",
      intents: [delegateIntent("reviewer", "Review the operator evidence.")],
      userGoal: "Fix a failed verification run."
    });

    expect(capacity[0]).toMatchObject({
      status: "blocked",
      reasons: expect.arrayContaining([
        "Callee @reviewer has reached todo capacity 1."
      ])
    });
    await expect(capacityRepositories.roleCallRepository.list()).resolves.toHaveLength(0);
  });
});

function openReviewerTodo(): RoleTodo {
  return {
    id: "role_todo_existing",
    threadId: "thread_1",
    role: "reviewer",
    title: "Existing reviewer work",
    status: "open",
    priority: "normal",
    relatedRoleCallIds: [],
    createdAt,
    updatedAt: createdAt
  };
}
