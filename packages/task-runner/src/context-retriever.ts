import { createHash } from "node:crypto";
import path from "node:path";
import {
  fuseContextCandidates,
  type ContextCandidateReranker,
  type ContextEmbeddingRetriever
} from "./context-fusion";
import {
  validateContextCandidate,
  validateContextRetrievalResult,
  type ConversationThreadSummary,
  type CodeGraphRepository,
  type CodeGraphSearchResult,
  type ContextBundle,
  type ContextCandidate,
  type ContextItem,
  type ContextIndexRepository,
  type ContextIndexSearchResult,
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
import type { RecentRunEvidenceContextSource } from "./context-recency";

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
  recentRunEvidence?: RecentRunEvidenceContextSource[];
  threadSummary?: ConversationThreadSummary;
  includeThreadSummary?: boolean;
  threadContextDisabledReason?: string;
  createdAt: string;
}

export interface ContextRetriever {
  retrieve(input: ContextRetrieverInput): Promise<ContextRetrievalResult>;
}

export interface ContextRetrieverOptions {
  contextIndexRepository?: ContextIndexRepository;
  codeGraphRepository?: CodeGraphRepository;
  embeddingRetriever?: ContextEmbeddingRetriever;
  reranker?: ContextCandidateReranker;
  bm25Limit?: number;
  graphLimit?: number;
  embeddingLimit?: number;
}

export class ExplicitContextRetriever implements ContextRetriever {
  constructor(private readonly options: ContextRetrieverOptions = {}) {}

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

    const explicitCandidates = dedupeCandidates(candidates);
    const bm25 = await bm25Candidates(input, explicitCandidates, this.options);
    const embedding = await embeddingCandidates(input, this.options);
    const graph = await graphCandidates(
      input,
      [...explicitCandidates, ...bm25.candidates, ...embedding.candidates],
      this.options
    );
    const recency = recencyCandidates(input, [
      ...explicitCandidates,
      ...bm25.candidates,
      ...embedding.candidates,
      ...graph.candidates
    ]);
    const reranked = await rerankCandidates(
      {
        ...input,
        candidates: [
          ...explicitCandidates,
          ...bm25.candidates,
          ...embedding.candidates,
          ...graph.candidates,
          ...recency.candidates
        ]
      },
      this.options
    );
    const fusedCandidates = fuseContextCandidates(reranked.candidates);

    const result = validateContextRetrievalResult({
      id: input.id,
      planId: input.plan.id,
      taskId: input.task.id,
      runId: input.runId,
      candidates: fusedCandidates,
      omitted: [...omitted, ...bm25.omitted, ...graph.omitted, ...recency.omitted],
      diagnostics: [
        ...diagnostics,
        ...bm25.diagnostics,
        ...embedding.diagnostics,
        ...graph.diagnostics,
        ...recency.diagnostics,
        ...reranked.diagnostics,
        {
          severity: "info",
          message: "hybrid retrieval fusion completed",
          metadata: {
            rawCandidateCount: reranked.candidates.length,
            fusedCandidateCount: fusedCandidates.length,
            routeCounts: contextCandidateRouteCounts(fusedCandidates)
          }
        }
      ],
      createdAt: input.createdAt
    });
    return result;
  }
}

async function bm25Candidates(
  input: ContextRetrieverInput,
  explicitCandidates: ContextCandidate[],
  options: ContextRetrieverOptions
): Promise<{
  candidates: ContextCandidate[];
  omitted: ContextRetrievalResult["omitted"];
  diagnostics: ContextRetrievalResult["diagnostics"];
}> {
  if (
    !options.contextIndexRepository ||
    !input.plan.retrievalRoutes.includes("bm25")
  ) {
    return { candidates: [], omitted: [], diagnostics: [] };
  }
  const terms = extractContextQueryTerms(input);
  if (terms.length === 0) {
    return {
      candidates: [],
      omitted: [],
      diagnostics: [
        {
          severity: "info",
          message: "BM25 retrieval skipped because no stable query terms were extracted"
        }
      ]
    };
  }
  const searchResults = await options.contextIndexRepository.search({
    projectId: input.contextBundle.targetRepository.id,
    query: input.taskPrompt,
    terms,
    limit: options.bm25Limit ?? 8
  });
  const explicitKeys = new Set(
    explicitCandidates.map((candidateEntry) =>
      sourceHashKey(candidateEntry.item.sourceId, candidateEntry.item.contentHash)
    )
  );
  const candidates: ContextCandidate[] = [];
  const omitted: ContextRetrievalResult["omitted"] = [];
  for (const searchResult of searchResults) {
    const skillOmissionReason = unselectedIndexedSkillReason(
      searchResult,
      input
    );
    if (skillOmissionReason) {
      omitted.push({
        itemId: searchResult.entry.id,
        layer: searchResult.entry.layer,
        reason: skillOmissionReason
      });
      continue;
    }
    const key = sourceHashKey(
      searchResult.entry.sourceId,
      searchResult.entry.contentHash
    );
    if (explicitKeys.has(key)) {
      omitted.push({
        itemId: searchResult.entry.id,
        layer: searchResult.entry.layer,
        reason: "BM25 candidate duplicated an explicit-route source"
      });
      continue;
    }
    candidates.push(indexSearchCandidate(searchResult, input, terms));
  }
  return {
    candidates,
    omitted,
    diagnostics: [
      {
        severity: "info",
        message: "BM25 stable-source retrieval completed",
        metadata: {
          queryTerms: terms,
          resultCount: searchResults.length,
          selectedCount: candidates.length,
          omittedDuplicateCount: omitted.length
        }
      }
    ]
  };
}

function unselectedIndexedSkillReason(
  searchResult: ContextIndexSearchResult,
  input: ContextRetrieverInput
): string | undefined {
  if (
    searchResult.entry.sourceKind !== "project_skill" &&
    searchResult.entry.sourceKind !== "global_skill"
  ) {
    return undefined;
  }
  if (
    matchesSkillReference(searchResult.entry.sourceId, input.selectedSkillReferences) ||
    matchesSkillReference(searchResult.entry.sourceId, input.roleSkillReferences)
  ) {
    return undefined;
  }
  return "BM25 skill candidate was not selected by the task or role";
}

function indexSearchCandidate(
  searchResult: ContextIndexSearchResult,
  input: ContextRetrieverInput,
  terms: string[]
): ContextCandidate {
  return candidate({
    item: searchResult.entry,
    routes: ["bm25"],
    relevanceScore: Math.max(0, Math.min(searchResult.lexicalScore, 1)),
    freshnessScore: 0.75,
    scopeMatchScore: searchResult.entry.scope === "global" ? 0.7 : 0.9,
    inclusionReason: `${searchResult.entry.sourceKind} matched BM25 query terms for the current task`,
    diagnostics: {
      query: input.taskPrompt,
      queryTerms: terms,
      rank: searchResult.rank,
      lexicalScore: searchResult.lexicalScore,
      ...searchResult.diagnostics
    }
  });
}

async function embeddingCandidates(
  input: ContextRetrieverInput,
  options: ContextRetrieverOptions
): Promise<{
  candidates: ContextCandidate[];
  diagnostics: ContextRetrievalResult["diagnostics"];
}> {
  if (!input.plan.retrievalRoutes.includes("embedding")) {
    return { candidates: [], diagnostics: [] };
  }
  if (!options.embeddingRetriever) {
    return {
      candidates: [],
      diagnostics: [
        {
          severity: "info",
          message: "embedding retrieval skipped because no local embedding retriever is configured"
        }
      ]
    };
  }
  const capability = await options.embeddingRetriever.detect();
  if (!capability.available) {
    return {
      candidates: [],
      diagnostics: [
        {
          severity: "info",
          message: "embedding retrieval skipped because the configured retriever is unavailable",
          metadata: { ...capability }
        }
      ]
    };
  }
  const terms = extractContextQueryTerms(input);
  const candidates = (await options.embeddingRetriever.retrieve({
    plan: input.plan,
    task: input.task,
    taskPrompt: input.taskPrompt,
    contextBundle: input.contextBundle,
    queryTerms: terms,
    limit: options.embeddingLimit ?? 8
  })).map(validateContextCandidate);
  return {
    candidates,
    diagnostics: [
      {
        severity: "info",
        message: "embedding retrieval completed",
        metadata: {
          provider: capability.provider,
          candidateCount: candidates.length,
          queryTerms: terms
        }
      }
    ]
  };
}

async function rerankCandidates(
  input: ContextRetrieverInput & { candidates: ContextCandidate[] },
  options: ContextRetrieverOptions
): Promise<{
  candidates: ContextCandidate[];
  diagnostics: ContextRetrievalResult["diagnostics"];
}> {
  if (!options.reranker || input.candidates.length === 0) {
    return { candidates: input.candidates, diagnostics: [] };
  }
  const capability = options.reranker.detect
    ? await options.reranker.detect()
    : {
        available: true,
        provider: "configured_reranker"
      };
  if (!capability.available) {
    return {
      candidates: input.candidates,
      diagnostics: [
        {
          severity: "info",
          message: "reranking skipped because the configured reranker is unavailable",
          metadata: { ...capability }
        }
      ]
    };
  }
  const candidates = (await options.reranker.rerank({
    plan: input.plan,
    taskPrompt: input.taskPrompt,
    candidates: input.candidates
  })).map(validateContextCandidate);
  return {
    candidates,
    diagnostics: [
      {
        severity: "info",
        message: "context candidates reranked",
        metadata: {
          provider: capability.provider,
          inputCandidateCount: input.candidates.length,
          outputCandidateCount: candidates.length
        }
      }
    ]
  };
}

async function graphCandidates(
  input: ContextRetrieverInput,
  existingCandidates: ContextCandidate[],
  options: ContextRetrieverOptions
): Promise<{
  candidates: ContextCandidate[];
  omitted: ContextRetrievalResult["omitted"];
  diagnostics: ContextRetrievalResult["diagnostics"];
}> {
  if (
    !options.codeGraphRepository ||
    !input.plan.retrievalRoutes.includes("graph")
  ) {
    return { candidates: [], omitted: [], diagnostics: [] };
  }
  const terms = extractContextQueryTerms(input);
  const seedPaths = graphSeedPaths(input);
  const changedFiles = graphChangedFiles(input);
  if (terms.length === 0 && seedPaths.length === 0 && changedFiles.length === 0) {
    return {
      candidates: [],
      omitted: [],
      diagnostics: [
        {
          severity: "info",
          message: "code graph retrieval skipped because no graph query seeds were available"
        }
      ]
    };
  }
  const searchResults = await options.codeGraphRepository.search({
    projectId: input.contextBundle.targetRepository.id,
    queryTerms: terms,
    seedPaths,
    changedFiles,
    limit: options.graphLimit ?? 8
  });
  const existingSourceIds = new Set(
    existingCandidates.flatMap((candidateEntry) => [
      candidateEntry.item.sourceId,
      candidateEntry.item.sourcePath
    ]).filter((value): value is string => value !== undefined)
  );
  const candidates: ContextCandidate[] = [];
  const omitted: ContextRetrievalResult["omitted"] = [];
  for (const searchResult of searchResults) {
    if (existingSourceIds.has(searchResult.entry.filePath)) {
      omitted.push({
        itemId: searchResult.entry.id,
        layer: searchResult.entry.isTest ? "test" : "code",
        reason: "graph candidate duplicated an earlier retrieval source"
      });
      continue;
    }
    candidates.push(codeGraphCandidate(searchResult, input));
  }
  return {
    candidates,
    omitted,
    diagnostics: [
      {
        severity: "info",
        message: "code graph retrieval completed",
        metadata: {
          queryTerms: terms,
          seedPaths,
          changedFiles,
          resultCount: searchResults.length,
          selectedCount: candidates.length,
          omittedDuplicateCount: omitted.length
        }
      }
    ]
  };
}

function codeGraphCandidate(
  searchResult: CodeGraphSearchResult,
  input: ContextRetrieverInput
): ContextCandidate {
  const layer: ContextLayer = searchResult.entry.isTest ? "test" : "code";
  return candidate({
    item: contextItem({
      id: searchResult.entry.id,
      layer,
      sourceKind: "code_graph",
      sourceId: searchResult.entry.filePath,
      scope: "project",
      trustLevel: "high",
      lifetime: "indexed_snapshot",
      title: `${searchResult.entry.isTest ? "Test" : "Code"} Graph: ${searchResult.entry.filePath}`,
      content: renderCodeGraphEntry(searchResult),
      createdAt: input.createdAt,
      sourcePath: searchResult.entry.filePath,
      contentHash: searchResult.entry.contentHash,
      metadata: {
        route: "graph",
        packageName: searchResult.entry.packageName,
        isTest: searchResult.entry.isTest,
        matchedTerms: searchResult.matchedTerms,
        matchedSymbols: searchResult.matchedSymbols,
        matchedImports: searchResult.matchedImports,
        relatedFiles: searchResult.relatedFiles
      }
    }),
    routes: ["graph"],
    relevanceScore: searchResult.score,
    freshnessScore: 0.8,
    graphProximityScore: searchResult.score,
    scopeMatchScore: 0.9,
    inclusionReason:
      "code graph matched TypeScript symbols, imports, tests, or changed-file relationships",
    diagnostics: {
      rank: searchResult.rank,
      score: searchResult.score,
      ...searchResult.diagnostics,
      matchedTerms: searchResult.matchedTerms,
      matchedSymbols: searchResult.matchedSymbols,
      matchedImports: searchResult.matchedImports,
      relatedFiles: searchResult.relatedFiles
    }
  });
}

function renderCodeGraphEntry(searchResult: CodeGraphSearchResult): string {
  const entry = searchResult.entry;
  const lines = [
    `file_path: ${entry.filePath}`,
    `package: ${entry.packageName}`,
    `kind: ${entry.isTest ? "test" : "source"}`,
    `graph_score: ${searchResult.score.toFixed(3)}`
  ];
  appendGraphList(lines, "symbols", entry.symbols);
  appendGraphList(lines, "exports", entry.exports);
  appendGraphList(lines, "imports", entry.imports);
  appendGraphList(lines, "related_tests", entry.relatedTests);
  appendGraphList(lines, "matched_terms", searchResult.matchedTerms);
  appendGraphList(lines, "matched_symbols", searchResult.matchedSymbols);
  appendGraphList(lines, "matched_imports", searchResult.matchedImports);
  appendGraphList(lines, "related_files", searchResult.relatedFiles);
  return `${lines.join("\n").trimEnd()}\n`;
}

function appendGraphList(lines: string[], label: string, values: string[]): void {
  if (values.length === 0) {
    return;
  }
  lines.push(`${label}:`);
  for (const value of values.slice(0, 12)) {
    lines.push(`- ${value}`);
  }
}

function recencyCandidates(
  input: ContextRetrieverInput,
  existingCandidates: ContextCandidate[]
): {
  candidates: ContextCandidate[];
  omitted: ContextRetrievalResult["omitted"];
  diagnostics: ContextRetrievalResult["diagnostics"];
} {
  const diagnostics: ContextRetrievalResult["diagnostics"] = [];
  if (input.includeThreadSummary === false) {
    diagnostics.push({
      severity: "info",
      message: input.threadContextDisabledReason ??
        "thread summary context is disabled by context policy"
    });
  }
  if (!input.plan.retrievalRoutes.includes("recency")) {
    return { candidates: [], omitted: [], diagnostics };
  }

  const existingKeys = new Set(
    existingCandidates.map((candidateEntry) =>
      sourceHashKey(candidateEntry.item.sourceId, candidateEntry.item.contentHash)
    )
  );
  const candidates: ContextCandidate[] = [];
  const omitted: ContextRetrievalResult["omitted"] = [];

  for (const [index, source] of (input.recentRunEvidence ?? []).slice(0, 4).entries()) {
    const candidateEntry = recentRunCandidate(source, input, index);
    const key = sourceHashKey(
      candidateEntry.item.sourceId,
      candidateEntry.item.contentHash
    );
    if (existingKeys.has(key)) {
      omitted.push({
        itemId: candidateEntry.item.id,
        layer: candidateEntry.item.layer,
        reason: "recency candidate duplicated an earlier retrieval source"
      });
      continue;
    }
    existingKeys.add(key);
    candidates.push(candidateEntry);
  }

  if (input.threadSummary && input.includeThreadSummary !== false) {
    const candidateEntry = threadSummaryCandidate(input.threadSummary, input);
    const key = sourceHashKey(
      candidateEntry.item.sourceId,
      candidateEntry.item.contentHash
    );
    if (existingKeys.has(key)) {
      omitted.push({
        itemId: candidateEntry.item.id,
        layer: candidateEntry.item.layer,
        reason: "recency thread summary duplicated an earlier retrieval source"
      });
    } else {
      candidates.push(candidateEntry);
    }
  }

  if (candidates.length > 0 || omitted.length > 0) {
    diagnostics.push({
      severity: "info",
      message: "recency retrieval completed",
      metadata: {
        selectedCount: candidates.length,
        omittedDuplicateCount: omitted.length,
        recentRunEvidenceCount: input.recentRunEvidence?.length ?? 0,
        includedThreadSummary: input.threadSummary !== undefined &&
          input.includeThreadSummary !== false
      }
    });
  }

  return { candidates, omitted, diagnostics };
}

function recentRunCandidate(
  source: RecentRunEvidenceContextSource,
  input: ContextRetrieverInput,
  index: number
): ContextCandidate {
  return candidate({
    item: contextItem({
      id: `run_evidence:${source.runId}`,
      layer: "run_evidence",
      sourceKind: "recent_run_summary",
      sourceId: source.runId,
      scope: "run",
      trustLevel: "medium",
      lifetime: "run",
      title: `Recent Run: ${source.taskTitle}`,
      content: renderRecentRunEvidence(source),
      createdAt: source.completedAt ?? source.createdAt,
      metadata: {
        ...source.metadata,
        taskId: source.taskId,
        agentKind: source.agentKind,
        status: source.status,
        completedAt: source.completedAt,
        route: "recency"
      }
    }),
    routes: ["recency"],
    relevanceScore: 0.72,
    freshnessScore: freshnessScoreForRank(index),
    scopeMatchScore: 0.8,
    inclusionReason: "recent run evidence matched the current project recency route"
  });
}

function threadSummaryCandidate(
  summary: ConversationThreadSummary,
  input: ContextRetrieverInput
): ContextCandidate {
  return candidate({
    item: contextItem({
      id: `conversation_summary:${summary.threadId}`,
      layer: "conversation",
      sourceKind: "thread_summary",
      sourceId: summary.threadId,
      scope: "thread",
      trustLevel: "low",
      lifetime: "thread",
      title: "Thread Summary [trust=low]",
      content: renderThreadSummary(summary),
      createdAt: summary.updatedAt,
      metadata: {
        sourceSummaryId: summary.id,
        sourceMessageCount: summary.sourceMessageCount,
        sourceLatestMessageId: summary.sourceLatestMessageId,
        continuityOnly: true,
        mayOverrideCurrentTask: false,
        mayOverrideProjectContext: false,
        mayOverrideApprovedMemory: false,
        route: "recency"
      }
    }),
    routes: ["recency"],
    relevanceScore: 0.52,
    freshnessScore: 0.85,
    scopeMatchScore: 0.7,
    inclusionReason:
      "thread summary was included as low-trust recency continuity"
  });
}

function renderRecentRunEvidence(source: RecentRunEvidenceContextSource): string {
  const lines = [
    `run_id: ${source.runId}`,
    `task_id: ${source.taskId}`,
    `task_title: ${source.taskTitle}`,
    `agent_kind: ${source.agentKind}`,
    `status: ${source.status}`,
    source.completedAt ? `completed_at: ${source.completedAt}` : undefined,
    "",
    source.summary,
    ""
  ].filter((line): line is string => line !== undefined);
  if (source.changedFiles.length > 0) {
    lines.push("changed_files:");
    for (const changedFile of source.changedFiles.slice(0, 12)) {
      lines.push(`- ${changedFile}`);
    }
    lines.push("");
  }
  if (source.verificationSummary) {
    lines.push(`verification_summary: ${source.verificationSummary}`);
  }
  if (source.riskSummary) {
    lines.push(`risk_summary: ${source.riskSummary}`);
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function renderThreadSummary(summary: ConversationThreadSummary): string {
  const lines = [
    "trust: low",
    "purpose: continuity only",
    "may_override_current_task: false",
    "may_override_project_context: false",
    "may_override_approved_memory: false",
    "",
    summary.summary,
    ""
  ];
  if (summary.lastKnownUserGoal) {
    lines.push(`last_known_user_goal: ${summary.lastKnownUserGoal}`);
  }
  appendSummaryList(lines, "decisions", summary.decisions);
  appendSummaryList(lines, "open_items", summary.openItems);
  appendSummaryList(lines, "constraints", summary.constraints);
  return `${lines.join("\n").trimEnd()}\n`;
}

function appendSummaryList(lines: string[], label: string, items: string[]): void {
  const values = items.map((item) => item.trim()).filter(Boolean);
  if (values.length === 0) {
    return;
  }
  lines.push(`${label}:`);
  for (const item of values.slice(0, 8)) {
    lines.push(`- ${item}`);
  }
}

function freshnessScoreForRank(index: number): number {
  return Math.max(0.35, 0.95 - index * 0.12);
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
  diagnostics?: Record<string, unknown>;
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
      routes: input.routes ?? ["explicit"],
      ...(input.diagnostics ?? {})
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

export function extractContextQueryTerms(input: Pick<
  ContextRetrieverInput,
  "taskPrompt" | "selectedFiles" | "selectedRuns"
>): string[] {
  const sources = [
    input.taskPrompt,
    ...(input.selectedFiles ?? []).map((file) => `${file.path}\n${file.title ?? ""}`),
    ...(input.selectedRuns ?? []).map((run) => `${run.title ?? ""}\n${run.summary}`)
  ];
  const terms = new Set<string>();
  for (const source of sources) {
    for (const term of source.split(/[^A-Za-z0-9_./-]+/)) {
      for (const part of term.split(/[^A-Za-z0-9_]+/)) {
        const normalized = part.trim().toLowerCase();
        if (normalized.length < 2 || queryStopWords.has(normalized)) {
          continue;
        }
        terms.add(normalized);
      }
    }
  }
  return [...terms].slice(0, 32);
}

function graphSeedPaths(input: ContextRetrieverInput): string[] {
  return uniqueStrings([
    ...(input.selectedFiles ?? []).map((file) => normalizeSourcePath(file.path))
  ]);
}

function graphChangedFiles(input: ContextRetrieverInput): string[] {
  return uniqueStrings(
    (input.recentRunEvidence ?? []).flatMap((source) =>
      source.changedFiles.map(normalizeSourcePath)
    )
  ).slice(0, 32);
}

const queryStopWords = new Set([
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "from",
  "into",
  "when",
  "then",
  "task",
  "run",
  "fix",
  "add",
  "use",
  "using"
]);

function sourceHashKey(sourceId: string, contentHash: string): string {
  return `${sourceId}:${contentHash}`;
}

function sourceMetadata(section: ContextSection): Record<string, unknown> {
  return section.source as unknown as Record<string, unknown>;
}

function unscopedSkillId(value: string): string {
  const separator = value.indexOf(":");
  return separator === -1 ? value : value.slice(separator + 1);
}

function normalizeSourcePath(value: string): string {
  return value.replace(/\\/g, "/").split(path.sep).join("/").replace(/^\.\//, "");
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort();
}

function contextCandidateRouteCounts(
  candidates: ContextCandidate[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const candidateEntry of candidates) {
    for (const route of candidateEntry.routes) {
      counts[route] = (counts[route] ?? 0) + 1;
    }
  }
  return counts;
}

function secretLikePathReason(value: string): string | undefined {
  const normalized = normalizeSourcePath(value).toLowerCase();
  if (normalized.split("/").some(secretLikePathSegment)) {
    return "secret-like selected file paths are excluded before retrieval";
  }
  return undefined;
}

function secretLikePathSegment(segment: string): boolean {
  return (
    segment === ".env" ||
    segment.startsWith(".env.") ||
    segment === "id_rsa" ||
    segment === "id_ed25519" ||
    segment.endsWith(".pem") ||
    segment.endsWith(".key") ||
    segment.startsWith("secrets.") ||
    segment.startsWith("credentials.") ||
    segment.startsWith("token.")
  );
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
