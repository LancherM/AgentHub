import { useEffect, useMemo, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { ThreadView } from "./components/ThreadView";
import { ReviewPanel } from "./components/ReviewPanel";
import { NewRunModal, type NewRunDraft } from "./components/NewRunModal";
import { agentHubApi } from "./lib/agentHubApi";
import type {
  AgentKind,
  ContextMode,
  ProjectSummary,
  RunDetail,
  RunSummary
} from "./lib/types";

export function App(): JSX.Element {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>();
  const [selectedRun, setSelectedRun] = useState<RunDetail | undefined>();
  const [isNewRunOpen, setIsNewRunOpen] = useState(false);
  const [isBusy, setIsBusy] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const selectedProjectId = useMemo(
    () => selectedRun?.projectId ?? projects[0]?.id,
    [projects, selectedRun]
  );

  useEffect(() => {
    void refreshShell();
  }, []);

  useEffect(() => {
    if (!selectedRunId) {
      setSelectedRun(undefined);
      return;
    }
    let active = true;
    const unsubscribe = agentHubApi.runs.onEvent(selectedRunId, () => {
      void loadRun(selectedRunId);
    });
    void loadRun(selectedRunId).finally(() => {
      if (!active) {
        unsubscribe();
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [selectedRunId]);

  async function refreshShell(): Promise<void> {
    setIsBusy(true);
    setError(undefined);
    try {
      const [projectList, runList] = await Promise.all([
        agentHubApi.projects.list(),
        agentHubApi.runs.list()
      ]);
      setProjects(projectList);
      setRuns(runList);
      if (!selectedRunId && runList[0]) {
        setSelectedRunId(runList[0].id);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsBusy(false);
    }
  }

  async function loadRun(runId: string): Promise<void> {
    try {
      const detail = await agentHubApi.runs.get(runId);
      setSelectedRun(detail);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function createRun(draft: NewRunDraft): Promise<void> {
    setIsBusy(true);
    setError(undefined);
    try {
      let projectId = draft.projectId;
      if (!projectId && draft.projectPath.trim()) {
        const project = await agentHubApi.projects.open(draft.projectPath);
        projectId = project.id;
      }
      if (!projectId) {
        throw new Error("Choose a project or enter a local path.");
      }
      const summary = await agentHubApi.runs.create({
        projectId,
        prompt: draft.prompt,
        title: draft.title,
        agentKind: draft.agentKind,
        contextMode: draft.contextMode
      });
      await refreshShell();
      setSelectedRunId(summary.id);
      setIsNewRunOpen(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsBusy(false);
    }
  }

  async function createInlineRun(
    prompt: string,
    agentKind: AgentKind,
    contextMode: ContextMode
  ): Promise<void> {
    if (!selectedProjectId) {
      setIsNewRunOpen(true);
      return;
    }
    await createRun({
      projectId: selectedProjectId,
      projectPath: "",
      title: "",
      prompt,
      agentKind,
      contextMode
    });
  }

  return (
    <div className="app-shell">
      <Sidebar
        projects={projects}
        runs={runs}
        selectedRunId={selectedRunId}
        onNewRun={() => setIsNewRunOpen(true)}
        onSelectRun={setSelectedRunId}
      />
      <main className="center-pane">
        {error ? <div className="error-strip">{error}</div> : null}
        <ThreadView
          run={selectedRun}
          isBusy={isBusy}
          onCreateRun={createInlineRun}
        />
      </main>
      <ReviewPanel run={selectedRun} />
      {isNewRunOpen ? (
        <NewRunModal
          projects={projects}
          defaultProjectId={selectedProjectId}
          isBusy={isBusy}
          onCreate={createRun}
          onClose={() => setIsNewRunOpen(false)}
        />
      ) : null}
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
