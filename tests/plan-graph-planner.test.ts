import { describe, expect, it } from "vitest";
import {
  createDeterministicPlanGraph,
  validateTask,
  validateTaskBrief
} from "@agent-hub/core";

const createdAt = "2026-01-01T00:00:00.000Z";

describe("deterministic PlanGraph planner", () => {
  it("plans code-changing tasks with implement, verify, and review nodes", () => {
    const graph = planGraphFor("Fix parser bug", "Implement a fix for parser E_PARSE.");

    expect(planShape(graph)).toMatchInlineSnapshot(`
      [
        "planner:planner:system:required",
        "research:researcher:manual:required",
        "implement:engineer:primary_run:required",
        "verify:reviewer:manual:required",
        "review:reviewer:manual:required",
        "handoff:operator:non_executable:required",
      ]
    `);
    expect(graph.edges).toHaveLength(graph.nodes.length - 1);
    expect(graph.nodes.find((node) => node.kind === "implement")?.execution)
      .toMatchObject({ expectedAdapter: "codex", worktreePolicy: "isolated" });
  });

  it("plans documentation-only tasks with documentation, verify, and review nodes", () => {
    const graph = planGraphFor(
      "Update product docs",
      "Update documentation for the execution trace product doc."
    );

    expect(planShape(graph)).toMatchInlineSnapshot(`
      [
        "planner:planner:system:required",
        "documentation:writer:primary_run:required",
        "verify:reviewer:manual:required",
        "review:reviewer:manual:required",
        "handoff:operator:non_executable:required",
      ]
    `);
  });

  it("plans review-only tasks without implementation or documentation nodes", () => {
    const graph = planGraphFor("Review run evidence", "Review and inspect persisted evidence.");

    expect(planShape(graph)).toMatchInlineSnapshot(`
      [
        "planner:planner:system:required",
        "research:researcher:manual:required",
        "review:reviewer:manual:required",
        "handoff:operator:non_executable:required",
      ]
    `);
  });

  it("adds an optional memory node for memory-sensitive tasks", () => {
    const graph = planGraphFor(
      "Implement memory proposal audit",
      "Implement a memory proposal review path."
    );

    expect(planShape(graph)).toMatchInlineSnapshot(`
      [
        "planner:planner:system:required",
        "research:researcher:manual:required",
        "implement:engineer:primary_run:required",
        "verify:reviewer:manual:required",
        "review:reviewer:manual:required",
        "memory:memory:manual:optional",
        "handoff:operator:non_executable:required",
      ]
    `);
  });
});

function planGraphFor(title: string, prompt: string) {
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
  return createDeterministicPlanGraph({
    task,
    taskBrief,
    version: 1,
    createdAt,
    expectedAdapter: "codex"
  });
}

function planShape(graph: ReturnType<typeof planGraphFor>): string[] {
  return graph.nodes.map((node) =>
    [
      node.kind,
      node.role,
      node.execution.mode,
      node.required ? "required" : "optional"
    ].join(":")
  );
}
