import { nowIso, validateTaskBrief } from "@agent-hub/core";
import type { TaskBrief } from "@agent-hub/shared";

export function createTaskBrief(input: {
  taskId: string;
  title: string;
  prompt?: string;
  contextPackId: string;
  contextMarkdown: string;
  createdAt?: string;
}): TaskBrief {
  const renderedContent = [
    "# Agent Hub Task Brief",
    "",
    `Task ID: ${input.taskId}`,
    `Title: ${input.title}`,
    "",
    "## Prompt",
    "",
    input.prompt ?? input.title,
    "",
    "## Context",
    "",
    input.contextMarkdown || "No project context is available."
  ].join("\n");

  return validateTaskBrief({
    taskId: input.taskId,
    taskTitle: input.title,
    taskPrompt: input.prompt,
    renderedContent,
    contextPackId: input.contextPackId,
    createdAt: input.createdAt ?? nowIso()
  });
}
