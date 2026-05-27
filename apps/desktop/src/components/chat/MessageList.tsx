import type {
  AgentRunMessage,
  RunContinuationTarget,
  RunDetail,
  RunInspectorTab,
  ThreadMessage
} from "../../lib/types";
import { compareAffordanceForRun } from "../../lib/run-progress";
import {
  hiddenRunCardIds,
  quietRunCardIds,
  visibleTranscriptMessages
} from "../../lib/transcript";
import { AgentRunCard } from "./AgentRunCard";
import { AssistantMessageBubble } from "./AssistantMessageBubble";
import { SystemMessage } from "./SystemMessage";
import { UserMessageBubble } from "./UserMessageBubble";

interface MessageListProps {
  messages: ThreadMessage[];
  runDetails: Record<string, RunDetail>;
  onRunUpdated(run: RunDetail): void;
  onOpenInspector(runId: string, tab?: RunInspectorTab): void;
  onCancelRun(runId: string): Promise<void>;
  onContinueFromRun(target: RunContinuationTarget): void;
}

export function MessageList({
  messages,
  runDetails,
  onRunUpdated,
  onOpenInspector,
  onCancelRun,
  onContinueFromRun
}: MessageListProps): JSX.Element {
  if (messages.length === 0) {
    return (
      <div className="empty-chat">
        <h2>Message an agent to start a local run.</h2>
        <p>Use @codex or @claude from the composer.</p>
      </div>
    );
  }

  const hiddenRunIds = hiddenRunCardIds(messages, runDetails);
  const visibleMessages = visibleTranscriptMessages(messages).filter(
    (message) => message.type !== "agent_run" || !hiddenRunIds.has(message.runId)
  );
  const quietRunIds = quietRunCardIds(messages, runDetails);
  const renderedMessages: JSX.Element[] = [];
  for (let index = 0; index < visibleMessages.length; index += 1) {
    const message = visibleMessages[index];
    if (message?.type === "agent_run" && message.taskId) {
      const group: AgentRunMessage[] = [message];
      let nextIndex = index + 1;
      while (
        visibleMessages[nextIndex]?.type === "agent_run" &&
        (visibleMessages[nextIndex] as AgentRunMessage).taskId === message.taskId
      ) {
        group.push(visibleMessages[nextIndex] as AgentRunMessage);
        nextIndex += 1;
      }
      if (shouldRenderTaskGroup(group)) {
        renderedMessages.push(
          <section
            className={`task-run-group ${taskGroupStateClass(group)}`}
            key={`task-${message.taskId}`}
          >
            <header className="task-run-group-header">
              <div>
                <span>Task</span>
                <strong>{message.taskTitle ?? message.taskId}</strong>
              </div>
              <p>{assignmentLabel(group)}</p>
            </header>
            <div className="task-run-group-list">
              {group.map((runMessage) => renderRunCard(runMessage))}
            </div>
          </section>
        );
      } else {
        renderedMessages.push(...group.map((runMessage) => renderRunCard(runMessage)));
      }
      index = nextIndex - 1;
      continue;
    }
    renderedMessages.push(renderMessage(message));
  }

  return <div className="message-list">{renderedMessages}</div>;

  function renderMessage(message: ThreadMessage): JSX.Element {
    if (message.type === "user") {
      return <UserMessageBubble key={message.id} message={message} />;
    }
    if (message.type === "agent_run") {
      return renderRunCard(message);
    }
    if (message.type === "assistant") {
      return <AssistantMessageBubble key={message.id} message={message} />;
    }
    return (
      <SystemMessage
        key={message.id}
        message={message}
        onOpenInspector={onOpenInspector}
      />
    );
  }

  function renderRunCard(message: AgentRunMessage): JSX.Element {
    return (
      <AgentRunCard
        key={message.id}
        message={message}
        initialRun={runDetails[message.runId]}
        compactCompleted={quietRunIds.has(message.runId)}
        compareAffordance={compareAffordanceForRun(
          message.runId,
          messages,
          runDetails
        )}
        onRunUpdated={onRunUpdated}
        onOpenInspector={onOpenInspector}
        onCancelRun={onCancelRun}
        onContinueFromRun={() =>
          onContinueFromRun({
            parentRunId: message.runId,
            parentMessageId: message.id
          })
        }
      />
    );
  }

  function shouldRenderTaskGroup(group: AgentRunMessage[]): boolean {
    if (group.length > 1) {
      return true;
    }
    return group.some((runMessage) => {
      const detail = runDetails[runMessage.runId];
      return (
        runMessage.status === "failed" ||
        runMessage.status === "cancelled" ||
        (detail?.changedFiles.length ?? 0) > 0
      );
    });
  }
}

function taskGroupStateClass(messages: AgentRunMessage[]): string {
  if (messages.some((message) => message.status === "failed")) {
    return "has-failure";
  }
  if (
    messages.some(
      (message) => message.status === "running" || message.status === "verifying"
    )
  ) {
    return "has-active-run";
  }
  if (messages.every((message) => message.status === "completed")) {
    return "all-completed";
  }
  return "mixed-state";
}

function assignmentLabel(messages: AgentRunMessage[]): string {
  const labels = messages.map((message) =>
    message.assignment?.roleHandle
      ? `@${message.assignment.roleHandle}`
      : `@${message.agentId}`
  );
  return `${messages.length} run${messages.length === 1 ? "" : "s"} · ${labels.join(", ")}`;
}
