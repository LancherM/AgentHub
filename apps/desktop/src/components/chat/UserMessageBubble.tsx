import type { UserMessage } from "../../lib/types";

interface UserMessageBubbleProps {
  message: UserMessage;
}

export function UserMessageBubble({
  message
}: UserMessageBubbleProps): JSX.Element {
  return (
    <article className="user-message-row">
      <div className="message-avatar">You</div>
      <div className="user-message-bubble">
        <div className="message-meta">
          <strong>You</strong>
          <span>{formatTime(message.createdAt)}</span>
        </div>
        {message.mentions.length > 0 ? (
          <div className="mention-chip-row">
            {message.mentions.map((agent) => (
              <span className={`mention-chip ${agent}`} key={agent}>
                @{agent}
              </span>
            ))}
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
