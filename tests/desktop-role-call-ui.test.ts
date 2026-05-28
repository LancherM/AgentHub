import { describe, expect, it } from "vitest";
import {
  buildRoleCallUiSummary,
  roleCallAffordance,
  roleCallStatusTone,
  roleCallSummaryFromMetadata,
  roleTodoStatusTone
} from "../apps/desktop/src/lib/role-call-ui";
import {
  conservativePermissionSet,
  type RoleCall,
  type RoleCallEvent,
  type RoleTodo
} from "@agent-hub/shared";

const now = "2026-05-28T08:00:00.000Z";

describe("desktop role-call UI helpers", () => {
  it("builds compact transcript counts while keeping evidence in details", () => {
    const summary = buildRoleCallUiSummary({
      threadId: "thread_1",
      sourceMessageId: "message_assistant_1",
      calls: [
        roleCall({
          id: "call_operator",
          status: "succeeded",
          callerRole: "analyst",
          calleeRole: "operator",
          taskRunId: "run_operator",
          result: {
            summary: "Patched the focused verification path.",
            evidence: ["Focused test passed."],
            commandsRun: [
              {
                command: "pnpm vitest run tests/role-call-ui.test.ts",
                exitCode: 0,
                outputSummary: "1 file passed"
              }
            ],
            filesTouched: ["apps/desktop/src/components/chat/RoleCallSummary.tsx"]
          },
          completedAt: now
        }),
        roleCall({
          id: "call_review",
          status: "deferred",
          callerRole: "operator",
          calleeRole: "reviewer",
          decision: {
            disposition: "deferred",
            reason: "Reviewer waits for focused checks.",
            evidence: ["Operator run is still collecting evidence."],
            suggestedResumeCondition: "Focused checks complete"
          }
        }),
        roleCall({
          id: "call_scope",
          status: "rejected",
          callerRole: "reviewer",
          calleeRole: "operator",
          decision: {
            disposition: "rejected",
            reason: "Requested work is outside the current user goal.",
            evidence: ["No matching task brief scope."],
            risk: "scope creep"
          }
        })
      ],
      todos: [
        roleTodo({
          id: "todo_review",
          sourceRoleCallId: "call_review",
          status: "deferred",
          title: "Review operator patch after focused tests"
        })
      ],
      events: [
        roleCallEvent({
          id: "event_review_deferred",
          roleCallId: "call_review",
          type: "deferred",
          message: "Reviewer deferred until tests complete."
        })
      ],
      updatedAt: now
    });

    expect(summary.counts).toMatchObject({
      total: 3,
      deferred: 1,
      rejected: 1,
      todosOpen: 1
    });
    expect(summary.calls[0].evidence.map((item) => item.kind)).toEqual([
      "evidence",
      "command",
      "file"
    ]);
    expect(roleCallAffordance(summary)).toEqual({
      label: "3 role calls · 1 deferred · 1 rejected · 1 todo · review needed",
      tone: "danger",
      needsReview: true
    });
  });

  it("filters unrelated todo and event records from a message summary", () => {
    const summary = buildRoleCallUiSummary({
      threadId: "thread_1",
      sourceMessageId: "message_assistant_1",
      calls: [roleCall({ id: "call_visible", status: "running" })],
      todos: [
        roleTodo({ id: "todo_visible", sourceRoleCallId: "call_visible" }),
        roleTodo({ id: "todo_unrelated", sourceRoleCallId: "call_other" })
      ],
      events: [
        roleCallEvent({ id: "event_visible", roleCallId: "call_visible" }),
        roleCallEvent({ id: "event_unrelated", roleCallId: "call_other" })
      ]
    });

    expect(summary.todos.map((todo) => todo.id)).toEqual(["todo_visible"]);
    expect(summary.events.map((event) => event.id)).toEqual(["event_visible"]);
    expect(roleCallAffordance(summary)).toMatchObject({
      label: "1 role call · 1 active · 1 todo",
      tone: "info"
    });
  });

  it("accepts bounded metadata summaries and maps status tones", () => {
    const summary = buildRoleCallUiSummary({
      threadId: "thread_1",
      calls: [roleCall({ id: "call_done", status: "succeeded" })],
      todos: [],
      events: []
    });

    expect(roleCallSummaryFromMetadata(summary)).toBe(summary);
    expect(roleCallSummaryFromMetadata({ counts: {} })).toBeUndefined();
    expect(roleCallStatusTone("waiting_approval")).toBe("warning");
    expect(roleCallStatusTone("succeeded")).toBe("success");
    expect(roleTodoStatusTone("blocked")).toBe("warning");
  });
});

function roleCall(input: Partial<RoleCall>): RoleCall {
  return {
    id: input.id ?? "call_1",
    threadId: "thread_1",
    parentMessageId: "message_assistant_1",
    parentRoleCallId: input.parentRoleCallId,
    callerRole: input.callerRole ?? "analyst",
    calleeRole: input.calleeRole ?? "operator",
    task: input.task ?? "Inspect focused evidence.",
    reason: input.reason ?? "Need role-specific evidence.",
    context: { userGoal: "Implement ARC-8 role-call UI." },
    permissions: conservativePermissionSet,
    expectedOutput: {
      format: "summary",
      description: "Concise role-call result."
    },
    priority: input.priority ?? "normal",
    depth: input.depth ?? 0,
    status: input.status ?? "accepted",
    decision: input.decision,
    result: input.result,
    taskRunId: input.taskRunId,
    todoId: input.todoId,
    error: input.error,
    createdAt: input.createdAt ?? now,
    startedAt: input.startedAt,
    completedAt: input.completedAt
  };
}

function roleTodo(input: Partial<RoleTodo>): RoleTodo {
  return {
    id: input.id ?? "todo_1",
    threadId: "thread_1",
    role: input.role ?? "reviewer",
    sourceRoleCallId: input.sourceRoleCallId,
    parentTodoId: input.parentTodoId,
    title: input.title ?? "Review focused evidence.",
    description: input.description,
    status: input.status ?? "open",
    priority: input.priority ?? "normal",
    reason: input.reason,
    blockedBy: input.blockedBy,
    relatedRoleCallIds: input.relatedRoleCallIds ?? [],
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    completedAt: input.completedAt
  };
}

function roleCallEvent(input: Partial<RoleCallEvent>): RoleCallEvent {
  return {
    id: input.id ?? "event_1",
    roleCallId: input.roleCallId ?? "call_1",
    threadId: "thread_1",
    type: input.type ?? "created",
    actorRole: input.actorRole ?? "system",
    message: input.message ?? "RoleCall event recorded.",
    metadata: input.metadata,
    createdAt: input.createdAt ?? now
  };
}
