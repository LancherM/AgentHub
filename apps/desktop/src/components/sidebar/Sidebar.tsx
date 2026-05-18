import { ProjectRegistrationForm } from "../projects/ProjectRegistrationForm";
import type { ProjectSummary, ThreadSummary } from "../../lib/types";

interface SidebarProps {
  projects: ProjectSummary[];
  threads: ThreadSummary[];
  selectedThreadId?: string;
  selectedProjectId?: string;
  onNewThread(): void;
  onSelectThread(threadId: string): void;
  onSelectProject(projectId: string): void;
  onRegisterProject(projectPath: string): Promise<void>;
  isBusy: boolean;
}

export function Sidebar({
  projects,
  threads,
  selectedThreadId,
  selectedProjectId,
  onNewThread,
  onSelectThread,
  onSelectProject,
  onRegisterProject,
  isBusy
}: SidebarProps): JSX.Element {
  return (
    <aside className="sidebar">
      <div className="brand-block">
        <div className="brand-mark">AH</div>
        <div>
          <div className="brand-title">Agent Hub</div>
          <div className="brand-subtitle">Local command center</div>
        </div>
      </div>

      <button className="new-run-button" onClick={onNewThread}>
        <span className="button-plus">+</span>
        New Chat
      </button>

      <section className="nav-section grow">
        <div className="section-label">Threads</div>
        <div className="thread-list">
          {threads.length === 0 ? (
            <div className="muted-row">No conversations yet</div>
          ) : (
            threads.map((thread) => (
              <button
                className={`thread-row ${
                  selectedThreadId === thread.id ? "selected" : ""
                }`}
                key={thread.id}
                onClick={() => onSelectThread(thread.id)}
              >
                <div className="thread-row-main">
                  <span className="thread-dot" />
                  <span className="row-title">{thread.title}</span>
                  <span className="thread-time">{relativeTime(thread.updatedAt)}</span>
                </div>
                <div className="row-subtitle">{thread.lastMessage}</div>
                <div className="thread-meta">
                  <span>{thread.runCount} runs</span>
                  {thread.activeRunCount > 0 ? (
                    <span>{thread.activeRunCount} active</span>
                  ) : null}
                </div>
              </button>
            ))
          )}
        </div>
      </section>

      <section className="nav-section">
        <div className="section-label">Projects</div>
        <ProjectRegistrationForm
          isBusy={isBusy}
          onRegister={onRegisterProject}
        />
        <div className="project-list">
          {projects.length === 0 ? (
            <div className="muted-row">No projects registered</div>
          ) : (
            projects.map((project) => (
              <button
                className={`project-row ${
                  selectedProjectId === project.id ? "selected" : ""
                }`}
                key={project.id}
                onClick={() => onSelectProject(project.id)}
              >
                <span className="project-dot" />
                <div className="truncate">
                  <div className="row-title">{project.name}</div>
                  <div className="row-subtitle">{project.rootPath}</div>
                </div>
              </button>
            ))
          )}
        </div>
      </section>

      <nav className="placeholder-nav" aria-label="Utilities">
        {["Compare", "Memory", "Skills", "Settings"].map((item) => (
          <button key={item}>{item}</button>
        ))}
      </nav>
    </aside>
  );
}

function relativeTime(value: string): string {
  const date = new Date(value);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) {
    return "now";
  }
  if (diffMs < hour) {
    return `${Math.floor(diffMs / minute)}m`;
  }
  if (diffMs < day) {
    return `${Math.floor(diffMs / hour)}h`;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric"
  }).format(date);
}
