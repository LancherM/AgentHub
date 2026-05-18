import { useEffect, useMemo, useState } from "react";
import { agentHubApi } from "../lib/agentHubApi";
import type { AgentId, ContextMode, RunDetail, RunEvent, RunStatus } from "../lib/types";
import { RunStatusBadge } from "./RunStatusBadge";

interface ThreadViewProps {
  run?: RunDetail;
  isBusy: boolean;
  onCreateRun(
    prompt: string,
    agentId: AgentId,
    contextMode: ContextMode
  ): Promise<void>;
  onCancelRun(runId: string): Promise<void>;
  onRunEvent(runId: string, event: RunEvent): void;
}

const timeline = [
  { key: "lifecycle", label: "Lifecycle" },
  { key: "context", label: "Context" },
  { key: "agent", label: "Agent Steps" },
  { key: "logs", label: "Logs" },
  { key: "verification", label: "Verification" },
  { key: "final", label: "Final Summary" }
] as const;

export function ThreadView({
  run,
  isBusy,
  onCreateRun,
  onCancelRun,
  onRunEvent
}: ThreadViewProps): JSX.Element {
  const [prompt, setPrompt] = useState("");
  const [agentId, setAgentId] = useState<AgentId>("fake");
  const [contextMode, setContextMode] = useState<ContextMode>("auto");
  const [events, setEvents] = useState<RunEvent[]>(run?.events ?? []);
  const [liveStatus, setLiveStatus] = useState<RunStatus | undefined>(run?.status);
  const [streamError, setStreamError] = useState<string | undefined>();
  const [cancelError, setCancelError] = useState<string | undefined>();

  useEffect(() => {
    setEvents(run?.events ?? []);
    setLiveStatus(run?.status);
    setStreamError(undefined);
    setCancelError(undefined);
  }, [run?.id, run?.events, run?.status]);

  useEffect(() => {
    if (!run) {
      return undefined;
    }
    try {
      const unsubscribe = agentHubApi.runs.onEvent(run.id, (event) => {
        setEvents((current) => appendEvent(current, event));
        if (event.payload.status) {
          setLiveStatus(event.payload.status);
        }
        onRunEvent(run.id, event);
      });
      return unsubscribe;
    } catch (error) {
      setStreamError(`Failed to subscribe to run events: ${errorMessage(error)}`);
      return undefined;
    }
  }, [run?.id]);

  const currentStatus = liveStatus ?? run?.status;
  const eventsByPhase = useMemo(() => groupEventsByPhase(events), [events]);
  const canCancel = currentStatus === "running" || currentStatus === "verifying";

  async function submit(): Promise<void> {
    const trimmed = prompt.trim();
    if (!trimmed || isBusy) {
      return;
    }
    await onCreateRun(trimmed, agentId, contextMode);
    setPrompt("");
  }

  async function cancel(): Promise<void> {
    if (!run || !canCancel) {
      return;
    }
    setCancelError(undefined);
    try {
      await onCancelRun(run.id);
    } catch (error) {
      setCancelError(`Cancel failed: ${errorMessage(error)}`);
    }
  }

  return (
    <section className="thread-view">
      <header className="thread-header">
        <div>
          <div className="eyebrow">Selected Run</div>
          <h1>{run?.title ?? "No run selected"}</h1>
        </div>
        <div className="thread-actions">
          {run && currentStatus ? <RunStatusBadge status={currentStatus} /> : null}
          {run && canCancel ? (
            <button
              className="danger-button"
              onClick={() => void cancel()}
              disabled={isBusy}
            >
              Cancel
            </button>
          ) : null}
        </div>
      </header>

      {streamError || cancelError ? (
        <div className="inline-error">{streamError ?? cancelError}</div>
      ) : null}

      <div className="prompt-panel">
        <div className="panel-label">Task Prompt</div>
        <p>{run?.taskPrompt || "Create a new run to populate the desktop review thread."}</p>
      </div>

      <div className="timeline">
        {timeline.map((item) => (
          <TimelineBlock
            key={item.key}
            label={item.label}
            events={eventsByPhase[item.key] ?? []}
            fallback={fallbackText(item.key)}
          />
        ))}
      </div>

      <div className="composer">
        <select
          value={agentId}
          onChange={(event) => setAgentId(event.target.value as AgentId)}
          aria-label="Agent"
        >
          <option value="fake">@fake</option>
          <option value="codex" disabled>
            @codex
          </option>
          <option value="claude" disabled>
            @claude
          </option>
        </select>
        <select
          value={contextMode}
          onChange={(event) => setContextMode(event.target.value as ContextMode)}
          aria-label="Context mode"
        >
          <option value="auto">auto</option>
          <option value="minimal">minimal</option>
          <option value="full">full</option>
        </select>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Ask an agent to work on a local task..."
          rows={1}
        />
        <button onClick={() => void submit()} disabled={!prompt.trim() || isBusy}>
          Run
        </button>
      </div>
    </section>
  );
}

function TimelineBlock({
  label,
  events,
  fallback
}: {
  label: string;
  events: RunEvent[];
  fallback: string;
}): JSX.Element {
  return (
    <article className="timeline-block">
      <div className="timeline-marker" />
      <div className="timeline-content">
        <h2>{label}</h2>
        {events.length === 0 ? (
          <p className="muted-copy">{fallback}</p>
        ) : (
          events.map((event) => (
            <div className={`event-line ${event.type}`} key={event.id}>
              <span>{eventLabel(event.type)}</span>
              <p>{event.payload.message ?? event.payload.summary ?? event.type}</p>
            </div>
          ))
        )}
      </div>
    </article>
  );
}

function groupEventsByPhase(events: RunEvent[]): Record<string, RunEvent[]> {
  return events.reduce<Record<string, RunEvent[]>>((groups, event) => {
    const phase =
      typeof event.payload.phase === "string" ? event.payload.phase : "logs";
    groups[phase] = [...(groups[phase] ?? []), event];
    return groups;
  }, {});
}

function fallbackText(phase: string): string {
  switch (phase) {
    case "lifecycle":
      return "Waiting for the run to start.";
    case "context":
      return "Waiting for a context pack.";
    case "agent":
      return "No agent steps have been recorded.";
    case "logs":
      return "No adapter output has been recorded.";
    case "verification":
      return "No verification result has been recorded.";
    case "final":
      return "No final summary has been recorded.";
    default:
      return "No events.";
  }
}

function appendEvent(events: RunEvent[], event: RunEvent): RunEvent[] {
  if (events.some((entry) => entry.id === event.id)) {
    return events;
  }
  return [...events, event].sort((left, right) => left.sequence - right.sequence);
}

function eventLabel(type: RunEvent["type"]): string {
  return type.replaceAll("_", " ");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
