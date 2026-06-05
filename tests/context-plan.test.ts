import { describe, expect, it } from "vitest";
import { classifyTaskPrompt, createContextPlan } from "@agent-hub/task-runner";

describe("context plan generation", () => {
  it("classifies common task prompts deterministically", () => {
    expect(classifyTaskPrompt("Fix the failing vitest around runtime context")).toBe(
      "test_failure"
    );
    expect(classifyTaskPrompt("Review this PR diff for regressions")).toBe("code_review");
    expect(classifyTaskPrompt("Polish the desktop renderer CSS")).toBe("ui_change");
    expect(classifyTaskPrompt("Document the context runtime architecture")).toBe(
      "architecture"
    );
    expect(classifyTaskPrompt("Continue the previous RoleCall implementation")).toBe(
      "follow_up"
    );
    expect(classifyTaskPrompt("Implement context plan artifacts")).toBe("feature");
  });

  it("generates a snapshot-stable bug-fix plan", () => {
    const plan = createContextPlan({
      id: "context_plan_bug",
      taskPrompt: "Fix the failing runtime context test",
      createdAt: "2026-01-01T00:00:00.000Z"
    });

    expect(snapshotPlan(plan)).toMatchInlineSnapshot(`
      {
        "budgetPolicy": {
          "approved_memory": 10,
          "code": 25,
          "conversation": 5,
          "global": 0,
          "project": 20,
          "role": 0,
          "run_evidence": 20,
          "runtime_policy": 0,
          "skill": 10,
          "task": 0,
          "test": 10,
        },
        "compressionPolicy": {
          "approved_memory": "none",
          "code": "extractive",
          "conversation": "structured",
          "global": "summary",
          "project": "extractive",
          "role": "extractive",
          "run_evidence": "structured",
          "runtime_policy": "none",
          "skill": "extractive",
          "task": "none",
          "test": "extractive",
        },
        "diagnostics": {
          "classifier": "rule_based_v1",
          "matchedTaskType": "test_failure",
        },
        "requiredLayers": [
          "runtime_policy",
          "task",
          "code",
          "test",
          "run_evidence",
          "project",
        ],
        "retrievalRoutes": [
          "explicit",
          "task_rule",
          "bm25",
          "embedding",
          "graph",
          "recency",
        ],
        "taskType": "test_failure",
        "trustPolicy": {
          "approved_memory": "allow",
          "code": "allow",
          "conversation": "limited",
          "global": "allow",
          "project": "allow",
          "role": "allow",
          "run_evidence": "allow",
          "runtime_policy": "allow",
          "skill": "allow",
          "task": "allow",
          "test": "allow",
        },
      }
    `);
  });

  it("generates a snapshot-stable follow-up plan", () => {
    const plan = createContextPlan({
      id: "context_plan_follow_up",
      taskPrompt: "Continue the prior thread-aware context work",
      createdAt: "2026-01-01T00:00:00.000Z"
    });

    expect(snapshotPlan(plan)).toMatchInlineSnapshot(`
      {
        "budgetPolicy": {
          "approved_memory": 10,
          "code": 10,
          "conversation": 20,
          "global": 0,
          "project": 15,
          "role": 5,
          "run_evidence": 30,
          "runtime_policy": 0,
          "skill": 10,
          "task": 0,
          "test": 0,
        },
        "compressionPolicy": {
          "approved_memory": "none",
          "code": "extractive",
          "conversation": "structured",
          "global": "summary",
          "project": "extractive",
          "role": "extractive",
          "run_evidence": "structured",
          "runtime_policy": "none",
          "skill": "extractive",
          "task": "none",
          "test": "extractive",
        },
        "diagnostics": {
          "classifier": "rule_based_v1",
          "matchedTaskType": "follow_up",
        },
        "requiredLayers": [
          "runtime_policy",
          "task",
          "run_evidence",
          "conversation",
          "project",
        ],
        "retrievalRoutes": [
          "explicit",
          "task_rule",
          "recency",
        ],
        "taskType": "follow_up",
        "trustPolicy": {
          "approved_memory": "allow",
          "code": "allow",
          "conversation": "limited",
          "global": "allow",
          "project": "allow",
          "role": "allow",
          "run_evidence": "allow",
          "runtime_policy": "allow",
          "skill": "allow",
          "task": "allow",
          "test": "allow",
        },
      }
    `);
  });
});

function snapshotPlan(plan: ReturnType<typeof createContextPlan>) {
  return {
    taskType: plan.taskType,
    requiredLayers: plan.requiredLayers,
    retrievalRoutes: plan.retrievalRoutes,
    trustPolicy: plan.trustPolicy,
    budgetPolicy: plan.budgetPolicy,
    compressionPolicy: plan.compressionPolicy,
    diagnostics: plan.diagnostics
  };
}
