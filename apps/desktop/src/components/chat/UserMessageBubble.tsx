import type { UserMessage } from "../../lib/types";
import { timelinePresentationForMessage } from "../../lib/timelineEvents";

interface UserMessageBubbleProps {
  message: UserMessage;
}

export function UserMessageBubble({
  message
}: UserMessageBubbleProps): JSX.Element {
  const event = timelinePresentationForMessage(message);
  return (
    <article className={`user-message-row timeline-event ${event.tone}`}>
      <div className="message-avatar">You</div>
      <div className="user-message-bubble">
        <div className="message-meta">
          <strong>You</strong>
          <span className="timeline-event-kind">{event.title}</span>
          <span>{formatTime(message.createdAt)}</span>
        </div>
        {event.chips.length > 0 || message.mentions.length > 0 ? (
          <div className="mention-chip-row timeline-chip-row">
            {event.chips.map((chip) => (
              <span className={`timeline-chip ${chip.tone ?? "neutral"}`} key={chip.label}>
                {chip.label}
              </span>
            ))}
            {event.chips.length === 0
              ? message.mentions.map((agent) => (
                  <span className={`mention-chip ${agent}`} key={agent}>
                    @{agent}
                  </span>
                ))
              : null}
          </div>
        ) : null}
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
