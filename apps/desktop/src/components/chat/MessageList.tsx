import type { RunDetail, ThreadMessage } from "../../lib/types";
import { AgentRunCard } from "./AgentRunCard";
import { UserMessageBubble } from "./UserMessageBubble";

interface MessageListProps {
  messages: ThreadMessage[];
  runDetails: Record<string, RunDetail>;
  onRunUpdated(run: RunDetail): void;
  onOpenInspector(runId: string): void;
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
        <h2>No messages yet</h2>
        <p>Awaiting first message.</p>
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
        ) : (
          <div className="system-message" key={message.id}>
            {message.text}
          </div>
        )
      )}
    </div>
  );
}
