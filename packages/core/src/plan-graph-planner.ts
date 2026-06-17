import {
  planGraphIdForTaskVersion,
  type AgentKind,
  type PlanGraph,
  type Task,
  type TaskBrief
} from "@agent-hub/shared";
import { DomainValidationError, validatePlanGraph } from "./domain";

export interface PlanGraphPlannerInput {
  task: Task;
  taskBrief: TaskBrief;
  version: number;
  createdAt: string;
  expectedAdapter?: AgentKind;
  roleHandle?: string;
}

export function parseStructuredPlanGraphOutput(
  input: PlanGraphPlannerInput,
  output: string | unknown
): PlanGraph {
  const parsed = typeof output === "string"
    ? parsePlannerJsonText(output)
    : output;
  const candidate = unwrapPlannerGraph(parsed);
  const graph = validatePlanGraph(candidate as PlanGraph);
  const expectedId = planGraphIdForTaskVersion(input.task.id, input.version);
  const issues: string[] = [];
  if (graph.id !== expectedId) {
    issues.push(`planGraph.id must be ${expectedId}`);
  }
  if (graph.taskId !== input.task.id) {
    issues.push(`planGraph.taskId must be ${input.task.id}`);
  }
  if (graph.version !== input.version) {
    issues.push(`planGraph.version must be ${input.version}`);
  }
  if (graph.status !== "active") {
    issues.push("planGraph.status must be active for planner activation");
  }
  if (issues.length > 0) {
    throw new DomainValidationError(issues);
  }
  return graph;
}

function unwrapPlannerGraph(value: unknown): unknown {
  if (isRecord(value) && isRecord(value.planGraph)) {
    return value.planGraph;
  }
  return value;
}

function parsePlannerJsonText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("planner output was empty");
  }
  const candidates = [
    trimmed,
    ...extractFencedJsonBlocks(trimmed),
    ...extractJsonObjectCandidates(trimmed)
  ];
  const errors: string[] = [];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  const detail = errors[0] ? `: ${errors[0]}` : "";
  throw new Error(`planner output was not valid JSON${detail}`);
}

function extractFencedJsonBlocks(text: string): string[] {
  return [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)]
    .map((match) => match[1]?.trim())
    .filter((block): block is string => !!block);
}

function extractJsonObjectCandidates(text: string): string[] {
  const candidates: string[] = [];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    candidates.push(text.slice(start, end + 1));
  }
  return candidates;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
