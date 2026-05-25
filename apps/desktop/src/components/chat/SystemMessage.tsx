import { timelinePresentationForMessage } from "../../lib/timelineEvents";
import type {
  RunInspectorTab,
  SystemMessage as SystemThreadMessage
} from "../../lib/types";

interface SystemMessageProps {
  message: SystemThreadMessage;
  onOpenInspector?(runId: string, tab?: RunInspectorTab): void;
}

export function SystemMessage({
  message,
  onOpenInspector
}: SystemMessageProps): JSX.Element {
  const isTaskEvent =
    typeof message.metadata?.taskEvent === "string" &&
    message.metadata.taskEvent.length > 0;
  const event = timelinePresentationForMessage(message);
  return (
    <div
      className={`system-message timeline-event ${event.tone} ${isTaskEvent ? "task-event" : ""}`}
    >
      <div className="system-message-main">
        <span>{formatTime(message.createdAt)}</span>
        <p>
          <strong>{event.title}</strong>
          {message.text}
        </p>
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
      {event.linkedRunId ? (
        <button
          className="timeline-event-action"
          onClick={() => onOpenInspector?.(event.linkedRunId as string, event.defaultTab)}
        >
          Open review
        </button>
      ) : null}
    </div>
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}
