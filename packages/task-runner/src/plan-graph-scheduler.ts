import type {
  AnyPlanNode,
  PlanGraph,
  RunMetadataRepository,
  TaskRun,
  TaskRunRepository
} from "@agent-hub/core";

export interface PlanGraphSchedulerRepositories {
  taskRunRepository: TaskRunRepository;
  runMetadataRepository: RunMetadataRepository;
}

export interface EvaluatePlanGraphScheduleInput {
  graph: PlanGraph;
  rerunPlanNodeIds?: readonly string[];
}

export type PlanGraphNodeScheduleStatus =
  | "successful"
  | "failed"
  | "running"
  | "blocked"
  | "pending";

export interface PlanGraphNodeScheduleState {
  nodeId: string;
  status: PlanGraphNodeScheduleStatus;
  runIds: string[];
  reason: string;
}

export interface RunnablePlanNode {
  node: AnyPlanNode;
  allowedNextPlanNodeIds: string[];
  previousRunIds: string[];
  rerun: boolean;
}

export interface PlanGraphScheduleEvaluation {
  planGraphId: string;
  runnable: RunnablePlanNode[];
  nodes: PlanGraphNodeScheduleState[];
}

interface BoundRunEvidence {
  run: TaskRun;
  planNodeId: string;
}

export async function evaluatePlanGraphSchedule(
  repositories: PlanGraphSchedulerRepositories,
  input: EvaluatePlanGraphScheduleInput
): Promise<PlanGraphScheduleEvaluation> {
  const rerunNodeIds = new Set(input.rerunPlanNodeIds ?? []);
  const boundRuns = await listBoundRuns(repositories, input.graph);
  const runsByNodeId = groupRunsByPlanNodeId(boundRuns);
  const states = new Map<string, PlanGraphNodeScheduleState>();
  for (const node of input.graph.nodes) {
    states.set(node.id, stateForNode(node, runsByNodeId.get(node.id) ?? []));
  }

  const runnable: RunnablePlanNode[] = [];
  for (const node of input.graph.nodes) {
    if (node.execution.mode !== "primary_run") {
      continue;
    }
    const state = states.get(node.id);
    const rerun = rerunNodeIds.has(node.id);
    if (!rerun && (state?.status === "successful" || state?.status === "failed")) {
      continue;
    }
    if (state?.status === "running") {
      continue;
    }
    if (!dependenciesSatisfied(input.graph, node, states)) {
      continue;
    }
    runnable.push({
      node,
      allowedNextPlanNodeIds: allowedNextPlanNodeIds(input.graph, node.id),
      previousRunIds: state?.runIds ?? [],
      rerun
    });
  }

  return {
    planGraphId: input.graph.id,
    runnable,
    nodes: input.graph.nodes.map((node) => states.get(node.id) as PlanGraphNodeScheduleState)
  };
}

function stateForNode(
  node: AnyPlanNode,
  runs: readonly TaskRun[]
): PlanGraphNodeScheduleState {
  if (node.execution.mode === "system" || node.execution.mode === "non_executable") {
    return {
      nodeId: node.id,
      status: "successful",
      runIds: [],
      reason: `${node.execution.mode} nodes are satisfied by local graph evidence.`
    };
  }
  if (node.execution.mode === "manual") {
    return {
      nodeId: node.id,
      status: "blocked",
      runIds: [],
      reason: "Manual node requires explicit user action before downstream scheduling."
    };
  }
  const runIds = runs.map((run) => run.id);
  if (runs.some((run) => run.status === "queued" || run.status === "running")) {
    return {
      nodeId: node.id,
      status: "running",
      runIds,
      reason: "A TaskRun is already queued or running for this plan node."
    };
  }
  if (runs.some((run) => run.status === "succeeded")) {
    return {
      nodeId: node.id,
      status: "successful",
      runIds,
      reason: "This plan node already has successful terminal TaskRun evidence."
    };
  }
  if (runs.some((run) => run.status === "failed" || run.status === "cancelled")) {
    return {
      nodeId: node.id,
      status: "failed",
      runIds,
      reason: "This plan node has failed or cancelled terminal TaskRun evidence."
    };
  }
  return {
    nodeId: node.id,
    status: "pending",
    runIds,
    reason: "No TaskRun evidence is recorded for this plan node."
  };
}

async function listBoundRuns(
  repositories: PlanGraphSchedulerRepositories,
  graph: PlanGraph
): Promise<BoundRunEvidence[]> {
  const runs = await repositories.taskRunRepository.listByTaskId(graph.taskId);
  const boundRuns: BoundRunEvidence[] = [];
  for (const run of runs) {
    const metadata = await repositories.runMetadataRepository.get(run.id);
    const binding = metadata?.planBinding;
    if (!binding || binding.planGraphId !== graph.id) {
      continue;
    }
    boundRuns.push({ run, planNodeId: binding.planNodeId });
  }
  return boundRuns;
}

function groupRunsByPlanNodeId(
  boundRuns: readonly BoundRunEvidence[]
): Map<string, TaskRun[]> {
  const byNodeId = new Map<string, TaskRun[]>();
  for (const item of boundRuns) {
    byNodeId.set(item.planNodeId, [
      ...(byNodeId.get(item.planNodeId) ?? []),
      item.run
    ]);
  }
  return byNodeId;
}

function dependenciesSatisfied(
  graph: PlanGraph,
  node: AnyPlanNode,
  states: ReadonlyMap<string, PlanGraphNodeScheduleState>
): boolean {
  const incomingEdges = graph.edges.filter((edge) => edge.to === node.id);
  if (incomingEdges.length === 0) {
    return true;
  }
  const nodesById = new Map(graph.nodes.map((candidate) => [candidate.id, candidate]));
  return incomingEdges.every((edge) => {
    const sourceNode = nodesById.get(edge.from);
    if (!sourceNode) {
      return false;
    }
    const sourceState = states.get(sourceNode.id);
    if (edge.type === "optional") {
      return true;
    }
    if (edge.type === "fallback") {
      return sourceState?.status === "failed" || sourceState?.status === "blocked";
    }
    if (!sourceNode.required) {
      return true;
    }
    if (sourceNode.execution.mode === "manual") {
      return !node.required;
    }
    return sourceState?.status === "successful";
  });
}

function allowedNextPlanNodeIds(graph: PlanGraph, nodeId: string): string[] {
  return graph.edges
    .filter((edge) => edge.from === nodeId)
    .map((edge) => edge.to);
}
