import { describe, expect, it } from "vitest";
import {
  buildTypeScriptCodeGraphEntries,
  createContextPlan,
  ExplicitContextRetriever
} from "@agent-hub/task-runner";
import {
  InMemoryCodeGraphRepository,
  InMemoryContextIndexRepository,
  validateContextCandidate,
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
          path: ".env/config.ts",
          content: "TOKEN=secret\n"
        },
        {
          path: ".env.local/settings.ts",
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
        itemId: "file:.env/config.ts",
        layer: "code",
        reason: "secret-like selected file paths are excluded before retrieval"
      },
      {
        itemId: "file:.env.local/settings.ts",
        layer: "code",
        reason: "secret-like selected file paths are excluded before retrieval"
      }
    ]);
  });

  it("adds task-rule candidates for required compiled context sections", async () => {
    const retriever = new ExplicitContextRetriever();
    const task = testTask();
    const plan = createContextPlan({
      id: "context_plan_task_rule",
      taskPrompt: "Implement parser feature with approved memory",
      createdAt
    });

    const result = await retriever.retrieve({
      id: "context_retrieval_task_rule",
      plan,
      task,
      runId: "run_1",
      taskPrompt: "Implement parser feature with approved memory",
      contextBundle: contextBundle([
        section("task:task", "task", "task", "Current Task", "Implement parser"),
        section(
          "project:architecture",
          "project",
          "context/architecture.md",
          "Architecture Context",
          "Parser code belongs in packages/core."
        ),
        section(
          "memory:approved",
          "memory",
          "memory/approved.md",
          "Approved Memory",
          "Keep runtime context injection as the default delivery path."
        ),
        section(
          "conversation:thread",
          "conversation",
          "thread",
          "Conversation Continuity [trust=low]",
          "Thread note: continuity only."
        )
      ]),
      createdAt
    });

    const taskRuleCandidates = result.candidates.filter((candidate) =>
      candidate.routes.includes("task_rule")
    );
    expect(taskRuleCandidates).toEqual([
      expect.objectContaining({
        routes: ["task_rule"],
        item: expect.objectContaining({
          id: "project:architecture",
          layer: "project",
          sourceKind: "project",
          trustLevel: "high"
        })
      }),
      expect.objectContaining({
        routes: ["task_rule"],
        item: expect.objectContaining({
          id: "memory:approved",
          layer: "approved_memory",
          sourceKind: "memory",
          trustLevel: "high",
          metadata: expect.objectContaining({ memoryStatus: "approved" })
        })
      })
    ]);
    expect(taskRuleCandidates.map((candidate) => candidate.item.id)).not.toEqual(
      expect.arrayContaining(["task:task", "conversation:thread"])
    );
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "task-rule deterministic retrieval completed",
          metadata: expect.objectContaining({
            selectedCount: 2,
            requiredLayers: expect.arrayContaining(["project", "approved_memory"])
          })
        })
      ])
    );
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
          id: "context_index:project_1:global_skill:global:lint",
          projectId: "project_1",
          layer: "skill",
          sourceKind: "global_skill",
          sourceId: "global:lint",
          scope: "global",
          trustLevel: "medium",
          lifetime: "static",
          title: "Global Skill: Lint",
          content: "Use the global lint flow for parser changes.",
          contentHash: "sha256:global-lint-content",
          sourcePath: "/tmp/global-skills/lint/SKILL.md",
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
    expect(result.omitted).toEqual(
      expect.arrayContaining([
        {
          itemId: "context_index:project_1:project_skill:project:lint",
          layer: "skill",
          reason: "BM25 candidate duplicated an explicit-route source"
        },
        {
          itemId: "context_index:project_1:global_skill:global:lint",
          layer: "skill",
          reason: "BM25 skill candidate was not selected by the task or role"
        }
      ])
    );
  });

  it("omits BM25 indexed skill candidates that were not selected by task or role", async () => {
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
          id: "context_index:project_1:global_skill:global:review",
          projectId: "project_1",
          layer: "skill",
          sourceKind: "global_skill",
          sourceId: "global:review",
          scope: "global",
          trustLevel: "medium",
          lifetime: "static",
          title: "Global Skill: Review",
          content: "Review parser changes after lint runs.",
          contentHash: "sha256:review-content",
          sourcePath: "/tmp/global-skills/review/SKILL.md",
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
          content: "Parser lint review guidance lives in project context.",
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
      id: "context_plan_unselected_skills",
      taskPrompt: "Fix parser lint review regression",
      createdAt
    });

    const result = await retriever.retrieve({
      id: "context_retrieval_unselected_skills",
      plan,
      task,
      runId: "run_1",
      taskPrompt: "Fix parser lint review regression",
      contextBundle: contextBundle([
        section("task:task", "task", "task", "Current Task", "Fix parser")
      ]),
      createdAt
    });

    expect(result.candidates.map((candidate) => candidate.item.sourceKind))
      .not.toEqual(expect.arrayContaining(["project_skill", "global_skill"]));
    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          routes: ["bm25"],
          item: expect.objectContaining({
            sourceKind: "project_context",
            sourceId: "context/project.md"
          })
        })
      ])
    );
    expect(result.omitted).toEqual(
      expect.arrayContaining([
        {
          itemId: "context_index:project_1:project_skill:project:lint",
          layer: "skill",
          reason: "BM25 skill candidate was not selected by the task or role"
        },
        {
          itemId: "context_index:project_1:global_skill:global:review",
          layer: "skill",
          reason: "BM25 skill candidate was not selected by the task or role"
        }
      ])
    );
  });

  it("keeps retrieval functional when embedding capability is not configured", async () => {
    const retriever = new ExplicitContextRetriever();
    const task = testTask();
    const plan = createContextPlan({
      id: "context_plan_embedding_disabled",
      taskPrompt: "Fix parser.ts E_PARSE with semantic context",
      createdAt
    });

    const result = await retriever.retrieve({
      id: "context_retrieval_embedding_disabled",
      plan,
      task,
      runId: "run_1",
      taskPrompt: "Fix parser.ts E_PARSE with semantic context",
      contextBundle: contextBundle([
        section("task:task", "task", "task", "Current Task", "Fix parser.ts")
      ]),
      createdAt
    });

    expect(result.candidates).toEqual([
      expect.objectContaining({
        routes: ["explicit"],
        item: expect.objectContaining({ layer: "task" })
      })
    ]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "embedding retrieval skipped because no local embedding retriever is configured"
        }),
        expect.objectContaining({
          message: "hybrid retrieval fusion completed"
        })
      ])
    );
  });

  it("uses optional embedding retrieval and reranking when local capabilities are available", async () => {
    const semanticCandidate = validateContextCandidate({
      item: {
        id: "embedding:context/project.md",
        layer: "project",
        sourceKind: "project_context",
        sourceId: "context/project.md",
        scope: "project",
        trustLevel: "high",
        lifetime: "static",
        title: "Project Context",
        content: "Semantic parser architecture guidance.",
        contentHash: "sha256:semantic-project",
        sourcePath: "/tmp/context/project.md",
        createdAt,
        metadata: {
          provider: "mock_local_embedding"
        }
      },
      routes: ["embedding"],
      relevanceScore: 0.88,
      freshnessScore: 0.75,
      trustScore: 0.85,
      scopeMatchScore: 0.9,
      inclusionReason: "embedding similarity matched the current task",
      diagnostics: {
        provider: "mock_local_embedding"
      }
    });
    const retriever = new ExplicitContextRetriever({
      embeddingRetriever: {
        async detect() {
          return { available: true, provider: "mock_local_embedding" };
        },
        async retrieve() {
          return [semanticCandidate];
        }
      },
      reranker: {
        async detect() {
          return { available: true, provider: "mock_reranker" };
        },
        async rerank(input) {
          return [
            ...input.candidates.filter((candidate) =>
              candidate.routes.includes("embedding")
            ),
            ...input.candidates.filter((candidate) =>
              !candidate.routes.includes("embedding")
            )
          ];
        }
      }
    });
    const task = testTask();
    const plan = createContextPlan({
      id: "context_plan_embedding",
      taskPrompt: "Fix parser semantic architecture regression",
      createdAt
    });

    const result = await retriever.retrieve({
      id: "context_retrieval_embedding",
      plan,
      task,
      runId: "run_1",
      taskPrompt: "Fix parser semantic architecture regression",
      contextBundle: contextBundle([
        section("task:task", "task", "task", "Current Task", "Fix parser")
      ]),
      createdAt
    });

    expect(result.candidates[0]).toMatchObject({
      routes: ["embedding"],
      item: expect.objectContaining({
        sourceKind: "project_context",
        sourceId: "context/project.md"
      })
    });
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "embedding retrieval completed",
          metadata: expect.objectContaining({
            provider: "mock_local_embedding",
            candidateCount: 1
          })
        }),
        expect.objectContaining({
          message: "context candidates reranked",
          metadata: expect.objectContaining({
            provider: "mock_reranker"
          })
        }),
        expect.objectContaining({
          message: "hybrid retrieval fusion completed",
          metadata: expect.objectContaining({
            routeCounts: expect.objectContaining({
              embedding: 1,
              explicit: 1
            })
          })
        })
      ])
    );
  });

  it("adds graph candidates for TypeScript symbol, import, test, and changed-file relationships", async () => {
    const codeGraphRepository = new InMemoryCodeGraphRepository();
    await codeGraphRepository.rebuildProject(
      "project_1",
      buildTypeScriptCodeGraphEntries({
        projectId: "project_1",
        indexedAt: createdAt,
        files: [
          {
            path: "packages/core/src/parser.ts",
            content: [
              "import { TOKEN } from './tokens';",
              "export class Parser {}",
              "export function parse(input: string) { return TOKEN + input; }"
            ].join("\n")
          },
          {
            path: "packages/core/src/tokens.ts",
            content: "export const TOKEN = 'token';\n"
          },
          {
            path: "packages/core/src/parser.test.ts",
            content: [
              "import { parse } from './parser';",
              "export const parserSpec = () => parse('input');"
            ].join("\n")
          }
        ]
      }),
      createdAt
    );
    const retriever = new ExplicitContextRetriever({
      codeGraphRepository
    });
    const task = testTask();
    const plan = createContextPlan({
      id: "context_plan_graph",
      taskPrompt: "Fix Parser behavior after tokens.ts changed",
      createdAt
    });

    const result = await retriever.retrieve({
      id: "context_retrieval_graph",
      plan,
      task,
      runId: "run_1",
      taskPrompt: "Fix Parser behavior after tokens.ts changed",
      contextBundle: contextBundle([
        section("task:task", "task", "task", "Current Task", "Fix Parser")
      ]),
      selectedFiles: [
        {
          path: "packages/core/src/tokens.ts",
          content: "export const TOKEN = 'token';\n"
        }
      ],
      recentRunEvidence: [
        {
          runId: "run_previous",
          taskId: "task_previous",
          taskTitle: "Prior parser failure",
          agentKind: "fake",
          status: "failed",
          createdAt,
          summary: "Parser test failed.",
          changedFiles: ["packages/core/src/parser.ts"],
          metadata: {}
        }
      ],
      createdAt
    });

    const graphCandidates = result.candidates.filter((candidate) =>
      candidate.routes.includes("graph")
    );
    expect(graphCandidates.map((candidate) => candidate.item.sourceId)).toEqual([
      "packages/core/src/parser.ts",
      "packages/core/src/parser.test.ts"
    ]);
    expect(graphCandidates[0]).toMatchObject({
      item: {
        layer: "code",
        sourceKind: "code_graph",
        trustLevel: "high",
        sourceId: "packages/core/src/parser.ts",
        metadata: expect.objectContaining({
          matchedSymbols: ["Parser"]
        })
      },
      diagnostics: expect.objectContaining({
        seedPaths: ["packages/core/src/tokens.ts"],
        changedFiles: ["packages/core/src/parser.ts"]
      })
    });
    expect(graphCandidates[0]).toMatchObject({
      graphProximityScore: expect.any(Number),
      inclusionReason:
        "code graph matched TypeScript symbols, imports, tests, or changed-file relationships"
    });
    expect(graphCandidates[1]).toMatchObject({
      item: {
        layer: "test",
        sourceKind: "code_graph",
        trustLevel: "high",
        metadata: expect.objectContaining({
          isTest: true,
          matchedImports: ["packages/core/src/parser.ts"]
        })
      }
    });
    expect(result.omitted).toEqual([
      {
        itemId: "code_graph:project_1:packages/core/src/tokens.ts",
        layer: "code",
        reason: "graph candidate duplicated an earlier retrieval source"
      }
    ]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "code graph retrieval completed",
          metadata: expect.objectContaining({
            selectedCount: 2,
            omittedDuplicateCount: 1
          })
        })
      ])
    );
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
