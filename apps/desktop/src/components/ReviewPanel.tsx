import type { RunDetail } from "../lib/types";
import { RunStatusBadge } from "./RunStatusBadge";

interface ReviewPanelProps {
  run?: RunDetail;
}

export function ReviewPanel({ run }: ReviewPanelProps): JSX.Element {
  if (!run) {
    return (
      <aside className="review-panel">
        <div className="empty-review">No run selected</div>
      </aside>
    );
  }

  return (
    <aside className="review-panel">
      <div className="review-body">
        <div className="summary-stack">
          <section>
            <div className="summary-heading">
              <div>
                <div className="panel-label">Run Summary</div>
                <p>{run.summary}</p>
              </div>
              <RunStatusBadge status={run.status} />
            </div>
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
      </div>
    </aside>
  );
}
