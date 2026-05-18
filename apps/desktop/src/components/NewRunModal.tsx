import { useState } from "react";
import type { AgentKind, ContextMode, ProjectSummary } from "../lib/types";

export interface NewRunDraft {
  projectId?: string;
  projectPath: string;
  title: string;
  prompt: string;
  agentKind: AgentKind;
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
  const [agentKind, setAgentKind] = useState<AgentKind>("fake");
  const [contextMode, setContextMode] = useState<ContextMode>("auto");

  async function submit(): Promise<void> {
    await onCreate({
      projectId: projectId || undefined,
      projectPath,
      title,
      prompt,
      agentKind,
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
          <span>Prompt</span>
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
              value={agentKind}
              onChange={(event) => setAgentKind(event.target.value as AgentKind)}
            >
              <option value="codex">@codex</option>
              <option value="claude-code">@claude</option>
              <option value="fake">@fake</option>
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
