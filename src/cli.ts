#!/usr/bin/env node
import { parseAgentPrompt } from "./agent-parser";
import { runTask } from "./task-runner";

export interface CliIO {
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
}

export async function main(
  argv = process.argv.slice(2),
  io: CliIO = { stdout: process.stdout, stderr: process.stderr },
  cwd = process.cwd()
): Promise<number> {
  const [command, ...rest] = argv;

  if (!command || command === "--help" || command === "-h") {
    io.stdout.write(helpText());
    return 0;
  }

  if (command !== "run") {
    io.stderr.write(`error: unknown command ${command}\n`);
    return 1;
  }

  const rawPrompt = rest.join(" ");
  try {
    const parsed = parseAgentPrompt(rawPrompt);
    if (parsed.agentKind !== "fake") {
      io.stderr.write(`error: agent ${parsed.agentKind} is not implemented yet\n`);
      return 1;
    }

    const result = await runTask({
      projectRoot: cwd,
      taskPrompt: parsed.prompt,
      agentKind: parsed.agentKind
    });

    io.stdout.write(renderRunSummary(result));
    return result.status === "succeeded" ? 0 : 1;
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

export function helpText(): string {
  return [
    "agent-hub",
    "",
    "Usage:",
    "  agent-hub run \"@fake <task>\"",
    ""
  ].join("\n");
}

function renderRunSummary(result: Awaited<ReturnType<typeof runTask>>): string {
  return [
    "Task run completed",
    `task_id: ${result.task.id}`,
    "agent: fake",
    `status: ${result.status}`,
    `worktree_path: ${result.worktreePath}`,
    `task_brief_path: ${result.taskBriefPath}`,
    `events: ${result.events.length}`,
    `warnings: ${result.warnings.length === 0 ? "none" : result.warnings.join(", ")}`,
    ""
  ].join("\n");
}

if (require.main === module) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

