import { useEffect, useMemo, useState } from "react";
import { agentHubApi } from "../../lib/agentHubApi";
import type {
  MemoryAutomationPolicySettings,
  ProjectSummary,
  VerificationCommandConfig
} from "../../lib/types";
import {
  cleanSettingsError,
  validateDraftMemoryAutomationPolicy,
  validateDraftVerificationCommands,
  type DraftMemoryAutomationPolicy,
  type DraftVerificationCommand
} from "./verification-settings-validation";

interface VerificationSettingsPanelProps {
  project?: ProjectSummary;
  onClose(): void;
}

type DraftCommand = DraftVerificationCommand;

export function VerificationSettingsPanel({
  project,
  onClose
}: VerificationSettingsPanelProps): JSX.Element {
  const [commands, setCommands] = useState<DraftCommand[]>([]);
  const [savedCommands, setSavedCommands] = useState<DraftCommand[]>([]);
  const [memoryPolicy, setMemoryPolicy] =
    useState<DraftMemoryAutomationPolicy>(defaultDraftMemoryPolicy());
  const [savedMemoryPolicy, setSavedMemoryPolicy] =
    useState<DraftMemoryAutomationPolicy>(defaultDraftMemoryPolicy());
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingMemory, setIsSavingMemory] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    setMessage(undefined);
    setError(undefined);
    if (!project) {
      setCommands([]);
      setSavedCommands([]);
      setMemoryPolicy(defaultDraftMemoryPolicy());
      setSavedMemoryPolicy(defaultDraftMemoryPolicy());
      return;
    }
    setIsLoading(true);
    Promise.all([
      agentHubApi.settings.getVerification(project.id),
      agentHubApi.settings.getMemoryPolicy(project.id)
    ])
      .then(([settings, policy]) => {
        const drafts = settings.commands.map(toDraftCommand);
        const policyDraft = toDraftMemoryPolicy(policy);
        setCommands(drafts);
        setSavedCommands(drafts);
        setMemoryPolicy(policyDraft);
        setSavedMemoryPolicy(policyDraft);
      })
      .catch((err: unknown) => {
        setError(errorMessage(err));
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [project?.id]);

  function addCommand(): void {
    const id = nextCommandId(commands);
    clearFeedback();
    setCommands((current) => [
      ...current,
      {
        id,
        label: "",
        executable: "",
        argsText: "",
        timeoutMs: "",
        continueOnFailure: false
      }
    ]);
  }

  function updateCommand(
    index: number,
    patch: Partial<DraftCommand>
  ): void {
    clearFeedback();
    setCommands((current) =>
      current.map((command, commandIndex) =>
        commandIndex === index ? { ...command, ...patch } : command
      )
    );
  }

  function removeCommand(index: number): void {
    clearFeedback();
    setCommands((current) =>
      current.filter((_command, commandIndex) => commandIndex !== index)
    );
  }

  function updateMemoryPolicy(patch: Partial<DraftMemoryAutomationPolicy>): void {
    clearFeedback();
    setMemoryPolicy((current) => ({ ...current, ...patch }));
  }

  function toggleMemoryCategory(category: string): void {
    clearFeedback();
    setMemoryPolicy((current) => {
      const selected = new Set(current.allowedCategories);
      if (selected.has(category)) {
        selected.delete(category);
      } else {
        selected.add(category);
      }
      return {
        ...current,
        allowedCategories: [...selected]
      };
    });
  }

  function clearFeedback(): void {
    setMessage(undefined);
    setError(undefined);
  }

  async function save(): Promise<void> {
    if (!project) {
      return;
    }
    setMessage(undefined);
    setError(undefined);
    if (validation.message) {
      setError(validation.message);
      return;
    }
    setIsSaving(true);
    try {
      const saved = await agentHubApi.settings.saveVerification({
        projectId: project.id,
        commands: commands.map(fromDraftCommand)
      });
      const drafts = saved.commands.map(toDraftCommand);
      setCommands(drafts);
      setSavedCommands(drafts);
      setMessage(
        saved.commands.length === 0
          ? "Verification will be skipped for this project."
          : "Verification commands saved."
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsSaving(false);
    }
  }

  async function saveMemoryPolicy(): Promise<void> {
    if (!project) {
      return;
    }
    setMessage(undefined);
    setError(undefined);
    if (policyValidation.message) {
      setError(policyValidation.message);
      return;
    }
    setIsSavingMemory(true);
    try {
      const saved = await agentHubApi.settings.saveMemoryPolicy(
        fromDraftMemoryPolicy(project.id, memoryPolicy)
      );
      const draft = toDraftMemoryPolicy(saved);
      setMemoryPolicy(draft);
      setSavedMemoryPolicy(draft);
      setMessage("Memory automation policy saved.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsSavingMemory(false);
    }
  }

  const hasChanges = useMemo(
    () => serializeCommands(commands) !== serializeCommands(savedCommands),
    [commands, savedCommands]
  );
  const validation = useMemo(
    () => validateDraftVerificationCommands(commands),
    [commands]
  );
  const hasMemoryPolicyChanges = useMemo(
    () => serializeMemoryPolicy(memoryPolicy) !== serializeMemoryPolicy(savedMemoryPolicy),
    [memoryPolicy, savedMemoryPolicy]
  );
  const policyValidation = useMemo(
    () => validateDraftMemoryAutomationPolicy(memoryPolicy),
    [memoryPolicy]
  );
  const activeError = error ??
    (hasChanges ? validation.message : undefined) ??
    (hasMemoryPolicyChanges ? policyValidation.message : undefined);

  return (
    <div className="inspector-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Project settings"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <div>
            <div className="eyebrow">Settings</div>
            <h2>Project Settings</h2>
            <p>{project ? project.name : "No project selected"}</p>
          </div>
          <div className="inspector-actions">
            <button className="ghost-button utility-action" onClick={onClose}>
              Close
            </button>
          </div>
        </header>

        <div className="settings-body">
          {message ? <div className="decision-strip">{message}</div> : null}
          {activeError ? (
            <div className="inline-error settings-error">
              <strong>Check command settings</strong>
              <span>{activeError}</span>
              <em>
                Each command needs a unique ID and an executable. Put one
                argument per line.
              </em>
            </div>
          ) : null}

          {!project ? (
            <p className="muted-copy">
              Select a registered project before editing verification.
            </p>
          ) : (
            <>
              <section className="settings-section memory-policy-section">
                <div className="settings-toolbar">
                  <div>
                    <div className="panel-label">Memory Automation</div>
                    <p className="muted-copy">
                      {memoryPolicy.mode === "suggest_only"
                        ? "Proposals stay queued for manual approval."
                        : "Accepted reviews can approve eligible memory."}
                    </p>
                  </div>
                  <button
                    className="primary-button compact"
                    onClick={() => void saveMemoryPolicy()}
                    disabled={
                      !hasMemoryPolicyChanges ||
                      Boolean(policyValidation.message) ||
                      isLoading ||
                      isSavingMemory
                    }
                  >
                    {isSavingMemory ? "Saving..." : "Save Policy"}
                  </button>
                </div>

                <div className="settings-segmented" role="group" aria-label="Memory policy mode">
                  {memoryModeOptions.map((option) => (
                    <button
                      key={option.id}
                      className={memoryPolicy.mode === option.id ? "active" : ""}
                      onClick={() => updateMemoryPolicy({ mode: option.id })}
                    >
                      <strong>{option.label}</strong>
                      <span>{option.detail}</span>
                    </button>
                  ))}
                </div>

                <div className="settings-grid memory-policy-grid">
                  <label>
                    <span>Risk threshold</span>
                    <select
                      value={memoryPolicy.maxRiskLevel}
                      onChange={(event) =>
                        updateMemoryPolicy({ maxRiskLevel: event.target.value })
                      }
                    >
                      {riskOptions.map((risk) => (
                        <option key={risk} value={risk}>
                          {risk}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Per-run limit</span>
                    <input
                      inputMode="numeric"
                      value={memoryPolicy.maxAutoApprovalsPerRun}
                      onChange={(event) =>
                        updateMemoryPolicy({
                          maxAutoApprovalsPerRun: event.target.value
                        })
                      }
                    />
                  </label>
                </div>

                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={memoryPolicy.allowSkippedVerification}
                    onChange={(event) =>
                      updateMemoryPolicy({
                        allowSkippedVerification: event.target.checked
                      })
                    }
                  />
                  <span>Allow skipped verification for eligible memory</span>
                </label>

                <div className="settings-category-grid">
                  {memoryCategoryOptions.map((category) => (
                    <label key={category.id} className="settings-check">
                      <input
                        type="checkbox"
                        checked={memoryPolicy.allowedCategories.includes(category.id)}
                        onChange={() => toggleMemoryCategory(category.id)}
                      />
                      <span>{category.label}</span>
                    </label>
                  ))}
                </div>
              </section>

              <div className="settings-toolbar">
                <div>
                  <div className="panel-label">Project Commands</div>
                  <p className="muted-copy">
                    {commands.length === 0
                      ? "No commands configured."
                      : `${commands.length} command${commands.length === 1 ? "" : "s"} configured.`}
                  </p>
                </div>
                <button
                  className="primary-button compact"
                  onClick={addCommand}
                  disabled={isLoading || isSaving}
                >
                  Add Command
                </button>
              </div>

              <div className="verification-settings-list">
                {commands.length === 0 ? (
                  <div className="settings-empty">
                    <strong>No verification commands configured</strong>
                    <span>
                      Runs will mark checks as skipped until you add a command.
                    </span>
                    <div className="settings-examples">
                      <code>pnpm test</code>
                      <code>npm run lint</code>
                      <code>npm run typecheck</code>
                    </div>
                  </div>
                ) : (
                  commands.map((command, index) => (
                    <article
                      className={`verification-command-editor ${
                        validation.commandIssues[index] ? "has-error" : ""
                      }`}
                      key={index}
                    >
                      <div className="settings-row-head">
                        <strong>{command.label || command.id || "Command"}</strong>
                        <button
                          className="ghost-button danger"
                          onClick={() => removeCommand(index)}
                        >
                          Remove
                        </button>
                      </div>
                      <div className="settings-grid">
                        <label>
                          <span>ID</span>
                          <input
                            value={command.id}
                            onChange={(event) =>
                              updateCommand(index, { id: event.target.value })
                            }
                          />
                        </label>
                        <label>
                          <span>Label</span>
                          <input
                            value={command.label}
                            onChange={(event) =>
                              updateCommand(index, { label: event.target.value })
                            }
                          />
                        </label>
                        <label>
                          <span>Executable</span>
                          <input
                            value={command.executable}
                            onChange={(event) =>
                              updateCommand(index, { executable: event.target.value })
                            }
                          />
                        </label>
                        <label>
                          <span>Timeout ms</span>
                          <input
                            inputMode="numeric"
                            value={command.timeoutMs}
                            onChange={(event) =>
                              updateCommand(index, { timeoutMs: event.target.value })
                            }
                          />
                        </label>
                      </div>
                      <label className="settings-args-field">
                        <span>Args</span>
                        <textarea
                          rows={3}
                          value={command.argsText}
                          onChange={(event) =>
                            updateCommand(index, { argsText: event.target.value })
                          }
                        />
                      </label>
                      <label className="settings-check">
                        <input
                          type="checkbox"
                          checked={command.continueOnFailure}
                          onChange={(event) =>
                            updateCommand(index, {
                              continueOnFailure: event.target.checked
                            })
                          }
                        />
                        <span>Continue after failure</span>
                      </label>
                      {validation.commandIssues[index] ? (
                        <p className="settings-field-error">
                          {validation.commandIssues[index]}
                        </p>
                      ) : null}
                    </article>
                  ))
                )}
              </div>
            </>
          )}
        </div>
        <footer className="settings-footer">
          <button className="ghost-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button compact"
            onClick={() => void save()}
            disabled={!project || isLoading || isSaving || !hasChanges || Boolean(validation.message)}
          >
            {isSaving ? "Saving..." : "Save changes"}
          </button>
        </footer>
      </aside>
    </div>
  );
}

function toDraftCommand(command: VerificationCommandConfig): DraftCommand {
  return {
    id: command.id,
    label: command.label ?? "",
    executable: command.executable,
    argsText: command.args.join("\n"),
    timeoutMs: command.timeoutMs === undefined ? "" : String(command.timeoutMs),
    continueOnFailure: command.continueOnFailure ?? false
  };
}

function fromDraftCommand(command: DraftCommand): VerificationCommandConfig {
  const timeoutMs = command.timeoutMs.trim()
    ? Number(command.timeoutMs.trim())
    : undefined;
  return {
    id: command.id.trim(),
    label: command.label.trim() || undefined,
    executable: command.executable.trim(),
    args: command.argsText
      .split(/\r?\n/)
      .map((arg) => arg.trim())
      .filter((arg) => arg.length > 0),
    timeoutMs,
    continueOnFailure: command.continueOnFailure || undefined
  };
}

function nextCommandId(commands: DraftCommand[]): string {
  let index = commands.length + 1;
  let id = `verify-${index}`;
  const used = new Set(commands.map((command) => command.id));
  while (used.has(id)) {
    index += 1;
    id = `verify-${index}`;
  }
  return id;
}

function serializeCommands(commands: DraftCommand[]): string {
  return JSON.stringify(commands);
}

function defaultDraftMemoryPolicy(): DraftMemoryAutomationPolicy {
  return {
    mode: "suggest_only",
    maxRiskLevel: "low",
    allowSkippedVerification: false,
    allowedCategories: ["workflow_rule"],
    maxAutoApprovalsPerRun: "2"
  };
}

function toDraftMemoryPolicy(
  policy: MemoryAutomationPolicySettings
): DraftMemoryAutomationPolicy {
  return {
    mode: policy.mode,
    maxRiskLevel: policy.maxRiskLevel,
    allowSkippedVerification: policy.allowSkippedVerification,
    allowedCategories: [...policy.allowedCategories],
    maxAutoApprovalsPerRun: String(policy.maxAutoApprovalsPerRun)
  };
}

function fromDraftMemoryPolicy(
  projectId: string,
  policy: DraftMemoryAutomationPolicy
): MemoryAutomationPolicySettings {
  return {
    projectId,
    mode: policy.mode as MemoryAutomationPolicySettings["mode"],
    maxRiskLevel: policy.maxRiskLevel as MemoryAutomationPolicySettings["maxRiskLevel"],
    allowSkippedVerification: policy.allowSkippedVerification,
    allowedCategories: policy.allowedCategories as MemoryAutomationPolicySettings["allowedCategories"],
    maxAutoApprovalsPerRun: Number(policy.maxAutoApprovalsPerRun)
  };
}

function serializeMemoryPolicy(policy: DraftMemoryAutomationPolicy): string {
  return JSON.stringify({
    ...policy,
    allowedCategories: [...policy.allowedCategories].sort()
  });
}

function errorMessage(error: unknown): string {
  return cleanSettingsError(error);
}

const memoryModeOptions = [
  {
    id: "suggest_only",
    label: "Suggest only",
    detail: "Queue proposals for manual approval."
  },
  {
    id: "auto_after_review_accept",
    label: "Auto after review",
    detail: "Approve eligible memory when a run is accepted."
  }
] as const;

const riskOptions = ["low", "medium", "high", "blocking"] as const;

const memoryCategoryOptions = [
  { id: "workflow_rule", label: "Workflow rules" },
  { id: "project_fact", label: "Project facts" },
  { id: "user_preference", label: "User preferences" },
  { id: "temporary_note", label: "Temporary notes" }
] as const;
