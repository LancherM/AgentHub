import { describe, expect, it } from "vitest";
import {
  buildRoleSystemPrompt,
  conservativePermissionSet,
  InMemoryRoleCallEventRepository,
  InMemoryRoleCallRepository,
  InMemoryRoleTodoRepository,
  MAX_INVALID_ROLE_RESULT_RAW_OUTPUT_CHARS,
  parseRoleResultJson,
  persistRoleResultJson,
  RoleCallContextBuilder,
  summarizeRoleCallDecision,
  summarizeRoleResult,
  type RoleCall,
  type RoleDefinition
} from "@agent-hub/core";

const createdAt = "2026-05-28T00:00:00.000Z";
const completedAt = "2026-05-28T00:00:01.000Z";

function role(overrides: Partial<RoleDefinition>): RoleDefinition {
  return {
    id: "role_operator",
    handle: "operator",
    displayName: "Operator",
    purpose: "Coordinate local execution.",
    defaultInstructions: "Use local evidence and avoid unapproved side effects.",
    capabilities: ["local_execution"],
    permissions: {
      ...conservativePermissionSet,
      canRunCommands: true
    },
    contextPolicy: {
      scope: "current_thread_and_project_context",
      includeApprovedMemory: true,
      includeThreadSummary: true,
      instructions: ["Use runtime-injected context."]
    },
    approvalPolicy: {
      requiredFor: ["external_side_effects"],
      summary: "External side effects require approval."
    },
    delegationPolicy: {
      canInitiateRoleCalls: false,
      allowedIntentTypes: []
    },
    intakePolicy: {
      acceptsRoleCalls: true,
      acceptedIntentTypes: ["delegate"],
      canReject: true,
      canDefer: true
    },
    executor: { kind: "agent_adapter", adapter: "fake" },
    trustLevel: "preset",
    enabled: true,
    ...overrides
  };
}

function call(overrides: Partial<RoleCall>): RoleCall {
  return {
    id: "call_1",
    threadId: "thread_1",
    callerRole: "analyst",
    calleeRole: "operator",
    task: "Inspect failed run.",
    context: { userGoal: "Fix failed run." },
    permissions: { ...conservativePermissionSet },
    expectedOutput: { format: "json" },
    priority: "normal",
    depth: 1,
    status: "accepted",
    createdAt,
    ...overrides
  };
}

describe("role call context and structured output protocol", () => {
  it("builds compact RoleCallContext without unrelated chatter or raw logs", async () => {
    const todos = new InMemoryRoleTodoRepository();
    const calls = new InMemoryRoleCallRepository(todos);
    const builder = new RoleCallContextBuilder({
      roleCallRepository: calls,
      roleTodoRepository: todos
    });

    await calls.create(
      call({
        id: "call_relevant",
        status: "succeeded",
        result: {
          summary: "Operator found the failing command.",
          evidence: ["run event 3"],
          rawOutput: "FULL RAW LOG SHOULD NOT ENTER CONTEXT"
        },
        completedAt
      })
    );
    await calls.create(
      call({
        id: "call_unrelated",
        callerRole: "memory",
        calleeRole: "reviewer",
        task: "Unrelated memory review.",
        status: "succeeded",
        result: {
          summary: "Unrelated role chatter.",
          evidence: ["memory note"],
          rawOutput: "UNRELATED RAW LOG"
        },
        completedAt
      })
    );
    await todos.create({
      id: "todo_caller",
      threadId: "thread_1",
      role: "analyst",
      title: "Replan after operator evidence",
      status: "open",
      priority: "normal",
      relatedRoleCallIds: ["call_relevant"],
      createdAt,
      updatedAt: createdAt
    });
    await todos.create({
      id: "todo_callee",
      threadId: "thread_1",
      role: "operator",
      title: "Collect command output",
      status: "in_progress",
      priority: "normal",
      relatedRoleCallIds: ["call_relevant"],
      createdAt,
      updatedAt: createdAt
    });

    const context = await builder.build({
      threadId: "thread_1",
      callerRole: "analyst",
      calleeRole: "operator",
      userGoal: "Fix failed run.",
      currentPlan: "Inspect then patch.",
      constraints: ["Stay local-first"],
      relevantFiles: ["apps/desktop/src/App.tsx"],
      repoState: {
        branch: "codex/test",
        changedFiles: ["apps/desktop/src/App.tsx"],
        testStatus: "pending"
      }
    });

    expect(context.previousRoleResults).toEqual([
      {
        summary: "Operator found the failing command.",
        evidence: ["run event 3"]
      }
    ]);
    expect(JSON.stringify(context)).not.toContain("FULL RAW LOG");
    expect(JSON.stringify(context)).not.toContain("Unrelated role chatter");
    expect(context.callerTodoState?.map((todo) => todo.id)).toEqual(["todo_caller"]);
    expect(context.calleeTodoState?.map((todo) => todo.id)).toEqual(["todo_callee"]);
  });

  it("marks invalid RoleResult JSON failed with bounded audit evidence", async () => {
    const todos = new InMemoryRoleTodoRepository();
    const roleCallRepository = new InMemoryRoleCallRepository(todos);
    const roleCallEventRepository = new InMemoryRoleCallEventRepository();
    await roleCallRepository.create(call({ id: "call_invalid", status: "accepted" }));
    const rawOutput = "{bad json" + "x".repeat(MAX_INVALID_ROLE_RESULT_RAW_OUTPUT_CHARS + 10);

    const result = await persistRoleResultJson({
      roleCallRepository,
      roleCallEventRepository,
      roleCallId: "call_invalid",
      rawOutput,
      at: completedAt
    });

    expect(result.ok).toBe(false);
    await expect(roleCallRepository.get("call_invalid")).resolves.toEqual(
      expect.objectContaining({
        status: "failed",
        error: expect.any(String)
      })
    );
    const events = await roleCallEventRepository.listByRoleCallId("call_invalid");
    expect(events).toEqual([
      expect.objectContaining({
        type: "failed",
        metadata: expect.objectContaining({
          rawOutput: expect.any(String),
          parseError: expect.any(String)
        })
      })
    ]);
    expect((events[0].metadata?.rawOutput as string).length)
      .toBe(MAX_INVALID_ROLE_RESULT_RAW_OUTPUT_CHARS);
  });

  it("validates RoleResult JSON and strips rawOutput from valid results", () => {
    const result = parseRoleResultJson(JSON.stringify({
      summary: "Patch applied and tests passed.",
      evidence: ["pnpm test"],
      rawOutput: "this should not be persisted for valid output"
    }));

    expect(result).toEqual({
      ok: true,
      result: {
        summary: "Patch applied and tests passed.",
        evidence: ["pnpm test"]
      }
    });
  });

  it("builds role prompts and compact caller reinjection summaries", () => {
    const prompt = buildRoleSystemPrompt({
      role: role({ handle: "operator", displayName: "Operator" }),
      expectedOutput: { format: "json" }
    });
    expect(prompt).toContain("@operator");
    expect(prompt).toContain("Return strict RoleResult JSON");
    expect(prompt).toContain("shell requires approval");

    const decisionSummary = summarizeRoleCallDecision(
      {
        disposition: "deferred",
        reason: "x".repeat(300),
        suggestedResumeCondition: "after tests"
      },
      120
    );
    const resultSummary = summarizeRoleResult(
      {
        summary: "y".repeat(300),
        evidence: ["run event 1"],
        nextSteps: ["continue"]
      },
      120
    );

    expect(decisionSummary.length).toBeLessThanOrEqual(120);
    expect(resultSummary.length).toBeLessThanOrEqual(120);
    expect(decisionSummary).toContain("Decision: deferred");
    expect(resultSummary).toContain("yyy");
  });
});
