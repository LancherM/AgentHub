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
export type GraphLabelMode = "auto" | "compact" | "full" | "off";
export type GraphFoldMode = "expanded" | "grouped";
export type GraphZoomMode = "67%" | "82%" | "100%";
type ResolvedGraphLabelMode = "compact" | "full" | "off";

export interface GraphWorkbenchOptions {
  mode: GraphWorkbenchMode;
  columns: number;
  selectedIndex: number;
  layout: GraphLayoutMode;
  labels: GraphLabelMode;
  fold: GraphFoldMode;
  zoom: GraphZoomMode;
  viewportRank?: number;
  focusedNodeId?: string;
  collapsedGroupIds?: string[];
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

export interface GraphLayoutAction {
  id: string;
  label: string;
  safe: boolean;
  command?: string;
}

export interface GraphLayoutAnchor {
  edgeId: string;
  nodeId: string;
  rank: number;
  lane: number;
  side: "left" | "right" | "top" | "bottom";
}

export interface GraphLayoutNode {
  id: string;
  source: "plan" | "trace";
  title: string;
  subtitle: string;
  status: string;
  risk?: string;
  required?: boolean;
  groupId?: string;
  groupLabel?: string;
  rank: number;
  lane: number;
  displayWidth: number;
  incomingAnchors: GraphLayoutAnchor[];
  outgoingAnchors: GraphLayoutAnchor[];
  selected: boolean;
  focused: boolean;
  viewportIncluded: boolean;
  actions: GraphLayoutAction[];
}

export interface GraphLayoutEdge {
  id: string;
  from: string;
  to: string;
  type: string;
  label?: string;
  fromRank: number;
  fromLane: number;
  toRank: number;
  toLane: number;
}

export interface GraphLayoutGroup {
  id: string;
  label: string;
  nodeIds: string[];
  collapsed: boolean;
  selectedDescendant: boolean;
  status: string;
  risk?: string;
}

export interface GraphLayoutViewport {
  columns: number;
  narrow: boolean;
  startRank: number;
  endRank: number;
  includedNodeIds: string[];
}

export interface GraphLayoutModel {
  mode: GraphWorkbenchMode;
  nodes: GraphLayoutNode[];
  edges: GraphLayoutEdge[];
  groups: GraphLayoutGroup[];
  viewport: GraphLayoutViewport;
  selectedIndex: number;
  selectedId?: string;
}

const narrowColumnThreshold = 92;
const spatialColumnThreshold = 120;
const spatialRankGapWidth = 3;
const compactNodeWidth = 31;
const detailNodeWidth = 39;

export function buildGraphLayout(
  trace: ExecutionTraceGraph,
  options: GraphWorkbenchOptions
): GraphLayoutModel {
  const graph = workbenchGraph(trace, options.mode, options.fold);
  const selectedIndex = clampIndex(options.selectedIndex, graph.nodes.length);
  const selectedId = graph.nodes[selectedIndex]?.id;
  const narrow = options.columns < narrowColumnThreshold;
  const nodeWidth = nodeWidthForZoom(options.zoom);
  const focusedId = options.focusedNodeId ?? selectedId;
  const collapsedGroupIds = new Set(options.collapsedGroupIds ?? []);
  const rankByNodeId = rankNodes(graph.nodes, graph.edges);
  const rankValues = [...new Set(graph.nodes.map((node) => rankByNodeId.get(node.id) ?? 0))].sort((a, b) => a - b);
  const viewportRanks = viewportRanksForColumns(rankValues, options.columns, options.viewportRank ?? 0);
  const rankedNodes = rankLayoutNodes(graph.nodes, graph.edges, nodeWidth, selectedId, focusedId, rankByNodeId, viewportRanks);
  const rankById = new Map(rankedNodes.map((node) => [node.id, node]));
  const rankedEdges = graph.edges
    .map((edge) => {
      const from = rankById.get(edge.from);
      const to = rankById.get(edge.to);
      if (!from || !to) {
        return undefined;
      }
      return {
        ...edge,
        fromRank: from.rank,
        fromLane: from.lane,
        toRank: to.rank,
        toLane: to.lane
      };
    })
    .filter((edge): edge is GraphLayoutEdge => Boolean(edge));
  const nodesWithAnchors = rankedNodes.map((node) => ({
    ...node,
    incomingAnchors: rankedEdges
      .filter((edge) => edge.to === node.id)
      .map((edge) => ({
        edgeId: edge.id,
        nodeId: edge.from,
        rank: edge.fromRank,
        lane: edge.fromLane,
        side: "left" as const
      })),
    outgoingAnchors: rankedEdges
      .filter((edge) => edge.from === node.id)
      .map((edge) => ({
        edgeId: edge.id,
        nodeId: edge.to,
        rank: edge.toRank,
        lane: edge.toLane,
        side: "right" as const
      }))
  }));
  const maxRank = rankValues.reduce((max, rank) => Math.max(max, rank), 0);
  const viewportStartRank = viewportRanks[0] ?? 0;
  const viewportEndRank = viewportRanks[viewportRanks.length - 1] ?? maxRank;
  return {
    mode: options.mode,
    nodes: nodesWithAnchors,
    edges: rankedEdges,
    groups: layoutGroups(nodesWithAnchors, collapsedGroupIds),
    viewport: {
      columns: options.columns,
      narrow,
      startRank: viewportStartRank,
      endRank: viewportEndRank,
      includedNodeIds: nodesWithAnchors.filter((node) => node.viewportIncluded).map((node) => node.id)
    },
    selectedIndex,
    selectedId
  };
}

export function renderGraphWorkbench(
  trace: ExecutionTraceGraph,
  options: GraphWorkbenchOptions
): GraphWorkbenchRender {
  const layout = buildGraphLayout(trace, options);
  const selectedNode = layout.nodes.find((node) => node.id === layout.selectedId);
  const rows = layout.viewport.narrow
    ? narrowGraphRows(layout, options.columns, options.labels)
    : dagRows(layout, options);
  const miniMap = structuralMiniMap(layout, options);
  return {
    title: "Graph - Workflow DAG",
    toolbar: toolbarText(trace, options, layout.nodes.length, layout.viewport.narrow, selectedNode),
    rows,
    narrow: layout.viewport.narrow,
    legend: [
      "legend: [P] plan  [T] trace  ! deviation  * selected",
      "flow: primary ↓ next step; branch → target; compact uses --> ==> -?> -!> ..>"
    ],
    miniMap,
    itemCount: layout.nodes.length
  };
}

function structuralMiniMap(
  layout: GraphLayoutModel,
  options: GraphWorkbenchOptions
): string {
  if (layout.nodes.length === 0) {
    return "mini-map empty";
  }
  const ranks = [...new Set(layout.nodes.map((node) => node.rank))].sort((a, b) => a - b);
  const maxRank = ranks[ranks.length - 1] ?? 0;
  const selectedRank = layout.nodes.find((node) => node.selected)?.rank;
  const viewportRankSet = new Set(
    layout.nodes.filter((node) => node.viewportIncluded).map((node) => node.rank)
  );
  const viewport = ranks.map((rank) => {
    if (rank === selectedRank) {
      return "*";
    }
    return viewportRankSet.has(rank) ? "#" : ".";
  }).join("");
  const occupancy = ranks.map((rank) => rankMiniMapCell(layout.nodes.filter((node) => node.rank === rank))).join("-");
  const compact = `mini-map z${options.zoom} vp[${viewport}] ${occupancy}`;
  const full = `mini-map z${options.zoom} r${layout.viewport.startRank}-${layout.viewport.endRank}/${maxRank} vp[${viewport}] lanes ${occupancy}`;
  return truncateText(options.columns < 72 ? compact : full, options.columns);
}

function rankMiniMapCell(nodes: GraphLayoutNode[]): string {
  if (nodes.length === 0) {
    return ".";
  }
  const maxLane = nodes.reduce((max, node) => Math.max(max, node.lane), 0);
  const laneLimit = Math.min(maxLane + 1, 3);
  const laneGlyphs: string[] = [];
  for (let lane = 0; lane < laneLimit; lane += 1) {
    laneGlyphs.push(laneMiniMapGlyph(nodes.filter((node) => node.lane === lane)));
  }
  return `${laneGlyphs.join("")}${maxLane + 1 > laneLimit ? "+" : ""}`;
}

function laneMiniMapGlyph(nodes: GraphLayoutNode[]): string {
  if (nodes.length === 0) {
    return ".";
  }
  if (nodes.some((node) => node.selected)) {
    return "*";
  }
  const hasPlan = nodes.some((node) => node.source === "plan");
  const hasTrace = nodes.some((node) => node.source === "trace");
  if (hasPlan && hasTrace) {
    return "B";
  }
  return hasPlan ? "P" : "T";
}

function workbenchGraph(
  trace: ExecutionTraceGraph,
  mode: GraphWorkbenchMode,
  fold: GraphFoldMode
): { nodes: BaseLayoutNode[]; edges: BaseLayoutEdge[] } {
  const planEdges = mode === "trace"
    ? []
    : trace.baseEdges.map((edge) => layoutPlanEdge(edge));
  const planNodes = mode === "trace"
    ? []
    : withPlanBranchGroups(trace.baseNodes.map((node) => layoutPlanNode(trace, node)), planEdges, fold);
  const traceNodes = mode === "plan"
    ? []
    : trace.dynamicNodes.map((node) => layoutTraceNode(node, fold));
  const visibleIds = new Set([...planNodes, ...traceNodes].map((node) => node.id));
  const edges = [
    ...planEdges,
    ...(mode === "plan" ? [] : trace.dynamicEdges.map((edge) => layoutTraceEdge(edge))),
    ...(mode === "overlay" ? runtimeBindingEdges(trace) : [])
  ].filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to));
  return {
    nodes: [...planNodes, ...traceNodes],
    edges
  };
}

function withPlanBranchGroups(
  nodes: BaseLayoutNode[],
  edges: BaseLayoutEdge[],
  fold: GraphFoldMode
): BaseLayoutNode[] {
  if (fold !== "grouped") {
    return nodes;
  }
  const branchTypeByNodeId = new Map<string, BaseLayoutEdge["type"]>();
  for (const edge of edges) {
    if (edge.type === "parallel" || edge.type === "fallback") {
      branchTypeByNodeId.set(edge.to, edge.type);
    }
  }
  return nodes.map((node) => {
    const branchType = branchTypeByNodeId.get(node.id);
    if (branchType === "parallel") {
      return { ...node, groupId: "parallel", groupLabel: "Parallel branch" };
    }
    if (branchType === "fallback") {
      return { ...node, groupId: "fallback", groupLabel: "Fallback branch" };
    }
    return node;
  });
}

interface BaseLayoutNode {
  id: string;
  source: "plan" | "trace";
  title: string;
  subtitle: string;
  status: string;
  risk?: string;
  required?: boolean;
  groupId?: string;
  groupLabel?: string;
}

interface BaseLayoutEdge {
  id: string;
  from: string;
  to: string;
  type: string;
  label?: string;
}

function layoutPlanNode(trace: ExecutionTraceGraph, node: AnyPlanNode): BaseLayoutNode {
  return {
    id: node.id,
    source: "plan",
    title: node.title,
    subtitle: `${node.kind} @${node.role} ${node.execution.mode}`,
    status: planNodeDisplayStatus(trace, node),
    risk: node.riskLevel,
    required: node.required
  };
}

function planNodeDisplayStatus(
  trace: ExecutionTraceGraph,
  node: AnyPlanNode
): string {
  const linkedTraceNodes = trace.dynamicNodes.filter((candidate) =>
    candidate.sourcePlanNodeId === node.id
  );
  if (linkedTraceNodes.length > 0) {
    return mergeTraceStatuses(linkedTraceNodes.map((candidate) => candidate.status));
  }
  if (node.id === trace.baseNodes.find((candidate) => candidate.kind === "planner")?.id) {
    return "completed";
  }
  if (node.execution.mode === "system") {
    return "completed";
  }
  return "planned";
}

function mergeTraceStatuses(statuses: readonly string[]): string {
  const order = [
    "failed",
    "blocked",
    "deviated",
    "running",
    "queued",
    "completed",
    "skipped",
    "planned",
    "unknown"
  ];
  for (const status of order) {
    if (statuses.includes(status)) {
      return status;
    }
  }
  return statuses[0] ?? "planned";
}

function layoutTraceNode(node: TraceNode, fold: GraphFoldMode): BaseLayoutNode {
  const group = node.sourceType === "role_call" || node.sourceType === "role_call_event"
    ? { id: "role-call", label: "RoleCall branch" }
    : node.sourceType === "comparison_report"
      ? { id: "comparison", label: "Comparison branch" }
      : undefined;
  return {
    id: node.id,
    source: "trace",
    title: node.title,
    subtitle: `${node.kind} ${node.sourceType ?? "event"}:${compactId(node.sourceId ?? "none")}`,
    status: node.status,
    groupId: fold === "grouped" ? group?.id : undefined,
    groupLabel: fold === "grouped" ? group?.label : undefined
  };
}

function layoutPlanEdge(edge: PlanEdge): BaseLayoutEdge {
  return {
    id: `plan:${edge.from}->${edge.to}:${edge.type}:${edge.label ?? ""}`,
    from: edge.from,
    to: edge.to,
    type: edge.type,
    label: edge.label
  };
}

function layoutTraceEdge(edge: TraceEdge): BaseLayoutEdge {
  return {
    id: edge.id,
    from: edge.from,
    to: edge.to,
    type: edge.type,
    label: edge.label
  };
}

function runtimeBindingEdges(trace: ExecutionTraceGraph): BaseLayoutEdge[] {
  return trace.dynamicNodes
    .filter((node) => node.sourcePlanNodeId)
    .map((node) => ({
      id: `runtime:${node.sourcePlanNodeId ?? ""}->${node.id}`,
      from: node.sourcePlanNodeId ?? "",
      to: node.id,
      type: "runtime",
      label: node.kind
    }));
}

function dagRows(
  layout: GraphLayoutModel,
  options: GraphWorkbenchOptions
): GraphWorkbenchRow[] {
  const collapsedGroupIds = new Set(layout.groups.filter((group) => group.collapsed).map((group) => group.id));
  const nodes = visibleNodesForGroups(layout.nodes, collapsedGroupIds);
  const visibleNodeIds = new Set(nodes.map((node) => node.id));
  const edges = layout.edges.filter((edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  if (nodes.length === 0) {
    const summaries = collapsedGroupRows(layout, options.columns);
    return summaries.length > 0 ? summaries : [{ text: "no graph nodes available", tone: "muted" }];
  }
  const spatialRows = spatialDagRows(layout, options);
  if (spatialRows) {
    return spatialRows;
  }
  const rows: GraphWorkbenchRow[] = collapsedGroupRows(layout, options.columns);
  const edgeByFrom = groupEdgesByFrom(edges);
  let currentGroup: string | undefined;
  for (const node of nodes) {
    if (node.groupId && node.groupId !== currentGroup) {
      currentGroup = node.groupId;
      rows.push({
        text: truncateText(`. . . ${node.groupLabel ?? node.groupId} . . .`, options.columns),
        tone: "info"
      });
    }
    rows.push({
      text: nodeBoxLine(node, node.displayWidth, node.selected, effectiveLabelMode(options.labels, options.columns)),
      selected: node.selected,
      tone: nodeTone(node)
    });
    for (const edge of edgeByFrom.get(node.id) ?? []) {
      rows.push({
        text: truncateText(
          `  ${nodeInlineLabel(node, effectiveLabelMode(options.labels, options.columns))} ${edgeGlyph(edge.type)} ${edgeLabelText(edge, effectiveLabelMode(options.labels, options.columns), nodeById)}`,
          options.columns
        ),
        tone: edge.type === "fallback" || edge.type === "deviation" ? "warning" : "muted"
      });
    }
  }
  return rows;
}

function spatialDagRows(
  layout: GraphLayoutModel,
  options: GraphWorkbenchOptions
): GraphWorkbenchRow[] | undefined {
  if (options.columns < spatialColumnThreshold) {
    return undefined;
  }
  const collapsedGroupIds = new Set(layout.groups.filter((group) => group.collapsed).map((group) => group.id));
  const nodes = visibleNodesForGroups(layout.nodes, collapsedGroupIds);
  const visibleNodeIds = new Set(nodes.map((node) => node.id));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const rows: GraphWorkbenchRow[] = collapsedGroupRows(layout, options.columns);
  const edgesByFrom = groupEdgesByFrom(
    layout.edges.filter((edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to))
  );
  const effectiveLabels = effectiveLabelMode(options.labels, options.columns);
  rows.push({
    text: truncateText("flow: top-down steps; indented rows show branches and runtime evidence", options.columns),
    tone: "muted"
  });
  const visibleRanks = [...new Set(nodes.filter((node) => node.viewportIncluded).map((node) => node.rank))].sort((a, b) => a - b);
  if (visibleRanks.length === 0) {
    return undefined;
  }
  for (const rank of visibleRanks) {
    const rankNodes = nodes
      .filter((node) => node.viewportIncluded && node.rank === rank)
      .sort((left, right) => left.lane - right.lane);
    rows.push({
      text: truncateText(`step ${rank}`, options.columns),
      tone: "muted"
    });
    for (const [nodeIndex, node] of rankNodes.entries()) {
      const singleNode = rankNodes.length === 1;
      const lastNode = nodeIndex === rankNodes.length - 1;
      const nodePrefix = singleNode ? "●" : lastNode ? "└●" : "├●";
      const edgePrefix = singleNode ? "  " : lastNode ? "   " : "│  ";
      rows.push({
        text: truncateText(flowNodeLine(node, effectiveLabels, nodePrefix), options.columns),
        selected: node.selected,
        tone: nodeTone(node)
      });
      const outgoing = uniqueFlowEdges(edgesByFrom.get(node.id) ?? [], nodeById, visibleNodeIds);
      for (const [edgeIndex, edge] of outgoing.entries()) {
        const branch = edgeIndex === outgoing.length - 1 ? "└─" : "├─";
        rows.push({
          text: truncateText(`${edgePrefix}${branch} ${flowEdgeLabel(edge, nodeById, effectiveLabels)}`, options.columns),
          tone: edge.type === "fallback" || edge.type === "deviation" ? "warning" : "muted"
        });
      }
    }
  }
  return rows;
}

function flowNodeLine(
  node: GraphLayoutNode,
  labels: ResolvedGraphLabelMode,
  prefix: string
): string {
  const coordinate = `r${node.rank}.${node.lane}`;
  const marker = node.selected ? "*" : " ";
  const source = nodeKindMarker(node);
  const status = statusGlyph(node.status);
  const meta = node.source === "plan"
    ? `${node.required ? "req" : "opt"} ${node.risk ?? "risk"}`
    : node.status;
  return `${prefix} ${marker}${coordinate} [${source} ${status}] ${nodeInlineLabel(node, labels)} (${meta})`;
}

function uniqueFlowEdges(
  edges: GraphLayoutEdge[],
  nodeById: ReadonlyMap<string, GraphLayoutNode>,
  visibleNodeIds: ReadonlySet<string>
): GraphLayoutEdge[] {
  const unique = new Map<string, GraphLayoutEdge>();
  for (const edge of edges) {
    if (!visibleNodeIds.has(edge.to)) {
      continue;
    }
    const key = `${edge.type}:${edge.to}`;
    if (!unique.has(key)) {
      unique.set(key, edge);
    }
  }
  return [...unique.values()].sort((left, right) =>
    (nodeById.get(left.to)?.rank ?? left.toRank) - (nodeById.get(right.to)?.rank ?? right.toRank) ||
    (nodeById.get(left.to)?.lane ?? left.toLane) - (nodeById.get(right.to)?.lane ?? right.toLane)
  );
}

function flowEdgeLabel(
  edge: GraphLayoutEdge,
  nodeById: ReadonlyMap<string, GraphLayoutNode>,
  labels: ResolvedGraphLabelMode
): string {
  const target = nodeById.get(edge.to);
  const targetCoordinate = target ? `r${target.rank}.${target.lane}` : `r${edge.toRank}.${edge.toLane}`;
  const targetLabel = nodeInlineLabel(target, labels, edge.to);
  const connector = edge.type === "primary" && target && target.rank > edge.fromRank ? "↓" : "→";
  return `${flowEdgeTypeLabel(edge)} ${connector} ${targetCoordinate} ${targetLabel}`;
}

function flowEdgeTypeLabel(edge: GraphLayoutEdge): string {
  if (edge.type === "primary") {
    return edge.label ? `primary:${edge.label}` : "primary";
  }
  if (edge.type === "runtime" || edge.type === "evidence") {
    return edge.type;
  }
  return edge.label && edge.label !== edge.type ? `${edge.type}:${edge.label}` : edge.type;
}

function narrowRows(
  nodes: GraphLayoutNode[],
  edges: GraphLayoutEdge[],
  columns: number,
  labels: GraphLabelMode
): GraphWorkbenchRow[] {
  if (nodes.length === 0) {
    return [{ text: "no graph nodes available", tone: "muted" }];
  }
  const incoming = groupEdgesByTo(edges);
  const effectiveLabels = effectiveLabelMode(labels, columns);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return nodes.map((node) => {
    const inbound = incoming.get(node.id)?.map((edge) =>
      `${edgeGlyph(edge.type)}${nodeInlineLabel(nodeById.get(edge.from), effectiveLabels)}`
    ).join(" ") ?? "root";
    const title = nodeInlineLabel(node, effectiveLabels);
    return {
      text: truncateText(`${node.selected ? "*" : " "} ${nodeKindMarker(node)} ${statusGlyph(node.status)} ${title} <= ${inbound}`, columns),
      selected: node.selected,
      tone: nodeTone(node)
    };
  });
}

function narrowGraphRows(
  layout: GraphLayoutModel,
  columns: number,
  labels: GraphLabelMode
): GraphWorkbenchRow[] {
  const collapsedGroupIds = new Set(layout.groups.filter((group) => group.collapsed).map((group) => group.id));
  const nodes = visibleNodesForGroups(layout.nodes, collapsedGroupIds);
  const visibleNodeIds = new Set(nodes.map((node) => node.id));
  const edges = layout.edges.filter((edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to));
  const summaries = collapsedGroupRows(layout, columns);
  if (nodes.length === 0) {
    return summaries.length > 0 ? summaries : [{ text: "no graph nodes available", tone: "muted" }];
  }
  return [
    ...summaries,
    ...narrowRows(nodes, edges, columns, labels)
  ];
}

function nodeBoxLine(
  node: GraphLayoutNode,
  width: number,
  selected: boolean,
  labels: ResolvedGraphLabelMode
): string {
  const marker = selected ? "*" : " ";
  const titleWidth = Math.max(8, width - 10);
  const title = truncateText(nodeTitleForLabelMode(node, labels), titleWidth);
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
  narrow: boolean,
  selectedNode: GraphLayoutNode | undefined
): string {
  return [
    `zoom ${options.zoom}`,
    `mode ${options.mode}`,
    `layout ${options.layout}`,
    `focus ${selectedNode ? nodeInlineLabel(selectedNode, effectiveLabelMode(options.labels, options.columns)) : nodeCount === 0 ? "none" : "unknown"}`,
    `labels ${options.labels}`,
    `fold ${options.fold}`,
    narrow ? "compact" : "flow",
    `plan ${trace.baseNodes.length}`,
    `trace ${trace.dynamicNodes.length}`,
    `evidence ${trace.evidence.length}`,
    `deviations ${trace.deviations.length}`,
    "m mode l labels f fold Z zoom"
  ].join(" | ");
}

function rankLayoutNodes(
  nodes: BaseLayoutNode[],
  edges: BaseLayoutEdge[],
  displayWidth: number,
  selectedId: string | undefined,
  focusedId: string | undefined,
  rankById: Map<string, number>,
  viewportRanks: number[]
): GraphLayoutNode[] {
  const laneById = laneNodes(nodes, rankById);
  const viewportRankSet = new Set(viewportRanks);
  return nodes.map((node) => {
    const selected = node.id === selectedId;
    return {
      ...node,
      rank: rankById.get(node.id) ?? 0,
      lane: laneById.get(node.id) ?? 0,
      displayWidth,
      incomingAnchors: [],
      outgoingAnchors: [],
      selected,
      focused: node.id === focusedId,
      viewportIncluded: viewportRankSet.has(rankById.get(node.id) ?? 0),
      actions: layoutActions(node)
    };
  });
}

function nodeWidthForZoom(zoom: GraphZoomMode): number {
  if (zoom === "100%") {
    return detailNodeWidth;
  }
  if (zoom === "67%") {
    return 25;
  }
  return compactNodeWidth;
}

function effectiveLabelMode(labels: GraphLabelMode, columns: number): ResolvedGraphLabelMode {
  if (labels === "auto") {
    return columns >= 140 ? "full" : "compact";
  }
  return labels;
}

function edgeLabelText(
  edge: GraphLayoutEdge,
  labels: ResolvedGraphLabelMode,
  nodeById?: ReadonlyMap<string, GraphLayoutNode>
): string {
  if (labels === "off") {
    return compactId(edge.to);
  }
  const target = nodeInlineLabel(nodeById?.get(edge.to), labels, edge.to);
  const prefix = edge.label ?? (edge.type === "primary" ? "" : edge.type);
  return prefix ? `${prefix} ${target}` : target;
}

function nodeTitleForLabelMode(
  node: GraphLayoutNode,
  labels: ResolvedGraphLabelMode
): string {
  if (labels === "off") {
    return compactId(node.id);
  }
  return node.title;
}

function nodeInlineLabel(
  node: GraphLayoutNode | undefined,
  labels: ResolvedGraphLabelMode,
  fallbackId = "unknown"
): string {
  if (!node || labels === "off") {
    return compactId(node?.id ?? fallbackId);
  }
  return truncateText(node.title, labels === "full" ? 28 : 20);
}

function viewportRanksForColumns(
  rankValues: number[],
  columns: number,
  requestedStartRank: number
): number[] {
  if (rankValues.length === 0 || columns < spatialColumnThreshold) {
    return rankValues;
  }
  const capacity = spatialRankCapacity(columns);
  if (rankValues.length <= capacity) {
    return rankValues;
  }
  const requestedIndex = rankValues.findIndex((rank) => rank >= requestedStartRank);
  const boundedStartIndex = Math.min(
    Math.max(requestedIndex < 0 ? 0 : requestedIndex, 0),
    Math.max(0, rankValues.length - capacity)
  );
  return rankValues.slice(boundedStartIndex, boundedStartIndex + capacity);
}

function spatialRankCapacity(columns: number): number {
  const minimumCellWidth = 18;
  return Math.max(1, Math.floor((columns + spatialRankGapWidth) / (minimumCellWidth + spatialRankGapWidth)));
}

function rankNodes(nodes: BaseLayoutNode[], edges: BaseLayoutEdge[]): Map<string, number> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const incomingCount = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, BaseLayoutEdge[]>();
  for (const edge of edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      continue;
    }
    incomingCount.set(edge.to, (incomingCount.get(edge.to) ?? 0) + 1);
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge);
    outgoing.set(edge.from, list);
  }
  const rankById = new Map(nodes.map((node) => [node.id, 0]));
  const queue = nodes.filter((node) => (incomingCount.get(node.id) ?? 0) === 0);
  const visited = new Set<string>();
  for (let index = 0; index < queue.length; index += 1) {
    const node = queue[index];
    visited.add(node.id);
    for (const edge of outgoing.get(node.id) ?? []) {
      const nextRank = Math.max(rankById.get(edge.to) ?? 0, (rankById.get(node.id) ?? 0) + 1);
      rankById.set(edge.to, nextRank);
      incomingCount.set(edge.to, Math.max(0, (incomingCount.get(edge.to) ?? 0) - 1));
      if ((incomingCount.get(edge.to) ?? 0) === 0) {
        const next = nodes.find((candidate) => candidate.id === edge.to);
        if (next) {
          queue.push(next);
        }
      }
    }
  }
  for (const node of nodes) {
    if (visited.has(node.id)) {
      continue;
    }
    const incomingRanks = edges
      .filter((edge) => edge.to === node.id && rankById.has(edge.from))
      .map((edge) => (rankById.get(edge.from) ?? 0) + 1);
    rankById.set(node.id, incomingRanks.length > 0 ? Math.max(...incomingRanks) : rankById.get(node.id) ?? 0);
  }
  return rankById;
}

function laneNodes(nodes: BaseLayoutNode[], rankById: Map<string, number>): Map<string, number> {
  const laneById = new Map<string, number>();
  const nextLaneByRank = new Map<number, number>();
  for (const node of nodes) {
    const rank = rankById.get(node.id) ?? 0;
    const lane = nextLaneByRank.get(rank) ?? 0;
    laneById.set(node.id, lane);
    nextLaneByRank.set(rank, lane + 1);
  }
  return laneById;
}

function layoutGroups(nodes: GraphLayoutNode[], collapsedGroupIds: Set<string>): GraphLayoutGroup[] {
  const groups = new Map<string, GraphLayoutGroup>();
  for (const node of nodes) {
    if (!node.groupId) {
      continue;
    }
    const group = groups.get(node.groupId) ?? {
      id: node.groupId,
      label: node.groupLabel ?? node.groupId,
      nodeIds: [],
      collapsed: collapsedGroupIds.has(node.groupId),
      selectedDescendant: false,
      status: "mixed"
    };
    group.nodeIds.push(node.id);
    group.selectedDescendant = group.selectedDescendant || node.selected;
    group.status = mergeGroupStatus(group.status, node.status);
    group.risk = mergeGroupRisk(group.risk, node.risk);
    groups.set(group.id, group);
  }
  return [...groups.values()];
}

function visibleNodesForGroups(
  nodes: GraphLayoutNode[],
  collapsedGroupIds: Set<string>
): GraphLayoutNode[] {
  if (collapsedGroupIds.size === 0) {
    return nodes;
  }
  return nodes.filter((node) => !node.groupId || !collapsedGroupIds.has(node.groupId));
}

function collapsedGroupRows(layout: GraphLayoutModel, columns: number): GraphWorkbenchRow[] {
  return layout.groups
    .filter((group) => group.collapsed)
    .map((group) => ({
      text: truncateText(
        `[+] ${group.label} ${group.nodeIds.length} node${group.nodeIds.length === 1 ? "" : "s"} status ${group.status} risk ${group.risk ?? "-"}${group.selectedDescendant ? " selected-descendant" : ""}`,
        columns
      ),
      selected: group.selectedDescendant,
      tone: graphGroupTone(group)
    }));
}

function graphGroupTone(group: GraphLayoutGroup): GraphWorkbenchRow["tone"] {
  if (group.risk === "high" || group.status === "failed" || group.status === "deviated") {
    return "danger";
  }
  if (group.risk === "medium" || group.status === "blocked") {
    return "warning";
  }
  if (group.status === "completed") {
    return "success";
  }
  return "info";
}

function mergeGroupStatus(current: string, next: string): string {
  if (current === "mixed") {
    return next;
  }
  if (current === next) {
    return current;
  }
  if (current === "failed" || next === "failed") {
    return "failed";
  }
  if (current === "blocked" || next === "blocked") {
    return "blocked";
  }
  if (current === "running" || next === "running") {
    return "running";
  }
  return "mixed";
}

function mergeGroupRisk(current: string | undefined, next: string | undefined): string | undefined {
  const order = ["low", "medium", "high", "blocking"];
  if (!next) {
    return current;
  }
  if (!current) {
    return next;
  }
  return order.indexOf(next) > order.indexOf(current) ? next : current;
}

function layoutActions(node: BaseLayoutNode): GraphLayoutAction[] {
  return [
    {
      id: "inspect",
      label: "Open details",
      safe: true
    },
    {
      id: "focus",
      label: "Prepare focus command",
      safe: true,
      command: `/graph focus ${node.id}`
    }
  ];
}

function groupEdgesByFrom(edges: GraphLayoutEdge[]): Map<string, GraphLayoutEdge[]> {
  const grouped = new Map<string, GraphLayoutEdge[]>();
  for (const edge of edges) {
    const list = grouped.get(edge.from) ?? [];
    list.push(edge);
    grouped.set(edge.from, list);
  }
  return grouped;
}

function groupEdgesByTo(edges: GraphLayoutEdge[]): Map<string, GraphLayoutEdge[]> {
  const grouped = new Map<string, GraphLayoutEdge[]>();
  for (const edge of edges) {
    const list = grouped.get(edge.to) ?? [];
    list.push(edge);
    grouped.set(edge.to, list);
  }
  return grouped;
}

function nodeKindMarker(node: GraphLayoutNode): string {
  return node.source === "plan" ? "P" : "T";
}

function statusGlyph(status: string): string {
  if (status === "completed" || status === "succeeded" || status === "system") {
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
  if (status === "skipped") {
    return "○";
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

function nodeTone(node: GraphLayoutNode): GraphWorkbenchRow["tone"] {
  if (node.status === "failed" || node.status === "deviated" || node.risk === "high") {
    return "danger";
  }
  if (node.status === "blocked" || node.risk === "medium") {
    return "warning";
  }
  if (node.status === "completed") {
    return "success";
  }
  if (node.groupId) {
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
