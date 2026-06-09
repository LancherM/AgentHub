import { useMemo, useState } from "react";
import { agentHubApi } from "../lib/agentHubApi";
import type { MemoryApprovalResult, MemoryProposal } from "../lib/types";

interface MemoryProposalsProps {
  runId: string;
  proposals: MemoryProposal[];
  onReload(proposals: MemoryProposal[]): void;
}

export function MemoryProposals({
  runId,
  proposals,
  onReload
}: MemoryProposalsProps): JSX.Element {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [approvalResults, setApprovalResults] = useState<MemoryApprovalResult[]>(
    []
  );
  const grouped = useMemo(() => groupProposals(proposals), [proposals]);
  const selected = [...selectedIds];
  const hasPendingSelection = proposals.some(
    (item) => selectedIds.has(item.id) && item.status === "pending"
  );

  async function decide(action: "approve" | "ignore"): Promise<void> {
    setBusy(true);
    try {
      const ids = proposals
        .filter((item) => selectedIds.has(item.id) && item.status === "pending")
        .map((item) => item.id);
      if (ids.length === 0) {
        return;
      }
      if (action === "approve") {
        setApprovalResults(await agentHubApi.memory.approve(ids));
      } else {
        await agentHubApi.memory.ignore(ids);
        setApprovalResults([]);
      }
      const next = await agentHubApi.memory.listProposals(runId);
      setSelectedIds(new Set());
      onReload(next);
    } finally {
      setBusy(false);
    }
  }

  if (proposals.length === 0) {
    return <p className="muted-copy">No memory proposals for this run.</p>;
  }

  return (
    <div className="memory-list">
      <div className="memory-toolbar">
        <span>{selected.length} selected</span>
        <button
          onClick={() => void decide("approve")}
          disabled={busy || !hasPendingSelection}
        >
          Approve selected
        </button>
        <button
          onClick={() => void decide("ignore")}
          disabled={busy || !hasPendingSelection}
        >
          Ignore selected
        </button>
      </div>
      {approvalResults.length > 0 ? (
        <div className="memory-writeback">
          <div className="panel-label">Approved memory writeback</div>
          {approvalResults.map((result) => (
            <div key={result.id}>
              <strong>{result.writeback.replace("_", " ")}</strong>
              <span>{result.content ?? result.id}</span>
              {result.approvedMemoryPath ? (
                <code>{result.approvedMemoryPath}</code>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {(["pending", "approved", "ignored"] as const).map((status) => {
        const items = grouped[status];
        if (items.length === 0) {
          return null;
        }
        return (
          <section key={status} className="memory-group">
            <div className="panel-label">{status}</div>
            {items.map((item) => (
              <article className={`memory-item ${item.status}`} key={item.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(item.id)}
                    disabled={item.status !== "pending"}
                    onChange={(event) => {
                      setSelectedIds((current) => {
                        const next = new Set(current);
                        if (event.target.checked) {
                          next.add(item.id);
                        } else {
                          next.delete(item.id);
                        }
                        return next;
                      });
                    }}
                  />
                  <span>{item.source}</span>
                </label>
                <p>{item.content}</p>
                {item.autoApproval ? (
                  <div className="memory-automation-badges">
                    <span className="timeline-chip accent">
                      auto approved
                    </span>
                    <span className="timeline-chip neutral">
                      {item.autoApproval.policyMode}
                    </span>
                    {item.autoApproval.riskLevel ? (
                      <span className="timeline-chip neutral">
                        risk {item.autoApproval.riskLevel}
                      </span>
                    ) : null}
                    {item.autoApproval.verificationStatus ? (
                      <span className="timeline-chip neutral">
                        checks {item.autoApproval.verificationStatus}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {item.rationale ? (
                  <small>{item.rationale}</small>
                ) : null}
                {item.status === "approved" && item.approvedMemoryPath ? (
                  <small>
                    Approved memory file: <code>{item.approvedMemoryPath}</code>
                  </small>
                ) : null}
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}

function groupProposals(proposals: MemoryProposal[]): Record<
  MemoryProposal["status"],
  MemoryProposal[]
> {
  return {
    pending: proposals.filter((item) => item.status === "pending"),
    approved: proposals.filter((item) => item.status === "approved"),
    ignored: proposals.filter((item) => item.status === "ignored")
  };
}
