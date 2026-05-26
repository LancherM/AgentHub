import { useCallback, useEffect, useMemo, useState } from "react";
import { agentHubApi } from "../../lib/agentHubApi";
import { findCliUnavailableDiagnostic } from "../../lib/cli-diagnostics";
import {
  buildRunProgress,
  isActiveRunStatus,
  isTerminalRunStatus,
  runStatusFromTerminalEvent,
  type CompareAffordance
} from "../../lib/run-progress";
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
import { MarkdownText } from "./MarkdownText";

interface AgentRunCardProps {
  message: AgentRunMessage;
  initialRun?: RunDetail;
  compactCompleted?: boolean;
  compareAffordance: CompareAffordance;
  onRunUpdated(run: RunDetail): void;
  onOpenInspector(runId: string, tab?: RunInspectorTab): void;
  onCancelRun(runId: string): Promise<void>;
  onContinueFromRun(): void;
}

export function AgentRunCard({
  message,
  initialRun,
  compactCompleted = false,
  compareAffordance,
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
        const terminalStatus = runStatusFromTerminalEvent(event.type);
        if (terminalStatus) {
          setStatus(terminalStatus);
        } else if (event.payload.status) {
          setStatus(event.payload.status);
        }
        if (terminalStatus) {
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
    if (!isTerminalRunStatus(status)) {
      return;
    }
    if (run) {
      void loadReviewData();
      return;
    }
    void loadRun({ includeReview: true });
  }, [loadReviewData, loadRun, run, status]);

  const progress = useMemo(
    () =>
      buildRunProgress({
        status,
        events,
        summary: run?.summary,
        createdAt: run?.createdAt,
        updatedAt: run?.updatedAt
      }),
    [events, run?.createdAt, run?.summary, run?.updatedAt, status]
  );
  const canCancel = isActiveRunStatus(status);
  const canContinueCodeState =
    isTerminalRunStatus(status) && run?.canContinueCodeState === true;
  const continueDisabledTitle = run
    ? "Continue requires a retained parent worktree"
    : "Loading run provenance";
  const elapsed = run
    ? elapsedLabel(run.createdAt, events.at(-1)?.timestamp ?? new Date().toISOString())
    : "0s";
  const terminalMeta = compareAffordance.enabled
    ? `${progress.waitState} · ${compareAffordance.candidateCount} peer${
        compareAffordance.candidateCount === 1 ? "" : "s"
      } available`
    : progress.waitState;
  const headerMeta = isTerminalRunStatus(status)
    ? terminalMeta
    : run
      ? `Started ${formatTime(run.createdAt)} · ${elapsed}`
      : progress.waitState;
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
  const cliDiagnostic = useMemo(
    () => findCliUnavailableDiagnostic(events),
    [events]
  );
  const hasChangedFiles = (run?.changedFiles.length ?? 0) > 0;
  const showEvidenceBody =
    Boolean(cliDiagnostic) ||
    hasChangedFiles ||
    status === "failed" ||
    status === "cancelled" ||
    compareAffordance.enabled;
  const liveAgentText = latestAgentFacingText(events);
  const quietCompleted = compactCompleted && isTerminalRunStatus(status) && !cliDiagnostic;
  const evidenceActivityText = liveAgentText ?? progress.activityText;
  const conversationalActivityText = liveAgentText ?? progress.waitState;

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
      className={`agent-run-card timeline-event ${timelineEvent.tone} ${status} ${quietCompleted ? "compact-completed" : ""}`}
      onClick={() => {
        onOpenInspector(message.runId, "brief");
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
          <button
            className="primary-action"
            onClick={(event) => {
              event.stopPropagation();
              onOpenInspector(message.runId, "brief");
            }}
          >
            View review
          </button>
          {canCancel ? (
            <button
              title="Cancel this active local run"
              onClick={(event) => {
                event.stopPropagation();
                void cancel();
              }}
            >
              Cancel
            </button>
          ) : null}
          <button
            disabled={!compareAffordance.enabled}
            title={compareAffordance.title}
            aria-label={compareAffordance.title}
            onClick={(event) => {
              event.stopPropagation();
              if (!compareAffordance.enabled) {
                return;
              }
              onOpenInspector(message.runId, "compare");
            }}
          >
            Compare
          </button>
          {isTerminalRunStatus(status) ? (
            <>
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
              <button
                title="Open retained-worktree handoff evidence"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenInspector(message.runId, "handoff");
                }}
              >
                Handoff
              </button>
            </>
          ) : null}
          <button
            title="Open persisted run events in audit"
            onClick={(event) => {
              event.stopPropagation();
              onOpenInspector(message.runId, "audit");
            }}
          >
            Audit
          </button>
        </div>
      </header>

      {streamError || cancelError ? (
        <div className="inline-error">{streamError ?? cancelError}</div>
      ) : null}

      {!quietCompleted && showEvidenceBody ? (
        <div className="run-card-body">
          <div className="run-progress-rail" aria-label="Run progress">
            {progress.stages.map((stage) => (
              <div className={`run-progress-stage ${stage.state}`} key={stage.id}>
                <div className="run-progress-bar" />
                <span>{stage.label}</span>
              </div>
            ))}
          </div>

          <div className="run-activity-row">
            <div>
              <span>Last activity</span>
              {liveAgentText ? (
                <MarkdownText text={evidenceActivityText} compact />
              ) : (
                <p>{evidenceActivityText}</p>
              )}
            </div>
            <span className={`run-wait-state ${progress.tone}`}>
              {progress.waitState}
            </span>
          </div>

          <p className="fake-boundary">{simulationCopy}</p>
          {hasChangedFiles ? (
            <p className="fake-boundary">
              Changed {run?.changedFiles.length} file{run?.changedFiles.length === 1 ? "" : "s"}.
            </p>
          ) : null}
          {run?.parentRunId ? (
            <p className="fake-boundary">Continues code state from {run.parentRunId}.</p>
          ) : null}
          {progress.activityTimestamp ? (
            <p className="fake-boundary">
              Last event at {formatTime(progress.activityTimestamp)}.
            </p>
          ) : null}
          {cliDiagnostic ? (
            <div className="cli-diagnostic-panel">
              <div>
                <div className="panel-label">CLI Diagnostic</div>
                <strong>{cliDiagnostic.reason}</strong>
                {cliDiagnostic.cwd ? <p>cwd: {cliDiagnostic.cwd}</p> : null}
              </div>
              {cliDiagnostic.verifyCommand ? (
                <code>{cliDiagnostic.verifyCommand}</code>
              ) : null}
              <p>
                PATH checked:{" "}
                {cliDiagnostic.pathEntries.length > 0
                  ? cliDiagnostic.pathEntries.join(", ")
                  : "No PATH entries were available."}
              </p>
            </div>
          ) : null}
        </div>
      ) : !quietCompleted ? (
        <div className="run-card-body conversational-run-body">
          <div className="run-activity-row">
            <div>
              <span>{isActiveRunStatus(status) ? "Agent reply" : "Result"}</span>
              {liveAgentText ? (
                <MarkdownText text={conversationalActivityText} compact />
              ) : (
                <p>{conversationalActivityText}</p>
              )}
            </div>
            <span className={`run-wait-state ${progress.tone}`}>
              {progress.waitState}
            </span>
          </div>
        </div>
      ) : null}

      {showEvidenceBody ? (
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
      ) : null}
    </article>
  );
}

function appendEvent(events: RunEvent[], event: RunEvent): RunEvent[] {
  if (events.some((entry) => entry.id === event.id)) {
    return events;
  }
  return [...events, event].sort((left, right) => left.sequence - right.sequence);
}

function reviewPills(
  summary: ReviewSummary | undefined,
  eventCount: number,
  status: RunStatus,
  artifacts: ReviewArtifact[]
): ReturnType<typeof runEvidenceTimelineChips> {
  return runEvidenceTimelineChips(summary, eventCount, status, artifacts);
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

function latestAgentFacingText(events: RunEvent[]): string | undefined {
  for (const event of [...events].reverse()) {
    const message = typeof event.payload.message === "string"
      ? event.payload.message.trim()
      : "";
    if (!message) {
      continue;
    }
    if (event.payload.assistantOutput === true) {
      return message;
    }
    if (event.type === "agent_step" && isAssistantAdapterEvent(event.payload.adapterEvent)) {
      return message;
    }
  }
  return undefined;
}

function isAssistantAdapterEvent(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const event = value as Record<string, unknown>;
  const item = event.item;
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return false;
  }
  const record = item as Record<string, unknown>;
  return (
    record.role === "assistant" ||
    record.type === "agent_message" ||
    record.type === "assistant_message"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
