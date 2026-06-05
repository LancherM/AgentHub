import { createHash } from "node:crypto";
import {
  compressionModes,
  contextLayers,
  validateContextPlan,
  type CompressionMode,
  type ContextLayer,
  type ContextPlan,
  type ContextPolicyDecision,
  type RetrievalRoute,
  type TaskType
} from "@agent-hub/core";

export interface ContextPlanInput {
  id: string;
  taskPrompt: string;
  createdAt: string;
}

export function classifyTaskPrompt(taskPrompt: string): TaskType {
  const normalized = taskPrompt.toLowerCase();
  if (
    hasAny(normalized, ["test failure", "failing test", "vitest", "jest", "pytest"]) ||
    /failing\b.*\btest/.test(normalized)
  ) {
    return "test_failure";
  }
  if (hasAny(normalized, ["review", "pull request", "pr ", "diff", "code review"])) {
    return "code_review";
  }
  if (hasAny(normalized, ["ui", "desktop", "renderer", "component", "css", "tui"])) {
    return "ui_change";
  }
  if (hasAny(normalized, ["architecture", "design", "roadmap", "package boundary"])) {
    return "architecture";
  }
  if (hasAny(normalized, ["docs", "documentation", "readme", "document"])) {
    return "documentation";
  }
  if (hasAny(normalized, ["follow up", "follow-up", "continue", "继续", "接着"])) {
    return "follow_up";
  }
  if (hasAny(normalized, ["bug", "fix", "regression", "crash", "error", "failure"])) {
    return "bug_fix";
  }
  if (hasAny(normalized, ["add", "implement", "support", "feature", "build"])) {
    return "feature";
  }
  return "unknown";
}

export function createContextPlan(input: ContextPlanInput): ContextPlan {
  const taskType = classifyTaskPrompt(input.taskPrompt);
  return validateContextPlan({
    id: input.id,
    taskType,
    taskPromptHash: sha256(input.taskPrompt),
    requiredLayers: requiredLayersForTaskType(taskType),
    retrievalRoutes: retrievalRoutesForTaskType(taskType),
    trustPolicy: defaultTrustPolicy(),
    budgetPolicy: budgetPolicyForTaskType(taskType),
    compressionPolicy: defaultCompressionPolicy(),
    createdAt: input.createdAt,
    diagnostics: {
      classifier: "rule_based_v1",
      matchedTaskType: taskType
    }
  });
}

function requiredLayersForTaskType(taskType: TaskType): ContextLayer[] {
  switch (taskType) {
    case "bug_fix":
    case "test_failure":
      return ["runtime_policy", "task", "code", "test", "run_evidence", "project"];
    case "ui_change":
      return ["runtime_policy", "task", "code", "test", "project"];
    case "architecture":
      return ["runtime_policy", "task", "project", "code", "approved_memory"];
    case "follow_up":
      return ["runtime_policy", "task", "run_evidence", "conversation", "project"];
    case "code_review":
      return ["runtime_policy", "task", "code", "test", "run_evidence", "project"];
    case "documentation":
      return ["runtime_policy", "task", "project", "code", "approved_memory"];
    case "feature":
      return ["runtime_policy", "task", "project", "code", "test", "approved_memory"];
    case "unknown":
      return ["runtime_policy", "task", "project"];
  }
}

function retrievalRoutesForTaskType(taskType: TaskType): RetrievalRoute[] {
  switch (taskType) {
    case "bug_fix":
    case "test_failure":
      return ["explicit", "task_rule", "bm25", "graph", "recency"];
    case "ui_change":
    case "feature":
      return ["explicit", "task_rule", "bm25", "graph"];
    case "architecture":
      return ["explicit", "task_rule", "bm25", "graph"];
    case "follow_up":
      return ["explicit", "task_rule", "recency"];
    case "code_review":
      return ["explicit", "task_rule", "bm25", "graph", "recency"];
    case "documentation":
      return ["explicit", "task_rule", "bm25"];
    case "unknown":
      return ["explicit", "task_rule"];
  }
}

function defaultTrustPolicy(): Record<ContextLayer, ContextPolicyDecision> {
  return fromLayerEntries((layer) => {
    if (layer === "conversation") {
      return "limited";
    }
    return "allow";
  });
}

function budgetPolicyForTaskType(taskType: TaskType): Record<ContextLayer, number> {
  switch (taskType) {
    case "bug_fix":
    case "test_failure":
      return budget({
        code: 25,
        test: 10,
        run_evidence: 20,
        project: 20,
        approved_memory: 10,
        skill: 10,
        conversation: 5
      });
    case "ui_change":
      return budget({
        code: 30,
        test: 10,
        project: 25,
        approved_memory: 10,
        skill: 10,
        run_evidence: 5,
        role: 5,
        conversation: 5
      });
    case "architecture":
      return budget({
        project: 35,
        code: 25,
        approved_memory: 15,
        skill: 10,
        role: 5,
        global: 5,
        conversation: 5
      });
    case "follow_up":
      return budget({
        run_evidence: 30,
        conversation: 20,
        project: 15,
        approved_memory: 10,
        skill: 10,
        code: 10,
        role: 5
      });
    case "code_review":
      return budget({
        code: 35,
        test: 15,
        run_evidence: 20,
        project: 15,
        approved_memory: 5,
        skill: 5,
        conversation: 5
      });
    case "documentation":
      return budget({
        project: 35,
        code: 20,
        approved_memory: 15,
        skill: 10,
        conversation: 10,
        global: 10
      });
    case "feature":
      return budget({
        code: 30,
        test: 10,
        project: 25,
        approved_memory: 10,
        skill: 10,
        run_evidence: 5,
        role: 5,
        conversation: 5
      });
    case "unknown":
      return budget({
        project: 40,
        code: 20,
        approved_memory: 15,
        skill: 10,
        conversation: 10,
        global: 5
      });
  }
}

function defaultCompressionPolicy(): Record<ContextLayer, CompressionMode> {
  const supportedModes = new Set<string>(compressionModes);
  return fromLayerEntries((layer) => {
    const mode = compressionModeForLayer(layer);
    if (!supportedModes.has(mode)) {
      return "summary";
    }
    return mode;
  });
}

function compressionModeForLayer(layer: ContextLayer): CompressionMode {
  switch (layer) {
    case "runtime_policy":
    case "task":
    case "approved_memory":
      return "none";
    case "project":
    case "code":
    case "test":
    case "skill":
    case "role":
      return "extractive";
    case "run_evidence":
    case "conversation":
      return "structured";
    case "global":
      return "summary";
  }
}

function budget(values: Partial<Record<ContextLayer, number>>): Record<ContextLayer, number> {
  return fromLayerEntries((layer) => values[layer] ?? 0);
}

function fromLayerEntries<T>(
  valueForLayer: (layer: ContextLayer) => T
): Record<ContextLayer, T> {
  return Object.fromEntries(
    contextLayers.map((layer) => [layer, valueForLayer(layer)])
  ) as Record<ContextLayer, T>;
}

function hasAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function sha256(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}
