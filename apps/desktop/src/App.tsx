import { useCallback, useEffect, useMemo, useState } from "react";
import { ChatView } from "./components/chat/ChatView";
import { RunInspectorModal } from "./components/inspector/RunInspectorModal";
import { Sidebar } from "./components/sidebar/Sidebar";
import { VerificationSettingsPanel } from "./components/settings/VerificationSettingsPanel";
import { agentHubApi } from "./lib/agentHubApi";
import type {
  AgentId,
  AgentRunMessage,
  ContextMode,
  ProjectSummary,
  RunDetail,
  RunInspectorTab,
  RunContinuationTarget,
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lastUsedAgents, setLastUsedAgents] = useState<AgentId[]>(["fake"]);
  const [pendingContinueFrom, setPendingContinueFrom] =
    useState<RunContinuationTarget | undefined>();
  const [isBusy, setIsBusy] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const activeProjectId = selectedProjectId ?? currentThread?.projectId ?? projects[0]?.id;
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId),
    [activeProjectId, projects]
  );
  const selectedMessages = currentThread?.messages ?? [];

  useEffect(() => {
    void refreshShell();
  }, []);

  const loadThread = useCallback(
    async (threadId: string): Promise<void> => {
      setError(undefined);
      setSelectedThreadId(threadId);
      try {
        const detail = await agentHubApi.threads.get(threadId);
        setCurrentThread(detail);
        setSelectedThreadId(detail.id);
        setSelectedProjectId((current) => detail.projectId ?? current);
        setThreads((current) => upsertThreadSummary(current, threadSummaryFromDetail(detail)));
      } catch (err) {
        setError(errorMessage(err));
      }
    },
    []
  );

  const handleRunUpdated = useCallback(
    (detail: RunDetail): void => {
      setRunDetails((current) => ({ ...current, [detail.id]: detail }));
      setCurrentThread((thread) => {
        if (!thread) {
          return thread;
        }
        const updated = updateAgentRunStatus(thread, detail.id, detail.status);
        setThreads((current) => upsertThreadSummary(current, threadSummaryFromDetail(updated)));
        return updated;
      });
      if (isTerminalRunStatus(detail.status) && selectedThreadId) {
        agentHubApi.threads
          .get(selectedThreadId)
          .then((thread) => {
            setCurrentThread(thread);
            setThreads((current) =>
              upsertThreadSummary(current, threadSummaryFromDetail(thread))
            );
          })
          .catch((err: unknown) => {
            setError(errorMessage(err));
          });
      }
    },
    [selectedThreadId]
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
      const projectId =
        selectedProjectId ?? currentThread?.projectId ?? threadList[0]?.projectId ?? projectList[0]?.id;
      const latestThread =
        selectPreferredThreadForProject(threadList, projectId) ?? threadList[0];
      setSelectedProjectId(
        (current) => current ?? latestThread?.projectId ?? projectId
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
      const threadList = await agentHubApi.threads.list();
      setThreads(threadList);
      const room = selectPreferredThreadForProject(threadList, project.id);
      if (room) {
        const detail = await agentHubApi.threads.get(room.id);
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

  async function createNewThread(): Promise<void> {
    setError(undefined);
    setIsBusy(true);
    setPendingContinueFrom(undefined);
    try {
      const projectId = activeProjectId ?? projects[0]?.id;
      if (!projectId) {
        throw new Error("Register a local project before creating a room.");
      }
      const room = await agentHubApi.threads.create({
        projectId,
        title: "custom room",
        roomType: "custom",
        description: "Custom project room."
      });
      const detail = await agentHubApi.threads.get(room.id);
      setCurrentThread(detail);
      setSelectedThreadId(detail.id);
      setSelectedProjectId(detail.projectId);
      setThreads((current) => upsertThreadSummary(current, threadSummaryFromDetail(detail)));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsBusy(false);
    }
  }

  async function selectProject(projectId: string): Promise<void> {
    setError(undefined);
    setSelectedProjectId(projectId);
    setPendingContinueFrom(undefined);
    try {
      const threadList = await agentHubApi.threads.list();
      setThreads(threadList);
      const room = selectPreferredThreadForProject(threadList, projectId);
      if (room) {
        const detail = await agentHubApi.threads.get(room.id);
        setCurrentThread(detail);
        setSelectedThreadId(detail.id);
      } else {
        setCurrentThread(undefined);
        setSelectedThreadId(undefined);
      }
    } catch (err) {
      setError(errorMessage(err));
    }
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
        contextMode,
        continueFromRunId: pendingContinueFrom?.parentRunId,
        continueFromMessageId: pendingContinueFrom?.parentMessageId
      });
      setCurrentThread(detail);
      setSelectedThreadId(detail.id);
      setSelectedProjectId((current) => detail.projectId ?? current);
      const mentions = lastUserMentions(detail.messages);
      if (mentions) {
        setLastUsedAgents(mentions);
      }
      setThreads((current) => upsertThreadSummary(current, threadSummaryFromDetail(detail)));
    } catch (err) {
      setError(errorMessage(err));
      throw err;
    } finally {
      setPendingContinueFrom(undefined);
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
        onNewThread={() => void createNewThread()}
        onSelectThread={(threadId) => void loadThread(threadId)}
        onSelectProject={(projectId) => void selectProject(projectId)}
        onRegisterProject={registerProject}
        onOpenSettings={() => setSettingsOpen(true)}
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
          pendingContinueFrom={pendingContinueFrom}
          error={error}
          onSubmit={submitMessage}
          onContinueFromRun={(target) => setPendingContinueFrom(target)}
          onClearContinueFrom={() => setPendingContinueFrom(undefined)}
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
      {settingsOpen ? (
        <VerificationSettingsPanel
          project={selectedProject}
          onClose={() => setSettingsOpen(false)}
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

function upsertThreadSummary(
  threads: ThreadSummary[],
  summary: ThreadSummary
): ThreadSummary[] {
  return [summary, ...threads.filter((thread) => thread.id !== summary.id)].sort(
    compareThreadSummaries
  );
}

function threadSummaryFromDetail(thread: ThreadDetail): ThreadSummary {
  const runMessages = thread.messages.filter(
    (message): message is AgentRunMessage => message.type === "agent_run"
  );
  const lastMessage = thread.messages.at(-1);
  return {
    id: thread.id,
    title: thread.title,
    projectId: thread.projectId,
    roomType: thread.roomType,
    roomHandle: thread.roomHandle,
    description: thread.description,
    pinned: thread.pinned,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    lastMessagePreview: lastMessage
      ? threadMessagePreview(lastMessage)
      : "Ready for a local agent prompt",
    runCount: runMessages.length,
    activeRunCount: runMessages.filter((message) =>
      isActiveRunStatus(message.status)
    ).length
  };
}

function selectPreferredThreadForProject(
  threads: ThreadSummary[],
  projectId?: string
): ThreadSummary | undefined {
  const projectThreads = threads
    .filter((thread) => projectId === undefined || thread.projectId === projectId)
    .sort(compareThreadSummaries);
  return (
    projectThreads.find((thread) => thread.roomHandle === "general") ??
    projectThreads[0]
  );
}

function compareThreadSummaries(
  left: ThreadSummary,
  right: ThreadSummary
): number {
  const leftPinned = left.pinned === true ? 0 : 1;
  const rightPinned = right.pinned === true ? 0 : 1;
  if (leftPinned !== rightPinned) {
    return leftPinned - rightPinned;
  }
  const leftOrder = defaultRoomOrder(left.roomHandle);
  const rightOrder = defaultRoomOrder(right.roomHandle);
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  return right.updatedAt.localeCompare(left.updatedAt);
}

function defaultRoomOrder(handle?: string): number {
  const handles = ["general", "planning", "research", "review", "knowledge"];
  const index = handle ? handles.indexOf(handle) : -1;
  return index >= 0 ? index : 1000;
}

function threadMessagePreview(message: ThreadMessage): string {
  if (message.type === "user" || message.type === "assistant" || message.type === "system") {
    return message.text;
  }
  return `@${message.agentId} ${message.status}`;
}

function isActiveRunStatus(status: AgentRunMessage["status"]): boolean {
  return status === "queued" || status === "running" || status === "verifying";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
