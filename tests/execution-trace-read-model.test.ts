import { describe, expect, it } from "vitest";
import {
  buildExecutionTraceGraph,
  InMemoryPlanGraphRepository,
  InMemoryRunMetadataRepository,
  InMemoryTaskRunRepository,
  InMemoryTraceLinkRepository,
  type PlanGraph,
  type TaskRun
} from "@agent-hub/core";

const createdAt = "2026-01-01T00:00:00.000Z";

function planGraph(overrides: Partial<PlanGraph> = {}): PlanGraph {
  return {
    id: "plan_graph_1",
    taskId: "task_1",
    version: 1,
    status: "active",
    plannerNodeId: "plan_graph_1:planner",
    createdByRole: "planner",
    createdAt,
    nodes: [
      {
        id: "plan_graph_1:planner",
        kind: "planner",
        role: "planner",
        title: "Create graph",
        instructions: "Create a valid graph.",
        acceptanceCriteria: ["Graph is valid."],
        riskLevel: "low",
        required: true,
        execution: { mode: "system" },
        outputPlanGraphId: "plan_graph_1"
      },
      {
        id: "plan_node_implement",
        kind: "implement",
        role: "engineer",
        title: "Implement change",
        instructions: "Implement the requested change.",
        acceptanceCriteria: ["Run completes."],
        riskLevel: "medium",
        required: true,
        execution: {
          mode: "primary_run",
          expectedAdapter: "fake",
          worktreePolicy: "isolated"
        }
      },
      {
        id: "plan_node_verify",
        kind: "verify",
        role: "engineer",
        title: "Verify change",
        instructions: "Run verification.",
        acceptanceCriteria: ["Checks pass."],
        riskLevel: "low",
        required: true,
        execution: { mode: "manual" }
      }
    ],
    edges: [
      { from: "plan_graph_1:planner", to: "plan_node_implement", type: "primary" },
      { from: "plan_node_implement", to: "plan_node_verify", type: "primary" }
    ],
    ...overrides
  };
}

function versionedPlanGraph(version: number, status: PlanGraph["status"] = "active"): PlanGraph {
  const graphId = `plan_graph_${version}`;
  const plannerId = `${graphId}:planner`;
  const implementId = `plan_node_implement_${version}`;
  const verifyId = `plan_node_verify_${version}`;
  return planGraph({
    id: graphId,
    version,
    status,
    plannerNodeId: plannerId,
    nodes: [
      {
        id: plannerId,
        kind: "planner",
        role: "planner",
        title: "Create graph",
        instructions: "Create a valid graph.",
        acceptanceCriteria: ["Graph is valid."],
        riskLevel: "low",
        required: true,
        execution: { mode: "system" },
        outputPlanGraphId: graphId
      },
      {
        id: implementId,
        kind: "implement",
        role: "engineer",
        title: `Implement change v${version}`,
        instructions: "Implement the requested change.",
        acceptanceCriteria: ["Run completes."],
        riskLevel: "medium",
        required: true,
        execution: {
          mode: "primary_run",
          expectedAdapter: "fake",
          worktreePolicy: "isolated"
        }
      },
      {
        id: verifyId,
        kind: "verify",
        role: "engineer",
        title: `Verify change v${version}`,
        instructions: "Run verification.",
        acceptanceCriteria: ["Checks pass."],
        riskLevel: "low",
        required: true,
        execution: { mode: "manual" }
      }
    ],
    edges: [
      { from: plannerId, to: implementId, type: "primary" },
      { from: implementId, to: verifyId, type: "primary" }
    ]
  });
}

function taskRun(overrides: Partial<TaskRun> = {}): TaskRun {
  return {
    id: "run_1",
    taskId: "task_1",
    agentKind: "fake",
    status: "succeeded",
    createdAt,
    updatedAt: createdAt,
    ...overrides
  };
}

function repositories() {
  return {
    planGraphRepository: new InMemoryPlanGraphRepository(),
    traceLinkRepository: new InMemoryTraceLinkRepository(),
    taskRunRepository: new InMemoryTaskRunRepository(),
    runMetadataRepository: new InMemoryRunMetadataRepository()
  };
}

describe("execution trace read model", () => {
  it("projects a plan-only ExecutionTraceGraph", async () => {
    const repos = repositories();
    await repos.planGraphRepository.create(planGraph());

    const trace = await buildExecutionTraceGraph(repos, {
      planGraphId: "plan_graph_1",
      now: createdAt
    });

    expect(trace).toEqual(
      expect.objectContaining({
        taskId: "task_1",
        planGraphId: "plan_graph_1",
        baseNodes: expect.arrayContaining([
          expect.objectContaining({ id: "plan_node_implement" })
        ]),
        dynamicNodes: [],
        dynamicEdges: [],
        evidence: [],
        deviations: []
      })
    );
  });

  it("projects primary TaskRuns from run metadata bindings", async () => {
    const repos = repositories();
    await repos.planGraphRepository.create(planGraph());
    await repos.taskRunRepository.create(taskRun());
    await repos.runMetadataRepository.save({
      runId: "run_1",
      planBinding: {
        planGraphId: "plan_graph_1",
        planGraphVersion: 1,
        planNodeId: "plan_node_implement",
        allowedNextPlanNodeIds: ["plan_node_verify"]
      }
    });

    const trace = await buildExecutionTraceGraph(repos, {
      taskId: "task_1",
      now: createdAt
    });

    expect(trace.dynamicNodes).toEqual([
      expect.objectContaining({
        id: "trace_node:run:run_1",
        kind: "task_run",
        status: "completed",
        sourcePlanNodeId: "plan_node_implement",
        sourceType: "task_run",
        sourceId: "run_1"
      })
    ]);
    expect(trace.dynamicEdges).toEqual([
      expect.objectContaining({
        from: "plan_node_implement",
        to: "trace_node:run:run_1",
        type: "runtime"
      })
    ]);
    expect(trace.evidence).toEqual([
      expect.objectContaining({
        sourceType: "task_run",
        sourceId: "run_1",
        planNodeId: "plan_node_implement"
      })
    ]);
  });

  it("resolves run-rooted traces from the run metadata PlanGraph binding", async () => {
    const repos = repositories();
    const oldGraph = versionedPlanGraph(1);
    const activeGraph = versionedPlanGraph(2);
    await repos.planGraphRepository.create(oldGraph);
    await repos.planGraphRepository.create(activeGraph);
    await repos.taskRunRepository.create(taskRun({ id: "run_old" }));
    await repos.taskRunRepository.create(taskRun({ id: "run_new" }));
    await repos.runMetadataRepository.save({
      runId: "run_old",
      planBinding: {
        planGraphId: oldGraph.id,
        planGraphVersion: oldGraph.version,
        planNodeId: "plan_node_implement_1",
        allowedNextPlanNodeIds: ["plan_node_verify_1"]
      }
    });
    await repos.runMetadataRepository.save({
      runId: "run_new",
      planBinding: {
        planGraphId: activeGraph.id,
        planGraphVersion: activeGraph.version,
        planNodeId: "plan_node_implement_2",
        allowedNextPlanNodeIds: ["plan_node_verify_2"]
      }
    });

    const trace = await buildExecutionTraceGraph(repos, {
      runId: "run_old",
      now: createdAt
    });

    expect(trace).toEqual(expect.objectContaining({
      planGraphId: oldGraph.id,
      planGraphVersion: oldGraph.version,
      baseNodes: expect.arrayContaining([
        expect.objectContaining({ id: "plan_node_implement_1" })
      ]),
      dynamicNodes: [
        expect.objectContaining({
          sourceId: "run_old",
          sourcePlanNodeId: "plan_node_implement_1"
        })
      ]
    }));
    expect(trace.baseNodes).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "plan_node_implement_2" })
    ]));
    expect(trace.dynamicNodes).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: "run_new" })
    ]));
  });

  it("projects verification, risk, and diff evidence from run metadata", async () => {
    const repos = repositories();
    await repos.planGraphRepository.create(planGraph());
    await repos.taskRunRepository.create(taskRun());
    await repos.runMetadataRepository.save({
      runId: "run_1",
      planBinding: {
        planGraphId: "plan_graph_1",
        planGraphVersion: 1,
        planNodeId: "plan_node_implement",
        allowedNextPlanNodeIds: ["plan_node_verify"]
      },
      verification: {
        status: "skipped",
        results: [],
        failedCommands: [],
        missingCommandConfig: true,
        summary: "No verification commands were configured.",
        durationMs: 0
      },
      diff: {
        ok: true,
        workspacePath: "/tmp/worktree",
        isClean: false,
        changedFiles: [{ path: "src/app.ts", status: "modified" }],
        stat: {
          filesChanged: 1,
          insertions: 2,
          deletions: 0,
          text: "1 file changed"
        },
        diff: "",
        fileSummaries: ["src/app.ts: modified"],
        commands: []
      },
      riskReport: {
        id: "risk_1",
        taskRunId: "run_1",
        level: "medium",
        summary: "Risk is medium.",
        changedFiles: ["src/app.ts"],
        verificationSummary: "No verification commands were configured.",
        failedChecks: [],
        riskFactors: ["Verification commands were not run."],
        manualReviewChecklist: ["Inspect risk."],
        acceptanceRecommendation: "Review before accepting.",
        findings: [],
        createdAt
      }
    });

    const trace = await buildExecutionTraceGraph(repos, {
      planGraphId: "plan_graph_1",
      now: createdAt
    });

    expect(trace.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceType: "verification",
        sourceId: "run_1",
        planNodeId: "plan_node_implement"
      }),
      expect.objectContaining({
        sourceType: "risk",
        sourceId: "risk_1",
        planNodeId: "plan_node_implement"
      }),
      expect.objectContaining({
        sourceType: "diff",
        sourceId: "run_1",
        summary: "Diff changed 1 file(s)"
      })
    ]));
    expect(trace.deviations).toEqual([
      expect.objectContaining({
        type: "missing_verification",
        evidenceId: "trace_evidence:verification:run_1",
        planNodeId: "plan_node_implement"
      })
    ]);
  });

  it("projects RoleCall tool events and accepted dynamic trace nodes", async () => {
    const repos = repositories();
    await repos.planGraphRepository.create(planGraph());
    await repos.traceLinkRepository.createNode({
      id: "trace_role_call",
      planGraphId: "plan_graph_1",
      kind: "role_call",
      title: "@reviewer inspect result",
      status: "queued",
      sourcePlanNodeId: "plan_node_implement",
      role: "reviewer",
      sourceType: "role_call",
      sourceId: "role_call_1",
      createdAt
    });
    await repos.traceLinkRepository.createRoleCallToolEvent({
      id: "tool_event_1",
      planGraphId: "plan_graph_1",
      sourcePlanNodeId: "plan_node_implement",
      sourceRunId: "run_1",
      targetRole: "reviewer",
      task: "inspect result",
      status: "accepted",
      createdTraceNodeIds: ["trace_role_call"],
      createdAt
    });

    const trace = await buildExecutionTraceGraph(repos, {
      planGraphId: "plan_graph_1",
      now: createdAt
    });

    expect(trace.dynamicNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "trace_role_call", kind: "role_call" }),
      expect.objectContaining({
        id: "trace_node:role_call_tool_event:tool_event_1",
        kind: "role_call_tool_event",
        sourcePlanNodeId: "plan_node_implement"
      })
    ]));
    expect(trace.dynamicEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: "plan_node_implement",
        to: "trace_node:role_call_tool_event:tool_event_1"
      }),
      expect.objectContaining({
        from: "trace_node:role_call_tool_event:tool_event_1",
        to: "trace_role_call"
      })
    ]));
  });

  it("marks failed required plan nodes as deterministic deviations", async () => {
    const repos = repositories();
    await repos.planGraphRepository.create(planGraph());
    await repos.taskRunRepository.create(taskRun({ status: "failed" }));
    await repos.runMetadataRepository.save({
      runId: "run_1",
      planBinding: {
        planGraphId: "plan_graph_1",
        planGraphVersion: 1,
        planNodeId: "plan_node_implement",
        allowedNextPlanNodeIds: []
      }
    });

    const trace = await buildExecutionTraceGraph(repos, {
      planGraphId: "plan_graph_1",
      now: createdAt
    });

    expect(trace.deviations).toEqual([
      expect.objectContaining({
        type: "failed_required_node",
        severity: "medium",
        planNodeId: "plan_node_implement",
        traceNodeId: "trace_node:run:run_1"
      })
    ]);
  });

  it("does not mark pending primary nodes as skipped deviations", async () => {
    const repos = repositories();
    await repos.planGraphRepository.create(planGraph({
      nodes: [
        ...planGraph().nodes,
        {
          id: "plan_node_docs",
          kind: "documentation",
          role: "writer",
          title: "Update docs",
          instructions: "Update docs.",
          acceptanceCriteria: ["Docs are updated."],
          riskLevel: "low",
          required: true,
          execution: {
            mode: "primary_run",
            expectedAdapter: "fake",
            worktreePolicy: "isolated"
          }
        }
      ],
      edges: [
        ...planGraph().edges,
        { from: "plan_node_implement", to: "plan_node_docs", type: "parallel" }
      ]
    }));
    await repos.taskRunRepository.create(taskRun());
    await repos.runMetadataRepository.save({
      runId: "run_1",
      planBinding: {
        planGraphId: "plan_graph_1",
        planGraphVersion: 1,
        planNodeId: "plan_node_implement",
        allowedNextPlanNodeIds: []
      }
    });
    await repos.traceLinkRepository.createNode({
      id: "trace_role_call_unplanned",
      planGraphId: "plan_graph_1",
      kind: "role_call",
      title: "@reviewer inspect result",
      status: "queued",
      role: "reviewer",
      sourceType: "role_call",
      sourceId: "role_call_1",
      createdAt
    });

    const trace = await buildExecutionTraceGraph(repos, {
      planGraphId: "plan_graph_1",
      now: createdAt
    });

    expect(trace.deviations).toEqual([
      expect.objectContaining({
        type: "unplanned_role_call",
        traceNodeId: "trace_role_call_unplanned"
      })
    ]);
  });

  it("falls back to a legacy trace for tasks without PlanGraph evidence", async () => {
    const repos = repositories();
    await repos.taskRunRepository.create(taskRun());

    const trace = await buildExecutionTraceGraph(repos, {
      taskId: "task_1",
      now: createdAt
    });

    expect(trace).toEqual(
      expect.objectContaining({
        taskId: "task_1",
        planGraphId: "legacy:task_1",
        planGraphVersion: 1,
        baseNodes: [
          expect.objectContaining({
            id: "legacy:task_1:legacy",
            execution: { mode: "non_executable" }
          })
        ],
        dynamicNodes: [
          expect.objectContaining({
            kind: "task_run",
            sourceId: "run_1"
          })
        ]
      })
    );
  });

  it("falls back to a legacy trace for runs without PlanGraph bindings", async () => {
    const repos = repositories();
    await repos.taskRunRepository.create(taskRun());

    const trace = await buildExecutionTraceGraph(repos, {
      runId: "run_1",
      now: createdAt
    });

    expect(trace).toEqual(expect.objectContaining({
      taskId: "task_1",
      planGraphId: "legacy:task_1",
      dynamicNodes: [
        expect.objectContaining({
          kind: "task_run",
          sourceId: "run_1"
        })
      ]
    }));
  });
});
