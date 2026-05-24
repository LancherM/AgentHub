import type { SystemMessage as SystemThreadMessage } from "../../lib/types";

interface SystemMessageProps {
  message: SystemThreadMessage;
}

export function SystemMessage({ message }: SystemMessageProps): JSX.Element {
  const isTaskEvent =
    typeof message.metadata?.taskEvent === "string" &&
    message.metadata.taskEvent.length > 0;
  return (
    <div className={`system-message ${isTaskEvent ? "task-event" : ""}`}>
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
