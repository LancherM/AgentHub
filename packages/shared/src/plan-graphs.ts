export const planGraphStatuses = ["active", "superseded", "failed"] as const;
export type PlanGraphStatus = (typeof planGraphStatuses)[number];

export const planNodeKinds = [
  "planner",
  "intake",
  "plan",
  "research",
  "implement",
  "documentation",
  "verify",
  "review",
  "memory",
  "handoff"
] as const;
export type PlanNodeKind = (typeof planNodeKinds)[number];

export const planNodeRiskLevels = ["low", "medium", "high"] as const;
export type PlanNodeRiskLevel = (typeof planNodeRiskLevels)[number];

export const planNodeExecutionModes = [
  "primary_run",
  "system",
  "manual",
  "non_executable"
] as const;
export type PlanNodeExecutionMode = (typeof planNodeExecutionModes)[number];

export const planNodeWorktreePolicies = ["isolated"] as const;
export type PlanNodeWorktreePolicy = (typeof planNodeWorktreePolicies)[number];

export const planEdgeTypes = ["primary", "parallel", "optional", "fallback"] as const;
export type PlanEdgeType = (typeof planEdgeTypes)[number];

export interface PlanNodeExecution {
  mode: PlanNodeExecutionMode;
  expectedAdapter?: string;
  worktreePolicy?: PlanNodeWorktreePolicy;
}

export interface PlanNode {
  id: string;
  kind: PlanNodeKind;
  title: string;
  role: string;
  instructions: string;
  acceptanceCriteria: string[];
  riskLevel: PlanNodeRiskLevel;
  required: boolean;
  execution: PlanNodeExecution;
}

export interface PlannerNode extends PlanNode {
  kind: "planner";
  role: "planner";
  outputPlanGraphId: string;
}

export type AnyPlanNode = PlanNode | PlannerNode;

export interface PlanEdge {
  from: string;
  to: string;
  type: PlanEdgeType;
  label?: string;
}

export interface PlanGraph {
  id: string;
  taskId: string;
  taskBriefArtifactId?: string;
  version: number;
  status: PlanGraphStatus;
  plannerNodeId: string;
  createdByRole: "planner";
  createdAt: string;
  nodes: AnyPlanNode[];
  edges: PlanEdge[];
}

export const traceNodeKinds = [
  "plan_node",
  "task_run",
  "role_call",
  "role_call_tool_event",
  "verification",
  "risk",
  "diff",
  "artifact",
  "memory",
  "review",
  "deviation",
  "manual"
] as const;
export type TraceNodeKind = (typeof traceNodeKinds)[number];

export const traceNodeStatuses = [
  "planned",
  "queued",
  "running",
  "completed",
  "failed",
  "blocked",
  "skipped",
  "deviated",
  "unknown"
] as const;
export type TraceNodeStatus = (typeof traceNodeStatuses)[number];

export const traceEdgeTypes = ["plan", "runtime", "evidence", "deviation"] as const;
export type TraceEdgeType = (typeof traceEdgeTypes)[number];

export const traceEvidenceSourceTypes = [
  "task_run",
  "run_event",
  "run_artifact",
  "role_call",
  "role_call_event",
  "role_todo",
  "verification",
  "risk",
  "diff",
  "memory_proposal",
  "review_decision"
] as const;
export type TraceEvidenceSourceType = (typeof traceEvidenceSourceTypes)[number];

export const deviationTypes = [
  "unplanned_role_call",
  "skipped_required_node",
  "failed_required_node",
  "blocked_manual_node",
  "missing_verification",
  "superseded_plan_version",
  "different_active_node"
] as const;
export type DeviationType = (typeof deviationTypes)[number];

export interface TraceNode {
  id: string;
  planGraphId: string;
  kind: TraceNodeKind;
  title: string;
  status: TraceNodeStatus;
  sourcePlanNodeId?: string;
  role?: string;
  sourceType?: TraceEvidenceSourceType;
  sourceId?: string;
  createdAt?: string;
}

export interface TraceEdge {
  id: string;
  from: string;
  to: string;
  type: TraceEdgeType;
  label?: string;
}

export interface TraceEvidence {
  id: string;
  planGraphId: string;
  sourceType: TraceEvidenceSourceType;
  sourceId: string;
  planNodeId?: string;
  traceNodeId?: string;
  summary?: string;
  createdAt?: string;
}

export interface Deviation {
  id: string;
  planGraphId: string;
  type: DeviationType;
  severity: PlanNodeRiskLevel;
  description: string;
  planNodeId?: string;
  traceNodeId?: string;
  evidenceId?: string;
  createdAt: string;
}

export interface ExecutionTraceGraph {
  taskId: string;
  planGraphId: string;
  planGraphVersion: number;
  baseNodes: AnyPlanNode[];
  baseEdges: PlanEdge[];
  dynamicNodes: TraceNode[];
  dynamicEdges: TraceEdge[];
  evidence: TraceEvidence[];
  deviations: Deviation[];
}

export function planGraphIdForTaskVersion(taskId: string, version: number): string {
  return `plan_graph:${taskId}:v${version}`;
}

export function plannerNodeIdForPlanGraph(planGraphId: string): string {
  return `${planGraphId}:planner`;
}

export function planNodeIdForPlanGraph(
  planGraphId: string,
  kind: PlanNodeKind,
  index: number
): string {
  return `${planGraphId}:${kind}:${index}`;
}
