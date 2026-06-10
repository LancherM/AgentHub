import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  nowIso,
  validateContextPack
} from "@agent-hub/core";
import type {
  AgentKind,
  ContextBundle,
  ContextDeliveryMode,
  ContextOmission,
  ContextPack,
  ContextSection,
  ContextStoreMode,
  ContextSourceKind,
  InjectedSkillEvidence,
  MemoryContextItem,
  ProjectContext,
  SkillContextItem,
  SkillReference,
  SkillScope,
  TargetRepositoryMetadata,
  TaskBrief
} from "@agent-hub/shared";
import type { ConversationContextBrief } from "./conversation-context";
import { conversationBriefContent, renderConversationContinuity } from "./conversation-context";
import { policyDecisionForMemory, policyDecisionForSkill } from "./context-policy";
import { buildManagedBlock, replaceManagedBlock } from "./managed-block";
import { createTaskBrief } from "./task-brief";

export * from "./conversation-context";
export * from "./managed-block";
export * from "./task-brief";

export type {
  ContextBundle,
  ContextSection,
  ContextSourceKind,
  InjectedSkillEvidence,
  MemoryContextItem,
  ProjectContext,
  SkillContextItem,
  SkillReference,
  SkillScope,
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
  selectedSkillReferences?: SkillReference[];
  roleSkillReferences?: SkillReference[];
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

export interface ApprovedMemoryRetireInput extends ContextStoreInitInput {
  memoryId: string;
  retiredAt: string;
  reason?: string;
}

export interface ApprovedMemoryWriteResult {
  config: ContextStoreConfig;
  path: string;
  written: boolean;
}

export interface ApprovedMemoryRetireResult {
  config: ContextStoreConfig;
  path: string;
  retired: boolean;
}

export interface ApprovedMemoryPathResult {
  config: ContextStoreConfig;
  path: string;
}

interface StoredSkill {
  id: string;
  name: string;
  description: string;
  content: string;
  scope: SkillScope;
  path?: string;
  contentHash: string;
}

export interface SkillLibraryCreateInput {
  id?: string;
  name: string;
  description: string;
  body?: string;
  content?: string;
  agentHubHome?: string;
  overwrite?: boolean;
}

export interface SkillLibraryListInput {
  agentHubHome?: string;
}

export interface SkillLibraryItem {
  id: string;
  scope: "global";
  name: string;
  description: string;
  path: string;
  contentHash: string;
}

export interface ScopedSkillProviderOptions {
  projectStoreRoot?: string;
  globalStoreRoot?: string;
  selectedSkillReferences?: SkillReference[];
  roleSkillReferences?: SkillReference[];
  includeProjectSkills?: boolean;
  includeGlobalSkillsWithoutReference?: boolean;
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
  selectedSkillReferences?: SkillReference[];
  roleSkillReferences?: SkillReference[];
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
    assertSupportedSkillReferences(input);
    const warnings: string[] = [];
    const filteredItems: ContextOmission[] = [];
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
        section(
          35,
          "conversation",
          "thread",
          "Conversation Continuity [trust=low]",
          renderConversationContinuity(conversationBrief)
        )
      );
    }

    const memories = await safeProvider("memory provider", warnings, () =>
      this.memoryProvider.getRelevantMemories(input)
    );
    warnings.push(...(memories?.warnings ?? []));
    for (const memory of sortById(memories?.items ?? [])) {
      const policyDecision = policyDecisionForMemory(memory);
      if (policyDecision) {
        filteredItems.push(policyDecision.omission);
        warnings.push(policyDecision.warning);
        continue;
      }
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
      const policyDecision = policyDecisionForSkill(skill);
      if (policyDecision) {
        filteredItems.push(policyDecision.omission);
        warnings.push(policyDecision.warning);
        continue;
      }
      const body = [
        skill.description,
        skill.content ? `\n${skill.content}` : undefined
      ].filter(Boolean).join("\n");
      sections.push(skillSection(200, skill, body));
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
      filteredItems,
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
    skillProvider: new ScopedSkillProvider({
      projectStoreRoot: config.storeRoot,
      globalStoreRoot: resolveGlobalSkillStoreRoot({ agentHubHome: input.agentHubHome }),
      selectedSkillReferences: input.selectedSkillReferences,
      roleSkillReferences: input.roleSkillReferences
    })
  });
  const bundle = await compiler.compile({
    taskPrompt: input.prompt,
    selectedAgentId: input.selectedAgentId,
    targetRepository: {
      id: input.projectId,
      name: path.basename(path.resolve(input.projectRoot)),
      rootPath: path.resolve(input.projectRoot)
    },
    selectedSkillReferences: input.selectedSkillReferences,
    roleSkillReferences: input.roleSkillReferences
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
  const { config, path: approvedPath } = resolveApprovedMemoryPath(input);
  const memoryDirectory = path.dirname(approvedPath);
  await fs.mkdir(memoryDirectory, { recursive: true });
  await ensureFile(approvedPath, defaultContextFileContent("memory/approved.md"));
  const existing = await readFileIfExists(approvedPath) ?? "";
  const marker = `<!-- agent-hub:memory ${input.memoryId} -->`;
  if (existing.includes(marker) || hasApprovedMemoryContent(existing, input.content)) {
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

export async function retireApprovedMemory(
  input: ApprovedMemoryRetireInput
): Promise<ApprovedMemoryRetireResult> {
  const { config, path: approvedPath } = resolveApprovedMemoryPath(input);
  await ensureFile(approvedPath, defaultContextFileContent("memory/approved.md"));
  const existing = await readFileIfExists(approvedPath) ?? "";
  const marker = `<!-- agent-hub:memory ${input.memoryId} -->`;
  const chunks = approvedMemoryChunks(existing);
  let retired = false;
  const nextChunks = chunks.map((chunk) => {
    if (!chunk.trimStart().startsWith(marker) || hasRetiredMetadata(chunk)) {
      return chunk;
    }
    retired = true;
    const lines = chunk.replace(/\r\n/g, "\n").split("\n");
    const insertAt = approvedMemoryMetadataInsertIndex(lines);
    lines.splice(
      insertAt,
      0,
      `retired_at: ${input.retiredAt}`,
      ...(input.reason ? [`retired_reason: ${input.reason}`] : [])
    );
    return lines.join("\n");
  });
  if (!retired) {
    return { config, path: approvedPath, retired: false };
  }
  const next = nextChunks.join("\n\n").trimStart();
  await safeWriteFile(approvedPath, `${next.trimEnd()}\n`, config.storeRoot);
  return { config, path: approvedPath, retired: true };
}

export function resolveApprovedMemoryPath(
  input: ContextStoreInitInput
): ApprovedMemoryPathResult {
  const config = resolveContextStoreConfig(input);
  return {
    config,
    path: path.join(config.storeRoot, "memory", "approved.md")
  };
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

function skillSection(
  order: number,
  skill: SkillContextItem,
  body: string
): ContextSection {
  const title = `Skill: ${skill.name}`;
  return {
    id: `skill:${skillContextReferenceId(skill)}`,
    title,
    body,
    source: {
      kind: "skill",
      id: skillContextReferenceId(skill),
      label: title,
      ...(skill.scope ? { scope: skill.scope } : {}),
      ...(skill.contentHash ? { contentHash: skill.contentHash } : {}),
      ...(skill.sourcePath ? { sourcePath: skill.sourcePath } : {}),
      skillName: skill.name,
      skillDescription: skill.description
    } as ContextSection["source"],
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
    const sourcePath = path.join(this.storeRoot, "memory", "approved.md");
    const content = await readFileIfExists(sourcePath);
    if (content === undefined) {
      return { items: [], warnings: ["context file missing: memory/approved.md"] };
    }
    const approvedMemory = approvedMemoryContent(content);
    if (!approvedMemory) {
      return { items: [] };
    }
    return {
      items: [
        {
          id: "approved",
          content: approvedMemory,
          status: "approved",
          sourcePath
        }
      ]
    };
  }
}

class FileSkillProvider implements SkillProvider {
  constructor(
    private readonly storeRoot: string,
    private readonly scope: SkillScope = "project"
  ) {}

  async getRelevantSkills(): Promise<ContextProviderResult<SkillContextItem>> {
    const skills = await readSkillsFromStore(this.storeRoot, this.scope);
    return {
      items: skills.items.map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        content: stripSkillMetadata(skill.content),
        scope: skill.scope,
        contentHash: skill.contentHash,
        sourcePath: skill.path
      })),
      warnings: skills.warnings
    };
  }
}

export class ScopedSkillProvider implements SkillProvider {
  constructor(private readonly options: ScopedSkillProviderOptions) {}

  async getRelevantSkills(): Promise<ContextProviderResult<SkillContextItem>> {
    const warnings: string[] = [];
    const projectSkills = this.options.projectStoreRoot
      ? await readSkillsFromStore(this.options.projectStoreRoot, "project")
      : { items: [] };
    pushWarnings(warnings, projectSkills.warnings);
    const globalSkills = this.options.globalStoreRoot
      ? await readSkillsFromStore(this.options.globalStoreRoot, "global")
      : { items: [] };
    pushWarnings(warnings, globalSkills.warnings);

    const resolved = resolveScopedSkills({
      projectSkills: projectSkills.items,
      globalSkills: globalSkills.items,
      selectedSkillReferences: this.options.selectedSkillReferences,
      roleSkillReferences: this.options.roleSkillReferences,
      includeProjectSkills: this.options.includeProjectSkills ?? true,
      includeGlobalSkillsWithoutReference:
        this.options.includeGlobalSkillsWithoutReference ?? false
    });

    return {
      items: resolved.map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        content: stripSkillMetadata(skill.content),
        scope: skill.scope,
        contentHash: skill.contentHash,
        sourcePath: skill.path
      })),
      ...(warnings.length === 0 ? {} : { warnings })
    };
  }
}

export function resolveGlobalSkillStoreRoot(input: {
  agentHubHome?: string;
} = {}): string {
  return resolveAgentHubHome(input.agentHubHome);
}

export function resolveProjectContextStoreRoot(
  input: ContextStoreInitInput
): string {
  return resolveContextStoreConfig(input).storeRoot;
}

export async function createGlobalSkill(
  input: SkillLibraryCreateInput
): Promise<SkillLibraryItem> {
  const id = sanitizePathSegment(input.id ?? input.name);
  if (!id) {
    throw new Error("skill id is required");
  }
  const storeRoot = resolveGlobalSkillStoreRoot({ agentHubHome: input.agentHubHome });
  const skillPath = path.join(storeRoot, "skills", id, "SKILL.md");
  const existing = await readFileIfExists(skillPath);
  if (existing !== undefined && input.overwrite !== true) {
    throw new Error(`global skill ${id} already exists`);
  }
  const content = input.content ?? renderSkillFileContent(input);
  const parsed = parseStoredSkill(id, content, "global", skillPath);
  if (parsed.skill === undefined) {
    throw new Error(parsed.warning);
  }
  await safeWriteFile(skillPath, content, storeRoot);
  return skillLibraryItem(parsed.skill);
}

export async function listGlobalSkills(
  input: SkillLibraryListInput = {}
): Promise<SkillLibraryItem[]> {
  const skills = await readSkillsFromStore(
    resolveGlobalSkillStoreRoot({ agentHubHome: input.agentHubHome }),
    "global"
  );
  return skills.items.map(skillLibraryItem);
}

export function createStoreContextCompiler(input: {
  projectStoreRoot?: string;
  globalSkillStoreRoot?: string;
  selectedSkillReferences?: SkillReference[];
  roleSkillReferences?: SkillReference[];
}): DefaultContextCompiler {
  return new DefaultContextCompiler({
    projectContextProvider: input.projectStoreRoot
      ? new FileProjectContextProvider(input.projectStoreRoot)
      : undefined,
    memoryProvider: input.projectStoreRoot
      ? new FileMemoryProvider(input.projectStoreRoot)
      : undefined,
    skillProvider: new ScopedSkillProvider({
      projectStoreRoot: input.projectStoreRoot,
      globalStoreRoot: input.globalSkillStoreRoot,
      selectedSkillReferences: input.selectedSkillReferences,
      roleSkillReferences: input.roleSkillReferences
    })
  });
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
    injectedSkills: injectedSkillEvidence(bundle),
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

async function readSkillsFromStore(
  storeRoot: string,
  scope: SkillScope = "project"
): Promise<ContextProviderResult<StoredSkill>> {
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
    const parsed = parseStoredSkill(entry.name, content, scope, skillPath);
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
  const body = normalized.replace(/^# Approved Memory[ \t]*\n+/, "").trim();
  if (!body.includes("<!-- agent-hub:memory ")) {
    return body;
  }
  return approvedMemoryChunks(body)
    .filter((chunk) => !hasRetiredMetadata(chunk))
    .join("\n\n")
    .trim();
}

function approvedMemoryChunks(content: string): string[] {
  return content
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}(?=<!-- agent-hub:memory [^>]+ -->)/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);
}

function hasRetiredMetadata(chunk: string): boolean {
  return /^retired_at:/m.test(chunk);
}

function approvedMemoryMetadataInsertIndex(lines: string[]): number {
  const firstBlank = lines.findIndex((line, index) => index > 0 && line.trim() === "");
  return firstBlank === -1 ? lines.length : firstBlank;
}

function hasApprovedMemoryContent(existing: string, content: string): boolean {
  const expected = normalizeApprovedMemoryEntry(content);
  if (!expected) {
    return false;
  }
  const approved = approvedMemoryContent(existing);
  if (!approved) {
    return false;
  }
  return approved
    .split(/<!--\s*agent-hub:memory\s+[^>]+-->/)
    .map(stripApprovedMemoryEntryMetadata)
    .some((entry) => normalizeApprovedMemoryEntry(entry) === expected);
}

function stripApprovedMemoryEntryMetadata(entry: string): string {
  const lines = entry.trim().split(/\n/);
  if (lines[0]?.startsWith("## ")) {
    lines.shift();
  }
  if (lines[0]?.startsWith("approved_at:")) {
    lines.shift();
  }
  return lines.join("\n").trim();
}

function normalizeApprovedMemoryEntry(content: string): string {
  return content.trim().replace(/\s+/g, " ").toLowerCase();
}

function parseStoredSkill(
  directoryName: string,
  content: string,
  scope: SkillScope = "project",
  filePath?: string
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
      content,
      scope,
      path: filePath,
      contentHash: sha256(content)
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

function resolveScopedSkills(input: {
  projectSkills: StoredSkill[];
  globalSkills: StoredSkill[];
  selectedSkillReferences?: SkillReference[];
  roleSkillReferences?: SkillReference[];
  includeProjectSkills: boolean;
  includeGlobalSkillsWithoutReference: boolean;
}): StoredSkill[] {
  const selected = new Map<string, StoredSkill>();
  const projectById = new Map(input.projectSkills.map((skill) => [skill.id, skill]));
  const globalById = new Map(input.globalSkills.map((skill) => [skill.id, skill]));

  const add = (skill: StoredSkill | undefined): void => {
    if (!skill) {
      return;
    }
    selected.set(skill.id, skill);
  };
  const resolveReference = (reference: SkillReference): StoredSkill | undefined => {
    if (reference.scope === "project") {
      return projectById.get(reference.id);
    }
    if (reference.scope === "global") {
      return globalById.get(reference.id);
    }
    if (reference.scope === "task" || reference.scope === "role") {
      throw new Error(
        `Skill scope ${reference.scope} is not supported by context resolution yet`
      );
    }
    return projectById.get(reference.id) ?? globalById.get(reference.id);
  };

  if (input.includeGlobalSkillsWithoutReference) {
    for (const skill of input.globalSkills) {
      add(skill);
    }
  }
  if (input.includeProjectSkills) {
    for (const skill of input.projectSkills) {
      add(skill);
    }
  }
  for (const reference of input.roleSkillReferences ?? []) {
    add(resolveReference(reference));
  }
  for (const reference of input.selectedSkillReferences ?? []) {
    add(resolveReference(reference));
  }

  return [...selected.values()].sort((left, right) =>
    left.name === right.name
      ? skillContextReferenceId(left).localeCompare(skillContextReferenceId(right))
      : left.name.localeCompare(right.name)
  );
}

function assertSupportedSkillReferences(input: {
  selectedSkillReferences?: SkillReference[];
  roleSkillReferences?: SkillReference[];
}): void {
  for (const reference of [
    ...(input.roleSkillReferences ?? []),
    ...(input.selectedSkillReferences ?? [])
  ]) {
    if (reference.scope === "task" || reference.scope === "role") {
      throw new Error(
        `Skill scope ${reference.scope} is not supported by context resolution yet`
      );
    }
  }
}

export function injectedSkillEvidence(
  bundle: ContextBundle
): InjectedSkillEvidence[] {
  return bundle.sections
    .filter((entry) => entry.source.kind === "skill")
    .map((entry) => skillEvidenceFromSection(entry))
    .filter((entry): entry is InjectedSkillEvidence => entry !== undefined);
}

function skillEvidenceFromSection(
  section: ContextSection
): InjectedSkillEvidence | undefined {
  const metadata = section.source as ContextSection["source"] & {
    scope?: unknown;
    contentHash?: unknown;
    sourcePath?: unknown;
    skillName?: unknown;
    skillDescription?: unknown;
  };
  if (
    metadata.scope !== "task" &&
    metadata.scope !== "role" &&
    metadata.scope !== "project" &&
    metadata.scope !== "global"
  ) {
    return undefined;
  }
  if (
    typeof metadata.contentHash !== "string" ||
    typeof metadata.skillName !== "string" ||
    typeof metadata.skillDescription !== "string"
  ) {
    return undefined;
  }
  return {
    id: unscopedSkillId(section.source.id),
    scope: metadata.scope,
    name: metadata.skillName,
    description: metadata.skillDescription,
    contentHash: metadata.contentHash,
    sourcePath:
      typeof metadata.sourcePath === "string" ? metadata.sourcePath : undefined
  };
}

function skillContextReferenceId(skill: SkillContextItem | StoredSkill): string {
  return skill.scope ? `${skill.scope}:${skill.id}` : skill.id;
}

function unscopedSkillId(value: string): string {
  const match = /^(task|role|project|global):(.+)$/.exec(value);
  return match ? match[2] : value;
}

function renderSkillFileContent(input: SkillLibraryCreateInput): string {
  return [
    "---",
    `name: ${input.name.trim()}`,
    `description: ${input.description.trim()}`,
    "---",
    "",
    (input.body ?? "").trim(),
    ""
  ].join("\n");
}

function skillLibraryItem(skill: StoredSkill): SkillLibraryItem {
  return {
    id: skill.id,
    scope: "global",
    name: skill.name,
    description: skill.description,
    path: skill.path ?? "",
    contentHash: skill.contentHash
  };
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
    return byName === 0
      ? skillContextReferenceId(left).localeCompare(skillContextReferenceId(right))
      : byName;
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
