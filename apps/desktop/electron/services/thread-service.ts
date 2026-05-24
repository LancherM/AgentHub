import {
  extractAgentFacingOutput,
  validateConversationMessage,
  validateConversationThread,
  validateConversationThreadSummary,
  type ConversationMessage,
  type ConversationMessageRepository,
  type ConversationThread,
  type ConversationThreadRepository,
  type ConversationThreadSummary,
  type ConversationThreadSummaryRepository
} from "@agent-hub/core";
import {
  ConversationContextBuilder,
  ConversationThreadSummaryBuilder,
  type ConversationContextMessage
} from "@agent-hub/context-compiler";
import type { AgentKind, TaskRunStatus, WorkgroupRoleRunMetadata } from "@agent-hub/shared";
import type {
  AgentId,
  AssistantMessage,
  AgentRunMessage,
  ContextMode,
  CreateThreadInput,
  RunEvent,
  RunStatus,
  RunSummary,
  SendThreadMessageInput,
  SystemMessage,
  ThreadDetail,
  ThreadMessage,
  ThreadSummary,
  UserMessage
} from "../../src/lib/types";
import {
  parseWorkgroupMentions,
  type WorkgroupMentionParticipant
} from "../../src/lib/mentions";
import type {
  DesktopServiceContext,
  ProjectService
} from "./project-service";
import type { ConversationRunSnapshot, RunService } from "./run-service";

const maxAssistantMessageCharacters = 2_000;

export interface ThreadService {
  listThreads(): Promise<ThreadSummary[]>;
  getThread(threadId: string): Promise<ThreadDetail>;
  createThread(input?: CreateThreadInput): Promise<ThreadSummary>;
  appendUserMessage(
    threadId: string,
    text: string,
    mentions: AgentId[],
    roleMentions?: WorkgroupRoleRunMetadata[]
  ): Promise<UserMessage>;
  appendAgentRunMessage(
    threadId: string,
    runId: string,
    agentId: AgentId,
    role?: WorkgroupRoleRunMetadata
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
  private readonly summaries: ConversationThreadSummaryRepository;
  private readonly conversationContextBuilder: ConversationContextBuilder;
  private readonly conversationThreadSummaryBuilder = new ConversationThreadSummaryBuilder();
  private importedLegacyRuns = false;

  constructor(private readonly dependencies: ThreadServiceDependencies) {
    this.threads = dependencies.context.repositories.conversationThreadRepository;
    this.messages = dependencies.context.repositories.conversationMessageRepository;
    this.summaries =
      dependencies.context.repositories.conversationThreadSummaryRepository;
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
    await this.reconcileAssistantMessages(thread.id);
    await this.refreshThreadSummary(thread.id);
    const refreshedThread = (await this.threads.get(thread.id)) ?? thread;
    const [messages, runStatusById] = await Promise.all([
      this.messages.listByThreadId(thread.id),
      this.runStatusById(thread.projectId)
    ]);
    return toThreadDetail(refreshedThread, messages, runStatusById);
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
    mentions: AgentId[],
    roleMentions: WorkgroupRoleRunMetadata[] = []
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
        metadata: {
          mentions: uniqueAgents(mentions),
          roleMentions: roleMentions.length > 0 ? roleMentions : undefined
        },
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
    agentId: AgentId,
    role?: WorkgroupRoleRunMetadata
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
        metadata: {
          agentId,
          role,
          executor: role
            ? {
                kind: role.executorKind,
                adapterKind: role.adapterKind
              }
            : undefined
        },
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
    const parsed = parseWorkgroupMentions(input.text);
    const cleanedPrompt = parsed.cleanedPrompt.trim();
    if (!cleanedPrompt) {
      throw new Error("message text is required");
    }
    const participants: WorkgroupMentionParticipant[] =
      input.agents && input.agents.length > 0
        ? uniqueAgents(input.agents.map(parseAgentId)).map((agentId) => ({
            agentId,
            source: "adapter_mention" as const
          }))
        : parsed.participants.length > 0
          ? parsed.participants
          : [{ agentId: "fake", source: "adapter_mention" }];
    const agents = uniqueAgents(participants.map((participant) => participant.agentId));
    const contextMode = parseContextMode(input.contextMode ?? "auto");
    const thread = input.threadId
      ? await this.requireThread(input.threadId)
      : await this.createThreadRecord({
          projectId: input.projectId ?? (await this.defaultProjectId()),
          title: titleFromPrompt(cleanedPrompt)
        });
    await this.reconcileAssistantMessages(thread.id);
    await this.refreshThreadSummary(thread.id);

    const continueFrom = await this.resolveContinuationInput(input);
    const userMessage = await this.appendUserMessage(
      thread.id,
      cleanedPrompt,
      agents,
      parsed.roleMentions
    );
    const currentThread = await this.requireThread(thread.id);
    const priorMessages = (await this.messages.listByThreadId(currentThread.id))
      .filter((message) => message.id !== userMessage.id);

    for (const participant of participants) {
      try {
        const conversationBrief = await this.buildConversationBrief({
          thread: currentThread,
          currentTurn: cleanedPrompt,
          currentMessageCreatedAt: userMessage.createdAt,
          agentId: participant.agentId,
          role: participant.role,
          contextMode,
          priorMessages
        });
        const run = await this.dependencies.runs.createRun({
          projectId: currentThread.projectId,
          prompt: cleanedPrompt,
          title: titleFromPrompt(cleanedPrompt),
          agentId: participant.agentId,
          role: participant.role,
          contextMode,
          deliveryMode: "runtime_injection",
          conversationBrief,
          continueFromRunId: continueFrom?.parentRunId,
          continueFromMessageId: continueFrom?.parentMessageId
        });
        await this.appendAgentRunMessage(
          currentThread.id,
          run.id,
          participant.agentId,
          participant.role
        );
        await this.appendAssistantOutputPlaceholder(
          currentThread.id,
          run.id,
          participant.agentId,
          participant.role
        );
      } catch (error) {
        await this.appendSystemMessage(
          currentThread.id,
          `@${participant.role?.roleHandle ?? participant.agentId} could not start: ${errorMessage(error)}`
        );
      }
    }

    return this.getThread(currentThread.id);
  }

  private async resolveContinuationInput(
    input: SendThreadMessageInput
  ): Promise<{ parentRunId: string; parentMessageId?: string } | undefined> {
    if (input.continueFromRunId) {
      if (!input.continueFromMessageId) {
        return { parentRunId: input.continueFromRunId };
      }
      const message = await this.messages.get(input.continueFromMessageId);
      if (!message) {
        throw new Error(`message ${input.continueFromMessageId} not found`);
      }
      if (message.runId !== input.continueFromRunId) {
        throw new Error(
          `message ${message.id} is not linked to run ${input.continueFromRunId}`
        );
      }
      return { parentRunId: input.continueFromRunId, parentMessageId: message.id };
    }
    if (!input.continueFromMessageId) {
      return undefined;
    }
    const message = await this.messages.get(input.continueFromMessageId);
    if (!message) {
      throw new Error(`message ${input.continueFromMessageId} not found`);
    }
    if (!message.runId) {
      throw new Error(`message ${message.id} is not linked to a run`);
    }
    return { parentRunId: message.runId, parentMessageId: message.id };
  }

  private async buildConversationBrief(input: {
    thread: ConversationThread;
    currentTurn: string;
    currentMessageCreatedAt: string;
    agentId: AgentId;
    role?: WorkgroupRoleRunMetadata;
    contextMode: ContextMode;
    priorMessages: ConversationMessage[];
  }) {
    const assistantRunIds = new Set(
      input.priorMessages
        .filter((message) => isAssistantContextMessage(message) && message.runId)
        .map((message) => message.runId as string)
    );
    const contextSourceMessages = input.priorMessages.filter(
      (message) =>
        !(
          message.kind === "run_card" &&
          message.runId &&
          assistantRunIds.has(message.runId)
        )
    );
    const messages = await Promise.all(
      contextSourceMessages.map((message) => this.toConversationContextMessage(message))
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
      threadSummary: await this.summaries.getByThreadId(input.thread.id),
      projectContextReferences: [
        `project:${input.thread.projectId}`,
        "Agent Hub-owned project context store",
        "Approved memory only; thread context is not promoted automatically",
        ...roleContextReferences(input.role)
      ]
    });
  }

  private async toConversationContextMessage(
    message: ConversationMessage
  ): Promise<ConversationContextMessage | undefined> {
    if (isPendingAssistantOutputMessage(message)) {
      return undefined;
    }
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
      const run = await this.dependencies.runs.getConversationRunSnapshot(runId);
      return `@${run.agentId} ${run.status}: ${run.summary}`;
    } catch {
      return undefined;
    }
  }

  private async refreshThreadSummary(
    threadId: string
  ): Promise<ConversationThreadSummary | undefined> {
    const messages = await this.messages.listByThreadId(threadId);
    const summaryMessages = await Promise.all(
      messages
        .filter((message) => message.kind !== "run_card")
        .map((message) => this.toConversationContextMessage(message))
    );
    const built = this.conversationThreadSummaryBuilder.build({
      messages: summaryMessages.filter(
        (message): message is ConversationContextMessage => message !== undefined
      )
    });
    const existing = await this.summaries.getByThreadId(threadId);
    if (built.sourceMessageCount === 0 && !existing) {
      return undefined;
    }
    const now = this.dependencies.context.now();
    return this.summaries.upsert(
      validateConversationThreadSummary({
        id: existing?.id ?? this.dependencies.context.nextId("thread_summary"),
        threadId,
        summary: built.summary,
        decisions: built.decisions,
        openItems: built.openItems,
        constraints: built.constraints,
        lastKnownUserGoal: built.lastKnownUserGoal,
        sourceMessageCount: built.sourceMessageCount,
        sourceLatestMessageId: built.sourceLatestMessageId,
        metadata: built.metadata,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      })
    );
  }

  private async appendAssistantOutputPlaceholder(
    threadId: string,
    runId: string,
    agentId: AgentId,
    role?: WorkgroupRoleRunMetadata
  ): Promise<void> {
    const thread = await this.requireThread(threadId);
    const now = this.dependencies.context.now();
    await this.messages.create(
      validateConversationMessage({
        id: this.dependencies.context.nextId("message"),
        threadId,
        sequence: await this.messages.countByThreadId(threadId),
        role: "assistant",
        kind: "text",
        content: "Assistant output pending.",
        agentKind: toCoreAgentKind(agentId),
        runId,
        status: "queued",
        metadata: {
          agentId,
          role,
          assistantOutput: true,
          pending: true
        },
        createdAt: now
      })
    );
    await this.touchThread(thread, { updatedAt: now });
  }

  private async reconcileAssistantMessages(threadId: string): Promise<void> {
    const thread = await this.threads.get(threadId);
    if (!thread) {
      return;
    }
    const messages = await this.messages.listByThreadId(threadId);
    const pendingAssistantByRunId = new Map(
      messages
        .filter((message) => isPendingAssistantOutputMessage(message) && message.runId)
        .map((message) => [message.runId as string, message])
    );

    for (const assistantMessage of pendingAssistantByRunId.values()) {
      await this.finalizeAssistantMessage(thread, assistantMessage);
    }

    const refreshedMessages = await this.messages.listByThreadId(threadId);
    const refreshedAssistantRunIds = new Set(
      refreshedMessages
        .filter((message) => isAssistantOutputMessage(message) && message.runId)
        .map((message) => message.runId as string)
    );
    for (const message of refreshedMessages) {
      if (
        message.kind !== "run_card" ||
        !message.runId ||
        !message.agentKind ||
        refreshedAssistantRunIds.has(message.runId)
      ) {
        continue;
      }
      const snapshot = await this.conversationRunSnapshot(message.runId);
      if (!snapshot || !isTerminalRunStatus(snapshot.status)) {
        continue;
      }
      const now = this.dependencies.context.now();
      await this.messages.create(
        validateConversationMessage({
          id: this.dependencies.context.nextId("message"),
          threadId,
          sequence: await this.messages.countByThreadId(threadId),
          role: "assistant",
          kind: "text",
          content: terminalAssistantContent(snapshot),
          agentKind: message.agentKind,
          runId: message.runId,
          status: toCoreRunStatus(snapshot.status),
          metadata: {
            agentId: toAgentId(message.agentKind),
            assistantOutput: true,
            pending: false,
            terminalStatus: snapshot.status
          },
          createdAt: now
        })
      );
      await this.touchThread(thread, { updatedAt: now });
      refreshedAssistantRunIds.add(message.runId);
    }
  }

  private async finalizeAssistantMessage(
    thread: ConversationThread,
    message: ConversationMessage
  ): Promise<void> {
    if (!message.runId) {
      return;
    }
    const snapshot = await this.conversationRunSnapshot(message.runId);
    if (!snapshot || !isTerminalRunStatus(snapshot.status)) {
      return;
    }
    const status = toCoreRunStatus(snapshot.status);
    if (
      !isPendingAssistantOutputMessage(message) &&
      message.status === status &&
      message.content.trim().length > 0
    ) {
      return;
    }
    const agentId = message.agentKind ? toAgentId(message.agentKind) : snapshot.agentId;
    await this.messages.update(
      validateConversationMessage({
        ...message,
        content: terminalAssistantContent(snapshot),
        status,
        metadata: {
          ...(message.metadata ?? {}),
          agentId,
          assistantOutput: true,
          pending: false,
          terminalStatus: snapshot.status
        }
      })
    );
    await this.touchThread(thread, { updatedAt: this.dependencies.context.now() });
  }

  private async conversationRunSnapshot(
    runId: string
  ): Promise<ConversationRunSnapshot | undefined> {
    try {
      return await this.dependencies.runs.getConversationRunSnapshot(runId);
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
    return this.dependencies.runs.listRunStatuses(projectId);
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
  const threadMessages = messages
    .map((message) => toThreadMessage(message, runStatusById))
    .filter((message): message is ThreadMessage => message !== undefined);
  return {
    id: thread.id,
    title: thread.title,
    projectId: thread.projectId,
    createdAt: thread.createdAt,
    updatedAt: latestUpdatedAt(thread, messages),
    messages: threadMessages
  };
}

function roleContextReferences(role?: WorkgroupRoleRunMetadata): string[] {
  if (!role) {
    return [];
  }
  return [
    `workgroup_role: @${role.roleHandle} (${role.displayName})`,
    `role_executor: ${role.executorKind}${role.adapterKind ? `/${role.adapterKind}` : ""}`,
    `role_persona: ${role.persona}`,
    `role_instructions: ${role.defaultInstructions}`,
    `role_permissions: ${role.permissions.join(", ") || "none"}`,
    `role_context_policy: ${role.contextPolicy.scope}; approved_memory=${String(
      role.contextPolicy.includeApprovedMemory
    )}; thread_summary=${String(role.contextPolicy.includeThreadSummary)}`,
    `role_approval_policy: ${role.approvalPolicy.summary}`
  ];
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
): ThreadMessage | undefined {
  if (isPendingAssistantOutputMessage(message)) {
    return undefined;
  }
  if (message.kind === "run_card") {
    return toAgentRunMessage(message, runStatusById);
  }
  if (message.role === "user") {
    return toUserMessage(message);
  }
  if (message.role === "assistant") {
    return toAssistantMessage(message);
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
    roleMentions: metadataRoleMentions(message.metadata),
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

function toAssistantMessage(message: ConversationMessage): AssistantMessage {
  return {
    id: message.id,
    threadId: message.threadId,
    type: "assistant",
    text: message.content,
    agentId: message.agentKind ? toAgentId(message.agentKind) : undefined,
    runId: message.runId,
    status: message.status ? toDesktopRunStatus(message.status) : undefined,
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
  if (message.type === "assistant") {
    return message.text;
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

function metadataRoleMentions(
  metadata: ConversationMessage["metadata"]
): WorkgroupRoleRunMetadata[] | undefined {
  const roleMentions = metadata?.roleMentions;
  if (!Array.isArray(roleMentions)) {
    return undefined;
  }
  const parsed = roleMentions.filter(
    (mention): mention is WorkgroupRoleRunMetadata =>
      typeof mention === "object" &&
      mention !== null &&
      typeof (mention as WorkgroupRoleRunMetadata).roleHandle === "string" &&
      typeof (mention as WorkgroupRoleRunMetadata).executorKind === "string"
  );
  return parsed.length > 0 ? parsed : undefined;
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

function isTerminalRunStatus(status: RunStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function isAssistantOutputMessage(message: ConversationMessage): boolean {
  return message.role === "assistant" && message.metadata?.assistantOutput === true;
}

function isPendingAssistantOutputMessage(message: ConversationMessage): boolean {
  return isAssistantOutputMessage(message) && message.metadata?.pending === true;
}

function isAssistantContextMessage(message: ConversationMessage): boolean {
  return message.role === "assistant" && !isPendingAssistantOutputMessage(message);
}

function terminalAssistantContent(run: ConversationRunSnapshot): string {
  const extracted = extractAgentFacingOutput(
    {
      events: run.events.map(toAgentOutputEvent)
    },
    {
      includeRawStreams: false,
      includeTerminalSummaries: true
    }
  ).trim();
  return truncateAssistantContent(extracted || terminalStatusSummary(run));
}

function toAgentOutputEvent(event: RunEvent): {
  type: string;
  message: string;
  metadata: Record<string, unknown>;
} {
  return {
    type: event.type,
    message: event.payload.message ?? event.payload.summary ?? event.type,
    metadata: event.payload
  };
}

function terminalStatusSummary(run: ConversationRunSnapshot): string {
  if (run.summary.trim().length > 0) {
    return run.summary.trim();
  }
  if (run.status === "completed") {
    return `@${run.agentId} completed.`;
  }
  if (run.status === "cancelled") {
    return `@${run.agentId} was cancelled.`;
  }
  return `@${run.agentId} failed.`;
}

function truncateAssistantContent(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= maxAssistantMessageCharacters) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxAssistantMessageCharacters - 16).trimEnd()}\n[truncated]`;
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
