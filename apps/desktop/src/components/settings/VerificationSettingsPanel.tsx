import { useEffect, useMemo, useState } from "react";
import { agentHubApi } from "../../lib/agentHubApi";
import type {
  ProjectSummary,
  VerificationCommandConfig
} from "../../lib/types";
import {
  cleanSettingsError,
  validateDraftVerificationCommands,
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
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    setMessage(undefined);
    setError(undefined);
    if (!project) {
      setCommands([]);
      setSavedCommands([]);
      return;
    }
    setIsLoading(true);
    agentHubApi.settings
      .getVerification(project.id)
      .then((settings) => {
        const drafts = settings.commands.map(toDraftCommand);
        setCommands(drafts);
        setSavedCommands(drafts);
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

  const hasChanges = useMemo(
    () => serializeCommands(commands) !== serializeCommands(savedCommands),
    [commands, savedCommands]
  );
  const validation = useMemo(
    () => validateDraftVerificationCommands(commands),
    [commands]
  );
  const activeError = error ?? (hasChanges ? validation.message : undefined);

  return (
    <div className="inspector-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Verification settings"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <div>
            <div className="eyebrow">Settings</div>
            <h2>Verification</h2>
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

function errorMessage(error: unknown): string {
  return cleanSettingsError(error);
}
