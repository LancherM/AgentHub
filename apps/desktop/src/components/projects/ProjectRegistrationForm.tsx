import { useState } from "react";
import type { FormEvent } from "react";

interface ProjectRegistrationFormProps {
  isBusy: boolean;
  onRegister(projectPath: string): Promise<void>;
}

export function ProjectRegistrationForm({
  isBusy,
  onRegister
}: ProjectRegistrationFormProps): JSX.Element {
  const [projectPath, setProjectPath] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      <button
        type="submit"
        className="primary-button"
        disabled={!projectPath.trim() || isBusy || isSubmitting}
      >
        {isSubmitting ? "Registering…" : "Register Project"}
      </button>
    </form>
  );
}
