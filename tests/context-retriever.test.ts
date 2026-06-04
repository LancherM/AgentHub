import { describe, expect, it } from "vitest";
import { createContextPlan, ExplicitContextRetriever } from "@agent-hub/task-runner";
import {
  InMemoryContextIndexRepository,
  validateContextIndexEntry,
  type ContextBundle,
  type ContextSection,
  type Task
} from "@agent-hub/core";

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

  it("adds BM25 stable-source candidates and dedupes sources already selected explicitly", async () => {
    const contextIndexRepository = new InMemoryContextIndexRepository();
    await contextIndexRepository.rebuildProject(
      "project_1",
      [
        validateContextIndexEntry({
          id: "context_index:project_1:project_skill:project:lint",
          projectId: "project_1",
          layer: "skill",
          sourceKind: "project_skill",
          sourceId: "project:lint",
          scope: "project",
          trustLevel: "medium",
          lifetime: "static",
          title: "Project Skill: Lint",
          content: "Use pnpm lint for parser changes.",
          contentHash: "sha256:lint-content",
          sourcePath: "/tmp/project-store/skills/lint/SKILL.md",
          createdAt,
          indexedAt: createdAt,
          metadata: {}
        }),
        validateContextIndexEntry({
          id: "context_index:project_1:project_context:context/project.md",
          projectId: "project_1",
          layer: "project",
          sourceKind: "project_context",
          sourceId: "context/project.md",
          scope: "project",
          trustLevel: "high",
          lifetime: "static",
          title: "Project Context: project",
          content: "Parser failures E_PARSE live in src/parser.ts.",
          contentHash: "sha256:project-context",
          sourcePath: "/tmp/project-store/context/project.md",
          createdAt,
          indexedAt: createdAt,
          metadata: {}
        })
      ],
      createdAt
    );
    const retriever = new ExplicitContextRetriever({
      contextIndexRepository
    });
    const task = testTask();
    const plan = createContextPlan({
      id: "context_plan_bm25",
      taskPrompt: "Fix parser.ts E_PARSE with lint",
      createdAt
    });

    const result = await retriever.retrieve({
      id: "context_retrieval_bm25",
      plan,
      task,
      runId: "run_1",
      taskPrompt: "Fix parser.ts E_PARSE with lint",
      contextBundle: contextBundle([
        section("task:task", "task", "task", "Current Task", "Fix parser.ts"),
        skillSection(
          "skill:project:lint",
          "project:lint",
          "Lint",
          "Use pnpm lint for parser changes.",
          "sha256:lint-content"
        )
      ]),
      selectedSkillReferences: [{ id: "lint" }],
      createdAt
    });

    expect(result.candidates.map((candidate) => candidate.routes)).toEqual([
      ["explicit"],
      ["explicit"],
      ["bm25"]
    ]);
    const bm25Candidate = result.candidates.find((candidate) =>
      candidate.routes.includes("bm25")
    );
    expect(bm25Candidate).toMatchObject({
      item: {
        sourceKind: "project_context",
        sourceId: "context/project.md",
        trustLevel: "high"
      },
      inclusionReason:
        "project_context matched BM25 query terms for the current task",
      diagnostics: expect.objectContaining({
        queryTerms: expect.arrayContaining(["parser", "ts", "e_parse"])
      })
    });
    expect({
      routes: bm25Candidate?.routes,
      sourceKind: bm25Candidate?.item.sourceKind,
      sourceId: bm25Candidate?.item.sourceId,
      relevanceScore: bm25Candidate?.relevanceScore,
      inclusionReason: bm25Candidate?.inclusionReason,
      diagnostics: bm25Candidate?.diagnostics
    }).toMatchInlineSnapshot(`
      {
        "diagnostics": {
          "lexicalScore": 0.75,
          "matchedTerms": [
            "parser",
            "ts",
            "e_parse",
          ],
          "query": "Fix parser.ts E_PARSE with lint",
          "queryTerms": [
            "parser",
            "ts",
            "e_parse",
            "lint",
          ],
          "rank": 1,
          "routes": [
            "bm25",
          ],
          "sourceId": "context/project.md",
          "sourceItemId": "context_index:project_1:project_context:context/project.md",
          "sourceKind": "project_context",
          "sourcePath": "/tmp/project-store/context/project.md",
          "terms": [
            "parser",
            "ts",
            "e_parse",
            "lint",
          ],
        },
        "inclusionReason": "project_context matched BM25 query terms for the current task",
        "relevanceScore": 0.75,
        "routes": [
          "bm25",
        ],
        "sourceId": "context/project.md",
        "sourceKind": "project_context",
      }
    `);
    expect(result.omitted).toEqual([
      {
        itemId: "context_index:project_1:project_skill:project:lint",
        layer: "skill",
        reason: "BM25 candidate duplicated an explicit-route source"
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
  body: string,
  contentHash = `sha256:${sourceId}`
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
      contentHash
    } as ContextSection["source"],
    order: 10
  };
}
