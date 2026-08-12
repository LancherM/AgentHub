import { describe, expect, it } from "vitest";
import {
  conservativePermissionSet,
  InMemoryConversationMessageRepository,
  InMemoryRoleCallEventRepository,
  InMemoryRoleCallRepository,
  InMemoryRoleTodoRepository,
  InMemoryRunMetadataRepository,
  InMemoryTraceLinkRepository,
  processAssistantRoleCallOutput,
  validateConversationMessage,
  validateRoleDefinition,
  type RoleDefinition
} from "@agent-hub/core";

function role(overrides: Partial<RoleDefinition>): RoleDefinition {
  return validateRoleDefinition({
    id: "role_analyst",
    handle: "analyst",
    displayName: "Analyst",
    purpose: "Analyze evidence.",
    defaultInstructions: "Summarize the evidence.",
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
    delegationPolicy: {
      canInitiateRoleCalls: true,
      allowedIntentTypes: ["delegate"],
      allowedTargetRoles: ["researcher"]
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
  });
}

describe("assistant RoleCall output processor", () => {
  it("creates RoleCalls, executes accepted callbacks, and marks assistant metadata", async () => {
    const messages = new InMemoryConversationMessageRepository();
    const todos = new InMemoryRoleTodoRepository();
    const roleCalls = new InMemoryRoleCallRepository(todos);
    const roleCallEvents = new InMemoryRoleCallEventRepository();
    const runMetadata = new InMemoryRunMetadataRepository();
    const traceLinks = new InMemoryTraceLinkRepository();
    await runMetadata.save({
      runId: "run_source",
      planBinding: {
        planGraphId: "plan_graph_1",
        planGraphVersion: 1,
        planNodeId: "plan_node_implement",
        allowedNextPlanNodeIds: ["plan_node_verify"]
      }
    });
    const message = await messages.create(validateConversationMessage({
      id: "message_role_output",
      threadId: "thread_1",
      sequence: 0,
      role: "assistant",
      kind: "text",
      content: "@researcher summarize evidence",
      runId: "run_source",
      status: "succeeded",
      createdAt: "2026-01-01T00:00:00.000Z"
    }));
    const executionInputs: string[] = [];
    let nextId = 0;

    const result = await processAssistantRoleCallOutput({
      repositories: {
        conversationMessageRepository: messages,
        roleCallRepository: roleCalls,
        roleCallEventRepository: roleCallEvents,
        roleTodoRepository: todos,
        runMetadataRepository: runMetadata,
        traceLinkRepository: traceLinks
      },
      threadId: "thread_1",
      callerRole: "analyst",
      message,
      roles: [
        role({ handle: "analyst" }),
        role({
          id: "role_researcher",
          handle: "researcher",
          displayName: "Researcher",
          capabilities: ["research"],
          delegationPolicy: {
            canInitiateRoleCalls: false,
            allowedIntentTypes: [],
            allowedTargetRoles: []
          }
        })
      ],
      userGoal: "Coordinate research.",
      idFactory: (prefix) => `${prefix}_${++nextId}`,
      now: () => "2026-01-01T00:00:01.000Z",
      executeAcceptedRoleCalls: async ({ parentMessageId }) => {
        executionInputs.push(parentMessageId);
        return { ok: true, warnings: ["executed accepted role call"] };
      },
      roleCallSummary: () => ({ total: 1 })
    });

    const persistedCalls = await roleCalls.list({ threadId: "thread_1" });
    const updatedMessage = await messages.get("message_role_output");

    expect(result.ok).toBe(true);
    expect(result.processed).toBe(true);
    expect(executionInputs).toEqual(["message_role_output"]);
    expect(persistedCalls).toEqual([
      expect.objectContaining({
        callerRole: "analyst",
        calleeRole: "researcher",
        task: "summarize evidence",
        status: "accepted",
        parentMessageId: "message_role_output"
      })
    ]);
    expect(updatedMessage?.metadata).toEqual(expect.objectContaining({
      roleCallProcessed: true,
      roleCallProcessedAt: "2026-01-01T00:00:01.000Z",
      roleCallParseWarnings: ["executed accepted role call"],
      roleCallSummary: { total: 1 }
    }));
    expect(updatedMessage?.metadata?.roleCallLedgerSummaries).toEqual([
      expect.objectContaining({
        targetRole: "researcher",
        status: "accepted"
      })
    ]);
    await expect(traceLinks.listByPlanGraphId("plan_graph_1")).resolves.toEqual(
      expect.objectContaining({
        nodes: [
          expect.objectContaining({
            kind: "role_call",
            sourceType: "role_call",
            sourceId: expect.any(String)
          })
        ],
        roleCallToolEvents: [
          expect.objectContaining({
            sourcePlanNodeId: "plan_node_implement",
            sourceRunId: "run_source",
            targetRole: "researcher",
            status: "accepted"
          })
        ]
      })
    );
  });
});
