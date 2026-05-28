import { describe, expect, it } from "vitest";
import { createCliRuntime, main } from "@agent-hub/cli";
import {
  conservativePermissionSet,
  type RoleCall,
  type RoleCallEvent,
  type RoleTodo
} from "@agent-hub/core";

const now = "2026-05-28T08:00:00.000Z";

describe("CLI role-call audit commands", () => {
  it("lists role calls by thread/status/role and distinguishes decisions from failures", async () => {
    const runtime = createCliRuntime({ storageMode: "memory" });
    await seedRoleCallAudit(runtime);
    const output: string[] = [];
    const errors: string[] = [];
    const io = testIo(output, errors);

    await expect(
      main(["role-calls", "list", "--thread-id", "thread_1"], io, process.cwd(), runtime)
    ).resolves.toBe(0);
    await expect(
      main([
        "role-calls",
        "list",
        "--role",
        "@reviewer",
        "--status",
        "deferred"
      ], io, process.cwd(), runtime)
    ).resolves.toBe(0);

    expect(errors.join("")).toBe("");
    expect(output.join("")).toContain(
      "call_deferred\tdeferred (decision)\t@operator\t@reviewer"
    );
    expect(output.join("")).toContain(
      "call_rejected\trejected (decision)\t@reviewer\t@operator"
    );
    expect(output.join("")).toContain(
      "call_failed\tfailed (execution)\t@operator\t@reviewer"
    );
    expect(output.at(-1)).toContain("call_deferred");
    expect(output.at(-1)).not.toContain("call_failed");
  });

  it("shows linked run review commands and stable JSON details", async () => {
    const runtime = createCliRuntime({ storageMode: "memory" });
    await seedRoleCallAudit(runtime);
    const output: string[] = [];
    const errors: string[] = [];
    const io = testIo(output, errors);

    await expect(
      main(["role-calls", "show", "call_failed"], io, process.cwd(), runtime)
    ).resolves.toBe(0);
    await expect(
      main(["role-calls", "show", "call_deferred", "--json"], io, process.cwd(), runtime)
    ).resolves.toBe(0);

    expect(errors.join("")).toBe("");
    expect(output[0]).toContain("linked_run: run_failed");
    expect(output[0]).toContain("agent-hub runs show run_failed");
    const parsed = JSON.parse(output[1]) as {
      roleCall: RoleCall;
      todo: RoleTodo;
      events: RoleCallEvent[];
    };
    expect(parsed.roleCall.status).toBe("deferred");
    expect(parsed.todo.id).toBe("todo_deferred");
    expect(parsed.events.map((event) => event.type)).toEqual(["deferred"]);
  });

  it("lists role todos and events with optional JSON output", async () => {
    const runtime = createCliRuntime({ storageMode: "memory" });
    await seedRoleCallAudit(runtime);
    const output: string[] = [];
    const errors: string[] = [];
    const io = testIo(output, errors);

    await expect(
      main([
        "role-todos",
        "list",
        "--role",
        "reviewer",
        "--status",
        "deferred"
      ], io, process.cwd(), runtime)
    ).resolves.toBe(0);
    await expect(
      main([
        "role-events",
        "list",
        "--role-call-id",
        "call_deferred",
        "--json"
      ], io, process.cwd(), runtime)
    ).resolves.toBe(0);

    expect(errors.join("")).toBe("");
    expect(output[0]).toContain(
      "todo_deferred\tdeferred\t@reviewer\tthread_1\tcall_deferred"
    );
    const parsed = JSON.parse(output[1]) as { roleCallEvents: RoleCallEvent[] };
    expect(parsed.roleCallEvents).toEqual([
      expect.objectContaining({
        id: "event_deferred",
        roleCallId: "call_deferred",
        type: "deferred"
      })
    ]);
  });
});

function testIo(output: string[], errors: string[]) {
  return {
    stdout: {
      write: (chunk: string) => {
        output.push(chunk);
        return true;
      }
    },
    stderr: {
      write: (chunk: string) => {
        errors.push(chunk);
        return true;
      }
    }
  };
}

async function seedRoleCallAudit(runtime: ReturnType<typeof createCliRuntime>) {
  await runtime.projectRepository.create({
    id: "project_1",
    name: "Project",
    rootPath: "/tmp/project",
    createdAt: now,
    updatedAt: now
  });
  await runtime.taskRepository.create({
    id: "task_1",
    projectId: "project_1",
    title: "Role-call audit",
    status: "open",
    createdAt: now,
    updatedAt: now
  });
  await runtime.taskRunRepository.create({
    id: "run_failed",
    taskId: "task_1",
    agentKind: "fake",
    status: "failed",
    createdAt: "2026-05-28T08:02:00.000Z",
    updatedAt: "2026-05-28T08:02:30.000Z"
  });
  await runtime.roleCallRepository.create(
    roleCall({
      id: "call_deferred",
      callerRole: "operator",
      calleeRole: "reviewer",
      status: "deferred",
      decision: {
        disposition: "deferred",
        reason: "Reviewer waits for full-suite evidence.",
        evidence: ["focused tests passed"]
      },
      todoId: "todo_deferred"
    })
  );
  await runtime.roleCallRepository.create(
    roleCall({
      id: "call_rejected",
      callerRole: "reviewer",
      calleeRole: "operator",
      status: "rejected",
      decision: {
        disposition: "rejected",
        reason: "Automatic PR creation is outside desktop scope.",
        evidence: ["desktop apply remains local"]
      },
      completedAt: "2026-05-28T08:03:00.000Z"
    })
  );
  await runtime.roleCallRepository.create(
    roleCall({
      id: "call_failed",
      callerRole: "operator",
      calleeRole: "reviewer",
      status: "failed",
      taskRunId: "run_failed",
      error: "Fake adapter failed inspectably.",
      completedAt: "2026-05-28T08:04:00.000Z"
    })
  );
  await runtime.roleTodoRepository.create({
    id: "todo_deferred",
    threadId: "thread_1",
    role: "reviewer",
    sourceRoleCallId: "call_deferred",
    title: "Review operator patch after full-suite checks",
    status: "deferred",
    priority: "normal",
    relatedRoleCallIds: ["call_deferred"],
    createdAt: "2026-05-28T08:01:00.000Z",
    updatedAt: "2026-05-28T08:01:00.000Z"
  });
  await runtime.roleCallEventRepository.create({
    id: "event_deferred",
    roleCallId: "call_deferred",
    threadId: "thread_1",
    type: "deferred",
    actorRole: "reviewer",
    message: "Reviewer deferred pending full-suite evidence.",
    createdAt: "2026-05-28T08:01:00.000Z"
  });
}

function roleCall(input: Partial<RoleCall>): RoleCall {
  return {
    id: input.id ?? "call_1",
    threadId: "thread_1",
    parentMessageId: "message_1",
    parentRoleCallId: input.parentRoleCallId,
    callerRole: input.callerRole ?? "analyst",
    calleeRole: input.calleeRole ?? "operator",
    task: input.task ?? "Inspect role-call evidence.",
    reason: input.reason ?? "Need role-specific audit evidence.",
    context: { userGoal: "Audit role-call CLI output." },
    permissions: conservativePermissionSet,
    expectedOutput: {
      format: "summary",
      description: "Role-call audit result."
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
