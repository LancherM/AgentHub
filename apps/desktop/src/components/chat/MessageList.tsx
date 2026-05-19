import type { RunDetail, RunInspectorTab, ThreadMessage } from "../../lib/types";
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
}

export function MessageList({
  messages,
  runDetails,
  onRunUpdated,
  onOpenInspector,
  onCancelRun
}: MessageListProps): JSX.Element {
  if (messages.length === 0) {
    return (
      <div className="empty-chat">
        <h2>Message an agent to start a local run.</h2>
        <p>Use @fake, @codex, or @claude from the composer.</p>
      </div>
    );
  }

  return (
    <div className="message-list">
      {messages.map((message) =>
        message.type === "user" ? (
          <UserMessageBubble key={message.id} message={message} />
        ) : message.type === "agent_run" ? (
          <AgentRunCard
            key={message.id}
            message={message}
            initialRun={runDetails[message.runId]}
            onRunUpdated={onRunUpdated}
            onOpenInspector={onOpenInspector}
            onCancelRun={onCancelRun}
          />
        ) : message.type === "assistant" ? (
          <AssistantMessageBubble key={message.id} message={message} />
        ) : (
          <SystemMessage key={message.id} message={message} />
        )
      )}
    </div>
  );
}
