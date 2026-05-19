import type { AssistantMessage } from "../../lib/types";
import { RunStatusBadge } from "../RunStatusBadge";

interface AssistantMessageBubbleProps {
  message: AssistantMessage;
}

export function AssistantMessageBubble({
  message
}: AssistantMessageBubbleProps): JSX.Element {
  return (
    <article className="assistant-message-row">
      <div className={`agent-mark ${message.agentId ?? "fake"}`}>
        {(message.agentId ?? "A").slice(0, 1).toUpperCase()}
      </div>
      <div className="assistant-message-bubble">
        <div className="message-meta">
          <strong>{message.agentId ? `@${message.agentId}` : "Assistant"}</strong>
          {message.status ? <RunStatusBadge status={message.status} compact /> : null}
          <span>{formatTime(message.createdAt)}</span>
        </div>
        <p>{message.text}</p>
      </div>
    </article>
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}
