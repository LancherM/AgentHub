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
          shouldQuietRunCard(message, runDetails)
      )
      .map((message) => message.runId)
  );
}

export function hiddenRunCardIds(
  messages: ThreadMessage[],
  runDetails: Record<string, RunDetail>
): Set<string> {
  const assistantRunIds = assistantOutputRunIds(messages);
  return new Set(
    messages
      .filter(
        (message): message is AgentRunMessage =>
          message.type === "agent_run" &&
          assistantRunIds.has(message.runId) &&
          shouldHideRunCard(message, runDetails)
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

function assistantOutputRunIds(messages: ThreadMessage[]): Set<string> {
  return new Set(
    messages
      .filter(
        (message): message is Extract<ThreadMessage, { type: "assistant" }> =>
          message.type === "assistant" && !!message.runId
      )
      .map((message) => message.runId as string)
  );
}

function shouldHideRunCard(
  message: AgentRunMessage,
  runDetails: Record<string, RunDetail>
): boolean {
  const detail = runDetails[message.runId];
  if (!detail) {
    return false;
  }
  const status = effectiveRunStatus(message, runDetails);
  return (
    status === "completed" &&
    isTerminalRunStatus(status) &&
    detail.changedFiles.length === 0
  );
}

function shouldQuietRunCard(
  message: AgentRunMessage,
  runDetails: Record<string, RunDetail>
): boolean {
  if (!isTerminalRunStatus(effectiveRunStatus(message, runDetails))) {
    return false;
  }
  const detail = runDetails[message.runId];
  return !detail || detail.changedFiles.length === 0;
}

function isInternalSystemEvent(message: ThreadMessage): boolean {
  return (
    message.type === "system" &&
    (typeof message.metadata?.taskEvent === "string" ||
      typeof message.metadata?.workflowEvent === "string")
  );
}
