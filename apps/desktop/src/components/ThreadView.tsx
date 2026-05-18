import { useMemo, useState } from "react";
import type { AgentKind, ContextMode, RunDetail, RunEvent } from "../lib/types";
import { RunStatusBadge } from "./RunStatusBadge";

interface ThreadViewProps {
  run?: RunDetail;
  isBusy: boolean;
  onCreateRun(
    prompt: string,
    agentKind: AgentKind,
    contextMode: ContextMode
  ): Promise<void>;
}

const timeline = [
  { key: "context", label: "Context" },
  { key: "plan", label: "Agent Plan" },
  { key: "logs", label: "Logs" },
  { key: "verification", label: "Verification" },
  { key: "final", label: "Final Summary" }
] as const;

export function ThreadView({
  run,
  isBusy,
  onCreateRun
}: ThreadViewProps): JSX.Element {
  const [prompt, setPrompt] = useState("");
  const [agentKind, setAgentKind] = useState<AgentKind>("fake");
  const [contextMode, setContextMode] = useState<ContextMode>("auto");

  const eventsByPhase = useMemo(() => groupEventsByPhase(run?.events ?? []), [run]);

  async function submit(): Promise<void> {
    const trimmed = prompt.trim();
    if (!trimmed || isBusy) {
      return;
    }
    await onCreateRun(trimmed, agentKind, contextMode);
    setPrompt("");
  }

  return (
    <section className="thread-view">
      <header className="thread-header">
        <div>
          <div className="eyebrow">Selected Run</div>
          <h1>{run?.title ?? "No run selected"}</h1>
        </div>
        {run ? <RunStatusBadge status={run.status} /> : null}
      </header>

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
          value={agentKind}
          onChange={(event) => setAgentKind(event.target.value as AgentKind)}
          aria-label="Agent"
        >
          <option value="codex">@codex</option>
          <option value="claude-code">@claude</option>
          <option value="fake">@fake</option>
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
              <span>{event.type}</span>
              <p>{event.message}</p>
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
      typeof event.metadata.phase === "string" ? event.metadata.phase : "logs";
    groups[phase] = [...(groups[phase] ?? []), event];
    return groups;
  }, {});
}

function fallbackText(phase: string): string {
  switch (phase) {
    case "context":
      return "Waiting for a context pack.";
    case "plan":
      return "No agent plan has been recorded.";
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
