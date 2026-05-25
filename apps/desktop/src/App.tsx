import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CommandPalette,
  type CommandPaletteAction
} from "./components/CommandPalette";
import { ChatView } from "./components/chat/ChatView";
import { RunInspectorModal } from "./components/inspector/RunInspectorModal";
import { KnowledgeWorkspace } from "./components/knowledge/KnowledgeWorkspace";
import { Sidebar } from "./components/sidebar/Sidebar";
import { VerificationSettingsPanel } from "./components/settings/VerificationSettingsPanel";
import { TeamWorkspace } from "./components/team/TeamWorkspace";
import { agentHubApi } from "./lib/agentHubApi";
import {
  loadDesktopPreferences,
  mergeDesktopPreferences,
  saveDesktopPreferences,
  type DesktopPreferences,
  type DesktopWorkspacePreference
} from "./lib/local-preferences";
import type {
  AgentId,
  AgentRunMessage,
  CollaborationWorkflowInput,
  ContextMode,
  CreateThreadInput,
  ProjectSummary,
  RunDetail,
  RunInspectorTab,
  RunContinuationTarget,
  ThreadDetail,
  ThreadMessage,
  ThreadSummary
} from "./lib/types";

type DesktopWorkspace = DesktopWorkspacePreference;

export function App(): JSX.Element {
  const [preferences, setPreferences] = useState<DesktopPreferences>(() =>
    loadDesktopPreferences()
  );
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [currentThread, setCurrentThread] = useState<ThreadDetail | undefined>();
  const [runDetails, setRunDetails] = useState<Record<string, RunDetail>>({});
  const [selectedThreadId, setSelectedThreadId] = useState<string | undefined>(
    preferences.selectedThreadId
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(
    preferences.selectedProjectId
  );
  const [selectedInspector, setSelectedInspector] = useState<
    { runId: string; tab?: RunInspectorTab } | undefined
  >();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeWorkspace, setActiveWorkspace] =
    useState<DesktopWorkspace>(preferences.activeWorkspace);
  const [sidebarDensity, setSidebarDensity] = useState(preferences.sidebarDensity);
  const [lastUsedAgents, setLastUsedAgents] = useState<AgentId[]>(
    preferences.lastUsedAgents
  );
  const [lastUsedRoleHandles, setLastUsedRoleHandles] = useState<string[]>(
    preferences.lastUsedRoleHandles
  );
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
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

  const rememberPreferences = useCallback((patch: Partial<DesktopPreferences>) => {
    setPreferences((current) => {
      const next = mergeDesktopPreferences(current, patch);
      saveDesktopPreferences(next);
      return next;
    });
  }, []);

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
        rememberPreferences({
          selectedThreadId: detail.id,
          selectedProjectId: detail.projectId,
          activeWorkspace: "chat"
        });
        setThreads((current) => upsertThreadSummary(current, threadSummaryFromDetail(detail)));
      } catch (err) {
        setError(errorMessage(err));
      }
    },
    [rememberPreferences]
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
        threadList.find((thread) => thread.id === selectedThreadId) ??
        selectPreferredThreadForProject(threadList, projectId) ??
        threadList[0];
      setSelectedProjectId(
        (current) => current ?? latestThread?.projectId ?? projectId
      );
      if (latestThread) {
        const detail = await agentHubApi.threads.get(latestThread.id);
        setCurrentThread(detail);
        setSelectedThreadId(detail.id);
        rememberPreferences({
          selectedProjectId: detail.projectId ?? projectId,
          selectedThreadId: detail.id
        });
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
      rememberPreferences({ selectedProjectId: project.id });
      const threadList = await agentHubApi.threads.list();
      setThreads(threadList);
      const room = selectPreferredThreadForProject(threadList, project.id);
      if (room) {
        const detail = await agentHubApi.threads.get(room.id);
        setCurrentThread(detail);
        setSelectedThreadId(detail.id);
        rememberPreferences({
          selectedProjectId: detail.projectId,
          selectedThreadId: detail.id
        });
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

  async function createNewThread(input: CreateThreadInput = {}): Promise<void> {
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
        title: input.title ?? "custom room",
        roomType: "custom",
        roomHandle: input.roomHandle,
        description: input.description ?? "Custom project room.",
        sharedContextEnabled: input.sharedContextEnabled ?? true
      });
      const detail = await agentHubApi.threads.get(room.id);
      setCurrentThread(detail);
      setSelectedThreadId(detail.id);
      setSelectedProjectId(detail.projectId);
      rememberPreferences({
        selectedProjectId: detail.projectId,
        selectedThreadId: detail.id,
        activeWorkspace: "chat"
      });
      setThreads((current) => upsertThreadSummary(current, threadSummaryFromDetail(detail)));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsBusy(false);
    }
  }

  async function updateThreadSharedContext(
    threadId: string,
    sharedContextEnabled: boolean
  ): Promise<void> {
    setError(undefined);
    try {
      const detail = await agentHubApi.threads.update({
        threadId,
        sharedContextEnabled
      });
      setCurrentThread(detail);
      setSelectedThreadId(detail.id);
      setSelectedProjectId((current) => detail.projectId ?? current);
      rememberPreferences({
        selectedThreadId: detail.id,
        selectedProjectId: detail.projectId
      });
      setThreads((current) => upsertThreadSummary(current, threadSummaryFromDetail(detail)));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function selectProject(projectId: string): Promise<void> {
    setError(undefined);
    setSelectedProjectId(projectId);
    setPendingContinueFrom(undefined);
    rememberPreferences({ selectedProjectId: projectId });
    try {
      const threadList = await agentHubApi.threads.list();
      setThreads(threadList);
      const room = selectPreferredThreadForProject(threadList, projectId);
      if (room) {
        const detail = await agentHubApi.threads.get(room.id);
        setCurrentThread(detail);
        setSelectedThreadId(detail.id);
        rememberPreferences({
          selectedProjectId: detail.projectId,
          selectedThreadId: detail.id,
          activeWorkspace: "chat"
        });
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
    contextMode: ContextMode,
    workflow?: CollaborationWorkflowInput
  ): Promise<void> {
    setError(undefined);
    setIsBusy(true);
    try {
      const detail = await agentHubApi.threads.sendMessage({
        threadId: selectedThreadId,
        projectId: activeProjectId ?? projects[0]?.id,
        text: input,
        contextMode,
        workflow,
        continueFromRunId: pendingContinueFrom?.parentRunId,
        continueFromMessageId: pendingContinueFrom?.parentMessageId
      });
      setCurrentThread(detail);
      setSelectedThreadId(detail.id);
      setSelectedProjectId((current) => detail.projectId ?? current);
      const mentions = lastUserMentions(detail.messages);
      if (mentions) {
        setLastUsedAgents(mentions);
        rememberPreferences({ lastUsedAgents: mentions });
      }
      const roleMentions = lastUserRoleMentions(detail.messages);
      if (roleMentions) {
        setLastUsedRoleHandles(roleMentions);
        rememberPreferences({ lastUsedRoleHandles: roleMentions });
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

  function switchWorkspace(workspace: DesktopWorkspace): void {
    setActiveWorkspace(workspace);
    rememberPreferences({ activeWorkspace: workspace });
  }

  function openInspector(runId: string, tab?: RunInspectorTab): void {
    const nextTab = tab ?? preferences.inspectorTab;
    setSelectedInspector({ runId, tab: nextTab });
    rememberPreferences({ inspectorTab: nextTab });
  }

  function updateContextMode(contextMode: ContextMode): void {
    rememberPreferences({ contextMode });
  }

  function toggleSidebarDensity(): void {
    const next = sidebarDensity === "compact" ? "comfortable" : "compact";
    setSidebarDensity(next);
    rememberPreferences({ sidebarDensity: next });
  }

  const commandActions = useMemo<CommandPaletteAction[]>(
    () => [
      {
        id: "new-room",
        label: "New Room",
        detail: activeProjectId
          ? "Create a local project room"
          : "Register a project before creating rooms",
        shortcut: "N",
        disabled: !activeProjectId,
        run: () => {
          void createNewThread();
        }
      },
      {
        id: "knowledge",
        label: "Open Knowledge",
        detail: "Browse memory and review evidence",
        shortcut: "K",
        disabled: !activeProjectId,
        run: () => switchWorkspace("knowledge")
      },
      {
        id: "team",
        label: "Open Team",
        detail: "Configure local roles",
        shortcut: "T",
        disabled: !activeProjectId,
        run: () => switchWorkspace("team")
      },
      {
        id: "settings",
        label: "Open Verification Settings",
        detail: "Edit project verification commands",
        shortcut: ",",
        run: () => setSettingsOpen(true)
      },
      {
        id: "density",
        label: "Toggle Sidebar Density",
        detail: `Currently ${sidebarDensity}`,
        run: toggleSidebarDensity
      }
    ],
    [activeProjectId, sidebarDensity]
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen(true);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="app-shell">
      <Sidebar
        projects={projects}
        threads={threads}
        selectedThreadId={selectedThreadId}
        selectedProjectId={selectedProject?.id ?? selectedProjectId}
        activeWorkspace={activeWorkspace}
        sidebarDensity={sidebarDensity}
        onNewThread={(input) => createNewThread(input)}
        onSelectThread={(threadId) => {
          switchWorkspace("chat");
          void loadThread(threadId);
        }}
        onSelectProject={(projectId) => void selectProject(projectId)}
        onRegisterProject={registerProject}
        onOpenKnowledge={() => switchWorkspace("knowledge")}
        onOpenTeam={() => switchWorkspace("team")}
        onOpenSettings={() => setSettingsOpen(true)}
        onToggleSidebarDensity={toggleSidebarDensity}
        isBusy={isBusy}
      />
      <main className="center-pane">
        {activeWorkspace === "knowledge" ? (
          <KnowledgeWorkspace
            project={selectedProject}
            onOpenThread={(threadId) => {
              switchWorkspace("chat");
              void loadThread(threadId);
            }}
            onOpenInspector={openInspector}
          />
        ) : activeWorkspace === "team" ? (
          <TeamWorkspace project={selectedProject} />
        ) : (
          <ChatView
            thread={currentThread}
            project={selectedProject}
            messages={selectedMessages}
            runDetails={runDetails}
            isBusy={isBusy}
            lastUsedAgents={lastUsedAgents}
            lastUsedRoleHandles={lastUsedRoleHandles}
            initialContextMode={preferences.contextMode}
            pendingContinueFrom={pendingContinueFrom}
            error={error}
            onSubmit={submitMessage}
            onContextModeChange={updateContextMode}
            onContinueFromRun={(target) => setPendingContinueFrom(target)}
            onClearContinueFrom={() => setPendingContinueFrom(undefined)}
            onRunUpdated={handleRunUpdated}
            onOpenInspector={openInspector}
            onCancelRun={cancelRun}
            onSetSharedContext={(enabled) => {
              if (currentThread) {
                void updateThreadSharedContext(currentThread.id, enabled);
              }
            }}
            onRegisterProject={registerProject}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        )}
      </main>
      {selectedInspector ? (
        <RunInspectorModal
          runId={selectedInspector.runId}
          initialRun={runDetails[selectedInspector.runId]}
          initialTab={selectedInspector.tab}
          onClose={() => setSelectedInspector(undefined)}
        />
      ) : null}
      {commandPaletteOpen ? (
        <CommandPalette
          actions={commandActions}
          onClose={() => setCommandPaletteOpen(false)}
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

function lastUserRoleMentions(messages: ThreadMessage[]): string[] | undefined {
  const userMessage = [...messages]
    .reverse()
    .find((message) => message.type === "user");
  if (userMessage?.type !== "user" || !userMessage.roleMentions?.length) {
    return undefined;
  }
  const handles = userMessage.roleMentions
    .map((role) => role.roleHandle)
    .filter((handle, index, all) => all.indexOf(handle) === index);
  return handles.length > 0 ? handles : undefined;
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
    sharedContextEnabled: thread.sharedContextEnabled,
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
