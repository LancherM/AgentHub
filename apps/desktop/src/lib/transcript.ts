import type { AgentRunMessage, RunDetail, RunStatus, ThreadMessage } from "./types";

export function visibleTranscriptMessages(messages: ThreadMessage[]): ThreadMessage[] {
  return messages.filter((message) => !isInternalSystemEvent(message));
}

export function quietRunCardIds(
  messages: ThreadMessage[],
  runDetails: Record<string, RunDetail>
): Set<string> {
  const assistantRunIds = new Set(
    messages
      .filter(
        (message): message is Extract<ThreadMessage, { type: "assistant" }> =>
          message.type === "assistant" && !!message.runId
      )
      .map((message) => message.runId as string)
  );
  return new Set(
    messages
      .filter(
        (message): message is AgentRunMessage =>
          message.type === "agent_run" &&
          assistantRunIds.has(message.runId) &&
          isTerminalRunStatus(effectiveRunStatus(message, runDetails))
      )
      .map((message) => message.runId)
  );
}

export function effectiveRunStatus(
  message: AgentRunMessage,
  runDetails: Record<string, RunDetail>
): RunStatus {
  return runDetails[message.runId]?.status ?? message.status;
}

function isTerminalRunStatus(status: RunStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function isInternalSystemEvent(message: ThreadMessage): boolean {
  return (
    message.type === "system" &&
    (typeof message.metadata?.taskEvent === "string" ||
      typeof message.metadata?.workflowEvent === "string")
  );
}
