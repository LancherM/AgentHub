import { useMemo, useState } from "react";
import {
  roleCallAffordance,
  roleCallStatusTone,
  roleTodoStatusTone
} from "../../lib/role-call-ui";
import type {
  RoleCallUiCall,
  RoleCallUiEvidenceKind,
  RoleCallUiSummary,
  TimelineEventTone
} from "../../lib/types";

interface RoleCallSummaryProps {
  summary: RoleCallUiSummary;
}

const evidenceLabels: Record<RoleCallUiEvidenceKind, string> = {
  evidence: "Evidence",
  command: "Commands",
  file: "Files",
  risk: "Risks",
  raw_json: "Raw JSON"
};

export function RoleCallSummary({
  summary
}: RoleCallSummaryProps): JSX.Element {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const affordance = useMemo(() => roleCallAffordance(summary), [summary]);

  return (
    <>
      <div className="role-call-affordance-row" aria-label="Role call summary">
        <span className={`timeline-chip ${affordance.tone}`}>
          {affordance.label}
        </span>
        {summary.counts.waitingApproval > 0 ? (
          <span className="timeline-chip warning">Approval pending</span>
        ) : null}
        <button
          className="role-call-details-button"
          type="button"
          onClick={() => setDetailsOpen(true)}
        >
          Open role details
        </button>
      </div>
      {detailsOpen ? (
        <RoleCallInspector summary={summary} onClose={() => setDetailsOpen(false)} />
      ) : null}
    </>
  );
}

function RoleCallInspector({
  summary,
  onClose
}: {
  summary: RoleCallUiSummary;
  onClose(): void;
}): JSX.Element {
  const affordance = roleCallAffordance(summary);
  return (
    <div className="inspector-backdrop role-call-inspector-backdrop">
      <aside
        className="run-inspector deep-review role-call-inspector"
        aria-label="Role call details"
      >
        <header className="inspector-header">
          <div className="inspector-title-row">
            <div className="inspector-title-copy">
              <h2>Role Details</h2>
              <p>{affordance.label}</p>
            </div>
            <button
              className="inspector-close-button"
              type="button"
              onClick={onClose}
            >
              Close
            </button>
          </div>
          <div className="inspector-action-row">
            <div className="role-call-status-strip">
              <span className="timeline-chip info">Graph</span>
              <span className="timeline-chip warning">Todo</span>
              <span className="timeline-chip danger">Approval placeholder</span>
            </div>
            <div className="inspector-utility-actions">
              <button className="ghost-button compact" type="button" disabled>
                Retry
              </button>
              <button className="ghost-button compact" type="button" disabled>
                Cancel
              </button>
              <button className="ghost-button compact" type="button" disabled>
                Approve
              </button>
            </div>
          </div>
        </header>
        <div className="inspector-body role-call-inspector-body">
          <section className="role-call-section">
            <header className="role-call-section-heading">
              <span>RoleCall Graph</span>
              <small>{summary.calls.length} call nodes</small>
            </header>
            <div className="role-call-graph-list">
              {summary.calls.map((call) => (
                <RoleCallCard call={call} key={call.id} />
              ))}
            </div>
          </section>

          <section className="role-call-section">
            <header className="role-call-section-heading">
              <span>Todos</span>
              <small>{summary.todos.length} ledger items</small>
            </header>
            {summary.todos.length > 0 ? (
              <div className="role-call-todo-list">
                {summary.todos.map((todo) => (
                  <article className="role-call-todo-row" key={todo.id}>
                    <div>
                      <strong>{todo.title}</strong>
                      <span>@{todo.role} · {todo.priority}</span>
                    </div>
                    <span className={`timeline-chip ${roleTodoStatusTone(todo.status)}`}>
                      {todo.status.replace(/_/g, " ")}
                    </span>
                  </article>
                ))}
              </div>
            ) : (
              <p className="role-call-empty-state">No role todos recorded.</p>
            )}
          </section>

          <details className="role-call-collapsible">
            <summary>Event Stream</summary>
            <div className="role-call-event-stream">
              {summary.events.map((event) => (
                <article className="role-call-event-row" key={event.id}>
                  <span>{formatTime(event.createdAt)}</span>
                  <strong>{event.type.replace(/_/g, " ")}</strong>
                  <p>{event.message}</p>
                </article>
              ))}
            </div>
          </details>

          <details className="role-call-collapsible">
            <summary>Linked Evidence</summary>
            <EvidenceGroups calls={summary.calls} />
          </details>

          <details className="role-call-collapsible">
            <summary>Raw JSON</summary>
            <div className="role-call-raw-json-list">
              {summary.calls.map((call) =>
                call.rawJson ? (
                  <pre key={call.id}>{call.rawJson}</pre>
                ) : null
              )}
            </div>
          </details>
        </div>
      </aside>
    </div>
  );
}

function RoleCallCard({ call }: { call: RoleCallUiCall }): JSX.Element {
  return (
    <article className="role-call-card">
      <div className="role-call-card-main">
        <span className="role-call-edge">
          @{call.callerRole} -&gt; @{call.calleeRole}
        </span>
        <strong>{call.task}</strong>
        {call.decision ? <p>{call.decision.reason}</p> : null}
        {call.resultSummary ? <p>{call.resultSummary}</p> : null}
      </div>
      <div className="role-call-card-meta">
        <span className={`timeline-chip ${roleCallStatusTone(call.status)}`}>
          {call.status.replace(/_/g, " ")}
        </span>
        <span className="timeline-chip neutral">{call.priority}</span>
        {call.taskRunId ? (
          <span className="timeline-chip info">run {shortId(call.taskRunId)}</span>
        ) : null}
      </div>
    </article>
  );
}

function EvidenceGroups({ calls }: { calls: RoleCallUiCall[] }): JSX.Element {
  const items = calls.flatMap((call) =>
    call.evidence.map((item) => ({
      ...item,
      roleCallId: call.id,
      edge: `@${call.callerRole} -> @${call.calleeRole}`
    }))
  );
  if (items.length === 0) {
    return <p className="role-call-empty-state">No linked evidence recorded.</p>;
  }
  return (
    <div className="role-call-evidence-list">
      {items.map((item) => (
        <article className="role-call-evidence-row" key={item.id}>
          <span className={`timeline-chip ${item.tone ?? evidenceTone(item.kind)}`}>
            {evidenceLabels[item.kind]}
          </span>
          <div>
            <strong>{item.label}</strong>
            <p>{item.summary ?? item.edge}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

function evidenceTone(kind: RoleCallUiEvidenceKind): TimelineEventTone {
  if (kind === "risk") {
    return "warning";
  }
  if (kind === "command") {
    return "info";
  }
  return "neutral";
}

function shortId(value: string): string {
  return value.length > 8 ? value.slice(0, 8) : value;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}
