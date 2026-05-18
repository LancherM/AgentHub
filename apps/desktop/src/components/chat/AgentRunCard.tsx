import { useEffect, useMemo, useState } from "react";
import { agentHubApi } from "../../lib/agentHubApi";
import type {
  AgentRunMessage,
  RunDetail,
  RunEvent,
  RunStatus
} from "../../lib/types";
import { RunStatusBadge } from "../RunStatusBadge";

interface AgentRunCardProps {
  message: AgentRunMessage;
  initialRun?: RunDetail;
  onRunUpdated(run: RunDetail): void;
  onOpenInspector(runId: string): void;
  onCancelRun(runId: string): Promise<void>;
}

export function AgentRunCard({
  message,
  initialRun,
  onRunUpdated,
  onOpenInspector,
  onCancelRun
}: AgentRunCardProps): JSX.Element {
  const [run, setRun] = useState<RunDetail | undefined>(initialRun);
  const [events, setEvents] = useState<RunEvent[]>(initialRun?.events ?? []);
  const [status, setStatus] = useState<RunStatus>(initialRun?.status ?? message.status);
  const [expanded, setExpanded] = useState(false);
  const [streamError, setStreamError] = useState<string | undefined>();
  const [cancelError, setCancelError] = useState<string | undefined>();

  useEffect(() => {
    setRun(initialRun);
    setEvents(initialRun?.events ?? []);
    setStatus(initialRun?.status ?? message.status);
  }, [initialRun, message.runId, message.status]);

  useEffect(() => {
    let active = true;
    void loadRun();
    try {
      const unsubscribe = agentHubApi.runs.onEvent(message.runId, (event) => {
        if (!active) {
          return;
        }
        setEvents((current) => appendEvent(current, event));
        if (event.payload.status) {
          setStatus(event.payload.status);
        }
        void loadRun();
      });
      return () => {
        active = false;
        unsubscribe();
      };
    } catch (error) {
      setStreamError(`Failed to subscribe to events: ${errorMessage(error)}`);
      return () => {
        active = false;
      };
    }

    async function loadRun(): Promise<void> {
      try {
        const detail = await agentHubApi.runs.get(message.runId);
        if (!active) {
          return;
        }
        setRun(detail);
        setEvents(detail.events);
        setStatus(detail.status);
        onRunUpdated(detail);
      } catch (error) {
        if (active) {
          setStreamError(`Failed to load run: ${errorMessage(error)}`);
        }
      }
    }
  }, [message.runId, onRunUpdated]);

  const latestLine = useMemo(() => latestEventText(events) ?? run?.summary, [
    events,
    run?.summary
  ]);
  const canCancel = status === "queued" || status === "running" || status === "verifying";
  const visibleEvents = expanded ? events : events.slice(-4);
  const elapsed = run
    ? elapsedLabel(run.createdAt, events.at(-1)?.timestamp ?? new Date().toISOString())
    : "0s";
  const simulationCopy =
    message.agentId === "fake"
      ? "Local simulated run. No real repository files are modified."
      : `Local placeholder for @${message.agentId}. Real desktop adapter execution is not wired yet.`;

  async function cancel(): Promise<void> {
    setCancelError(undefined);
    try {
      await onCancelRun(message.runId);
    } catch (error) {
      setCancelError(`Cancel failed: ${errorMessage(error)}`);
    }
  }

  return (
    <article
      className={`agent-run-card ${status} ${expanded ? "expanded" : ""}`}
      onClick={() => setExpanded((current) => !current)}
    >
      <header className="run-card-header">
        <div className={`agent-mark ${message.agentId}`}>
          {message.agentId.slice(0, 1).toUpperCase()}
        </div>
        <div className="run-card-title">
          <div>
            <strong>@{message.agentId}</strong>
            <RunStatusBadge status={status} compact />
          </div>
          <span>
            {run ? `Started ${formatTime(run.createdAt)} · ${elapsed}` : "Starting..."}
          </span>
        </div>
        <div className="run-card-actions">
          {canCancel ? (
            <button
              onClick={(event) => {
                event.stopPropagation();
                void cancel();
              }}
            >
              Cancel
            </button>
          ) : null}
          <button
            onClick={(event) => {
              event.stopPropagation();
              setExpanded((current) => !current);
            }}
          >
            {expanded ? "Collapse" : "Expand"}
          </button>
          <button
            onClick={(event) => {
              event.stopPropagation();
              onOpenInspector(message.runId);
            }}
          >
            View details
          </button>
        </div>
      </header>

      {streamError || cancelError ? (
        <div className="inline-error">{streamError ?? cancelError}</div>
      ) : null}

      <div className="run-card-body">
        <p className="latest-line">
          {latestLine ?? "Waiting for the first streamed event..."}
        </p>
        <p className="fake-boundary">{simulationCopy}</p>
        <div className="run-event-strip">
          {visibleEvents.length === 0 ? (
            <span className="muted-copy">No stream events yet.</span>
          ) : (
            visibleEvents.map((event) => (
              <div className="run-event-line" key={event.id}>
                <span>{formatTime(event.timestamp)}</span>
                <p>{eventText(event)}</p>
              </div>
            ))
          )}
        </div>
      </div>

      <footer className="run-card-pills">
        {[
          `${run?.changedFiles.length ?? 0} files`,
          `tests ${run?.verification.status ?? "pending"}`,
          `risk ${run?.risk.level ?? "pending"}`,
          `${run?.memoryProposals.length ?? 0} memory`,
          `${events.length} events`
        ].map((label) => (
          <button
            key={label}
            onClick={(event) => {
              event.stopPropagation();
              onOpenInspector(message.runId);
            }}
          >
            {label}
          </button>
        ))}
      </footer>
    </article>
  );
}

function appendEvent(events: RunEvent[], event: RunEvent): RunEvent[] {
  if (events.some((entry) => entry.id === event.id)) {
    return events;
  }
  return [...events, event].sort((left, right) => left.sequence - right.sequence);
}

function latestEventText(events: RunEvent[]): string | undefined {
  return [...events].reverse().map(eventText).find(Boolean);
}

function eventText(event: RunEvent): string {
  return event.payload.message ?? event.payload.summary ?? event.type.replaceAll("_", " ");
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function elapsedLabel(start: string, end: string): string {
  const diffSeconds = Math.max(
    0,
    Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000)
  );
  if (diffSeconds < 60) {
    return `${diffSeconds}s`;
  }
  const minutes = Math.floor(diffSeconds / 60);
  const seconds = diffSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
