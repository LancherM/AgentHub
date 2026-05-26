import type { AssistantMessage } from "../../lib/types";
import { timelinePresentationForMessage } from "../../lib/timelineEvents";
import { RunStatusBadge } from "../RunStatusBadge";
import { MarkdownText } from "./MarkdownText";

interface AssistantMessageBubbleProps {
  message: AssistantMessage;
}

export function AssistantMessageBubble({
  message
}: AssistantMessageBubbleProps): JSX.Element {
  const event = timelinePresentationForMessage(message);
  return (
    <article className={`assistant-message-row timeline-event ${event.tone}`}>
      <div className={`agent-mark ${message.agentId ?? "fake"}`}>
        {(message.agentId ?? "A").slice(0, 1).toUpperCase()}
      </div>
      <div className="assistant-message-bubble">
        <div className="message-meta">
          <strong>{message.agentId ? `@${message.agentId}` : "Assistant"}</strong>
          <span className="timeline-event-kind">{event.title}</span>
          {message.status ? <RunStatusBadge status={message.status} compact /> : null}
          <span>{formatTime(message.createdAt)}</span>
        </div>
        {event.chips.length > 0 ? (
          <div className="timeline-chip-row">
            {event.chips.map((chip) => (
              <span className={`timeline-chip ${chip.tone ?? "neutral"}`} key={chip.label}>
                {chip.label}
              </span>
            ))}
          </div>
        ) : null}
        <MarkdownText text={message.text} />
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
