import fs from "node:fs/promises";
import path from "node:path";
import type { AgentKind, JsonObject } from "./domain";

export interface AgentDetectionResult {
  available: boolean;
  version?: string;
  reason?: string;
}

export interface AgentRunInput {
  originalProjectRoot: string;
  worktreePath: string;
  taskBriefPath: string;
  contextPackPath?: string;
  runtimeDirectory?: string;
  taskId: string;
  taskTitle: string;
  taskPrompt: string;
  environment?: Record<string, string>;
}

export type AgentRunEvent =
  | {
      type: "stdout" | "stderr" | "message" | "status" | "error";
      message: string;
      metadata?: JsonObject;
    }
  | {
      type: "exit";
      message: string;
      exitCode: number;
      metadata?: JsonObject;
    };

export interface AgentAdapter {
  kind: AgentKind;
  displayName: string;
  detect(): Promise<AgentDetectionResult>;
  run(input: AgentRunInput): AsyncIterable<AgentRunEvent>;
}

export class FakeAgentAdapter implements AgentAdapter {
  readonly kind = "fake";
  readonly displayName = "Fake Agent";

  async detect(): Promise<AgentDetectionResult> {
    return {
      available: true,
      version: "fake"
    };
  }

  async *run(input: AgentRunInput): AsyncIterable<AgentRunEvent> {
    const originalProjectRoot = path.resolve(input.originalProjectRoot);
    const worktreePath = path.resolve(input.worktreePath);
    const taskBriefPath = path.resolve(input.taskBriefPath);

    if (samePath(originalProjectRoot, worktreePath)) {
      yield* failureEvents(
        "FakeAgentAdapter refused to run in the original project root."
      );
      return;
    }

    if (!isPathInside(taskBriefPath, worktreePath)) {
      yield* failureEvents(
        "FakeAgentAdapter refused a task brief outside the isolated run directory."
      );
      return;
    }

    try {
      const worktreeStat = await fs.stat(worktreePath);
      if (!worktreeStat.isDirectory()) {
        yield* failureEvents("FakeAgentAdapter worktree path is not a directory.");
        return;
      }
    } catch {
      yield* failureEvents("FakeAgentAdapter worktree path does not exist.");
      return;
    }

    let taskBrief: string;
    try {
      taskBrief = await fs.readFile(taskBriefPath, "utf8");
    } catch {
      yield* failureEvents("FakeAgentAdapter task brief is missing or unreadable.");
      return;
    }

    const outputPath = path.join(worktreePath, "fake-agent-output.md");
    const output = [
      "# Fake Agent Output",
      "",
      `task_id: ${input.taskId}`,
      `title: ${input.taskTitle}`,
      `brief_characters: ${taskBrief.length}`,
      "",
      input.taskPrompt
    ].join("\n");

    await fs.writeFile(outputPath, `${output}\n`, "utf8");

    yield {
      type: "stdout",
      message: `fake agent wrote ${path.basename(outputPath)}`
    };
    yield {
      type: "exit",
      message: "fake agent completed",
      exitCode: 0,
      metadata: { outputPath }
    };
  }
}

export function isPathInside(candidatePath: string, parentPath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

function* failureEvents(message: string): Iterable<AgentRunEvent> {
  yield {
    type: "error",
    message,
    metadata: { error: message }
  };
  yield {
    type: "exit",
    message,
    exitCode: 1,
    metadata: { error: message }
  };
}
