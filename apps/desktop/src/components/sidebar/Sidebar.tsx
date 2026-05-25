import { ProjectRegistrationForm } from "../projects/ProjectRegistrationForm";
import type { ProjectSummary, ThreadSummary } from "../../lib/types";

interface SidebarProps {
  projects: ProjectSummary[];
  threads: ThreadSummary[];
  selectedThreadId?: string;
  selectedProjectId?: string;
  activeWorkspace: "chat" | "knowledge" | "team";
  onNewThread(): void;
  onSelectThread(threadId: string): void;
  onSelectProject(projectId: string): void;
  onRegisterProject(projectPath: string): Promise<void>;
  onOpenKnowledge(): void;
  onOpenTeam(): void;
  onOpenSettings(): void;
  isBusy: boolean;
}

export function Sidebar({
  projects,
  threads,
  selectedThreadId,
  selectedProjectId,
  activeWorkspace,
  onNewThread,
  onSelectThread,
  onSelectProject,
  onRegisterProject,
  onOpenKnowledge,
  onOpenTeam,
  onOpenSettings,
  isBusy
}: SidebarProps): JSX.Element {
  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const projectRooms = threads
    .filter((thread) => !selectedProjectId || thread.projectId === selectedProjectId)
    .sort((left, right) => {
      if (left.id === selectedThreadId) {
        return -1;
      }
      if (right.id === selectedThreadId) {
        return 1;
      }
      return 0;
    });
  const activeRunCount = projectRooms.reduce(
    (total, thread) => total + (thread.activeRunCount ?? 0),
    0
  );
  const runCount = projectRooms.reduce(
    (total, thread) => total + (thread.runCount ?? 0),
    0
  );

  return (
    <aside className="sidebar">
      <div className="brand-block">
        <div className="brand-mark">AH</div>
        <div>
          <div className="brand-title">Agent Hub</div>
          <div className="brand-subtitle">Local workgroup</div>
        </div>
      </div>

      <section className="nav-section project-nav">
        <div className="section-label">Project</div>
        <div className="selected-project-block">
          <span className="project-dot" />
          <div className="truncate">
            <div className="row-title">{selectedProject?.name ?? "No project"}</div>
            <div className="row-subtitle">
              {selectedProject?.rootPath ?? "Register a local repository"}
            </div>
          </div>
        </div>
        {projects.length === 0 ? (
          <>
            <ProjectRegistrationForm
              isBusy={isBusy}
              onRegister={onRegisterProject}
            />
            <div className="muted-row">No projects registered</div>
          </>
        ) : projects.length > 1 ? (
          <div className="project-list compact">
            {projects.map((project) => (
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
            ))}
          </div>
        ) : null}
      </section>

      <section className="nav-section grow">
        <div className="section-header">
          <div className="section-label">Rooms</div>
          <button
            className="icon-button"
            onClick={onNewThread}
            disabled={!selectedProjectId}
            title="Create room"
            aria-label="Create room"
          >
            +
          </button>
        </div>
        <div className="thread-list">
          {projectRooms.length === 0 ? (
            <div className="muted-row">No rooms yet</div>
          ) : (
            projectRooms.map((thread) => (
              <button
                className={`thread-row ${
                  activeWorkspace === "chat" && selectedThreadId === thread.id
                    ? "selected"
                    : ""
                }`}
                key={thread.id}
                onClick={() => onSelectThread(thread.id)}
              >
                <div className="thread-row-main">
                  <span
                    className={`thread-dot ${
                      (thread.activeRunCount ?? 0) > 0 ? "active" : ""
                    }`}
                  />
                  <span className="room-handle">
                    #{thread.roomHandle ?? thread.title}
                  </span>
                  <span className="thread-time">{relativeTime(thread.updatedAt)}</span>
                </div>
                <div className="row-subtitle">
                  {thread.description ?? thread.lastMessagePreview ?? "Local room"}
                </div>
                <div className="thread-meta">
                  <span>{thread.runCount ?? 0} runs</span>
                  {thread.roomType ? <span>{thread.roomType}</span> : null}
                </div>
              </button>
            ))
          )}
        </div>
      </section>

      <section className="nav-section team-nav">
        <div className="section-label">Team</div>
        <div className="role-list">
          {roleRows.map((role) => (
            <button
              className={`role-row ${
                activeWorkspace === "team" ? "selected" : ""
              }`}
              key={role.handle}
              onClick={onOpenTeam}
              disabled={!selectedProjectId}
            >
              <span className={`role-mark ${role.kind}`}>{role.initial}</span>
              <span>@{role.handle}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="nav-section status-nav">
        <div className="section-label">Task status</div>
        <div className="status-list">
          <div>
            <span>Open</span>
            <strong>{projectRooms.length}</strong>
          </div>
          <div>
            <span>Running</span>
            <strong>{activeRunCount}</strong>
          </div>
          <div>
            <span>Runs</span>
            <strong>{runCount}</strong>
          </div>
        </div>
      </section>

      <nav className="utility-nav" aria-label="Utilities">
        <div className="local-status">
          <span className="project-dot" />
          <span>Local-first</span>
        </div>
        <button
          className={activeWorkspace === "knowledge" ? "selected" : ""}
          onClick={onOpenKnowledge}
          disabled={!selectedProjectId}
        >
          Knowledge
        </button>
        <button
          className={activeWorkspace === "team" ? "selected" : ""}
          onClick={onOpenTeam}
          disabled={!selectedProjectId}
        >
          Team
        </button>
        <button onClick={onOpenSettings}>Settings</button>
      </nav>
    </aside>
  );
}

const roleRows = [
  { handle: "researcher", initial: "R", kind: "blue" },
  { handle: "writer", initial: "W", kind: "orange" },
  { handle: "analyst", initial: "A", kind: "plum" },
  { handle: "operator", initial: "O", kind: "green" },
  { handle: "reviewer", initial: "V", kind: "amber" },
  { handle: "engineer", initial: "E", kind: "blue" },
  { handle: "memory", initial: "M", kind: "cyan" }
];

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
