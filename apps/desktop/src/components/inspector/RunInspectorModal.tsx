import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { agentHubApi } from "../../lib/agentHubApi";
import type {
  ComparisonCandidate,
  ComparisonReport,
  ComparisonVerificationSignal,
  DiffSummary,
  HandoffCopyKind,
  MemoryProposal,
  ReviewContext,
  ReviewHandoff,
  ReviewSummary,
  RiskReport as RiskReportModel,
  RunDetail,
  RunInspectorTab,
  RunLog,
  RunLogLevel,
  WorkgroupInspectorTab,
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

const tabs: Array<{ id: WorkgroupInspectorTab; label: string }> = [
  { id: "brief", label: "Brief" },
  { id: "context", label: "Context" },
  { id: "artifacts", label: "Artifacts" },
  { id: "checks", label: "Checks" },
  { id: "risks", label: "Risks" },
  { id: "memory", label: "Memory" },
  { id: "audit", label: "Audit" }
];

interface ComparisonPanelData {
  candidates: ComparisonCandidate[];
  reports: ComparisonReport[];
}

export function RunInspectorModal({
  runId,
  initialRun,
  initialTab = "brief",
  onClose
}: RunInspectorModalProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<WorkgroupInspectorTab>(
    normalizeInspectorTab(initialTab)
  );
  const [summary, setSummary] = useState<LoadState<ReviewSummary>>({
    loading: true
  });
  const [context, setContext] = useState<LoadState<ReviewContext>>({
    loading: false
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
  const [comparison, setComparison] = useState<LoadState<ComparisonPanelData>>({
    loading: false
  });
  const [memory, setMemory] = useState<LoadState<MemoryProposal[]>>({
    loading: false
  });
  const [logs, setLogs] = useState<LoadState<RunLog[]>>({ loading: false });
  const [decisionMessage, setDecisionMessage] = useState<string | undefined>();

  useEffect(() => {
    const normalizedInitialTab = normalizeInspectorTab(initialTab);
    setActiveTab(normalizedInitialTab);
    setDecisionMessage(undefined);
    setSummary({ loading: true });
    setContext({ loading: false });
    setDiff({ loading: false });
    setVerification({ loading: false });
    setRisk({ loading: false });
    setHandoff({ loading: false });
    setComparison({ loading: false });
    setMemory({ loading: false });
    setLogs({ loading: false });
    void loadSummary();
    if (normalizedInitialTab !== "brief") {
      void loadTab(normalizedInitialTab);
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

  async function loadTab(tab: WorkgroupInspectorTab): Promise<void> {
    if (tab === "brief") {
      if (!summary.data && !summary.loading) {
        await loadSummary();
      }
      return;
    }
    if (tab === "context") {
      await loadState(setContext, () => agentHubApi.review.getContext(runId));
    } else if (tab === "artifacts") {
      await Promise.all([
        loadState(setDiff, () => agentHubApi.review.getDiff(runId)),
        loadState(setHandoff, () => agentHubApi.review.getHandoff(runId)),
        loadComparison()
      ]);
    } else if (tab === "checks") {
      await loadState(setVerification, () =>
        agentHubApi.review.getVerification(runId)
      );
    } else if (tab === "risks") {
      await loadState(setRisk, () => agentHubApi.review.getRisk(runId));
    } else if (tab === "memory") {
      await loadState(setMemory, () => agentHubApi.memory.listProposals(runId));
      await loadSummary();
    } else if (tab === "audit") {
      await loadState(setLogs, () => agentHubApi.review.getLogs(runId));
    }
  }

  async function refresh(): Promise<void> {
    setDecisionMessage(undefined);
    await loadSummary();
    await loadTab(activeTab);
  }

  async function loadComparison(): Promise<void> {
    await loadState(setComparison, async () => {
      const [candidates, reports] = await Promise.all([
        agentHubApi.comparison.listCandidates(runId),
        agentHubApi.comparison.listForRun(runId)
      ]);
      return { candidates, reports };
    });
  }

  async function createComparison(candidateRunId: string): Promise<void> {
    setDecisionMessage(undefined);
    setComparison((current) => ({ ...current, loading: true, error: undefined }));
    try {
      const report = await agentHubApi.comparison.create({
        baselineRunId: runId,
        candidateRunId
      });
      const [candidates, reports] = await Promise.all([
        agentHubApi.comparison.listCandidates(runId),
        agentHubApi.comparison.listForRun(runId)
      ]);
      setComparison({
        loading: false,
        data: {
          candidates,
          reports: upsertComparisonReport(reports, report)
        }
      });
      setDecisionMessage("Comparison report recorded. No code was applied.");
    } catch (error) {
      setComparison((current) => ({
        ...current,
        loading: false,
        error: errorMessage(error)
      }));
    }
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
        aria-label="Workgroup inspector"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="inspector-header">
          <div>
            <div className="eyebrow">Workgroup Inspector</div>
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
          {activeTab === "brief" ? (
            <LoadSlot state={summary}>
              {(data) => <Brief summary={data} fallbackRun={initialRun} />}
            </LoadSlot>
          ) : activeTab === "context" ? (
            <LoadSlot state={context}>{(data) => <ContextPanel context={data} />}</LoadSlot>
          ) : activeTab === "artifacts" ? (
            <ArtifactsPanel
              diff={diff}
              handoff={handoff}
              comparison={comparison}
              baselineRunId={runId}
              onOpenHandoff={() => void openHandoff()}
              onCopyHandoff={(kind) => void copyHandoff(kind)}
              onCreateComparison={(candidateRunId) => void createComparison(candidateRunId)}
            />
          ) : activeTab === "checks" ? (
            <LoadSlot state={verification}>
              {(data) => <VerificationPanel report={data} />}
            </LoadSlot>
          ) : activeTab === "risks" ? (
            <LoadSlot state={risk}>{(data) => <RiskReport report={data} />}</LoadSlot>
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

function Brief({
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
            <div className="panel-label">Brief</div>
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
        <Metric label="Artifacts" value={`${summary.changedFileCount} files`} />
        <Metric label="Lines" value={`+${summary.additions}/-${summary.deletions}`} />
        <Metric label="Checks" value={summary.verificationStatus} />
        <Metric label="Risks" value={summary.riskLevel} />
        <Metric label="Memory" value={`${summary.memoryProposalCount}`} />
        <Metric label="Parent" value={summary.parentRunId ?? "none"} />
      </section>
      <section>
        <div className="panel-label">Goal</div>
        <p>{summary.task || fallbackRun?.taskPrompt || "No task text recorded."}</p>
      </section>
      <section>
        <div className="panel-label">Assignees</div>
        <p>@{summary.agentId}</p>
      </section>
      <section>
        <div className="panel-label">Acceptance Criteria</div>
        <p>No explicit acceptance criteria metadata was captured for this run.</p>
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

function ContextPanel({ context }: { context: ReviewContext }): JSX.Element {
  return (
    <div className="summary-stack context-panel">
      <section>
        <div className="summary-heading">
          <div>
            <div className="panel-label">Context</div>
            <p>
              {context.available
                ? context.message ?? "Conversation brief is available."
                : context.message ?? "No conversation brief is available."}
            </p>
          </div>
          <span className={`handoff-state ${context.available ? "ready" : "unavailable"}`}>
            {context.available ? "available" : "unavailable"}
          </span>
        </div>
      </section>
      {context.available ? (
        <>
          <section className="summary-metrics wide">
            <Metric label="Artifact" value={context.artifactId ?? "unknown"} />
            <Metric label="Created" value={context.createdAt ? formatTime(context.createdAt) : "unknown"} />
            <Metric label="Source" value="conversation_brief" />
            <Metric label="Scope" value="runtime injection" />
          </section>
          <pre className="context-preview">{context.content?.trim() || "Conversation brief artifact is empty."}</pre>
        </>
      ) : null}
    </div>
  );
}

function ArtifactsPanel({
  diff,
  handoff,
  comparison,
  baselineRunId,
  onOpenHandoff,
  onCopyHandoff,
  onCreateComparison
}: {
  diff: LoadState<DiffSummary>;
  handoff: LoadState<ReviewHandoff>;
  comparison: LoadState<ComparisonPanelData>;
  baselineRunId: string;
  onOpenHandoff(): void;
  onCopyHandoff(kind: HandoffCopyKind): void;
  onCreateComparison(candidateRunId: string): void;
}): JSX.Element {
  return (
    <div className="summary-stack artifacts-panel">
      <section>
        <div className="summary-heading">
          <div>
            <div className="panel-label">Engineering Artifacts</div>
            <p>
              Diff, retained-worktree handoff, and comparison evidence stay here
              as review-only engineering details.
            </p>
          </div>
          <span className="handoff-state ready">review only</span>
        </div>
      </section>
      <LoadSlot state={diff}>{(data) => <DiffViewer diff={data} />}</LoadSlot>
      <LoadSlot state={handoff}>
        {(data) => (
          <HandoffPanel
            handoff={data}
            onOpen={onOpenHandoff}
            onCopy={onCopyHandoff}
          />
        )}
      </LoadSlot>
      <LoadSlot state={comparison}>
        {(data) => (
          <ComparisonPanel
            baselineRunId={baselineRunId}
            data={data}
            onCreate={onCreateComparison}
          />
        )}
      </LoadSlot>
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

function ComparisonPanel({
  baselineRunId,
  data,
  onCreate
}: {
  baselineRunId: string;
  data: ComparisonPanelData;
  onCreate(candidateRunId: string): void;
}): JSX.Element {
  const [selectedCandidateId, setSelectedCandidateId] = useState(
    data.candidates[0]?.runId ?? ""
  );

  useEffect(() => {
    if (
      selectedCandidateId &&
      data.candidates.some((candidate) => candidate.runId === selectedCandidateId)
    ) {
      return;
    }
    setSelectedCandidateId(data.candidates[0]?.runId ?? "");
  }, [data.candidates, selectedCandidateId]);

  const reports = [...data.reports].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt)
  );
  const latestReport = reports[0];

  return (
    <div className="summary-stack comparison-panel">
      <section>
        <div className="summary-heading">
          <div>
            <div className="panel-label">Comparison Review</div>
            <p>
              Compare this terminal run with another run from the same task or
              the same multi-agent desktop turn.
            </p>
          </div>
          <span className="handoff-state ready">review only</span>
        </div>
      </section>

      <section>
        <div className="review-section-head">
          <div>
            <div className="panel-label">Create Report</div>
            <p className="muted-copy">
              Reports are persisted locally and do not accept, merge, push, or
              apply code.
            </p>
          </div>
        </div>
        {data.candidates.length === 0 ? (
          <p className="muted-copy">
            No terminal comparison candidates are available for this run.
          </p>
        ) : (
          <div className="comparison-create-row">
            <label>
              <span>Candidate</span>
              <select
                value={selectedCandidateId}
                onChange={(event) => setSelectedCandidateId(event.target.value)}
              >
                {data.candidates.map((candidate) => (
                  <option key={candidate.runId} value={candidate.runId}>
                    {candidateLabel(candidate)}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="ghost-button"
              disabled={!selectedCandidateId}
              onClick={() => onCreate(selectedCandidateId)}
            >
              Create Comparison
            </button>
          </div>
        )}
      </section>

      {latestReport ? (
        <section>
          <div className="review-section-head">
            <div>
              <div className="panel-label">Latest Structured Signals</div>
              <p className="muted-copy">
                Baseline {shortId(baselineRunId)} compared with{" "}
                {shortId(latestReport.candidateRunId ?? "unknown")} by{" "}
                {scopeLabel(latestReport.scope)}.
              </p>
            </div>
          </div>
          <ComparisonSignals report={latestReport} />
        </section>
      ) : null}

      <section>
        <div className="panel-label">Reports</div>
        {reports.length === 0 ? (
          <p className="muted-copy">No comparison reports have been recorded.</p>
        ) : (
          <div className="comparison-report-list">
            {reports.map((report) => (
              <article key={report.id} className="comparison-report">
                <header>
                  <div>
                    <strong>{report.id}</strong>
                    <span>{scopeLabel(report.scope)}</span>
                  </div>
                  <time>{formatTime(report.createdAt)}</time>
                </header>
                <ComparisonSignals report={report} compact />
                <pre>{report.summary}</pre>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ComparisonSignals({
  report,
  compact = false
}: {
  report: ComparisonReport;
  compact?: boolean;
}): JSX.Element {
  const details = report.details;
  const baseline = details?.runs?.baseline;
  const candidate = details?.runs?.candidate;
  const score = details?.score;
  const diff = details?.diffSize;
  const verification = details?.verification;
  const risk = details?.risk;
  const changedFiles = details?.changedFiles;
  return (
    <div className={compact ? "comparison-signals compact" : "comparison-signals"}>
      <Metric label="Winner" value={score?.winner ?? "unknown"} />
      <Metric label="Score" value={formatScore(score?.baseline, score?.candidate)} />
      <Metric label="Baseline Status" value={baseline?.status ?? "unknown"} />
      <Metric label="Candidate Status" value={candidate?.status ?? "unknown"} />
      <Metric label="Risks" value={formatPair(risk?.baseline?.level, risk?.candidate?.level)} />
      <Metric
        label="Checks"
        value={formatVerificationPair(verification?.baseline, verification?.candidate)}
      />
      <Metric
        label="Artifacts"
        value={formatDiffPair(diff?.baseline, diff?.candidate)}
      />
      <Metric
        label="Overlap"
        value={
          changedFiles
            ? `${changedFiles.overlapCount ?? 0}/${Math.max(
                changedFiles.baselineCount ?? 0,
                changedFiles.candidateCount ?? 0
              )}`
            : "unknown"
        }
      />
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

function upsertComparisonReport(
  reports: ComparisonReport[],
  report: ComparisonReport
): ComparisonReport[] {
  return [report, ...reports.filter((entry) => entry.id !== report.id)];
}

function candidateLabel(candidate: ComparisonCandidate): string {
  return [
    `@${candidate.agentId}`,
    candidate.status,
    scopeLabel(candidate.scope),
    shortId(candidate.runId)
  ].join(" - ");
}

function scopeLabel(scope: ComparisonReport["scope"]): string {
  return scope === "conversation_turn" ? "same desktop turn" : "same task";
}

function shortId(value: string): string {
  return value.length > 14 ? `${value.slice(0, 14)}...` : value;
}

function formatScore(
  baseline: number | undefined,
  candidate: number | undefined
): string {
  return `${baseline ?? "?"}/${candidate ?? "?"}`;
}

function formatPair(
  baseline: string | undefined,
  candidate: string | undefined
): string {
  return `${baseline ?? "?"}/${candidate ?? "?"}`;
}

function formatVerificationPair(
  baseline: ComparisonVerificationSignal | undefined,
  candidate: ComparisonVerificationSignal | undefined
): string {
  return `${formatVerificationCounts(baseline)}/${formatVerificationCounts(candidate)}`;
}

function formatVerificationCounts(
  counts: { passed?: number; failed?: number; skipped?: number } | undefined
): string {
  if (!counts) {
    return "?";
  }
  return `${counts.passed ?? 0}p ${counts.failed ?? 0}f ${counts.skipped ?? 0}s`;
}

function formatDiffPair(
  baseline:
    | { filesChanged?: number; insertions?: number; deletions?: number }
    | undefined,
  candidate:
    | { filesChanged?: number; insertions?: number; deletions?: number }
    | undefined
): string {
  return `${formatDiffSignal(baseline)}/${formatDiffSignal(candidate)}`;
}

function formatDiffSignal(
  signal:
    | { filesChanged?: number; insertions?: number; deletions?: number }
    | undefined
): string {
  if (!signal) {
    return "?";
  }
  return `${signal.filesChanged ?? 0} files +${signal.insertions ?? 0}/-${
    signal.deletions ?? 0
  }`;
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

function normalizeInspectorTab(tab: RunInspectorTab): WorkgroupInspectorTab {
  switch (tab) {
    case "summary":
      return "brief";
    case "diff":
    case "handoff":
    case "compare":
      return "artifacts";
    case "tests":
      return "checks";
    case "risk":
      return "risks";
    case "logs":
      return "audit";
    default:
      return tab;
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
