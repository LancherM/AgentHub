import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createCliRuntime, main } from "@agent-hub/cli";
import {
  conservativePermissionSet,
  type RoleCall
} from "@agent-hub/core";
import { runTuiCommand } from "../apps/cli/src/tui";

const now = "2026-05-29T12:00:00.000Z";
const projectRoot = "/tmp/tui-project";

describe("CLI TUI command", () => {
  it("prints help without opening the terminal shell", async () => {
    const runtime = createCliRuntime({ storageMode: "memory" });
    const output: string[] = [];
    const errors: string[] = [];

    await expect(
      main(["tui", "--help"], testIo(output, errors), process.cwd(), runtime)
    ).resolves.toBe(0);

    expect(errors.join("")).toBe("");
    expect(output.join("")).toContain("agent-hub tui");
    expect(output.join("")).toContain("--thread <thread-id>");
  });

  it("renders a read-only current-context workbench by room selector", async () => {
    const runtime = createCliRuntime({ storageMode: "memory" });
    await seedTuiContext(runtime);
    const output: string[] = [];
    const errors: string[] = [];

    await expect(
      main(
        [
          "--project",
          projectRoot,
          "tui",
          "--room",
          "review",
          "--agent",
          "codex",
          "--once"
        ],
        testIo(output, errors),
        process.cwd(),
        runtime
      )
    ).resolves.toBe(0);

    const rendered = output.join("");
    expect(errors.join("")).toBe("");
    expect(rendered).toContain("Agent Hub  TUI Project  #review");
    expect(rendered).toContain("@codex");
    expect(rendered).toContain("Transcript");
    expect(rendered).toContain("RoleCalls");
    expect(rendered).toContain("@engineer -> @reviewer [running]");
    expect(rendered).toContain("Runs");
    expect(rendered).toContain("run_1 @codex running");
    expect(rendered).toContain("> @codex prompt");
  });

  it("renders missing registration recovery instead of failing launch", async () => {
    const runtime = createCliRuntime({ storageMode: "memory" });
    const output: string[] = [];
    const errors: string[] = [];

    await expect(
      main(
        ["--project", "/tmp/unregistered-tui-project", "tui", "--once"],
        testIo(output, errors),
        process.cwd(),
        runtime
      )
    ).resolves.toBe(0);

    const rendered = output.join("");
    expect(errors.join("")).toBe("");
    expect(rendered).toContain("Agent Hub  unregistered  no-thread");
    expect(rendered).toContain("recovery: agent-hub project add --name <name>");
    expect(rendered).toContain("none | loop stop terminal");
  });

  it("renders context-read failures with CLI recovery commands", async () => {
    const runtime = createCliRuntime({ storageMode: "memory" });
    await runtime.projectRepository.create({
      id: "project_broken",
      name: "Broken TUI",
      rootPath: "/tmp/broken-tui",
      createdAt: now,
      updatedAt: now
    });
    const brokenRuntime = {
      ...runtime,
      conversationThreadRepository: {
        create: runtime.conversationThreadRepository.create.bind(runtime.conversationThreadRepository),
        update: runtime.conversationThreadRepository.update.bind(runtime.conversationThreadRepository),
        get: runtime.conversationThreadRepository.get.bind(runtime.conversationThreadRepository),
        list: async () => {
          throw new Error("database read failed");
        }
      }
    };
    const output: string[] = [];
    const errors: string[] = [];

    await expect(
      runTuiCommand({
        args: ["--once"],
        io: testIo(output, errors),
        cwd: process.cwd(),
        projectRoot: "/tmp/broken-tui",
        runtime: brokenRuntime
      })
    ).resolves.toBe(0);

    const rendered = output.join("");
    expect(errors.join("")).toBe("");
    expect(rendered).toContain("failed to read TUI context: database read failed");
    expect(rendered).toContain("TUI context unavailable");
    expect(rendered).toContain("agent-hub project list");
  });

  it("smoke launches the interactive TUI and exits immediately without raw mode", async () => {
    const runtime = createCliRuntime({ storageMode: "memory" });
    await seedTuiContext(runtime);
    const input = new PassThrough() as PassThrough & { isTTY: boolean };
    input.isTTY = true;
    const output: string[] = [];
    const errors: string[] = [];

    await expect(
      main(
        ["--project", projectRoot, "tui"],
        interactiveIo(input, output, errors),
        process.cwd(),
        runtime
      )
    ).resolves.toBe(0);
    expect(errors.join("")).toBe("");
    expect(output.join("")).toContain("Agent Hub  TUI Project  #review");
  });

  it("submits prompts through the CLI chat path and keeps unknown mentions as text", async () => {
    const runtime = createCliRuntime({ storageMode: "memory" });
    const root = createGitFixture();
    const workspaceBase = fs.mkdtempSync(path.join(os.tmpdir(), "agent-hub-tui-worktrees-"));
    await runtime.projectRepository.create({
      id: "project_submit",
      name: "Submit Project",
      rootPath: root,
      createdAt: now,
      updatedAt: now
    });
    await runtime.conversationThreadRepository.create({
      id: "thread_submit",
      projectId: "project_submit",
      title: "Submit Room",
      metadata: { roomHandle: "submit" },
      createdAt: now,
      updatedAt: now
    });
    const output: string[] = [];
    const errors: string[] = [];

    await expect(
      main(
        [
          "--project",
          root,
          "tui",
          "--room",
          "submit",
          "--debug",
          "--agent",
          "fake",
          "--workspace-base",
          workspaceBase,
          "--submit",
          "@fake summarize @unknown mention",
          "--once"
        ],
        testIo(output, errors),
        process.cwd(),
        runtime
      )
    ).resolves.toBe(0);

    expect(errors.join("")).toBe("");
    const messages = await runtime.conversationMessageRepository.listByThreadId(
      "thread_submit"
    );
    expect(messages.map((message) => message.role)).toContain("user");
    const userMessage = messages.find((message) => message.role === "user");
    expect(userMessage?.content).toBe("summarize @unknown mention");
    expect(userMessage?.metadata?.source).toBe("cli_chat");
    const rendered = output.join("");
    expect(rendered).toContain("Submitted prompt to #submit.");
    expect(rendered).toContain("run_");
    expect(rendered).not.toContain("run_summary:");
    expect(rendered).not.toContain("## Context");
  });

  it("records audit-only review decisions from CLI and TUI without changing run state", async () => {
    const runtime = createCliRuntime({ storageMode: "memory" });
    await seedTuiContext(runtime);
    const output: string[] = [];
    const errors: string[] = [];

    await expect(
      main(["reviews", "show", "run_1"], testIo(output, errors), process.cwd(), runtime)
    ).resolves.toBe(0);
    await expect(
      main(["reviews", "accept", "run_1"], testIo(output, errors), process.cwd(), runtime)
    ).resolves.toBe(0);
    await expect(
      main(
        [
          "--project",
          projectRoot,
          "tui",
          "--thread",
          "thread_1",
          "--reject-run",
          "run_1",
          "--reason",
          "Needs full suite.",
          "--once"
        ],
        testIo(output, errors),
        process.cwd(),
        runtime
      )
    ).resolves.toBe(0);

    expect(errors.join("")).toBe("");
    expect(output.join("")).toContain("review_status: pending");
    expect(output.join("")).toContain("review_status: accepted");
    expect(output.join("")).toContain("Review rejected for run_1. No repository action was performed.");
    await expect(runtime.taskRunRepository.get("run_1")).resolves.toMatchObject({
      status: "running"
    });
    const artifacts = await runtime.runArtifactRepository.listByRunId("run_1");
    expect(artifacts.filter((artifact) => artifact.kind === "review_decision"))
      .toEqual([
        expect.objectContaining({
          content: "Accepted for record. No merge was performed.",
          metadata: expect.objectContaining({ reviewStatus: "accepted" })
        }),
        expect.objectContaining({
          content: "Rejected for record. No files were deleted or reverted.",
          metadata: expect.objectContaining({
            reviewStatus: "rejected",
            reason: "Needs full suite."
          })
        })
      ]);
  });

});

function testIo(output: string[], errors: string[]) {
  return {
    stdout: {
      isTTY: false,
      columns: 120,
      rows: 80,
      write: (chunk: string) => {
        output.push(chunk);
        return true;
      }
    },
    stderr: {
      write: (chunk: string) => {
        errors.push(chunk);
        return true;
      }
    }
  };
}

function interactiveIo(
  stdin: NodeJS.ReadableStream,
  output: string[],
  errors: string[]
) {
  return {
    stdin,
    stdout: {
      isTTY: true,
      columns: 120,
      rows: 40,
      write: (chunk: string) => {
        output.push(chunk);
        return true;
      }
    },
    stderr: {
      write: (chunk: string) => {
        errors.push(chunk);
        return true;
      }
    }
  };
}

async function seedTuiContext(runtime: ReturnType<typeof createCliRuntime>) {
  await runtime.projectRepository.create({
    id: "project_1",
    name: "TUI Project",
    rootPath: projectRoot,
    createdAt: now,
    updatedAt: now
  });
  await runtime.conversationThreadRepository.create({
    id: "thread_1",
    projectId: "project_1",
    title: "Review",
    metadata: { roomHandle: "review" },
    createdAt: now,
    updatedAt: now
  });
  await runtime.conversationMessageRepository.createMany([
    {
      id: "message_1",
      threadId: "thread_1",
      sequence: 0,
      role: "user",
      kind: "text",
      content: "Check the TUI shell.",
      createdAt: now
    },
    {
      id: "message_2",
      threadId: "thread_1",
      sequence: 1,
      role: "assistant",
      kind: "text",
      content: "I started the review run.",
      agentKind: "codex",
      runId: "run_1",
      status: "running",
      createdAt: now
    }
  ]);
  await runtime.taskRepository.create({
    id: "task_1",
    projectId: "project_1",
    title: "Check TUI shell",
    description: "Check the TUI shell.",
    metadata: { threadId: "thread_1" },
    status: "running",
    createdAt: now,
    updatedAt: now
  });
  await runtime.taskRunRepository.create({
    id: "run_1",
    taskId: "task_1",
    agentKind: "codex",
    status: "running",
    startedAt: now,
    createdAt: now,
    updatedAt: now
  });
  await runtime.runEventRepository.create({
    id: "event_1",
    taskRunId: "run_1",
    sequence: 0,
    type: "status",
    message: "adapter running",
    metadata: {},
    createdAt: now
  });
  await runtime.roleCallRepository.create(
    roleCall({
      id: "call_parent",
      status: "running",
      taskRunId: "run_1",
      calleeRole: "reviewer"
    })
  );
  await runtime.roleCallRepository.create(
    roleCall({
      id: "call_child",
      status: "waiting_context",
      parentRoleCallId: "call_parent",
      calleeRole: "operator",
      depth: 1,
      decision: {
        disposition: "needs_context",
        reason: "Need a failing log excerpt.",
        requiredContext: ["failing log excerpt"]
      }
    })
  );
  await runtime.roleCallRepository.create(
    roleCall({
      id: "call_done",
      status: "succeeded",
      calleeRole: "memory",
      result: {
        summary: "No memory needed.",
        evidence: ["Read-only TUI."]
      }
    })
  );
  await runtime.memoryItemRepository.create({
    id: "memory_1",
    projectId: "project_1",
    category: "workflow_rule",
    status: "proposed",
    content: "Keep memory approval explicit.",
    createdAt: now,
    updatedAt: now
  });
  await runtime.memoryItemRepository.create({
    id: "memory_2",
    projectId: "project_1",
    category: "project_fact",
    status: "approved",
    content: "TUI uses runtime injection.",
    createdAt: now,
    updatedAt: now
  });
  await runtime.skillRepository.create({
    id: "typescript-safety",
    name: "TypeScript Safety",
    description: "Check TypeScript output.",
    path: "/tmp/skills/typescript-safety/SKILL.md",
    createdAt: now,
    updatedAt: now
  });
}

function roleCall(input: Partial<RoleCall>): RoleCall {
  return {
    id: input.id ?? "call_1",
    threadId: "thread_1",
    parentMessageId: "message_2",
    parentRoleCallId: input.parentRoleCallId,
    callerRole: input.callerRole ?? "engineer",
    calleeRole: input.calleeRole ?? "reviewer",
    task: input.task ?? "Check TUI evidence.",
    reason: input.reason ?? "Need terminal review.",
    context: { userGoal: "Check the TUI shell." },
    permissions: conservativePermissionSet,
    expectedOutput: { format: "summary", description: "TUI shell evidence." },
    priority: input.priority ?? "normal",
    depth: input.depth ?? 0,
    status: input.status ?? "accepted",
    decision: input.decision,
    result: input.result,
    taskRunId: input.taskRunId,
    todoId: input.todoId,
    error: input.error,
    createdAt: input.createdAt ?? now,
    startedAt: input.startedAt,
    completedAt: input.completedAt
  };
}

function createGitFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-hub-tui-project-"));
  fs.writeFileSync(path.join(root, "README.md"), "# fixture\n");
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["add", "README.md"], { cwd: root, stdio: "ignore" });
  execFileSync(
    "git",
    [
      "-c",
      "user.email=tui@example.com",
      "-c",
      "user.name=TUI Test",
      "commit",
      "-m",
      "init"
    ],
    { cwd: root, stdio: "ignore" }
  );
  return root;
}
