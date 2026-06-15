import type { AnyPlanNode, PlanGraph, PlanNodeRiskLevel } from "@agent-hub/shared";
import { DomainValidationError, validatePlanGraph } from "./domain";
import type { PlanGraphRepository } from "./storage";

export type PlanGraphAmendmentPolicyCode =
  | "task_mismatch"
  | "version_not_incremented"
  | "required_execution_node_changed";

export interface PlanGraphAmendmentPolicyFinding {
  code: PlanGraphAmendmentPolicyCode;
  severity: PlanNodeRiskLevel;
  message: string;
  requiresExplicitApproval: boolean;
  planNodeId?: string;
}

export interface PlanGraphAmendmentProposal {
  graph: PlanGraph;
  findings: PlanGraphAmendmentPolicyFinding[];
}

export function evaluatePlanGraphAmendmentPolicy(input: {
  activeGraph: PlanGraph;
  amendedGraph: PlanGraph;
}): PlanGraphAmendmentPolicyFinding[] {
  const activeGraph = validatePlanGraph(input.activeGraph);
  const amendedGraph = validatePlanGraph(input.amendedGraph);
  const findings: PlanGraphAmendmentPolicyFinding[] = [];

  if (activeGraph.taskId !== amendedGraph.taskId) {
    findings.push({
      code: "task_mismatch",
      severity: "high",
      message: "PlanGraph amendments must target the same task.",
      requiresExplicitApproval: false
    });
  }
  if (amendedGraph.version <= activeGraph.version) {
    findings.push({
      code: "version_not_incremented",
      severity: "high",
      message: "PlanGraph amendments must use a higher graph version.",
      requiresExplicitApproval: false
    });
  }

  findings.push(...requiredExecutionNodeFindings(activeGraph, amendedGraph));
  return findings;
}

export async function proposePlanGraphAmendment(input: {
  repository: PlanGraphRepository;
  activeGraph: PlanGraph;
  amendedGraph: PlanGraph;
}): Promise<PlanGraphAmendmentProposal> {
  const proposedGraph = validatePlanGraph({
    ...input.amendedGraph,
    status: "proposed"
  });
  const findings = evaluatePlanGraphAmendmentPolicy({
    activeGraph: input.activeGraph,
    amendedGraph: proposedGraph
  });
  throwOnBlockingAmendmentFindings(findings);
  const graph = await input.repository.create(proposedGraph);
  return { graph, findings };
}

export async function activatePlanGraphAmendment(input: {
  repository: PlanGraphRepository;
  activeGraphId: string;
  amendmentGraphId: string;
  approvedRequiredNodeChanges?: boolean;
}): Promise<PlanGraphAmendmentProposal & { supersededGraph: PlanGraph }> {
  const activeGraph = await input.repository.get(input.activeGraphId);
  if (!activeGraph) {
    throw new Error(`active PlanGraph ${input.activeGraphId} not found`);
  }
  const amendmentGraph = await input.repository.get(input.amendmentGraphId);
  if (!amendmentGraph) {
    throw new Error(`amendment PlanGraph ${input.amendmentGraphId} not found`);
  }
  const findings = evaluatePlanGraphAmendmentPolicy({
    activeGraph,
    amendedGraph: amendmentGraph
  });
  throwOnBlockingAmendmentFindings(findings);
  if (
    findings.some((finding) => finding.requiresExplicitApproval) &&
    !input.approvedRequiredNodeChanges
  ) {
    throw new Error(
      "PlanGraph amendment changes required execution nodes and requires explicit approval before activation."
    );
  }
  const supersededGraph = await input.repository.supersede(
    activeGraph.id,
    amendmentGraph.id
  );
  const graph = await input.repository.get(amendmentGraph.id);
  if (!graph) {
    throw new Error(`amendment PlanGraph ${amendmentGraph.id} not found after activation`);
  }
  return { graph, findings, supersededGraph };
}

function requiredExecutionNodeFindings(
  activeGraph: PlanGraph,
  amendedGraph: PlanGraph
): PlanGraphAmendmentPolicyFinding[] {
  const activeRequired = requiredExecutionNodeFingerprints(activeGraph);
  const amendedRequired = requiredExecutionNodeFingerprints(amendedGraph);
  const findings: PlanGraphAmendmentPolicyFinding[] = [];
  for (const [id, fingerprint] of activeRequired.entries()) {
    if (!amendedRequired.has(id)) {
      findings.push(requiredNodeChanged(id, "Required execution node was removed."));
      continue;
    }
    if (amendedRequired.get(id) !== fingerprint) {
      findings.push(requiredNodeChanged(id, "Required execution node changed."));
    }
  }
  for (const id of amendedRequired.keys()) {
    if (!activeRequired.has(id)) {
      findings.push(requiredNodeChanged(id, "Required execution node was added."));
    }
  }
  return findings;
}

function requiredExecutionNodeFingerprints(graph: PlanGraph): Map<string, string> {
  const result = new Map<string, string>();
  for (const node of graph.nodes) {
    if (!isRequiredExecutionNode(node)) {
      continue;
    }
    result.set(
      node.id,
      JSON.stringify({
        kind: node.kind,
        role: node.role,
        title: node.title,
        instructions: node.instructions,
        acceptanceCriteria: node.acceptanceCriteria,
        riskLevel: node.riskLevel,
        execution: node.execution
      })
    );
  }
  return result;
}

function isRequiredExecutionNode(node: AnyPlanNode): boolean {
  return node.required && node.execution.mode !== "non_executable";
}

function requiredNodeChanged(
  planNodeId: string,
  message: string
): PlanGraphAmendmentPolicyFinding {
  return {
    code: "required_execution_node_changed",
    severity: "high",
    message,
    planNodeId,
    requiresExplicitApproval: true
  };
}

function throwOnBlockingAmendmentFindings(
  findings: readonly PlanGraphAmendmentPolicyFinding[]
): void {
  const blocking = findings.filter((finding) =>
    finding.code === "task_mismatch" || finding.code === "version_not_incremented"
  );
  if (blocking.length === 0) {
    return;
  }
  throw new DomainValidationError(blocking.map((finding) => finding.message));
}
