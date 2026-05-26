import { useState } from "react";
import type { FormEvent } from "react";

interface ProjectRegistrationFormProps {
  isBusy: boolean;
  onRegister(projectPath: string): Promise<void>;
  onSelectDirectory?: () => Promise<string | undefined>;
}

export function ProjectRegistrationForm({
  isBusy,
  onRegister,
  onSelectDirectory
}: ProjectRegistrationFormProps): JSX.Element {
  const [projectPath, setProjectPath] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isBrowsing, setIsBrowsing] = useState(false);

  async function submitProject(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmedPath = projectPath.trim();
    if (!trimmedPath || isSubmitting || isBusy) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onRegister(trimmedPath);
      setProjectPath("");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function browseProject(): Promise<void> {
    if (!onSelectDirectory || isBusy || isSubmitting || isBrowsing) {
      return;
    }
    setIsBrowsing(true);
    try {
      const selectedPath = await onSelectDirectory();
      if (selectedPath) {
        setProjectPath(selectedPath);
      }
    } finally {
      setIsBrowsing(false);
    }
  }

  return (
    <form className="project-registration-form" onSubmit={submitProject}>
      <label>
        <span>Local project path</span>
        <input
          type="text"
          value={projectPath}
          placeholder="/path/to/local/repo"
          disabled={isBusy || isSubmitting}
          onChange={(event) => setProjectPath(event.target.value)}
        />
      </label>
      <div className="project-registration-actions">
        {onSelectDirectory ? (
          <button
            type="button"
            className="ghost-button"
            disabled={isBusy || isSubmitting || isBrowsing}
            onClick={() => void browseProject()}
          >
            {isBrowsing ? "Opening..." : "Choose Folder"}
          </button>
        ) : null}
        <button
          type="submit"
          className="primary-button"
          disabled={!projectPath.trim() || isBusy || isSubmitting || isBrowsing}
        >
          {isSubmitting ? "Registering…" : "Register Project"}
        </button>
      </div>
    </form>
  );
}
