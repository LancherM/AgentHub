import { createHash } from "node:crypto";
import type { AgentKind } from "./domain";

export type ContextSourceKind =
  | "task"
  | "agent"
  | "repository"
  | "project"
  | "memory"
  | "skill"
  | "user_constraint"
  | "execution_hint";

export interface TargetRepositoryMetadata {
  id: string;
  name: string;
  rootPath: string;
}

export interface ContextSource {
  kind: ContextSourceKind;
  id: string;
  label: string;
}

export interface ContextSection {
  id: string;
  title: string;
  body: string;
  source: ContextSource;
  order: number;
}

export interface ContextBundle {
  id: string;
  taskPrompt: string;
  selectedAgentId: AgentKind;
  targetRepository: TargetRepositoryMetadata;
  sections: ContextSection[];
  warnings: string[];
}

export interface MemoryContextItem {
  id: string;
  content: string;
}

export interface SkillContextItem {
  id: string;
  name: string;
  description: string;
  content?: string;
}

export interface ProjectContext {
  summary?: string;
}

export interface ContextProviderResult<T> {
  items: T[];
  warnings?: string[];
}

export interface ContextCompilerInput {
  taskPrompt: string;
  selectedAgentId: AgentKind;
  targetRepository: TargetRepositoryMetadata;
  userConstraints?: string[];
  executionHints?: string[];
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

