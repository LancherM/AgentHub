import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { agentHubApi } from "../../lib/agentHubApi";
import type {
  DiffSummary,
  HandoffCopyKind,
  MemoryProposal,
  ReviewHandoff,
  ReviewSummary,
  RiskReport as RiskReportModel,
  RunDetail,
  RunInspectorTab,
  RunLog,
  RunLogLevel,
  VerificationReport as VerificationReportModel
} from "../../lib/types";
import { DiffViewer } from "../DiffViewer";
import { MemoryProposals } from "../MemoryProposals";
import { RiskReport } from "../RiskReport";
import { RunStatusBadge } from "../RunStatusBadge";
import { VerificationPanel } from "../VerificationPanel";

interface RunInspectorModalProps {
  runId: string;
  initialRun?: RunDetail;
  initialTab?: RunInspectorTab;
  onClose(): void;
}

type LoadState<T> = {
  loading: boolean;
  data?: T;
  error?: string;
};

const tabs: Array<{ id: RunInspectorTab; label: string }> = [
  { id: "summary", label: "Summary" },
  { id: "diff", label: "Diff" },
  { id: "tests", label: "Tests" },
  { id: "risk", label: "Risk" },
  { id: "handoff", label: "Handoff" },
  { id: "memory", label: "Memory" },
  { id: "logs", label: "Logs" }
];

export function RunInspectorModal({
  runId,
  initialRun,
  initialTab = "summary",
  onClose
}: RunInspectorModalProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<RunInspectorTab>(initialTab);
  const [summary, setSummary] = useState<LoadState<ReviewSummary>>({
    loading: true
  });
  const [diff, setDiff] = useState<LoadState<DiffSummary>>({ loading: false });
  const [verification, setVerification] =
    useState<LoadState<VerificationReportModel>>({ loading: false });
  const [risk, setRisk] = useState<LoadState<RiskReportModel>>({
    loading: false
  });
  const [handoff, setHandoff] = useState<LoadState<ReviewHandoff>>({
    loading: false
  });
  const [memory, setMemory] = useState<LoadState<MemoryProposal[]>>({
    loading: false
  });
  const [logs, setLogs] = useState<LoadState<RunLog[]>>({ loading: false });
  const [decisionMessage, setDecisionMessage] = useState<string | undefined>();

  useEffect(() => {
    setActiveTab(initialTab);
    setDecisionMessage(undefined);
    setSummary({ loading: true });
    setDiff({ loading: false });
    setVerification({ loading: false });
    setRisk({ loading: false });
    setHandoff({ loading: false });
    setMemory({ loading: false });
    setLogs({ loading: false });
    void loadSummary();
    if (initialTab !== "summary") {
      void loadTab(initialTab);
    }
  }, [initialTab, runId]);

  useEffect(() => {
    void loadTab(activeTab);
  }, [activeTab]);

  async function loadSummary(): Promise<void> {
    setSummary((current) => ({ ...current, loading: true, error: undefined }));
    try {
      setSummary({
        loading: false,
        data: await agentHubApi.review.getSummary(runId)
      });
    } catch (error) {
      setSummary({ loading: false, error: errorMessage(error) });
    }
  }

  async function loadTab(tab: RunInspectorTab): Promise<void> {
    if (tab === "summary") {
      if (!summary.data && !summary.loading) {
        await loadSummary();
      }
      return;
    }
    if (tab === "diff") {
      await loadState(setDiff, () => agentHubApi.review.getDiff(runId));
    } else if (tab === "tests") {
      await loadState(setVerification, () =>
        agentHubApi.review.getVerification(runId)
      );
    } else if (tab === "risk") {
      await loadState(setRisk, () => agentHubApi.review.getRisk(runId));
    } else if (tab === "handoff") {
      await loadState(setHandoff, () => agentHubApi.review.getHandoff(runId));
    } else if (tab === "memory") {
      await loadState(setMemory, () => agentHubApi.memory.listProposals(runId));
      await loadSummary();
    } else if (tab === "logs") {
      await loadState(setLogs, () => agentHubApi.review.getLogs(runId));
    }
  }

  async function refresh(): Promise<void> {
    setDecisionMessage(undefined);
    await loadSummary();
    await loadTab(activeTab);
  }

  async function accept(): Promise<void> {
    setDecisionMessage(undefined);
    try {
      const next = await agentHubApi.review.accept(runId);
      setSummary({ loading: false, data: next });
      setDecisionMessage("Accepted for record. No merge was performed.");
    } catch (error) {
      setSummary({ loading: false, data: summary.data, error: errorMessage(error) });
    }
  }

  async function reject(): Promise<void> {
    setDecisionMessage(undefined);
    try {
      const next = await agentHubApi.review.reject(runId);
      setSummary({ loading: false, data: next });
      setDecisionMessage("Rejected for record. No files were deleted or reverted.");
    } catch (error) {
      setSummary({ loading: false, data: summary.data, error: errorMessage(error) });
    }
  }

  async function openHandoff(): Promise<void> {
    setDecisionMessage(undefined);
    try {
      const result = await agentHubApi.review.openHandoffWorktree(runId);
      setDecisionMessage(result.message);
      if (!result.ok) {
        await loadState(setHandoff, () => agentHubApi.review.getHandoff(runId));
      }
    } catch (error) {
      setDecisionMessage(errorMessage(error));
    }
  }

  async function copyHandoff(kind: HandoffCopyKind): Promise<void> {
    setDecisionMessage(undefined);
    try {
      const result = await agentHubApi.review.copyHandoffValue(runId, kind);
      setDecisionMessage(result.message);
    } catch (error) {
      setDecisionMessage(errorMessage(error));
    }
  }

  const title = summary.data?.task ?? initialRun?.title ?? "Loading run...";

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
            <h2>{title}</h2>
            <div className="inspector-status-row">
              {summary.data ? (
                <>
                  <RunStatusBadge status={summary.data.status} compact />
                  <span className={`review-state ${summary.data.reviewStatus}`}>
                    {summary.data.reviewStatus}
                  </span>
                </>
              ) : null}
            </div>
          </div>
          <div className="inspector-actions">
            <button className="ghost-button" onClick={() => void refresh()}>
              Refresh
            </button>
            <button className="ghost-button" onClick={() => void accept()}>
              Record Accept
            </button>
            <button className="ghost-button danger" onClick={() => void reject()}>
              Record Reject
            </button>
            <button className="ghost-button" onClick={onClose}>
              Close
            </button>
          </div>
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
          {decisionMessage ? (
            <div className="decision-strip">{decisionMessage}</div>
          ) : null}
          {activeTab === "summary" ? (
            <LoadSlot state={summary}>
              {(data) => <Summary summary={data} fallbackRun={initialRun} />}
            </LoadSlot>
          ) : activeTab === "diff" ? (
            <LoadSlot state={diff}>{(data) => <DiffViewer diff={data} />}</LoadSlot>
          ) : activeTab === "tests" ? (
            <LoadSlot state={verification}>
              {(data) => <VerificationPanel report={data} />}
            </LoadSlot>
          ) : activeTab === "risk" ? (
            <LoadSlot state={risk}>{(data) => <RiskReport report={data} />}</LoadSlot>
          ) : activeTab === "handoff" ? (
            <LoadSlot state={handoff}>
              {(data) => (
                <HandoffPanel
                  handoff={data}
                  onOpen={() => void openHandoff()}
                  onCopy={(kind) => void copyHandoff(kind)}
                />
              )}
            </LoadSlot>
          ) : activeTab === "memory" ? (
            <LoadSlot state={memory}>
              {(data) => (
                <MemoryProposals
                  runId={runId}
                  proposals={data}
                  onReload={(next) => setMemory({ loading: false, data: next })}
                />
              )}
            </LoadSlot>
          ) : (
            <LoadSlot state={logs}>{(data) => <LogView logs={data} />}</LoadSlot>
          )}
        </div>
      </aside>
    </div>
  );
}

function Summary({
  summary,
  fallbackRun
}: {
  summary: ReviewSummary;
  fallbackRun?: RunDetail;
}): JSX.Element {
  return (
    <div className="summary-stack">
      <section>
        <div className="summary-heading">
          <div>
            <div className="panel-label">Summary</div>
            <p>{summary.summary}</p>
            {summary.message ? <p className="muted-copy">{summary.message}</p> : null}
          </div>
          <RunStatusBadge status={summary.status} />
        </div>
      </section>
      <section className="summary-metrics wide handoff-metrics">
        <Metric label="Agent" value={`@${summary.agentId}`} />
        <Metric label="Review" value={summary.reviewStatus} />
        <Metric label="Duration" value={formatDuration(summary.durationMs)} />
        <Metric label="Diff" value={`${summary.changedFileCount} files`} />
        <Metric label="Lines" value={`+${summary.additions}/-${summary.deletions}`} />
        <Metric label="Tests" value={summary.verificationStatus} />
        <Metric label="Risk" value={summary.riskLevel} />
        <Metric label="Memory" value={`${summary.memoryProposalCount}`} />
        <Metric label="Parent" value={summary.parentRunId ?? "none"} />
      </section>
      <section>
        <div className="panel-label">Task</div>
        <p>{summary.task || fallbackRun?.taskPrompt || "No task text recorded."}</p>
      </section>
      <section>
        <div className="panel-label">Decision Boundary</div>
        <p>
          Accepting or rejecting records review state only. It does not merge,
          push, delete worktrees, revert files, or write repository context files.
        </p>
      </section>
    </div>
  );
}

function HandoffPanel({
  handoff,
  onOpen,
  onCopy
}: {
  handoff: ReviewHandoff;
  onOpen(): void;
  onCopy(kind: HandoffCopyKind): void;
}): JSX.Element {
  return (
    <div className="summary-stack">
      <section>
        <div className="summary-heading">
          <div>
            <div className="panel-label">Manual Handoff</div>
            <p>
              {handoff.message ??
                "No retained worktree evidence is available for this run."}
            </p>
          </div>
          <span className={`handoff-state ${handoff.available ? "ready" : "unavailable"}`}>
            {handoff.available ? "retained" : "unavailable"}
          </span>
        </div>
      </section>

      <section className="summary-metrics wide">
        <Metric label="Worktree" value={handoff.worktreePath ?? "none"} />
        <Metric label="Branch" value={handoff.branchName ?? "none"} />
        <Metric label="Base" value={handoff.baseRef ?? "none"} />
        <Metric label="Head" value={handoff.headRef ?? "none"} />
        <Metric
          label="Cleanup"
          value={handoff.cleanup.cleaned ? "cleaned" : handoff.cleanup.retained ? "retained" : "unknown"}
        />
        <Metric label="Files" value={`${handoff.changedFiles.length}`} />
      </section>

      {handoff.cleanup.reason ? (
        <section>
          <div className="panel-label">Cleanup Reason</div>
          <p>{handoff.cleanup.reason}</p>
        </section>
      ) : null}

      <section>
        <div className="panel-label">Worktree Evidence</div>
        <div className="handoff-value-list">
          <div>
            <span>Path</span>
            <code>{handoff.worktreePath ?? "none"}</code>
          </div>
          <div>
            <span>Branch</span>
            <code>{handoff.branchName ?? "none"}</code>
          </div>
        </div>
      </section>

      <section>
        <div className="review-section-head">
          <div>
            <div className="panel-label">Local Actions</div>
            <p className="muted-copy">
              These actions open or copy review information only.
            </p>
          </div>
        </div>
        <div className="handoff-action-row">
          <button
            className="ghost-button"
            onClick={onOpen}
            disabled={!handoff.available}
          >
            Open Worktree
          </button>
          <button
            className="ghost-button"
            onClick={() => onCopy("worktree_path")}
            disabled={!handoff.available || !handoff.worktreePath}
          >
            Copy Path
          </button>
          <button
            className="ghost-button"
            onClick={() => onCopy("branch_name")}
            disabled={!handoff.available || !handoff.branchName}
          >
            Copy Branch
          </button>
          <button
            className="ghost-button"
            onClick={() => onCopy("review_commands")}
            disabled={!handoff.available || handoff.commands.length === 0}
          >
            Copy Commands
          </button>
        </div>
      </section>

      <section>
        <div className="panel-label">Changed Files</div>
        {handoff.changedFiles.length === 0 ? (
          <p className="muted-copy">No changed files are available for handoff.</p>
        ) : (
          <ul className="file-list">
            {handoff.changedFiles.map((file) => (
              <li key={file.path}>
                <span className={`file-status ${file.status}`}>{file.status}</span>
                <strong>{file.path}</strong>
                <em>+{file.additions}/-{file.deletions}</em>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="panel-label">Review Commands</div>
        {handoff.commands.length === 0 ? (
          <p className="muted-copy">No review commands are available.</p>
        ) : (
          <div className="handoff-command-list">
            {handoff.commands.map((command) => (
              <div key={command.label}>
                <span>{command.label}</span>
                <code>{command.command}</code>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="panel-label">Boundary</div>
        <p>
          Agent Hub does not merge, push, apply patches, delete worktrees, or write
          repository context files from this handoff.
        </p>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function LogView({ logs }: { logs: RunLog[] }): JSX.Element {
  const [filter, setFilter] = useState<RunLogLevel | "all">("all");
  const filteredLogs = useMemo(
    () => logs.filter((log) => filter === "all" || log.level === filter),
    [filter, logs]
  );
  if (logs.length === 0) {
    return <p className="muted-copy">No run logs recorded.</p>;
  }
  return (
    <div className="logs-panel">
      <div className="log-filter-row">
        {(["all", "stdout", "stderr", "error"] as const).map((level) => (
          <button
            key={level}
            className={filter === level ? "active" : ""}
            onClick={() => setFilter(level)}
          >
            {level}
          </button>
        ))}
      </div>
      <div className="log-view">
        {filteredLogs.map((log) => (
          <div className={`run-event-line ${log.level}`} key={log.id}>
            <span>{formatTime(log.timestamp)}</span>
            <p>{log.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function LoadSlot<T>({
  state,
  children
}: {
  state: LoadState<T>;
  children(data: T): JSX.Element;
}): JSX.Element {
  if (state.error) {
    return <div className="inline-error">Failed to load review data: {state.error}</div>;
  }
  if (state.loading || state.data === undefined) {
    return <div className="empty-review">Loading review data...</div>;
  }
  return children(state.data);
}

async function loadState<T>(
  setState: Dispatch<SetStateAction<LoadState<T>>>,
  loader: () => Promise<T>
): Promise<void> {
  setState((current) => ({ ...current, loading: true, error: undefined }));
  try {
    setState({ loading: false, data: await loader() });
  } catch (error) {
    setState({ loading: false, error: errorMessage(error) });
  }
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function formatDuration(durationMs: number | undefined): string {
  if (durationMs === undefined) {
    return "unknown";
  }
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
