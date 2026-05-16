import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DefaultContextCompiler,
  InMemoryMemoryProvider,
  InMemorySkillProvider,
  MarkdownContextFormatter,
  StaticProjectContextProvider,
  type MemoryProvider
} from "../src/context-compiler";
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
});
