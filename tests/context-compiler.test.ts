import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DefaultContextCompiler,
  InMemoryMemoryProvider,
  InMemorySkillProvider,
  MarkdownContextFormatter,
  StaticProjectContextProvider,
  appendApprovedMemory,
  buildContextArtifacts,
  exportContextToRepository,
  initContextStore,
  materializeWorktreeOverlay,
  replaceManagedBlock,
  safeWriteFile,
  type MemoryProvider
} from "@agent-hub/context-compiler";
import { createTestDirectory } from "./helpers";

const baseInput = {
  taskPrompt: "Implement the fake run pipeline",
  selectedAgentId: "fake" as const,
  targetRepository: {
    id: "repo_agent_hub",
    name: "agent-hub",
    rootPath: "/workspace/agent-hub"
  }
};

function skillMarkdown(input: {
  name: string;
  description: string;
  body?: string;
}): string {
  return [
    "---",
    `name: ${input.name}`,
    `description: ${input.description}`,
    "---",
    "",
    input.body ?? "Generated skill.",
    ""
  ].join("\n");
}

describe("ContextCompiler", () => {
  it("compiles task-only context", async () => {
    const bundle = await new DefaultContextCompiler().compile(baseInput);

    expect(bundle.sections.map((section) => section.id)).toEqual([
      "task:task",
      "agent:agent",
      "repository:repo_agent_hub"
    ]);
  });

  it("includes project summary", async () => {
    const bundle = await new DefaultContextCompiler({
      projectContextProvider: new StaticProjectContextProvider({
        summary: "Agent Hub is a CLI-first local app."
      })
    }).compile(baseInput);

    expect(
      bundle.sections.find((section) => section.id === "project:summary")?.body
    ).toContain("CLI-first");
  });

  it("includes relevant memories in stable id order", async () => {
    const bundle = await new DefaultContextCompiler({
      memoryProvider: new InMemoryMemoryProvider([
        { id: "memory_b", content: "Second memory" },
        { id: "memory_a", content: "First memory" }
      ])
    }).compile(baseInput);

    expect(
      bundle.sections
        .filter((section) => section.source.kind === "memory")
        .map((section) => section.id)
    ).toEqual(["memory:memory_a", "memory:memory_b"]);
  });

  it("includes relevant skills in stable name order", async () => {
    const bundle = await new DefaultContextCompiler({
      skillProvider: new InMemorySkillProvider([
        {
          id: "skill_z",
          name: "Zeta",
          description: "Use last."
        },
        {
          id: "skill_a",
          name: "Alpha",
          description: "Use first.",
          content: "Workflow steps."
        }
      ])
    }).compile(baseInput);

    expect(
      bundle.sections
        .filter((section) => section.source.kind === "skill")
        .map((section) => section.title)
    ).toEqual(["Skill: Alpha", "Skill: Zeta"]);
  });

  it("handles empty providers", async () => {
    const bundle = await new DefaultContextCompiler({
      memoryProvider: new InMemoryMemoryProvider([]),
      skillProvider: new InMemorySkillProvider([]),
      projectContextProvider: new StaticProjectContextProvider({})
    }).compile(baseInput);

    expect(bundle.warnings).toEqual([]);
    expect(bundle.sections).toHaveLength(3);
  });

  it("preserves deterministic bundles for the same input", async () => {
    const compiler = new DefaultContextCompiler({
      memoryProvider: new InMemoryMemoryProvider([
        { id: "memory_1", content: "Remember this." }
      ])
    });

    await expect(compiler.compile(baseInput)).resolves.toEqual(
      await compiler.compile(baseInput)
    );
  });

  it("formats markdown output", async () => {
    const bundle = await new DefaultContextCompiler({
      projectContextProvider: new StaticProjectContextProvider({
        summary: "Readable markdown matters."
      })
    }).compile(baseInput);

    expect(new MarkdownContextFormatter().format(bundle)).toContain(
      "## Project Summary"
    );
  });

  it("does not write to the target repository", async () => {
    const targetRepository = await createTestDirectory("context-target");
    await fs.writeFile(path.join(targetRepository, "README.md"), "original\n", "utf8");
    const before = await fs.readdir(targetRepository);

    await new DefaultContextCompiler().compile({
      ...baseInput,
      targetRepository: {
        id: "repo_target",
        name: "target",
        rootPath: targetRepository
      }
    });

    await expect(fs.readdir(targetRepository)).resolves.toEqual(before);
    await expect(fs.readFile(path.join(targetRepository, "README.md"), "utf8"))
      .resolves.toBe("original\n");
  });

  it("records provider failures as warnings", async () => {
    const failingProvider: MemoryProvider = {
      async getRelevantMemories() {
        throw new Error("memory backend unavailable");
      }
    };

    const bundle = await new DefaultContextCompiler({
      memoryProvider: failingProvider
    }).compile(baseInput);

    expect(bundle.warnings).toEqual([
      "memory provider failed: memory backend unavailable"
    ]);
  });

  it("initializes and builds an external Agent Hub-owned context store", async () => {
    const projectRoot = await createTestDirectory("context-project");
    const agentHubHome = await createTestDirectory("context-home");

    const initialized = await initContextStore({
      projectRoot,
      projectId: "project_1",
      agentHubHome
    });
    await fs.writeFile(
      path.join(initialized.storeRoot, "context", "project.md"),
      "Agent Hub rebuild notes.\n",
      "utf8"
    );
    await fs.mkdir(path.join(initialized.storeRoot, "skills", "review"), {
      recursive: true
    });
    await fs.writeFile(
      path.join(initialized.storeRoot, "skills", "review", "SKILL.md"),
      skillMarkdown({
        name: "review",
        description: "Review carefully.",
        body: "Use the review checklist."
      }),
      "utf8"
    );

    const built = await buildContextArtifacts({
      projectRoot,
      projectId: "project_1",
      taskId: "task_1",
      title: "Build context",
      prompt: "Compile task context",
      selectedAgentId: "fake",
      agentHubHome
    });

    expect(initialized.storeRoot.startsWith(projectRoot)).toBe(false);
    await expect(fs.readFile(built.contextPackPath, "utf8")).resolves.toContain(
      "Agent Hub rebuild notes"
    );
    await expect(fs.readFile(built.taskBriefPath, "utf8")).resolves.toContain(
      "Compile task context"
    );
    expect(built.contextPack.skillReferences).toEqual(["review"]);
  });

  it("loads file skills from declared metadata", async () => {
    const projectRoot = await createTestDirectory("context-skill-metadata-project");
    const agentHubHome = await createTestDirectory("context-skill-metadata-home");
    const initialized = await initContextStore({
      projectRoot,
      projectId: "project_skill_metadata",
      agentHubHome
    });
    await fs.mkdir(path.join(initialized.storeRoot, "skills", "review"), {
      recursive: true
    });
    await fs.writeFile(
      path.join(initialized.storeRoot, "skills", "review", "SKILL.md"),
      skillMarkdown({
        name: "review-flow",
        description: "Use the declared review flow.",
        body: "Check the diff and tests."
      }),
      "utf8"
    );

    const built = await buildContextArtifacts({
      projectRoot,
      projectId: "project_skill_metadata",
      taskId: "task_skill_metadata",
      title: "Build skill context",
      prompt: "Compile task context",
      selectedAgentId: "fake",
      agentHubHome
    });

    const skillSection = built.bundle.sections.find(
      (section) => section.source.kind === "skill"
    );
    expect(skillSection?.title).toBe("Skill: review-flow");
    expect(skillSection?.body).toContain("Use the declared review flow.");
    expect(skillSection?.body).toContain("Check the diff and tests.");
    expect(skillSection?.body).not.toContain("---");
    expect(built.contextPack.skillReferences).toEqual(["review"]);
    expect(built.warnings).toEqual([]);
  });

  it("warns and skips malformed file skills", async () => {
    const projectRoot = await createTestDirectory("context-malformed-skill-project");
    const agentHubHome = await createTestDirectory("context-malformed-skill-home");
    const initialized = await initContextStore({
      projectRoot,
      projectId: "project_malformed_skill",
      agentHubHome
    });
    await fs.mkdir(path.join(initialized.storeRoot, "skills", "empty"), {
      recursive: true
    });
    await fs.writeFile(
      path.join(initialized.storeRoot, "skills", "empty", "SKILL.md"),
      "\n",
      "utf8"
    );
    await fs.mkdir(path.join(initialized.storeRoot, "skills", "legacy"), {
      recursive: true
    });
    await fs.writeFile(
      path.join(initialized.storeRoot, "skills", "legacy", "SKILL.md"),
      "# Legacy Skill\n\nNo metadata here.\n",
      "utf8"
    );

    const built = await buildContextArtifacts({
      projectRoot,
      projectId: "project_malformed_skill",
      taskId: "task_malformed_skill",
      title: "Build skill context",
      prompt: "Compile task context",
      selectedAgentId: "fake",
      agentHubHome
    });

    expect(built.warnings).toEqual(
      expect.arrayContaining([
        "skill skipped: skills/empty/SKILL.md is empty",
        "skill skipped: skills/legacy/SKILL.md missing required metadata: name, description"
      ])
    );
    expect(built.contextPack.skillReferences).toEqual([]);
    expect(
      built.bundle.sections.some((section) => section.source.kind === "skill")
    ).toBe(false);
  });

  it("warns when optional context store files are missing", async () => {
    const projectRoot = await createTestDirectory("context-missing-project");
    const agentHubHome = await createTestDirectory("context-missing-home");
    const initialized = await initContextStore({
      projectRoot,
      projectId: "project_1",
      agentHubHome
    });
    await fs.rm(path.join(initialized.storeRoot, "context", "security.md"));

    const built = await buildContextArtifacts({
      projectRoot,
      projectId: "project_1",
      taskId: "task_1",
      title: "Build context",
      prompt: "Compile task context",
      selectedAgentId: "fake",
      agentHubHome
    });

    expect(built.warnings).toContain("context file missing: context/security.md");
  });

  it("builds context packs from approved memory written to the context store", async () => {
    const projectRoot = await createTestDirectory("context-approved-memory-project");
    const agentHubHome = await createTestDirectory("context-approved-memory-home");
    await initContextStore({
      projectRoot,
      projectId: "project_memory",
      agentHubHome
    });
    await appendApprovedMemory({
      projectRoot,
      projectId: "project_memory",
      memoryId: "memory_approved",
      content: "Approved memory is available to future task briefs.",
      approvedAt: "2026-01-01T00:00:00.000Z",
      agentHubHome
    });

    const built = await buildContextArtifacts({
      projectRoot,
      projectId: "project_memory",
      taskId: "task_memory",
      title: "Use approved memory",
      prompt: "Build context with approved memory",
      selectedAgentId: "fake",
      agentHubHome
    });

    expect(built.contextPack.approvedMemorySections.join("\n")).toContain(
      "Approved memory is available to future task briefs."
    );
    expect(built.taskBrief.renderedContent).toContain(
      "Approved memory is available to future task briefs."
    );
  });

  it("does not inject the default approved memory placeholder", async () => {
    const projectRoot = await createTestDirectory("context-placeholder-memory-project");
    const agentHubHome = await createTestDirectory("context-placeholder-memory-home");
    await initContextStore({
      projectRoot,
      projectId: "project_placeholder",
      agentHubHome
    });

    const built = await buildContextArtifacts({
      projectRoot,
      projectId: "project_placeholder",
      taskId: "task_placeholder",
      title: "Ignore placeholder memory",
      prompt: "Build context without approved memory",
      selectedAgentId: "fake",
      agentHubHome
    });

    expect(built.contextPack.approvedMemorySections).toEqual([]);
    expect(built.taskBrief.renderedContent).not.toContain("Memory: approved");
    expect(built.taskBrief.renderedContent).not.toContain("# Approved Memory");
  });

  it("exports managed blocks while preserving user content and fenced examples", async () => {
    const projectRoot = await createTestDirectory("context-export-project");
    const agentHubHome = await createTestDirectory("context-export-home");
    const initialized = await initContextStore({
      projectRoot,
      projectId: "project_1",
      agentHubHome
    });
    await fs.writeFile(
      path.join(initialized.storeRoot, "context", "project.md"),
      "Exported project context.\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(projectRoot, "AGENTS.md"),
      [
        "# User Notes",
        "",
        "```html",
        "<!-- agent-hub:start -->",
        "example only",
        "<!-- agent-hub:end -->",
        "```",
        ""
      ].join("\n"),
      "utf8"
    );

    const preview = await exportContextToRepository({
      projectRoot,
      projectId: "project_1",
      agentHubHome,
      dryRun: true
    });
    expect(preview.changedFiles).toContain("AGENTS.md");
    await expect(fs.readFile(path.join(projectRoot, "AGENTS.md"), "utf8"))
      .resolves.toContain("example only");

    await exportContextToRepository({
      projectRoot,
      projectId: "project_1",
      agentHubHome,
      write: true,
      dryRun: false
    });
    const exported = await fs.readFile(path.join(projectRoot, "AGENTS.md"), "utf8");
    expect(exported).toContain("# User Notes");
    expect(exported).toContain("Exported project context.");
    expect(exported.match(/agent-hub:start/g)).toHaveLength(2);

    const replaced = replaceManagedBlock(exported, [
      "<!-- agent-hub:start -->",
      "replacement",
      "<!-- agent-hub:end -->",
      ""
    ].join("\n"));
    expect(replaced).toContain("example only");
    expect(replaced).toContain("replacement");
  });

  it("materializes worktree overlay only in the worktree and records baselines", async () => {
    const worktreePath = await createTestDirectory("context-overlay-worktree");
    const originalPath = await createTestDirectory("context-overlay-original");
    const agentHubHome = await createTestDirectory("context-overlay-home");
    const initialized = await initContextStore({
      projectRoot: originalPath,
      projectId: "project_1",
      agentHubHome
    });
    const built = await buildContextArtifacts({
      projectRoot: originalPath,
      projectId: "project_1",
      taskId: "task_1",
      title: "Overlay",
      prompt: "Write overlay",
      selectedAgentId: "fake",
      deliveryMode: "worktree_overlay",
      agentHubHome
    });

    const overlay = await materializeWorktreeOverlay({
      worktreePath,
      taskId: "task_1",
      contextPack: built.contextPack,
      taskBrief: built.taskBrief,
      contextMarkdown: new MarkdownContextFormatter().format(built.bundle),
      includeAgentFiles: true,
      storeRoot: initialized.storeRoot
    });

    expect(overlay.writtenFiles).toContain("AGENTS.md");
    expect(overlay.baselines.some((entry) => entry.path === "AGENTS.md")).toBe(true);
    await expect(fs.access(path.join(worktreePath, "AGENTS.md"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(originalPath, "AGENTS.md"))).rejects.toThrow();
  });

  it("warns and preserves existing non-empty worktree skill files", async () => {
    const worktreePath = await createTestDirectory("context-overlay-skill-worktree");
    const originalPath = await createTestDirectory("context-overlay-skill-original");
    const agentHubHome = await createTestDirectory("context-overlay-skill-home");
    const initialized = await initContextStore({
      projectRoot: originalPath,
      projectId: "project_1",
      agentHubHome
    });
    await fs.mkdir(path.join(initialized.storeRoot, "skills", "review"), {
      recursive: true
    });
    await fs.writeFile(
      path.join(initialized.storeRoot, "skills", "review", "SKILL.md"),
      skillMarkdown({
        name: "review",
        description: "Review generated output.",
        body: "Generated skill."
      }),
      "utf8"
    );
    const existingSkillPath = path.join(
      worktreePath,
      ".claude",
      "skills",
      "review",
      "SKILL.md"
    );
    await fs.mkdir(path.dirname(existingSkillPath), { recursive: true });
    await fs.writeFile(existingSkillPath, "User skill.\n", "utf8");
    const built = await buildContextArtifacts({
      projectRoot: originalPath,
      projectId: "project_1",
      taskId: "task_1",
      title: "Overlay",
      prompt: "Write overlay",
      selectedAgentId: "fake",
      deliveryMode: "worktree_overlay",
      agentHubHome
    });

    const overlay = await materializeWorktreeOverlay({
      worktreePath,
      taskId: "task_1",
      contextPack: built.contextPack,
      taskBrief: built.taskBrief,
      contextMarkdown: new MarkdownContextFormatter().format(built.bundle),
      includeAgentFiles: true,
      storeRoot: initialized.storeRoot
    });

    expect(overlay.warnings).toContain(
      ".claude/skills/review/SKILL.md already exists and was not overwritten"
    );
    await expect(fs.readFile(existingSkillPath, "utf8")).resolves.toBe("User skill.\n");
    await expect(
      fs.readFile(
        path.join(worktreePath, ".agents", "skills", "review", "SKILL.md"),
        "utf8"
      )
    ).resolves.toBe(
      skillMarkdown({
        name: "review",
        description: "Review generated output.",
        body: "Generated skill."
      })
    );
  });

  it("skips malformed skills during repository export", async () => {
    const projectRoot = await createTestDirectory("context-export-skill-project");
    const agentHubHome = await createTestDirectory("context-export-skill-home");
    const initialized = await initContextStore({
      projectRoot,
      projectId: "project_export_skill",
      agentHubHome
    });
    await fs.mkdir(path.join(initialized.storeRoot, "skills", "review"), {
      recursive: true
    });
    await fs.writeFile(
      path.join(initialized.storeRoot, "skills", "review", "SKILL.md"),
      skillMarkdown({
        name: "review",
        description: "Review exported output.",
        body: "Generated skill."
      }),
      "utf8"
    );
    await fs.mkdir(path.join(initialized.storeRoot, "skills", "legacy"), {
      recursive: true
    });
    await fs.writeFile(
      path.join(initialized.storeRoot, "skills", "legacy", "SKILL.md"),
      "Generated skill without metadata.\n",
      "utf8"
    );

    const preview = await exportContextToRepository({
      projectRoot,
      projectId: "project_export_skill",
      agentHubHome,
      includeSkills: true,
      dryRun: true
    });

    expect(preview.warnings).toContain(
      "skill skipped: skills/legacy/SKILL.md missing required metadata: name, description"
    );
    expect(preview.changedFiles).toContain(".claude/skills/review/SKILL.md");
    expect(preview.changedFiles).toContain(".agents/skills/review/SKILL.md");
    expect(preview.changedFiles).not.toContain(".claude/skills/legacy/SKILL.md");
    expect(preview.changedFiles).not.toContain(".agents/skills/legacy/SKILL.md");
  });

  it("rejects symlink paths for runtime artifacts", async () => {
    const root = await createTestDirectory("context-safe-root");
    const outside = await createTestDirectory("context-safe-outside");
    await fs.symlink(outside, path.join(root, "link"));

    await expect(
      safeWriteFile(path.join(root, "link", "escape.md"), "bad\n", root)
    ).rejects.toThrow("symlink");
  });
});
