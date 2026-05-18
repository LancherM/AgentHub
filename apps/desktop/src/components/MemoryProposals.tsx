import { useEffect, useState } from "react";
import { agentHubApi } from "../lib/agentHubApi";
import type { MemoryProposal } from "../lib/types";

interface MemoryProposalsProps {
  runId: string;
  proposals: MemoryProposal[];
}

export function MemoryProposals({
  runId,
  proposals
}: MemoryProposalsProps): JSX.Element {
  const [items, setItems] = useState(proposals);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setItems(proposals);
  }, [proposals]);

  async function decide(id: string, action: "approve" | "ignore"): Promise<void> {
    setBusyIds((current) => new Set([...current, id]));
    if (action === "approve") {
      await agentHubApi.memory.approve([id]);
    } else {
      await agentHubApi.memory.ignore([id]);
    }
    const next = await agentHubApi.memory.listProposals(runId);
    setItems(next);
    setBusyIds(new Set());
  }

  if (items.length === 0) {
    return <p className="muted-copy">No memory proposals for this run.</p>;
  }

  return (
    <div className="memory-list">
      {items.map((item) => (
        <article className="memory-item" key={item.id}>
          <div>
            <span>{item.category}</span>
            <p>{item.content}</p>
          </div>
          <div className="memory-actions">
            <button
              onClick={() => void decide(item.id, "approve")}
              disabled={busyIds.has(item.id)}
            >
              Approve
            </button>
            <button
              onClick={() => void decide(item.id, "ignore")}
              disabled={busyIds.has(item.id)}
            >
              Ignore
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
