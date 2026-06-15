import {
  planGraphIdForTaskVersion,
  plannerNodeIdForPlanGraph,
  planNodeIdForPlanGraph,
  type AgentKind,
  type AnyPlanNode,
  type PlanEdge,
  type PlanGraph,
  type PlanNodeKind,
  type Task,
  type TaskBrief
} from "@agent-hub/shared";
import { validatePlanGraph } from "./domain";

export interface PlanGraphPlannerInput {
  task: Task;
  taskBrief: TaskBrief;
  version: number;
  createdAt: string;
  expectedAdapter?: AgentKind;
  roleHandle?: string;
}

export type PlanGraphPlanner = (input: PlanGraphPlannerInput) => PlanGraph;

type PlannedNodeSpec = Omit<AnyPlanNode, "id">;

export function createDeterministicPlanGraph(
  input: PlanGraphPlannerInput
): PlanGraph {
  const graphId = planGraphIdForTaskVersion(input.task.id, input.version);
  const plannerNodeId = plannerNodeIdForPlanGraph(graphId);
  const profile = classifyPlanningRequest(input);
  const primaryRole = input.roleHandle ?? primaryRoleForProfile(profile);
  const plannedSpecs = plannedNodeSpecs({
    profile,
    primaryRole,
    expectedAdapter: input.expectedAdapter
  });
  const nodes: AnyPlanNode[] = [
    {
      id: plannerNodeId,
      kind: "planner",
      role: "planner",
      title: "Create execution plan",
      instructions:
        "Create a local, auditable DAG from the task brief before primary execution.",
      acceptanceCriteria: [
        "Graph is planner-rooted, acyclic, and bounded to the current task.",
        "Graph keeps external publication and context export outside automatic execution."
      ],
      riskLevel: profile.risky ? "medium" : "low",
      required: true,
      execution: { mode: "system" },
      outputPlanGraphId: graphId
    },
    ...plannedSpecs.map((node, index) => ({
      ...node,
      id: planNodeIdForPlanGraph(graphId, node.kind, index + 1)
    }))
  ];
  const edges: PlanEdge[] = nodes.slice(1).map((node, index) => ({
    from: nodes[index].id,
    to: node.id,
    type: "primary"
  }));

  return validatePlanGraph({
    id: graphId,
    taskId: input.task.id,
    version: input.version,
    status: "active",
    plannerNodeId,
    createdByRole: "planner",
    createdAt: input.createdAt,
    nodes,
    edges
  });
}

interface PlanningProfile {
  documentationOnly: boolean;
  reviewOnly: boolean;
  memorySensitive: boolean;
  risky: boolean;
}

function classifyPlanningRequest(input: PlanGraphPlannerInput): PlanningProfile {
  const text = [
    input.task.title,
    input.task.description,
    input.taskBrief.taskPrompt
  ]
    .filter((entry): entry is string => typeof entry === "string")
    .join("\n")
    .toLowerCase();
  const documentationOnly =
    matchesAny(text, [
      /\bdocs?\b/,
      /\bdocument(?:ation)?\b/,
      /\breadme\b/,
      /\barchitecture\b/,
      /\bproduct\s+doc\b/,
      /文档/,
      /说明/
    ]) &&
    !matchesAny(text, [
      /\bimplement\b/,
      /\bfix\b/,
      /\bbug\b/,
      /\brefactor\b/,
      /\bcode\b/,
      /修复/,
      /实现/
    ]);
  const reviewOnly =
    matchesAny(text, [
      /\breview\b/,
      /\baudit\b/,
      /\binspect\b/,
      /\bvalidate\b/,
      /检查/,
      /审查/
    ]) &&
    !matchesAny(text, [
      /\bimplement\b/,
      /\bfix\b/,
      /\bchange\b/,
      /\bupdate\b/,
      /实现/,
      /修改/,
      /更新/
    ]);
  const memorySensitive = matchesAny(text, [/\bmemory\b/, /\bmemories\b/, /记忆/]);
  const risky = matchesAny(text, [
    /\bmigration\b/,
    /\bschema\b/,
    /\bsecurity\b/,
    /\bauth\b/,
    /\bcredential\b/,
    /\bdestructive\b/,
    /迁移/,
    /安全/
  ]);
  return { documentationOnly, reviewOnly, memorySensitive, risky };
}

function plannedNodeSpecs(input: {
  profile: PlanningProfile;
  primaryRole: string;
  expectedAdapter?: AgentKind;
}): PlannedNodeSpec[] {
  const nodes: PlannedNodeSpec[] = [];
  if (input.profile.risky || !input.profile.documentationOnly) {
    nodes.push(researchNode(input.profile.risky));
  }
  if (input.profile.reviewOnly) {
    nodes.push(reviewNode("Inspect evidence and report acceptance readiness."));
  } else if (input.profile.documentationOnly) {
    nodes.push(documentationNode(input.primaryRole, input.expectedAdapter));
    nodes.push(verifyNode("Verify the documentation change against the task brief."));
    nodes.push(reviewNode("Review the documentation evidence and remaining gaps."));
  } else {
    nodes.push(implementNode(input.primaryRole, input.expectedAdapter, input.profile.risky));
    nodes.push(verifyNode("Run focused checks or inspect evidence for the implementation."));
    nodes.push(reviewNode("Review code, verification, risk, and acceptance readiness."));
  }
  if (input.profile.memorySensitive) {
    nodes.push(memoryNode());
  }
  nodes.push(handoffNode());
  return nodes;
}

function primaryRoleForProfile(profile: PlanningProfile): string {
  if (profile.documentationOnly) {
    return "writer";
  }
  if (profile.reviewOnly) {
    return "reviewer";
  }
  return "engineer";
}

function researchNode(risky: boolean): PlannedNodeSpec {
  return {
    kind: "research",
    title: "Inspect relevant context",
    role: "researcher",
    instructions:
      "Read the task brief, relevant source files, tests, and local evidence before changing anything.",
    acceptanceCriteria: [
      "Relevant constraints and affected areas are identified.",
      "Unknowns or risks are called out before downstream work."
    ],
    riskLevel: risky ? "medium" : "low",
    required: true,
    execution: { mode: "manual" }
  };
}

function documentationNode(role: string, expectedAdapter?: AgentKind): PlannedNodeSpec {
  return {
    kind: "documentation",
    title: "Update documentation",
    role,
    instructions:
      "Make the requested documentation change in the isolated task worktree and keep claims source-backed.",
    acceptanceCriteria: [
      "Documentation reflects the requested behavior or product decision.",
      "Changes stay within the task scope and preserve existing structure."
    ],
    riskLevel: "low",
    required: true,
    execution: primaryRunExecution(expectedAdapter)
  };
}

function implementNode(
  role: string,
  expectedAdapter: AgentKind | undefined,
  risky: boolean
): PlannedNodeSpec {
  return {
    kind: "implement",
    title: "Implement scoped change",
    role,
    instructions:
      "Implement the smallest local change that satisfies the task brief in the isolated task worktree.",
    acceptanceCriteria: [
      "Behavior matches the task brief.",
      "Code and documentation changes remain focused and reviewable."
    ],
    riskLevel: risky ? "medium" : "low",
    required: true,
    execution: primaryRunExecution(expectedAdapter)
  };
}

function verifyNode(instructions: string): PlannedNodeSpec {
  return {
    kind: "verify",
    title: "Verify evidence",
    role: "reviewer",
    instructions,
    acceptanceCriteria: [
      "Relevant checks or inspection steps are recorded.",
      "Failures, skipped checks, and residual risks are explicit."
    ],
    riskLevel: "low",
    required: true,
    execution: { mode: "manual" }
  };
}

function reviewNode(instructions: string): PlannedNodeSpec {
  return {
    kind: "review",
    title: "Review readiness",
    role: "reviewer",
    instructions,
    acceptanceCriteria: [
      "Acceptance criteria are evaluated against persisted evidence.",
      "Remaining risks or follow-up work are summarized."
    ],
    riskLevel: "low",
    required: true,
    execution: { mode: "manual" }
  };
}

function memoryNode(): PlannedNodeSpec {
  return {
    kind: "memory",
    title: "Evaluate memory proposal",
    role: "memory",
    instructions:
      "Suggest durable memory only when the run produces source-backed information useful to future tasks.",
    acceptanceCriteria: [
      "Memory remains a proposal unless a separate explicit approval path accepts it.",
      "Temporary or one-off details are excluded."
    ],
    riskLevel: "low",
    required: false,
    execution: { mode: "manual" }
  };
}

function handoffNode(): PlannedNodeSpec {
  return {
    kind: "handoff",
    title: "Summarize handoff",
    role: "operator",
    instructions:
      "Summarize what was done, which evidence was checked, and what remains for the user.",
    acceptanceCriteria: [
      "Summary names changed surfaces and verification evidence.",
      "No unresolved required node is hidden."
    ],
    riskLevel: "low",
    required: true,
    execution: { mode: "non_executable" }
  };
}

function primaryRunExecution(expectedAdapter?: AgentKind): PlannedNodeSpec["execution"] {
  return {
    mode: "primary_run",
    expectedAdapter,
    worktreePolicy: "isolated"
  };
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}
