import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  nowIso,
  validateContextPack,
  validateTaskBrief
} from "@agent-hub/core";
import type {
  AgentKind,
  ContextBundle,
  ContextDeliveryMode,
  ContextPack,
  ContextSection,
  ContextStoreMode,
  ContextSourceKind,
  JsonObject,
  MemoryContextItem,
  ProjectContext,
  SkillContextItem,
  TargetRepositoryMetadata,
  TaskBrief
} from "@agent-hub/shared";

export type {
  ContextBundle,
  ContextSection,
  ContextSourceKind,
  MemoryContextItem,
  ProjectContext,
  SkillContextItem,
  TargetRepositoryMetadata
} from "@agent-hub/shared";

export interface ContextStoreConfig {
  projectRoot: string;
  projectId: string;
  mode: ContextStoreMode;
  storeRoot: string;
}

export interface ContextStoreInitInput {
  projectRoot: string;
  projectId: string;
  mode?: ContextStoreMode;
  agentHubHome?: string;
}

export interface ContextStoreShowResult extends ContextStoreConfig {
  files: string[];
}

export interface ContextBuildInput extends ContextStoreInitInput {
  taskId: string;
  title: string;
  prompt: string;
  selectedAgentId: AgentKind;
  deliveryMode?: ContextDeliveryMode;
  outputRoot?: string;
}

export interface ContextBuildResult {
  config: ContextStoreConfig;
  bundle: ContextBundle;
  contextPack: ContextPack;
  taskBrief: TaskBrief;
  contextPackPath: string;
  taskBriefPath: string;
  warnings: string[];
}

export interface GeneratedFileBaseline {
  path: string;
  sha256: string;
}

export interface WorktreeOverlayResult {
  writtenFiles: string[];
  baselines: GeneratedFileBaseline[];
  warnings: string[];
}

export type ContextExportTarget = "repo";
export type ApprovedMemoryExportPolicy = "included_when_present";

export interface ContextExportInput extends ContextStoreInitInput {
  target?: ContextExportTarget;
  includeAgentsMd?: boolean;
  includeClaudeMd?: boolean;
  includeSkills?: boolean;
  includeApprovedMemory?: boolean;
  dryRun?: boolean;
  write?: boolean;
}

export interface ContextExportResult {
  config: ContextStoreConfig;
  target: ContextExportTarget;
  approvedMemoryPolicy: ApprovedMemoryExportPolicy;
  dryRun: boolean;
  changedFiles: string[];
  warnings: string[];
  previews: Array<{ path: string; content: string }>;
}

export interface ApprovedMemoryWriteInput extends ContextStoreInitInput {
  memoryId: string;
  content: string;
  approvedAt?: string;
}

export interface ApprovedMemoryWriteResult {
  config: ContextStoreConfig;
  path: string;
  written: boolean;
}

interface StoredSkill {
  id: string;
  name: string;
  description: string;
  content: string;
}

export interface ContextProviderResult<T> {
  items: T[];
  warnings?: string[];
}

export interface ContextCompilerInput {
  taskPrompt: string;
  selectedAgentId: AgentKind;
  targetRepository: TargetRepositoryMetadata;
  conversationBrief?: string | ConversationContextBrief;
  userConstraints?: string[];
  executionHints?: string[];
}

export interface ConversationContextBudget {
  maxRecentMessages: number;
  maxTotalCharacters: number;
  maxPerMessageCharacters: number;
  maxThreadSummaryCharacters: number;
  approximateCharsPerToken: number;
}

export interface ConversationContextThread {
  id: string;
  title: string;
  projectId?: string;
}

export interface ConversationContextTurn {
  content: string;
  agentId: string;
  contextMode?: string;
  deliveryMode?: string;
  createdAt?: string;
}

export interface ConversationContextMessage {
  id?: string;
  role: "user" | "assistant" | "system" | "tool";
  kind?: string;
  content: string;
  agentId?: string;
  runId?: string;
  status?: string;
  summary?: string;
  createdAt?: string;
  metadata?: JsonObject;
}

export interface ConversationContextThreadSummary {
  summary: string;
  decisions: string[];
  openItems: string[];
  constraints: string[];
  lastKnownUserGoal?: string;
  sourceMessageCount?: number;
  sourceLatestMessageId?: string;
  updatedAt?: string;
}

export interface ConversationContextBrief {
  renderedContent: string;
  metadata: JsonObject & {
    maxRecentMessages: number;
    maxTotalCharacters: number;
    maxPerMessageCharacters: number;
    approximateTokenCount: number;
    includedMessageCount: number;
    omittedMessageCount: number;
    includedThreadSummary: boolean;
    originalCharacterCount: number;
    renderedCharacterCount: number;
    truncated: boolean;
  };
}

export interface ConversationContextBuildInput {
  thread: ConversationContextThread;
  currentTurn: ConversationContextTurn;
  messages: ConversationContextMessage[];
  threadSummary?: ConversationContextThreadSummary;
  projectContextReferences?: string[];
  budget?: Partial<ConversationContextBudget>;
}

export interface ConversationThreadSummaryBuildInput {
  messages: ConversationContextMessage[];
  maxItems?: number;
  maxItemCharacters?: number;
  maxSummaryCharacters?: number;
}

export interface ConversationThreadSummaryBuildResult {
  summary: string;
  decisions: string[];
  openItems: string[];
  constraints: string[];
  lastKnownUserGoal?: string;
  sourceMessageCount: number;
  sourceLatestMessageId?: string;
  metadata: JsonObject;
}

export interface MemoryProvider {
  getRelevantMemories(
    input: ContextCompilerInput
  ): Promise<ContextProviderResult<MemoryContextItem>>;
}

export interface SkillProvider {
  getRelevantSkills(
    input: ContextCompilerInput
  ): Promise<ContextProviderResult<SkillContextItem>>;
}

export interface ProjectContextProvider {
  getProjectContext(input: ContextCompilerInput): Promise<ProjectContext>;
}

export interface ContextFormatter {
  format(bundle: ContextBundle): string;
}

export interface ContextCompiler {
  compile(input: ContextCompilerInput): Promise<ContextBundle>;
}

export const contextStoreRelativeFiles = [
  "context/project.md",
  "context/architecture.md",
  "context/conventions.md",
  "context/testing.md",
  "context/security.md",
  "memory/approved.md"
] as const;

export const managedBlockStart = "<!-- agent-hub:start -->";
export const managedBlockEnd = "<!-- agent-hub:end -->";

export const defaultConversationContextBudget: ConversationContextBudget = {
  maxRecentMessages: 12,
  maxTotalCharacters: 12_000,
  maxPerMessageCharacters: 2_000,
  maxThreadSummaryCharacters: 2_000,
  approximateCharsPerToken: 4
};

export class ConversationThreadSummaryBuilder {
  build(
    input: ConversationThreadSummaryBuildInput
  ): ConversationThreadSummaryBuildResult {
    const maxItems = input.maxItems ?? 6;
    const maxItemCharacters = input.maxItemCharacters ?? 240;
    const maxSummaryCharacters = input.maxSummaryCharacters ?? 1_200;
    const messages = input.messages.filter(isThreadSummarySourceMessage);
    const sourceLatestMessage = messages.at(-1);
    const lastKnownUserGoal = latestUserGoal(messages, maxItemCharacters);
    const decisions = extractThreadSummaryItems(
      messages,
      threadSummaryDecisionPrefixes,
      maxItems,
      maxItemCharacters
    );
    const openItems = extractThreadSummaryItems(
      messages,
      threadSummaryOpenItemPrefixes,
      maxItems,
      maxItemCharacters
    );
    const constraints = extractThreadSummaryItems(
      messages,
      threadSummaryConstraintPrefixes,
      maxItems,
      maxItemCharacters
    );
    const summary = truncateText(
      renderThreadSummaryText({
        sourceMessageCount: messages.length,
        lastKnownUserGoal,
        decisions,
        openItems,
        constraints
      }),
      maxSummaryCharacters
    );

    return {
      summary,
      decisions,
      openItems,
      constraints,
      lastKnownUserGoal,
      sourceMessageCount: messages.length,
      sourceLatestMessageId: sourceLatestMessage?.id,
      metadata: {
        source: "deterministic_thread_summary_builder",
        maxItems,
        maxItemCharacters,
        maxSummaryCharacters
      }
    };
  }
}

export class ConversationContextBuilder {
  build(input: ConversationContextBuildInput): ConversationContextBrief {
    const budget = {
      ...defaultConversationContextBudget,
      ...(input.budget ?? {})
    };
    const usableMessages =
      budget.maxRecentMessages <= 0
        ? []
        : input.messages
            .filter((message) => !isNoisyConversationMessage(message))
            .slice(-budget.maxRecentMessages);
    const omittedMessageCount = Math.max(0, input.messages.length - usableMessages.length);
    const originalCharacterCount =
      input.currentTurn.content.length +
      threadSummaryCharacterCount(input.threadSummary) +
      input.messages.reduce((total, message) => total + messageContent(message).length, 0);

    const lines: string[] = [
      "# Agent Hub Conversation Brief",
      "",
      `thread_id: ${input.thread.id}`,
      `thread_title: ${input.thread.title}`,
      input.thread.projectId ? `project_id: ${input.thread.projectId}` : undefined,
      `selected_agent: ${input.currentTurn.agentId}`,
      input.currentTurn.contextMode ? `context_mode: ${input.currentTurn.contextMode}` : undefined,
      input.currentTurn.deliveryMode ? `delivery_mode: ${input.currentTurn.deliveryMode}` : undefined,
      "",
      "## Budget",
      "",
      `max_recent_messages: ${budget.maxRecentMessages}`,
      `max_total_characters: ${budget.maxTotalCharacters}`,
      `max_per_message_characters: ${budget.maxPerMessageCharacters}`,
      "",
      "## Current Turn",
      "",
      truncateText(`User: ${input.currentTurn.content}`, budget.maxPerMessageCharacters),
      "",
      "## Recent Thread Context",
      ""
    ].filter((line): line is string => line !== undefined);

    if (usableMessages.length === 0) {
      lines.push("No prior thread messages were included.", "");
    } else {
      for (const message of usableMessages) {
        lines.push(
          `- ${truncateText(formatConversationMessage(message), budget.maxPerMessageCharacters)}`
        );
      }
      lines.push("");
    }

    appendThreadSummarySection(lines, input.threadSummary, budget);

    lines.push("## Project Context References", "");
    const references = (input.projectContextReferences ?? [])
      .map((reference) => reference.trim())
      .filter(Boolean);
    if (references.length === 0) {
      lines.push("- Agent Hub project context store");
    } else {
      for (const reference of references) {
        lines.push(`- ${truncateText(reference, budget.maxPerMessageCharacters)}`);
      }
    }

    const unboundedContent = `${lines.join("\n").trimEnd()}\n`;
    const renderedContent = truncateText(unboundedContent, budget.maxTotalCharacters);
    return {
      renderedContent,
      metadata: {
        maxRecentMessages: budget.maxRecentMessages,
        maxTotalCharacters: budget.maxTotalCharacters,
        maxPerMessageCharacters: budget.maxPerMessageCharacters,
        maxThreadSummaryCharacters: budget.maxThreadSummaryCharacters,
        approximateTokenCount: Math.ceil(
          renderedContent.length / Math.max(1, budget.approximateCharsPerToken)
        ),
        includedMessageCount: usableMessages.length,
        omittedMessageCount,
        includedThreadSummary: hasThreadSummary(input.threadSummary),
        originalCharacterCount,
        renderedCharacterCount: renderedContent.length,
        truncated:
          renderedContent.length < unboundedContent.length ||
          usableMessages.some((message) => messageContent(message).length > budget.maxPerMessageCharacters) ||
          threadSummaryCharacterCount(input.threadSummary) > budget.maxThreadSummaryCharacters
      }
    };
  }
}

const threadSummaryDecisionPrefixes = [
  "decision",
  "decisions",
  "decided",
  "we decided"
];
const threadSummaryOpenItemPrefixes = [
  "open item",
  "open items",
  "todo",
  "follow-up",
  "follow up",
  "next"
];
const threadSummaryConstraintPrefixes = [
  "constraint",
  "constraints",
  "must",
  "do not",
  "don't",
  "non-negotiable"
];

function isThreadSummarySourceMessage(message: ConversationContextMessage): boolean {
  return (
    !isNoisyConversationMessage(message) &&
    message.kind !== "run_card" &&
    message.kind !== "run_summary" &&
    message.metadata?.pending !== true &&
    (message.role === "user" || message.role === "assistant" || message.role === "system") &&
    messageContent(message).length > 0
  );
}

function latestUserGoal(
  messages: ConversationContextMessage[],
  maxCharacters: number
): string | undefined {
  const latestUserMessage = [...messages].reverse().find(
    (message) => message.role === "user" && messageContent(message).length > 0
  );
  return latestUserMessage
    ? truncateText(firstMeaningfulLine(messageContent(latestUserMessage)), maxCharacters)
    : undefined;
}

function extractThreadSummaryItems(
  messages: ConversationContextMessage[],
  prefixes: string[],
  maxItems: number,
  maxCharacters: number
): string[] {
  const items: string[] = [];
  for (const message of messages) {
    for (const line of messageContent(message).split(/\r?\n/)) {
      const item = extractPrefixedItem(line, prefixes);
      if (item && !items.includes(item)) {
        items.push(truncateText(item, maxCharacters));
      }
      if (items.length >= maxItems) {
        return items;
      }
    }
  }
  return items;
}

function extractPrefixedItem(line: string, prefixes: string[]): string | undefined {
  const normalized = line.replace(/^[-*]\s*/, "").trim();
  if (!normalized) {
    return undefined;
  }
  for (const prefix of prefixes) {
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = normalized.match(
      new RegExp(`^${escapedPrefix}\\s*(?:[:：-]|\\bis\\b|\\bare\\b)?\\s*(.+)$`, "i")
    );
    if (match?.[1]?.trim()) {
      return match[1].trim();
    }
  }
  return undefined;
}

function renderThreadSummaryText(input: {
  sourceMessageCount: number;
  lastKnownUserGoal?: string;
  decisions: string[];
  openItems: string[];
  constraints: string[];
}): string {
  const lines = [
    `Summarized ${input.sourceMessageCount} thread messages.`,
    input.lastKnownUserGoal ? `Last known user goal: ${input.lastKnownUserGoal}` : undefined,
    input.decisions.length > 0 ? `Decisions: ${input.decisions.join("; ")}` : undefined,
    input.openItems.length > 0 ? `Open items: ${input.openItems.join("; ")}` : undefined,
    input.constraints.length > 0 ? `Constraints: ${input.constraints.join("; ")}` : undefined
  ].filter((line): line is string => line !== undefined);
  return lines.join("\n");
}

function appendThreadSummarySection(
  lines: string[],
  summary: ConversationContextThreadSummary | undefined,
  budget: ConversationContextBudget
): void {
  if (!hasThreadSummary(summary)) {
    return;
  }
  const summaryLines = [
    "## Thread Summary",
    "",
    truncateText(summary.summary, budget.maxThreadSummaryCharacters),
    ""
  ];
  if (summary.lastKnownUserGoal) {
    summaryLines.push(
      `last_known_user_goal: ${truncateText(summary.lastKnownUserGoal, budget.maxPerMessageCharacters)}`
    );
  }
  appendThreadSummaryList(summaryLines, "decisions", summary.decisions, budget);
  appendThreadSummaryList(summaryLines, "open_items", summary.openItems, budget);
  appendThreadSummaryList(summaryLines, "constraints", summary.constraints, budget);
  summaryLines.push("");
  lines.push(...summaryLines);
}

function appendThreadSummaryList(
  lines: string[],
  label: string,
  items: string[],
  budget: ConversationContextBudget
): void {
  const nonEmptyItems = items.map((item) => item.trim()).filter(Boolean);
  if (nonEmptyItems.length === 0) {
    return;
  }
  lines.push(`${label}:`);
  for (const item of nonEmptyItems) {
    lines.push(`- ${truncateText(item, budget.maxPerMessageCharacters)}`);
  }
}

function threadSummaryCharacterCount(
  summary: ConversationContextThreadSummary | undefined
): number {
  if (!hasThreadSummary(summary)) {
    return 0;
  }
  return [
    summary.summary,
    summary.lastKnownUserGoal,
    ...summary.decisions,
    ...summary.openItems,
    ...summary.constraints
  ].reduce((total, value) => total + (value?.length ?? 0), 0);
}

function hasThreadSummary(
  summary: ConversationContextThreadSummary | undefined
): summary is ConversationContextThreadSummary {
  return summary !== undefined && summary.summary.trim().length > 0;
}

function firstMeaningfulLine(value: string): string {
  return value.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? "";
}

function conversationBriefContent(
  brief: ContextCompilerInput["conversationBrief"]
): string | undefined {
  if (brief === undefined) {
    return undefined;
  }
  const content = typeof brief === "string" ? brief : brief.renderedContent;
  const trimmed = content.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isNoisyConversationMessage(message: ConversationContextMessage): boolean {
  const kind = message.kind?.toLowerCase();
  const phase =
    typeof message.metadata?.phase === "string"
      ? message.metadata.phase.toLowerCase()
      : undefined;
  return (
    kind === "run_event" ||
    kind === "debug" ||
    kind === "lifecycle" ||
    kind === "log" ||
    kind === "verification" ||
    kind === "diff" ||
    kind === "risk" ||
    phase === "lifecycle" ||
    phase === "logs" ||
    phase === "verification"
  );
}

function formatConversationMessage(message: ConversationContextMessage): string {
  const prefix = conversationMessagePrefix(message);
  return `${prefix}: ${messageContent(message)}`;
}

function conversationMessagePrefix(message: ConversationContextMessage): string {
  if (message.role === "user") {
    return "User";
  }
  if (message.role === "system") {
    return "System";
  }
  const agent = message.agentId ? ` @${message.agentId}` : "";
  const run = message.runId ? ` run=${message.runId}` : "";
  const status = message.status ? ` status=${message.status}` : "";
  if (message.role === "assistant") {
    return `Assistant${agent}${run}${status}`;
  }
  return `Run summary${agent}${run}${status}`;
}

function messageContent(message: ConversationContextMessage): string {
  return (message.summary ?? message.content).trim();
}

function truncateText(value: string, maxCharacters: number): string {
  if (maxCharacters <= 0) {
    return "";
  }
  if (value.length <= maxCharacters) {
    return value;
  }
  if (maxCharacters <= 3) {
    return value.slice(0, maxCharacters);
  }
  return `${value.slice(0, maxCharacters - 3)}...`;
}

export interface DefaultContextCompilerOptions {
  memoryProvider?: MemoryProvider;
  skillProvider?: SkillProvider;
  projectContextProvider?: ProjectContextProvider;
}

export class DefaultContextCompiler implements ContextCompiler {
  private readonly memoryProvider: MemoryProvider;
  private readonly skillProvider: SkillProvider;
  private readonly projectContextProvider: ProjectContextProvider;

  constructor(options: DefaultContextCompilerOptions = {}) {
    this.memoryProvider = options.memoryProvider ?? new InMemoryMemoryProvider();
    this.skillProvider = options.skillProvider ?? new InMemorySkillProvider();
    this.projectContextProvider =
      options.projectContextProvider ?? new StaticProjectContextProvider();
  }

  async compile(input: ContextCompilerInput): Promise<ContextBundle> {
    const warnings: string[] = [];
    const sections: ContextSection[] = [
      section(10, "task", "task", "Task Prompt", input.taskPrompt),
      section(20, "agent", "agent", "Selected Agent", input.selectedAgentId),
      section(
        30,
        "repository",
        input.targetRepository.id,
        "Target Repository",
        [
          `name: ${input.targetRepository.name}`,
          `root: ${input.targetRepository.rootPath}`
        ].join("\n")
      )
    ];

    const projectContext = await safeProvider(
      "project context provider",
      warnings,
      () => this.projectContextProvider.getProjectContext(input)
    );
    if (projectContext?.summary?.trim()) {
      sections.push(
        section(40, "project", "summary", "Project Summary", projectContext.summary)
      );
    }
    warnings.push(...(projectContext?.warnings ?? []));

    const conversationBrief = conversationBriefContent(input.conversationBrief);
    if (conversationBrief) {
      sections.push(
        section(35, "conversation", "thread", "Conversation Context", conversationBrief)
      );
    }

    const memories = await safeProvider("memory provider", warnings, () =>
      this.memoryProvider.getRelevantMemories(input)
    );
    warnings.push(...(memories?.warnings ?? []));
    for (const memory of sortById(memories?.items ?? [])) {
      if (memory.content.trim().length === 0) {
        continue;
      }
      sections.push(
        section(100, "memory", memory.id, `Memory: ${memory.id}`, memory.content)
      );
    }

    const skills = await safeProvider("skill provider", warnings, () =>
      this.skillProvider.getRelevantSkills(input)
    );
    warnings.push(...(skills?.warnings ?? []));
    for (const skill of sortSkills(skills?.items ?? [])) {
      const body = [
        skill.description,
        skill.content ? `\n${skill.content}` : undefined
      ].filter(Boolean).join("\n");
      sections.push(
        section(200, "skill", skill.id, `Skill: ${skill.name}`, body)
      );
    }

    for (const [index, constraint] of (input.userConstraints ?? []).entries()) {
      if (constraint.trim().length > 0) {
        sections.push(
          section(
            300 + index,
            "user_constraint",
            `constraint_${index + 1}`,
            `User Constraint ${index + 1}`,
            constraint
          )
        );
      }
    }

    for (const [index, hint] of (input.executionHints ?? []).entries()) {
      if (hint.trim().length > 0) {
        sections.push(
          section(
            400 + index,
            "execution_hint",
            `hint_${index + 1}`,
            `Execution Hint ${index + 1}`,
            hint
          )
        );
      }
    }

    sections.sort((left, right) =>
      left.order === right.order
        ? left.id.localeCompare(right.id)
        : left.order - right.order
    );

    const bundleWithoutId = {
      taskPrompt: input.taskPrompt,
      selectedAgentId: input.selectedAgentId,
      targetRepository: input.targetRepository,
      sections,
      warnings
    };

    return {
      id: `context_${stableHash(bundleWithoutId)}`,
      ...bundleWithoutId
    };
  }
}

export class InMemoryMemoryProvider implements MemoryProvider {
  constructor(private readonly memories: MemoryContextItem[] = []) {}

  async getRelevantMemories(): Promise<ContextProviderResult<MemoryContextItem>> {
    return { items: [...this.memories] };
  }
}

export class InMemorySkillProvider implements SkillProvider {
  constructor(private readonly skills: SkillContextItem[] = []) {}

  async getRelevantSkills(): Promise<ContextProviderResult<SkillContextItem>> {
    return { items: [...this.skills] };
  }
}

export class StaticProjectContextProvider implements ProjectContextProvider {
  constructor(private readonly projectContext: ProjectContext = {}) {}

  async getProjectContext(): Promise<ProjectContext> {
    return { ...this.projectContext };
  }
}

export class MarkdownContextFormatter implements ContextFormatter {
  format(bundle: ContextBundle): string {
    const lines = [
      "# Agent Hub Context Bundle",
      "",
      `bundle_id: ${bundle.id}`,
      `agent: ${bundle.selectedAgentId}`,
      `repository: ${bundle.targetRepository.name}`,
      ""
    ];

    for (const contextSection of bundle.sections) {
      lines.push(`## ${contextSection.title}`);
      lines.push("");
      lines.push(contextSection.body);
      lines.push("");
    }

    if (bundle.warnings.length > 0) {
      lines.push("## Warnings");
      lines.push("");
      for (const warning of bundle.warnings) {
        lines.push(`- ${warning}`);
      }
      lines.push("");
    }

    return lines.join("\n").trimEnd() + "\n";
  }
}

export async function initContextStore(
  input: ContextStoreInitInput
): Promise<ContextStoreShowResult> {
  const config = resolveContextStoreConfig(input);
  await fs.mkdir(config.storeRoot, { recursive: true });
  await fs.mkdir(path.join(config.storeRoot, "context"), { recursive: true });
  await fs.mkdir(path.join(config.storeRoot, "memory"), { recursive: true });
  await fs.mkdir(path.join(config.storeRoot, "skills"), { recursive: true });

  for (const relativeFile of contextStoreRelativeFiles) {
    await ensureFile(path.join(config.storeRoot, relativeFile), defaultContextFileContent(relativeFile));
  }

  return showContextStore(input);
}

export async function showContextStore(
  input: ContextStoreInitInput
): Promise<ContextStoreShowResult> {
  const config = resolveContextStoreConfig(input);
  const files = await listContextStoreFiles(config.storeRoot);
  return { ...config, files };
}

export async function buildContextArtifacts(
  input: ContextBuildInput
): Promise<ContextBuildResult> {
  const config = resolveContextStoreConfig(input);
  const compiler = new DefaultContextCompiler({
    projectContextProvider: new FileProjectContextProvider(config.storeRoot),
    memoryProvider: new FileMemoryProvider(config.storeRoot),
    skillProvider: new FileSkillProvider(config.storeRoot)
  });
  const bundle = await compiler.compile({
    taskPrompt: input.prompt,
    selectedAgentId: input.selectedAgentId,
    targetRepository: {
      id: input.projectId,
      name: path.basename(path.resolve(input.projectRoot)),
      rootPath: path.resolve(input.projectRoot)
    }
  });
  const contextPack = toContextPack(bundle, input);
  const taskBrief = createTaskBrief({
    taskId: input.taskId,
    title: input.title,
    prompt: input.prompt,
    contextPackId: contextPack.id,
    contextMarkdown: new MarkdownContextFormatter().format(bundle)
  });
  const outputRoot =
    input.outputRoot ??
    path.join(config.storeRoot, "artifacts", "tasks", sanitizePathSegment(input.taskId));
  const contextPackPath = path.join(outputRoot, "context-pack.json");
  const taskBriefPath = path.join(outputRoot, "brief.md");
  await safeWriteFile(
    contextPackPath,
    `${JSON.stringify(contextPack, null, 2)}\n`,
    outputRoot
  );
  await safeWriteFile(taskBriefPath, taskBrief.renderedContent, outputRoot);

  return {
    config,
    bundle,
    contextPack,
    taskBrief,
    contextPackPath,
    taskBriefPath,
    warnings: [...bundle.warnings]
  };
}

export async function materializeWorktreeOverlay(input: {
  worktreePath: string;
  taskId: string;
  contextPack: ContextPack;
  taskBrief: TaskBrief;
  contextMarkdown: string;
  includeAgentFiles?: boolean;
  storeRoot?: string;
}): Promise<WorktreeOverlayResult> {
  const worktreePath = path.resolve(input.worktreePath);
  const warnings: string[] = [];
  const writtenFiles: string[] = [];
  const baselines: GeneratedFileBaseline[] = [];
  const files: Array<{ relativePath: string; content: string }> = [
    {
      relativePath: path.join(".agent-hub", "tasks", input.taskId, "brief.md"),
      content: input.taskBrief.renderedContent
    },
    {
      relativePath: path.join(".agent-hub", "tasks", input.taskId, "context-pack.json"),
      content: `${JSON.stringify(input.contextPack, null, 2)}\n`
    }
  ];

  if (input.includeAgentFiles) {
    files.push(
      {
        relativePath: "AGENTS.md",
        content: replaceManagedBlock(
          await readFileIfExists(path.join(worktreePath, "AGENTS.md")),
          buildManagedBlock(input.contextMarkdown)
        )
      },
      {
        relativePath: "CLAUDE.md",
        content: replaceManagedBlock(
          await readFileIfExists(path.join(worktreePath, "CLAUDE.md")),
          buildManagedBlock(input.contextMarkdown)
        )
      }
    );
  }

  if (input.storeRoot) {
    const skills = await readSkillsFromStore(input.storeRoot);
    pushWarnings(warnings, skills.warnings);
    for (const skill of skills.items) {
      for (const base of [".claude/skills", ".agents/skills"]) {
        const relativePath = path.join(base, skillExportDirectory(skill), "SKILL.md");
        const targetPath = path.join(worktreePath, relativePath);
        const existing = await readFileIfExists(targetPath);
        if (existing !== undefined && existing.trim().length > 0 && existing !== skill.content) {
          warnings.push(`${relativePath} already exists and was not overwritten`);
          continue;
        }
        files.push({ relativePath, content: skill.content });
      }
    }
  }

  for (const file of files) {
    const targetPath = path.join(worktreePath, file.relativePath);
    await safeWriteFile(targetPath, file.content, worktreePath);
    writtenFiles.push(file.relativePath);
    baselines.push({ path: normalizeRelativePath(file.relativePath), sha256: sha256(file.content) });
  }

  return { writtenFiles, baselines, warnings };
}

export async function exportContextToRepository(
  input: ContextExportInput
): Promise<ContextExportResult> {
  const target = resolveContextExportTarget(input.target);
  const config = resolveContextStoreConfig(input);
  const dryRun = input.dryRun !== false || input.write !== true;
  const warnings: string[] = [];
  const changedFiles: string[] = [];
  const previews: Array<{ path: string; content: string }> = [];
  const renderedContext = await renderStoreContextMarkdown(config.storeRoot);
  warnings.push(...renderedContext.warnings);
  const contextMarkdown = renderedContext.markdown;
  const targets: string[] = [];
  if (input.includeAgentsMd !== false) {
    targets.push("AGENTS.md");
  }
  if (input.includeClaudeMd !== false) {
    targets.push("CLAUDE.md");
  }

  for (const relativePath of targets) {
    const targetPath = path.join(config.projectRoot, relativePath);
    const nextContent = replaceManagedBlock(
      await readFileIfExists(targetPath),
      buildManagedBlock(contextMarkdown)
    );
    changedFiles.push(relativePath);
    previews.push({ path: relativePath, content: nextContent });
    if (!dryRun) {
      await safeWriteFile(targetPath, nextContent, config.projectRoot);
    }
  }

  if (input.includeSkills) {
    const skills = await readSkillsFromStore(config.storeRoot);
    pushWarnings(warnings, skills.warnings);
    for (const skill of skills.items) {
      for (const base of [".claude/skills", ".agents/skills"]) {
        const relativePath = path.join(base, skillExportDirectory(skill), "SKILL.md");
        const targetPath = path.join(config.projectRoot, relativePath);
        changedFiles.push(normalizeRelativePath(relativePath));
        previews.push({ path: normalizeRelativePath(relativePath), content: skill.content });
        if (!dryRun) {
          await safeWriteFile(targetPath, skill.content, config.projectRoot);
        }
      }
    }
  }

  if (input.includeApprovedMemory) {
    warnings.push(
      "--include-approved-memory is already the default for repo context export"
    );
  }

  return {
    config,
    target,
    approvedMemoryPolicy: "included_when_present",
    dryRun,
    changedFiles,
    warnings,
    previews
  };
}

export async function appendApprovedMemory(
  input: ApprovedMemoryWriteInput
): Promise<ApprovedMemoryWriteResult> {
  const config = resolveContextStoreConfig(input);
  const memoryDirectory = path.join(config.storeRoot, "memory");
  const approvedPath = path.join(memoryDirectory, "approved.md");
  await fs.mkdir(memoryDirectory, { recursive: true });
  await ensureFile(approvedPath, defaultContextFileContent("memory/approved.md"));
  const existing = await readFileIfExists(approvedPath) ?? "";
  const marker = `<!-- agent-hub:memory ${input.memoryId} -->`;
  if (existing.includes(marker)) {
    return { config, path: approvedPath, written: false };
  }
  const entry = [
    marker,
    `## ${input.memoryId}`,
    input.approvedAt ? `approved_at: ${input.approvedAt}` : undefined,
    "",
    input.content.trim(),
    ""
  ].filter((line) => line !== undefined).join("\n");
  const next = `${existing.trimEnd()}\n\n${entry}`.trimStart();
  await safeWriteFile(approvedPath, `${next.trimEnd()}\n`, config.storeRoot);
  return { config, path: approvedPath, written: true };
}

export function createTaskBrief(input: {
  taskId: string;
  title: string;
  prompt?: string;
  contextPackId: string;
  contextMarkdown: string;
  createdAt?: string;
}): TaskBrief {
  const renderedContent = [
    "# Agent Hub Task Brief",
    "",
    `Task ID: ${input.taskId}`,
    `Title: ${input.title}`,
    "",
    "## Prompt",
    "",
    input.prompt ?? input.title,
    "",
    "## Context",
    "",
    input.contextMarkdown || "No project context is available."
  ].join("\n");

  return validateTaskBrief({
    taskId: input.taskId,
    taskTitle: input.title,
    taskPrompt: input.prompt,
    renderedContent,
    contextPackId: input.contextPackId,
    createdAt: input.createdAt ?? nowIso()
  });
}

function section(
  order: number,
  kind: ContextSourceKind,
  id: string,
  title: string,
  body: string
): ContextSection {
  return {
    id: `${kind}:${id}`,
    title,
    body,
    source: {
      kind,
      id,
      label: title
    },
    order
  };
}

class FileProjectContextProvider implements ProjectContextProvider {
  constructor(private readonly storeRoot: string) {}

  async getProjectContext(): Promise<ProjectContext> {
    const parts: string[] = [];
    const warnings: string[] = [];
    for (const relativeFile of [
      "context/project.md",
      "context/architecture.md",
      "context/conventions.md",
      "context/testing.md",
      "context/security.md"
    ]) {
      const content = await readFileIfExists(path.join(this.storeRoot, relativeFile));
      if (content === undefined) {
        warnings.push(`context file missing: ${relativeFile}`);
        continue;
      }
      if (content?.trim()) {
        parts.push(`## ${relativeFile}\n\n${content.trim()}`);
      }
    }
    return {
      ...(parts.length === 0 ? {} : { summary: parts.join("\n\n") }),
      ...(warnings.length === 0 ? {} : { warnings })
    };
  }
}

class FileMemoryProvider implements MemoryProvider {
  constructor(private readonly storeRoot: string) {}

  async getRelevantMemories(): Promise<ContextProviderResult<MemoryContextItem>> {
    const content = await readFileIfExists(path.join(this.storeRoot, "memory", "approved.md"));
    if (content === undefined) {
      return { items: [], warnings: ["context file missing: memory/approved.md"] };
    }
    const approvedMemory = approvedMemoryContent(content);
    if (!approvedMemory) {
      return { items: [] };
    }
    return { items: [{ id: "approved", content: approvedMemory }] };
  }
}

class FileSkillProvider implements SkillProvider {
  constructor(private readonly storeRoot: string) {}

  async getRelevantSkills(): Promise<ContextProviderResult<SkillContextItem>> {
    const skills = await readSkillsFromStore(this.storeRoot);
    return {
      items: skills.items.map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        content: stripSkillMetadata(skill.content)
      })),
      warnings: skills.warnings
    };
  }
}

function resolveContextStoreConfig(input: ContextStoreInitInput): ContextStoreConfig {
  const projectRoot = path.resolve(input.projectRoot);
  const mode = input.mode ?? "external";
  const storeRoot =
    mode === "repo_local"
      ? path.join(projectRoot, ".agent-hub")
      : path.join(resolveAgentHubHome(input.agentHubHome), "context-stores", sanitizePathSegment(input.projectId));
  return {
    projectRoot,
    projectId: input.projectId,
    mode,
    storeRoot
  };
}

function resolveContextExportTarget(target: ContextExportInput["target"]): ContextExportTarget {
  if (target === undefined || target === "repo") {
    return "repo";
  }
  throw new Error("context export target must be repo");
}

function resolveAgentHubHome(agentHubHome?: string): string {
  if (agentHubHome) {
    return path.resolve(agentHubHome);
  }
  if (process.env.AGENT_HUB_HOME) {
    return path.resolve(process.env.AGENT_HUB_HOME);
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Agent Hub");
  }
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA ?? os.homedir(), "Agent Hub");
  }
  return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"), "agent-hub");
}

function toContextPack(bundle: ContextBundle, input: ContextBuildInput): ContextPack {
  return validateContextPack({
    id: bundle.id,
    projectId: input.projectId,
    taskId: input.taskId,
    taskTitle: input.title,
    taskPrompt: input.prompt,
    deliveryMode: input.deliveryMode ?? "runtime_injection",
    contextSections: bundle.sections.map((entry) => `${entry.title}\n\n${entry.body}`),
    approvedMemorySections: bundle.sections
      .filter((entry) => entry.source.kind === "memory")
      .map((entry) => entry.body),
    skillReferences: bundle.sections
      .filter((entry) => entry.source.kind === "skill")
      .map((entry) => entry.source.id),
    createdAt: nowIso()
  });
}

async function listContextStoreFiles(storeRoot: string): Promise<string[]> {
  const files: string[] = [];
  await collectFiles(storeRoot, storeRoot, files);
  return files.sort();
}

async function collectFiles(root: string, directory: string, files: string[]): Promise<void> {
  let entries: Array<import("node:fs").Dirent>;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(root, entryPath, files);
      continue;
    }
    if (entry.isFile()) {
      files.push(normalizeRelativePath(path.relative(root, entryPath)));
    }
  }
}

async function ensureFile(filePath: string, content: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    await safeWriteFile(filePath, content, path.dirname(path.dirname(filePath)));
  }
}

async function readSkillsFromStore(storeRoot: string): Promise<ContextProviderResult<StoredSkill>> {
  const skillsRoot = path.join(storeRoot, "skills");
  let entries: Array<import("node:fs").Dirent>;
  try {
    entries = await fs.readdir(skillsRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { items: [] };
    }
    throw error;
  }
  const skills: StoredSkill[] = [];
  const warnings: string[] = [];
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of directories) {
    if (!entry.isDirectory()) {
      continue;
    }
    const skillPath = path.join(skillsRoot, entry.name, "SKILL.md");
    const content = await readFileIfExists(skillPath);
    if (content === undefined) {
      warnings.push(`skill skipped: skills/${entry.name}/SKILL.md is missing`);
      continue;
    }
    const parsed = parseStoredSkill(entry.name, content);
    if (parsed.skill === undefined) {
      warnings.push(parsed.warning);
      continue;
    }
    skills.push(parsed.skill);
  }
  return {
    items: skills.sort((left, right) =>
      left.name === right.name
        ? left.id.localeCompare(right.id)
        : left.name.localeCompare(right.name)
    ),
    ...(warnings.length === 0 ? {} : { warnings })
  };
}

async function renderStoreContextMarkdown(
  storeRoot: string
): Promise<{ markdown: string; warnings: string[] }> {
  const compiler = new DefaultContextCompiler({
    projectContextProvider: new FileProjectContextProvider(storeRoot),
    memoryProvider: new FileMemoryProvider(storeRoot),
    skillProvider: new FileSkillProvider(storeRoot)
  });
  const bundle = await compiler.compile({
    taskPrompt: "Repository context export",
    selectedAgentId: "fake",
    targetRepository: { id: "repo_export", name: "repository", rootPath: storeRoot }
  });
  return {
    markdown: new MarkdownContextFormatter().format(bundle),
    warnings: bundle.warnings
  };
}

function buildManagedBlock(content: string): string {
  return [
    managedBlockStart,
    "# Agent Hub Shared Context",
    "",
    "This content is exported from the Agent Hub context store.",
    "Preserve user-authored content outside this managed block.",
    "",
    content.trim() || "_No project context is available yet._",
    managedBlockEnd,
    ""
  ].join("\n");
}

export function replaceManagedBlock(existing: string | undefined, block: string): string {
  if (!existing) {
    return block.endsWith("\n") ? block : `${block}\n`;
  }

  const lines = existing.split(/\n/);
  let inFence = false;
  let start = -1;
  let end = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
    }
    if (inFence) {
      continue;
    }
    if (trimmed === managedBlockStart) {
      start = index;
    }
    if (start !== -1 && trimmed === managedBlockEnd) {
      end = index;
      break;
    }
  }

  const blockLines = block.trimEnd().split(/\n/);
  const nextLines =
    start !== -1 && end !== -1
      ? [...lines.slice(0, start), ...blockLines, ...lines.slice(end + 1)]
      : [...lines, ...(existing.endsWith("\n") ? [] : [""]), ...blockLines];
  return `${nextLines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

export async function safeWriteFile(
  filePath: string,
  content: string,
  rootPath: string
): Promise<void> {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedFile = path.resolve(filePath);
  if (!isPathInside(resolvedFile, resolvedRoot)) {
    throw new Error("refusing to write outside the target root");
  }
  await rejectSymlinkPath(resolvedRoot, resolvedFile);
  await fs.mkdir(path.dirname(resolvedFile), { recursive: true });
  await fs.writeFile(resolvedFile, content, "utf8");
}

async function rejectSymlinkPath(rootPath: string, filePath: string): Promise<void> {
  const relative = path.relative(rootPath, filePath);
  const segments = relative.split(path.sep).filter(Boolean);
  let current = rootPath;
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) {
        throw new Error(`refusing to write through symlink: ${current}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }
  }
}

async function readFileIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function defaultContextFileContent(relativeFile: string): string {
  if (relativeFile === "memory/approved.md") {
    return "# Approved Memory\n\n";
  }
  return `# ${relativeFile.replace(/\.md$/, "")}\n\n`;
}

function approvedMemoryContent(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (normalized === "# Approved Memory") {
    return "";
  }
  return normalized.replace(/^# Approved Memory[ \t]*\n+/, "").trim();
}

function parseStoredSkill(
  directoryName: string,
  content: string
): { skill: StoredSkill; warning?: undefined } | { skill?: undefined; warning: string } {
  if (content.trim().length === 0) {
    return { warning: `skill skipped: skills/${directoryName}/SKILL.md is empty` };
  }
  const metadata = parseSkillMetadata(content);
  const name = metadata.name?.trim();
  const description = metadata.description?.trim();
  if (!name || !description) {
    const missing = [
      name ? undefined : "name",
      description ? undefined : "description"
    ].filter((entry): entry is string => entry !== undefined);
    return {
      warning: `skill skipped: skills/${directoryName}/SKILL.md missing required metadata: ${missing.join(", ")}`
    };
  }
  return {
    skill: {
      id: directoryName,
      name,
      description,
      content
    }
  };
}

function parseSkillMetadata(content: string): Partial<Record<"name" | "description", string>> {
  const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0]?.trim() !== "---") {
    return {};
  }
  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (endIndex === -1) {
    return {};
  }
  const metadata: Partial<Record<"name" | "description", string>> = {};
  for (const line of lines.slice(1, endIndex)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    const key = match[1];
    if (key === "name" || key === "description") {
      metadata[key] = unquoteMetadataValue(match[2].trim());
    }
  }
  return metadata;
}

function stripSkillMetadata(content: string): string | undefined {
  const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0]?.trim() !== "---") {
    return content;
  }
  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (endIndex === -1) {
    return content;
  }
  const body = lines.slice(endIndex + 1).join("\n").trim();
  return body.length > 0 ? body : undefined;
}

function skillExportDirectory(skill: StoredSkill): string {
  return sanitizePathSegment(skill.id);
}

function unquoteMetadataValue(value: string): string {
  const singleQuoted = /^'(.*)'$/.exec(value);
  if (singleQuoted) {
    return singleQuoted[1];
  }
  const doubleQuoted = /^"(.*)"$/.exec(value);
  if (doubleQuoted) {
    return doubleQuoted[1];
  }
  return value;
}

function pushWarnings(warnings: string[], nextWarnings: string[] | undefined): void {
  for (const warning of nextWarnings ?? []) {
    if (!warnings.includes(warning)) {
      warnings.push(warning);
    }
  }
}

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join("/");
}

function sanitizePathSegment(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized.length > 0 ? sanitized : "context";
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function isPathInside(candidatePath: string, parentPath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

async function safeProvider<T>(
  label: string,
  warnings: string[],
  load: () => Promise<T>
): Promise<T | undefined> {
  try {
    return await load();
  } catch (error) {
    warnings.push(
      `${label} failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return undefined;
  }
}

function sortById<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => left.id.localeCompare(right.id));
}

function sortSkills(skills: SkillContextItem[]): SkillContextItem[] {
  return [...skills].sort((left, right) => {
    const byName = left.name.localeCompare(right.name);
    return byName === 0 ? left.id.localeCompare(right.id) : byName;
  });
}

function stableHash(value: unknown): string {
  return createHash("sha256")
    .update(stableStringify(value))
    .digest("hex")
    .slice(0, 16);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right)
    );
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}
