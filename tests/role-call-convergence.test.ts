import { describe, expect, it } from "vitest";
import {
  buildCallerReinjectionContext,
  conservativePermissionSet,
  decideCallerContinuation,
  evaluateRoleCallGraphConvergence,
  InMemoryRoleCallEventRepository,
  InMemoryRoleCallRepository,
  InMemoryRoleTodoRepository,
  type RoleCall
} from "@agent-hub/core";

const createdAt = "2026-05-28T00:00:00.000Z";

function call(overrides: Partial<RoleCall>): RoleCall {
  return {
    id: "call_1",
    threadId: "thread_1",
    callerRole: "analyst",
    calleeRole: "operator",
    task: "Inspect failure evidence.",
    context: { userGoal: "Fix failed run." },
    permissions: { ...conservativePermissionSet },
    expectedOutput: { format: "summary" },
    priority: "normal",
    depth: 1,
    status: "accepted",
    createdAt,
    ...overrides
  };
}

describe("role call caller reinjection and graph convergence", () => {
  it("injects deferred and rejected decisions as normal caller state", async () => {
    const todos = new InMemoryRoleTodoRepository();
    const calls = new InMemoryRoleCallRepository(todos);
    const events = new InMemoryRoleCallEventRepository();
    await calls.create(
      call({
        id: "call_deferred",
        calleeRole: "reviewer",
        status: "deferred",
        decision: {
          disposition: "deferred",
          reason: "Waiting for operator evidence.",
          suggestedResumeCondition: "after operator completes tests"
        }
      })
    );
    await calls.create(
      call({
        id: "call_rejected",
        calleeRole: "operator",
        status: "rejected",
        decision: {
          disposition: "rejected",
          reason: "Request is outside current scope."
        }
      })
    );
    await todos.create({
      id: "todo_deferred",
      threadId: "thread_1",
      role: "reviewer",
      sourceRoleCallId: "call_deferred",
      title: "Review operator evidence later",
      status: "deferred",
      priority: "normal",
      relatedRoleCallIds: ["call_deferred"],
      createdAt,
      updatedAt: createdAt
    });
    await events.create({
      id: "event_deferred",
      roleCallId: "call_deferred",
      threadId: "thread_1",
      type: "deferred",
      actorRole: "reviewer",
      message: "Reviewer deferred until evidence is ready.",
      createdAt
    });

    const context = await buildCallerReinjectionContext(
      {
        roleCallRepository: calls,
        roleTodoRepository: todos,
        roleCallEventRepository: events
      },
      { threadId: "thread_1", callerRole: "analyst" }
    );

    expect(context.decisionSummaries.join("\n")).toContain("Decision: deferred");
    expect(context.decisionSummaries.join("\n")).toContain("Decision: rejected");
    expect(context.decisionSummaries.join("\n")).not.toContain("failed");
    expect(context.todoSummaries).toEqual([
      "@reviewer todo deferred: Review operator evidence later"
    ]);
    expect(context.eventSummaries).toEqual([
      "deferred: Reviewer deferred until evidence is ready."
    ]);
  });

  it("lets a caller replan after reviewer deferral creates a todo", async () => {
    const todos = new InMemoryRoleTodoRepository();
    const calls = new InMemoryRoleCallRepository(todos);
    const events = new InMemoryRoleCallEventRepository();
    await calls.create(
      call({
        id: "call_operator_reviewer",
        callerRole: "operator",
        calleeRole: "reviewer",
        status: "deferred",
        decision: {
          disposition: "deferred",
          reason: "Reviewer is waiting for the patch diff."
        }
      })
    );
    await todos.create({
      id: "todo_review",
      threadId: "thread_1",
      role: "reviewer",
      sourceRoleCallId: "call_operator_reviewer",
      title: "Review patch diff",
      status: "deferred",
      priority: "normal",
      relatedRoleCallIds: ["call_operator_reviewer"],
      createdAt,
      updatedAt: createdAt
    });

    const context = await buildCallerReinjectionContext(
      {
        roleCallRepository: calls,
        roleTodoRepository: todos,
        roleCallEventRepository: events
      },
      { threadId: "thread_1", callerRole: "operator" }
    );
    const convergence = evaluateRoleCallGraphConvergence({
      roleCalls: await calls.list({ threadId: "thread_1" })
    });

    expect(context.decisionSummaries.join("\n")).toContain("Reviewer is waiting");
    expect(context.todoSummaries).toEqual([
      "@reviewer todo deferred: Review patch diff"
    ]);
    expect(decideCallerContinuation({
      convergence,
      continuationCount: 0,
      maxContinuations: 2
    })).toEqual({ continueCaller: true, reason: "idle" });
  });

  it("stops graph execution for pending work, approvals, limits, or final answers", () => {
    expect(
      evaluateRoleCallGraphConvergence({
        roleCalls: [call({ id: "call_running", status: "running" })]
      })
    ).toMatchObject({
      converged: false,
      reason: "pending_role_calls",
      pendingRoleCallIds: ["call_running"]
    });
    expect(
      evaluateRoleCallGraphConvergence({
        roleCalls: [call({ id: "call_approval", status: "waiting_approval" })]
      })
    ).toMatchObject({
      converged: false,
      reason: "blocking_approval",
      blockingApprovalRoleCallIds: ["call_approval"]
    });
    expect(
      evaluateRoleCallGraphConvergence({
        roleCalls: [call({ id: "call_done", status: "succeeded" })],
        finalAnswer: "The run is fixed."
      })
    ).toMatchObject({ converged: true, reason: "final_answer" });
    expect(
      decideCallerContinuation({
        convergence: evaluateRoleCallGraphConvergence({
          roleCalls: [call({ id: "call_done", status: "succeeded" })],
          continuationCount: 2,
          maxContinuations: 2
        }),
        continuationCount: 2,
        maxContinuations: 2
      })
    ).toEqual({ continueCaller: false, reason: "continuation_limit" });
  });
});
