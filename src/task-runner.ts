import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FakeAgentAdapter, type AgentRunEvent, isPathInside } from "./agent-adapters";
import {
  createId,
  nowIso,
  validateTask,
  validateTaskBrief,
  validateTaskRun,
  type AgentKind,
  type Task,
  type TaskBrief,
  type TaskRun
} from "./domain";

export interface RunTaskInput {
  projectRoot: string;
  taskPrompt: string;
  agentKind: AgentKind;
  taskId?: string;
  projectId?: string;
  title?: string;
  runRoot?: string;
}

export interface TaskRunResult {
  task: Task;
  run: TaskRun;
  events: AgentRunEvent[];
  status: "succeeded" | "failed";
  worktreePath: string;
  taskBriefPath: string;
  warnings: string[];
}

export class TaskRunnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskRunnerError";
  }
}

export async function runTask(input: RunTaskInput): Promise<TaskRunResult> {
  if (input.agentKind !== "fake") {
    throw new TaskRunnerError(`agent ${input.agentKind} is not implemented yet`);
  }

  const projectRoot = path.resolve(input.projectRoot);
  const runRoot = path.resolve(
    input.runRoot ?? path.join(os.tmpdir(), "agent-hub-runs")
  );

  if (samePath(projectRoot, runRoot) || isPathInside(runRoot, projectRoot)) {
    throw new TaskRunnerError("run root must be outside the original project root");
  }

  const now = nowIso();
  const task = validateTask({
    id: input.taskId ?? createId("task"),
    projectId: input.projectId ?? "adhoc_project",
    title: input.title ?? titleFromPrompt(input.taskPrompt),
    description: input.taskPrompt,
    status: "running",
    createdAt: now,
    updatedAt: now
  });

  const worktreePath = await createRunDirectory(runRoot, task.id, input.agentKind);
  const runtimeDirectory = path.join(worktreePath, ".agent-hub", "tasks", task.id);
  await fs.mkdir(runtimeDirectory, { recursive: true });

  const taskBrief = createTaskBrief(task);
  const taskBriefPath = path.join(runtimeDirectory, "brief.md");
  await fs.writeFile(taskBriefPath, taskBrief.renderedContent, "utf8");

  const adapter = new FakeAgentAdapter();
  const events: AgentRunEvent[] = [];
  for await (const event of adapter.run({
    originalProjectRoot: projectRoot,
    worktreePath,
    taskBriefPath,
    runtimeDirectory,
    taskId: task.id,
    taskTitle: task.title,
    taskPrompt: input.taskPrompt
  })) {
    events.push(event);
  }

  const exitEvent = findLastExitEvent(events);
  const status = exitEvent?.type === "exit" && exitEvent.exitCode === 0
    ? "succeeded"
    : "failed";
  const completedAt = nowIso();
  const run = validateTaskRun({
    id: createId("run"),
    taskId: task.id,
    agentKind: input.agentKind,
    status,
    worktreePath,
    startedAt: now,
    completedAt,
    createdAt: now,
    updatedAt: completedAt
  });

  return {
    task: {
      ...task,
      status: status === "succeeded" ? "completed" : "open",
      updatedAt: completedAt
    },
    run,
    events,
    status,
    worktreePath,
    taskBriefPath,
    warnings: []
  };
}

export function createTaskBrief(task: Task): TaskBrief {
  const createdAt = nowIso();
  const renderedContent = [
    "# Agent Hub Task Brief",
    "",
    `Task ID: ${task.id}`,
    `Title: ${task.title}`,
    "",
    "## Prompt",
    "",
    task.description ?? task.title,
    "",
    "## Context",
    "",
    "No project context is available in this rebuild slice."
  ].join("\n");

  return validateTaskBrief({
    taskId: task.id,
    taskTitle: task.title,
    taskPrompt: task.description,
    renderedContent,
    contextPackId: "context_pack_unavailable",
    createdAt
  });
}

async function createRunDirectory(
  runRoot: string,
  taskId: string,
  agentKind: AgentKind
): Promise<string> {
  await fs.mkdir(runRoot, { recursive: true });
  const runDirectory = path.join(
    runRoot,
    `${sanitizeSegment(taskId)}-${sanitizeSegment(agentKind)}-${Date.now()}`
  );
  await fs.mkdir(runDirectory, { recursive: false });
  return runDirectory;
}

function titleFromPrompt(prompt: string): string {
  const compact = prompt.replace(/\s+/g, " ").trim();
  if (compact.length === 0) {
    throw new TaskRunnerError("task prompt is required");
  }

  return compact.length <= 80 ? compact : `${compact.slice(0, 77)}...`;
}

function sanitizeSegment(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized.length > 0 ? sanitized : "run";
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

function findLastExitEvent(events: AgentRunEvent[]): AgentRunEvent | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].type === "exit") {
      return events[index];
    }
  }

  return undefined;
}
