import { useEffect, useState } from "react";
import { agentHubApi } from "../../lib/agentHubApi";
import type {
  ProjectSummary,
  VerificationCommandConfig
} from "../../lib/types";

interface VerificationSettingsPanelProps {
  project?: ProjectSummary;
  onClose(): void;
}

interface DraftCommand {
  id: string;
  label: string;
  executable: string;
  argsText: string;
  timeoutMs: string;
  continueOnFailure: boolean;
}

export function VerificationSettingsPanel({
  project,
  onClose
}: VerificationSettingsPanelProps): JSX.Element {
  const [commands, setCommands] = useState<DraftCommand[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    setMessage(undefined);
    setError(undefined);
    if (!project) {
      setCommands([]);
      return;
    }
    setIsLoading(true);
    agentHubApi.settings
      .getVerification(project.id)
      .then((settings) => {
        setCommands(settings.commands.map(toDraftCommand));
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
    setCommands((current) =>
      current.map((command, commandIndex) =>
        commandIndex === index ? { ...command, ...patch } : command
      )
    );
  }

  function removeCommand(index: number): void {
    setCommands((current) =>
      current.filter((_command, commandIndex) => commandIndex !== index)
    );
  }

  async function save(): Promise<void> {
    if (!project) {
      return;
    }
    setMessage(undefined);
    setError(undefined);
    setIsSaving(true);
    try {
      const saved = await agentHubApi.settings.saveVerification({
        projectId: project.id,
        commands: commands.map(fromDraftCommand)
      });
      setCommands(saved.commands.map(toDraftCommand));
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
            <button
              className="ghost-button"
              onClick={() => void save()}
              disabled={!project || isLoading || isSaving}
            >
              {isSaving ? "Saving" : "Save"}
            </button>
            <button className="ghost-button" onClick={onClose}>
              Close
            </button>
          </div>
        </header>

        <div className="settings-body">
          {message ? <div className="decision-strip">{message}</div> : null}
          {error ? <div className="inline-error">{error}</div> : null}

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
                <button className="ghost-button" onClick={addCommand}>
                  Add Command
                </button>
              </div>

              <div className="verification-settings-list">
                {commands.length === 0 ? (
                  <div className="settings-empty">
                    Runs will record skipped verification until a command is added.
                  </div>
                ) : (
                  commands.map((command, index) => (
                    <article className="verification-command-editor" key={index}>
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
                    </article>
                  ))
                )}
              </div>
            </>
          )}
        </div>
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
