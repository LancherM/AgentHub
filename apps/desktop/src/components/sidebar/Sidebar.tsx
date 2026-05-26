import { useState } from "react";
import type { FormEvent } from "react";
import { ProjectRegistrationForm } from "../projects/ProjectRegistrationForm";
import type {
  CreateThreadInput,
  ProjectSummary,
  ThreadSummary
} from "../../lib/types";

interface SidebarProps {
  projects: ProjectSummary[];
  threads: ThreadSummary[];
  selectedThreadId?: string;
  selectedProjectId?: string;
  activeWorkspace: "chat" | "knowledge" | "team";
  sidebarDensity: "comfortable" | "compact";
  onNewThread(input: CreateThreadInput): Promise<void> | void;
  onSelectThread(threadId: string): void;
  onSelectProject(projectId: string): void;
  onRegisterProject(projectPath: string): Promise<void>;
  onSelectProjectDirectory(): Promise<string | undefined>;
  onOpenKnowledge(): void;
  onOpenTeam(): void;
  onOpenSettings(): void;
  onToggleSidebarDensity(): void;
  isBusy: boolean;
}

export function Sidebar({
  projects,
  threads,
  selectedThreadId,
  selectedProjectId,
  activeWorkspace,
  sidebarDensity,
  onNewThread,
  onSelectThread,
  onSelectProject,
  onRegisterProject,
  onSelectProjectDirectory,
  onOpenKnowledge,
  onOpenTeam,
  onOpenSettings,
  onToggleSidebarDensity,
  isBusy
}: SidebarProps): JSX.Element {
  const [roomFormOpen, setRoomFormOpen] = useState(false);
  const [roomTitle, setRoomTitle] = useState("");
  const [roomHandle, setRoomHandle] = useState("");
  const [roomDescription, setRoomDescription] = useState("");
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
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

  async function submitRoom(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const title = roomTitle.trim();
    if (!selectedProjectId || !title || isBusy || isCreatingRoom) {
      return;
    }
    setIsCreatingRoom(true);
    try {
      await onNewThread({
        projectId: selectedProjectId,
        title,
        roomType: "custom",
        roomHandle: roomHandle.trim() || undefined,
        description: roomDescription.trim() || undefined,
        sharedContextEnabled: true
      });
      setRoomTitle("");
      setRoomHandle("");
      setRoomDescription("");
      setRoomFormOpen(false);
    } finally {
      setIsCreatingRoom(false);
    }
  }

  return (
    <aside className={`sidebar ${sidebarDensity}`}>
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
            <div className="row-title">
              {selectedProject
                ? projectDisplayName(selectedProject, projects)
                : "No project"}
            </div>
            <div className="row-subtitle">
              {selectedProject
                ? compactProjectPath(selectedProject.rootPath)
                : "Register a local repository"}
            </div>
          </div>
        </div>
        {projects.length > 1 ? (
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
                  <div className="row-title">
                    {projectDisplayName(project, projects)}
                  </div>
                  <div className="row-subtitle">{compactProjectPath(project.rootPath)}</div>
                </div>
              </button>
            ))}
          </div>
        ) : null}
        <details
          className="sidebar-add-project"
          open={projects.length === 0}
        >
          <summary>Add project</summary>
          <ProjectRegistrationForm
            isBusy={isBusy}
            onRegister={onRegisterProject}
            onSelectDirectory={onSelectProjectDirectory}
          />
        </details>
        {projects.length === 0 ? (
          <div className="sidebar-empty-action">
            <strong>No projects registered</strong>
            <span>Add a local repository path to start a room.</span>
          </div>
        ) : null}
      </section>

      <section className="nav-section grow">
        <div className="section-header">
          <div className="section-label">Rooms</div>
          <button
            className="icon-button"
            onClick={() => setRoomFormOpen((open) => !open)}
            disabled={!selectedProjectId}
            title="Create room"
            aria-label="Create room"
          >
            +
          </button>
        </div>
        {roomFormOpen ? (
          <form className="room-create-form" onSubmit={submitRoom}>
            <label>
              <span>Room title</span>
              <input
                value={roomTitle}
                placeholder="Design review"
                disabled={!selectedProjectId || isBusy || isCreatingRoom}
                onChange={(event) => setRoomTitle(event.target.value)}
              />
            </label>
            <label>
              <span>Handle</span>
              <input
                value={roomHandle}
                placeholder="design-review"
                disabled={!selectedProjectId || isBusy || isCreatingRoom}
                onChange={(event) => setRoomHandle(event.target.value)}
              />
            </label>
            <label className="wide">
              <span>Description</span>
              <textarea
                value={roomDescription}
                placeholder="Focused work for design review."
                disabled={!selectedProjectId || isBusy || isCreatingRoom}
                onChange={(event) => setRoomDescription(event.target.value)}
              />
            </label>
            <div className="room-create-actions">
              <button
                className="ghost-button compact"
                type="button"
                onClick={() => setRoomFormOpen(false)}
              >
                Cancel
              </button>
              <button
                className="primary-button compact"
                type="submit"
                disabled={
                  !selectedProjectId ||
                  !roomTitle.trim() ||
                  isBusy ||
                  isCreatingRoom
                }
              >
                {isCreatingRoom ? "Creating..." : "Create room"}
              </button>
            </div>
          </form>
        ) : null}
        <div className="thread-list">
          {projectRooms.length === 0 ? (
            <div className="sidebar-empty-action">
              <strong>No rooms yet</strong>
              <span>Create a room for repeated local work.</span>
              <button
                className="ghost-button compact"
                disabled={!selectedProjectId}
                onClick={() => setRoomFormOpen(true)}
              >
                New Room
              </button>
            </div>
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
                <div className="row-subtitle thread-description">
                  {thread.description ?? thread.lastMessagePreview ?? "Local room"}
                </div>
                <div className="thread-meta">
                  <span>
                    {thread.runCount ?? 0} runs
                    {thread.roomType ? ` · ${thread.roomType}` : ""}
                    {(thread.activeRunCount ?? 0) > 0
                      ? ` · ${thread.activeRunCount} running`
                      : ""}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      </section>

      <nav className="utility-nav" aria-label="Utilities">
        <div className="utility-zone-label">Utilities</div>
        <div className="sidebar-status-summary" aria-label="Task status">
          <span>
            {projectRooms.length} rooms · {activeRunCount} running · {runCount} runs
          </span>
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
        <button className="utility-secondary-action" onClick={onToggleSidebarDensity}>
          {sidebarDensity === "compact" ? "Expand sidebar" : "Collapse sidebar"}
        </button>
      </nav>
    </aside>
  );
}

function projectDisplayName(
  project: ProjectSummary,
  projects: ProjectSummary[]
): string {
  if (isHomePath(project.rootPath)) {
    return "Home";
  }
  const duplicateName = projects.some(
    (candidate) => candidate.id !== project.id && candidate.name === project.name
  );
  if (!duplicateName) {
    return project.name;
  }
  const parent = parentFolderName(project.rootPath);
  return parent ? `${project.name} · ${parent}` : project.name;
}

function compactProjectPath(rootPath: string): string {
  const normalized = rootPath.replace(/\/+$/, "");
  if (isHomePath(normalized)) {
    return "~/";
  }
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 2) {
    return normalized || rootPath;
  }
  return `.../${parts.slice(-2).join("/")}`;
}

function isHomePath(rootPath: string): boolean {
  return rootPath === "~" || rootPath === "~/";
}

function parentFolderName(rootPath: string): string | undefined {
  const normalized = rootPath.replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length < 2) {
    return undefined;
  }
  return parts.at(-2);
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
