import { describe, expect, it } from "vitest";
import { createContextPlan, ExplicitContextRetriever } from "@agent-hub/task-runner";
import type { ContextBundle, ContextSection, Task } from "@agent-hub/core";

const createdAt = "2026-01-01T00:00:00.000Z";

describe("explicit context retrieval", () => {
  it("builds explicit-route candidates for selected task, skill, file, run, role skill, and thread sources", async () => {
    const retriever = new ExplicitContextRetriever();
    const task = testTask();
    const plan = createContextPlan({
      id: "context_plan_1",
      taskPrompt: "Fix parser.ts failing on E_PARSE and use lint skill",
      createdAt
    });

    const result = await retriever.retrieve({
      id: "context_retrieval_1",
      plan,
      task,
      runId: "run_1",
      taskPrompt: task.description ?? "",
      contextBundle: contextBundle([
        section("task:task", "task", "task", "Current Task", "Fix parser.ts"),
        skillSection("skill:project:lint", "project:lint", "Lint", "Use pnpm lint."),
        skillSection(
          "skill:global:review",
          "global:review",
          "Review",
          "Review changed files."
        ),
        section(
          "conversation:thread",
          "conversation",
          "thread",
          "Conversation Continuity [trust=low]",
          "Decision: keep context local."
        )
      ]),
      selectedSkillReferences: [{ id: "lint" }],
      roleSkillReferences: [{ id: "review", scope: "global" }],
      selectedFiles: [
        {
          path: "src/parser.ts",
          content: "export function parse(input: string) { return input; }\n",
          updatedAt: "2026-01-01T00:01:00.000Z"
        },
        {
          path: ".env.local",
          content: "TOKEN=secret\n"
        }
      ],
      selectedRuns: [
        {
          runId: "run_previous",
          taskId: "task_previous",
          summary: "Previous run failed verification: E_PARSE in parser.ts."
        }
      ],
      createdAt
    });

    expect(result).toMatchObject({
      id: "context_retrieval_1",
      planId: "context_plan_1",
      taskId: "task_1",
      runId: "run_1"
    });
    expect(result.candidates.map((candidate) => candidate.item.id)).toEqual([
      "task:task_1",
      "skill:project:lint",
      "skill:global:review",
      "conversation:thread",
      "file:src/parser.ts",
      "run:run_previous"
    ]);
    expect(result.candidates.map((candidate) => candidate.routes)).toEqual(
      result.candidates.map(() => ["explicit"])
    );
    expect(
      result.candidates.find((candidate) => candidate.item.id === "conversation:thread")
    ).toMatchObject({
      item: {
        layer: "conversation",
        trustLevel: "low",
        metadata: expect.objectContaining({
          continuityOnly: true,
          mayOverrideCurrentTask: false
        })
      }
    });
    expect(
      result.candidates.find((candidate) => candidate.item.id === "file:src/parser.ts")
    ).toMatchObject({
      item: {
        layer: "code",
        trustLevel: "high",
        sourcePath: "src/parser.ts"
      },
      inclusionReason: "file was explicitly selected for this run"
    });
    expect(
      result.candidates.find((candidate) => candidate.item.id === "run:run_previous")
    ).toMatchObject({
      item: {
        layer: "run_evidence",
        trustLevel: "medium"
      }
    });
    expect(result.omitted).toEqual([
      {
        itemId: "file:.env.local",
        layer: "code",
        reason: "secret-like selected file paths are excluded before retrieval"
      }
    ]);
  });
});

function testTask(): Task {
  return {
    id: "task_1",
    projectId: "project_1",
    title: "Fix parser",
    description: "Fix parser.ts failing on E_PARSE and use lint skill",
    status: "open",
    createdAt,
    updatedAt: createdAt
  };
}

function contextBundle(sections: ContextSection[]): ContextBundle {
  return {
    id: "context_bundle_1",
    taskPrompt: "Fix parser.ts failing on E_PARSE and use lint skill",
    selectedAgentId: "fake",
    targetRepository: {
      id: "project_1",
      name: "Project One",
      rootPath: "/tmp/project-one"
    },
    sections,
    warnings: []
  };
}

function section(
  id: string,
  kind: ContextSection["source"]["kind"],
  sourceId: string,
  title: string,
  body: string
): ContextSection {
  return {
    id,
    title,
    body,
    source: {
      kind,
      id: sourceId,
      label: title
    },
    order: 1
  };
}

function skillSection(
  id: string,
  sourceId: string,
  name: string,
  body: string
): ContextSection {
  return {
    id,
    title: `Skill: ${name}`,
    body,
    source: {
      kind: "skill",
      id: sourceId,
      label: `Skill: ${name}`,
      skillName: name,
      skillDescription: `${name} skill`,
      contentHash: `sha256:${sourceId}`
    } as ContextSection["source"],
    order: 10
  };
}
