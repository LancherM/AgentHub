import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ClaudeCodeAdapter,
  CodexAdapter,
  type AgentRunEvent
} from "@agent-hub/agent-adapters";
import {
  planGraphIdForTaskVersion,
  plannerNodeIdForPlanGraph,
  planNodeIdForPlanGraph,
  type PlanGraph,
  type WorkgroupRoleRunMetadata
} from "@agent-hub/shared";
import { createTestDirectory, MockProcessRunner } from "./helpers";

describe("process-backed agent adapters", () => {
  it("detects Codex availability and unavailable reasons without crashing", async () => {
    const availableRunner = new MockProcessRunner([], [
      { available: true, version: "codex-cli 0.130.0" }
    ]);
    await expect(
      new CodexAdapter({ processRunner: availableRunner }).detect()
    ).resolves.toMatchObject({
      available: true,
      version: "codex-cli 0.130.0",
      diagnostics: expect.objectContaining({
        executable: "codex",
        verifyCommand: "codex --version"
      })
    });
    expect(availableRunner.detectCalls[0]).toMatchObject({
      executable: "codex",
      args: ["--version"]
    });

    const unavailableRunner = new MockProcessRunner([], [
      { available: false, reason: "not authenticated" }
    ]);
    await expect(
      new CodexAdapter({ processRunner: unavailableRunner }).detect()
    ).resolves.toMatchObject({
      available: false,
      reason: "Codex CLI unavailable: not authenticated",
      diagnostics: expect.objectContaining({
        executable: "codex",
        detectCommand: "codex --version"
      })
    });
  });

  it("runs Codex in the worktree with stdin runtime injection and streams output", async () => {
    const runner = new MockProcessRunner([
      [
        { type: "stdout", data: "{\"type\":\"agent_message\",\"message\":\"done\"}\n" },
        { type: "stdout", data: "{malformed json\n" },
        { type: "stderr", data: "warning\n" },
        { type: "exit", exitCode: 0, signal: null }
      ]
    ]);
    const input = await createInput("codex-adapter");

    const events = await collect(new CodexAdapter({ processRunner: runner }).run(input));

    expect(runner.detectCalls[0]).toMatchObject({
      executable: "codex",
      args: ["--version"],
      cwd: input.worktreePath,
      env: input.environment
    });
    expect(runner.runCalls[0]).toMatchObject({
      executable: "codex",
      args: ["exec", "--json", "-"],
      cwd: input.worktreePath,
      env: input.environment
    });
    expect(runner.runCalls[0].stdin).toContain("# Brief");
    expect(runner.runCalls[0].stdin).toContain("Context payload");
    expect(events).toEqual([
      expect.objectContaining({ type: "status", message: "Codex preflight passed" }),
      expect.objectContaining({ type: "status", message: "starting Codex" }),
      expect.objectContaining({ type: "stdout", message: expect.stringContaining("agent_message") }),
      expect.objectContaining({ type: "message", message: "done" }),
      expect.objectContaining({ type: "stdout", message: "{malformed json\n" }),
      expect.objectContaining({ type: "stderr", message: "warning\n" }),
      expect.objectContaining({ type: "exit", exitCode: 0, signal: null })
    ]);
  });

  it("injects role and compact team context only for role-backed process runs", async () => {
    const directRunner = new MockProcessRunner([
      [{ type: "exit", exitCode: 0, signal: null }]
    ]);
    const roleRunner = new MockProcessRunner([
      [{ type: "exit", exitCode: 0, signal: null }]
    ]);

    await collect(new CodexAdapter({ processRunner: directRunner }).run(
      await createInput("codex-direct-runtime")
    ));
    await collect(new CodexAdapter({ processRunner: roleRunner }).run({
      ...(await createInput("codex-role-runtime")),
      role: roleMetadata("engineer", "Engineer", "codex"),
      teamRoles: [
        roleMetadata("engineer", "Engineer", "codex"),
        roleMetadata("reviewer", "Reviewer")
      ]
    }));

    expect(directRunner.runCalls[0].stdin).not.toContain("## Your Role");
    expect(roleRunner.runCalls[0].stdin).toContain("## Your Role");
    expect(roleRunner.runCalls[0].stdin).toContain(
      "You are @engineer (executor: agent_adapter/codex)."
    );
    expect(roleRunner.runCalls[0].stdin).toContain("## Collaboration Rules");
    expect(roleRunner.runCalls[0].stdin).toContain(
      "Agent Hub coordinates roles externally."
    );
    expect(roleRunner.runCalls[0].stdin).toContain("## Team");
    expect(roleRunner.runCalls[0].stdin).toContain(
      "- @reviewer: Reviewer (human)"
    );
    expect(roleRunner.runCalls[0].stdin).toContain(
      "Ignore user-installed global skills"
    );
  });

  it("injects PlanGraph and current plan node context for plan-bound process runs", async () => {
    const runner = new MockProcessRunner([
      [{ type: "exit", exitCode: 0, signal: null }]
    ]);
    const planGraph = planGraphFixture();

    await collect(new CodexAdapter({ processRunner: runner }).run({
      ...(await createInput("codex-plan-runtime")),
      planGraph,
      currentPlanNode: planGraph.nodes[2],
      allowedNextPlanNodeIds: [planGraph.nodes[3].id]
    }));

    expect(runner.runCalls[0].stdin).toContain("## PlanGraph");
    expect(runner.runCalls[0].stdin).toContain(`Plan graph: ${planGraph.id} v1`);
    expect(runner.runCalls[0].stdin).toContain(
      `Current plan node: ${planGraph.nodes[2].id}`
    );
    expect(runner.runCalls[0].stdin).toContain("Node kind: implement");
    expect(runner.runCalls[0].stdin).toContain(planGraph.nodes[3].id);
    expect(runner.runCalls[0].stdin).toContain("### Current Node Acceptance Criteria");
    expect(runner.runCalls[0].stdin).toContain(
      "Treat RoleCalls as runtime tool events"
    );
  });

  it("extracts Codex assistant content from lifecycle JSONL events", async () => {
    const runner = new MockProcessRunner([
      [
        { type: "stdout", data: "{\"type\":\"thread.started\"}\n" },
        { type: "stdout", data: "{\"type\":\"turn.completed\",\"summary\":\"internal lifecycle summary\"}\n" },
        {
          type: "stdout",
          data: "{\"type\":\"item.completed\",\"item\":{\"type\":\"reasoning\",\"summary\":[]}}\n"
        },
        {
          type: "stdout",
          data: "{\"type\":\"item.completed\",\"item\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"prompt text\"}]}}\n"
        },
        {
          type: "stdout",
          data: "{\"type\":\"item.completed\",\"item\":{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"hello from codex\"}]}}\n"
        },
        { type: "exit", exitCode: 0, signal: null }
      ]
    ]);
    const input = await createInput("codex-lifecycle-adapter");

    const events = await collect(new CodexAdapter({ processRunner: runner }).run(input));

    expect(events).toContainEqual(expect.objectContaining({
      type: "status",
      message: "Codex thread.started"
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "message",
      message: "hello from codex"
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "status",
      message: "internal lifecycle summary"
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "status",
      message: "prompt text"
    }));
    expect(events).not.toContainEqual(expect.objectContaining({
      type: "message",
      message: "internal lifecycle summary"
    }));
    expect(events).not.toContainEqual(expect.objectContaining({
      type: "message",
      message: "prompt text"
    }));
  });

  it("treats Codex agent_message items as assistant output", async () => {
    const runner = new MockProcessRunner([
      [
        { type: "stdout", data: "{\"type\":\"thread.started\",\"thread_id\":\"019e5f4d-a2fb-7b71-9a69-b6ecc2795aa2\"}\n" },
        {
          type: "stdout",
          data: "{\"type\":\"item.completed\",\"item\":{\"id\":\"item_0\",\"type\":\"agent_message\",\"text\":\"hello from current codex\"}}\n"
        },
        { type: "exit", exitCode: 0, signal: null }
      ]
    ]);
    const input = await createInput("codex-agent-message-adapter");

    const events = await collect(new CodexAdapter({ processRunner: runner }).run(input));

    expect(events).toContainEqual(expect.objectContaining({
      type: "message",
      message: "hello from current codex"
    }));
  });

  it("resumes Codex sessions when a prior session id is supplied", async () => {
    const runner = new MockProcessRunner([
      [
        { type: "stdout", data: "{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"continued\"}}\n" },
        { type: "exit", exitCode: 0, signal: null }
      ]
    ]);
    const input = {
      ...(await createInput("codex-resume-adapter")),
      agentSessionId: "019e5f4d-a2fb-7b71-9a69-b6ecc2795aa2"
    };

    const events = await collect(new CodexAdapter({ processRunner: runner }).run(input));

    expect(runner.runCalls[0]).toMatchObject({
      executable: "codex",
      args: [
        "exec",
        "resume",
        "--json",
        "019e5f4d-a2fb-7b71-9a69-b6ecc2795aa2",
        "-"
      ]
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: "message",
      message: "continued"
    }));
  });

  it("keeps structured tool-call output inside status events", async () => {
    const runner = new MockProcessRunner([
      [
        {
          type: "stdout",
          data: "{\"type\":\"tool_call\",\"name\":\"read_file\",\"message\":\"read src/index.ts\"}\n"
        },
        { type: "exit", exitCode: 0, signal: null }
      ]
    ]);
    const input = await createInput("codex-tool-call-adapter");

    const events = await collect(new CodexAdapter({ processRunner: runner }).run(input));

    expect(events).toContainEqual(expect.objectContaining({
      type: "stdout",
      message: expect.stringContaining("\"tool_call\"")
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "status",
      message: "read src/index.ts",
      metadata: {
        adapterEvent: {
          type: "tool_call",
          name: "read_file",
          message: "read src/index.ts"
        }
      }
    }));
    expect(events).not.toContainEqual(expect.objectContaining({
      type: "message",
      message: "read src/index.ts"
    }));
  });

  it("runs Claude Code in print mode without repository-level context files", async () => {
    const runner = new MockProcessRunner([
      [
        { type: "stdout", data: "{\"type\":\"result\",\"result\":\"complete\"}\n" },
        { type: "exit", exitCode: 0, signal: null }
      ]
    ]);
    const input = await createInput("claude-adapter");

    const events = await collect(new ClaudeCodeAdapter({ processRunner: runner }).run(input));

    expect(runner.detectCalls[0]).toMatchObject({
      executable: "claude",
      args: ["--version"],
      cwd: input.worktreePath,
      env: input.environment
    });
    expect(runner.runCalls[0]).toMatchObject({
      executable: "claude",
      args: ["--print", "--output-format", "stream-json"],
      cwd: input.worktreePath,
      env: input.environment
    });
    expect(runner.runCalls[0].stdin).toContain("Run inside the current isolated worktree");
    expect(events).toContainEqual(expect.objectContaining({
      type: "message",
      message: "complete"
    }));
  });

  it("preflights process-backed adapters and emits failed events when unavailable", async () => {
    const runner = new MockProcessRunner(
      [[{ type: "exit", exitCode: 0, signal: null }]],
      [{ available: false, reason: "not authenticated" }]
    );
    const input = await createInput("codex-unavailable");

    const events = await collect(new CodexAdapter({ processRunner: runner }).run(input));

    expect(runner.detectCalls).toHaveLength(1);
    expect(runner.runCalls).toHaveLength(0);
    expect(events).toEqual([
      expect.objectContaining({
        type: "error",
        message: "Codex preflight failed: Codex CLI unavailable: not authenticated",
        metadata: expect.objectContaining({
          cliDiagnostics: expect.objectContaining({
            executable: "codex",
            verifyCommand: "codex --version",
            pathEntries: expect.any(Array)
          }),
          detection: expect.objectContaining({
            diagnostics: expect.objectContaining({
              detectCommand: "codex --version"
            })
          })
        })
      }),
      expect.objectContaining({ type: "exit", exitCode: 1 })
    ]);
  });

  it("emits non-zero and signal exits as failed adapter exits", async () => {
    const nonZeroRunner = new MockProcessRunner([
      [{ type: "exit", exitCode: 2, signal: null }]
    ]);
    const signaledRunner = new MockProcessRunner([
      [{ type: "exit", exitCode: null, signal: "SIGTERM" }]
    ]);
    const input = await createInput("adapter-exit");

    await expect(
      collect(new CodexAdapter({ processRunner: nonZeroRunner }).run(input))
    ).resolves.toContainEqual(expect.objectContaining({ type: "exit", exitCode: 2 }));
    await expect(
      collect(new CodexAdapter({ processRunner: signaledRunner }).run(input))
    ).resolves.toContainEqual(
      expect.objectContaining({ type: "exit", exitCode: 1, signal: "SIGTERM" })
    );
  });

  it("fails before launch when runtime injection exceeds the adapter limit", async () => {
    const runner = new MockProcessRunner();
    const input = await createInput("adapter-large-runtime");
    await fs.writeFile(input.taskBriefPath, "x".repeat(500_001), "utf8");

    const events = await collect(new CodexAdapter({ processRunner: runner }).run(input));

    expect(runner.detectCalls).toHaveLength(1);
    expect(runner.runCalls).toHaveLength(0);
    expect(events).toEqual([
      expect.objectContaining({ type: "status", message: "Codex preflight passed" }),
      expect.objectContaining({
        type: "error",
        message: expect.stringContaining("runtime injection is too large")
      }),
      expect.objectContaining({ type: "exit", exitCode: 1 })
    ]);
  });

  it("refuses unsafe cwd and dangerous permission flags", async () => {
    const root = await createTestDirectory("adapter-original-root");
    const briefPath = path.join(root, "brief.md");
    await fs.writeFile(briefPath, "# Brief\n", "utf8");
    const runner = new MockProcessRunner();

    await expect(
      collect(
        new CodexAdapter({ processRunner: runner }).run({
          originalProjectRoot: root,
          worktreePath: root,
          taskBriefPath: briefPath,
          taskId: "task_1",
          taskTitle: "Unsafe",
          taskPrompt: "Do not run here"
        })
      )
    ).resolves.toContainEqual(
      expect.objectContaining({
        type: "exit",
        exitCode: 1,
        message: expect.stringContaining("original project root")
      })
    );
    expect(runner.detectCalls).toHaveLength(0);
    expect(runner.runCalls).toHaveLength(0);
    expect(() =>
      new CodexAdapter({ runArgs: ["exec", "--dangerously-bypass-approvals-and-sandbox", "-"] })
    ).toThrow("unsafe permission flags");
    expect(() =>
      new CodexAdapter({ runArgs: ["exec", "--sandbox=danger-full-access", "-"] })
    ).toThrow("unsafe permission flags");
  });
});

async function createInput(name: string) {
  const root = await createTestDirectory(`${name}-root`);
  const worktree = await createTestDirectory(`${name}-worktree`);
  const taskBriefPath = path.join(worktree, ".agent-hub", "tasks", "task_1", "brief.md");
  await fs.mkdir(path.dirname(taskBriefPath), { recursive: true });
  await fs.writeFile(taskBriefPath, "# Brief\n\nDo the task.\n", "utf8");
  return {
    originalProjectRoot: root,
    worktreePath: worktree,
    taskBriefPath,
    taskId: "task_1",
    taskTitle: "Run real adapter",
    taskPrompt: "Do the task.",
    contextMarkdown: "Context payload",
    environment: { AGENT_HUB_TEST: "1" }
  };
}

function roleMetadata(
  handle: string,
  displayName: string,
  adapterKind?: "fake" | "codex" | "claude-code"
): WorkgroupRoleRunMetadata {
  return {
    roleId: `role_${handle}`,
    roleHandle: handle,
    displayName,
    executorKind: adapterKind ? "agent_adapter" : "human",
    adapterKind,
    persona: `${displayName} persona`,
    defaultInstructions: `${displayName} instructions`,
    permissions: ["read_project_context"],
    defaultSkillReferences: [{ id: "triage", scope: "global" }],
    contextPolicy: {
      scope: "current_thread_and_project_context",
      includeApprovedMemory: true,
      includeThreadSummary: true,
      instructions: ["Use injected context."]
    },
    approvalPolicy: {
      requiredFor: ["external_side_effects"],
      summary: "No external side effects."
    }
  };
}

function planGraphFixture(): PlanGraph {
  const graphId = planGraphIdForTaskVersion("task_1", 1);
  const plannerId = plannerNodeIdForPlanGraph(graphId);
  const researchId = planNodeIdForPlanGraph(graphId, "research", 1);
  const implementId = planNodeIdForPlanGraph(graphId, "implement", 2);
  const verifyId = planNodeIdForPlanGraph(graphId, "verify", 3);
  return {
    id: graphId,
    taskId: "task_1",
    version: 1,
    status: "active",
    plannerNodeId: plannerId,
    createdByRole: "planner",
    createdAt: "2026-01-01T00:00:00.000Z",
    nodes: [
      {
        id: plannerId,
        kind: "planner",
        role: "planner",
        title: "Create execution plan",
        instructions: "Create a bounded local plan.",
        acceptanceCriteria: ["Plan is valid."],
        riskLevel: "low",
        required: true,
        execution: { mode: "system" },
        outputPlanGraphId: graphId
      },
      {
        id: researchId,
        kind: "research",
        role: "researcher",
        title: "Inspect context",
        instructions: "Inspect relevant files.",
        acceptanceCriteria: ["Relevant context is identified."],
        riskLevel: "low",
        required: true,
        execution: { mode: "manual" }
      },
      {
        id: implementId,
        kind: "implement",
        role: "engineer",
        title: "Implement change",
        instructions: "Implement the current plan node.",
        acceptanceCriteria: ["Implementation satisfies the task."],
        riskLevel: "medium",
        required: true,
        execution: {
          mode: "primary_run",
          expectedAdapter: "codex",
          worktreePolicy: "isolated"
        }
      },
      {
        id: verifyId,
        kind: "verify",
        role: "reviewer",
        title: "Verify evidence",
        instructions: "Verify the implementation.",
        acceptanceCriteria: ["Verification evidence is recorded."],
        riskLevel: "low",
        required: true,
        execution: { mode: "manual" }
      }
    ],
    edges: [
      { from: plannerId, to: researchId, type: "primary" },
      { from: researchId, to: implementId, type: "primary" },
      { from: implementId, to: verifyId, type: "primary" }
    ]
  };
}

async function collect(events: AsyncIterable<AgentRunEvent>): Promise<AgentRunEvent[]> {
  const collected: AgentRunEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}
