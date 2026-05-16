#!/usr/bin/env node
import { parseAgentPrompt } from "./agent-parser";
import { TaskRunner, type TaskRunnerDependencies } from "./task-runner";
import {
  InMemoryTaskRepository,
  InMemoryTaskRunRepository,
  type TaskRepository,
  type TaskRunRepository
} from "./storage";

export interface CliIO {
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
}

export interface CliRuntime {
  taskRepository: TaskRepository;
  taskRunRepository: TaskRunRepository;
  taskRunner: TaskRunner;
}

export function createCliRuntime(
  dependencies: TaskRunnerDependencies = {}
): CliRuntime {
  const taskRepository = dependencies.taskRepository ?? new InMemoryTaskRepository();
  const taskRunRepository =
    dependencies.taskRunRepository ?? new InMemoryTaskRunRepository();
  const taskRunner = new TaskRunner({
    ...dependencies,
    taskRepository,
    taskRunRepository
  });

  return { taskRepository, taskRunRepository, taskRunner };
}

const defaultRuntime = createCliRuntime();

export async function main(
  argv = process.argv.slice(2),
  io: CliIO = { stdout: process.stdout, stderr: process.stderr },
  cwd = process.cwd(),
  runtime: CliRuntime = defaultRuntime
): Promise<number> {
  const [command, ...rest] = argv;

  if (!command || command === "--help" || command === "-h") {
    io.stdout.write(helpText());
    return 0;
  }

  if (command === "run") {
    return runCommand(rest, io, cwd, runtime);
  }

  if (command === "tasks" && rest[0] === "list") {
    return listTasks(io, runtime);
  }

  if (command === "runs" && rest[0] === "list") {
    return listRuns(io, runtime);
  }

  io.stderr.write(`error: unknown command ${[command, ...rest].join(" ")}\n`);
  return 1;
}

export function helpText(): string {
  return [
    "agent-hub",
    "",
    "Usage:",
    "  agent-hub run \"@fake <task>\"",
    "  agent-hub tasks list",
    "  agent-hub runs list",
    ""
  ].join("\n");
}

async function runCommand(
  args: string[],
  io: CliIO,
  cwd: string,
  runtime: CliRuntime
): Promise<number> {
  const rawPrompt = args.join(" ");
  try {
    const parsed = parseAgentPrompt(rawPrompt);
    if (parsed.agentKind !== "fake") {
      io.stderr.write(`error: agent ${parsed.agentKind} is not implemented yet\n`);
      return 1;
    }

    const result = await runtime.taskRunner.run({
      projectRoot: cwd,
      rawPrompt
    });

    io.stdout.write(renderRunSummary(result));
    return result.ok ? 0 : 1;
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function listTasks(io: CliIO, runtime: CliRuntime): Promise<number> {
  const tasks = await runtime.taskRepository.list();
  if (tasks.length === 0) {
    io.stdout.write("No tasks found.\n");
    return 0;
  }

  for (const task of tasks) {
    io.stdout.write(`${task.id}\t${task.status}\t${task.title}\n`);
  }
  return 0;
}

async function listRuns(io: CliIO, runtime: CliRuntime): Promise<number> {
  const runs = await runtime.taskRunRepository.list();
  if (runs.length === 0) {
    io.stdout.write("No runs found.\n");
    return 0;
  }

  for (const run of runs) {
    io.stdout.write(`${run.id}\t${run.status}\t${run.agentKind}\t${run.taskId}\n`);
  }
  return 0;
}

function renderRunSummary(result: Awaited<ReturnType<TaskRunner["run"]>>): string {
  return [
    "Task run completed",
    `task_id: ${result.task.id}`,
    `run_id: ${result.run.id}`,
    `agent: ${result.run.agentKind}`,
    `status: ${result.status}`,
    `worktree_path: ${result.worktreePath ?? "none"}`,
    `task_brief_path: ${result.taskBriefPath ?? "none"}`,
    `events: ${result.events.length}`,
    `warnings: ${result.warnings.length === 0 ? "none" : result.warnings.join(", ")}`,
    "fake_output:",
    result.fakeOutput?.trim() ?? "(none)",
    ""
  ].join("\n");
}

if (require.main === module) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

