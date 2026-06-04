import { createHash } from "node:crypto";
import path from "node:path";
import {
  validateContextCandidate,
  validateContextRetrievalResult,
  type ContextBundle,
  type ContextCandidate,
  type ContextItem,
  type ContextLayer,
  type ContextPlan,
  type ContextRetrievalResult,
  type ContextScope,
  type ContextSection,
  type JsonObject,
  type RetrievalRoute,
  type SkillReference,
  type Task,
  type TrustLevel
} from "@agent-hub/core";

export interface ExplicitFileContextSource {
  path: string;
  content: string;
  title?: string;
  updatedAt?: string;
  metadata?: JsonObject;
}

export interface ExplicitRunContextSource {
  runId: string;
  summary: string;
  taskId?: string;
  title?: string;
  createdAt?: string;
  metadata?: JsonObject;
}

export interface ContextRetrieverInput {
  id: string;
  plan: ContextPlan;
  task: Task;
  runId?: string;
  taskPrompt: string;
  contextBundle: ContextBundle;
  selectedSkillReferences?: SkillReference[];
  roleSkillReferences?: SkillReference[];
  selectedFiles?: ExplicitFileContextSource[];
  selectedRuns?: ExplicitRunContextSource[];
  createdAt: string;
}

export interface ContextRetriever {
  retrieve(input: ContextRetrieverInput): Promise<ContextRetrievalResult>;
}

export class ExplicitContextRetriever implements ContextRetriever {
  async retrieve(input: ContextRetrieverInput): Promise<ContextRetrievalResult> {
    const candidates: ContextCandidate[] = [];
    const omitted: ContextRetrievalResult["omitted"] = [];
    const diagnostics: ContextRetrievalResult["diagnostics"] = [];

    const currentTask = currentTaskCandidate(input);
    if (currentTask) {
      candidates.push(currentTask);
    }

    for (const section of input.contextBundle.sections) {
      if (section.source.kind === "skill") {
        const candidate = skillSectionCandidate(section, input);
        if (candidate) {
          candidates.push(candidate);
        }
      }
      if (section.source.kind === "conversation") {
        candidates.push(conversationSectionCandidate(section, input));
      }
    }

    for (const file of input.selectedFiles ?? []) {
      const secretReason = secretLikePathReason(file.path);
      if (secretReason) {
        omitted.push({
          itemId: `file:${normalizeSourcePath(file.path)}`,
          layer: "code",
          reason: secretReason
        });
        diagnostics.push({
          severity: "warning",
          message: `selected file ${file.path} was excluded from explicit retrieval`,
          metadata: { reason: secretReason }
        });
        continue;
      }
      candidates.push(fileCandidate(file, input));
    }

    for (const run of input.selectedRuns ?? []) {
      candidates.push(runCandidate(run, input));
    }

    const result = validateContextRetrievalResult({
      id: input.id,
      planId: input.plan.id,
      taskId: input.task.id,
      runId: input.runId,
      candidates: dedupeCandidates(candidates),
      omitted,
      diagnostics,
      createdAt: input.createdAt
    });
    return result;
  }
}

function currentTaskCandidate(
  input: ContextRetrieverInput
): ContextCandidate | undefined {
  const section = input.contextBundle.sections.find(
    (entry) => entry.source.kind === "task"
  );
  const content = section?.body.trim() || input.taskPrompt.trim();
  if (!content) {
    return undefined;
  }
  return candidate({
    item: contextItem({
      id: `task:${input.task.id}`,
      layer: "task",
      sourceKind: "task",
      sourceId: input.task.id,
      scope: "task",
      trustLevel: "system",
      lifetime: "run",
      title: section?.title ?? "Current Task",
      content,
      createdAt: input.createdAt,
      metadata: {
        explicitSource: "current_task",
        taskTitle: input.task.title
      }
    }),
    relevanceScore: 1,
    freshnessScore: 1,
    scopeMatchScore: 1,
    inclusionReason: "current task is pinned as an explicit retrieval source"
  });
}

function skillSectionCandidate(
  section: ContextSection,
  input: ContextRetrieverInput
): ContextCandidate | undefined {
  const metadata = sourceMetadata(section);
  const selected = matchesSkillReference(
    section.source.id,
    input.selectedSkillReferences
  );
  const roleDefault = matchesSkillReference(
    section.source.id,
    input.roleSkillReferences
  );
  if (!selected && !roleDefault) {
    return undefined;
  }
  const sourcePath =
    typeof metadata.sourcePath === "string" ? metadata.sourcePath : undefined;
  return candidate({
    item: contextItem({
      id: section.id,
      layer: "skill",
      sourceKind: roleDefault ? "role_default_skill" : "selected_skill",
      sourceId: section.source.id,
      scope: roleDefault ? "role" : "task",
      trustLevel: "medium",
      lifetime: "session",
      title: section.title,
      content: section.body,
      createdAt: input.createdAt,
      sourcePath,
      contentHash:
        typeof metadata.contentHash === "string"
          ? metadata.contentHash
          : undefined,
      metadata: {
        explicitSource: roleDefault ? "role_default_skill" : "selected_skill",
        sourceItemId: section.id,
        skillName: metadata.skillName,
        skillDescription: metadata.skillDescription
      }
    }),
    relevanceScore: 0.92,
    freshnessScore: 0.8,
    scopeMatchScore: roleDefault ? 0.85 : 1,
    inclusionReason: roleDefault
      ? "role default skill was selected for this run"
      : "skill was explicitly selected for this run"
  });
}

function conversationSectionCandidate(
  section: ContextSection,
  input: ContextRetrieverInput
): ContextCandidate {
  return candidate({
    item: contextItem({
      id: section.id,
      layer: "conversation",
      sourceKind: "thread_summary",
      sourceId: section.source.id,
      scope: "thread",
      trustLevel: "low",
      lifetime: "thread",
      title: section.title,
      content: section.body,
      createdAt: input.createdAt,
      metadata: {
        explicitSource: "current_thread_summary",
        sourceItemId: section.id,
        continuityOnly: true,
        mayOverrideCurrentTask: false,
        mayOverrideProjectContext: false,
        mayOverrideApprovedMemory: false
      }
    }),
    relevanceScore: 0.58,
    freshnessScore: 0.9,
    scopeMatchScore: 0.85,
    inclusionReason:
      "current thread summary is explicit low-trust continuity context"
  });
}

function fileCandidate(
  file: ExplicitFileContextSource,
  input: ContextRetrieverInput
): ContextCandidate {
  const sourcePath = normalizeSourcePath(file.path);
  return candidate({
    item: contextItem({
      id: `file:${sourcePath}`,
      layer: "code",
      sourceKind: "selected_file",
      sourceId: sourcePath,
      scope: "project",
      trustLevel: "high",
      lifetime: "indexed_snapshot",
      title: file.title ?? `Selected File: ${sourcePath}`,
      content: file.content.trim().length > 0 ? file.content : "(empty file)",
      createdAt: input.createdAt,
      updatedAt: file.updatedAt,
      sourcePath,
      metadata: {
        ...(file.metadata ?? {}),
        explicitSource: "selected_file"
      }
    }),
    relevanceScore: 0.95,
    freshnessScore: file.updatedAt ? 0.9 : 0.75,
    scopeMatchScore: 1,
    inclusionReason: "file was explicitly selected for this run"
  });
}

function runCandidate(
  run: ExplicitRunContextSource,
  input: ContextRetrieverInput
): ContextCandidate {
  return candidate({
    item: contextItem({
      id: `run:${run.runId}`,
      layer: "run_evidence",
      sourceKind: "selected_run",
      sourceId: run.runId,
      scope: "run",
      trustLevel: "medium",
      lifetime: "run",
      title: run.title ?? `Selected Run: ${run.runId}`,
      content: run.summary.trim().length > 0 ? run.summary : "No selected run summary.",
      createdAt: run.createdAt ?? input.createdAt,
      metadata: {
        ...(run.metadata ?? {}),
        explicitSource: "selected_run",
        taskId: run.taskId
      }
    }),
    relevanceScore: 0.9,
    freshnessScore: 0.85,
    scopeMatchScore: 0.9,
    inclusionReason: "run evidence was explicitly selected for this run"
  });
}

function candidate(input: {
  item: ContextItem;
  relevanceScore: number;
  freshnessScore: number;
  scopeMatchScore: number;
  inclusionReason: string;
  routes?: RetrievalRoute[];
  graphProximityScore?: number;
}): ContextCandidate {
  return validateContextCandidate({
    item: input.item,
    routes: input.routes ?? ["explicit"],
    relevanceScore: input.relevanceScore,
    freshnessScore: input.freshnessScore,
    trustScore: trustScore(input.item.trustLevel),
    graphProximityScore: input.graphProximityScore,
    scopeMatchScore: input.scopeMatchScore,
    inclusionReason: input.inclusionReason,
    diagnostics: {
      sourceItemId: input.item.id,
      sourceKind: input.item.sourceKind,
      sourceId: input.item.sourceId,
      sourcePath: input.item.sourcePath,
      routes: input.routes ?? ["explicit"]
    }
  });
}

function contextItem(input: {
  id: string;
  layer: ContextLayer;
  sourceKind: string;
  sourceId: string;
  scope: ContextScope;
  trustLevel: TrustLevel;
  lifetime: ContextItem["lifetime"];
  title: string;
  content: string;
  createdAt: string;
  updatedAt?: string;
  sourcePath?: string;
  contentHash?: string;
  metadata: JsonObject;
}): ContextItem {
  return {
    id: input.id,
    layer: input.layer,
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    scope: input.scope,
    trustLevel: input.trustLevel,
    lifetime: input.lifetime,
    title: input.title,
    content: input.content,
    contentHash: input.contentHash ?? sha256(input.content),
    sourcePath: input.sourcePath,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    metadata: input.metadata
  };
}

function dedupeCandidates(candidates: ContextCandidate[]): ContextCandidate[] {
  const seen = new Set<string>();
  const deduped: ContextCandidate[] = [];
  for (const candidateEntry of candidates) {
    const key = `${candidateEntry.item.sourceKind}:${candidateEntry.item.sourceId}:${candidateEntry.item.contentHash}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(candidateEntry);
  }
  return deduped;
}

function matchesSkillReference(
  sourceId: string,
  references: SkillReference[] | undefined
): boolean {
  if (!references || references.length === 0) {
    return false;
  }
  const unscopedSourceId = unscopedSkillId(sourceId);
  return references.some((reference) => {
    const scopedReference = reference.scope
      ? `${reference.scope}:${reference.id}`
      : reference.id;
    return (
      sourceId === scopedReference ||
      unscopedSourceId === reference.id ||
      sourceId.endsWith(`:${reference.id}`)
    );
  });
}

function sourceMetadata(section: ContextSection): Record<string, unknown> {
  return section.source as unknown as Record<string, unknown>;
}

function unscopedSkillId(value: string): string {
  const separator = value.indexOf(":");
  return separator === -1 ? value : value.slice(separator + 1);
}

function normalizeSourcePath(value: string): string {
  return value.split(path.sep).join("/").replace(/^\.\//, "");
}

function secretLikePathReason(value: string): string | undefined {
  const normalized = normalizeSourcePath(value).toLowerCase();
  const basename = normalized.split("/").at(-1) ?? normalized;
  if (
    basename === ".env" ||
    basename.startsWith(".env.") ||
    basename === "id_rsa" ||
    basename === "id_ed25519" ||
    basename.endsWith(".pem") ||
    basename.endsWith(".key") ||
    basename.startsWith("secrets.") ||
    basename.startsWith("credentials.") ||
    basename.startsWith("token.")
  ) {
    return "secret-like selected file paths are excluded before retrieval";
  }
  return undefined;
}

function trustScore(trustLevel: TrustLevel): number {
  switch (trustLevel) {
    case "system":
      return 1;
    case "high":
      return 0.85;
    case "medium":
      return 0.65;
    case "low":
      return 0.35;
  }
}

function sha256(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}
