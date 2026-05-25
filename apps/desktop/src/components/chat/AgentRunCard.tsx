import { useCallback, useEffect, useMemo, useState } from "react";
import { agentHubApi } from "../../lib/agentHubApi";
import {
  runEvidenceTimelineChips,
  timelinePresentationForMessage
} from "../../lib/timelineEvents";
import type {
  AgentRunMessage,
  ReviewArtifact,
  ReviewSummary,
  RunDetail,
  RunEvent,
  RunInspectorTab,
  RunStatus
} from "../../lib/types";
import { RunStatusBadge } from "../RunStatusBadge";

interface AgentRunCardProps {
  message: AgentRunMessage;
  initialRun?: RunDetail;
  compactCompleted?: boolean;
  onRunUpdated(run: RunDetail): void;
  onOpenInspector(runId: string, tab?: RunInspectorTab): void;
  onCancelRun(runId: string): Promise<void>;
  onContinueFromRun(): void;
}

export function AgentRunCard({
  message,
  initialRun,
  compactCompleted = false,
  onRunUpdated,
  onOpenInspector,
  onCancelRun,
  onContinueFromRun
}: AgentRunCardProps): JSX.Element {
  const [run, setRun] = useState<RunDetail | undefined>(initialRun);
  const [events, setEvents] = useState<RunEvent[]>(initialRun?.events ?? []);
  const [status, setStatus] = useState<RunStatus>(initialRun?.status ?? message.status);
  const [reviewSummary, setReviewSummary] = useState<ReviewSummary | undefined>();
  const [reviewArtifacts, setReviewArtifacts] = useState<ReviewArtifact[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [streamError, setStreamError] = useState<string | undefined>();
  const [cancelError, setCancelError] = useState<string | undefined>();

  useEffect(() => {
    setRun(initialRun);
    setEvents(initialRun?.events ?? []);
    setStatus(initialRun?.status ?? message.status);
    setReviewSummary(undefined);
    setReviewArtifacts([]);
  }, [initialRun, message.runId, message.status]);

  const loadReviewData = useCallback(async (): Promise<void> => {
    try {
      const [summary, artifacts] = await Promise.all([
        agentHubApi.review.getSummary(message.runId),
        agentHubApi.review.getArtifacts(message.runId)
      ]);
      setReviewSummary(summary);
      setReviewArtifacts(artifacts);
    } catch {
      setReviewSummary(undefined);
      setReviewArtifacts([]);
    }
  }, [message.runId]);

  const loadRun = useCallback(
    async (options: { includeReview?: boolean } = {}): Promise<void> => {
      try {
        const detail = await agentHubApi.runs.get(message.runId);
        setRun(detail);
        setEvents(detail.events);
        setStatus(detail.status);
        onRunUpdated(detail);
        if (options.includeReview) {
          await loadReviewData();
        }
      } catch (error) {
        setStreamError(`Failed to load run: ${errorMessage(error)}`);
      }
    },
    [loadReviewData, message.runId, onRunUpdated]
  );

  useEffect(() => {
    let active = true;
    if (!isActiveRunStatus(message.status)) {
      return () => {
        active = false;
      };
    }

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
        if (isTerminalRunEvent(event.type)) {
          void loadRun({ includeReview: true });
        }
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
  }, [loadRun, message.runId, message.status]);

  useEffect(() => {
    if (!expanded) {
      return;
    }
    void loadRun({ includeReview: true });
  }, [expanded, loadRun]);

  useEffect(() => {
    if (!isTerminalRunStatus(message.status) || run) {
      return;
    }
    void loadRun();
  }, [loadRun, message.status, run]);

  const latestLine = useMemo(() => latestEventText(events) ?? run?.summary ?? statusLine(status), [
    events,
    run?.summary,
    status
  ]);
  const canCancel = isActiveRunStatus(status);
  const canContinueCodeState =
    isTerminalRunStatus(status) && run?.canContinueCodeState === true;
  const continueDisabledTitle = run
    ? "Continue requires a retained parent worktree"
    : "Loading run provenance";
  const visibleEvents = expanded ? events : events.slice(-4);
  const elapsed = run
    ? elapsedLabel(run.createdAt, events.at(-1)?.timestamp ?? new Date().toISOString())
    : "0s";
  const headerMeta = run
    ? `Started ${formatTime(run.createdAt)} · ${elapsed}`
    : statusHeader(status);
  const simulationCopy =
    message.agentId === "fake"
      ? "Local TaskRunner fake run in an isolated worktree. The project root is not modified."
      : `Local TaskRunner run for @${message.agentId} in an isolated worktree. Unavailable CLIs fail with persisted evidence.`;
  const displayHandle = message.assignment?.roleHandle
    ? `@${message.assignment.roleHandle}`
    : `@${message.agentId}`;
  const executorLabel = message.assignment?.roleHandle
    ? `via @${message.agentId}`
    : undefined;
  const timelineEvent = timelinePresentationForMessage(message, {
    reviewSummary,
    reviewArtifacts,
    eventCount: events.length,
    status
  });
  const quietCompleted = compactCompleted && isTerminalRunStatus(status);

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
      className={`agent-run-card timeline-event ${timelineEvent.tone} ${status} ${expanded ? "expanded" : ""} ${quietCompleted ? "compact-completed" : ""}`}
      onClick={() => {
        if (quietCompleted) {
          onOpenInspector(message.runId, "brief");
          return;
        }
        setExpanded((current) => !current);
      }}
    >
      <header className="run-card-header">
        <div className={`agent-mark ${message.agentId}`}>
          {message.agentId.slice(0, 1).toUpperCase()}
        </div>
        <div className="run-card-title">
          <div>
            <strong>{displayHandle}</strong>
            <span className="timeline-event-kind">{timelineEvent.title}</span>
            <RunStatusBadge status={status} compact />
          </div>
          <span>{executorLabel ? `${executorLabel} · ${headerMeta}` : headerMeta}</span>
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
          {isTerminalRunStatus(status) ? (
            <button
              disabled={!canContinueCodeState}
              title={canContinueCodeState ? "Continue from this run" : continueDisabledTitle}
              onClick={(event) => {
                event.stopPropagation();
                if (!canContinueCodeState) {
                  return;
                }
                onContinueFromRun();
              }}
            >
              Continue
            </button>
          ) : null}
          {!quietCompleted ? (
            <button
              onClick={(event) => {
                event.stopPropagation();
                setExpanded((current) => !current);
              }}
            >
              {expanded ? "Collapse" : "Expand"}
            </button>
          ) : null}
          <button
            onClick={(event) => {
              event.stopPropagation();
              onOpenInspector(message.runId, "brief");
            }}
          >
            {quietCompleted ? "View review" : "View details"}
          </button>
        </div>
      </header>

      {streamError || cancelError ? (
        <div className="inline-error">{streamError ?? cancelError}</div>
      ) : null}

      {!quietCompleted ? (
      <div className="run-card-body">
        <p className="latest-line">
          {latestLine ?? "Waiting for the first streamed event..."}
        </p>
        <p className="fake-boundary">{simulationCopy}</p>
        {run?.parentRunId ? (
          <p className="fake-boundary">Continues code state from {run.parentRunId}.</p>
        ) : null}
        {expanded ? (
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
        ) : null}
      </div>
      ) : null}

      <footer className="run-card-pills">
        {reviewPills(reviewSummary, events.length, status, reviewArtifacts).map((pill) => (
          <button
            key={pill.label}
            className={`timeline-chip-button ${pill.tone ?? "neutral"}`}
            onClick={(event) => {
              event.stopPropagation();
              onOpenInspector(message.runId, pill.tab);
            }}
          >
            {pill.label}
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

function reviewPills(
  summary: ReviewSummary | undefined,
  eventCount: number,
  status: RunStatus,
  artifacts: ReviewArtifact[]
): ReturnType<typeof runEvidenceTimelineChips> {
  return runEvidenceTimelineChips(summary, eventCount, status, artifacts);
}

function isTerminalRunStatus(status: RunStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function isActiveRunStatus(status: RunStatus): boolean {
  return status === "queued" || status === "running" || status === "verifying";
}

function isTerminalRunEvent(type: RunEvent["type"]): boolean {
  return type === "run_completed" || type === "run_failed" || type === "run_cancelled";
}

function statusLine(status: RunStatus): string {
  if (status === "queued") {
    return "Run is queued.";
  }
  if (status === "running") {
    return "Run is in progress.";
  }
  if (status === "verifying") {
    return "Run is being verified.";
  }
  if (status === "completed") {
    return "Run completed. Expand to load review details.";
  }
  if (status === "cancelled") {
    return "Run was cancelled. Expand to load review details.";
  }
  return "Run failed. Expand to load review details.";
}

function statusHeader(status: RunStatus): string {
  if (status === "queued") {
    return "Queued";
  }
  if (status === "running") {
    return "Running";
  }
  if (status === "verifying") {
    return "Verifying";
  }
  if (status === "completed") {
    return "Completed · review loads on demand";
  }
  if (status === "cancelled") {
    return "Cancelled · review loads on demand";
  }
  return "Failed · review loads on demand";
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
