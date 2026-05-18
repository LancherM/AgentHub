import { useEffect, useState } from "react";
import { agentHubApi } from "../../lib/agentHubApi";
import type { RunDetail, RunEvent } from "../../lib/types";
import { DiffViewer } from "../DiffViewer";
import { MemoryProposals } from "../MemoryProposals";
import { RiskReport } from "../RiskReport";
import { RunStatusBadge } from "../RunStatusBadge";
import { VerificationPanel } from "../VerificationPanel";

interface RunInspectorModalProps {
  runId: string;
  initialRun?: RunDetail;
  onClose(): void;
}

type InspectorTab = "summary" | "diff" | "tests" | "risk" | "memory" | "logs";

const tabs: Array<{ id: InspectorTab; label: string }> = [
  { id: "summary", label: "Summary" },
  { id: "diff", label: "Diff" },
  { id: "tests", label: "Tests" },
  { id: "risk", label: "Risk" },
  { id: "memory", label: "Memory" },
  { id: "logs", label: "Logs" }
];

export function RunInspectorModal({
  runId,
  initialRun,
  onClose
}: RunInspectorModalProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<InspectorTab>("summary");
  const [run, setRun] = useState<RunDetail | undefined>(initialRun);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let active = true;
    setRun(initialRun);
    setError(undefined);
    void agentHubApi.runs
      .get(runId)
      .then((detail) => {
        if (active) {
          setRun(detail);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(errorMessage(err));
        }
      });
    return () => {
      active = false;
    };
  }, [initialRun, runId]);

  return (
    <div className="inspector-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        className="run-inspector"
        role="dialog"
        aria-modal="true"
        aria-label="Run inspector"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="inspector-header">
          <div>
            <div className="eyebrow">Run Inspector</div>
            <h2>{run?.title ?? "Loading run..."}</h2>
          </div>
          <button className="ghost-button" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="review-tabs inspector-tabs" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={activeTab === tab.id ? "active" : ""}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              aria-selected={activeTab === tab.id}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="inspector-body">
          {error ? (
            <div className="inline-error">Failed to load run: {error}</div>
          ) : !run ? (
            <div className="empty-review">Loading run details...</div>
          ) : activeTab === "summary" ? (
            <Summary run={run} />
          ) : activeTab === "diff" ? (
            <DiffViewer runId={run.id} initialChangedFiles={run.changedFiles} />
          ) : activeTab === "tests" ? (
            <VerificationPanel report={run.verification} />
          ) : activeTab === "risk" ? (
            <RiskReport report={run.risk} />
          ) : activeTab === "memory" ? (
            <MemoryProposals runId={run.id} proposals={run.memoryProposals} />
          ) : (
            <LogView events={run.events} />
          )}
        </div>
      </aside>
    </div>
  );
}

function Summary({ run }: { run: RunDetail }): JSX.Element {
  return (
    <div className="summary-stack">
      <section>
        <div className="summary-heading">
          <div>
            <div className="panel-label">Summary</div>
            <p>{run.summary}</p>
          </div>
          <RunStatusBadge status={run.status} />
        </div>
      </section>
      <section>
        <div className="panel-label">Repository Boundary</div>
        <p>
          {run.changedFiles.length === 0
            ? "No real file modifications were recorded for this desktop run."
            : "Review changed files before accepting any output."}
        </p>
      </section>
      <section>
        <div className="panel-label">Task</div>
        <p>{run.taskPrompt}</p>
      </section>
      <section className="summary-metrics">
        <div>
          <span>Agent</span>
          <strong>@{run.agentId}</strong>
        </div>
        <div>
          <span>Tests</span>
          <strong>{run.verification.status}</strong>
        </div>
        <div>
          <span>Risk</span>
          <strong>{run.risk.level}</strong>
        </div>
      </section>
    </div>
  );
}

function LogView({ events }: { events: RunEvent[] }): JSX.Element {
  if (events.length === 0) {
    return <p className="muted-copy">No run events recorded.</p>;
  }
  return (
    <div className="log-view">
      {events.map((event) => (
        <div className="run-event-line" key={event.id}>
          <span>{event.type}</span>
          <p>{event.payload.message ?? event.payload.summary ?? event.type}</p>
        </div>
      ))}
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
