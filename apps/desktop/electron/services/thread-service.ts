import type {
  AgentId,
  AgentRunMessage,
  ContextMode,
  CreateThreadInput,
  RunStatus,
  RunSummary,
  SendThreadMessageInput,
  SystemMessage,
  ThreadDetail,
  ThreadMessage,
  ThreadSummary,
  UserMessage
} from "../../src/lib/types";
import { parseAgentMentions } from "../../src/lib/mentions";
import type { ProjectService } from "./project-service";
import type { RunService } from "./run-service";

export interface ThreadService {
  listThreads(): Promise<ThreadSummary[]>;
  getThread(threadId: string): Promise<ThreadDetail>;
  createThread(input?: CreateThreadInput): Promise<ThreadSummary>;
  appendUserMessage(
    threadId: string,
    text: string,
    mentions: AgentId[]
  ): Promise<UserMessage>;
  appendAgentRunMessage(
    threadId: string,
    runId: string,
    agentId: AgentId
  ): Promise<AgentRunMessage>;
  appendSystemMessage(threadId: string, text: string): Promise<SystemMessage>;
  sendMessage(input: SendThreadMessageInput): Promise<ThreadDetail>;
}

export interface ThreadServiceDependencies {
  projects: ProjectService;
  runs: RunService;
}

export function createThreadService(
  dependencies: ThreadServiceDependencies
): ThreadService {
  return new InMemoryThreadService(dependencies);
}

class InMemoryThreadService implements ThreadService {
  // TODO: replace this in-memory store with SQLite-backed thread/message tables.
  private readonly threads = new Map<string, ThreadDetail>();
  private seededFromRuns = false;

  constructor(private readonly dependencies: ThreadServiceDependencies) {}

  async listThreads(): Promise<ThreadSummary[]> {
    await this.ensureSeededFromRuns();
    await this.refreshRunStatuses();
    return [...this.threads.values()]
      .map(toThreadSummary)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getThread(threadId: string): Promise<ThreadDetail> {
    await this.ensureSeededFromRuns();
    await this.refreshRunStatuses();
    const thread = this.threads.get(threadId);
    if (!thread) {
      throw new Error(`thread ${threadId} not found`);
    }
    return cloneThread(thread);
  }

  async createThread(input: CreateThreadInput = {}): Promise<ThreadSummary> {
    const now = new Date().toISOString();
    const thread: ThreadDetail = {
      id: nextId("thread"),
      title: titleFromPrompt(input.title ?? "") || "New Chat",
      projectId: input.projectId,
      createdAt: now,
      updatedAt: now,
      messages: []
    };
    this.threads.set(thread.id, thread);
    return toThreadSummary(thread);
  }

  async appendUserMessage(
    threadId: string,
    text: string,
    mentions: AgentId[]
  ): Promise<UserMessage> {
    const thread = await this.requireThread(threadId);
    const now = new Date().toISOString();
    const message: UserMessage = {
      id: nextId("message"),
      threadId,
      type: "user",
      text,
      mentions,
      createdAt: now
    };
    thread.messages.push(message);
    if (thread.title === "New Chat") {
      thread.title = titleFromPrompt(text) || thread.title;
    }
    thread.updatedAt = now;
    return { ...message, mentions: [...message.mentions] };
  }

  async appendAgentRunMessage(
    threadId: string,
    runId: string,
    agentId: AgentId
  ): Promise<AgentRunMessage> {
    const thread = await this.requireThread(threadId);
    const run = await this.dependencies.runs.getRun(runId);
    const now = new Date().toISOString();
    const message: AgentRunMessage = {
      id: nextId("message"),
      threadId,
      type: "agent_run",
      runId,
      agentId,
      status: run.status,
      createdAt: now
    };
    thread.messages.push(message);
    thread.updatedAt = now;
    return { ...message };
  }

  async appendSystemMessage(threadId: string, text: string): Promise<SystemMessage> {
    const thread = await this.requireThread(threadId);
    const now = new Date().toISOString();
    const message: SystemMessage = {
      id: nextId("message"),
      threadId,
      type: "system",
      text,
      createdAt: now
    };
    thread.messages.push(message);
    thread.updatedAt = now;
    return { ...message };
  }

  async sendMessage(input: SendThreadMessageInput): Promise<ThreadDetail> {
    const parsed = parseAgentMentions(input.text);
    const cleanedPrompt = parsed.cleanedPrompt.trim();
    if (!cleanedPrompt) {
      throw new Error("message text is required");
    }
    const agents: AgentId[] =
      input.agents && input.agents.length > 0
        ? uniqueAgents(input.agents.map(parseAgentId))
        : parsed.agents.length > 0
          ? parsed.agents
          : ["fake"];
    const contextMode = parseContextMode(input.contextMode ?? "auto");
    const thread = input.threadId
      ? await this.requireThread(input.threadId)
      : await this.createThreadDetail({
          projectId: input.projectId,
          title: titleFromPrompt(cleanedPrompt)
        });

    thread.projectId =
      thread.projectId ?? input.projectId ?? (await this.defaultProjectId());
    if (!thread.projectId) {
      throw new Error("projectId is required before sending a message");
    }

    await this.appendUserMessage(thread.id, cleanedPrompt, agents);

    for (const agentId of agents) {
      try {
        const run = await this.dependencies.runs.createRun({
          projectId: thread.projectId,
          prompt: cleanedPrompt,
          title: titleFromPrompt(cleanedPrompt),
          agentId,
          contextMode,
          deliveryMode: "runtime_injection"
        });
        await this.appendAgentRunMessage(thread.id, run.id, agentId);
      } catch (error) {
        await this.appendSystemMessage(
          thread.id,
          `@${agentId} could not start: ${errorMessage(error)}`
        );
      }
    }

    return this.getThread(thread.id);
  }

  private async requireThread(threadId: string): Promise<ThreadDetail> {
    await this.ensureSeededFromRuns();
    const thread = this.threads.get(threadId);
    if (!thread) {
      throw new Error(`thread ${threadId} not found`);
    }
    return thread;
  }

  private async createThreadDetail(input: CreateThreadInput): Promise<ThreadDetail> {
    const summary = await this.createThread(input);
    const thread = this.threads.get(summary.id);
    if (!thread) {
      throw new Error(`thread ${summary.id} not found`);
    }
    return thread;
  }

  private async defaultProjectId(): Promise<string | undefined> {
    return (await this.dependencies.projects.list())[0]?.id;
  }

  private async ensureSeededFromRuns(): Promise<void> {
    if (this.seededFromRuns || this.threads.size > 0) {
      this.seededFromRuns = true;
      return;
    }
    this.seededFromRuns = true;
    const runs = await this.dependencies.runs.listRuns();
    const grouped = new Map<string, RunSummary[]>();
    runs.forEach((run) => {
      grouped.set(run.taskId, [...(grouped.get(run.taskId) ?? []), run]);
    });

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
      const messages: ThreadMessage[] = [
        {
          id: `message-${taskId}-user`,
          threadId,
          type: "user",
          text: first.taskPrompt,
          mentions: uniqueAgents(sorted.map((run) => run.agentId)),
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
      this.threads.set(threadId, {
        id: threadId,
        title: first.title,
        projectId: first.projectId,
        createdAt: first.createdAt,
        updatedAt: latest.updatedAt,
        messages
      });
    });
  }

  private async refreshRunStatuses(): Promise<void> {
    const runs = await this.dependencies.runs.listRuns();
    const statusByRunId = new Map(runs.map((run) => [run.id, run.status]));
    this.threads.forEach((thread) => {
      thread.messages = thread.messages.map((message) =>
        message.type === "agent_run"
          ? {
              ...message,
              status: statusByRunId.get(message.runId) ?? message.status
            }
          : message
      );
    });
  }
}

function toThreadSummary(thread: ThreadDetail): ThreadSummary {
  const runMessages = thread.messages.filter(
    (message): message is AgentRunMessage => message.type === "agent_run"
  );
  const lastMessage = thread.messages.at(-1);
  return {
    id: thread.id,
    title: thread.title,
    projectId: thread.projectId,
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

function cloneThread(thread: ThreadDetail): ThreadDetail {
  return {
    ...thread,
    messages: thread.messages.map((message) =>
      message.type === "user"
        ? { ...message, mentions: [...message.mentions] }
        : { ...message }
    )
  };
}

function threadMessagePreview(message: ThreadMessage): string {
  if (message.type === "user") {
    return message.text;
  }
  if (message.type === "agent_run") {
    return `@${message.agentId} ${message.status}`;
  }
  return message.text;
}

function parseAgentId(value: unknown): AgentId {
  if (value === "fake" || value === "codex" || value === "claude") {
    return value;
  }
  throw new Error("agent must be fake, codex, or claude");
}

function parseContextMode(value: unknown): ContextMode {
  if (
    value === "auto" ||
    value === "minimal" ||
    value === "full" ||
    value === "workspace"
  ) {
    return value;
  }
  throw new Error("contextMode must be auto, minimal, full, or workspace");
}

function uniqueAgents(agents: AgentId[]): AgentId[] {
  return agents.filter((agent, index) => agents.indexOf(agent) === index);
}

function isActiveRunStatus(status: RunStatus): boolean {
  return status === "queued" || status === "running" || status === "verifying";
}

function titleFromPrompt(prompt: string): string {
  const firstLine = prompt.trim().split(/\r?\n/, 1)[0] ?? "";
  if (!firstLine) {
    return "New Chat";
  }
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}...` : firstLine;
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
