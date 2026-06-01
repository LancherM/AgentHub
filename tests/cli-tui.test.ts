import { describe, expect, it } from "vitest";
import { createCliRuntime, main } from "@agent-hub/cli";
import {
  buildTuiCurrentContextModel,
  conservativePermissionSet,
  type RoleCall
} from "@agent-hub/core";
import {
  createInitialTuiShellState,
  reduceTuiKey,
  renderTuiWorkbench
} from "../apps/cli/src/tui";

const now = "2026-05-29T12:00:00.000Z";
const projectRoot = "/tmp/tui-project";

describe("CLI TUI command", () => {
  it("prints help without opening the terminal shell", async () => {
    const runtime = createCliRuntime({ storageMode: "memory" });
    const output: string[] = [];
    const errors: string[] = [];

    await expect(
      main(["tui", "--help"], testIo(output, errors), process.cwd(), runtime)
    ).resolves.toBe(0);

    expect(errors.join("")).toBe("");
    expect(output.join("")).toContain("agent-hub tui");
    expect(output.join("")).toContain("--thread <thread-id>");
  });

  it("renders a read-only current-context workbench by room selector", async () => {
    const runtime = createCliRuntime({ storageMode: "memory" });
    await seedTuiContext(runtime);
    const output: string[] = [];
    const errors: string[] = [];

    await expect(
      main(
        [
          "--project",
          projectRoot,
          "tui",
          "--room",
          "review",
          "--agent",
          "codex",
          "--once"
        ],
        testIo(output, errors),
        process.cwd(),
        runtime
      )
    ).resolves.toBe(0);

    const rendered = output.join("");
    expect(errors.join("")).toBe("");
    expect(rendered).toContain("Agent Hub  TUI Project  #review  @codex");
    expect(rendered).toContain("Transcript");
    expect(rendered).toContain("RoleCall Graph");
    expect(rendered).toContain("@engineer -> @reviewer [running]");
    expect(rendered).toContain("Runs");
    expect(rendered).toContain("run_1 @codex running");
    expect(rendered).toContain("> @codex read-only TUI; prompt submission arrives in TUI-3");
  });

  it("switches focus, selection, hide-done, and graph collapse through key reducer", async () => {
    const runtime = createCliRuntime({ storageMode: "memory" });
    await seedTuiContext(runtime);
    const model = await buildTuiCurrentContextModel(runtime, {
      projectId: "project_1",
      threadId: "thread_1"
    });
    let state = createInitialTuiShellState();

    state = reduceTuiKey(state, "tab", model).state;
    expect(state.focus).toBe("graph");
    state = reduceTuiKey(state, "down", model).state;
    expect(state.selectedRoleCallIndex).toBe(1);
    state = reduceTuiKey(state, "left", model).state;
    expect(state.collapsedRoleCallIds).toEqual(["call_child"]);
    state = reduceTuiKey(state, "hide_done", model).state;
    expect(state.hideCompletedRoleCalls).toBe(true);

    const rendered = renderTuiWorkbench(model, state, { columns: 72, rows: 28 });
    expect(rendered).toContain("[Graph]");
    expect(rendered).toContain("Completed RoleCalls hidden.");
  });
});

function testIo(output: string[], errors: string[]) {
  return {
    stdout: {
      isTTY: false,
      columns: 120,
      rows: 40,
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

async function seedTuiContext(runtime: ReturnType<typeof createCliRuntime>) {
  await runtime.projectRepository.create({
    id: "project_1",
    name: "TUI Project",
    rootPath: projectRoot,
    createdAt: now,
    updatedAt: now
  });
  await runtime.conversationThreadRepository.create({
    id: "thread_1",
    projectId: "project_1",
    title: "Review",
    metadata: { roomHandle: "review" },
    createdAt: now,
    updatedAt: now
  });
  await runtime.conversationMessageRepository.createMany([
    {
      id: "message_1",
      threadId: "thread_1",
      sequence: 0,
      role: "user",
      kind: "text",
      content: "Check the TUI shell.",
      createdAt: now
    },
    {
      id: "message_2",
      threadId: "thread_1",
      sequence: 1,
      role: "assistant",
      kind: "text",
      content: "I started the review run.",
      agentKind: "codex",
      runId: "run_1",
      status: "running",
      createdAt: now
    }
  ]);
  await runtime.taskRepository.create({
    id: "task_1",
    projectId: "project_1",
    title: "Check TUI shell",
    description: "Check the TUI shell.",
    metadata: { threadId: "thread_1" },
    status: "running",
    createdAt: now,
    updatedAt: now
  });
  await runtime.taskRunRepository.create({
    id: "run_1",
    taskId: "task_1",
    agentKind: "codex",
    status: "running",
    startedAt: now,
    createdAt: now,
    updatedAt: now
  });
  await runtime.runEventRepository.create({
    id: "event_1",
    taskRunId: "run_1",
    sequence: 0,
    type: "status",
    message: "adapter running",
    metadata: {},
    createdAt: now
  });
  await runtime.roleCallRepository.create(
    roleCall({
      id: "call_parent",
      status: "running",
      taskRunId: "run_1",
      calleeRole: "reviewer"
    })
  );
  await runtime.roleCallRepository.create(
    roleCall({
      id: "call_child",
      status: "waiting_context",
      parentRoleCallId: "call_parent",
      calleeRole: "operator",
      depth: 1,
      decision: {
        disposition: "needs_context",
        reason: "Need a failing log excerpt.",
        requiredContext: ["failing log excerpt"]
      }
    })
  );
  await runtime.roleCallRepository.create(
    roleCall({
      id: "call_done",
      status: "succeeded",
      calleeRole: "memory",
      result: {
        summary: "No memory needed.",
        evidence: ["Read-only TUI."]
      }
    })
  );
}

function roleCall(input: Partial<RoleCall>): RoleCall {
  return {
    id: input.id ?? "call_1",
    threadId: "thread_1",
    parentMessageId: "message_2",
    parentRoleCallId: input.parentRoleCallId,
    callerRole: input.callerRole ?? "engineer",
    calleeRole: input.calleeRole ?? "reviewer",
    task: input.task ?? "Check TUI evidence.",
    reason: input.reason ?? "Need terminal review.",
    context: { userGoal: "Check the TUI shell." },
    permissions: conservativePermissionSet,
    expectedOutput: { format: "summary", description: "TUI shell evidence." },
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
