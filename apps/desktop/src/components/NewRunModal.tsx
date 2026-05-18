import { useState } from "react";
import type { AgentId, ContextMode, ProjectSummary } from "../lib/types";

export interface NewRunDraft {
  projectId?: string;
  projectPath: string;
  title: string;
  prompt: string;
  agentId: AgentId;
  contextMode: ContextMode;
}

interface NewRunModalProps {
  projects: ProjectSummary[];
  defaultProjectId?: string;
  isBusy: boolean;
  onCreate(draft: NewRunDraft): Promise<void>;
  onClose(): void;
}

export function NewRunModal({
  projects,
  defaultProjectId,
  isBusy,
  onCreate,
  onClose
}: NewRunModalProps): JSX.Element {
  const [projectId, setProjectId] = useState(defaultProjectId ?? "");
  const [projectPath, setProjectPath] = useState("");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [agentId, setAgentId] = useState<AgentId>("fake");
  const [contextMode, setContextMode] = useState<ContextMode>("auto");
  const [validationError, setValidationError] = useState<string | undefined>();

  async function submit(): Promise<void> {
    if (!prompt.trim()) {
      setValidationError("Task is required.");
      return;
    }
    if (!projectId && !projectPath.trim()) {
      setValidationError("Choose a project or enter a local path.");
      return;
    }
    setValidationError(undefined);
    await onCreate({
      projectId: projectId || undefined,
      projectPath,
      title,
      prompt,
      agentId,
      contextMode
    });
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-run-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="new-run-title">New Run</h2>
          <button className="ghost-button" onClick={onClose}>
            Close
          </button>
        </div>
        <label>
          <span>Project</span>
          <select
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">Use path below</option>
            {projects.map((project) => (
              <option value={project.id} key={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Local path</span>
          <input
            value={projectPath}
            onChange={(event) => setProjectPath(event.target.value)}
            placeholder="/Users/you/project"
          />
        </label>
        <label>
          <span>Title</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Optional"
          />
        </label>
        <label>
          <span>Task</span>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={6}
            autoFocus
          />
        </label>
        <div className="modal-grid">
          <label>
            <span>Agent</span>
            <select
              value={agentId}
              onChange={(event) => setAgentId(event.target.value as AgentId)}
            >
              <option value="fake">@fake</option>
              <option value="codex" disabled>
                @codex - coming soon
              </option>
              <option value="claude" disabled>
                @claude - coming soon
              </option>
            </select>
          </label>
          <label>
            <span>Context</span>
            <select
              value={contextMode}
              onChange={(event) =>
                setContextMode(event.target.value as ContextMode)
              }
            >
              <option value="auto">auto</option>
              <option value="minimal">minimal</option>
              <option value="full">full</option>
            </select>
          </label>
        </div>
        {validationError ? (
          <div className="form-error" role="alert">
            {validationError}
          </div>
        ) : null}
        <div className="modal-actions">
          <button className="ghost-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            onClick={() => void submit()}
            disabled={isBusy || !prompt.trim() || (!projectId && !projectPath.trim())}
          >
            Run
          </button>
        </div>
      </div>
    </div>
  );
}
