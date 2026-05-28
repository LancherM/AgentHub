import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { agentHubApi } from "../../lib/agentHubApi";
import { findCliUnavailableDiagnostic } from "../../lib/cli-diagnostics";
import {
  buildRunProgress,
  isActiveRunStatus,
  isTerminalRunStatus,
  runStatusFromTerminalEvent,
  type CompareAffordance
} from "../../lib/run-progress";
import { timelinePresentationForMessage } from "../../lib/timelineEvents";
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
  const cardRef = useRef<HTMLElement>(null);
  const previousRunIdRef = useRef(message.runId);
  const [run, setRun] = useState<RunDetail | undefined>(initialRun);
  const [events, setEvents] = useState<RunEvent[]>(initialRun?.events ?? []);
  const [status, setStatus] = useState<RunStatus>(initialRun?.status ?? message.status);
  const [reviewSummary, setReviewSummary] = useState<ReviewSummary | undefined>();
  const [reviewArtifacts, setReviewArtifacts] = useState<ReviewArtifact[]>([]);
  const [shouldHydrateTerminalRun, setShouldHydrateTerminalRun] = useState(
    () => initialRun !== undefined
  );
  const [streamError, setStreamError] = useState<string | undefined>();
  const [cancelError, setCancelError] = useState<string | undefined>();

  useEffect(() => {
    const runChanged = previousRunIdRef.current !== message.runId;
    previousRunIdRef.current = message.runId;
    const nextStatus = initialRun?.status ?? message.status;
    setRun(initialRun);
    setEvents(initialRun?.events ?? []);
    setStatus((current) =>
      !runChanged && isTerminalRunStatus(current) && !isTerminalRunStatus(nextStatus)
        ? current
        : nextStatus
    );
    setReviewSummary(undefined);
    setReviewArtifacts([]);
    setShouldHydrateTerminalRun(initialRun !== undefined);
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
    if (!isActiveRunStatus(status)) {
      return undefined;
    }
    const interval = window.setInterval(() => {
      void loadRun();
    }, 2000);
    return () => window.clearInterval(interval);
  }, [loadRun, status]);

  useEffect(() => {
    if (!isTerminalRunStatus(status) || shouldHydrateTerminalRun) {
      return;
    }
    const element = cardRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      const timeout = window.setTimeout(() => setShouldHydrateTerminalRun(true), 250);
      return () => window.clearTimeout(timeout);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldHydrateTerminalRun(true);
          observer.disconnect();
        }
      },
      { root: null, rootMargin: "320px 0px", threshold: 0.01 }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [message.runId, shouldHydrateTerminalRun, status]);

  useEffect(() => {
    if (!isTerminalRunStatus(status) || !shouldHydrateTerminalRun) {
      return;
    }
    if (run) {
      void loadReviewData();
      return;
    }
    void loadRun({ includeReview: true });
  }, [loadReviewData, loadRun, run, shouldHydrateTerminalRun, status]);

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
  const changedFileCount = run?.changedFiles.length ?? 0;
  const liveAgentText = latestAgentFacingText(events);
  const isFailedRun = status === "failed";
  const quietCompleted = compactCompleted && isTerminalRunStatus(status) && !cliDiagnostic;
  const failedRunCause = isFailedRun
    ? likelyFailureCause(events, cliDiagnostic?.reason, message.agentId)
    : undefined;
  const reviewNeedsDecision = reviewSummary?.reviewStatus === "pending";
  const conclusionLine = runCardConclusion({
    status,
    liveAgentText,
    progressText: progress.waitState,
    failedRunCause,
    changedFileCount
  });
  const highLevelFields = [
    run ? `Started ${formatTime(run.createdAt)}` : undefined,
    isTerminalRunStatus(status) ? progress.waitState : elapsed,
    `${changedFileCount} changed file${changedFileCount === 1 ? "" : "s"}`,
    compareAffordance.enabled
      ? `${compareAffordance.candidateCount} peer${
          compareAffordance.candidateCount === 1 ? "" : "s"
        }`
      : undefined
  ].filter((field): field is string => Boolean(field));

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
      ref={cardRef}
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
            <strong>{isFailedRun ? `${displayHandle} failed` : displayHandle}</strong>
            {!isFailedRun ? (
              <span className="timeline-event-kind">{timelineEvent.title}</span>
            ) : null}
            <RunStatusBadge status={status} compact />
          </div>
          <span>{executorLabel ? `${executorLabel} · ${headerMeta}` : headerMeta}</span>
        </div>
        <div className="run-card-actions">
          <button
            className="primary-action"
            onClick={(event) => {
              event.stopPropagation();
              onOpenInspector(message.runId, primaryActionTab(status));
            }}
          >
            {primaryActionLabel(status, reviewNeedsDecision)}
          </button>
          {isActiveRunStatus(status) ? (
            <button
              className="danger-action"
              title="Cancel this active local run"
              onClick={(event) => {
                event.stopPropagation();
                void cancel();
              }}
            >
              Cancel
            </button>
          ) : status === "failed" ? (
            <>
              <button
                disabled={!canContinueCodeState}
                title={canContinueCodeState ? "Retry from retained worktree" : continueDisabledTitle}
                onClick={(event) => {
                  event.stopPropagation();
                  if (!canContinueCodeState) {
                    return;
                  }
                  onContinueFromRun();
                }}
              >
                Retry
              </button>
            </>
          ) : status === "cancelled" ? (
            <>
              <button
                className="danger-action"
                title="Open review decision controls"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenInspector(message.runId, "brief");
                }}
              >
                Reject
              </button>
            </>
          ) : reviewNeedsDecision ? (
            <>
              <button
                title="Open review decision controls"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenInspector(message.runId, "brief");
                }}
              >
                Accept
              </button>
              <button
                className="danger-action"
                title="Open review decision controls"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenInspector(message.runId, "brief");
                }}
              >
                Reject
              </button>
            </>
          ) : (
            <>
              <button
                title="Open review decision controls"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenInspector(message.runId, "brief");
                }}
              >
                Accept
              </button>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenInspector(message.runId, "artifacts");
                }}
              >
                Artifacts
              </button>
            </>
          )}
        </div>
      </header>

      {streamError || cancelError ? (
        <div className="inline-error">{streamError ?? cancelError}</div>
      ) : null}

      {!quietCompleted ? (
        <div className="run-card-body compact-run-summary">
          {liveAgentText ? (
            <MarkdownText text={conclusionLine} compact />
          ) : (
            <p className="run-card-conclusion">{conclusionLine}</p>
          )}
          <div className="run-card-facts" aria-label="Run summary">
            {highLevelFields.map((field) => (
              <span key={field}>{field}</span>
            ))}
          </div>
          {cliDiagnostic ? (
            <p className="fake-boundary">CLI diagnostic available in Audit.</p>
          ) : null}
        </div>
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

function primaryActionLabel(status: RunStatus, needsDecision: boolean): string {
  if (isActiveRunStatus(status)) {
    return "View live log";
  }
  if (status === "failed") {
    return "View failure";
  }
  if (status === "cancelled") {
    return "Open audit";
  }
  if (needsDecision) {
    return "Review";
  }
  return "View result";
}

function primaryActionTab(status: RunStatus): RunInspectorTab {
  if (isActiveRunStatus(status) || status === "cancelled") {
    return "audit";
  }
  return "brief";
}

function runCardConclusion({
  status,
  liveAgentText,
  progressText,
  failedRunCause,
  changedFileCount
}: {
  status: RunStatus;
  liveAgentText?: string;
  progressText: string;
  failedRunCause?: string;
  changedFileCount: number;
}): string {
  if (liveAgentText) {
    return liveAgentText;
  }
  if (status === "failed") {
    return failedRunCause ?? "Run failed before producing agent-facing output.";
  }
  if (status === "cancelled") {
    return "Run was cancelled. Audit details are available in the inspector.";
  }
  if (status === "completed") {
    return changedFileCount > 0
      ? "Run completed with reviewable output."
      : "Run completed without file changes.";
  }
  return progressText;
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

function likelyFailureCause(
  events: RunEvent[],
  cliReason: string | undefined,
  agentId: string
): string {
  if (cliReason) {
    return cliReason;
  }
  const failureEvent = [...events].reverse().find((event) => event.type === "run_failed");
  const failureMessage = trimmedMessage(failureEvent);
  if (failureMessage && failureMessage !== "Run failed.") {
    return failureMessage;
  }
  const processExit = [...events]
    .reverse()
    .map((event) => trimmedMessage(event))
    .find((message) => message && /exited with code|exited by signal/i.test(message));
  if (processExit) {
    return processExit;
  }
  return `${displayAgentName(agentId)} process exited before response generation.`;
}

function trimmedMessage(event: RunEvent | undefined): string | undefined {
  const message = typeof event?.payload.message === "string"
    ? event.payload.message.trim()
    : "";
  if (message.length === 0) {
    return undefined;
  }
  return message.length > 180 ? `${message.slice(0, 177)}...` : message;
}

function displayAgentName(agentId: string): string {
  if (agentId === "codex") {
    return "Codex";
  }
  if (agentId === "claude") {
    return "Claude";
  }
  if (agentId === "fake") {
    return "Fake agent";
  }
  return agentId;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
