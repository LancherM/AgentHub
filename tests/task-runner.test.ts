import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runTask, TaskRunnerError } from "../src/task-runner";

describe("task runner", () => {
  it("runs the fake adapter in an isolated directory without modifying the project root", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-hub-project-"));
    const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-hub-runs-"));
    const projectMarker = path.join(projectRoot, "README.md");
    await fs.writeFile(projectMarker, "original\n", "utf8");
    const before = await fs.readdir(projectRoot);

    const result = await runTask({
      projectRoot,
      runRoot,
      taskPrompt: "Create a deterministic fake output",
      agentKind: "fake",
      taskId: "task_1"
    });

    expect(result.status).toBe("succeeded");
    expect(result.run.status).toBe("succeeded");
    expect(result.worktreePath.startsWith(runRoot)).toBe(true);
    expect(result.taskBriefPath.startsWith(result.worktreePath)).toBe(true);
    await expect(
      fs.readFile(path.join(result.worktreePath, "fake-agent-output.md"), "utf8")
    ).resolves.toContain("Create a deterministic fake output");
    await expect(fs.readFile(projectMarker, "utf8")).resolves.toBe("original\n");
    await expect(fs.readdir(projectRoot)).resolves.toEqual(before);
  });

  it("rejects run roots inside the original project root", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-hub-project-"));

    await expect(
      runTask({
        projectRoot,
        runRoot: path.join(projectRoot, ".agent-hub", "runs"),
        taskPrompt: "This should fail",
        agentKind: "fake"
      })
    ).rejects.toThrow(TaskRunnerError);
  });

  it("rejects unimplemented agents", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-hub-project-"));

    await expect(
      runTask({
        projectRoot,
        taskPrompt: "Run codex",
        agentKind: "codex"
      })
    ).rejects.toThrow("not implemented");
  });
});

