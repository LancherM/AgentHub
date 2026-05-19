import { useCallback, useEffect, useMemo, useState } from "react";
import { ChatView } from "./components/chat/ChatView";
import { RunInspectorModal } from "./components/inspector/RunInspectorModal";
import { Sidebar } from "./components/sidebar/Sidebar";
import { agentHubApi } from "./lib/agentHubApi";
import type {
  AgentId,
  AgentRunMessage,
  ContextMode,
  ProjectSummary,
  RunDetail,
  RunInspectorTab,
  ThreadDetail,
  ThreadMessage,
  ThreadSummary
} from "./lib/types";

export function App(): JSX.Element {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [currentThread, setCurrentThread] = useState<ThreadDetail | undefined>();
  const [runDetails, setRunDetails] = useState<Record<string, RunDetail>>({});
  const [selectedThreadId, setSelectedThreadId] = useState<string | undefined>();
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>();
  const [selectedInspector, setSelectedInspector] = useState<
    { runId: string; tab?: RunInspectorTab } | undefined
  >();
  const [lastUsedAgents, setLastUsedAgents] = useState<AgentId[]>(["fake"]);
  const [isBusy, setIsBusy] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const activeProjectId = currentThread?.projectId ?? selectedProjectId;
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId),
    [activeProjectId, projects]
  );
  const selectedMessages = currentThread?.messages ?? [];

  useEffect(() => {
    void refreshShell();
  }, []);

  const refreshThreadList = useCallback(async (): Promise<void> => {
    const threadList = await agentHubApi.threads.list();
    setThreads(threadList);
  }, []);

  const loadThread = useCallback(
    async (threadId: string): Promise<void> => {
      setError(undefined);
      setIsBusy(true);
      try {
        const detail = await agentHubApi.threads.get(threadId);
        setCurrentThread(detail);
        setSelectedThreadId(detail.id);
        setSelectedProjectId((current) => detail.projectId ?? current);
        await refreshThreadList();
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setIsBusy(false);
      }
    },
    [refreshThreadList]
  );

  const handleRunUpdated = useCallback(
    (detail: RunDetail): void => {
      setRunDetails((current) => ({ ...current, [detail.id]: detail }));
      setCurrentThread((thread) =>
        thread ? updateAgentRunStatus(thread, detail.id, detail.status) : thread
      );
      if (isTerminalRunStatus(detail.status) && selectedThreadId) {
        agentHubApi.threads
          .get(selectedThreadId)
          .then(setCurrentThread)
          .catch((err: unknown) => {
            setError(errorMessage(err));
          });
      }
      void refreshThreadList().catch((err: unknown) => {
        setError(errorMessage(err));
      });
    },
    [refreshThreadList, selectedThreadId]
  );

  const cancelRun = useCallback(
    async (runId: string): Promise<void> => {
      await agentHubApi.runs.cancel(runId);
      const detail = await agentHubApi.runs.get(runId);
      handleRunUpdated(detail);
    },
    [handleRunUpdated]
  );

  async function refreshShell(): Promise<void> {
    setIsBusy(true);
    setError(undefined);
    try {
      const [projectList, threadList] = await Promise.all([
        agentHubApi.projects.list(),
        agentHubApi.threads.list()
      ]);
      setProjects(projectList);
      setThreads(threadList);
      const latestThread = threadList[0];
      setSelectedProjectId(
        (current) => current ?? latestThread?.projectId ?? projectList[0]?.id
      );
      if (latestThread) {
        const detail = await agentHubApi.threads.get(latestThread.id);
        setCurrentThread(detail);
        setSelectedThreadId(detail.id);
      } else {
        setCurrentThread(undefined);
        setSelectedThreadId(undefined);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsBusy(false);
    }
  }

  async function registerProject(projectPath: string): Promise<void> {
    setIsBusy(true);
    setError(undefined);
    try {
      const project = await agentHubApi.projects.open(projectPath);
      setProjects((current) => upsertProjectSummary(current, project));
      setSelectedProjectId(project.id);
      const thread = await agentHubApi.threads.create({
        projectId: project.id,
        title: "New Chat"
      });
      const detail = await agentHubApi.threads.get(thread.id);
      setCurrentThread(detail);
      setSelectedThreadId(detail.id);
      await refreshThreadList();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsBusy(false);
    }
  }

  function createNewThread(): void {
    setError(undefined);
    setCurrentThread(undefined);
    setSelectedThreadId(undefined);
    setSelectedProjectId((current) => current ?? projects[0]?.id);
  }

  async function submitMessage(
    input: string,
    contextMode: ContextMode
  ): Promise<void> {
    setError(undefined);
    setIsBusy(true);
    try {
      const detail = await agentHubApi.threads.sendMessage({
        threadId: selectedThreadId,
        projectId: activeProjectId ?? projects[0]?.id,
        text: input,
        contextMode
      });
      setCurrentThread(detail);
      setSelectedThreadId(detail.id);
      setSelectedProjectId((current) => detail.projectId ?? current);
      const mentions = lastUserMentions(detail.messages);
      if (mentions) {
        setLastUsedAgents(mentions);
      }
      await refreshThreadList();
    } catch (err) {
      setError(errorMessage(err));
      throw err;
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <Sidebar
        projects={projects}
        threads={threads}
        selectedThreadId={selectedThreadId}
        selectedProjectId={selectedProject?.id ?? selectedProjectId}
        onNewThread={createNewThread}
        onSelectThread={(threadId) => void loadThread(threadId)}
        onSelectProject={setSelectedProjectId}
        onRegisterProject={registerProject}
        isBusy={isBusy}
      />
      <main className="center-pane">
        <ChatView
          thread={currentThread}
          project={selectedProject}
          messages={selectedMessages}
          runDetails={runDetails}
          isBusy={isBusy}
          lastUsedAgents={lastUsedAgents}
          error={error}
          onSubmit={submitMessage}
          onRunUpdated={handleRunUpdated}
          onOpenInspector={(runId, tab) => setSelectedInspector({ runId, tab })}
          onCancelRun={cancelRun}
          onRegisterProject={registerProject}
        />
      </main>
      {selectedInspector ? (
        <RunInspectorModal
          runId={selectedInspector.runId}
          initialRun={runDetails[selectedInspector.runId]}
          initialTab={selectedInspector.tab}
          onClose={() => setSelectedInspector(undefined)}
        />
      ) : null}
    </div>
  );
}

function updateAgentRunStatus(
  thread: ThreadDetail,
  runId: string,
  status: AgentRunMessage["status"]
): ThreadDetail {
  return {
    ...thread,
    messages: thread.messages.map((message) =>
      message.type === "agent_run" && message.runId === runId
        ? { ...message, status }
        : message
    )
  };
}

function isTerminalRunStatus(status: AgentRunMessage["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function lastUserMentions(messages: ThreadMessage[]): AgentId[] | undefined {
  const userMessage = [...messages]
    .reverse()
    .find((message) => message.type === "user");
  if (userMessage?.type === "user" && userMessage.mentions.length > 0) {
    return userMessage.mentions;
  }
  return undefined;
}

function upsertProjectSummary(
  projects: ProjectSummary[],
  summary: ProjectSummary
): ProjectSummary[] {
  const next = [summary, ...projects.filter((project) => project.id !== summary.id)];
  return next.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
