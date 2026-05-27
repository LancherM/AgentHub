import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  WorkgroupAgentAdapterKind,
  WorkgroupExecutor,
  WorkgroupExecutorKind,
  WorkgroupRole
} from "@agent-hub/shared";
import { agentHubApi } from "../../lib/agentHubApi";
import { EmptyState } from "../EmptyState";
import type {
  DesktopAgentConfig,
  ProjectSummary,
  TeamRoleSource,
  TeamRoleSummary,
  TeamWorkspace as TeamWorkspaceModel
} from "../../lib/types";

type TeamFilter = "all" | "enabled" | "custom" | "reserved";

interface TeamWorkspaceProps {
  project?: ProjectSummary;
  agentConfig: DesktopAgentConfig;
}

interface TeamWorkspaceState {
  loading: boolean;
  data?: TeamWorkspaceModel;
  error?: string;
}

export function TeamWorkspace({ project, agentConfig }: TeamWorkspaceProps): JSX.Element {
  const [workspace, setWorkspace] = useState<TeamWorkspaceState>({
    loading: false
  });
  const [activeFilter, setActiveFilter] = useState<TeamFilter>("all");
  const [selectedRoleId, setSelectedRoleId] = useState<string>("");
  const [draftRole, setDraftRole] = useState<WorkgroupRole | undefined>();
  const [actionMessage, setActionMessage] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | undefined>();
  const [isSaving, setIsSaving] = useState(false);

  const loadWorkspace = useCallback(
    async (preferredRoleId?: string): Promise<void> => {
      if (!project) {
        setWorkspace({ loading: false });
        setSelectedRoleId("");
        setDraftRole(undefined);
        return;
      }
      setWorkspace((current) => ({
        ...current,
        loading: true,
        error: undefined
      }));
      setActionError(undefined);
      try {
        const data = await agentHubApi.team.getWorkspace(project.id);
        setWorkspace({ loading: false, data });
        const nextRole =
          data.roles.find((entry) => entry.role.id === preferredRoleId) ??
          data.roles[0];
        setSelectedRoleId(nextRole?.role.id ?? "");
        setDraftRole(nextRole ? cloneRole(nextRole.role) : undefined);
      } catch (error) {
        setWorkspace({ loading: false, error: errorMessage(error) });
      }
    },
    [project]
  );

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const roles = workspace.data?.roles ?? [];
  const filteredRoles = useMemo(
    () => filterRoles(roles, activeFilter),
    [activeFilter, roles]
  );
  const storedSelectedSummary = roles.find(
    (entry) => entry.role.id === selectedRoleId
  );
  const selectedSummary =
    storedSelectedSummary ??
    (draftRole?.id === selectedRoleId ? undefined : roles[0]);
  const hasUnsavedChanges = Boolean(
    draftRole &&
      serializeRole(draftRole) !==
        (storedSelectedSummary ? serializeRole(storedSelectedSummary.role) : "")
  );

  useEffect(() => {
    if (
      (draftRole?.id === selectedRoleId || selectedRoleId.startsWith("custom:")) &&
      !storedSelectedSummary
    ) {
      return;
    }
    if (!selectedSummary) {
      if (!workspace.loading) {
        setSelectedRoleId("");
        setDraftRole(undefined);
      }
      return;
    }
    if (!roles.some((entry) => entry.role.id === selectedRoleId)) {
      setSelectedRoleId(selectedSummary.role.id);
      setDraftRole(cloneRole(selectedSummary.role));
    }
  }, [
    draftRole?.id,
    roles,
    selectedRoleId,
    selectedSummary,
    storedSelectedSummary,
    workspace.loading
  ]);

  useEffect(() => {
    setActionMessage(undefined);
    setActionError(undefined);
  }, [selectedRoleId]);

  function selectRole(summary: TeamRoleSummary): void {
    setSelectedRoleId(summary.role.id);
    setDraftRole(normalizeDraftRoleForAgents(summary.role, agentConfig));
  }

  function newRole(): void {
    const role = newCustomRole();
    setDraftRole(role);
    setSelectedRoleId(role.id);
    setActionMessage(undefined);
    setActionError(undefined);
  }

  async function saveRole(): Promise<void> {
    if (!project || !draftRole) {
      return;
    }
    setIsSaving(true);
    setActionMessage(undefined);
    setActionError(undefined);
    try {
      const saved = await agentHubApi.team.saveRole({
        projectId: project.id,
        role: draftRole
      });
      setActionMessage(`Saved @${saved.role.handle}.`);
      await loadWorkspace(saved.role.id);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  if (!project) {
    return (
      <section className="knowledge-empty">
        <EmptyState
          eyebrow="Team / Roles"
          title="Register a project to configure roles"
          body="Team roles are scoped to one local project."
          note="Project selection stays local and does not write role files into the repository."
        />
      </section>
    );
  }

  return (
    <section className="team-workspace">
      <div className="team-main">
        <header className="team-header">
          <div>
            <div className="eyebrow">Team / Role Configuration</div>
            <h1>{project.name} Workgroup Team</h1>
            <p>
              Configure local preset overrides and custom roles without writing
              to the target repository.
            </p>
          </div>
          <div className="team-header-actions">
            <button className="ghost-button" onClick={() => void loadWorkspace(selectedRoleId)}>
              Refresh
            </button>
            <button className="primary-button compact" onClick={newRole}>
              New Role
            </button>
          </div>
        </header>

        <nav className="knowledge-filters" aria-label="Team role filters">
          {teamFilterOptions.map((option) => (
            <button
              key={option.id}
              className={activeFilter === option.id ? "active" : ""}
              onClick={() => setActiveFilter(option.id)}
            >
              {option.label}
            </button>
          ))}
        </nav>

        <div className="team-scroll">
          {workspace.loading ? (
            <div className="knowledge-empty-state">Loading team roles...</div>
          ) : workspace.error ? (
            <div className="inline-error">{workspace.error}</div>
          ) : workspace.data ? (
            <>
              <TeamMetrics workspace={workspace.data} />
              <div className="team-table" role="table" aria-label="Team roles">
                <div className="team-table-head" role="row">
                  <span>Role</span>
                  <span>Purpose</span>
                  <span>Executor</span>
                  <span>Status</span>
                </div>
                {filteredRoles.length === 0 ? (
                  <EmptyState
                    eyebrow="Team Roles"
                    title="No roles match this filter"
                    body="Clear the filter or create a custom role for this project."
                    actions={[
                      {
                        label: "Show All",
                        onClick: () => setActiveFilter("all"),
                        variant: "primary"
                      },
                      {
                        label: "New Role",
                        onClick: newRole
                      }
                    ]}
                  />
                ) : (
                  filteredRoles.map((summary) => (
                    <button
                      key={summary.role.id}
                      className={`team-table-row ${
                        summary.role.id === selectedSummary?.role.id ? "active" : ""
                      }`}
                      onClick={() => selectRole(summary)}
                    >
                      <span className="team-role-cell">
                        <span className={`team-avatar ${avatarTone(summary)}`}>
                          {roleInitial(summary.role)}
                        </span>
                        <span>
                          <strong>@{summary.role.handle}</strong>
                          <small>{sourceLabel(summary.source)}</small>
                        </span>
                      </span>
                      <span>{summary.role.purpose || summary.role.capabilitySummary}</span>
                      <span>
                        <span
                          className={`knowledge-tag ${
                            summary.executorRunnable ? "success" : "warning"
                          }`}
                        >
                          {summary.executorLabel}
                        </span>
                      </span>
                      <span>
                        <span className={`knowledge-tag ${summary.role.enabled ? "success" : "neutral"}`}>
                          {summary.role.enabled ? "enabled" : "disabled"}
                        </span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>

      <aside className="team-detail">
        {draftRole ? (
          <TeamRoleEditor
            role={draftRole}
            summary={selectedSummary}
            actionMessage={actionMessage}
            actionError={actionError}
            isSaving={isSaving}
            hasUnsavedChanges={hasUnsavedChanges}
            agentConfig={agentConfig}
            onChange={setDraftRole}
            onSave={() => void saveRole()}
          />
        ) : (
          <EmptyState
            eyebrow="Role Profile"
            title="No role selected"
            body="Select a role from the table or create a custom local role."
            actions={[
              {
                label: "New Role",
                onClick: newRole,
                variant: "primary"
              }
            ]}
          />
        )}
      </aside>
    </section>
  );
}

function TeamMetrics({ workspace }: { workspace: TeamWorkspaceModel }): JSX.Element {
  const metrics = workspace.metrics;
  return (
    <div className="team-metrics">
      <Metric label="Total" value={metrics.total} />
      <Metric label="Enabled" value={metrics.enabled} />
      <Metric label="Custom" value={metrics.custom} />
      <Metric label="Overrides" value={metrics.presetOverrides} />
      <Metric label="Reserved" value={metrics.reservedExecutors} />
    </div>
  );
}

function TeamRoleEditor({
  role,
  summary,
  actionMessage,
  actionError,
  isSaving,
  hasUnsavedChanges,
  agentConfig,
  onChange,
  onSave
}: {
  role: WorkgroupRole;
  summary?: TeamRoleSummary;
  actionMessage?: string;
  actionError?: string;
  isSaving: boolean;
  hasUnsavedChanges: boolean;
  agentConfig: DesktopAgentConfig;
  onChange(role: WorkgroupRole): void;
  onSave(): void;
}): JSX.Element {
  const adapterOptions = availableAdapterOptions(agentConfig);
  return (
    <>
      <header className="team-detail-header">
        <div className={`team-avatar large ${summary ? avatarTone(summary) : "cyan"}`}>
          {roleInitial(role)}
        </div>
        <div>
          <div className="eyebrow">Role Profile</div>
          <h2>@{role.handle || "new-role"}</h2>
          <div className="knowledge-detail-states">
            <span className={`knowledge-tag ${role.enabled ? "success" : "neutral"}`}>
              {role.enabled ? "enabled" : "disabled"}
            </span>
            <span className={`knowledge-tag ${summary?.executorRunnable ? "success" : "warning"}`}>
              {executorLabel(role.executor)}
            </span>
          </div>
        </div>
      </header>

      <div className="team-detail-scroll">
        {actionMessage ? <div className="system-message accent">{actionMessage}</div> : null}
        {actionError ? <div className="inline-error">{actionError}</div> : null}

        <details className="team-editor-panel" open>
          <summary>Basic</summary>
          <div className="team-form-grid">
            <TextField
              label="Handle"
              value={`@${role.handle}`}
              onChange={(value) => {
                const handle = handleText(value);
                onChange({
                  ...role,
                  id:
                    role.id.startsWith("preset:") && role.id === `preset:${handle}`
                      ? role.id
                      : `custom:${handle}`,
                  handle
                });
              }}
            />
            <TextField
              label="Display name"
              value={role.displayName}
              onChange={(value) => onChange({ ...role, displayName: value })}
            />
            <TextField
              label="Purpose"
              value={role.purpose}
              wide
              onChange={(value) => onChange({ ...role, purpose: value })}
            />
            <TextArea
              label="Capability summary"
              value={role.capabilitySummary}
              onChange={(value) => onChange({ ...role, capabilitySummary: value })}
            />
            <TextArea
              label="Persona"
              value={role.persona}
              onChange={(value) => onChange({ ...role, persona: value })}
            />
            <TextArea
              label="Default instructions"
              value={role.defaultInstructions}
              wide
              onChange={(value) => onChange({ ...role, defaultInstructions: value })}
            />
          </div>
          <div className="team-toggle-grid">
            <label>
              <input
                type="checkbox"
                checked={role.enabled}
                onChange={(event) =>
                  onChange({
                    ...role,
                    enabled: event.target.checked
                  })
                }
              />
              Enabled for mentions
            </label>
          </div>
        </details>

        <details className="team-editor-panel" open>
          <summary>Executor</summary>
          <div className="team-form-grid">
            <SelectField
                label="Executor kind"
                value={role.executor.kind}
                options={["agent_adapter", "llm_api", "workflow", "human"]}
                onChange={(kind) =>
                  onChange({
                    ...role,
                    executor: executorForKind(kind, agentConfig)
                  })
                }
              />
            {role.executor.kind === "agent_adapter" ? (
              <SelectField
                label="Adapter"
                value={adapterOptions.includes(role.executor.adapterKind)
                  ? role.executor.adapterKind
                  : adapterOptions[0]}
                options={adapterOptions}
                onChange={(adapterKind) =>
                  onChange({
                    ...role,
                    executor: {
                      kind: "agent_adapter",
                      adapterKind: adapterKind as WorkgroupAgentAdapterKind,
                      configRef: role.executor.configRef
                    }
                  })
                }
              />
            ) : (
              <TextField
                label="Unavailable reason"
                value={role.executor.unavailableReason ?? ""}
                onChange={(value) =>
                  onChange({
                    ...role,
                    executor: {
                      kind: role.executor.kind as "llm_api" | "workflow" | "human",
                      configRef: role.executor.configRef,
                      unavailableReason: value
                    }
                  })
                }
              />
            )}
            <TextField
              label="Config reference"
              value={role.executor.configRef ?? ""}
              wide
              onChange={(value) =>
                onChange({
                  ...role,
                  executor: {
                    ...role.executor,
                    configRef: value
                  } as WorkgroupExecutor
                })
              }
            />
          </div>
        </details>

        <details className="team-editor-panel">
          <summary>Permissions</summary>
          <div className="team-form-grid">
            <TextArea
              label="Permissions"
              value={role.permissions.join(", ")}
              onChange={(value) =>
                onChange({ ...role, permissions: parseCommaList(value) })
              }
            />
            <TextField
              label="Context scope"
              value={role.contextPolicy.scope}
              onChange={(value) =>
                onChange({
                  ...role,
                  contextPolicy: { ...role.contextPolicy, scope: value }
                })
              }
            />
          </div>
          <div className="team-toggle-grid">
            <label>
              <input
                type="checkbox"
                checked={role.contextPolicy.includeApprovedMemory}
                onChange={(event) =>
                  onChange({
                    ...role,
                    contextPolicy: {
                      ...role.contextPolicy,
                      includeApprovedMemory: event.target.checked
                    }
                  })
                }
              />
              Include approved memory
            </label>
            <label>
              <input
                type="checkbox"
                checked={role.contextPolicy.includeThreadSummary}
                onChange={(event) =>
                  onChange({
                    ...role,
                    contextPolicy: {
                      ...role.contextPolicy,
                      includeThreadSummary: event.target.checked
                    }
                  })
                }
              />
              Include thread summary
            </label>
          </div>
        </details>

        <details className="team-editor-panel">
          <summary>Policies</summary>
          <div className="team-form-grid">
            <TextArea
              label="Approval required for"
              value={role.approvalPolicy.requiredFor.join(", ")}
              onChange={(value) =>
                onChange({
                  ...role,
                  approvalPolicy: {
                    ...role.approvalPolicy,
                    requiredFor: parseCommaList(value)
                  }
                })
              }
            />
            <TextArea
              label="Approval summary"
              value={role.approvalPolicy.summary}
              wide
              onChange={(value) =>
                onChange({
                  ...role,
                  approvalPolicy: { ...role.approvalPolicy, summary: value }
                })
              }
            />
            <TextField
              label="Default room"
              value={role.defaultRoom ?? ""}
              onChange={(value) =>
                onChange({
                  ...role,
                  defaultRoom: value
                })
              }
            />
            <TextArea
              label="Context instructions"
              value={role.contextPolicy.instructions.join("\n")}
              wide
              onChange={(value) =>
                onChange({
                  ...role,
                  contextPolicy: {
                    ...role.contextPolicy,
                    instructions: parseLineList(value)
                  }
                })
              }
            />
          </div>
        </details>

        <details className="team-editor-panel">
          <summary>Advanced</summary>
          <div className="team-form-grid">
            <TextField
              label="Tags"
              value={(role.tags ?? []).join(", ")}
              wide
              onChange={(value) => onChange({ ...role, tags: parseCommaList(value) })}
            />
          </div>
          <div className="panel-label">Recent Tasks</div>
          <div className="team-activity-list">
            {summary?.recentActivity.length ? (
              summary.recentActivity.map((activity) => (
                <div className="team-activity-row" key={`${activity.taskId}:${activity.runId ?? ""}`}>
                  <strong>{activity.title}</strong>
                  <span>{activity.status}</span>
                </div>
              ))
            ) : (
              <p className="muted-copy">No recent role assignments were recorded.</p>
            )}
          </div>

          <div className="panel-label">Linked Memory</div>
          <div className="knowledge-source-chips">
            {summary?.linkedMemory.length ? (
              summary.linkedMemory.map((memory) => (
                <span className="timeline-chip neutral" key={memory.id}>
                  {memory.status}: {memory.content.slice(0, 64)}
                </span>
              ))
            ) : (
              <p className="muted-copy">No linked memory references were found.</p>
            )}
          </div>
        </details>
      </div>

      <div className="team-save-bar">
        <span className="muted-copy">
          Reserved executor kinds are stored only as non-runnable metadata.
        </span>
        <button
          className="primary-button compact"
          disabled={isSaving || !hasUnsavedChanges}
          onClick={onSave}
        >
          {isSaving ? "Saving..." : "Save Role"}
        </button>
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

function TextField({
  label,
  value,
  wide,
  onChange
}: {
  label: string;
  value: string;
  wide?: boolean;
  onChange(value: string): void;
}): JSX.Element {
  return (
    <label className={wide ? "team-field wide" : "team-field"}>
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function TextArea({
  label,
  value,
  wide,
  onChange
}: {
  label: string;
  value: string;
  wide?: boolean;
  onChange(value: string): void;
}): JSX.Element {
  return (
    <label className={wide ? "team-field wide" : "team-field"}>
      <span>{label}</span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange(value: T): void;
}): JSX.Element {
  return (
    <label className="team-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

const teamFilterOptions: Array<{ id: TeamFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "enabled", label: "Enabled" },
  { id: "custom", label: "Custom" },
  { id: "reserved", label: "Reserved" }
];

function filterRoles(
  roles: TeamRoleSummary[],
  filter: TeamFilter
): TeamRoleSummary[] {
  if (filter === "enabled") {
    return roles.filter((summary) => summary.role.enabled);
  }
  if (filter === "custom") {
    return roles.filter((summary) => summary.source === "custom");
  }
  if (filter === "reserved") {
    return roles.filter((summary) => !summary.executorRunnable);
  }
  return roles;
}

function sourceLabel(source: TeamRoleSource): string {
  if (source === "preset_override") {
    return "Preset override";
  }
  return source === "preset" ? "Preset" : "Custom";
}

function roleInitial(role: WorkgroupRole): string {
  return (role.displayName || role.handle || "?").slice(0, 1).toUpperCase();
}

function avatarTone(summary: TeamRoleSummary): string {
  if (!summary.role.enabled) {
    return "muted";
  }
  if (!summary.executorRunnable) {
    return "amber";
  }
  if (summary.source === "custom") {
    return "cyan";
  }
  if (summary.source === "preset_override") {
    return "plum";
  }
  return "blue";
}

function executorForKind(
  kind: WorkgroupExecutorKind,
  agentConfig: DesktopAgentConfig
): WorkgroupExecutor {
  if (kind === "agent_adapter") {
    return { kind, adapterKind: toAdapterKind(agentConfig.defaultAgent) };
  }
  return {
    kind,
    unavailableReason: "Reserved executor is not runnable in this phase."
  };
}

function normalizeDraftRoleForAgents(
  role: WorkgroupRole,
  agentConfig: DesktopAgentConfig
): WorkgroupRole {
  const draft = cloneRole(role);
  if (
    draft.executor.kind === "agent_adapter" &&
    !availableAdapterOptions(agentConfig).includes(draft.executor.adapterKind)
  ) {
    draft.executor = {
      kind: "agent_adapter",
      adapterKind: toAdapterKind(agentConfig.defaultAgent),
      configRef: draft.executor.configRef
    };
  }
  return draft;
}

function availableAdapterOptions(
  agentConfig: DesktopAgentConfig
): WorkgroupAgentAdapterKind[] {
  return agentConfig.availableAgents.map(toAdapterKind);
}

function toAdapterKind(agentId: DesktopAgentConfig["defaultAgent"]): WorkgroupAgentAdapterKind {
  return agentId === "claude" ? "claude-code" : agentId;
}

function executorLabel(executor: WorkgroupExecutor): string {
  if (executor.kind === "agent_adapter") {
    return `agent_adapter / ${executor.adapterKind}`;
  }
  return `${executor.kind} reserved`;
}

function newCustomRole(): WorkgroupRole {
  const handle = `qa-${Date.now().toString(36).slice(-4)}`;
  return {
    id: `custom:${handle}`,
    handle,
    displayName: "QA Reviewer",
    purpose: "Review acceptance checks and release risks.",
    capabilitySummary: "Acceptance checks, regression review, release risk notes.",
    persona: "Careful QA reviewer focused on evidence-backed release readiness.",
    defaultInstructions:
      "Review run evidence, highlight missing acceptance checks, and do not apply changes.",
    permissions: ["read_thread_context", "read_run_evidence"],
    contextPolicy: {
      scope: "current_thread_and_project_context",
      includeApprovedMemory: true,
      includeThreadSummary: true,
      instructions: [
        "Use Agent Hub runtime-injected context only.",
        "Treat policy fields as local review metadata."
      ]
    },
    approvalPolicy: {
      requiredFor: ["external_side_effects", "memory_approval"],
      summary: "User approval is required before external effects or memory approval."
    },
    executor: {
      kind: "human",
      unavailableReason: "Human role execution is reserved in this phase."
    },
    enabled: true,
    defaultRoom: "review",
    tags: ["qa", "review"]
  };
}

function handleText(value: string): string {
  return value
    .replace(/^@/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 63);
}

function parseCommaList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseLineList(value: string): string[] {
  return value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function cloneRole(role: WorkgroupRole): WorkgroupRole {
  return JSON.parse(JSON.stringify(role)) as WorkgroupRole;
}

function serializeRole(role: WorkgroupRole): string {
  return JSON.stringify(role);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
