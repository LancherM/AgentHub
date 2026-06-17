import { describe, expect, it } from "vitest";
import {
  activatePlanGraphAmendment,
  InMemoryPlanGraphRepository,
  parseStructuredPlanGraphOutput,
  planGraphIdForTaskVersion,
  plannerNodeIdForPlanGraph,
  planNodeIdForPlanGraph,
  proposePlanGraphAmendment,
  validatePlanGraph,
  validateTask,
  validateTaskBrief,
  type PlanGraph
} from "@agent-hub/core";

const createdAt = "2026-01-01T00:00:00.000Z";

describe("agent-backed PlanGraph planner output", () => {
  it("parses wrapped JSON output from the system planner adapter", () => {
    const fixture = planFixture("Fix parser bug", "Implement a fix for parser E_PARSE.");

    const parsed = parseStructuredPlanGraphOutput(
      fixture.plannerInput,
      JSON.stringify({ planGraph: fixture.graph })
    );

    expect(parsed).toMatchObject({
      id: "plan_graph:task_plan:v1",
      taskId: "task_plan",
      version: 1,
      status: "active",
      createdByRole: "planner"
    });
    expect(parsed.nodes.map((node) => node.kind)).toEqual([
      "planner",
      "implement",
      "verify",
      "handoff"
    ]);
  });

  it("parses fenced JSON while still validating task and version identity", () => {
    const fixture = planFixture("Update product docs", "Update product documentation.", 2);

    const parsed = parseStructuredPlanGraphOutput(
      fixture.plannerInput,
      [
        "Here is the graph:",
        "```json",
        JSON.stringify({ planGraph: fixture.graph }),
        "```"
      ].join("\n")
    );

    expect(parsed.id).toBe("plan_graph:task_plan:v2");
    expect(parsed.version).toBe(2);
  });

  it("rejects planner output that does not match the current task activation", () => {
    const fixture = planFixture("Review run evidence", "Review persisted evidence.");
    const wrongGraph = planGraphFor("other_task", 1, "Review run evidence");

    expect(() =>
      parseStructuredPlanGraphOutput(
        fixture.plannerInput,
        JSON.stringify({ planGraph: wrongGraph })
      )
    ).toThrow("planGraph.id must be plan_graph:task_plan:v1");
  });

  it("rejects planner output that is not valid JSON", () => {
    const fixture = planFixture("Invalid output", "Produce invalid output.");

    expect(() =>
      parseStructuredPlanGraphOutput(fixture.plannerInput, "not json")
    ).toThrow("planner output was not valid JSON");
  });

  it("keeps amendments proposed until required-node changes are approved", async () => {
    const repository = new InMemoryPlanGraphRepository();
    const activeGraph = planFixture(
      "Fix parser bug",
      "Implement a fix for parser E_PARSE."
    ).graph;
    const amendedBase = planFixture(
      "Fix parser bug",
      "Implement a fix for parser E_PARSE.",
      2
    ).graph;
    const amendedGraph = {
      ...amendedBase,
      nodes: amendedBase.nodes.map((node) =>
        node.kind === "implement"
          ? { ...node, instructions: `${node.instructions} Also update parser tests.` }
          : node
      )
    };

    await repository.create(activeGraph);
    const proposal = await proposePlanGraphAmendment({
      repository,
      activeGraph,
      amendedGraph
    });

    expect(proposal.graph.status).toBe("proposed");
    expect(proposal.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "required_execution_node_changed",
          requiresExplicitApproval: true
        })
      ])
    );
    await expect(repository.getActiveByTaskId(activeGraph.taskId))
      .resolves.toMatchObject({ id: activeGraph.id, status: "active" });
    await expect(
      activatePlanGraphAmendment({
        repository,
        activeGraphId: activeGraph.id,
        amendmentGraphId: proposal.graph.id
      })
    ).rejects.toThrow("requires explicit approval");

    const activated = await activatePlanGraphAmendment({
      repository,
      activeGraphId: activeGraph.id,
      amendmentGraphId: proposal.graph.id,
      approvedRequiredNodeChanges: true
    });

    expect(activated.graph.status).toBe("active");
    expect(activated.supersededGraph.status).toBe("superseded");
    await expect(repository.getActiveByTaskId(activeGraph.taskId))
      .resolves.toMatchObject({ id: proposal.graph.id, version: 2 });
  });
});

function planFixture(title: string, prompt: string, version = 1) {
  const task = validateTask({
    id: "task_plan",
    projectId: "project_plan",
    title,
    description: prompt,
    status: "open",
    createdAt,
    updatedAt: createdAt
  });
  const taskBrief = validateTaskBrief({
    taskId: task.id,
    taskTitle: task.title,
    taskPrompt: prompt,
    contextPackId: "context_pack_plan",
    renderedContent: prompt,
    createdAt
  });
  return {
    task,
    taskBrief,
    plannerInput: {
      task,
      taskBrief,
      version,
      createdAt,
      expectedAdapter: "codex" as const,
      roleHandle: "engineer"
    },
    graph: planGraphFor(task.id, version, title)
  };
}

function planGraphFor(taskId: string, version: number, title: string): PlanGraph {
  const graphId = planGraphIdForTaskVersion(taskId, version);
  const plannerId = plannerNodeIdForPlanGraph(graphId);
  const implementId = planNodeIdForPlanGraph(graphId, "implement", 1);
  const verifyId = planNodeIdForPlanGraph(graphId, "verify", 2);
  const handoffId = planNodeIdForPlanGraph(graphId, "handoff", 3);
  return validatePlanGraph({
    id: graphId,
    taskId,
    version,
    status: "active",
    plannerNodeId: plannerId,
    createdByRole: "planner",
    createdAt,
    nodes: [
      {
        id: plannerId,
        kind: "planner",
        role: "planner",
        title: "Create execution plan",
        instructions: `Create a structured execution plan for ${title}.`,
        acceptanceCriteria: ["PlanGraph JSON is valid and local-only."],
        riskLevel: "low",
        required: true,
        execution: { mode: "system" },
        outputPlanGraphId: graphId
      },
      {
        id: implementId,
        kind: "implement",
        role: "engineer",
        title: "Implement scoped change",
        instructions: "Make the requested local change in the isolated worktree.",
        acceptanceCriteria: ["The requested behavior is implemented."],
        riskLevel: "low",
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
        instructions: "Run or inspect relevant evidence before handoff.",
        acceptanceCriteria: ["Verification evidence is recorded."],
        riskLevel: "low",
        required: true,
        execution: { mode: "manual" }
      },
      {
        id: handoffId,
        kind: "handoff",
        role: "operator",
        title: "Summarize handoff",
        instructions: "Summarize what changed and what evidence was collected.",
        acceptanceCriteria: ["Handoff is concise and evidence-backed."],
        riskLevel: "low",
        required: true,
        execution: { mode: "non_executable" }
      }
    ],
    edges: [
      { from: plannerId, to: implementId, type: "primary" },
      { from: implementId, to: verifyId, type: "primary" },
      { from: verifyId, to: handoffId, type: "primary" }
    ]
  });
}
