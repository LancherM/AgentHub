import { useState } from "react";
import type { RunDetail } from "../lib/types";
import { DiffViewer } from "./DiffViewer";
import { MemoryProposals } from "./MemoryProposals";
import { RiskReport } from "./RiskReport";
import { VerificationPanel } from "./VerificationPanel";

interface ReviewPanelProps {
  run?: RunDetail;
}

type ReviewTab = "summary" | "diff" | "tests" | "risk" | "memory";

const tabs: Array<{ id: ReviewTab; label: string }> = [
  { id: "summary", label: "Summary" },
  { id: "diff", label: "Diff" },
  { id: "tests", label: "Tests" },
  { id: "risk", label: "Risk" },
  { id: "memory", label: "Memory" }
];

export function ReviewPanel({ run }: ReviewPanelProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<ReviewTab>("summary");

  return (
    <aside className="review-panel">
      <div className="review-tabs" role="tablist">
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

      <div className="review-body">
        {!run ? (
          <div className="empty-review">No run selected</div>
        ) : activeTab === "summary" ? (
          <Summary run={run} />
        ) : activeTab === "diff" ? (
          <DiffViewer runId={run.id} initialChangedFiles={run.changedFiles} />
        ) : activeTab === "tests" ? (
          <VerificationPanel report={run.verification} />
        ) : activeTab === "risk" ? (
          <RiskReport report={run.risk} />
        ) : (
          <MemoryProposals runId={run.id} proposals={run.memoryProposals} />
        )}
      </div>
    </aside>
  );
}

function Summary({ run }: { run: RunDetail }): JSX.Element {
  return (
    <div className="summary-stack">
      <section>
        <div className="panel-label">Final Summary</div>
        <p>{run.summary}</p>
      </section>
      <section>
        <div className="panel-label">Changed Files</div>
        {run.changedFiles.length === 0 ? (
          <p className="muted-copy">No changed files recorded.</p>
        ) : (
          <ul className="file-list">
            {run.changedFiles.map((file) => (
              <li key={file}>{file}</li>
            ))}
          </ul>
        )}
      </section>
      <section className="summary-metrics">
        <div>
          <span>Agent</span>
          <strong>@{run.agentKind === "claude-code" ? "claude" : run.agentKind}</strong>
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
