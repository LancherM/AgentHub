import type { SystemMessage as SystemThreadMessage } from "../../lib/types";

interface SystemMessageProps {
  message: SystemThreadMessage;
}

export function SystemMessage({ message }: SystemMessageProps): JSX.Element {
  return (
    <div className="system-message">
      <span>{formatTime(message.createdAt)}</span>
      <p>{message.text}</p>
    </div>
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}
