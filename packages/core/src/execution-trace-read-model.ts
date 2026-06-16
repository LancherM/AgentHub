import {
  nowIso,
  validateExecutionTraceGraph,
  type Deviation,
  type ExecutionTraceGraph,
  type PlanGraph,
  type RoleCallToolEvent,
  type TaskRun,
  type TraceEdge,
  type TraceEvidence,
  type TraceNode
} from "./domain";
import type {
  PlanGraphRepository,
  RoleCallRepository,
  RunMetadataRepository,
  TaskRunRepository,
  TraceLinkRepository
} from "./storage";

export interface ExecutionTraceReadModelRepositories {
  planGraphRepository: PlanGraphRepository;
  traceLinkRepository: TraceLinkRepository;
  taskRunRepository: TaskRunRepository;
  runMetadataRepository: RunMetadataRepository;
  roleCallRepository?: RoleCallRepository;
}

export interface BuildExecutionTraceGraphInput {
  taskId?: string;
  planGraphId?: string;
  runId?: string;
  now?: string;
}

export interface ResolvedExecutionTraceGraphRoot {
  taskId: string;
  graph?: PlanGraph;
}

export async function buildExecutionTraceGraph(
  repositories: ExecutionTraceReadModelRepositories,
  input: BuildExecutionTraceGraphInput
): Promise<ExecutionTraceGraph> {
  const root = await resolveExecutionTraceGraphRoot(repositories, input);
  const graph = root.graph;

  if (!graph) {
    return buildLegacyExecutionTraceGraph(repositories, {
      taskId: root.taskId,
      now: input.now ?? nowIso()
    });
  }

  const traceRows = await repositories.traceLinkRepository.listByPlanGraphId(graph.id);
  const dynamicNodes = new Map(traceRows.nodes.map((node) => [node.id, node]));
  const dynamicEdges = new Map(traceRows.edges.map((edge) => [edge.id, edge]));
  const evidence = new Map(traceRows.evidence.map((link) => [link.id, link]));
  const baseNodeIds = new Set(graph.nodes.map((node) => node.id));

  await addPrimaryRunTraceNodes(repositories, graph, {
    dynamicNodes,
    dynamicEdges,
    evidence
  });
  addRoleCallToolEventNodes(traceRows.roleCallToolEvents, baseNodeIds, {
    dynamicNodes,
    dynamicEdges
  });

  const deviations = buildDeviations(
    graph,
    [...dynamicNodes.values()],
    [...evidence.values()],
    input.now ?? nowIso()
  );
  return validateExecutionTraceGraph({
    taskId: graph.taskId,
    planGraphId: graph.id,
    planGraphVersion: graph.version,
    baseNodes: graph.nodes,
    baseEdges: graph.edges,
    dynamicNodes: sortTraceNodes([...dynamicNodes.values()]),
    dynamicEdges: sortTraceEdges([...dynamicEdges.values()]),
    evidence: sortTraceEvidence([...evidence.values()]),
    deviations
  });
}

export async function resolveExecutionTraceGraphRoot(
  repositories: ExecutionTraceReadModelRepositories,
  input: BuildExecutionTraceGraphInput
): Promise<ResolvedExecutionTraceGraphRoot> {
  if (!input.taskId && !input.planGraphId && !input.runId) {
    throw new Error("taskId, planGraphId, or runId is required");
  }
  if (input.planGraphId) {
    const graph = await requirePlanGraph(
      repositories.planGraphRepository,
      input.planGraphId
    );
    return { taskId: graph.taskId, graph };
  }
  if (input.runId) {
    const run = await repositories.taskRunRepository.get(input.runId);
    if (!run) {
      throw new Error(`task run ${input.runId} not found`);
    }
    if (input.taskId && input.taskId !== run.taskId) {
      throw new Error(`task run ${input.runId} does not belong to task ${input.taskId}`);
    }
    const metadata = await repositories.runMetadataRepository.get(input.runId);
    if (metadata?.planBinding) {
      const graph = await requirePlanGraph(
        repositories.planGraphRepository,
        metadata.planBinding.planGraphId
      );
      if (graph.taskId !== run.taskId) {
        throw new Error(
          `task run ${input.runId} is bound to plan graph ${graph.id} from task ${graph.taskId}`
        );
      }
      return { taskId: run.taskId, graph };
    }
    return {
      taskId: run.taskId,
      graph: await repositories.planGraphRepository.getActiveByTaskId(run.taskId)
    };
  }
  const taskId = input.taskId as string;
  return {
    taskId,
    graph: await repositories.planGraphRepository.getActiveByTaskId(taskId)
  };
}

async function requirePlanGraph(
  repository: PlanGraphRepository,
  planGraphId: string
): Promise<PlanGraph> {
  const graph = await repository.get(planGraphId);
  if (!graph) {
    throw new Error(`plan graph ${planGraphId} not found`);
  }
  return graph;
}

async function buildLegacyExecutionTraceGraph(
  repositories: ExecutionTraceReadModelRepositories,
  input: { taskId: string; now: string }
): Promise<ExecutionTraceGraph> {
  const runs = await repositories.taskRunRepository.listByTaskId(input.taskId);
  const planGraphId = `legacy:${input.taskId}`;
  const dynamicNodes = runs.map((run) => taskRunTraceNode({
    run,
    planGraphId,
    planNodeId: undefined
  }));
  const evidence = runs.map((run) => taskRunEvidence({
    run,
    planGraphId,
    planNodeId: undefined,
    traceNodeId: traceNodeIdForRun(run.id)
  }));
  return validateExecutionTraceGraph({
    taskId: input.taskId,
    planGraphId,
    planGraphVersion: 1,
    baseNodes: [
      {
        id: `${planGraphId}:legacy`,
        kind: "handoff",
        role: "legacy",
        title: "Legacy execution evidence",
        instructions: "No PlanGraph was recorded for this task.",
        acceptanceCriteria: ["Existing local run evidence remains inspectable."],
        riskLevel: "low",
        required: false,
        execution: { mode: "non_executable" }
      }
    ],
    baseEdges: [],
    dynamicNodes: sortTraceNodes(dynamicNodes),
    dynamicEdges: [],
    evidence: sortTraceEvidence(evidence),
    deviations: []
  });
}

async function addPrimaryRunTraceNodes(
  repositories: ExecutionTraceReadModelRepositories,
  graph: PlanGraph,
  target: {
    dynamicNodes: Map<string, TraceNode>;
    dynamicEdges: Map<string, TraceEdge>;
    evidence: Map<string, TraceEvidence>;
  }
): Promise<void> {
  const runs = await repositories.taskRunRepository.listByTaskId(graph.taskId);
  const existingRunSourceIds = new Set(
    [...target.dynamicNodes.values()]
      .filter((node) => node.sourceType === "task_run" && node.sourceId)
      .map((node) => node.sourceId as string)
  );
  for (const run of runs) {
    const metadata = await repositories.runMetadataRepository.get(run.id);
    const binding = metadata?.planBinding;
    if (!binding || binding.planGraphId !== graph.id) {
      continue;
    }
    if (existingRunSourceIds.has(run.id)) {
      continue;
    }
    const traceNodeId = traceNodeIdForRun(run.id);
    target.dynamicNodes.set(traceNodeId, taskRunTraceNode({
      run,
      planGraphId: graph.id,
      planNodeId: binding.planNodeId
    }));
    target.dynamicEdges.set(`trace_edge:run:${run.id}`, {
      id: `trace_edge:run:${run.id}`,
      planGraphId: graph.id,
      from: binding.planNodeId,
      to: traceNodeId,
      type: "runtime",
      label: `TaskRun ${run.status}`
    });
    target.evidence.set(`trace_evidence:run:${run.id}`, taskRunEvidence({
      run,
      planGraphId: graph.id,
      planNodeId: binding.planNodeId,
      traceNodeId
    }));
    if (metadata.verification) {
      target.evidence.set(`trace_evidence:verification:${run.id}`, {
        id: `trace_evidence:verification:${run.id}`,
        planGraphId: graph.id,
        sourceType: "verification",
        sourceId: run.id,
        planNodeId: binding.planNodeId,
        traceNodeId,
        summary: `Verification ${metadata.verification.status}: ${metadata.verification.summary}`,
        createdAt: run.updatedAt
      });
    }
    if (metadata.riskReport) {
      target.evidence.set(`trace_evidence:risk:${metadata.riskReport.id}`, {
        id: `trace_evidence:risk:${metadata.riskReport.id}`,
        planGraphId: graph.id,
        sourceType: "risk",
        sourceId: metadata.riskReport.id,
        planNodeId: binding.planNodeId,
        traceNodeId,
        summary: `Risk ${metadata.riskReport.level}: ${metadata.riskReport.summary}`,
        createdAt: metadata.riskReport.createdAt
      });
    }
    if (metadata.diff) {
      target.evidence.set(`trace_evidence:diff:${run.id}`, {
        id: `trace_evidence:diff:${run.id}`,
        planGraphId: graph.id,
        sourceType: "diff",
        sourceId: run.id,
        planNodeId: binding.planNodeId,
        traceNodeId,
        summary: metadata.diff.isClean
          ? "Diff clean"
          : `Diff changed ${metadata.diff.changedFiles.length} file(s)`,
        createdAt: run.updatedAt
      });
    }
  }
}

function addRoleCallToolEventNodes(
  events: readonly RoleCallToolEvent[],
  baseNodeIds: Set<string>,
  target: {
    dynamicNodes: Map<string, TraceNode>;
    dynamicEdges: Map<string, TraceEdge>;
  }
): void {
  for (const event of events) {
    if (!baseNodeIds.has(event.sourcePlanNodeId)) {
      continue;
    }
    const eventNodeId = traceNodeIdForRoleCallToolEvent(event.id);
    target.dynamicNodes.set(eventNodeId, {
      id: eventNodeId,
      planGraphId: event.planGraphId,
      kind: "role_call_tool_event",
      title: `RoleCall tool event to @${event.targetRole}`,
      status: traceNodeStatusForRoleCallToolEvent(event.status),
      sourcePlanNodeId: event.sourcePlanNodeId,
      role: event.targetRole,
      sourceId: event.id,
      createdAt: event.createdAt
    });
    target.dynamicEdges.set(`trace_edge:role_call_tool_event:${event.id}`, {
      id: `trace_edge:role_call_tool_event:${event.id}`,
      planGraphId: event.planGraphId,
      from: event.sourcePlanNodeId,
      to: eventNodeId,
      type: "runtime",
      label: event.status
    });
    for (const traceNodeId of event.createdTraceNodeIds) {
      if (!target.dynamicNodes.has(traceNodeId)) {
        continue;
      }
      target.dynamicEdges.set(
        `trace_edge:role_call_tool_event:${event.id}:${traceNodeId}`,
        {
          id: `trace_edge:role_call_tool_event:${event.id}:${traceNodeId}`,
          planGraphId: event.planGraphId,
          from: eventNodeId,
          to: traceNodeId,
          type: "runtime",
          label: "created"
        }
      );
    }
  }
}

function buildDeviations(
  graph: PlanGraph,
  dynamicNodes: readonly TraceNode[],
  evidence: readonly TraceEvidence[],
  now: string
): Deviation[] {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const deviations: Deviation[] = [];
  if (graph.status === "superseded") {
    deviations.push({
      id: `deviation:${graph.id}:superseded`,
      planGraphId: graph.id,
      type: "superseded_plan_version",
      severity: "low",
      description: `PlanGraph ${graph.id} has been superseded.`,
      createdAt: now
    });
  }
  const taskRunPlanNodeIds = new Set(
    dynamicNodes
      .filter((node) => node.kind === "task_run" && node.sourcePlanNodeId)
      .map((node) => node.sourcePlanNodeId as string)
  );
  if (taskRunPlanNodeIds.size > 0) {
    for (const node of graph.nodes) {
      if (
        node.required &&
        node.execution.mode === "primary_run" &&
        !taskRunPlanNodeIds.has(node.id)
      ) {
        deviations.push({
          id: `deviation:${graph.id}:skipped_required:${node.id}`,
          planGraphId: graph.id,
          type: "skipped_required_node",
          severity: node.riskLevel,
          description: `Required primary_run plan node ${node.id} has no linked TaskRun evidence.`,
          planNodeId: node.id,
          createdAt: now
        });
      }
    }
  }
  for (const node of dynamicNodes) {
    if (node.kind === "role_call" && !node.sourcePlanNodeId) {
      deviations.push({
        id: `deviation:${graph.id}:unplanned_role_call:${node.id}`,
        planGraphId: graph.id,
        type: "unplanned_role_call",
        severity: "medium",
        description: `RoleCall trace node ${node.id} is not linked to a source PlanNode.`,
        traceNodeId: node.id,
        createdAt: now
      });
    }
    if (
      node.kind !== "task_run" ||
      (node.status !== "failed" && node.status !== "blocked") ||
      !node.sourcePlanNodeId
    ) {
      continue;
    }
    const planNode = nodesById.get(node.sourcePlanNodeId);
    if (!planNode?.required) {
      continue;
    }
    deviations.push({
      id: `deviation:${graph.id}:failed_required:${node.id}`,
      planGraphId: graph.id,
      type: "failed_required_node",
      severity: planNode.riskLevel,
      description: `Required plan node ${planNode.id} has ${node.status} runtime evidence.`,
      planNodeId: planNode.id,
      traceNodeId: node.id,
      createdAt: now
    });
  }
  for (const item of evidence) {
    if (
      item.sourceType !== "verification" ||
      !item.planNodeId ||
      !isMissingVerificationEvidence(item)
    ) {
      continue;
    }
    const planNode = nodesById.get(item.planNodeId);
    deviations.push({
      id: `deviation:${graph.id}:missing_verification:${item.id}`,
      planGraphId: graph.id,
      type: "missing_verification",
      severity: planNode?.riskLevel ?? "medium",
      description: item.summary ?? `Verification evidence is missing for ${item.planNodeId}.`,
      planNodeId: item.planNodeId,
      traceNodeId: item.traceNodeId,
      evidenceId: item.id,
      createdAt: now
    });
  }
  return deviations.sort((left, right) => left.id.localeCompare(right.id));
}

function isMissingVerificationEvidence(evidence: TraceEvidence): boolean {
  const summary = evidence.summary?.toLowerCase() ?? "";
  return summary.includes("skipped") || summary.includes("not configured");
}

function taskRunTraceNode(input: {
  run: TaskRun;
  planGraphId: string;
  planNodeId?: string;
}): TraceNode {
  return {
    id: traceNodeIdForRun(input.run.id),
    planGraphId: input.planGraphId,
    kind: "task_run",
    title: `TaskRun ${input.run.id}`,
    status: traceNodeStatusForRun(input.run.status),
    ...(input.planNodeId ? { sourcePlanNodeId: input.planNodeId } : {}),
    sourceType: "task_run",
    sourceId: input.run.id,
    createdAt: input.run.createdAt
  };
}

function taskRunEvidence(input: {
  run: TaskRun;
  planGraphId: string;
  planNodeId?: string;
  traceNodeId: string;
}): TraceEvidence {
  return {
    id: `trace_evidence:run:${input.run.id}`,
    planGraphId: input.planGraphId,
    sourceType: "task_run",
    sourceId: input.run.id,
    ...(input.planNodeId ? { planNodeId: input.planNodeId } : {}),
    traceNodeId: input.traceNodeId,
    summary: `TaskRun ${input.run.id} ${input.run.status}`,
    createdAt: input.run.updatedAt
  };
}

function traceNodeIdForRun(runId: string): string {
  return `trace_node:run:${runId}`;
}

function traceNodeIdForRoleCallToolEvent(eventId: string): string {
  return `trace_node:role_call_tool_event:${eventId}`;
}

function traceNodeStatusForRun(status: TaskRun["status"]): TraceNode["status"] {
  if (status === "succeeded") {
    return "completed";
  }
  if (status === "failed") {
    return "failed";
  }
  if (status === "cancelled") {
    return "blocked";
  }
  return status;
}

function traceNodeStatusForRoleCallToolEvent(
  status: RoleCallToolEvent["status"]
): TraceNode["status"] {
  if (status === "accepted" || status === "completed") {
    return "completed";
  }
  if (status === "rejected") {
    return "skipped";
  }
  if (status === "failed") {
    return "failed";
  }
  return "queued";
}

function sortTraceNodes(nodes: TraceNode[]): TraceNode[] {
  return nodes.sort((left, right) =>
    (left.createdAt ?? "").localeCompare(right.createdAt ?? "") ||
    left.id.localeCompare(right.id)
  );
}

function sortTraceEdges(edges: TraceEdge[]): TraceEdge[] {
  return edges.sort((left, right) => left.id.localeCompare(right.id));
}

function sortTraceEvidence(evidence: TraceEvidence[]): TraceEvidence[] {
  return evidence.sort((left, right) =>
    (left.createdAt ?? "").localeCompare(right.createdAt ?? "") ||
    left.id.localeCompare(right.id)
  );
}
