import { useCallback, useEffect, useMemo, useState } from "react";
import { agentHubApi } from "../../lib/agentHubApi";
import { EmptyState } from "../EmptyState";
import type {
  KnowledgeItem,
  KnowledgeItemStatus,
  KnowledgeSourceLink,
  KnowledgeWorkspace as KnowledgeWorkspaceModel,
  ProjectSummary,
  RunInspectorTab
} from "../../lib/types";

type KnowledgeFilter =
  | "all"
  | "decisions"
  | "summaries"
  | "proposed"
  | "approved"
  | "rejected";

interface KnowledgeWorkspaceProps {
  project?: ProjectSummary;
  onOpenThread(threadId: string): void;
  onOpenInspector(runId: string, tab?: RunInspectorTab): void;
}

interface WorkspaceState {
  loading: boolean;
  data?: KnowledgeWorkspaceModel;
  error?: string;
}

export function KnowledgeWorkspace({
  project,
  onOpenThread,
  onOpenInspector
}: KnowledgeWorkspaceProps): JSX.Element {
  const [workspace, setWorkspace] = useState<WorkspaceState>({ loading: false });
  const [activeFilter, setActiveFilter] = useState<KnowledgeFilter>("all");
  const [selectedItemId, setSelectedItemId] = useState<string>("");
  const [actionMessage, setActionMessage] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | undefined>();
  const [isActing, setIsActing] = useState(false);

  const loadWorkspace = useCallback(async (): Promise<void> => {
    if (!project) {
      setWorkspace({ loading: false });
      return;
    }
    setWorkspace({ loading: true });
    setActionError(undefined);
    try {
      const data = await agentHubApi.knowledge.getWorkspace(project.id);
      setWorkspace({ loading: false, data });
      setSelectedItemId((current) =>
        current && data.items.some((item) => item.id === current)
          ? current
          : data.items[0]?.id ?? ""
      );
    } catch (error) {
      setWorkspace({ loading: false, error: errorMessage(error) });
    }
  }, [project]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const items = workspace.data?.items ?? [];
  const filteredItems = useMemo(
    () => filterKnowledgeItems(items, activeFilter),
    [activeFilter, items]
  );
  const selectedItem =
    filteredItems.find((item) => item.id === selectedItemId) ??
    filteredItems[0];

  useEffect(() => {
    if (!selectedItem) {
      setSelectedItemId("");
      return;
    }
    setSelectedItemId((current) =>
      current && filteredItems.some((item) => item.id === current)
        ? current
        : selectedItem.id
    );
  }, [filteredItems, selectedItem]);

  useEffect(() => {
    setActionMessage(undefined);
    setActionError(undefined);
  }, [selectedItem?.id]);

  async function approveSelected(): Promise<void> {
    if (!selectedItem || selectedItem.kind !== "memory") {
      return;
    }
    setIsActing(true);
    setActionError(undefined);
    setActionMessage(undefined);
    try {
      const results = await agentHubApi.memory.approve([selectedItem.id]);
      setActionMessage(results[0]?.message ?? "Memory approved.");
      await loadWorkspace();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setIsActing(false);
    }
  }

  async function rejectSelected(): Promise<void> {
    if (!selectedItem || selectedItem.kind !== "memory") {
      return;
    }
    setIsActing(true);
    setActionError(undefined);
    setActionMessage(undefined);
    try {
      await agentHubApi.memory.ignore([selectedItem.id]);
      setActionMessage("Memory rejected locally.");
      await loadWorkspace();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setIsActing(false);
    }
  }

  if (!project) {
    return (
      <section className="knowledge-empty">
        <EmptyState
          eyebrow="Knowledge / Memory"
          title="Register a project to browse memory"
          body="Knowledge records are scoped to one local project."
          note="Open or register a project from the sidebar to inspect local proposals, summaries, and decisions."
        />
      </section>
    );
  }

  return (
    <section className="knowledge-workspace">
      <div className="knowledge-main">
        <header className="knowledge-header">
          <div>
            <div className="eyebrow">Knowledge / Memory</div>
            <h1>Team Memory Workspace</h1>
            <p>
              {project.name} local proposals, approved memory, thread summaries,
              and decisions.
            </p>
          </div>
          <button className="ghost-button" onClick={() => void loadWorkspace()}>
            Refresh
          </button>
        </header>

        <nav className="knowledge-filters" aria-label="Knowledge filters">
          {filterOptions.map((option) => (
            <button
              key={option.id}
              className={activeFilter === option.id ? "active" : ""}
              onClick={() => setActiveFilter(option.id)}
            >
              {option.label}
            </button>
          ))}
        </nav>

        <div className="knowledge-scroll">
          {workspace.loading ? (
            <div className="knowledge-empty-state">Loading knowledge workspace...</div>
          ) : workspace.error ? (
            <div className="inline-error">{workspace.error}</div>
          ) : workspace.data ? (
            <>
              <KnowledgeMetrics workspace={workspace.data} />
              <div className="knowledge-list">
                {filteredItems.length === 0 ? (
                  <EmptyState
                    eyebrow="Knowledge"
                    title="No records match this filter"
                    body="Clear the filter or run an agent to generate review evidence and memory proposals."
                    actions={[
                      {
                        label: "Show All",
                        onClick: () => setActiveFilter("all"),
                        variant: "primary"
                      }
                    ]}
                  />
                ) : (
                  filteredItems.map((item) => (
                    <button
                      key={item.id}
                      className={`knowledge-item ${
                        item.id === selectedItem?.id ? "active" : ""
                      }`}
                      onClick={() => setSelectedItemId(item.id)}
                    >
                      <span className={`knowledge-avatar ${item.kind}`}>
                        {knowledgeInitial(item)}
                      </span>
                      <span className="knowledge-item-body">
                        <span className="knowledge-item-head">
                          <strong>{item.title}</strong>
                          <span className={`knowledge-tag ${statusTone(item.status)}`}>
                            {statusLabel(item.status)}
                          </span>
                          <span className={`knowledge-tag ${kindTone(item.kind)}`}>
                            {kindLabel(item.kind)}
                          </span>
                          {item.autoApproval ? (
                            <span className="knowledge-tag accent">
                              auto memory
                            </span>
                          ) : null}
                        </span>
                        <span className="knowledge-preview">{item.preview}</span>
                        <span className="knowledge-chips">
                          {item.sourceLinks.slice(0, 3).map((link) => (
                            <span className="timeline-chip neutral" key={link.id}>
                              {link.kind}: {link.label}
                            </span>
                          ))}
                          {item.bounded ? (
                            <span className="timeline-chip warning">bounded</span>
                          ) : null}
                        </span>
                      </span>
                      <span className="knowledge-time">{formatTime(item.updatedAt)}</span>
                    </button>
                  ))
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>

      <aside className="knowledge-detail">
        {selectedItem ? (
          <KnowledgeDetail
            item={selectedItem}
            isActing={isActing}
            actionMessage={actionMessage}
            actionError={actionError}
            onApprove={() => void approveSelected()}
            onReject={() => void rejectSelected()}
            onOpenSource={(link) => {
              if (link.runId) {
                onOpenInspector(link.runId, link.inspectorTab);
              } else if (link.threadId) {
                onOpenThread(link.threadId);
              }
            }}
          />
        ) : (
          <EmptyState
            eyebrow="Knowledge Detail"
            title="No knowledge record selected"
            body="Select a record from the list or clear the active filter."
            actions={[
              {
                label: "Show All",
                onClick: () => setActiveFilter("all"),
                variant: "primary"
              }
            ]}
          />
        )}
      </aside>
    </section>
  );
}

function KnowledgeMetrics({
  workspace
}: {
  workspace: KnowledgeWorkspaceModel;
}): JSX.Element {
  const metrics = workspace.metrics;
  return (
    <div className="knowledge-metrics">
      <Metric label="Total" value={metrics.total} />
      <Metric label="Proposed" value={metrics.proposed} />
      <Metric label="Approved" value={metrics.approved} />
      <Metric label="Rejected" value={metrics.rejected} />
      <Metric label="Summaries" value={metrics.summaries} />
      <Metric label="Decisions" value={metrics.decisions} />
    </div>
  );
}

function KnowledgeDetail({
  item,
  isActing,
  actionMessage,
  actionError,
  onApprove,
  onReject,
  onOpenSource
}: {
  item: KnowledgeItem;
  isActing: boolean;
  actionMessage?: string;
  actionError?: string;
  onApprove(): void;
  onReject(): void;
  onOpenSource(link: KnowledgeSourceLink): void;
}): JSX.Element {
  const canDecide = item.kind === "memory" && item.status === "proposed";
  return (
    <>
      <header className="knowledge-detail-header">
        <div>
          <div className="eyebrow">Memory Governance</div>
          <h2>{item.title}</h2>
          <div className="knowledge-detail-states">
            <span className={`knowledge-tag ${statusTone(item.status)}`}>
              {statusLabel(item.status)}
            </span>
            <span className={`knowledge-tag ${kindTone(item.kind)}`}>
              {kindLabel(item.kind)}
            </span>
            {item.autoApproval ? (
              <span className="knowledge-tag accent">
                {item.autoApproval.policyMode}
              </span>
            ) : null}
          </div>
        </div>
        <div className="knowledge-detail-actions">
          <button
            className="primary"
            disabled={!canDecide || isActing}
            onClick={onApprove}
          >
            Approve
          </button>
          <button disabled={!canDecide || isActing} onClick={onReject}>
            Reject
          </button>
        </div>
      </header>

      <div className="knowledge-detail-scroll">
        {actionMessage ? (
          <div className="system-message accent">{actionMessage}</div>
        ) : null}
        {actionError ? <div className="inline-error">{actionError}</div> : null}

        <section className="knowledge-panel">
          <div className="panel-label">Content</div>
          <p>{item.content}</p>
        </section>

        <section className="knowledge-panel">
          <div className="panel-label">Scope</div>
          <div className="knowledge-source-chips">
            <span className="timeline-chip neutral">project: {item.projectId}</span>
            {item.threadId ? (
              <span className="timeline-chip info">thread: {item.threadId}</span>
            ) : null}
            {item.taskId ? (
              <span className="timeline-chip accent">task: {item.taskId}</span>
            ) : null}
            {item.kind === "thread_summary" ? (
              <span className="timeline-chip info">thread local</span>
            ) : null}
          </div>
        </section>

        {item.autoApproval ? (
          <section className="knowledge-panel">
            <div className="panel-label">Automation</div>
            <div className="knowledge-source-chips">
              <span className="timeline-chip accent">
                {item.autoApproval.policyMode}
              </span>
              {item.autoApproval.riskLevel ? (
                <span className="timeline-chip neutral">
                  risk: {item.autoApproval.riskLevel}
                </span>
              ) : null}
              {item.autoApproval.verificationStatus ? (
                <span className="timeline-chip neutral">
                  checks: {item.autoApproval.verificationStatus}
                </span>
              ) : null}
            </div>
            {item.autoApproval.writebackPath ? (
              <p className="muted-copy">
                Approved memory file: <code>{item.autoApproval.writebackPath}</code>
              </p>
            ) : null}
          </section>
        ) : null}

        <section className="knowledge-panel">
          <div className="panel-label">Source Links</div>
          <div className="knowledge-source-list">
            {item.sourceLinks.length === 0 ? (
              <p className="muted-copy">No source links were recorded.</p>
            ) : (
              item.sourceLinks.map((link) => (
                <button
                  key={`${link.kind}:${link.id}`}
                  className="knowledge-source-row"
                  disabled={!link.runId && !link.threadId}
                  onClick={() => onOpenSource(link)}
                >
                  <span className={`knowledge-tag ${sourceTone(link.kind)}`}>
                    {link.kind}
                  </span>
                  <strong>{link.label}</strong>
                  <span>Open</span>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="knowledge-panel">
          <div className="panel-label">Audit</div>
          <div className="knowledge-audit-list">
            {item.audit.map((entry) => (
              <div className="knowledge-audit-row" key={`${entry.at}:${entry.label}`}>
                <strong>{formatTime(entry.at)}</strong>
                <span>
                  {entry.label}
                  {entry.detail ? <em>{entry.detail}</em> : null}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function Metric({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

const filterOptions: Array<{ id: KnowledgeFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "decisions", label: "Decisions" },
  { id: "summaries", label: "Summaries" },
  { id: "proposed", label: "Proposed" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" }
];

function filterKnowledgeItems(
  items: KnowledgeItem[],
  filter: KnowledgeFilter
): KnowledgeItem[] {
  if (filter === "all") {
    return items;
  }
  if (filter === "decisions") {
    return items.filter(
      (item) => item.kind === "thread_decision" || item.kind === "review_decision"
    );
  }
  if (filter === "summaries") {
    return items.filter((item) => item.kind === "thread_summary");
  }
  return items.filter((item) => item.status === filter);
}

function knowledgeInitial(item: KnowledgeItem): string {
  switch (item.kind) {
    case "memory":
      return item.status === "approved" ? "A" : item.status === "rejected" ? "R" : "P";
    case "thread_summary":
      return "S";
    case "thread_decision":
      return "D";
    case "review_decision":
      return "V";
  }
}

function kindLabel(kind: KnowledgeItem["kind"]): string {
  return kind.replace(/_/g, " ");
}

function statusLabel(status: KnowledgeItemStatus): string {
  return status;
}

function kindTone(kind: KnowledgeItem["kind"]): string {
  if (kind === "thread_summary") {
    return "info";
  }
  if (kind === "review_decision" || kind === "thread_decision") {
    return "warning";
  }
  return "accent";
}

function statusTone(status: KnowledgeItemStatus): string {
  if (status === "approved" || status === "accepted") {
    return "success";
  }
  if (status === "rejected") {
    return "danger";
  }
  if (status === "summary") {
    return "info";
  }
  if (status === "decision") {
    return "warning";
  }
  return "accent";
}

function sourceTone(kind: KnowledgeSourceLink["kind"]): string {
  if (kind === "thread" || kind === "message") {
    return "info";
  }
  if (kind === "run" || kind === "artifact") {
    return "accent";
  }
  return "warning";
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
