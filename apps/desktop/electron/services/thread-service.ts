import {
  validateConversationMessage,
  validateConversationThread,
  type ConversationMessage,
  type ConversationMessageRepository,
  type ConversationThread,
  type ConversationThreadRepository
} from "@agent-hub/core";
import {
  ConversationContextBuilder,
  type ConversationContextMessage
} from "@agent-hub/context-compiler";
import type { AgentKind, TaskRunStatus } from "@agent-hub/shared";
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
import type {
  DesktopServiceContext,
  ProjectService
} from "./project-service";
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
  context: DesktopServiceContext;
  projects: ProjectService;
  runs: RunService;
  conversationContextBuilder?: ConversationContextBuilder;
}

export function createThreadService(
  dependencies: ThreadServiceDependencies
): ThreadService {
  return new RepositoryThreadService(dependencies);
}

class RepositoryThreadService implements ThreadService {
  private readonly threads: ConversationThreadRepository;
  private readonly messages: ConversationMessageRepository;
  private readonly conversationContextBuilder: ConversationContextBuilder;
  private importedLegacyRuns = false;

  constructor(private readonly dependencies: ThreadServiceDependencies) {
    this.threads = dependencies.context.repositories.conversationThreadRepository;
    this.messages = dependencies.context.repositories.conversationMessageRepository;
    this.conversationContextBuilder =
      dependencies.conversationContextBuilder ?? new ConversationContextBuilder();
  }

  async listThreads(): Promise<ThreadSummary[]> {
    await this.ensureLegacyRunThreads();
    const [threads, runStatusById] = await Promise.all([
      this.threads.list(),
      this.runStatusById()
    ]);
    const summaries = await Promise.all(
      threads.map(async (thread) => {
        const messages = await this.messages.listByThreadId(thread.id);
        return toThreadSummary(toThreadDetail(thread, messages, runStatusById));
      })
    );
    return summaries.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt)
    );
  }

  async getThread(threadId: string): Promise<ThreadDetail> {
    await this.ensureLegacyRunThreads();
    const thread = await this.threads.get(threadId);
    if (!thread) {
      throw new Error(`thread ${threadId} not found`);
    }
    const [messages, runStatusById] = await Promise.all([
      this.messages.listByThreadId(thread.id),
      this.runStatusById(thread.projectId)
    ]);
    return toThreadDetail(thread, messages, runStatusById);
  }

  async createThread(input: CreateThreadInput = {}): Promise<ThreadSummary> {
    const projectId = input.projectId ?? (await this.defaultProjectId());
    if (!projectId) {
      throw new Error("projectId is required before creating a thread");
    }
    const now = this.dependencies.context.now();
    const thread = await this.threads.create(
      validateConversationThread({
        id: this.dependencies.context.nextId("thread"),
        title: titleFromPrompt(input.title ?? "") || "New Chat",
        projectId,
        createdAt: now,
        updatedAt: now
      })
    );
    return toThreadSummary(toThreadDetail(thread, [], new Map()));
  }

  async appendUserMessage(
    threadId: string,
    text: string,
    mentions: AgentId[]
  ): Promise<UserMessage> {
    const thread = await this.requireThread(threadId);
    const now = this.dependencies.context.now();
    const message = await this.messages.create(
      validateConversationMessage({
        id: this.dependencies.context.nextId("message"),
        threadId,
        sequence: await this.messages.countByThreadId(threadId),
        role: "user",
        kind: "text",
        content: text,
        metadata: { mentions: uniqueAgents(mentions) },
        createdAt: now
      })
    );
    await this.touchThread(thread, {
      title:
        thread.title === "New Chat"
          ? titleFromPrompt(text) || thread.title
          : thread.title,
      updatedAt: now
    });
    return toUserMessage(message);
  }

  async appendAgentRunMessage(
    threadId: string,
    runId: string,
    agentId: AgentId
  ): Promise<AgentRunMessage> {
    const thread = await this.requireThread(threadId);
    const run = await this.dependencies.runs.getRun(runId);
    const now = this.dependencies.context.now();
    const message = await this.messages.create(
      validateConversationMessage({
        id: this.dependencies.context.nextId("message"),
        threadId,
        sequence: await this.messages.countByThreadId(threadId),
        role: "tool",
        kind: "run_card",
        content: `@${agentId} ${run.status}`,
        agentKind: toCoreAgentKind(agentId),
        runId,
        status: toCoreRunStatus(run.status),
        metadata: { agentId },
        createdAt: now
      })
    );
    await this.touchThread(thread, { updatedAt: now });
    return toAgentRunMessage(message, new Map([[runId, run.status]]));
  }

  async appendSystemMessage(threadId: string, text: string): Promise<SystemMessage> {
    const thread = await this.requireThread(threadId);
    const now = this.dependencies.context.now();
    const message = await this.messages.create(
      validateConversationMessage({
        id: this.dependencies.context.nextId("message"),
        threadId,
        sequence: await this.messages.countByThreadId(threadId),
        role: "system",
        kind: "text",
        content: text,
        createdAt: now
      })
    );
    await this.touchThread(thread, { updatedAt: now });
    return toSystemMessage(message);
  }

  async sendMessage(input: SendThreadMessageInput): Promise<ThreadDetail> {
    await this.ensureLegacyRunThreads();
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
      : await this.createThreadRecord({
          projectId: input.projectId ?? (await this.defaultProjectId()),
          title: titleFromPrompt(cleanedPrompt)
        });

    const userMessage = await this.appendUserMessage(thread.id, cleanedPrompt, agents);
    const currentThread = await this.requireThread(thread.id);
    const priorMessages = (await this.messages.listByThreadId(currentThread.id))
      .filter((message) => message.id !== userMessage.id);

    for (const agentId of agents) {
      try {
        const conversationBrief = await this.buildConversationBrief({
          thread: currentThread,
          currentTurn: cleanedPrompt,
          currentMessageCreatedAt: userMessage.createdAt,
          agentId,
          contextMode,
          priorMessages
        });
        const run = await this.dependencies.runs.createRun({
          projectId: currentThread.projectId,
          prompt: cleanedPrompt,
          title: titleFromPrompt(cleanedPrompt),
          agentId,
          contextMode,
          deliveryMode: "runtime_injection",
          conversationBrief
        });
        await this.appendAgentRunMessage(currentThread.id, run.id, agentId);
      } catch (error) {
        await this.appendSystemMessage(
          currentThread.id,
          `@${agentId} could not start: ${errorMessage(error)}`
        );
      }
    }

    return this.getThread(currentThread.id);
  }

  private async buildConversationBrief(input: {
    thread: ConversationThread;
    currentTurn: string;
    currentMessageCreatedAt: string;
    agentId: AgentId;
    contextMode: ContextMode;
    priorMessages: ConversationMessage[];
  }) {
    const messages = await Promise.all(
      input.priorMessages.map((message) => this.toConversationContextMessage(message))
    );
    return this.conversationContextBuilder.build({
      thread: {
        id: input.thread.id,
        title: input.thread.title,
        projectId: input.thread.projectId
      },
      currentTurn: {
        content: input.currentTurn,
        agentId: input.agentId,
        contextMode: input.contextMode,
        deliveryMode: "runtime_injection",
        createdAt: input.currentMessageCreatedAt
      },
      messages: messages.filter(
        (message): message is ConversationContextMessage => message !== undefined
      ),
      projectContextReferences: [
        `project:${input.thread.projectId}`,
        "Agent Hub-owned project context store",
        "Approved memory only; thread context is not promoted automatically"
      ]
    });
  }

  private async toConversationContextMessage(
    message: ConversationMessage
  ): Promise<ConversationContextMessage | undefined> {
    if (message.role === "user") {
      return {
        id: message.id,
        role: "user",
        kind: message.kind,
        content: message.content,
        createdAt: message.createdAt,
        metadata: message.metadata
      };
    }
    if (message.kind === "run_card") {
      const agentId = message.agentKind ? toAgentId(message.agentKind) : undefined;
      const runSummary = message.runId
        ? await this.runSummaryForConversation(message.runId)
        : undefined;
      return {
        id: message.id,
        role: "tool",
        kind: "run_summary",
        content: message.content,
        summary: runSummary,
        agentId,
        runId: message.runId,
        status: message.status,
        createdAt: message.createdAt,
        metadata: message.metadata
      };
    }
    if (message.role === "assistant") {
      return {
        id: message.id,
        role: "assistant",
        kind: message.kind,
        content: message.content,
        agentId: message.agentKind ? toAgentId(message.agentKind) : undefined,
        runId: message.runId,
        status: message.status,
        createdAt: message.createdAt,
        metadata: message.metadata
      };
    }
    return {
      id: message.id,
      role: "system",
      kind: message.kind,
      content: message.content,
      createdAt: message.createdAt,
      metadata: message.metadata
    };
  }

  private async runSummaryForConversation(runId: string): Promise<string | undefined> {
    try {
      const run = await this.dependencies.runs.getRun(runId);
      return `@${run.agentId} ${run.status}: ${run.summary}`;
    } catch {
      return undefined;
    }
  }

  private async requireThread(threadId: string): Promise<ConversationThread> {
    await this.ensureLegacyRunThreads();
    const thread = await this.threads.get(threadId);
    if (!thread) {
      throw new Error(`thread ${threadId} not found`);
    }
    return thread;
  }

  private async createThreadRecord(input: {
    projectId?: string;
    title: string;
  }): Promise<ConversationThread> {
    const projectId = input.projectId ?? (await this.defaultProjectId());
    if (!projectId) {
      throw new Error("projectId is required before sending a message");
    }
    const now = this.dependencies.context.now();
    return this.threads.create(
      validateConversationThread({
        id: this.dependencies.context.nextId("thread"),
        projectId,
        title: titleFromPrompt(input.title) || "New Chat",
        createdAt: now,
        updatedAt: now
      })
    );
  }

  private async defaultProjectId(): Promise<string | undefined> {
    return (await this.dependencies.projects.list())[0]?.id;
  }

  private async touchThread(
    thread: ConversationThread,
    updates: { title?: string; updatedAt: string }
  ): Promise<void> {
    await this.threads.update(
      validateConversationThread({
        ...thread,
        title: updates.title ?? thread.title,
        updatedAt: updates.updatedAt
      })
    );
  }

  private async runStatusById(projectId?: string): Promise<Map<string, RunStatus>> {
    const runs = await this.dependencies.runs.listRuns(projectId);
    return new Map(runs.map((run) => [run.id, run.status]));
  }

  private async ensureLegacyRunThreads(): Promise<void> {
    if (this.importedLegacyRuns) {
      return;
    }
    this.importedLegacyRuns = true;
    if ((await this.threads.list()).length > 0) {
      return;
    }

    const runs = await this.dependencies.runs.listRuns();
    const grouped = new Map<string, RunSummary[]>();
    runs.forEach((run) => {
      grouped.set(run.taskId, [...(grouped.get(run.taskId) ?? []), run]);
    });

    for (const [taskId, taskRuns] of grouped) {
      const sorted = [...taskRuns].sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt)
      );
      const first = sorted[0];
      const latest = [...sorted].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt)
      )[0];
      if (!first || !latest) {
        continue;
      }

      const threadId = `thread-${taskId}`;
      const mentions = uniqueAgents(sorted.map((run) => run.agentId));
      await this.threads.create(
        validateConversationThread({
          id: threadId,
          projectId: first.projectId,
          title: first.title,
          metadata: { legacyRunImport: true, taskId },
          createdAt: first.createdAt,
          updatedAt: latest.updatedAt
        })
      );
      await this.messages.createMany([
        validateConversationMessage({
          id: `message-${taskId}-user`,
          threadId,
          sequence: 0,
          role: "user",
          kind: "text",
          content: first.taskPrompt || first.title,
          metadata: { legacyRunImport: true, mentions },
          createdAt: first.createdAt
        }),
        ...sorted.map((run, index) =>
          validateConversationMessage({
            id: `message-${run.id}`,
            threadId,
            sequence: index + 1,
            role: "tool",
            kind: "run_card",
            content: `@${run.agentId} ${run.status}`,
            agentKind: toCoreAgentKind(run.agentId),
            runId: run.id,
            status: toCoreRunStatus(run.status),
            metadata: {
              legacyRunImport: true,
              agentId: run.agentId
            },
            createdAt: run.createdAt
          })
        )
      ]);
    }
  }
}

function toThreadDetail(
  thread: ConversationThread,
  messages: ConversationMessage[],
  runStatusById: Map<string, RunStatus>
): ThreadDetail {
  const threadMessages = messages.map((message) =>
    toThreadMessage(message, runStatusById)
  );
  return {
    id: thread.id,
    title: thread.title,
    projectId: thread.projectId,
    createdAt: thread.createdAt,
    updatedAt: latestUpdatedAt(thread, messages),
    messages: threadMessages
  };
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

function toThreadMessage(
  message: ConversationMessage,
  runStatusById: Map<string, RunStatus>
): ThreadMessage {
  if (message.kind === "run_card") {
    return toAgentRunMessage(message, runStatusById);
  }
  if (message.role === "user") {
    return toUserMessage(message);
  }
  return toSystemMessage(message);
}

function toUserMessage(message: ConversationMessage): UserMessage {
  return {
    id: message.id,
    threadId: message.threadId,
    type: "user",
    text: message.content,
    mentions: metadataAgents(message.metadata),
    createdAt: message.createdAt
  };
}

function toAgentRunMessage(
  message: ConversationMessage,
  runStatusById: Map<string, RunStatus>
): AgentRunMessage {
  if (!message.runId || !message.agentKind) {
    throw new Error(`run-card message ${message.id} is missing run metadata`);
  }
  return {
    id: message.id,
    threadId: message.threadId,
    type: "agent_run",
    runId: message.runId,
    agentId: toAgentId(message.agentKind),
    status:
      runStatusById.get(message.runId) ??
      toDesktopRunStatus(message.status ?? "queued"),
    createdAt: message.createdAt
  };
}

function toSystemMessage(message: ConversationMessage): SystemMessage {
  return {
    id: message.id,
    threadId: message.threadId,
    type: "system",
    text: message.content,
    createdAt: message.createdAt
  };
}

function latestUpdatedAt(
  thread: ConversationThread,
  messages: ConversationMessage[]
): string {
  return [thread.updatedAt, ...messages.map((message) => message.createdAt)].sort(
    (left, right) => right.localeCompare(left)
  )[0];
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

function metadataAgents(metadata: ConversationMessage["metadata"]): AgentId[] {
  const mentions = metadata?.mentions;
  if (!Array.isArray(mentions)) {
    return [];
  }
  return uniqueAgents(
    mentions.filter((mention): mention is AgentId => isAgentId(mention))
  );
}

function isAgentId(value: unknown): value is AgentId {
  return value === "fake" || value === "codex" || value === "claude";
}

function parseAgentId(value: unknown): AgentId {
  if (isAgentId(value)) {
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

function toCoreAgentKind(agentId: AgentId): AgentKind {
  return agentId === "claude" ? "claude-code" : agentId;
}

function toAgentId(agentKind: AgentKind): AgentId {
  return agentKind === "claude-code" ? "claude" : agentKind;
}

function toCoreRunStatus(status: RunStatus): TaskRunStatus {
  if (status === "completed") {
    return "succeeded";
  }
  if (status === "verifying") {
    return "running";
  }
  return status;
}

function toDesktopRunStatus(status: TaskRunStatus): RunStatus {
  if (status === "succeeded") {
    return "completed";
  }
  return status;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
