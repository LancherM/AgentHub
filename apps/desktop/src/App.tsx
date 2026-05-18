import { useCallback, useEffect, useMemo, useState } from "react";
import { ChatView } from "./components/chat/ChatView";
import { RunInspectorModal } from "./components/inspector/RunInspectorModal";
import { Sidebar } from "./components/sidebar/Sidebar";
import { agentHubApi } from "./lib/agentHubApi";
import { resolveMentionedAgents } from "./lib/mentions";
import type {
  AgentId,
  AgentRunMessage,
  ContextMode,
  ProjectSummary,
  RunDetail,
  RunSummary,
  ThreadMessage,
  ThreadSummary,
  UserMessage
} from "./lib/types";

export function App(): JSX.Element {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [messagesByThread, setMessagesByThread] = useState<
    Record<string, ThreadMessage[]>
  >({});
  const [runDetails, setRunDetails] = useState<Record<string, RunDetail>>({});
  const [selectedThreadId, setSelectedThreadId] = useState<string | undefined>();
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>();
  const [selectedInspectorRunId, setSelectedInspectorRunId] = useState<
    string | undefined
  >();
  const [lastUsedAgents, setLastUsedAgents] = useState<AgentId[]>(["fake"]);
  const [isBusy, setIsBusy] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId),
    [selectedThreadId, threads]
  );
  const activeProjectId = selectedThread?.projectId ?? selectedProjectId;
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId),
    [activeProjectId, projects]
  );
  const selectedMessages = selectedThreadId
    ? messagesByThread[selectedThreadId] ?? []
    : [];
  const sidebarThreads = useMemo(
    () =>
      threads.map((thread) =>
        withThreadMessageMetrics(thread, messagesByThread[thread.id] ?? [])
      ),
    [messagesByThread, threads]
  );

  useEffect(() => {
    void refreshShell();
  }, []);

  const handleRunUpdated = useCallback((detail: RunDetail): void => {
    setRunDetails((current) => ({ ...current, [detail.id]: detail }));
    setRuns((current) => upsertRunSummary(current, detail));
    setMessagesByThread((current) => updateAgentRunStatus(current, detail));
  }, []);

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
      const [projectList, runList] = await Promise.all([
        agentHubApi.projects.list(),
        agentHubApi.runs.list()
      ]);
      setProjects(projectList);
      setRuns(runList);
      const seeded = seedThreadsFromRuns(runList);
      if (seeded.threads.length > 0) {
        setThreads(seeded.threads);
        setMessagesByThread(seeded.messagesByThread);
        setSelectedThreadId((current) => current ?? seeded.threads[0]?.id);
        setSelectedProjectId(
          (current) => current ?? seeded.threads[0]?.projectId ?? projectList[0]?.id
        );
      } else if (projectList[0]) {
        const thread = createThread(projectList[0].id, "New conversation");
        setThreads([thread]);
        setMessagesByThread({ [thread.id]: [] });
        setSelectedThreadId(thread.id);
        setSelectedProjectId(projectList[0].id);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsBusy(false);
    }
  }

  function createNewThread(): void {
    setError(undefined);
    const projectId = selectedProjectId ?? projects[0]?.id;
    if (!projectId) {
      setError("Register a local project before starting a chat.");
      return;
    }
    const thread = createThread(projectId, "New conversation");
    setThreads((current) => [thread, ...current]);
    setMessagesByThread((current) => ({ ...current, [thread.id]: [] }));
    setSelectedThreadId(thread.id);
    setSelectedProjectId(projectId);
  }

  async function submitMessage(
    input: string,
    contextMode: ContextMode
  ): Promise<void> {
    setError(undefined);
    const thread = ensureThread();
    if (!thread) {
      setError("Register a local project before running agents.");
      return;
    }

    const parsed = resolveMentionedAgents(input, lastUsedAgents);
    if (!parsed.taskText) {
      setError("Add a task after the agent mention.");
      return;
    }

    const now = new Date().toISOString();
    const userMessage: UserMessage = {
      id: nextId("message"),
      threadId: thread.id,
      type: "user",
      text: parsed.taskText,
      mentions: parsed.agents,
      createdAt: now
    };
    setLastUsedAgents(parsed.agents);
    appendThreadMessages(thread.id, [userMessage]);
    promoteThread(thread.id, {
      title:
        thread.title === "New conversation"
          ? titleFromPrompt(parsed.taskText)
          : thread.title,
      lastMessage: parsed.taskText,
      updatedAt: now
    });

    setIsBusy(true);
    const results = await Promise.allSettled(
      parsed.agents.map((agentId) =>
        agentHubApi.runs.create({
          projectId: thread.projectId,
          prompt: parsed.taskText,
          title: titleFromPrompt(parsed.taskText),
          agentId,
          contextMode
        })
      )
    );

    const runMessages: ThreadMessage[] = [];
    results.forEach((result, index) => {
      const agentId = parsed.agents[index] ?? "fake";
      if (result.status === "fulfilled") {
        const summary = result.value;
        setRuns((current) => upsertRunSummary(current, summary));
        runMessages.push({
          id: nextId("message"),
          threadId: thread.id,
          type: "agent_run",
          runId: summary.id,
          agentId,
          status: summary.status,
          createdAt: summary.createdAt
        });
      } else {
        runMessages.push({
          id: nextId("message"),
          threadId: thread.id,
          type: "system",
          text: `@${agentId} could not start: ${errorMessage(result.reason)}`,
          createdAt: new Date().toISOString()
        });
      }
    });

    if (runMessages.length > 0) {
      appendThreadMessages(thread.id, runMessages);
      promoteThread(thread.id, {
        lastMessage: `${parsed.agents.map((agent) => `@${agent}`).join(", ")} started`,
        updatedAt: new Date().toISOString(),
        runCountDelta: runMessages.filter((message) => message.type === "agent_run")
          .length,
        activeRunCountDelta: runMessages.filter(
          (message): message is AgentRunMessage =>
            message.type === "agent_run" && isActiveRunStatus(message.status)
        ).length
      });
    }
    setIsBusy(false);
  }

  function ensureThread(): ThreadSummary | undefined {
    if (selectedThread) {
      return selectedThread;
    }
    const projectId = selectedProjectId ?? projects[0]?.id;
    if (!projectId) {
      return undefined;
    }
    const thread = createThread(projectId, "New conversation");
    setThreads((current) => [thread, ...current]);
    setMessagesByThread((current) => ({ ...current, [thread.id]: [] }));
    setSelectedThreadId(thread.id);
    setSelectedProjectId(projectId);
    return thread;
  }

  function appendThreadMessages(threadId: string, messages: ThreadMessage[]): void {
    setMessagesByThread((current) => ({
      ...current,
      [threadId]: [...(current[threadId] ?? []), ...messages]
    }));
  }

  function promoteThread(
    threadId: string,
    update: Partial<ThreadSummary> & {
      runCountDelta?: number;
      activeRunCountDelta?: number;
    }
  ): void {
    const { runCountDelta = 0, activeRunCountDelta = 0, ...summaryUpdate } = update;
    setThreads((current) =>
      current
        .map((thread) =>
          thread.id === threadId
            ? {
                ...thread,
                ...summaryUpdate,
                runCount: thread.runCount + runCountDelta,
                activeRunCount: thread.activeRunCount + activeRunCountDelta
              }
            : thread
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    );
  }

  return (
    <div className="app-shell">
      <Sidebar
        projects={projects}
        threads={sidebarThreads}
        selectedThreadId={selectedThreadId}
        selectedProjectId={selectedProject?.id ?? selectedProjectId}
        onNewThread={createNewThread}
        onSelectThread={setSelectedThreadId}
        onSelectProject={setSelectedProjectId}
      />
      <main className="center-pane">
        <ChatView
          thread={selectedThread}
          project={selectedProject}
          messages={selectedMessages}
          runDetails={runDetails}
          isBusy={isBusy}
          lastUsedAgents={lastUsedAgents}
          error={error}
          onSubmit={submitMessage}
          onRunUpdated={handleRunUpdated}
          onOpenInspector={setSelectedInspectorRunId}
          onCancelRun={cancelRun}
        />
      </main>
      {selectedInspectorRunId ? (
        <RunInspectorModal
          runId={selectedInspectorRunId}
          initialRun={runDetails[selectedInspectorRunId]}
          onClose={() => setSelectedInspectorRunId(undefined)}
        />
      ) : null}
    </div>
  );
}

function seedThreadsFromRuns(runs: RunSummary[]): {
  threads: ThreadSummary[];
  messagesByThread: Record<string, ThreadMessage[]>;
} {
  const grouped = new Map<string, RunSummary[]>();
  runs.forEach((run) => {
    grouped.set(run.taskId, [...(grouped.get(run.taskId) ?? []), run]);
  });

  const threads: ThreadSummary[] = [];
  const messagesByThread: Record<string, ThreadMessage[]> = {};
  grouped.forEach((taskRuns, taskId) => {
    const sorted = [...taskRuns].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt)
    );
    const first = sorted[0];
    const latest = [...sorted].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt)
    )[0];
    if (!first || !latest) {
      return;
    }
    const threadId = `thread-${taskId}`;
    const mentions = uniqueAgents(sorted.map((run) => run.agentId));
    messagesByThread[threadId] = [
      {
        id: `message-${taskId}-user`,
        threadId,
        type: "user",
        text: first.taskPrompt,
        mentions,
        createdAt: first.createdAt
      },
      ...sorted.map<AgentRunMessage>((run) => ({
        id: `message-${run.id}`,
        threadId,
        type: "agent_run",
        runId: run.id,
        agentId: run.agentId,
        status: run.status,
        createdAt: run.createdAt
      }))
    ];
    threads.push({
      id: threadId,
      title: first.title,
      projectId: first.projectId,
      createdAt: first.createdAt,
      updatedAt: latest.updatedAt,
      lastMessage: `@${latest.agentId} ${latest.status}`,
      runCount: sorted.length,
      activeRunCount: sorted.filter((run) => isActiveRunStatus(run.status)).length
    });
  });

  return {
    threads: threads.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    messagesByThread
  };
}

function createThread(projectId: string, title: string): ThreadSummary {
  const now = new Date().toISOString();
  return {
    id: nextId("thread"),
    title,
    projectId,
    createdAt: now,
    updatedAt: now,
    lastMessage: "Ready for a local agent prompt",
    runCount: 0,
    activeRunCount: 0
  };
}

function withThreadMessageMetrics(
  thread: ThreadSummary,
  messages: ThreadMessage[]
): ThreadSummary {
  const runMessages = messages.filter(
    (message): message is AgentRunMessage => message.type === "agent_run"
  );
  const lastMessage = messages.at(-1);
  return {
    ...thread,
    lastMessage: lastMessage ? threadMessageSummary(lastMessage) : thread.lastMessage,
    runCount: runMessages.length,
    activeRunCount: runMessages.filter((message) =>
      isActiveRunStatus(message.status)
    ).length
  };
}

function threadMessageSummary(message: ThreadMessage): string {
  if (message.type === "user") {
    return message.text;
  }
  if (message.type === "agent_run") {
    return `@${message.agentId} ${message.status}`;
  }
  return message.text;
}

function updateAgentRunStatus(
  messagesByThread: Record<string, ThreadMessage[]>,
  detail: RunDetail
): Record<string, ThreadMessage[]> {
  const next: Record<string, ThreadMessage[]> = {};
  Object.entries(messagesByThread).forEach(([threadId, messages]) => {
    next[threadId] = messages.map((message) =>
      message.type === "agent_run" && message.runId === detail.id
        ? { ...message, status: detail.status }
        : message
    );
  });
  return next;
}

function upsertRunSummary(runs: RunSummary[], summary: RunSummary): RunSummary[] {
  const next = [summary, ...runs.filter((run) => run.id !== summary.id)];
  return next.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function uniqueAgents(agents: AgentId[]): AgentId[] {
  return agents.filter((agent, index) => agents.indexOf(agent) === index);
}

function isActiveRunStatus(status: RunSummary["status"]): boolean {
  return status === "queued" || status === "running" || status === "verifying";
}

function titleFromPrompt(prompt: string): string {
  const firstLine = prompt.trim().split(/\r?\n/, 1)[0] ?? "";
  return firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;
}

function nextId(prefix: string): string {
  const crypto = globalThis.crypto;
  if (crypto?.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
