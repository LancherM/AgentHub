import type {
  AnyPlanNode,
  ExecutionTraceGraph,
  PlanEdge,
  TraceEdge,
  TraceNode
} from "@agent-hub/core";
import { compactId, truncateText } from "./format.mjs";

export type GraphWorkbenchMode = "overlay" | "plan" | "trace";
export type GraphLayoutMode = "ranked";
export type GraphLabelMode = "compact" | "full";
export type GraphFoldMode = "expanded" | "grouped";
export type GraphZoomMode = "fit" | "detail";

export interface GraphWorkbenchOptions {
  mode: GraphWorkbenchMode;
  columns: number;
  selectedIndex: number;
  layout: GraphLayoutMode;
  labels: GraphLabelMode;
  fold: GraphFoldMode;
  zoom: GraphZoomMode;
}

export interface GraphWorkbenchRender {
  title: string;
  toolbar: string;
  rows: GraphWorkbenchRow[];
  narrow: boolean;
  legend: string[];
  miniMap: string;
  itemCount: number;
}

export interface GraphWorkbenchRow {
  text: string;
  selected?: boolean;
  tone?: "success" | "warning" | "danger" | "info" | "muted";
}

interface LayoutNode {
  id: string;
  source: "plan" | "trace";
  title: string;
  subtitle: string;
  status: string;
  risk?: string;
  required?: boolean;
  group?: string;
}

interface LayoutEdge {
  from: string;
  to: string;
  type: string;
  label?: string;
}

const narrowColumnThreshold = 92;
const compactNodeWidth = 31;
const detailNodeWidth = 39;

export function renderGraphWorkbench(
  trace: ExecutionTraceGraph,
  options: GraphWorkbenchOptions
): GraphWorkbenchRender {
  const graph = workbenchGraph(trace, options.mode, options.fold);
  const selectedIndex = clampIndex(options.selectedIndex, graph.nodes.length);
  const selectedId = graph.nodes[selectedIndex]?.id;
  const narrow = options.columns < narrowColumnThreshold;
  const rows = narrow
    ? narrowRows(graph.nodes, graph.edges, selectedId, options.columns, options.labels)
    : dagRows(graph.nodes, graph.edges, selectedId, options);
  const miniMap = graph.nodes.length === 0
    ? "mini-map empty"
    : `mini-map ${selectedIndex + 1}/${graph.nodes.length} ${graph.nodes.map((node) => statusGlyph(node.status)).join("")}`;
  return {
    title: "Graph - Workflow DAG",
    toolbar: toolbarText(trace, options, graph.nodes.length, narrow),
    rows,
    narrow,
    legend: [
      "legend: [P] plan  [T] trace  ! deviation  * selected",
      "edges: --> primary  ==> parallel  -?> optional  -!> fallback  ..> evidence"
    ],
    miniMap,
    itemCount: graph.nodes.length
  };
}

function workbenchGraph(
  trace: ExecutionTraceGraph,
  mode: GraphWorkbenchMode,
  fold: GraphFoldMode
): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
  const planNodes = mode === "trace"
    ? []
    : trace.baseNodes.map((node) => layoutPlanNode(node));
  const traceNodes = mode === "plan"
    ? []
    : trace.dynamicNodes.map((node) => layoutTraceNode(node, fold));
  const visibleIds = new Set([...planNodes, ...traceNodes].map((node) => node.id));
  const edges = [
    ...(mode === "trace" ? [] : trace.baseEdges.map((edge) => layoutPlanEdge(edge))),
    ...(mode === "plan" ? [] : trace.dynamicEdges.map((edge) => layoutTraceEdge(edge))),
    ...(mode === "overlay" ? runtimeBindingEdges(trace) : [])
  ].filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to));
  return {
    nodes: [...planNodes, ...traceNodes],
    edges
  };
}

function layoutPlanNode(node: AnyPlanNode): LayoutNode {
  return {
    id: node.id,
    source: "plan",
    title: node.title,
    subtitle: `${node.kind} @${node.role} ${node.execution.mode}`,
    status: node.execution.mode,
    risk: node.riskLevel,
    required: node.required
  };
}

function layoutTraceNode(node: TraceNode, fold: GraphFoldMode): LayoutNode {
  const group = node.sourceType === "role_call" || node.sourceType === "role_call_event"
    ? "RoleCall branch"
    : node.sourceType === "comparison_report"
      ? "Comparison branch"
      : undefined;
  return {
    id: node.id,
    source: "trace",
    title: node.title,
    subtitle: `${node.kind} ${node.sourceType ?? "event"}:${compactId(node.sourceId ?? "none")}`,
    status: node.status,
    group: fold === "grouped" ? group : undefined
  };
}

function layoutPlanEdge(edge: PlanEdge): LayoutEdge {
  return {
    from: edge.from,
    to: edge.to,
    type: edge.type,
    label: edge.label
  };
}

function layoutTraceEdge(edge: TraceEdge): LayoutEdge {
  return {
    from: edge.from,
    to: edge.to,
    type: edge.type,
    label: edge.label
  };
}

function runtimeBindingEdges(trace: ExecutionTraceGraph): LayoutEdge[] {
  return trace.dynamicNodes
    .filter((node) => node.sourcePlanNodeId)
    .map((node) => ({
      from: node.sourcePlanNodeId ?? "",
      to: node.id,
      type: "runtime",
      label: node.kind
    }));
}

function dagRows(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  selectedId: string | undefined,
  options: GraphWorkbenchOptions
): GraphWorkbenchRow[] {
  if (nodes.length === 0) {
    return [{ text: "no graph nodes available", tone: "muted" }];
  }
  const rows: GraphWorkbenchRow[] = [];
  const edgeByFrom = groupEdgesByFrom(edges);
  const nodeWidth = options.zoom === "detail" ? detailNodeWidth : compactNodeWidth;
  let currentGroup: string | undefined;
  for (const node of nodes) {
    if (node.group && node.group !== currentGroup) {
      currentGroup = node.group;
      rows.push({
        text: truncateText(`. . . ${node.group} . . .`, options.columns),
        tone: "info"
      });
    }
    const selected = node.id === selectedId;
    rows.push({
      text: nodeBoxLine(node, nodeWidth, selected, options.labels),
      selected,
      tone: nodeTone(node)
    });
    for (const edge of edgeByFrom.get(node.id) ?? []) {
      rows.push({
        text: truncateText(`  ${edgeGlyph(edge.type)} ${edge.label ?? edge.type} ${compactId(edge.to)}`, options.columns),
        tone: edge.type === "fallback" || edge.type === "deviation" ? "warning" : "muted"
      });
    }
  }
  return rows;
}

function narrowRows(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  selectedId: string | undefined,
  columns: number,
  labels: GraphLabelMode
): GraphWorkbenchRow[] {
  if (nodes.length === 0) {
    return [{ text: "no graph nodes available", tone: "muted" }];
  }
  const incoming = groupEdgesByTo(edges);
  return nodes.map((node) => {
    const selected = node.id === selectedId;
    const inbound = incoming.get(node.id)?.map((edge) => `${edgeGlyph(edge.type)}${compactId(edge.from)}`).join(" ") ?? "root";
    const title = labels === "full" ? node.title : truncateText(node.title, 24);
    return {
      text: truncateText(`${selected ? "*" : " "} ${nodeKindMarker(node)} ${statusGlyph(node.status)} ${compactId(node.id)} <= ${inbound} ${title}`, columns),
      selected,
      tone: nodeTone(node)
    };
  });
}

function nodeBoxLine(
  node: LayoutNode,
  width: number,
  selected: boolean,
  labels: GraphLabelMode
): string {
  const marker = selected ? "*" : " ";
  const titleWidth = Math.max(8, width - 10);
  const title = labels === "full"
    ? truncateText(node.title, titleWidth)
    : truncateText(compactId(node.id), titleWidth);
  const left = `${marker}${nodeKindMarker(node)} ${statusGlyph(node.status)} ${title}`;
  const right = node.source === "plan"
    ? `${node.required ? "req" : "opt"} ${node.risk ?? "risk"}`
    : node.status;
  return truncateText(`[${left.padEnd(Math.max(1, width - right.length - 3))} ${right}]`, width + 2);
}

function toolbarText(
  trace: ExecutionTraceGraph,
  options: GraphWorkbenchOptions,
  nodeCount: number,
  narrow: boolean
): string {
  return [
    `mode ${options.mode}`,
    `layout ${options.layout}`,
    `focus ${nodeCount === 0 ? 0 : options.selectedIndex + 1}/${nodeCount}`,
    `labels ${options.labels}`,
    `fold ${options.fold}`,
    `zoom ${options.zoom}`,
    narrow ? "compact" : "dag",
    `plan ${trace.baseNodes.length}`,
    `trace ${trace.dynamicNodes.length}`,
    `evidence ${trace.evidence.length}`,
    `deviations ${trace.deviations.length}`,
    "m mode l labels f fold Z zoom"
  ].join(" | ");
}

function groupEdgesByFrom(edges: LayoutEdge[]): Map<string, LayoutEdge[]> {
  const grouped = new Map<string, LayoutEdge[]>();
  for (const edge of edges) {
    const list = grouped.get(edge.from) ?? [];
    list.push(edge);
    grouped.set(edge.from, list);
  }
  return grouped;
}

function groupEdgesByTo(edges: LayoutEdge[]): Map<string, LayoutEdge[]> {
  const grouped = new Map<string, LayoutEdge[]>();
  for (const edge of edges) {
    const list = grouped.get(edge.to) ?? [];
    list.push(edge);
    grouped.set(edge.to, list);
  }
  return grouped;
}

function nodeKindMarker(node: LayoutNode): string {
  return node.source === "plan" ? "P" : "T";
}

function statusGlyph(status: string): string {
  if (status === "completed" || status === "succeeded" || status === "primary_run" || status === "system") {
    return "✓";
  }
  if (status === "running" || status === "queued") {
    return "…";
  }
  if (status === "failed" || status === "deviated") {
    return "!";
  }
  if (status === "blocked" || status === "manual") {
    return "■";
  }
  return "·";
}

function edgeGlyph(type: string): string {
  if (type === "parallel") {
    return "==>";
  }
  if (type === "optional") {
    return "-?>";
  }
  if (type === "fallback") {
    return "-!>";
  }
  if (type === "runtime" || type === "evidence") {
    return "..>";
  }
  if (type === "deviation") {
    return "!>";
  }
  return "-->";
}

function nodeTone(node: LayoutNode): GraphWorkbenchRow["tone"] {
  if (node.status === "failed" || node.status === "deviated" || node.risk === "high") {
    return "danger";
  }
  if (node.status === "blocked" || node.risk === "medium") {
    return "warning";
  }
  if (node.status === "completed" || node.status === "primary_run") {
    return "success";
  }
  if (node.group) {
    return "info";
  }
  return undefined;
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return Math.min(Math.max(index, 0), length - 1);
}
