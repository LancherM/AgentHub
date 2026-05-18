import type { ProjectSummary, RunSummary } from "../lib/types";
import { RunStatusBadge } from "./RunStatusBadge";

interface SidebarProps {
  projects: ProjectSummary[];
  runs: RunSummary[];
  selectedRunId?: string;
  onNewRun(): void;
  onSelectRun(runId: string): void;
}

export function Sidebar({
  projects,
  runs,
  selectedRunId,
  onNewRun,
  onSelectRun
}: SidebarProps): JSX.Element {
  return (
    <aside className="sidebar">
      <div className="brand-block">
        <div className="brand-mark">AH</div>
        <div>
          <div className="brand-title">Agent Hub</div>
          <div className="brand-subtitle">Local desktop</div>
        </div>
      </div>

      <button className="new-run-button" onClick={onNewRun}>
        <span className="button-plus">+</span>
        New Run
      </button>

      <section className="nav-section">
        <div className="section-label">Projects</div>
        <div className="project-list">
          {projects.length === 0 ? (
            <div className="muted-row">No projects registered</div>
          ) : (
            projects.map((project) => (
              <div className="project-row" key={project.id}>
                <span className="project-dot" />
                <div className="truncate">
                  <div className="row-title">{project.name}</div>
                  <div className="row-subtitle">{project.rootPath}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="nav-section grow">
        <div className="section-label">Recent Runs</div>
        <div className="run-list">
          {runs.length === 0 ? (
            <div className="muted-row">No runs yet</div>
          ) : (
            runs.map((run) => (
              <button
                className={`run-row ${selectedRunId === run.id ? "selected" : ""}`}
                key={run.id}
                onClick={() => onSelectRun(run.id)}
              >
                <div className="run-row-head">
                  <span className="row-title">{run.title}</span>
                  <RunStatusBadge status={run.status} compact />
                </div>
                <div className="row-subtitle">
                  @{run.agentId} · {run.projectName}
                </div>
              </button>
            ))
          )}
        </div>
      </section>

      <nav className="placeholder-nav">
        {["Compare", "Memory", "Skills", "Settings"].map((item) => (
          <button key={item}>{item}</button>
        ))}
      </nav>
    </aside>
  );
}
