import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ConversationContextBuilder,
  ConversationThreadSummaryBuilder,
  DefaultContextCompiler,
  InMemoryMemoryProvider,
  InMemorySkillProvider,
  MarkdownContextFormatter,
  StaticProjectContextProvider,
  appendApprovedMemory,
  buildContextArtifacts,
  createGlobalSkill,
  exportContextToRepository,
  initContextStore,
  listGlobalSkills,
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

function countOccurrences(content: string, needle: string): number {
  return content.split(needle).length - 1;
}

describe("ContextCompiler", () => {
  it("builds deterministic bounded conversation briefs", () => {
    const builder = new ConversationContextBuilder();
    const input = {
      thread: { id: "thread_1", title: "Persist context", projectId: "project_1" },
      currentTurn: {
        content: "Continue the implementation",
        agentId: "fake",
        contextMode: "workspace",
        deliveryMode: "runtime_injection"
      },
      messages: [
        {
          id: "message_1",
          role: "user" as const,
          content: "First user request"
        },
        {
          id: "message_2",
          role: "tool" as const,
          kind: "run_summary",
          content: "@fake completed",
          summary: "@fake completed: Fake run completed successfully",
          agentId: "fake",
          runId: "run_1",
          status: "succeeded"
        }
      ],
      projectContextReferences: ["project:project_1"]
    };

    const first = builder.build(input);
    const second = builder.build(input);

    expect(first).toEqual(second);
    expect(first.renderedContent).toContain("Continue the implementation");
    expect(first.renderedContent).toContain("First user request");
    expect(first.renderedContent).toContain("Fake run completed successfully");
    expect(first.metadata).toMatchObject({
      includedMessageCount: 2,
      omittedMessageCount: 0,
      maxRecentMessages: expect.any(Number)
    });
  });

  it("applies conversation message count and character budgets", () => {
    const brief = new ConversationContextBuilder().build({
      thread: { id: "thread_budget", title: "Budget" },
      currentTurn: { content: "Now", agentId: "fake" },
      messages: [
        { role: "user", content: "old message" },
        { role: "user", content: "recent message with a very long body" }
      ],
      budget: {
        maxRecentMessages: 1,
        maxPerMessageCharacters: 24,
        maxTotalCharacters: 360
      }
    });

    expect(brief.renderedContent).not.toContain("old message");
    expect(brief.renderedContent).toContain("User: recent message ...");
    expect(brief.renderedContent.length).toBeLessThanOrEqual(360);
    expect(brief.metadata).toMatchObject({
      includedMessageCount: 1,
      omittedMessageCount: 1,
      truncated: true
    });
  });

  it("honors a zero recent-message conversation budget", () => {
    const brief = new ConversationContextBuilder().build({
      thread: { id: "thread_zero_budget", title: "Zero budget", projectId: "project_1" },
      currentTurn: { content: "Current prompt", agentId: "fake" },
      messages: [
        {
          id: "message_1",
          role: "user",
          content: "Prior prompt should be omitted"
        }
      ],
      budget: { maxRecentMessages: 0 }
    });

    expect(brief.metadata.includedMessageCount).toBe(0);
    expect(brief.metadata.omittedMessageCount).toBe(1);
    expect(brief.renderedContent).toContain("No prior thread messages were included.");
    expect(brief.renderedContent).not.toContain("Prior prompt should be omitted");
  });

  it("omits noisy lifecycle, log, verification, diff, and risk messages", () => {
    const brief = new ConversationContextBuilder().build({
      thread: { id: "thread_noise", title: "Noise" },
      currentTurn: { content: "Continue", agentId: "fake" },
      messages: [
        { role: "tool", kind: "run_event", content: "run_started lifecycle" },
        { role: "tool", kind: "log", content: "API_TOKEN=secret-value" },
        { role: "tool", kind: "verification", content: "pnpm test -- simulated" },
        { role: "tool", kind: "diff", content: "diff --git a/.env b/.env" },
        { role: "tool", kind: "risk", content: "Sensitive path changed" },
        { role: "user", content: "Keep this user decision" }
      ]
    });

    expect(brief.renderedContent).toContain("Keep this user decision");
    expect(brief.renderedContent).not.toContain("run_started lifecycle");
    expect(brief.renderedContent).not.toContain("API_TOKEN=secret-value");
    expect(brief.renderedContent).not.toContain("pnpm test -- simulated");
    expect(brief.renderedContent).not.toContain("diff --git");
    expect(brief.renderedContent).not.toContain("Sensitive path changed");
  });

  it("builds conservative thread-local summaries from transcript text", () => {
    const summary = new ConversationThreadSummaryBuilder().build({
      messages: [
        { id: "message_1", role: "user", content: "Decision: keep desktop local-first" },
        { id: "message_2", role: "assistant", content: "Constraint: do not promote thread memory" },
        { id: "message_3", role: "tool", kind: "run_card", content: "@fake completed" },
        { id: "message_4", role: "tool", kind: "diff", content: "diff --git a/.env b/.env" },
        { id: "message_5", role: "user", content: "Follow-up: add CLI inspectability" }
      ]
    });

    expect(summary).toMatchObject({
      decisions: ["keep desktop local-first"],
      openItems: ["add CLI inspectability"],
      constraints: ["do not promote thread memory"],
      lastKnownUserGoal: "Follow-up: add CLI inspectability",
      sourceMessageCount: 3,
      sourceLatestMessageId: "message_5"
    });
    expect(summary.summary).toContain("Last known user goal");
    expect(summary.summary).not.toContain("diff --git");
  });

  it("includes thread summaries after recent messages and before project context", () => {
    const brief = new ConversationContextBuilder().build({
      thread: { id: "thread_summary", title: "Summary", projectId: "project_1" },
      currentTurn: { content: "Continue", agentId: "fake" },
      messages: [{ role: "user", content: "Recent message" }],
      threadSummary: {
        summary: "Summarized 20 thread messages.",
        decisions: ["Use SQLite for local summaries"],
        openItems: ["Expose summary in CLI"],
        constraints: ["Thread memory stays local"],
        lastKnownUserGoal: "Implement Phase 6",
        sourceMessageCount: 20
      },
      projectContextReferences: ["project:project_1"]
    });

    expect(brief.renderedContent.indexOf("## Recent Thread Context"))
      .toBeLessThan(brief.renderedContent.indexOf("## Thread Summary"));
    expect(brief.renderedContent.indexOf("## Thread Summary"))
      .toBeLessThan(brief.renderedContent.indexOf("## Project Context References"));
    expect(brief.renderedContent).toContain("Use SQLite for local summaries");
    expect(brief.metadata).toMatchObject({
      includedThreadSummary: true,
      maxThreadSummaryCharacters: expect.any(Number)
    });
  });

  it("preserves thread summaries within the total conversation budget", () => {
    const brief = new ConversationContextBuilder().build({
      thread: { id: "thread_summary_budget", title: "Summary budget", projectId: "project_1" },
      currentTurn: { content: "Continue", agentId: "fake" },
      messages: Array.from({ length: 12 }, (_, index) => ({
        id: `message_${index}`,
        role: "user" as const,
        content: `Long prior message ${index}: ${"x".repeat(2_100)}`
      })),
      threadSummary: {
        summary: "Summarized older thread decisions.",
        decisions: ["Keep the renderer sandboxed"],
        openItems: ["Run focused regression tests"],
        constraints: ["Do not promote thread summaries to approved memory"],
        lastKnownUserGoal: "Continue the implementation",
        sourceMessageCount: 80
      },
      projectContextReferences: ["project:project_1"]
    });

    expect(brief.renderedContent.length).toBeLessThanOrEqual(12_000);
    expect(brief.renderedContent).toContain("## Thread Summary");
    expect(brief.renderedContent).toContain("Keep the renderer sandboxed");
    expect(brief.renderedContent).toContain("## Project Context References");
    expect(brief.metadata).toMatchObject({
      includedThreadSummary: true,
      truncated: true
    });
    expect(brief.metadata.includedMessageCount).toBeLessThan(12);
  });

  it("includes conversation briefs in context bundles before project context", async () => {
    const bundle = await new DefaultContextCompiler({
      projectContextProvider: new StaticProjectContextProvider({
        summary: "Project context comes after thread context."
      })
    }).compile({
      ...baseInput,
      conversationBrief: "Thread decision: keep the renderer sandboxed."
    });

    expect(bundle.sections.map((section) => section.id)).toEqual([
      "task:task",
      "agent:agent",
      "repository:repo_agent_hub",
      "conversation:thread",
      "project:summary"
    ]);
    expect(
      bundle.sections.find((section) => section.id === "conversation:thread")?.body
    ).toContain("keep the renderer sandboxed");
    expect(
      bundle.sections.find((section) => section.id === "conversation:thread")?.title
    ).toBe("Conversation Continuity [trust=low]");
    expect(
      bundle.sections.find((section) => section.id === "conversation:thread")?.body
    ).toContain("may_override_project_context: false");
  });

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

  it("filters unapproved memory before building runtime context sections", async () => {
    const bundle = await new DefaultContextCompiler({
      memoryProvider: new InMemoryMemoryProvider([
        {
          id: "memory_proposed",
          content: "Proposed memory should stay out.",
          status: "proposed"
        },
        {
          id: "memory_rejected",
          content: "Rejected memory should stay out.",
          status: "rejected"
        },
        {
          id: "memory_approved",
          content: "Approved memory can be used.",
          status: "approved"
        }
      ])
    }).compile(baseInput);

    expect(bundle.sections.map((section) => section.id)).toContain(
      "memory:memory_approved"
    );
    expect(bundle.sections.map((section) => section.id)).not.toContain(
      "memory:memory_proposed"
    );
    expect(bundle.sections.map((section) => section.id)).not.toContain(
      "memory:memory_rejected"
    );
    expect(bundle.filteredItems).toEqual([
      {
        itemId: "memory:memory_proposed",
        layer: "approved_memory",
        reason: "memory status proposed is not approved"
      },
      {
        itemId: "memory:memory_rejected",
        layer: "approved_memory",
        reason: "memory status rejected is not approved"
      }
    ]);
    expect(bundle.warnings.join("\n")).toContain(
      "context policy filtered memory:memory_proposed"
    );
  });

  it("filters secret-like paths, repo agent files, and unsupported skill scopes", async () => {
    const bundle = await new DefaultContextCompiler({
      memoryProvider: new InMemoryMemoryProvider([
        {
          id: "memory_secret",
          content: "Secret-backed memory should stay out.",
          status: "approved",
          sourcePath: "/repo/.env.local"
        }
      ]),
      skillProvider: new InMemorySkillProvider([
        {
          id: "task_skill",
          name: "Task Skill",
          description: "Unsupported task skill.",
          scope: "task"
        },
        {
          id: "agent_file",
          name: "Agent File Skill",
          description: "Repository agent file should stay out.",
          scope: "project",
          sourcePath: "/repo/AGENTS.md"
        },
        {
          id: "valid_skill",
          name: "Valid Skill",
          description: "Project context-store skill.",
          scope: "project",
          sourcePath: "/agent-hub/context/skills/valid/SKILL.md"
        }
      ])
    }).compile(baseInput);

    expect(bundle.sections.map((section) => section.id)).toContain(
      "skill:project:valid_skill"
    );
    expect(bundle.sections.map((section) => section.id)).not.toContain(
      "skill:task:task_skill"
    );
    expect(bundle.sections.map((section) => section.id)).not.toContain(
      "skill:project:agent_file"
    );
    expect(bundle.filteredItems).toHaveLength(3);
    expect(bundle.filteredItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        itemId: "memory:memory_secret",
        layer: "approved_memory",
        reason: "memory source path is secret-like"
      }),
      expect.objectContaining({
        itemId: "skill:task:task_skill",
        layer: "skill",
        reason: "skill scope task is not supported for runtime context"
      }),
      expect.objectContaining({
        itemId: "skill:project:agent_file",
        layer: "skill",
        reason: "skill source path is a repository agent instruction export target"
      })
    ]));
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
    expect(built.contextPack.skillReferences).toEqual(["project:review"]);
    expect(built.contextPack.injectedSkills).toEqual([
      expect.objectContaining({
        id: "review",
        scope: "project",
        name: "review"
      })
    ]);
  });

  it("uses repo-local context storage only when explicitly requested", async () => {
    const projectRoot = await createTestDirectory("context-repo-local");
    const initialized = await initContextStore({
      projectRoot,
      projectId: "project_1",
      mode: "repo_local"
    });

    expect(initialized.mode).toBe("repo_local");
    expect(initialized.storeRoot).toBe(path.join(projectRoot, ".agent-hub"));
    expect(initialized.files).toEqual(
      expect.arrayContaining([
        "context/project.md",
        "memory/approved.md"
      ])
    );
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
    expect(built.contextPack.skillReferences).toEqual(["project:review"]);
    expect(built.warnings).toEqual([]);
  });

  it("resolves project and global skills with deterministic scoped precedence", async () => {
    const projectRoot = await createTestDirectory("context-scoped-skill-project");
    const agentHubHome = await createTestDirectory("context-scoped-skill-home");
    const initialized = await initContextStore({
      projectRoot,
      projectId: "project_scoped_skill",
      agentHubHome
    });
    await createGlobalSkill({
      id: "review",
      name: "global-review",
      description: "Global review method.",
      body: "Use the global review flow.",
      agentHubHome
    });
    const globalTriage = await createGlobalSkill({
      id: "triage",
      name: "global-triage",
      description: "Global triage method.",
      body: "Use the global triage flow.",
      agentHubHome
    });
    await fs.mkdir(path.join(initialized.storeRoot, "skills", "review"), {
      recursive: true
    });
    await fs.writeFile(
      path.join(initialized.storeRoot, "skills", "review", "SKILL.md"),
      skillMarkdown({
        name: "project-review",
        description: "Project review method.",
        body: "Use the project review flow."
      }),
      "utf8"
    );

    const built = await buildContextArtifacts({
      projectRoot,
      projectId: "project_scoped_skill",
      taskId: "task_scoped_skill",
      title: "Build scoped skill context",
      prompt: "Compile task context",
      selectedAgentId: "fake",
      roleSkillReferences: [{ id: "triage", scope: "global" }],
      agentHubHome
    });

    const skillSections = built.bundle.sections.filter(
      (section) => section.source.kind === "skill"
    );
    expect(skillSections.map((section) => section.source.id)).toEqual([
      "global:triage",
      "project:review"
    ]);
    expect(skillSections.map((section) => section.title)).toEqual([
      "Skill: global-triage",
      "Skill: project-review"
    ]);
    expect(built.contextPack.skillReferences).toEqual([
      "global:triage",
      "project:review"
    ]);
    expect(built.contextPack.injectedSkills).toEqual([
      expect.objectContaining({
        id: "triage",
        scope: "global",
        contentHash: globalTriage.contentHash
      }),
      expect.objectContaining({
        id: "review",
        scope: "project"
      })
    ]);
    expect(await listGlobalSkills({ agentHubHome })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "review", scope: "global" }),
        expect.objectContaining({ id: "triage", scope: "global" })
      ])
    );
  });

  it("rejects task and role skill scopes until scoped stores are implemented", async () => {
    const projectRoot = await createTestDirectory("context-unsupported-skill-scope-project");
    const agentHubHome = await createTestDirectory("context-unsupported-skill-scope-home");
    const initialized = await initContextStore({
      projectRoot,
      projectId: "project_unsupported_skill_scope",
      agentHubHome
    });
    await fs.mkdir(path.join(initialized.storeRoot, "skills", "review"), {
      recursive: true
    });
    await fs.writeFile(
      path.join(initialized.storeRoot, "skills", "review", "SKILL.md"),
      skillMarkdown({
        name: "project-review",
        description: "Project review method."
      }),
      "utf8"
    );

    await expect(
      buildContextArtifacts({
        projectRoot,
        projectId: "project_unsupported_skill_scope",
        taskId: "task_unsupported_skill_scope",
        title: "Build unsupported task skill context",
        prompt: "Compile task context",
        selectedAgentId: "fake",
        selectedSkillReferences: [{ id: "review", scope: "task" }],
        agentHubHome
      })
    ).rejects.toThrow("Skill scope task is not supported by context resolution yet");

    await expect(
      buildContextArtifacts({
        projectRoot,
        projectId: "project_unsupported_skill_scope",
        taskId: "role_unsupported_skill_scope",
        title: "Build unsupported role skill context",
        prompt: "Compile role context",
        selectedAgentId: "fake",
        roleSkillReferences: [{ id: "review", scope: "role" }],
        agentHubHome
      })
    ).rejects.toThrow("Skill scope role is not supported by context resolution yet");
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

  it("does not duplicate approved memory by id or identical content", async () => {
    const projectRoot = await createTestDirectory("context-approved-memory-idempotent-project");
    const agentHubHome = await createTestDirectory("context-approved-memory-idempotent-home");
    await initContextStore({
      projectRoot,
      projectId: "project_memory_idempotent",
      agentHubHome
    });
    const first = await appendApprovedMemory({
      projectRoot,
      projectId: "project_memory_idempotent",
      memoryId: "memory_one",
      content: "Use deterministic approved memory writeback.",
      approvedAt: "2026-01-01T00:00:00.000Z",
      agentHubHome
    });
    const repeatById = await appendApprovedMemory({
      projectRoot,
      projectId: "project_memory_idempotent",
      memoryId: "memory_one",
      content: "Use deterministic approved memory writeback.",
      approvedAt: "2026-01-01T00:00:01.000Z",
      agentHubHome
    });
    const repeatByContent = await appendApprovedMemory({
      projectRoot,
      projectId: "project_memory_idempotent",
      memoryId: "memory_two",
      content: "Use deterministic approved memory writeback.",
      approvedAt: "2026-01-01T00:00:02.000Z",
      agentHubHome
    });
    const approvedMemory = await fs.readFile(first.path, "utf8");

    expect(first.written).toBe(true);
    expect(repeatById.written).toBe(false);
    expect(repeatByContent.written).toBe(false);
    expect(
      countOccurrences(
        approvedMemory,
        "Use deterministic approved memory writeback."
      )
    ).toBe(1);
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
      path.join(initialized.storeRoot, "memory", "approved.md"),
      "# Approved Memory\n\nKeep context export memory visible.\n",
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
      target: "repo",
      dryRun: true
    });
    expect(preview.target).toBe("repo");
    expect(preview.approvedMemoryPolicy).toBe("included_when_present");
    expect(preview.changedFiles).toContain("AGENTS.md");
    expect(preview.previews.find((item) => item.path === "AGENTS.md")?.content)
      .toContain("Keep context export memory visible.");
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

  it("preserves user-authored blank lines outside managed blocks", () => {
    const existing = [
      "# User Notes",
      "",
      "",
      "",
      "Keep this spacing.",
      "<!-- agent-hub:start -->",
      "old",
      "<!-- agent-hub:end -->",
      "",
      "",
      "",
      "After block.",
      ""
    ].join("\n");

    const replaced = replaceManagedBlock(existing, [
      "<!-- agent-hub:start -->",
      "new",
      "<!-- agent-hub:end -->",
      ""
    ].join("\n"));

    expect(replaced).toContain("# User Notes\n\n\n\nKeep this spacing.");
    expect(replaced).toContain("<!-- agent-hub:end -->\n\n\n\nAfter block.");
  });

  it("rejects unsupported repository export targets", async () => {
    const projectRoot = await createTestDirectory("context-export-invalid-target-project");
    const agentHubHome = await createTestDirectory("context-export-invalid-target-home");
    await initContextStore({
      projectRoot,
      projectId: "project_1",
      agentHubHome
    });

    await expect(
      exportContextToRepository({
        projectRoot,
        projectId: "project_1",
        agentHubHome,
        target: "workspace" as never,
        dryRun: true
      })
    ).rejects.toThrow("context export target must be repo");
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
    await createGlobalSkill({
      id: "global-only",
      name: "global-only",
      description: "Global skills are runtime-only unless explicitly selected.",
      body: "Do not export by project repo export.",
      agentHubHome
    });

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
    expect(preview.changedFiles).not.toContain(".claude/skills/global-only/SKILL.md");
    expect(preview.changedFiles).not.toContain(".agents/skills/global-only/SKILL.md");
  });

  it("uses context-store skill directory names for export paths", async () => {
    const worktreePath = await createTestDirectory("context-overlay-safe-skill-worktree");
    const projectRoot = await createTestDirectory("context-export-safe-skill-project");
    const agentHubHome = await createTestDirectory("context-export-safe-skill-home");
    const initialized = await initContextStore({
      projectRoot,
      projectId: "project_safe_skill",
      agentHubHome
    });
    await fs.mkdir(path.join(initialized.storeRoot, "skills", "safe-skill"), {
      recursive: true
    });
    await fs.writeFile(
      path.join(initialized.storeRoot, "skills", "safe-skill", "SKILL.md"),
      skillMarkdown({
        name: "..",
        description: "Display names must not control export paths.",
        body: "Generated skill."
      }),
      "utf8"
    );
    const built = await buildContextArtifacts({
      projectRoot,
      projectId: "project_safe_skill",
      taskId: "task_safe_skill",
      title: "Overlay safe skill",
      prompt: "Write overlay",
      selectedAgentId: "fake",
      deliveryMode: "worktree_overlay",
      agentHubHome
    });

    const overlay = await materializeWorktreeOverlay({
      worktreePath,
      taskId: "task_safe_skill",
      contextPack: built.contextPack,
      taskBrief: built.taskBrief,
      contextMarkdown: new MarkdownContextFormatter().format(built.bundle),
      includeAgentFiles: true,
      storeRoot: initialized.storeRoot
    });
    const preview = await exportContextToRepository({
      projectRoot,
      projectId: "project_safe_skill",
      agentHubHome,
      includeSkills: true,
      dryRun: true
    });

    expect(overlay.writtenFiles).toContain(".claude/skills/safe-skill/SKILL.md");
    expect(overlay.writtenFiles).toContain(".agents/skills/safe-skill/SKILL.md");
    expect(overlay.writtenFiles).not.toContain(".claude/SKILL.md");
    expect(overlay.writtenFiles).not.toContain(".agents/SKILL.md");
    await expect(fs.access(path.join(worktreePath, ".claude", "SKILL.md")))
      .rejects.toThrow();
    expect(preview.changedFiles).toContain(".claude/skills/safe-skill/SKILL.md");
    expect(preview.changedFiles).toContain(".agents/skills/safe-skill/SKILL.md");
    expect(preview.changedFiles).not.toContain(".claude/SKILL.md");
    expect(preview.changedFiles).not.toContain(".agents/SKILL.md");
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
