import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DiffCollectionResult } from "@agent-hub/task-runner";
import { buildTypeScriptCodeGraphEntries } from "@agent-hub/task-runner";
import type { RiskReport } from "@agent-hub/core";
import {
  conservativePermissionSet,
  planGraphIdForTaskVersion,
  plannerNodeIdForPlanGraph,
  planNodeIdForPlanGraph,
  presetWorkgroupRoles,
  toWorkgroupRoleRunMetadata,
  type PlanGraph
} from "@agent-hub/core";
import {
  SQLITE_MIGRATIONS,
  createSqliteRepositories,
  rebuildStableContextIndex
} from "@agent-hub/db";
import type { VerificationSuiteResult } from "@agent-hub/task-runner";
import type { Workspace, WorkspaceCleanupResult } from "@agent-hub/task-runner";
import { createTestDirectory } from "./helpers";

const createdAt = "2026-01-01T00:00:00.000Z";
const updatedAt = "2026-01-01T00:00:01.000Z";

interface TestSqliteConnection {
  exec(sql: string): void;
  pragma(sql: string): unknown;
  close(): void;
}

interface TestSqliteConstructor {
  new(databasePath: string, options?: { timeout?: number }): TestSqliteConnection;
}

const requireFromDbPackage = createRequire(
  path.join(process.cwd(), "packages/db/package.json")
);
const TestSqlite = requireFromDbPackage("better-sqlite3") as TestSqliteConstructor;

describe("SQLite storage", () => {
  it("initializes migrations in a temporary database", async () => {
    const databasePath = path.join(
      await createTestDirectory("sqlite-migrations"),
      "agent-hub.sqlite"
    );
    const { database } = createSqliteRepositories({ databasePath });

    await database.ensureInitialized();

    expect(SQLITE_MIGRATIONS.at(-1)?.version).toBe(19);
    await expect(
      database.query<{ version: number }>(
        "SELECT version FROM schema_migrations ORDER BY version ASC;"
      )
    ).resolves.toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
      { version: 5 },
      { version: 6 },
      { version: 7 },
      { version: 8 },
      { version: 9 },
      { version: 10 },
      { version: 11 },
      { version: 12 },
      { version: 13 },
      { version: 14 },
      { version: 15 },
      { version: 16 },
      { version: 17 },
      { version: 18 },
      { version: 19 }
    ]);
    await expect(
      database.query<{ name: string }>(
        "SELECT name FROM pragma_table_info('comparison_reports') ORDER BY cid ASC;"
      )
    ).resolves.toEqual(
      expect.arrayContaining([{ name: "details_json" }])
    );
    await expect(
      database.query<{ name: string }>(
        "SELECT name FROM pragma_table_info('run_metadata') ORDER BY cid ASC;"
      )
    ).resolves.toEqual(
      expect.arrayContaining([{ name: "role_json" }, { name: "plan_binding_json" }])
    );
    await expect(
      database.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name ASC;"
      )
    ).resolves.toEqual(
      expect.arrayContaining([
        { name: "projects" },
        { name: "agent_profiles" },
        { name: "tasks" },
        { name: "task_runs" },
        { name: "run_events" },
        { name: "run_artifacts" },
        { name: "role_call_events" },
        { name: "role_calls" },
        { name: "role_todos" },
        { name: "verification_results" },
        { name: "risk_reports" },
        { name: "conversation_threads" },
        { name: "conversation_messages" },
        { name: "conversation_thread_summaries" },
        { name: "memory_items" },
        { name: "comparison_reports" },
        { name: "code_graph_entries" },
        { name: "context_index_entries" },
        { name: "context_eval_events" },
        { name: "context_text_fts" },
        { name: "skills" },
        { name: "settings" },
        { name: "plan_graphs" },
        { name: "plan_graph_nodes" },
        { name: "plan_graph_edges" },
        { name: "trace_nodes" },
        { name: "trace_edges" },
        { name: "trace_evidence_links" },
        { name: "role_call_tool_events" }
      ])
    );
    await expect(database.query<{ journal_mode: string }>("PRAGMA journal_mode;"))
      .resolves.toEqual([{ journal_mode: "wal" }]);
    await database.close();
  });

  it("rebuilds the stable context FTS index for project docs, approved memory, and skills", async () => {
    const baseDirectory = await createTestDirectory("sqlite-context-index");
    const databasePath = path.join(baseDirectory, "agent-hub.sqlite");
    const projectStoreRoot = path.join(baseDirectory, "project-store");
    const globalSkillStoreRoot = path.join(baseDirectory, "global-store");
    const repositories = createSqliteRepositories({ databasePath });

    await repositories.projectRepository.create({
      id: "project_index",
      name: "Indexed Project",
      rootPath: path.join(baseDirectory, "source"),
      createdAt,
      updatedAt: createdAt
    });
    await repositories.memoryItemRepository.create({
      id: "memory_proposed",
      projectId: "project_index",
      category: "project_fact",
      status: "proposed",
      content: "Proposed memory must not be indexed.",
      createdAt,
      updatedAt: createdAt
    });
    await repositories.memoryItemRepository.create({
      id: "memory_rejected",
      projectId: "project_index",
      category: "project_fact",
      status: "rejected",
      content: "Rejected memory must not be indexed.",
      createdAt,
      updatedAt: createdAt
    });

    await writeText(
      path.join(projectStoreRoot, "context", "project.md"),
      "# Project\n\nParser code lives in src/parser.ts. parseRuntime can fail with E_PARSE.\n"
    );
    await writeText(
      path.join(projectStoreRoot, "memory", "approved.md"),
      [
        "# Approved Memory",
        "",
        "<!-- agent-hub:memory memory_active -->",
        "approved_at: 2026-01-01T00:00:00.000Z",
        "",
        "Use runtime injection by default.",
        "",
        "<!-- agent-hub:memory memory_retired -->",
        "approved_at: 2026-01-01T00:00:00.000Z",
        "retired_at: 2026-01-01T00:00:01.000Z",
        "retired_reason: obsolete",
        "",
        "Retired memory must not be indexed.",
        ""
      ].join("\n")
    );
    await writeSkill(
      path.join(projectStoreRoot, "skills", "lint", "SKILL.md"),
      "lint",
      "Lint project changes",
      "Run pnpm lint."
    );
    await writeSkill(
      path.join(globalSkillStoreRoot, "skills", "review", "SKILL.md"),
      "review",
      "Review changed files",
      "Review parser changes."
    );
    await writeSkill(
      path.join(projectStoreRoot, "skills", ".env", "SKILL.md"),
      "secret-skill",
      "Should be skipped",
      "Never index this path."
    );

    const first = await rebuildStableContextIndex({
      projectId: "project_index",
      projectContextStoreRoot: projectStoreRoot,
      globalSkillStoreRoot,
      contextIndexRepository: repositories.contextIndexRepository,
      indexedAt: createdAt
    });

    expect(first).toMatchObject({
      createdCount: 4,
      updatedCount: 0,
      unchangedCount: 0,
      deletedCount: 0,
      skippedCount: 1,
      skipped: [
        expect.objectContaining({
          reason: "secret-like source paths are rejected before context indexing"
        })
      ]
    });
    await expect(
      repositories.contextIndexRepository.listByProjectId("project_index")
    ).resolves.toEqual([
      expect.objectContaining({
        sourceKind: "approved_memory",
        layer: "approved_memory",
        content: expect.stringContaining("Use runtime injection by default."),
        indexedAt: createdAt
      }),
      expect.objectContaining({
        sourceKind: "global_skill",
        layer: "global",
        sourceId: "global:review",
        indexedAt: createdAt
      }),
      expect.objectContaining({
        sourceKind: "project_context",
        layer: "project",
        sourceId: "context/project.md",
        indexedAt: createdAt
      }),
      expect.objectContaining({
        sourceKind: "project_skill",
        layer: "skill",
        sourceId: "project:lint",
        indexedAt: createdAt
      })
    ]);
    await expect(
      repositories.database.query<{ id: string }>(`
SELECT id
FROM context_text_fts
WHERE context_text_fts MATCH 'parser'
ORDER BY id ASC;
`)
    ).resolves.toEqual([
      expect.objectContaining({
        id: expect.stringContaining("global_skill:global:review")
      }),
      expect.objectContaining({
        id: expect.stringContaining("project_context:context/project.md")
      })
    ]);
    const pathSearch = await repositories.contextIndexRepository.search({
      projectId: "project_index",
      query: "Fix parseRuntime E_PARSE in src/parser.ts",
      terms: ["parser", "ts", "parseruntime", "e_parse"],
      limit: 2
    });
    expect(pathSearch[0]).toMatchObject({
      rank: 1,
      entry: expect.objectContaining({
        sourceKind: "project_context",
        sourceId: "context/project.md"
      }),
      diagnostics: expect.objectContaining({
        terms: ["parser", "ts", "parseruntime", "e_parse"]
      })
    });
    await expect(
      repositories.contextIndexRepository.search({
        projectId: "project_index",
        query: "runtime injection",
        limit: 1
      })
    ).resolves.toEqual([
      expect.objectContaining({
        entry: expect.objectContaining({
          sourceKind: "approved_memory",
          content: expect.stringContaining("Use runtime injection by default.")
        })
      })
    ]);
    expect(
      JSON.stringify(await repositories.contextIndexRepository.listByProjectId("project_index"))
    ).not.toContain("Proposed memory must not be indexed");
    expect(
      JSON.stringify(await repositories.contextIndexRepository.listByProjectId("project_index"))
    ).not.toContain("Retired memory must not be indexed");

    const second = await rebuildStableContextIndex({
      projectId: "project_index",
      projectContextStoreRoot: projectStoreRoot,
      globalSkillStoreRoot,
      contextIndexRepository: repositories.contextIndexRepository,
      indexedAt: updatedAt
    });

    expect(second).toMatchObject({
      createdCount: 0,
      updatedCount: 0,
      unchangedCount: 4,
      deletedCount: 0
    });
    await expect(
      repositories.contextIndexRepository.listByProjectId("project_index")
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKind: "project_context",
          indexedAt: createdAt
        })
      ])
    );

    await writeText(
      path.join(projectStoreRoot, "context", "project.md"),
      "# Project\n\nParser code moved to packages/core/src/parser.ts.\n"
    );
    await fs.rm(path.join(projectStoreRoot, "skills", "lint"), {
      recursive: true,
      force: true
    });
    const thirdAt = "2026-01-01T00:00:02.000Z";
    const third = await rebuildStableContextIndex({
      projectId: "project_index",
      projectContextStoreRoot: projectStoreRoot,
      globalSkillStoreRoot,
      contextIndexRepository: repositories.contextIndexRepository,
      indexedAt: thirdAt
    });

    expect(third).toMatchObject({
      createdCount: 0,
      updatedCount: 1,
      unchangedCount: 2,
      deletedCount: 1
    });
    await expect(
      repositories.contextIndexRepository.listByProjectId("project_index")
    ).resolves.toEqual([
      expect.objectContaining({ sourceKind: "approved_memory", indexedAt: createdAt }),
      expect.objectContaining({ sourceKind: "global_skill", indexedAt: createdAt }),
      expect.objectContaining({
        sourceKind: "project_context",
        content: expect.stringContaining("packages/core/src/parser.ts"),
        indexedAt: thirdAt
      })
    ]);
    await repositories.database.close();
  });

  it("persists and searches TypeScript code graph entries", async () => {
    const databasePath = path.join(
      await createTestDirectory("sqlite-code-graph"),
      "agent-hub.sqlite"
    );
    const repositories = createSqliteRepositories({ databasePath });
    await repositories.projectRepository.create({
      id: "project_graph",
      name: "Graph Project",
      rootPath: "/tmp/graph-project",
      createdAt,
      updatedAt: createdAt
    });

    const first = await repositories.codeGraphRepository.rebuildProject(
      "project_graph",
      buildTypeScriptCodeGraphEntries({
        projectId: "project_graph",
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

    expect(first).toMatchObject({
      projectId: "project_graph",
      indexedAt: createdAt,
      createdCount: 3,
      updatedCount: 0,
      unchangedCount: 0,
      deletedCount: 0
    });
    await expect(
      repositories.codeGraphRepository.listByProjectId("project_graph")
    ).resolves.toEqual([
      expect.objectContaining({
        filePath: "packages/core/src/parser.test.ts",
        isTest: true,
        imports: ["packages/core/src/parser.ts"]
      }),
      expect.objectContaining({
        filePath: "packages/core/src/parser.ts",
        isTest: false,
        imports: ["packages/core/src/tokens.ts"],
        relatedTests: ["packages/core/src/parser.test.ts"]
      }),
      expect.objectContaining({
        filePath: "packages/core/src/tokens.ts",
        isTest: false
      })
    ]);

    const searchResults = await repositories.codeGraphRepository.search({
      projectId: "project_graph",
      queryTerms: ["parser"],
      seedPaths: ["packages/core/src/tokens.ts"],
      changedFiles: ["packages/core/src/parser.ts"],
      limit: 3
    });
    expect(searchResults.map((result) => result.entry.filePath)).toEqual([
      "packages/core/src/parser.ts",
      "packages/core/src/tokens.ts",
      "packages/core/src/parser.test.ts"
    ]);
    expect(searchResults[0]).toMatchObject({
      rank: 1,
      matchedTerms: ["parser"],
      matchedSymbols: ["Parser"],
      matchedImports: ["packages/core/src/tokens.ts"],
      diagnostics: expect.objectContaining({
        seedPaths: ["packages/core/src/tokens.ts"],
        changedFiles: ["packages/core/src/parser.ts"]
      })
    });

    const updatedAt = "2026-01-01T00:00:02.000Z";
    const second = await repositories.codeGraphRepository.rebuildProject(
      "project_graph",
      buildTypeScriptCodeGraphEntries({
        projectId: "project_graph",
        indexedAt: updatedAt,
        files: [
          {
            path: "packages/core/src/parser.ts",
            content: [
              "import { TOKEN } from './tokens';",
              "export class Parser {}",
              "export const parserVersion = 2;"
            ].join("\n")
          },
          {
            path: "packages/core/src/tokens.ts",
            content: "export const TOKEN = 'token';\n"
          }
        ]
      }),
      updatedAt
    );

    expect(second).toMatchObject({
      createdCount: 0,
      updatedCount: 1,
      unchangedCount: 1,
      deletedCount: 1
    });
    await expect(
      repositories.codeGraphRepository.listByProjectId("project_graph")
    ).resolves.toEqual([
      expect.objectContaining({
        filePath: "packages/core/src/parser.ts",
        indexedAt: updatedAt,
        exports: expect.arrayContaining(["parserVersion"]),
        relatedTests: []
      }),
      expect.objectContaining({
        filePath: "packages/core/src/tokens.ts",
        indexedAt: createdAt
      })
    ]);
    await repositories.database.close();
  });

  it("persists context eval events by run and project", async () => {
    const databasePath = path.join(
      await createTestDirectory("sqlite-context-eval"),
      "agent-hub.sqlite"
    );
    const repositories = createSqliteRepositories({ databasePath });
    await repositories.projectRepository.create({
      id: "project_eval",
      name: "Eval Project",
      rootPath: "/tmp/eval-project",
      createdAt,
      updatedAt: createdAt
    });
    await repositories.taskRepository.create({
      id: "task_eval",
      projectId: "project_eval",
      title: "Evaluate context",
      status: "open",
      createdAt,
      updatedAt: createdAt
    });
    await repositories.taskRunRepository.create({
      id: "run_eval",
      taskId: "task_eval",
      agentKind: "fake",
      status: "queued",
      createdAt,
      updatedAt: createdAt
    });

    await repositories.contextEvalEventRepository.create({
      id: "context_eval_1",
      projectId: "project_eval",
      taskId: "task_eval",
      runId: "run_eval",
      planId: "context_plan_1",
      kind: "missing_context",
      severity: "warning",
      message: "One candidate was omitted.",
      selectedItemIds: ["task:task_eval"],
      omittedItemIds: ["context_index:large"],
      metadata: {
        omissionReasons: {
          "retrieval candidate exceeds code budget": 1
        }
      },
      createdAt
    });

    await expect(
      repositories.contextEvalEventRepository.listByRunId("run_eval")
    ).resolves.toEqual([
      expect.objectContaining({
        id: "context_eval_1",
        kind: "missing_context",
        selectedItemIds: ["task:task_eval"],
        omittedItemIds: ["context_index:large"],
        metadata: expect.objectContaining({
          omissionReasons: {
            "retrieval candidate exceeds code budget": 1
          }
        })
      })
    ]);
    await expect(
      repositories.contextEvalEventRepository.listByProjectId("project_eval")
    ).resolves.toHaveLength(1);
    await expect(
      repositories.database.execute(`
INSERT INTO context_eval_events (
  id,
  project_id,
  task_id,
  run_id,
  kind,
  severity,
  message,
  selected_item_ids_json,
  omitted_item_ids_json,
  metadata_json,
  created_at
) VALUES (
  'context_eval_bad',
  'project_eval',
  'task_eval',
  'run_eval',
  'run_outcome',
  'info',
  'Bad arrays.',
  '{}',
  '[]',
  '{}',
  '${createdAt}'
);
`)
    ).rejects.toThrow();
    await repositories.database.close();
  });

  it("keeps SQLite storage usable after a failed statement", async () => {
    const databasePath = path.join(
      await createTestDirectory("sqlite-session-restart"),
      "agent-hub.sqlite"
    );
    const { database } = createSqliteRepositories({ databasePath });

    await database.execute("CREATE TABLE sample (id TEXT PRIMARY KEY);");
    await expect(database.query("SELECT missing_column FROM sample;"))
      .rejects.toThrow(/missing_column|no such column/);

    await database.execute("INSERT INTO sample (id) VALUES ('ok');");
    await expect(database.query<{ id: string }>("SELECT id FROM sample;"))
      .resolves.toEqual([{ id: "ok" }]);
    await database.close();
  });

  it("persists PlanGraphs, active versions, trace links, and RoleCall tool events", async () => {
    const baseDirectory = await createTestDirectory("sqlite-plan-graphs");
    const databasePath = path.join(baseDirectory, "agent-hub.sqlite");
    const first = createSqliteRepositories({ databasePath });

    await first.projectRepository.create({
      id: "project_plan_graph",
      name: "Plan Graph Project",
      rootPath: path.join(baseDirectory, "source"),
      createdAt,
      updatedAt: createdAt
    });
    await first.taskRepository.create({
      id: "task_plan_graph",
      projectId: "project_plan_graph",
      title: "Persist plan graph",
      status: "open",
      createdAt,
      updatedAt: createdAt
    });
    await first.taskRunRepository.create({
      id: "run_plan_graph",
      taskId: "task_plan_graph",
      agentKind: "fake",
      status: "succeeded",
      createdAt,
      updatedAt: createdAt
    });

    const graph1 = sqlitePlanGraph("task_plan_graph", 1);
    const graph2 = sqlitePlanGraph("task_plan_graph", 2);
    const graph3 = sqlitePlanGraph("task_plan_graph", 3, "failed");
    const proposedGraph = sqlitePlanGraph("task_plan_graph", 4, "proposed");
    await first.planGraphRepository.create(graph1);
    await first.planGraphRepository.create(graph2);
    await expect(first.planGraphRepository.getActiveByTaskId("task_plan_graph"))
      .resolves.toMatchObject({ id: graph2.id, status: "active" });
    await expect(first.planGraphRepository.listByTaskId("task_plan_graph"))
      .resolves.toMatchObject([
        { id: graph1.id, status: "superseded" },
        { id: graph2.id, status: "active" }
      ]);

    await first.planGraphRepository.create(graph3);
    await first.planGraphRepository.supersede(graph2.id, graph3.id);
    await expect(first.planGraphRepository.getActiveByTaskId("task_plan_graph"))
      .resolves.toMatchObject({ id: graph3.id, status: "active" });
    await first.planGraphRepository.create(proposedGraph);
    await expect(first.planGraphRepository.get(proposedGraph.id))
      .resolves.toMatchObject({ id: proposedGraph.id, status: "proposed" });
    await expect(first.planGraphRepository.getActiveByTaskId("task_plan_graph"))
      .resolves.toMatchObject({ id: graph3.id, status: "active" });

    const implementNode = graph3.nodes.find((node) => node.kind === "implement");
    if (!implementNode) {
      throw new Error("missing implement node");
    }
    await first.traceLinkRepository.createNode({
      id: "trace_node_plan_graph",
      planGraphId: graph3.id,
      kind: "task_run",
      title: "PlanGraph run",
      status: "completed",
      sourcePlanNodeId: implementNode.id,
      role: "engineer",
      sourceType: "task_run",
      sourceId: "run_plan_graph",
      createdAt
    });
    await first.traceLinkRepository.createEdge({
      id: "trace_edge_plan_graph",
      planGraphId: graph3.id,
      from: implementNode.id,
      to: "trace_node_plan_graph",
      type: "runtime",
      label: "scheduled run"
    });
    await first.traceLinkRepository.linkEvidence({
      id: "trace_evidence_plan_graph",
      planGraphId: graph3.id,
      sourceType: "task_run",
      sourceId: "run_plan_graph",
      planNodeId: implementNode.id,
      traceNodeId: "trace_node_plan_graph",
      summary: "PlanGraph trace evidence persisted.",
      createdAt
    });
    await first.traceLinkRepository.createRoleCallToolEvent({
      id: "role_call_tool_plan_graph",
      planGraphId: graph3.id,
      sourcePlanNodeId: implementNode.id,
      sourceRunId: "run_plan_graph",
      targetRole: "reviewer",
      task: "Review persisted trace.",
      status: "accepted",
      createdTraceNodeIds: ["trace_node_plan_graph"],
      createdAt,
      updatedAt
    });
    await first.database.close();

    const second = createSqliteRepositories({ databasePath });
    await expect(second.planGraphRepository.get(graph3.id)).resolves.toMatchObject({
      id: graph3.id,
      taskId: graph3.taskId,
      version: graph3.version,
      status: "active",
      plannerNodeId: graph3.plannerNodeId,
      nodes: graph3.nodes,
      edges: graph3.edges
    });
    await expect(second.traceLinkRepository.listByPlanGraphId(graph3.id))
      .resolves.toMatchObject({
        nodes: [{ id: "trace_node_plan_graph", sourcePlanNodeId: implementNode.id }],
        edges: [{ id: "trace_edge_plan_graph", planGraphId: graph3.id }],
        evidence: [{ id: "trace_evidence_plan_graph", planNodeId: implementNode.id }],
        roleCallToolEvents: [
          {
            id: "role_call_tool_plan_graph",
            createdTraceNodeIds: ["trace_node_plan_graph"]
          }
        ]
      });
    await second.database.close();
  });

  it("persists tasks, runs, status transitions, and run metadata across instances", async () => {
    const baseDirectory = await createTestDirectory("sqlite-storage");
    const databasePath = path.join(baseDirectory, "agent-hub.sqlite");
    const first = createSqliteRepositories({ databasePath });

    await first.projectRepository.create({
      id: "project_1",
      name: "Project One",
      rootPath: path.join(baseDirectory, "source"),
      createdAt,
      updatedAt: createdAt
    });
    await expect(
      first.projectRepository.create({
        id: "project_duplicate",
        name: "Duplicate",
        rootPath: path.join(baseDirectory, "source"),
        createdAt,
        updatedAt: createdAt
      })
    ).rejects.toThrow();
    await first.agentProfileRepository.create({
      id: "agent_profile_1",
      kind: "fake",
      displayName: "Fake",
      enabled: true,
      createdAt,
      updatedAt: createdAt
    });
    await first.taskRepository.create({
      id: "task_1",
      projectId: "project_1",
      title: "Persist metadata",
      description: "Persist workspace, cleanup, diff, verification, and risk.",
      metadata: {
        source: "desktop_thread",
        threadId: "thread_1",
        assignments: [
          {
            assignmentId: "assignment_1",
            roleHandle: "researcher",
            executorKind: "agent_adapter"
          }
        ]
      },
      status: "open",
      createdAt,
      updatedAt: createdAt
    });
    await first.taskRunRepository.create({
      id: "run_1",
      taskId: "task_1",
      agentKind: "fake",
      status: "queued",
      createdAt,
      updatedAt: createdAt
    });
    await first.taskRunRepository.updateExecutionPaths(
      "run_1",
      {
        worktreePath: path.join(baseDirectory, "worktree"),
        branchName: "agent-hub/task_1/fake"
      },
      updatedAt
    );
    await first.taskRunRepository.updateStatus("run_1", "running", updatedAt);
    await first.conversationThreadRepository.create({
      id: "thread_1",
      projectId: "project_1",
      title: "Persist conversation",
      metadata: { source: "desktop" },
      createdAt,
      updatedAt
    });
    await first.conversationMessageRepository.create({
      id: "message_2",
      threadId: "thread_1",
      sequence: 1,
      role: "tool",
      kind: "run_card",
      content: "Fake run queued.",
      agentKind: "fake",
      runId: "run_1",
      status: "running",
      metadata: { card: true },
      createdAt: updatedAt
    });
    await first.conversationMessageRepository.create({
      id: "message_1",
      threadId: "thread_1",
      sequence: 0,
      role: "user",
      kind: "text",
      content: "Persist this thread.",
      createdAt
    });
    await first.taskRunRepository.create({
      id: "run_2",
      taskId: "task_1",
      agentKind: "fake",
      status: "queued",
      parentRunId: "run_1",
      parentMessageId: "message_2",
      createdAt: updatedAt,
      updatedAt
    });
    await first.conversationThreadSummaryRepository.upsert({
      id: "summary_1",
      threadId: "thread_1",
      summary: "Summarized 1 thread message.",
      decisions: ["Keep thread context local"],
      openItems: ["Refresh summaries after turns"],
      constraints: ["Do not promote to approved memory"],
      lastKnownUserGoal: "Persist this thread.",
      sourceMessageCount: 1,
      sourceLatestMessageId: "message_1",
      metadata: { source: "test" },
      createdAt,
      updatedAt
    });
    await first.runMetadataRepository.save({
      runId: "run_1",
      workspace: workspace(baseDirectory),
      workspaceCleanup: workspaceCleanup(),
      diff: diff(baseDirectory),
      verification: verification(),
      riskReport: riskReport(),
      role: toWorkgroupRoleRunMetadata(presetWorkgroupRoles[0]),
      planBinding: {
        planGraphId: "plan_graph:task_1:v1",
        planGraphVersion: 1,
        planNodeId: "plan_graph:task_1:v1:implement:2",
        allowedNextPlanNodeIds: ["plan_graph:task_1:v1:verify:3"]
      }
    });
    await first.runEventRepository.createMany([
      {
        id: "event_1",
        taskRunId: "run_1",
        sequence: 0,
        type: "stdout",
        message: "hello",
        metadata: { stream: "stdout" },
        createdAt
      },
      {
        id: "event_2",
        taskRunId: "run_1",
        sequence: 1,
        type: "exit",
        message: "done",
        metadata: { exitCode: 0 },
        createdAt
      }
    ]);
    await first.runArtifactRepository.create({
      id: "artifact_1",
      taskRunId: "run_1",
      kind: "git_diff",
      content: "diff text",
      metadata: { changedFiles: [{ path: "fake-agent-output.md", status: "untracked" }] },
      createdAt
    });
    await first.verificationResultRepository.create({
      id: "verification_1",
      taskRunId: "run_1",
      command: "pnpm test",
      status: "passed",
      exitCode: 0,
      stdout: "ok\n",
      stderr: "",
      createdAt
    });
    await first.riskReportRepository.create(riskReport());
    await first.memoryItemRepository.create({
      id: "memory_1",
      projectId: "project_1",
      taskId: "task_1",
      category: "project_fact",
      status: "proposed",
      content: "Use fake agent in tests.",
      metadata: {
        sourceRunId: "run_1",
        generatedBy: "task_runner"
      },
      createdAt,
      updatedAt: createdAt
    });
    await first.comparisonReportRepository.create({
      id: "comparison_1",
      taskId: "task_1",
      baselineRunId: "run_1",
      candidateRunId: "run_1",
      summary: "Same run comparison.",
      details: {
        score: {
          baseline: 100,
          candidate: 100,
          winner: "tie"
        }
      },
      createdAt
    });
    await first.skillRepository.create({
      id: "skill_1",
      projectId: "project_1",
      name: "fake-skill",
      description: "A fake test skill.",
      path: path.join(baseDirectory, "skill.md"),
      createdAt,
      updatedAt: createdAt
    });
    await first.settingsRepository.set({
      key: "ui.theme",
      value: { theme: "system" },
      updatedAt
    });
    await first.taskRunRepository.updateStatus(
      "run_1",
      "succeeded",
      "2026-01-01T00:00:02.000Z"
    );
    await first.taskRepository.updateStatus("task_1", "running", updatedAt);
    await first.taskRepository.updateStatus(
      "task_1",
      "completed",
      "2026-01-01T00:00:02.000Z"
    );

    const second = createSqliteRepositories({ databasePath });

    await expect(second.projectRepository.list()).resolves.toEqual([
      expect.objectContaining({ id: "project_1", name: "Project One" })
    ]);
    await expect(second.taskRepository.list()).resolves.toEqual([
      expect.objectContaining({
        id: "task_1",
        status: "completed",
        metadata: expect.objectContaining({
          source: "desktop_thread",
          threadId: "thread_1"
        })
      })
    ]);
    await expect(second.taskRunRepository.get("run_1")).resolves.toEqual(
      expect.objectContaining({
        id: "run_1",
        status: "succeeded",
        branchName: "agent-hub/task_1/fake"
      })
    );
    await expect(second.taskRunRepository.get("run_2")).resolves.toEqual(
      expect.objectContaining({
        id: "run_2",
        parentRunId: "run_1",
        parentMessageId: "message_2"
      })
    );
    await expect(second.taskRunRepository.getStatusTransitions("run_1")).resolves.toEqual([
      { runId: "run_1", status: "queued", at: createdAt },
      { runId: "run_1", status: "running", at: updatedAt },
      {
        runId: "run_1",
        status: "succeeded",
        at: "2026-01-01T00:00:02.000Z"
      }
    ]);
    await expect(second.runMetadataRepository.get("run_1")).resolves.toEqual(
      expect.objectContaining({
        workspace: expect.objectContaining({ runId: "run_1" }),
        workspaceCleanup: expect.objectContaining({ cleaned: true }),
        diff: expect.objectContaining({
          changedFiles: [{ path: "fake-agent-output.md", status: "untracked" }]
        }),
        verification: expect.objectContaining({ summary: "1 passed, 0 failed, 0 skipped" }),
        riskReport: expect.objectContaining({ level: "low" }),
        role: expect.objectContaining({
          roleHandle: "researcher",
          executorKind: "agent_adapter",
          adapterKind: "fake"
        }),
        planBinding: expect.objectContaining({
          planGraphId: "plan_graph:task_1:v1",
          planNodeId: "plan_graph:task_1:v1:implement:2",
          allowedNextPlanNodeIds: ["plan_graph:task_1:v1:verify:3"]
        })
      })
    );
    await expect(second.conversationThreadRepository.list("project_1")).resolves.toEqual([
      expect.objectContaining({
        id: "thread_1",
        projectId: "project_1",
        metadata: { source: "desktop" }
      })
    ]);
    await expect(
      second.conversationMessageRepository.listByThreadId("thread_1")
    ).resolves.toEqual([
      expect.objectContaining({
        id: "message_1",
        sequence: 0,
        role: "user",
        content: "Persist this thread."
      }),
      expect.objectContaining({
        id: "message_2",
        sequence: 1,
        kind: "run_card",
        runId: "run_1",
        status: "running",
        metadata: { card: true }
      })
    ]);
    await expect(second.conversationMessageRepository.get("message_2")).resolves.toEqual(
      expect.objectContaining({
        id: "message_2",
        runId: "run_1",
        status: "running"
      })
    );
    await expect(
      second.conversationMessageRepository.update({
        id: "message_2",
        threadId: "thread_1",
        sequence: 1,
        role: "assistant",
        kind: "text",
        content: "Persisted assistant answer.",
        agentKind: "fake",
        runId: "run_1",
        status: "succeeded",
        metadata: { assistantOutput: true },
        createdAt: updatedAt
      })
    ).resolves.toMatchObject({
      id: "message_2",
      role: "assistant",
      content: "Persisted assistant answer.",
      status: "succeeded",
      metadata: { assistantOutput: true }
    });
    await expect(
      second.conversationMessageRepository.listByThreadId("thread_1")
    ).resolves.toContainEqual(
      expect.objectContaining({
        id: "message_2",
        sequence: 1,
        role: "assistant",
        content: "Persisted assistant answer."
      })
    );
    await expect(
      second.conversationThreadSummaryRepository.getByThreadId("thread_1")
    ).resolves.toEqual(
      expect.objectContaining({
        id: "summary_1",
        summary: "Summarized 1 thread message.",
        decisions: ["Keep thread context local"],
        openItems: ["Refresh summaries after turns"],
        constraints: ["Do not promote to approved memory"],
        lastKnownUserGoal: "Persist this thread.",
        sourceLatestMessageId: "message_1",
        metadata: { source: "test" }
      })
    );
    await expect(second.runEventRepository.listByRunId("run_1")).resolves.toEqual([
      expect.objectContaining({ id: "event_1", sequence: 0, metadata: { stream: "stdout" } }),
      expect.objectContaining({ id: "event_2", sequence: 1, metadata: { exitCode: 0 } })
    ]);
    await expect(
      second.runArtifactRepository.getLatestByRunIdAndKind("run_1", "git_diff")
    ).resolves.toEqual(
      expect.objectContaining({
        content: "diff text",
        metadata: { changedFiles: [{ path: "fake-agent-output.md", status: "untracked" }] }
      })
    );
    await expect(second.verificationResultRepository.listByRunId("run_1")).resolves.toEqual([
      expect.objectContaining({ command: "pnpm test", status: "passed" })
    ]);
    await expect(second.riskReportRepository.getLatestByRunId("run_1")).resolves.toEqual(
      expect.objectContaining({ level: "low", changedFiles: ["fake-agent-output.md"] })
    );
    await expect(second.memoryItemRepository.listByProjectId("project_1")).resolves.toEqual([
      expect.objectContaining({
        id: "memory_1",
        status: "proposed",
        metadata: {
          sourceRunId: "run_1",
          generatedBy: "task_runner"
        }
      })
    ]);
    await expect(second.comparisonReportRepository.listByTaskId("task_1")).resolves.toEqual([
      expect.objectContaining({
        id: "comparison_1",
        summary: "Same run comparison.",
        details: {
          score: {
            baseline: 100,
            candidate: 100,
            winner: "tie"
          }
        }
      })
    ]);
    await expect(second.skillRepository.list("project_1")).resolves.toEqual([
      expect.objectContaining({ id: "skill_1", name: "fake-skill" })
    ]);
    await expect(second.settingsRepository.get("ui.theme")).resolves.toEqual(
      expect.objectContaining({ key: "ui.theme", value: { theme: "system" } })
    );
  });

  it("rejects secret-like local settings before persisting to SQLite", async () => {
    const databasePath = path.join(
      await createTestDirectory("sqlite-settings-secret-guard"),
      "agent-hub.sqlite"
    );
    const repositories = createSqliteRepositories({ databasePath });

    await expect(
      repositories.settingsRepository.set({
        key: "ui.theme",
        value: { theme: "system" },
        updatedAt
      })
    ).resolves.toEqual({
      key: "ui.theme",
      value: { theme: "system" },
      updatedAt
    });
    await expect(
      repositories.settingsRepository.set({
        key: "private_key",
        value: "redacted",
        updatedAt
      })
    ).rejects.toThrow("setting.key must not store secrets");
    await expect(
      repositories.settingsRepository.set({
        key: "ui.notice",
        value: "credentials=redacted-value",
        updatedAt
      })
    ).rejects.toThrow("setting.value must not store secret-like string values");
    await expect(repositories.settingsRepository.list()).resolves.toEqual([
      { key: "ui.theme", value: { theme: "system" }, updatedAt }
    ]);
  });

  it("persists role calls, role call events, and role todos as first-class records", async () => {
    const baseDirectory = await createTestDirectory("sqlite-role-calls");
    const databasePath = path.join(baseDirectory, "agent-hub.sqlite");
    const first = createSqliteRepositories({ databasePath });
    await first.projectRepository.create({
      id: "project_role_calls",
      name: "Role Calls",
      rootPath: path.join(baseDirectory, "source"),
      createdAt,
      updatedAt: createdAt
    });
    await first.taskRepository.create({
      id: "task_role_calls",
      projectId: "project_role_calls",
      title: "Role call storage",
      status: "open",
      createdAt,
      updatedAt: createdAt
    });
    await first.taskRunRepository.create({
      id: "run_role_call",
      taskId: "task_role_calls",
      agentKind: "fake",
      status: "queued",
      createdAt,
      updatedAt: createdAt
    });
    await first.conversationThreadRepository.create({
      id: "thread_role_calls",
      projectId: "project_role_calls",
      title: "Role call graph",
      createdAt,
      updatedAt: createdAt
    });
    await first.conversationMessageRepository.create({
      id: "message_role_calls",
      threadId: "thread_role_calls",
      sequence: 0,
      role: "assistant",
      kind: "text",
      content: "@operator inspect the failed run",
      createdAt
    });

    await first.roleCallRepository.create({
      id: "role_call_1",
      threadId: "thread_role_calls",
      parentMessageId: "message_role_calls",
      callerRole: "analyst",
      calleeRole: "operator",
      task: "Inspect the failed run and report root cause.",
      reason: "The analyst needs local run evidence.",
      context: {
        userGoal: "Fix the failed run.",
        constraints: ["Stay local-first"]
      },
      permissions: { ...conservativePermissionSet },
      expectedOutput: { format: "json", requiredEvidence: ["run event"] },
      priority: "normal",
      depth: 1,
      status: "proposed",
      createdAt
    });
    await first.roleCallEventRepository.createMany([
      {
        id: "role_call_event_1",
        roleCallId: "role_call_1",
        threadId: "thread_role_calls",
        type: "created",
        actorRole: "analyst",
        message: "Role call created.",
        metadata: { intentType: "delegate" },
        createdAt
      },
      {
        id: "role_call_event_2",
        roleCallId: "role_call_1",
        threadId: "thread_role_calls",
        type: "assessment_started",
        actorRole: "operator",
        message: "Operator is assessing the request.",
        createdAt: updatedAt
      }
    ]);
    await first.roleCallRepository.updateStatus(
      "role_call_1",
      "assessing",
      updatedAt
    );
    const assessingCall = await first.roleCallRepository.get("role_call_1");
    if (!assessingCall) {
      throw new Error("missing role call");
    }
    await first.roleCallRepository.update({
      ...assessingCall,
      status: "accepted",
      decision: {
        disposition: "accepted",
        reason: "The operator can inspect local run evidence.",
        evidence: ["thread_role_calls"]
      }
    });
    await first.roleTodoRepository.create({
      id: "role_todo_1",
      threadId: "thread_role_calls",
      role: "operator",
      sourceRoleCallId: "role_call_1",
      title: "Inspect failed run",
      status: "in_progress",
      priority: "normal",
      relatedRoleCallIds: ["role_call_1"],
      createdAt,
      updatedAt
    });
    const acceptedCall = await first.roleCallRepository.get("role_call_1");
    if (!acceptedCall) {
      throw new Error("missing accepted role call");
    }
    await first.roleCallRepository.update({
      ...acceptedCall,
      todoId: "role_todo_1"
    });
    await first.roleCallRepository.linkTaskRun("role_call_1", "run_role_call");
    await first.roleTodoRepository.updateStatus(
      "role_todo_1",
      "deferred",
      "2026-01-01T00:00:02.000Z"
    );
    await first.roleCallRepository.create({
      id: "role_call_child",
      threadId: "thread_role_calls",
      parentRoleCallId: "role_call_1",
      callerRole: "operator",
      calleeRole: "reviewer",
      task: "Review the operator findings for risk.",
      context: { userGoal: "Fix the failed run." },
      permissions: { ...conservativePermissionSet },
      expectedOutput: { format: "summary" },
      priority: "low",
      depth: 2,
      status: "proposed",
      createdAt: "2026-01-01T00:00:03.000Z"
    });

    const second = createSqliteRepositories({ databasePath });
    await expect(second.roleCallRepository.get("role_call_1")).resolves.toEqual(
      expect.objectContaining({
        id: "role_call_1",
        parentMessageId: "message_role_calls",
        status: "accepted",
        taskRunId: "run_role_call",
        todoId: "role_todo_1",
        decision: expect.objectContaining({ disposition: "accepted" })
      })
    );
    await expect(
      second.roleCallRepository.list({ threadId: "thread_role_calls" })
    ).resolves.toHaveLength(2);
    await expect(
      second.roleCallRepository.list({ role: "operator" })
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "role_call_1" }),
        expect.objectContaining({ id: "role_call_child" })
      ])
    );
    await expect(
      second.roleCallRepository.list({ parentRoleCallId: "role_call_1" })
    ).resolves.toEqual([
      expect.objectContaining({ id: "role_call_child", depth: 2 })
    ]);
    await expect(
      second.roleCallRepository.list({ todoStatus: "deferred" })
    ).resolves.toEqual([
      expect.objectContaining({ id: "role_call_1", todoId: "role_todo_1" })
    ]);
    await expect(
      second.roleTodoRepository.list({
        threadId: "thread_role_calls",
        role: "operator",
        status: "deferred"
      })
    ).resolves.toEqual([
      expect.objectContaining({
        id: "role_todo_1",
        sourceRoleCallId: "role_call_1",
        completedAt: undefined
      })
    ]);
    await expect(
      second.roleCallEventRepository.listByRoleCallId("role_call_1")
    ).resolves.toEqual([
      expect.objectContaining({ id: "role_call_event_1", type: "created" }),
      expect.objectContaining({
        id: "role_call_event_2",
        type: "assessment_started"
      })
    ]);
    await expect(roleCallJsonConstraint(second.database)).resolves.toBe(true);

    await second.database.execute("DELETE FROM task_runs WHERE id = 'run_role_call';");
    await expect(second.roleCallRepository.get("role_call_1")).resolves.toEqual(
      expect.objectContaining({ taskRunId: undefined })
    );
    await second.database.execute(
      "DELETE FROM conversation_messages WHERE id = 'message_role_calls';"
    );
    await expect(second.roleCallRepository.get("role_call_1")).resolves.toEqual(
      expect.objectContaining({ parentMessageId: undefined })
    );
    await second.database.execute(
      "DELETE FROM conversation_threads WHERE id = 'thread_role_calls';"
    );
    await expect(second.roleCallRepository.list({ threadId: "thread_role_calls" }))
      .resolves.toEqual([]);
    await expect(second.roleTodoRepository.list({ threadId: "thread_role_calls" }))
      .resolves.toEqual([]);
    await expect(
      second.roleCallEventRepository.listByThreadId("thread_role_calls")
    ).resolves.toEqual([]);
  });

  it("enforces imported SQLite constraints for relationships, enums, JSON, and event order", async () => {
    const baseDirectory = await createTestDirectory("sqlite-constraints");
    const databasePath = path.join(baseDirectory, "agent-hub.sqlite");
    const repositories = createSqliteRepositories({ databasePath });
    await repositories.projectRepository.create({
      id: "project_constraints",
      name: "Constraints",
      rootPath: path.join(baseDirectory, "source"),
      createdAt,
      updatedAt: createdAt
    });
    await repositories.agentProfileRepository.create({
      id: "agent_profile_constraints",
      kind: "fake",
      displayName: "Fake",
      enabled: true,
      createdAt,
      updatedAt: createdAt
    });
    await repositories.taskRepository.create({
      id: "task_constraints",
      projectId: "project_constraints",
      title: "Check constraints",
      status: "open",
      createdAt,
      updatedAt: createdAt
    });
    await repositories.taskRunRepository.create({
      id: "run_constraints",
      taskId: "task_constraints",
      agentProfileId: "agent_profile_constraints",
      agentKind: "fake",
      status: "queued",
      createdAt,
      updatedAt: createdAt
    });
    await repositories.runEventRepository.create({
      id: "event_constraints_1",
      taskRunId: "run_constraints",
      sequence: 0,
      type: "stdout",
      message: "first",
      metadata: {},
      createdAt
    });
    await repositories.conversationThreadRepository.create({
      id: "thread_constraints",
      projectId: "project_constraints",
      title: "Thread constraints",
      createdAt,
      updatedAt: createdAt
    });
    await repositories.conversationMessageRepository.create({
      id: "message_constraints_1",
      threadId: "thread_constraints",
      sequence: 0,
      role: "user",
      kind: "text",
      content: "first",
      createdAt
    });

    await expect(repositories.database.execute(`
INSERT INTO tasks (id, project_id, title, status, created_at, updated_at)
VALUES ('task_missing_project', 'missing_project', 'Missing', 'open', '${createdAt}', '${createdAt}');
`)).rejects.toThrow();
    await expect(repositories.database.execute(`
INSERT INTO task_runs (id, task_id, agent_profile_id, agent_kind, status, created_at, updated_at)
VALUES ('run_missing_profile', 'task_constraints', 'missing_profile', 'fake', 'queued', '${createdAt}', '${createdAt}');
`)).rejects.toThrow();
    await expect(repositories.database.execute(`
INSERT INTO tasks (id, project_id, title, status, created_at, updated_at)
VALUES ('task_bad_status', 'project_constraints', 'Bad', 'review_ready', '${createdAt}', '${createdAt}');
`)).rejects.toThrow();
    await expect(repositories.database.execute(`
INSERT INTO task_runs (id, task_id, agent_kind, status, created_at, updated_at)
VALUES ('run_bad_agent', 'task_constraints', 'unknown', 'queued', '${createdAt}', '${createdAt}');
`)).rejects.toThrow();
    await expect(repositories.database.execute(`
INSERT INTO task_runs (id, task_id, agent_kind, status, created_at, updated_at)
VALUES ('run_bad_status', 'task_constraints', 'fake', 'review_ready', '${createdAt}', '${createdAt}');
`)).rejects.toThrow();
    await expect(repositories.database.execute(`
INSERT INTO run_events (id, task_run_id, sequence, type, message, metadata_json, created_at)
VALUES ('event_bad_json', 'run_constraints', 1, 'stdout', 'bad json', '{bad', '${createdAt}');
`)).rejects.toThrow();
    await expect(repositories.database.execute(`
INSERT INTO run_events (id, task_run_id, sequence, type, message, metadata_json, created_at)
VALUES ('event_tool_call', 'run_constraints', 1, 'tool_call', 'tool call', '{}', '${createdAt}');
`)).rejects.toThrow();
    await expect(repositories.database.execute(`
INSERT INTO risk_reports (
  id,
  task_run_id,
  level,
  summary,
  findings_json,
  changed_files_json,
  verification_summary,
  failed_checks_json,
  risk_factors_json,
  manual_review_checklist_json,
  acceptance_recommendation,
  created_at
)
VALUES (
  'risk_bad_findings',
  'run_constraints',
  'low',
  'Invalid risk shape',
  '{}',
  '[]',
  'not run',
  '[]',
  '[]',
  '[]',
  'Do not accept.',
  '${createdAt}'
);
`)).rejects.toThrow();
    await expect(repositories.runEventRepository.create({
      id: "event_constraints_2",
      taskRunId: "run_constraints",
      sequence: 0,
      type: "stderr",
      message: "duplicate sequence",
      metadata: {},
      createdAt
    })).rejects.toThrow();
    await expect(repositories.database.execute(`
INSERT INTO conversation_threads (id, project_id, title, created_at, updated_at)
VALUES ('thread_missing_project', 'missing_project', 'Missing', '${createdAt}', '${createdAt}');
`)).rejects.toThrow();
    await expect(repositories.database.execute(`
INSERT INTO conversation_messages (id, thread_id, sequence, role, kind, content, created_at)
VALUES ('message_bad_role', 'thread_constraints', 1, 'narrator', 'text', 'bad', '${createdAt}');
`)).rejects.toThrow();
    await expect(
      repositories.conversationMessageRepository.create({
        id: "message_duplicate_sequence",
        threadId: "thread_constraints",
        sequence: 0,
        role: "assistant",
        kind: "text",
        content: "duplicate",
        createdAt
      })
    ).rejects.toThrow();
    await expect(repositories.database.execute(`
INSERT INTO conversation_thread_summaries (
  id, thread_id, summary, decisions_json, open_items_json, constraints_json,
  source_message_count, created_at, updated_at
) VALUES (
  'summary_bad_json', 'thread_constraints', 'bad json', '{bad', '[]', '[]',
  1, '${createdAt}', '${createdAt}'
);
`)).rejects.toThrow();
    await repositories.conversationThreadSummaryRepository.upsert({
      id: "summary_constraints_1",
      threadId: "thread_constraints",
      summary: "Initial",
      decisions: [],
      openItems: [],
      constraints: [],
      sourceMessageCount: 1,
      createdAt,
      updatedAt: createdAt
    });
    await expect(
      repositories.conversationThreadSummaryRepository.upsert({
        id: "summary_constraints_2",
        threadId: "thread_constraints",
        summary: "Updated",
        decisions: ["Keep it local"],
        openItems: [],
        constraints: [],
        sourceMessageCount: 1,
        createdAt,
        updatedAt
      })
    ).resolves.toMatchObject({
      id: "summary_constraints_2",
      decisions: ["Keep it local"]
    });
  });

  it("cascades project deletion through tasks and task runs", async () => {
    const baseDirectory = await createTestDirectory("sqlite-cascade");
    const databasePath = path.join(baseDirectory, "agent-hub.sqlite");
    const repositories = createSqliteRepositories({ databasePath });
    await repositories.projectRepository.create({
      id: "project_cascade",
      name: "Cascade",
      rootPath: path.join(baseDirectory, "source"),
      createdAt,
      updatedAt: createdAt
    });
    await repositories.taskRepository.create({
      id: "task_cascade",
      projectId: "project_cascade",
      title: "Cascade task",
      status: "open",
      createdAt,
      updatedAt: createdAt
    });
    await repositories.taskRunRepository.create({
      id: "run_cascade",
      taskId: "task_cascade",
      agentKind: "fake",
      status: "queued",
      createdAt,
      updatedAt: createdAt
    });
    await repositories.runEventRepository.create({
      id: "event_cascade",
      taskRunId: "run_cascade",
      sequence: 0,
      type: "stdout",
      message: "will be deleted",
      metadata: {},
      createdAt
    });
    await repositories.conversationThreadRepository.create({
      id: "thread_cascade",
      projectId: "project_cascade",
      title: "Cascade thread",
      createdAt,
      updatedAt: createdAt
    });
    await repositories.conversationMessageRepository.create({
      id: "message_cascade",
      threadId: "thread_cascade",
      sequence: 0,
      role: "user",
      kind: "text",
      content: "will be deleted",
      createdAt
    });
    await repositories.conversationThreadSummaryRepository.upsert({
      id: "summary_cascade",
      threadId: "thread_cascade",
      summary: "will be deleted",
      decisions: [],
      openItems: [],
      constraints: [],
      sourceMessageCount: 1,
      sourceLatestMessageId: "message_cascade",
      createdAt,
      updatedAt: createdAt
    });

    await repositories.database.execute("DELETE FROM projects WHERE id = 'project_cascade';");

    await expect(repositories.taskRepository.get("task_cascade")).resolves.toBeUndefined();
    await expect(repositories.taskRunRepository.get("run_cascade")).resolves.toBeUndefined();
    await expect(repositories.runEventRepository.listByRunId("run_cascade"))
      .resolves.toEqual([]);
    await expect(repositories.conversationThreadRepository.get("thread_cascade"))
      .resolves.toBeUndefined();
    await expect(repositories.conversationMessageRepository.listByThreadId("thread_cascade"))
      .resolves.toEqual([]);
    await expect(repositories.conversationThreadSummaryRepository.getByThreadId("thread_cascade"))
      .resolves.toBeUndefined();
  });

  it("rejects repository status updates outside the imported lifecycle", async () => {
    const baseDirectory = await createTestDirectory("sqlite-lifecycle");
    const databasePath = path.join(baseDirectory, "agent-hub.sqlite");
    const repositories = createSqliteRepositories({ databasePath });
    await repositories.projectRepository.create({
      id: "project_lifecycle",
      name: "Lifecycle",
      rootPath: path.join(baseDirectory, "source"),
      createdAt,
      updatedAt: createdAt
    });
    await repositories.taskRepository.create({
      id: "task_lifecycle",
      projectId: "project_lifecycle",
      title: "Lifecycle task",
      status: "open",
      createdAt,
      updatedAt: createdAt
    });
    await repositories.taskRunRepository.create({
      id: "run_lifecycle",
      taskId: "task_lifecycle",
      agentKind: "fake",
      status: "queued",
      createdAt,
      updatedAt: createdAt
    });
    await repositories.memoryItemRepository.create({
      id: "memory_lifecycle",
      projectId: "project_lifecycle",
      category: "workflow_rule",
      status: "proposed",
      content: "Only approved memory is injected.",
      createdAt,
      updatedAt: createdAt
    });
    await repositories.memoryItemRepository.create({
      id: "memory_retire_lifecycle",
      projectId: "project_lifecycle",
      category: "workflow_rule",
      status: "approved",
      content: "Retire this memory.",
      createdAt,
      updatedAt: createdAt
    });

    await expect(
      repositories.taskRepository.updateStatus("task_lifecycle", "completed", updatedAt)
    ).rejects.toThrow("invalid task status transition open -> completed");
    await repositories.taskRepository.updateStatus(
      "task_lifecycle",
      "running",
      updatedAt
    );
    await expect(
      repositories.taskRepository.updateStatus(
        "task_lifecycle",
        "open",
        "2026-01-01T00:00:02.000Z"
      )
    ).resolves.toMatchObject({ status: "open" });
    await expect(
      repositories.taskRunRepository.updateStatus("run_lifecycle", "failed", updatedAt)
    ).rejects.toThrow("invalid task run status transition queued -> failed");
    await expect(
      repositories.taskRunRepository.updateStatus("run_lifecycle", "queued", updatedAt)
    ).resolves.toMatchObject({ status: "queued" });
    await repositories.taskRunRepository.updateStatus("run_lifecycle", "running", updatedAt);
    await expect(
      repositories.taskRunRepository.updateStatus(
        "run_lifecycle",
        "succeeded",
        "2026-01-01T00:00:02.000Z"
      )
    ).resolves.toMatchObject({ status: "succeeded" });
    await repositories.memoryItemRepository.updateStatus(
      "memory_lifecycle",
      "rejected",
      updatedAt
    );
    await expect(
      repositories.memoryItemRepository.updateStatus(
        "memory_lifecycle",
        "approved",
        "2026-01-01T00:00:02.000Z"
      )
    ).rejects.toThrow("invalid memory item status transition rejected -> approved");
    await expect(
      repositories.memoryItemRepository.updateStatus(
        "memory_retire_lifecycle",
        "retired",
        "2026-01-01T00:00:02.000Z"
      )
    ).resolves.toMatchObject({ status: "retired" });
  });

  it("backfills legacy ad-hoc task projects during version 3 migration", async () => {
    const baseDirectory = await createTestDirectory("sqlite-migration-v3-adhoc");
    const databasePath = path.join(baseDirectory, "agent-hub.sqlite");
    await initializeSqliteThroughVersion(databasePath, 2);
    await runSqlite(databasePath, `
INSERT INTO tasks (id, project_id, title, status, created_at, updated_at)
VALUES ('task_adhoc_legacy', 'adhoc_project', 'Legacy ad-hoc task', 'open', '${createdAt}', '${updatedAt}');
INSERT INTO task_runs (
  id, task_id, agent_kind, status, created_at, updated_at
)
VALUES (
  'run_adhoc_legacy', 'task_adhoc_legacy', 'fake', 'queued', '${createdAt}', '${updatedAt}'
);
`);

    const repositories = createSqliteRepositories({ databasePath });
    await repositories.database.ensureInitialized();

    await expect(repositories.projectRepository.get("adhoc_project")).resolves.toEqual(
      expect.objectContaining({
        id: "adhoc_project",
        name: "Ad-hoc Project",
        rootPath: "/agent-hub/legacy-projects/adhoc_project"
      })
    );
    await expect(repositories.taskRepository.get("task_adhoc_legacy")).resolves.toEqual(
      expect.objectContaining({ id: "task_adhoc_legacy", projectId: "adhoc_project" })
    );
    await expect(repositories.taskRunRepository.get("run_adhoc_legacy")).resolves.toEqual(
      expect.objectContaining({ id: "run_adhoc_legacy", taskId: "task_adhoc_legacy" })
    );
    await expect(
      repositories.database.query<{ version: number }>(
        "SELECT version FROM schema_migrations ORDER BY version ASC;"
      )
    ).resolves.toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
      { version: 5 },
      { version: 6 },
      { version: 7 },
      { version: 8 },
      { version: 9 },
      { version: 10 },
      { version: 11 },
      { version: 12 },
      { version: 13 },
      { version: 14 },
      { version: 15 },
      { version: 16 },
      { version: 17 },
      { version: 18 },
      { version: 19 }
    ]);
  });

  it("rebuilds version 2 task tables with new constraints while preserving rows", async () => {
    const baseDirectory = await createTestDirectory("sqlite-migration-v3");
    const databasePath = path.join(baseDirectory, "agent-hub.sqlite");
    await initializeSqliteThroughVersion(databasePath, 2);
    await runSqlite(databasePath, `
INSERT INTO projects (id, name, root_path, created_at, updated_at)
VALUES ('project_legacy', 'Legacy', '${path.join(baseDirectory, "source").replaceAll("'", "''")}', '${createdAt}', '${createdAt}');
INSERT INTO agent_profiles (id, kind, display_name, enabled, created_at, updated_at)
VALUES ('agent_profile_legacy', 'fake', 'Fake', 1, '${createdAt}', '${createdAt}');
INSERT INTO tasks (id, project_id, title, status, created_at, updated_at)
VALUES ('task_legacy', 'project_legacy', 'Legacy task', 'open', '${createdAt}', '${createdAt}');
INSERT INTO task_runs (
  id, task_id, agent_profile_id, agent_kind, status, created_at, updated_at
)
VALUES (
  'run_legacy', 'task_legacy', 'agent_profile_legacy', 'fake', 'queued', '${createdAt}', '${createdAt}'
);
`);

    const repositories = createSqliteRepositories({ databasePath });
    await repositories.database.ensureInitialized();

    await expect(repositories.taskRepository.get("task_legacy")).resolves.toEqual(
      expect.objectContaining({ id: "task_legacy", projectId: "project_legacy" })
    );
    await expect(repositories.taskRunRepository.get("run_legacy")).resolves.toEqual(
      expect.objectContaining({
        id: "run_legacy",
        taskId: "task_legacy",
        agentProfileId: "agent_profile_legacy"
      })
    );
    await expect(
      repositories.database.query<{ version: number }>(
        "SELECT version FROM schema_migrations ORDER BY version ASC;"
      )
    ).resolves.toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
      { version: 5 },
      { version: 6 },
      { version: 7 },
      { version: 8 },
      { version: 9 },
      { version: 10 },
      { version: 11 },
      { version: 12 },
      { version: 13 },
      { version: 14 },
      { version: 15 },
      { version: 16 },
      { version: 17 },
      { version: 18 },
      { version: 19 }
    ]);
    await expect(repositories.database.execute(`
INSERT INTO tasks (id, project_id, title, status, created_at, updated_at)
VALUES ('task_after_migration_bad', 'project_legacy', 'Bad', 'invalid', '${createdAt}', '${createdAt}');
`)).rejects.toThrow();
    await expect(repositories.database.execute(`
INSERT INTO task_runs (
  id, task_id, agent_profile_id, agent_kind, status, created_at, updated_at
)
VALUES (
  'run_after_migration_bad', 'task_legacy', 'missing_profile', 'fake', 'queued', '${createdAt}', '${createdAt}'
);
`)).rejects.toThrow();
  });

  it("backfills conversation summary storage after a stale version 6 marker", async () => {
    const baseDirectory = await createTestDirectory("sqlite-migration-v8-summary-backfill");
    const databasePath = path.join(baseDirectory, "agent-hub.sqlite");
    const sourcePath = path.join(baseDirectory, "source").replaceAll("'", "''");
    await initializeSqliteThroughVersion(databasePath, 5);
    await runSqlite(databasePath, `
INSERT INTO schema_migrations (version, applied_at)
VALUES (6, '${createdAt}');
INSERT INTO projects (id, name, root_path, created_at, updated_at)
VALUES ('project_summary_legacy', 'Summary Legacy', '${sourcePath}', '${createdAt}', '${createdAt}');
INSERT INTO conversation_threads (id, project_id, title, created_at, updated_at)
VALUES ('thread_summary_legacy', 'project_summary_legacy', 'Legacy summary thread', '${createdAt}', '${createdAt}');
INSERT INTO conversation_messages (id, thread_id, sequence, role, kind, content, created_at)
VALUES ('message_summary_legacy', 'thread_summary_legacy', 0, 'user', 'text', 'Persist summary after branch upgrade.', '${createdAt}');
`);

    const repositories = createSqliteRepositories({ databasePath });
    await repositories.database.ensureInitialized();

    await expect(
      repositories.database.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'conversation_thread_summaries';"
      )
    ).resolves.toEqual([{ name: "conversation_thread_summaries" }]);
    await expect(
      repositories.conversationThreadSummaryRepository.upsert({
        id: "summary_after_backfill",
        threadId: "thread_summary_legacy",
        summary: "Summarized 1 thread message.",
        decisions: [],
        openItems: ["Persist summary after branch upgrade"],
        constraints: [],
        lastKnownUserGoal: "Persist summary after branch upgrade.",
        sourceMessageCount: 1,
        sourceLatestMessageId: "message_summary_legacy",
        createdAt,
        updatedAt
      })
    ).resolves.toMatchObject({
      id: "summary_after_backfill",
      threadId: "thread_summary_legacy"
    });
    await expect(
      repositories.database.query<{ version: number }>(
        "SELECT version FROM schema_migrations ORDER BY version ASC;"
      )
    ).resolves.toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
      { version: 5 },
      { version: 6 },
      { version: 7 },
      { version: 8 },
      { version: 9 },
      { version: 10 },
      { version: 11 },
      { version: 12 },
      { version: 13 },
      { version: 14 },
      { version: 15 },
      { version: 16 },
      { version: 17 },
      { version: 18 },
      { version: 19 }
    ]);
  });

  it("records run-parent migration when legacy columns already exist", async () => {
    const baseDirectory = await createTestDirectory("sqlite-migration-v9-existing-columns");
    const databasePath = path.join(baseDirectory, "agent-hub.sqlite");
    await initializeSqliteThroughVersion(databasePath, 8);
    await runSqlite(databasePath, `
ALTER TABLE task_runs
  ADD COLUMN parent_run_id TEXT REFERENCES task_runs(id) ON DELETE SET NULL;
ALTER TABLE task_runs
  ADD COLUMN parent_message_id TEXT REFERENCES conversation_messages(id) ON DELETE SET NULL;
`);

    const repositories = createSqliteRepositories({ databasePath });
    await repositories.database.ensureInitialized();

    await expect(
      repositories.database.query<{ version: number }>(
        "SELECT version FROM schema_migrations ORDER BY version ASC;"
      )
    ).resolves.toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
      { version: 5 },
      { version: 6 },
      { version: 7 },
      { version: 8 },
      { version: 9 },
      { version: 10 },
      { version: 11 },
      { version: 12 },
      { version: 13 },
      { version: 14 },
      { version: 15 },
      { version: 16 },
      { version: 17 },
      { version: 18 },
      { version: 19 }
    ]);
    await expect(
      repositories.database.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_task_runs_parent_run', 'idx_task_runs_parent_message') ORDER BY name ASC;"
      )
    ).resolves.toEqual([
      { name: "idx_task_runs_parent_message" },
      { name: "idx_task_runs_parent_run" }
    ]);
  });

  it("migrates risk report JSON columns to array-constrained storage", async () => {
    const baseDirectory = await createTestDirectory("sqlite-migration-v7-risk");
    const databasePath = path.join(baseDirectory, "agent-hub.sqlite");
    const sourcePath = path.join(baseDirectory, "source").replaceAll("'", "''");
    await initializeSqliteThroughVersion(databasePath, 5);
    await runSqlite(databasePath, `
PRAGMA foreign_keys = OFF;
DROP TABLE risk_reports;
CREATE TABLE risk_reports (
  id TEXT PRIMARY KEY,
  task_run_id TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('low', 'medium', 'high', 'blocking')),
  summary TEXT NOT NULL,
  findings_json TEXT NOT NULL CHECK (json_valid(findings_json)),
  changed_files_json TEXT NOT NULL CHECK (json_valid(changed_files_json)),
  verification_summary TEXT NOT NULL,
  failed_checks_json TEXT NOT NULL CHECK (json_valid(failed_checks_json)),
  risk_factors_json TEXT NOT NULL CHECK (json_valid(risk_factors_json)),
  manual_review_checklist_json TEXT NOT NULL CHECK (json_valid(manual_review_checklist_json)),
  acceptance_recommendation TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_run_id) REFERENCES task_runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_risk_reports_run ON risk_reports(task_run_id);
CREATE INDEX IF NOT EXISTS idx_risk_reports_level ON risk_reports(level);
PRAGMA foreign_keys = ON;
INSERT INTO projects (id, name, root_path, created_at, updated_at)
VALUES ('project_risk_legacy', 'Risk Legacy', '${sourcePath}', '${createdAt}', '${createdAt}');
INSERT INTO tasks (id, project_id, title, status, created_at, updated_at)
VALUES ('task_risk_legacy', 'project_risk_legacy', 'Legacy risk task', 'open', '${createdAt}', '${createdAt}');
INSERT INTO task_runs (id, task_id, agent_kind, status, created_at, updated_at)
VALUES ('run_risk_legacy', 'task_risk_legacy', 'fake', 'queued', '${createdAt}', '${createdAt}');
INSERT INTO risk_reports (
  id,
  task_run_id,
  level,
  summary,
  findings_json,
  changed_files_json,
  verification_summary,
  failed_checks_json,
  risk_factors_json,
  manual_review_checklist_json,
  acceptance_recommendation,
  created_at
)
VALUES (
  'risk_legacy',
  'run_risk_legacy',
  'medium',
  'Legacy risk report',
  '{"legacy":true}',
  '{"path":"src/index.ts"}',
  'not run',
  '{"failed":"pnpm test"}',
  '{"factor":"source changed"}',
  '{"review":"manual"}',
  'Review manually.',
  '${createdAt}'
);
`);

    const repositories = createSqliteRepositories({ databasePath });
    await repositories.database.ensureInitialized();

    await expect(
      repositories.riskReportRepository.getLatestByRunId("run_risk_legacy")
    ).resolves.toEqual(
      expect.objectContaining({
        id: "risk_legacy",
        findings: [],
        changedFiles: [],
        failedChecks: [],
        riskFactors: [],
        manualReviewChecklist: []
      })
    );
    await expect(repositories.database.execute(`
INSERT INTO risk_reports (
  id,
  task_run_id,
  level,
  summary,
  findings_json,
  changed_files_json,
  verification_summary,
  failed_checks_json,
  risk_factors_json,
  manual_review_checklist_json,
  acceptance_recommendation,
  created_at
)
VALUES (
  'risk_after_migration_bad',
  'run_risk_legacy',
  'low',
  'Invalid post-migration risk report',
  '{}',
  '[]',
  'not run',
  '[]',
  '[]',
  '[]',
  'Do not accept.',
  '${createdAt}'
);
`)).rejects.toThrow();
  });
});

async function roleCallJsonConstraint(
  database: ReturnType<typeof createSqliteRepositories>["database"]
): Promise<boolean> {
  await expect(database.execute(`
UPDATE role_calls
SET context_json = '{bad'
WHERE id = 'role_call_1';
`)).rejects.toThrow();
  return true;
}

function workspace(baseDirectory: string): Workspace {
  return {
    path: path.join(baseDirectory, "worktree"),
    branchName: "agent-hub/task_1/fake",
    sourceRepositoryPath: path.join(baseDirectory, "source"),
    workspaceBasePath: path.join(baseDirectory, "worktrees"),
    taskId: "task_1",
    runId: "run_1",
    agentKind: "fake",
    dryRun: false,
    sourceRepositoryDirty: false,
    cleanupPolicy: "never"
  };
}

function workspaceCleanup(): WorkspaceCleanupResult {
  return {
    cleaned: true,
    retained: false,
    reason: "workspace cleaned up",
    commands: []
  };
}

function diff(baseDirectory: string): DiffCollectionResult {
  return {
    ok: true,
    workspacePath: path.join(baseDirectory, "worktree"),
    isClean: false,
    changedFiles: [{ path: "fake-agent-output.md", status: "untracked" }],
    stat: {
      filesChanged: 1,
      insertions: 2,
      deletions: 0,
      text: "1 file changed, 2 insertions(+)"
    },
    diff: "diff --git a/fake-agent-output.md b/fake-agent-output.md\n",
    fileSummaries: ["fake-agent-output.md: untracked"],
    commands: []
  };
}

function verification(): VerificationSuiteResult {
  return {
    status: "passed",
    results: [
      {
        commandId: "test",
        label: "test",
        command: { executable: "pnpm", args: ["test"], displayName: "test" },
        status: "passed",
        stdout: "ok\n",
        stderr: "",
        exitCode: 0,
        durationMs: 10,
        timedOut: false,
        dryRun: false
      }
    ],
    failedCommands: [],
    missingCommandConfig: false,
    summary: "1 passed, 0 failed, 0 skipped",
    durationMs: 10
  };
}

function riskReport(): RiskReport {
  return {
    id: "risk_1",
    taskRunId: "run_1",
    level: "low",
    summary: "Risk is low.",
    changedFiles: ["fake-agent-output.md"],
    verificationSummary: "1 passed, 0 failed, 0 skipped",
    failedChecks: [],
    riskFactors: [],
    manualReviewChecklist: ["Review changed files."],
    acceptanceRecommendation: "Accept if the changed files match the task intent.",
    findings: [],
    createdAt
  };
}

function sqlitePlanGraph(
  taskId: string,
  version: number,
  status: PlanGraph["status"] = "active"
): PlanGraph {
  const graphId = planGraphIdForTaskVersion(taskId, version);
  const plannerId = plannerNodeIdForPlanGraph(graphId);
  const researchId = planNodeIdForPlanGraph(graphId, "research", 1);
  const implementId = planNodeIdForPlanGraph(graphId, "implement", 2);
  const verifyId = planNodeIdForPlanGraph(graphId, "verify", 3);
  return {
    id: graphId,
    taskId,
    version,
    status,
    plannerNodeId: plannerId,
    createdByRole: "planner",
    createdAt,
    nodes: [
      {
        id: plannerId,
        kind: "planner",
        title: "Create plan",
        role: "planner",
        instructions: "Create a local execution plan.",
        acceptanceCriteria: ["Plan is valid."],
        riskLevel: "low",
        required: true,
        execution: { mode: "system" },
        outputPlanGraphId: graphId
      },
      {
        id: researchId,
        kind: "research",
        title: "Inspect files",
        role: "engineer",
        instructions: "Inspect relevant files.",
        acceptanceCriteria: ["Relevant files are known."],
        riskLevel: "low",
        required: true,
        execution: {
          mode: "primary_run",
          expectedAdapter: "codex",
          worktreePolicy: "isolated"
        }
      },
      {
        id: implementId,
        kind: "implement",
        title: "Implement",
        role: "engineer",
        instructions: "Implement the local change.",
        acceptanceCriteria: ["Implementation evidence is linked."],
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
        title: "Verify",
        role: "reviewer",
        instructions: "Inspect verification evidence.",
        acceptanceCriteria: ["Verification evidence is linked."],
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

async function writeText(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function writeSkill(
  filePath: string,
  name: string,
  description: string,
  body: string
): Promise<void> {
  await writeText(
    filePath,
    [
      "---",
      `name: ${name}`,
      `description: ${description}`,
      "---",
      "",
      body,
      ""
    ].join("\n")
  );
}

async function initializeSqliteThroughVersion(
  databasePath: string,
  version: number
): Promise<void> {
  const migrations = SQLITE_MIGRATIONS.filter((migration) => migration.version <= version);
  const migrationStatements = migrations.flatMap((migration) => {
    if (migration.transaction === false) {
      return [migration.sql];
    }
    return [
      "BEGIN;",
      migration.sql,
      `INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (${migration.version}, '${createdAt}');`,
      "COMMIT;"
    ];
  });
  const script = [
    "PRAGMA foreign_keys = ON;",
    "CREATE TABLE IF NOT EXISTS schema_migrations (",
    "  version INTEGER PRIMARY KEY,",
    "  applied_at TEXT NOT NULL",
    ");",
    ...migrationStatements
  ].join("\n");
  await runSqlite(databasePath, script);
}

async function runSqlite(databasePath: string, script: string): Promise<void> {
  const database = new TestSqlite(databasePath, { timeout: 5000 });
  try {
    database.pragma("busy_timeout = 5000");
    database.pragma("foreign_keys = ON");
    database.exec(script);
  } finally {
    database.close();
  }
}
