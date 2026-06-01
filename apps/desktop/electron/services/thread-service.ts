import {
  extractAgentFacingOutput,
  parseRoleCallIntents,
  RoleCallOrchestrator,
  validateTask,
  validateConversationMessage,
  validateConversationThread,
  validateConversationThreadSummary,
  validateRoleDefinition,
  type ConversationMessage,
  type ConversationMessageRepository,
  type ConversationThread,
  type ConversationThreadRepository,
  type ConversationThreadSummary,
  type ConversationThreadSummaryRepository,
  type RoleCallEventRepository,
  type RoleCallRepository,
  type RoleTodoRepository,
  type Task,
  type TaskRepository
} from "@agent-hub/core";
import {
  ConversationContextBuilder,
  ConversationThreadSummaryBuilder,
  type ConversationContextMessage
} from "@agent-hub/context-compiler";
import {
  defaultAgentKind,
  isAgentKindEnabled,
  presetWorkgroupRoles,
  toWorkgroupRoleRunMetadata,
  type AgentAvailabilityOptions
} from "@agent-hub/shared";
import type {
  AgentKind,
  JsonObject,
  RoleCall,
  RoleCallEvent,
  RoleDefinition,
  RoleTodo,
  TaskRunStatus,
  WorkgroupRole,
  WorkgroupRoleRunMetadata,
  WorkgroupTaskAssignmentMetadata
} from "@agent-hub/shared";
import { validateRoleCallPolicy } from "@agent-hub/safety";
import type {
  AgentId,
  AssistantMessage,
  CollaborationWorkflowInput,
  CollaborationWorkflowMode,
  CollaborationWorkflowParticipant,
  CollaborationWorkflowState,
  AgentRunMessage,
  ContextMode,
  CreateThreadInput,
  RunEvent,
  RunStatus,
  RunSummary,
  RoomType,
  SendThreadMessageInput,
  SystemMessage,
  ThreadDetail,
  ThreadMessage,
  ThreadSummary,
  TimelineEventKind,
  TimelineEventMetadata,
  RoleCallUiSummary,
  UpdateThreadInput,
  UserMessage
} from "../../src/lib/types";
import {
  buildRoleCallUiSummary,
  roleCallSummaryFromMetadata
} from "../../src/lib/role-call-ui";
import { roleResultSummaryFromText } from "../../src/lib/role-result-output";
import {
  parseWorkgroupMentions,
  type WorkgroupMentionParticipant
} from "./workgroup-mentions";
import type {
  DesktopServiceContext,
  ProjectService
} from "./project-service";
import type { ConversationRunSnapshot, RunService } from "./run-service";
import type { TeamService } from "./team-service";

const maxAssistantMessageCharacters = 2_000;
const defaultRoomDefinitions = [
  {
    handle: "general",
    title: "general",
    description: "Project-wide coordination and agent prompts."
  },
  {
    handle: "planning",
    title: "planning",
    description: "Plans, milestones, priorities, and scoped work."
  },
  {
    handle: "research",
    title: "research",
    description: "Investigation notes, source gathering, and synthesis."
  },
  {
    handle: "review",
    title: "review",
    description: "Run evidence, checks, risks, and review decisions."
  },
  {
    handle: "knowledge",
    title: "knowledge",
    description: "Memory proposals, reusable decisions, and project knowledge."
  }
] as const;
const defaultRoomOrder: Map<string, number> = new Map(
  defaultRoomDefinitions.map((room, index) => [room.handle, index])
);
const workflowModeSet = new Set<CollaborationWorkflowMode>([
  "handoff",
  "review_loop",
  "panel_discussion"
]);
const maxWorkflowRoundsByMode: Record<CollaborationWorkflowMode, number> = {
  handoff: 1,
  review_loop: 3,
  panel_discussion: 3
};

export interface ThreadService {
  listThreads(): Promise<ThreadSummary[]>;
  getThread(threadId: string): Promise<ThreadDetail>;
  createThread(input?: CreateThreadInput): Promise<ThreadSummary>;
  updateThread(input: UpdateThreadInput): Promise<ThreadDetail>;
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
    role?: WorkgroupRoleRunMetadata,
    metadata?: AgentRunTaskMetadata
  ): Promise<AgentRunMessage>;
  appendSystemMessage(
    threadId: string,
    text: string,
    metadata?: JsonObject
  ): Promise<SystemMessage>;
  sendMessage(input: SendThreadMessageInput): Promise<ThreadDetail>;
}

export interface ThreadServiceDependencies {
  context: DesktopServiceContext;
  projects: ProjectService;
  runs: RunService;
  conversationContextBuilder?: ConversationContextBuilder;
  roles?: readonly WorkgroupRole[];
  team?: Pick<TeamService, "rolesForProject">;
}

interface AgentRunTaskMetadata {
  taskId: string;
  taskTitle: string;
  assignment: WorkgroupTaskAssignmentMetadata;
  roleCallId?: string;
  workflowState?: CollaborationWorkflowState;
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
  private readonly tasks: TaskRepository;
  private readonly roleCalls: RoleCallRepository;
  private readonly roleCallEvents: RoleCallEventRepository;
  private readonly roleTodos: RoleTodoRepository;
  private readonly conversationContextBuilder: ConversationContextBuilder;
  private readonly conversationThreadSummaryBuilder = new ConversationThreadSummaryBuilder();
  private readonly threadReconciliationByThreadId = new Map<string, Promise<void>>();
  private readonly workflowReconciliationByThreadId = new Map<string, Promise<void>>();
  private legacyRunImportPromise: Promise<void> | undefined;
  private importedLegacyRuns = false;

  constructor(private readonly dependencies: ThreadServiceDependencies) {
    this.threads = dependencies.context.repositories.conversationThreadRepository;
    this.messages = dependencies.context.repositories.conversationMessageRepository;
    this.summaries =
      dependencies.context.repositories.conversationThreadSummaryRepository;
    this.tasks = dependencies.context.repositories.taskRepository;
    this.roleCalls = dependencies.context.repositories.roleCallRepository;
    this.roleCallEvents = dependencies.context.repositories.roleCallEventRepository;
    this.roleTodos = dependencies.context.repositories.roleTodoRepository;
    this.conversationContextBuilder =
      dependencies.conversationContextBuilder ?? new ConversationContextBuilder();
  }

  async listThreads(): Promise<ThreadSummary[]> {
    await this.ensureLegacyRunThreads();
    await this.ensureDefaultRoomsForKnownProjects();
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
    return summaries.sort(compareThreadSummaries);
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
    const [messages, runStatusById, roleCallSummariesByMessageId] = await Promise.all([
      this.messages.listByThreadId(thread.id),
      this.runStatusById(thread.projectId),
      this.roleCallSummariesByParentMessage(thread.id)
    ]);
    return toThreadDetail(
      refreshedThread,
      messages,
      runStatusById,
      roleCallSummariesByMessageId
    );
  }

  async createThread(input: CreateThreadInput = {}): Promise<ThreadSummary> {
    const projectId = input.projectId ?? (await this.defaultProjectId());
    if (!projectId) {
      throw new Error("projectId is required before creating a thread");
    }
    const now = this.dependencies.context.now();
    const title = titleFromPrompt(input.title ?? "") || "New Chat";
    const roomHandle = await this.uniqueRoomHandle({
      projectId,
      requestedHandle: input.roomHandle,
      title
    });
    const thread = await this.threads.create(
      validateConversationThread({
        id: this.dependencies.context.nextId("thread"),
        title,
        projectId,
        metadata: roomMetadata({
          roomType: input.roomType ?? "custom",
          roomHandle,
          description: input.description,
          pinned: input.pinned,
          sharedContextEnabled: input.sharedContextEnabled
        }),
        createdAt: now,
        updatedAt: now
      })
    );
    return toThreadSummary(toThreadDetail(thread, [], new Map()));
  }

  async updateThread(input: UpdateThreadInput): Promise<ThreadDetail> {
    const thread = await this.requireThread(input.threadId);
    const room = roomMetadataForThread(thread);
    const updated = await this.threads.update(
      validateConversationThread({
        ...thread,
        metadata: {
          ...(thread.metadata ?? {}),
          ...roomMetadata({
            ...room,
            sharedContextEnabled: input.sharedContextEnabled
          })
        },
        updatedAt: this.dependencies.context.now()
      })
    );
    const [messages, runStatusById, roleCallSummariesByMessageId] = await Promise.all([
      this.messages.listByThreadId(updated.id),
      this.runStatusById(updated.projectId),
      this.roleCallSummariesByParentMessage(updated.id)
    ]);
    return toThreadDetail(
      updated,
      messages,
      runStatusById,
      roleCallSummariesByMessageId
    );
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
          roleMentions: roleMentions.length > 0 ? roleMentions : undefined,
          timelineEvent: timelineEvent({
            kind: "user_message",
            actor: "user",
            title: "User message",
            summary: text,
            chips: [
              ...uniqueAgents(mentions).map((agentId) => ({
                kind: "assignment_created" as const,
                label: `@${agentId}`,
                tone: "info" as const
              })),
              ...roleMentions.map((roleMention) => ({
                kind: "assignment_created" as const,
                label: `@${roleMention.roleHandle}`,
                tone: "accent" as const
              }))
            ]
          })
        },
        createdAt: now
      })
    );
    await this.touchThread(thread, {
      title:
        thread.title === "New Chat" &&
        roomMetadataForThread(thread).roomType !== "default"
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
    role?: WorkgroupRoleRunMetadata,
    taskMetadata?: AgentRunTaskMetadata
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
            : undefined,
          taskId: taskMetadata?.taskId,
          taskTitle: taskMetadata?.taskTitle,
          roleCallId: taskMetadata?.roleCallId,
          assignment: taskMetadata?.assignment,
          workflowState: taskMetadata?.workflowState,
          timelineEvent: timelineEvent({
            kind: "run_started",
            actor: "agent",
            title: taskMetadata?.assignment.roleHandle
              ? `@${taskMetadata.assignment.roleHandle} run started`
              : `@${agentId} run started`,
            summary: `Local ${agentId} run is linked to this timeline event.`,
            status: run.status,
            taskId: taskMetadata?.taskId,
            runId,
            workflowId: taskMetadata?.workflowState?.workflowId,
            assignmentId: taskMetadata?.assignment.assignmentId,
            chips: [
              {
                kind: "run_started",
                label: run.status,
                tone: run.status === "queued" ? "neutral" : "warning"
              }
            ]
          })
        },
        createdAt: now
      })
    );
    await this.touchThread(thread, { updatedAt: now });
    return toAgentRunMessage(message, new Map([[runId, run.status]]));
  }

  async appendSystemMessage(
    threadId: string,
    text: string,
    metadata?: JsonObject
  ): Promise<SystemMessage> {
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
        metadata,
        createdAt: now
      })
    );
    await this.touchThread(thread, { updatedAt: now });
    return toSystemMessage(message);
  }

  private async appendWorkflowStartMessages(
    threadId: string,
    workflowState: CollaborationWorkflowState
  ): Promise<void> {
    const startKind = workflowStartKind(workflowState.mode);
    const startTitle = workflowStartTitle(workflowState.mode);
    await this.appendSystemMessage(
      threadId,
      workflowStartSummary(workflowState),
      {
        taskEvent: startKind,
        workflowEvent: startKind,
        taskId: workflowState.taskId,
        workflowState,
        timelineEvent: timelineEvent({
          kind: startKind,
          actor: "system",
          title: startTitle,
          summary: workflowStartSummary(workflowState),
          status: workflowState.status,
          tone: "accent",
          taskId: workflowState.taskId,
          workflowId: workflowState.workflowId,
          assignmentIds: workflowState.participants.map(
            (participant) => participant.assignmentId
          ),
          chips: workflowChips(workflowState)
        })
      }
    );

    if (!workflowHasExecutableParticipants(workflowState)) {
      await this.appendWorkflowCompletionMessage(threadId, workflowState);
    }
  }

  private async appendWorkflowCompletionMessage(
    threadId: string,
    workflowState: CollaborationWorkflowState
  ): Promise<void> {
    const completed = completeWorkflowState(
      workflowState,
      this.dependencies.context.now()
    );
    await this.appendSystemMessage(
      threadId,
      workflowCompletionSummary(completed),
      {
        taskEvent: "workflow_completed",
        workflowEvent: "workflow_completed",
        taskId: completed.taskId,
        workflowState: completed,
        timelineEvent: timelineEvent({
          kind: "workflow_completed",
          actor: "system",
          title: "Workflow completed",
          summary: workflowCompletionSummary(completed),
          status: "completed",
          tone: "success",
          taskId: completed.taskId,
          workflowId: completed.workflowId,
          assignmentIds: completed.participants.map(
            (participant) => participant.assignmentId
          ),
          chips: workflowChips(completed)
        })
      }
    );
  }

  async sendMessage(input: SendThreadMessageInput): Promise<ThreadDetail> {
    await this.ensureLegacyRunThreads();
    const contextMode = parseContextMode(input.contextMode ?? "auto");
    const workflowRequest = resolveWorkflowRequest(input.text, input.workflow);
    const thread = input.threadId
      ? await this.requireThread(input.threadId)
      : await this.defaultRoomThread(
          input.projectId ?? (await this.defaultProjectId()),
          "general"
        );
    const roles =
      this.dependencies.roles ??
      (await this.dependencies.team?.rolesForProject(thread.projectId));
    const availableRoles = roles ?? presetWorkgroupRoles;
    const parsed = parseWorkgroupMentions(workflowRequest.text, availableRoles, {
      availableAgents: availableDesktopAgents(
        this.dependencies.context.agentAvailability
      ),
      rejectUnavailableAgents: true
    });
    const cleanedPrompt = parsed.cleanedPrompt.trim();
    if (!cleanedPrompt) {
      throw new Error("message text is required");
    }
    const participants: WorkgroupMentionParticipant[] =
      input.agents && input.agents.length > 0
        ? uniqueAgents(
            input.agents.map((agent) =>
              parseAgentId(agent, this.dependencies.context.agentAvailability)
            )
          ).map((agentId) => ({
            agentId,
            source: "adapter_mention" as const
          }))
        : parsed.participants.length > 0
          ? parsed.participants
          : parsed.roleMentions.length > 0
            ? []
            : [
                {
                  agentId: toAgentId(
                    defaultAgentKind(this.dependencies.context.agentAvailability)
                  ),
                  source: "adapter_mention"
                }
              ];
    const agents = uniqueAgents(participants.map((participant) => participant.agentId));
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

    const taskId = this.dependencies.context.nextId("task");
    const title = titleFromPrompt(cleanedPrompt);
    let assignments = createTaskAssignments({
      taskId,
      threadId: currentThread.id,
      sourceMessageId: userMessage.id,
      participants,
      roleMentions: parsed.roleMentions,
      nextId: (prefix) => this.dependencies.context.nextId(prefix)
    });
    let workflowState = workflowRequest.workflow
      ? createWorkflowState({
          workflowId: this.dependencies.context.nextId("workflow"),
          workflow: workflowRequest.workflow,
          taskId,
          threadId: currentThread.id,
          sourceMessageId: userMessage.id,
          assignments,
          createdAt: userMessage.createdAt,
          updatedAt: userMessage.createdAt
        })
      : undefined;
    const task = await this.tasks.create(
      validateTask({
        id: taskId,
        projectId: currentThread.projectId,
        title,
        description: cleanedPrompt,
        metadata: taskMetadata({
          thread: currentThread,
          sourceMessageId: userMessage.id,
          assignments,
          workflowState
        }),
        status: "open",
        createdAt: userMessage.createdAt,
        updatedAt: userMessage.createdAt
      })
    );
    await this.linkUserMessageToTask(userMessage.id, {
      taskId: task.id,
      taskTitle: task.title,
      workflowState
    });
    await this.appendSystemMessage(
      currentThread.id,
      `Task created: ${task.title}`,
      {
        taskEvent: "task_created",
        taskId: task.id,
        taskTitle: task.title,
        timelineEvent: timelineEvent({
          kind: "task_created",
          actor: "system",
          title: "Task created",
          summary: task.title,
          taskId: task.id,
          chips: [
            {
              kind: "task_created",
              label: "task created",
              tone: "accent"
            }
          ]
        })
      }
    );
    await this.appendSystemMessage(
      currentThread.id,
      assignmentSummary(assignments),
      {
        taskEvent: "participants_assigned",
        taskId: task.id,
        assignments,
        timelineEvent: timelineEvent({
          kind: "assignment_created",
          actor: "system",
          title: "Assignments created",
          summary: assignmentSummary(assignments),
          taskId: task.id,
          assignmentIds: assignments.map((assignment) => assignment.assignmentId),
          chips: assignmentChips(assignments)
        })
      }
    );

    const createdRuns: Array<{
      run: RunSummary;
      participant: WorkgroupMentionParticipant;
      assignment: WorkgroupTaskAssignmentMetadata;
    }> = [];
    for (const participant of participants) {
      const assignment = assignmentForParticipant(assignments, participant);
      if (!assignment?.executable) {
        continue;
      }
      try {
        const conversationBrief = await this.buildConversationBrief({
          thread: currentThread,
          currentTurn: cleanedPrompt,
          currentMessageCreatedAt: userMessage.createdAt,
          agentId: participant.agentId,
          role: participant.role,
          contextMode,
          priorMessages,
          availableRoles
        });
        const agentSessionId = await this.latestAgentSessionIdForParticipant({
          priorMessages,
          agentId: participant.agentId,
          role: participant.role
        });
        const run = await this.dependencies.runs.createRun({
          taskId: task.id,
          projectId: currentThread.projectId,
          prompt: cleanedPrompt,
          title,
          agentId: participant.agentId,
          role: participant.role,
          teamRoles: participant.role
            ? availableRoles
                .filter((role) => role.enabled)
                .map((role) => toWorkgroupRoleRunMetadata(role))
            : undefined,
          agentSessionId,
          assignment,
          contextMode,
          deliveryMode: "runtime_injection",
          conversationBrief,
          startImmediately: false,
          continueFromRunId: continueFrom?.parentRunId,
          continueFromMessageId: continueFrom?.parentMessageId
        });
        const linkedAssignment = {
          ...assignment,
          runId: run.id,
          status: "queued" as const
        };
        assignments = assignments.map((entry) =>
          entry.assignmentId === assignment.assignmentId ? linkedAssignment : entry
        );
        createdRuns.push({
          run,
          participant,
          assignment: linkedAssignment
        });
      } catch (error) {
        const skippedAssignment = {
          ...assignment,
          status: "skipped" as const
        };
        assignments = assignments.map((entry) =>
          entry.assignmentId === assignment.assignmentId ? skippedAssignment : entry
        );
        await this.appendSystemMessage(
          currentThread.id,
          `@${participant.role?.roleHandle ?? participant.agentId} could not start: ${errorMessage(error)}`,
          {
            taskEvent: "assignment_start_failed",
            taskId: task.id,
            assignment: skippedAssignment,
            timelineEvent: timelineEvent({
              kind: "assignment_start_failed",
              actor: "system",
              title: "Assignment start failed",
              summary: errorMessage(error),
              status: "skipped",
              taskId: task.id,
              assignmentId: skippedAssignment.assignmentId,
              chips: [
                {
                  kind: "assignment_start_failed",
                  label: "start failed",
                  tone: "warning"
                }
              ]
            })
          }
        );
      }
    }

    if (workflowState) {
      workflowState = refreshWorkflowState(
        workflowState,
        assignments,
        this.dependencies.context.now()
      );
    }

    await this.tasks.create(
      validateTask({
        ...task,
        metadata: taskMetadata({
          thread: currentThread,
          sourceMessageId: userMessage.id,
          assignments,
          workflowState
        }),
        updatedAt: this.dependencies.context.now()
      })
    );

    if (workflowState) {
      await this.linkUserMessageToTask(userMessage.id, {
        taskId: task.id,
        taskTitle: task.title,
        workflowState
      });
      await this.appendWorkflowStartMessages(currentThread.id, workflowState);
    }

    for (const { run, participant, assignment } of createdRuns) {
      await this.appendAgentRunMessage(
        currentThread.id,
        run.id,
        participant.agentId,
        participant.role,
        {
          taskId: task.id,
          taskTitle: task.title,
          assignment,
          workflowState
        }
      );
    }
    for (const { run, participant, assignment } of createdRuns) {
      await this.appendAssistantOutputPlaceholder(
        currentThread.id,
        run.id,
        participant.agentId,
        participant.role,
        assignment
      );
    }
    for (const { run, participant } of createdRuns) {
      try {
        await this.dependencies.runs.startRun(run.id);
      } catch (error) {
        await this.appendSystemMessage(
          currentThread.id,
          `@${participant.role?.roleHandle ?? participant.agentId} could not start: ${errorMessage(error)}`,
          {
            taskEvent: "assignment_start_failed",
            taskId: task.id,
            runId: run.id,
            timelineEvent: timelineEvent({
              kind: "assignment_start_failed",
              actor: "system",
              title: "Run start failed",
              summary: errorMessage(error),
              status: "failed",
              taskId: task.id,
              runId: run.id,
              chips: [
                {
                  kind: "assignment_start_failed",
                  label: "start failed",
                  tone: "warning"
                }
              ]
            })
          }
        );
      }
    }

    return this.getThread(currentThread.id);
  }

  private async linkUserMessageToTask(
    messageId: string,
    task: {
      taskId: string;
      taskTitle: string;
      workflowState?: CollaborationWorkflowState;
    }
  ): Promise<void> {
    const message = await this.messages.get(messageId);
    if (!message) {
      return;
    }
    const existingEvent = metadataTimelineEvent(message.metadata);
    await this.messages.update(
      validateConversationMessage({
        ...message,
        metadata: {
          ...(message.metadata ?? {}),
          timelineEvent: timelineEvent({
            kind: existingEvent?.kind ?? "user_message",
            actor: existingEvent?.actor ?? "user",
            title: existingEvent?.title ?? "User message",
            summary: existingEvent?.summary ?? message.content,
            taskId: task.taskId,
            workflowId: task.workflowState?.workflowId,
            chips: existingEvent?.chips
          }),
          workflowState: task.workflowState
        }
      })
    );
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
    availableRoles: readonly WorkgroupRole[];
  }) {
    const room = roomMetadataForThread(input.thread);
    const contextSourceMessages = room.sharedContextEnabled
      ? contextSourceMessagesForParticipant(input.priorMessages, {
          agentId: input.agentId,
          roleHandle: input.role?.roleHandle
        })
      : [];
    const messages = await Promise.all(
      contextSourceMessages.map((message) => this.toConversationContextMessage(message))
    );
    const includedMessages = messages.filter(
      (message): message is ConversationContextMessage => message !== undefined
    );
    const threadSummary =
      room.sharedContextEnabled && input.role?.contextPolicy.includeThreadSummary !== false
        ? this.conversationThreadSummaryBuilder.build({ messages: includedMessages })
        : undefined;
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
      messages: includedMessages,
      threadSummary:
        threadSummary && threadSummary.sourceMessageCount > 0 ? threadSummary : undefined,
      projectContextReferences: [
        `project:${input.thread.projectId}`,
        "Agent Hub-owned project context store",
        "Approved memory only; thread context is not promoted automatically",
        `room_shared_context:${room.sharedContextEnabled ? "enabled" : "disabled"}`,
        ...roleProtocolReferences(input.role, input.availableRoles),
        ...roleContextReferences(input.role)
      ]
    });
  }

  private async latestAgentSessionIdForParticipant(input: {
    priorMessages: ConversationMessage[];
    agentId: AgentId;
    role?: WorkgroupRoleRunMetadata;
  }): Promise<string | undefined> {
    if (input.agentId !== "codex") {
      return undefined;
    }
    const expectedRoleHandle = input.role?.roleHandle;
    for (const message of [...input.priorMessages].reverse()) {
      if (
        message.kind !== "run_card" ||
        !message.runId ||
        !message.agentKind ||
        toAgentId(message.agentKind) !== input.agentId
      ) {
        continue;
      }
      if (runCardRoleHandle(message) !== expectedRoleHandle) {
        continue;
      }
      const snapshot = await this.conversationRunSnapshot(message.runId);
      const sessionId = snapshot ? agentSessionIdFromEvents(snapshot.events) : undefined;
      if (sessionId) {
        return sessionId;
      }
    }
    return undefined;
  }

  private async toConversationContextMessage(
    message: ConversationMessage
  ): Promise<ConversationContextMessage | undefined> {
    if (isPendingAssistantOutputMessage(message)) {
      return undefined;
    }
    if (isInternalTimelineMessage(message)) {
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
    role?: WorkgroupRoleRunMetadata,
    assignment?: WorkgroupTaskAssignmentMetadata,
    roleCallId?: string
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
          taskId: assignment?.taskId,
          roleCallId,
          assignment,
          assistantOutput: true,
          pending: true
        },
        createdAt: now
      })
    );
    await this.touchThread(thread, { updatedAt: now });
  }

  private async reconcileAssistantMessages(threadId: string): Promise<void> {
    const existing = this.threadReconciliationByThreadId.get(threadId);
    if (existing) {
      await existing;
      return;
    }
    const pending = this.reconcileAssistantMessagesUnlocked(threadId).finally(() => {
      this.threadReconciliationByThreadId.delete(threadId);
    });
    this.threadReconciliationByThreadId.set(threadId, pending);
    await pending;
  }

  private async reconcileAssistantMessagesUnlocked(threadId: string): Promise<void> {
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
        !message.agentKind
      ) {
        continue;
      }
      if (
        refreshedAssistantRunIds.has(message.runId) &&
        isTerminalRunTimelineKind(metadataTimelineEvent(message.metadata)?.kind)
      ) {
        continue;
      }
      const snapshot = await this.conversationRunSnapshot(message.runId);
      if (!snapshot || !isTerminalRunStatus(snapshot.status)) {
        continue;
      }
      await this.markRunCardTerminalEvent(message, snapshot.status);
      if (refreshedAssistantRunIds.has(message.runId)) {
        continue;
      }
      const now = this.dependencies.context.now();
      const content = terminalAssistantContent(snapshot);
      const created = await this.messages.create(
        validateConversationMessage({
          id: this.dependencies.context.nextId("message"),
          threadId,
          sequence: await this.messages.countByThreadId(threadId),
          role: "assistant",
          kind: "text",
          content,
          agentKind: message.agentKind,
          runId: message.runId,
          status: toCoreRunStatus(snapshot.status),
          metadata: {
            agentId: toAgentId(message.agentKind),
            role: message.metadata?.role,
            assignment: metadataAssignment(message.metadata),
            assistantOutput: true,
            pending: false,
            terminalStatus: snapshot.status,
            timelineEvent: timelineEvent({
              kind: "participant_message",
              actor: "assistant",
              title: `${messageParticipantHandle(message)} response`,
              summary: content,
              status: snapshot.status,
              runId: message.runId,
              taskId: metadataString(message.metadata, "taskId"),
              chips: [
                {
                  kind: "participant_message",
                  label: snapshot.status,
                  tone: terminalStatusTone(snapshot.status)
                }
              ]
            })
          },
          createdAt: now
        })
      );
      await this.processRoleCallOutput(thread, created);
      await this.touchThread(thread, { updatedAt: now });
      refreshedAssistantRunIds.add(message.runId);
    }
    await this.reconcileWorkflowEvents(thread);
  }

  private async reconcileWorkflowEvents(thread: ConversationThread): Promise<void> {
    const existing = this.workflowReconciliationByThreadId.get(thread.id);
    if (existing) {
      await existing;
      return;
    }
    const pending = this.reconcileWorkflowEventsUnlocked(thread).finally(() => {
      this.workflowReconciliationByThreadId.delete(thread.id);
    });
    this.workflowReconciliationByThreadId.set(thread.id, pending);
    await pending;
  }

  private async reconcileWorkflowEventsUnlocked(
    thread: ConversationThread
  ): Promise<void> {
    const tasks = await this.tasks.listByProjectId(thread.projectId);
    for (const task of tasks) {
      if (task.metadata?.threadId !== thread.id) {
        continue;
      }
      const workflowState = metadataWorkflowState(task.metadata);
      if (!workflowState || workflowState.status === "completed") {
        continue;
      }
      const participants = await this.refreshedWorkflowParticipants(workflowState);
      if (!participants.every((participant) => workflowParticipantIsTerminal(participant))) {
        continue;
      }
      const completed = completeWorkflowState(
        {
          ...workflowState,
          participants
        },
        this.dependencies.context.now()
      );
      await this.tasks.create(
        validateTask({
          ...task,
          metadata: {
            ...(task.metadata ?? {}),
            workflowState: completed
          },
          updatedAt: completed.updatedAt
        })
      );
      if (
        completed.mode === "review_loop" &&
        !(await this.hasWorkflowEvent(
          thread.id,
          completed.workflowId,
          "workflow_review_completed"
        ))
      ) {
        await this.appendSystemMessage(
          thread.id,
          `Review completed for ${completed.summary}.`,
          {
            taskEvent: "workflow_review_completed",
            workflowEvent: "workflow_review_completed",
            taskId: completed.taskId,
            workflowState: completed,
            timelineEvent: timelineEvent({
              kind: "workflow_review_completed",
              actor: "system",
              title: "Review completed",
              summary: `Review completed for ${completed.summary}.`,
              status: "completed",
              tone: "success",
              taskId: completed.taskId,
              workflowId: completed.workflowId,
              assignmentIds: completed.participants.map(
                (participant) => participant.assignmentId
              ),
              chips: workflowChips(completed)
            })
          }
        );
      }
      if (
        !(await this.hasWorkflowEvent(
          thread.id,
          completed.workflowId,
          "workflow_completed"
        ))
      ) {
        await this.appendWorkflowCompletionMessage(thread.id, completed);
      }
    }
  }

  private async hasWorkflowEvent(
    threadId: string,
    workflowId: string,
    workflowEvent: string
  ): Promise<boolean> {
    const messages = await this.messages.listByThreadId(threadId);
    return messages.some(
      (message) =>
        message.metadata?.workflowEvent === workflowEvent &&
        metadataWorkflowState(message.metadata)?.workflowId === workflowId
    );
  }

  private async refreshedWorkflowParticipants(
    workflowState: CollaborationWorkflowState
  ): Promise<CollaborationWorkflowParticipant[]> {
    return Promise.all(
      workflowState.participants.map(async (participant) => {
        if (!participant.runId) {
          return participant;
        }
        const snapshot = await this.conversationRunSnapshot(participant.runId);
        return snapshot
          ? {
              ...participant,
              status: snapshot.status
            }
          : participant;
      })
    );
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
      await this.processRoleCallOutput(thread, message);
      return;
    }
    const agentId = message.agentKind ? toAgentId(message.agentKind) : snapshot.agentId;
    const content = terminalAssistantContent(snapshot);
    const updated = await this.messages.update(
      validateConversationMessage({
        ...message,
        content,
        status,
        metadata: {
          ...(message.metadata ?? {}),
          agentId,
          assistantOutput: true,
          pending: false,
          terminalStatus: snapshot.status,
          timelineEvent: timelineEvent({
            kind: "participant_message",
            actor: "assistant",
            title: `${messageParticipantHandle(message)} response`,
            summary: content,
            status: snapshot.status,
            runId: message.runId,
            taskId: metadataString(message.metadata, "taskId"),
            chips: [
              {
                kind: "participant_message",
                label: snapshot.status,
                tone: terminalStatusTone(snapshot.status)
              }
            ]
          })
        }
      })
    );
    await this.processRoleCallOutput(thread, updated);
    await this.touchThread(thread, { updatedAt: this.dependencies.context.now() });
  }

  private async processRoleCallOutput(
    thread: ConversationThread,
    message: ConversationMessage
  ): Promise<void> {
    const role = metadataRoleRun(message.metadata);
    if (
      !role ||
      message.role !== "assistant" ||
      message.status !== "succeeded" ||
      message.metadata?.roleCallProcessed === true
    ) {
      return;
    }
    const existingForMessage = (await this.roleCalls.list({ threadId: thread.id }))
      .filter((call) => call.parentMessageId === message.id);
    if (existingForMessage.length > 0) {
      await this.markRoleCallProcessed(message, []);
      return;
    }

    const roles = await this.rolesForProject(thread.projectId);
    const roleDefinitions = roleDefinitionsForWorkgroupRoles(roles);
    const parsed = parseRoleCallIntents(message.content, {
      knownRoles: roleDefinitions,
      defaultReason: `Line-start role mention emitted by @${role.roleHandle}.`,
      defaultExpectedOutput: { format: "summary" }
    });
    if (parsed.intents.length === 0) {
      if (parsed.warnings.length > 0) {
        await this.markRoleCallProcessed(message, parsed.warnings.map((warning) => warning.message));
      }
      return;
    }

    const orchestrator = new RoleCallOrchestrator({
      repositories: {
        roleCallRepository: this.roleCalls,
        roleCallEventRepository: this.roleCallEvents,
        roleTodoRepository: this.roleTodos
      },
      roles: roleDefinitions,
      policyValidator: (request) =>
        validateRoleCallPolicy({
          callerRole: request.callerRole,
          calleeRole: request.calleeRole,
          intent: request.intent,
          currentDepth: request.currentDepth,
          activeRoleCalls: request.activeRoleCalls,
          existingRoleCalls: request.existingRoleCalls,
          roleTodos: request.roleTodos
        }),
      idFactory: (prefix) => this.dependencies.context.nextId(prefix),
      now: () => this.dependencies.context.now()
    });
    const summaries = await orchestrator.processRoleIntents({
      threadId: thread.id,
      callerRole: role.roleHandle,
      intents: parsed.intents.map((entry) => entry.intent),
      userGoal: await this.roleCallUserGoal(message),
      parentMessageId: message.id,
      currentPlan: message.content
    });
    const executionWarnings = await this.startAcceptedRoleCalls(
      thread,
      roles,
      roleDefinitions,
      message.id
    );
    const summary = (await this.roleCallSummariesByParentMessage(thread.id)).get(message.id);
    await this.messages.update(
      validateConversationMessage({
        ...message,
        metadata: {
          ...(message.metadata ?? {}),
          roleCallProcessed: true,
          roleCallProcessedAt: this.dependencies.context.now(),
          roleCallParseWarnings: [
            ...parsed.warnings.map((warning) => warning.message),
            ...executionWarnings
          ],
          roleCallLedgerSummaries: summaries.map((entry) => ({
            roleCallId: entry.roleCallId,
            targetRole: entry.targetRole,
            status: entry.status,
            message: entry.message,
            reasons: entry.reasons
          })),
          roleCallSummary: summary
        }
      })
    );
  }

  private async startAcceptedRoleCalls(
    thread: ConversationThread,
    workgroupRoles: readonly WorkgroupRole[],
    roles: readonly RoleDefinition[],
    parentMessageId: string
  ): Promise<string[]> {
    const warnings: string[] = [];
    const executableRoles = new Set(
      roles
        .filter((role) => role.executor.kind === "agent_adapter")
        .map((role) => role.handle)
    );
    const calls = (await this.roleCalls.list({ threadId: thread.id }))
      .filter(
        (call) =>
          call.parentMessageId === parentMessageId &&
          call.status === "accepted" &&
          !call.taskRunId &&
          executableRoles.has(call.calleeRole)
      );
    for (const call of calls) {
      try {
        const started = await this.dependencies.runs.startRoleCall({
          roleCallId: call.id,
          projectId: thread.projectId,
          roles
        });
        const role = workgroupRoles.find((entry) => entry.handle === call.calleeRole);
        const roleMetadata = role ? toWorkgroupRoleRunMetadata(role) : undefined;
        const assignment = roleCallAssignment({
          roleCall: call,
          role: roleMetadata,
          agentId: started.agentId,
          runId: started.runId,
          nextId: (prefix) => this.dependencies.context.nextId(prefix)
        });
        await this.appendAgentRunMessage(
          thread.id,
          started.runId,
          started.agentId,
          roleMetadata,
          {
            taskId: call.id,
            taskTitle: `Role call: @${call.calleeRole} ${call.task}`,
            assignment,
            roleCallId: call.id
          }
        );
        await this.appendAssistantOutputPlaceholder(
          thread.id,
          started.runId,
          started.agentId,
          roleMetadata,
          assignment,
          call.id
        );
      } catch (error) {
        warnings.push(`@${call.calleeRole} execution failed: ${errorMessage(error)}`);
      }
    }
    return warnings;
  }

  private async rolesForProject(projectId: string): Promise<readonly WorkgroupRole[]> {
    return (
      this.dependencies.roles ??
      (await this.dependencies.team?.rolesForProject(projectId)) ??
      presetWorkgroupRoles
    );
  }

  private async roleCallUserGoal(message: ConversationMessage): Promise<string> {
    const assignment = metadataAssignment(message.metadata);
    if (assignment?.sourceMessageId) {
      const sourceMessage = await this.messages.get(assignment.sourceMessageId);
      if (sourceMessage?.content.trim()) {
        return sourceMessage.content;
      }
    }
    const taskId = metadataString(message.metadata, "taskId") ?? assignment?.taskId;
    if (taskId) {
      const task = await this.tasks.get(taskId);
      if (task?.description?.trim()) {
        return task.description;
      }
      if (task?.title.trim()) {
        return task.title;
      }
    }
    return message.content;
  }

  private async markRoleCallProcessed(
    message: ConversationMessage,
    warnings: string[]
  ): Promise<void> {
    await this.messages.update(
      validateConversationMessage({
        ...message,
        metadata: {
          ...(message.metadata ?? {}),
          roleCallProcessed: true,
          roleCallProcessedAt: this.dependencies.context.now(),
          roleCallParseWarnings: warnings
        }
      })
    );
  }

  private async markRunCardTerminalEvent(
    message: ConversationMessage,
    status: RunStatus
  ): Promise<void> {
    if (!message.runId) {
      return;
    }
    const nextKind = terminalRunTimelineKind(status);
    const existingEvent = metadataTimelineEvent(message.metadata);
    if (
      existingEvent?.kind === nextKind &&
      existingEvent.status === status &&
      message.status === toCoreRunStatus(status)
    ) {
      return;
    }
    await this.messages.update(
      validateConversationMessage({
        ...message,
        status: toCoreRunStatus(status),
        metadata: {
          ...(message.metadata ?? {}),
          timelineEvent: timelineEvent({
            kind: nextKind,
            actor: existingEvent?.actor ?? "agent",
            title: terminalRunTitle(message, status),
            summary: existingEvent?.summary,
            status,
            taskId:
              existingEvent?.linkedIds?.taskId ??
              metadataString(message.metadata, "taskId"),
            runId: message.runId,
            assignmentId:
              existingEvent?.linkedIds?.assignmentId ??
              metadataAssignment(message.metadata)?.assignmentId,
            chips: [
              {
                kind: nextKind,
                label: status,
                tone: terminalStatusTone(status)
              }
            ]
          })
        }
      })
    );
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

  private async roleCallSummariesByParentMessage(
    threadId: string
  ): Promise<Map<string, RoleCallUiSummary>> {
    const [calls, todos, events] = await Promise.all([
      this.roleCalls.list({ threadId }),
      this.roleTodos.list({ threadId }),
      this.roleCallEvents.listByThreadId(threadId)
    ]);
    const callsByMessageId = new Map<string, RoleCall[]>();
    for (const call of calls) {
      if (!call.parentMessageId) {
        continue;
      }
      const group = callsByMessageId.get(call.parentMessageId) ?? [];
      group.push(call);
      callsByMessageId.set(call.parentMessageId, group);
    }

    const summaries = new Map<string, RoleCallUiSummary>();
    for (const [messageId, group] of callsByMessageId.entries()) {
      const groupCallIds = new Set(group.map((call) => call.id));
      const groupTodos = todos.filter((todo) =>
        todoBelongsToRoleCallGroup(todo, groupCallIds)
      );
      const groupEvents = events.filter((event) => groupCallIds.has(event.roleCallId));
      summaries.set(
        messageId,
        buildRoleCallUiSummary({
          threadId,
          sourceMessageId: messageId,
          calls: group,
          todos: groupTodos,
          events: groupEvents,
          updatedAt: latestRoleCallSummaryTimestamp(group, groupTodos, groupEvents)
        })
      );
    }
    return summaries;
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
    const title = titleFromPrompt(input.title) || "New Chat";
    const roomHandle = await this.uniqueRoomHandle({ projectId, title });
    return this.threads.create(
      validateConversationThread({
        id: this.dependencies.context.nextId("thread"),
        projectId,
        title,
        metadata: roomMetadata({
          roomType: "custom",
          roomHandle,
          description: "Imported conversation room."
        }),
        createdAt: now,
        updatedAt: now
      })
    );
  }

  private async defaultRoomThread(
    projectId: string | undefined,
    handle: string
  ): Promise<ConversationThread> {
    if (!projectId) {
      throw new Error("projectId is required before sending a message");
    }
    await this.ensureDefaultRooms(projectId);
    const rooms = await this.threads.list(projectId);
    const existing = rooms.find((thread) => isDefaultRoom(thread, handle));
    if (!existing) {
      throw new Error(`default room #${handle} was not created`);
    }
    return existing;
  }

  private async ensureDefaultRoomsForKnownProjects(): Promise<void> {
    const projects = await this.dependencies.projects.list();
    await Promise.all(projects.map((project) => this.ensureDefaultRooms(project.id)));
  }

  private async ensureDefaultRooms(projectId: string): Promise<void> {
    const existingThreads = await this.threads.list(projectId);
    for (const definition of defaultRoomDefinitions) {
      if (existingThreads.some((thread) => isDefaultRoom(thread, definition.handle))) {
        continue;
      }
      const now = this.dependencies.context.now();
      const thread = await this.threads.create(
        validateConversationThread({
          id: this.dependencies.context.nextId("thread"),
          projectId,
          title: definition.title,
          metadata: roomMetadata({
            roomType: "default",
            roomHandle: definition.handle,
            description: definition.description,
            pinned: true
          }),
          createdAt: now,
          updatedAt: now
        })
      );
      existingThreads.push(thread);
    }
  }

  private async uniqueRoomHandle(input: {
    projectId: string;
    requestedHandle?: string;
    title: string;
  }): Promise<string> {
    const base =
      normalizeRoomHandle(input.requestedHandle ?? input.title) ?? "room";
    const existing = new Set(
      (await this.threads.list(input.projectId)).map(
        (thread) => roomMetadataForThread(thread).roomHandle
      )
    );
    if (!existing.has(base)) {
      return base;
    }
    for (let index = 2; index < 1000; index += 1) {
      const candidate = `${base}-${index}`;
      if (!existing.has(candidate)) {
        return candidate;
      }
    }
    throw new Error(`could not create a unique room handle for ${base}`);
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
    if (this.legacyRunImportPromise) {
      await this.legacyRunImportPromise;
      return;
    }
    this.legacyRunImportPromise = this.importLegacyRunThreadsUnlocked()
      .then(() => {
        this.importedLegacyRuns = true;
      })
      .finally(() => {
        this.legacyRunImportPromise = undefined;
      });
    await this.legacyRunImportPromise;
  }

  private async importLegacyRunThreadsUnlocked(): Promise<void> {
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

interface RoomMetadata {
  roomType: RoomType;
  roomHandle: string;
  description?: string;
  pinned?: boolean;
  sharedContextEnabled: boolean;
}

function roomMetadata(
  input: Omit<RoomMetadata, "sharedContextEnabled"> & {
    sharedContextEnabled?: boolean;
  }
): ConversationThread["metadata"] {
  return {
    roomType: input.roomType,
    roomHandle: input.roomHandle,
    description: input.description,
    pinned: input.pinned,
    sharedContextEnabled: input.sharedContextEnabled ?? true
  };
}

function taskMetadata(input: {
  thread: ConversationThread;
  sourceMessageId: string;
  assignments: WorkgroupTaskAssignmentMetadata[];
  workflowState?: CollaborationWorkflowState;
}): JsonObject {
  const room = roomMetadataForThread(input.thread);
  return {
    source: "desktop_thread",
    threadId: input.thread.id,
    roomType: room.roomType,
    roomHandle: room.roomHandle,
    sourceMessageId: input.sourceMessageId,
    assignmentCount: input.assignments.length,
    executableAssignmentCount: input.assignments.filter(
      (assignment) => assignment.executable
    ).length,
    assignments: input.assignments,
    workflowState: input.workflowState
  };
}

function createTaskAssignments(input: {
  taskId: string;
  threadId: string;
  sourceMessageId: string;
  participants: WorkgroupMentionParticipant[];
  roleMentions: WorkgroupRoleRunMetadata[];
  nextId(prefix: string): string;
}): WorkgroupTaskAssignmentMetadata[] {
  const assignments: WorkgroupTaskAssignmentMetadata[] = [];
  const roleHandles = new Set<string>();

  for (const role of input.roleMentions) {
    if (roleHandles.has(role.roleHandle)) {
      continue;
    }
    roleHandles.add(role.roleHandle);
    const agentId = role.adapterKind ? toAgentId(role.adapterKind) : undefined;
    assignments.push({
      assignmentId: input.nextId("assignment"),
      taskId: input.taskId,
      threadId: input.threadId,
      sourceMessageId: input.sourceMessageId,
      assignmentRole: "role",
      agentId,
      roleHandle: role.roleHandle,
      displayName: role.displayName,
      executorKind: role.executorKind,
      adapterKind: role.adapterKind,
      executable: Boolean(agentId),
      status: agentId ? "queued" : "assigned"
    });
  }

  const agentIds = new Set<string>();
  for (const participant of input.participants) {
    if (participant.role) {
      continue;
    }
    if (agentIds.has(participant.agentId)) {
      continue;
    }
    agentIds.add(participant.agentId);
    assignments.push({
      assignmentId: input.nextId("assignment"),
      taskId: input.taskId,
      threadId: input.threadId,
      sourceMessageId: input.sourceMessageId,
      assignmentRole: "agent",
      agentId: participant.agentId,
      displayName: `@${participant.agentId}`,
      executorKind: "agent_adapter",
      adapterKind: toCoreAgentKind(participant.agentId),
      executable: true,
      status: "queued"
    });
  }

  return assignments;
}

function roleCallAssignment(input: {
  roleCall: RoleCall;
  role?: WorkgroupRoleRunMetadata;
  agentId: AgentId;
  runId: string;
  nextId(prefix: string): string;
}): WorkgroupTaskAssignmentMetadata {
  return {
    assignmentId: input.nextId("assignment"),
    taskId: input.roleCall.id,
    threadId: input.roleCall.threadId,
    sourceMessageId: input.roleCall.parentMessageId ?? input.roleCall.id,
    assignmentRole: "role",
    agentId: input.agentId,
    roleHandle: input.roleCall.calleeRole,
    displayName: input.role?.displayName ?? `@${input.roleCall.calleeRole}`,
    executorKind: input.role?.executorKind ?? "agent_adapter",
    adapterKind: input.role?.adapterKind ?? toCoreAgentKind(input.agentId),
    executable: true,
    runId: input.runId,
    status: "running"
  };
}

function assignmentForParticipant(
  assignments: WorkgroupTaskAssignmentMetadata[],
  participant: WorkgroupMentionParticipant
): WorkgroupTaskAssignmentMetadata | undefined {
  if (participant.role) {
    return assignments.find(
      (assignment) =>
        assignment.assignmentRole === "role" &&
        assignment.roleHandle === participant.role?.roleHandle
    );
  }
  return assignments.find(
    (assignment) =>
      assignment.assignmentRole === "agent" &&
      assignment.agentId === participant.agentId
  );
}

function assignmentSummary(
  assignments: WorkgroupTaskAssignmentMetadata[]
): string {
  if (assignments.length === 0) {
    return "No participants were assigned.";
  }
  const labels = assignments.map((assignment) =>
    assignment.roleHandle ? `@${assignment.roleHandle}` : assignment.displayName
  );
  const executableCount = assignments.filter((assignment) => assignment.executable).length;
  if (executableCount === 0) {
    return `Assigned ${labels.join(", ")}; no executable runs are available yet.`;
  }
  return `Assigned ${labels.join(", ")} to this task.`;
}

function assignmentChips(
  assignments: WorkgroupTaskAssignmentMetadata[]
): TimelineEventMetadata["chips"] {
  return assignments.slice(0, 8).map((assignment) => ({
    kind: "assignment_created",
    label: assignment.roleHandle ? `@${assignment.roleHandle}` : assignment.displayName,
    tone: assignment.executable ? "accent" : "neutral"
  }));
}

function resolveWorkflowRequest(
  text: string,
  workflowInput?: CollaborationWorkflowInput
): { text: string; workflow?: CollaborationWorkflowInput } {
  const command = parseWorkflowCommand(text);
  const workflow = workflowInput
    ? normalizeWorkflowInput(workflowInput)
    : command.workflow;
  return {
    text: command.text,
    workflow
  };
}

function parseWorkflowCommand(text: string): {
  text: string;
  workflow?: CollaborationWorkflowInput;
} {
  const trimmed = text.trim();
  if (!trimmed.toLowerCase().startsWith("/workflow")) {
    return { text };
  }
  const tokens = trimmed.split(/\s+/);
  const mode = tokens[1];
  if (!isCollaborationWorkflowMode(mode)) {
    throw new Error("workflow mode must be handoff, review_loop, or panel_discussion");
  }
  const rest: string[] = [];
  const input: CollaborationWorkflowInput = defaultWorkflowInput(mode);
  for (const token of tokens.slice(2)) {
    const [key, rawValue] = token.split("=", 2);
    if (rawValue !== undefined && (key === "max" || key === "max_rounds")) {
      input.maxRounds = Number(rawValue);
      continue;
    }
    if (rawValue !== undefined && key === "stop") {
      input.stopCondition = rawValue.replace(/_/g, " ");
      continue;
    }
    if (rawValue !== undefined && key === "outputs") {
      input.expectedOutputs = rawValue.split(",").map((entry) => entry.trim());
      continue;
    }
    rest.push(token);
  }
  return {
    text: rest.join(" "),
    workflow: normalizeWorkflowInput(input)
  };
}

function defaultWorkflowInput(
  mode: CollaborationWorkflowMode
): CollaborationWorkflowInput {
  if (mode === "handoff") {
    return {
      mode,
      maxRounds: 1,
      stopCondition: "handoff_summary_recorded",
      expectedOutputs: ["handoff_summary", "linked_run_evidence"],
      summary: "Handoff workflow"
    };
  }
  if (mode === "panel_discussion") {
    return {
      mode,
      maxRounds: 3,
      stopCondition: "all_participants_reported OR max_rounds_reached",
      expectedOutputs: ["participant_findings", "final_synthesis"],
      summary: "Panel discussion"
    };
  }
  return {
    mode,
    maxRounds: 2,
    stopCondition: "reviewer_passed OR max_rounds_reached",
    expectedOutputs: ["reviewer_findings", "final_summary", "linked_run_evidence"],
    summary: "Review loop"
  };
}

function normalizeWorkflowInput(
  input: CollaborationWorkflowInput
): CollaborationWorkflowInput {
  if (!isCollaborationWorkflowMode(input.mode)) {
    throw new Error("workflow mode must be handoff, review_loop, or panel_discussion");
  }
  const maxRounds = input.maxRounds;
  const allowedMax = maxWorkflowRoundsByMode[input.mode];
  if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > allowedMax) {
    throw new Error(
      `workflow maxRounds must be between 1 and ${allowedMax} for ${input.mode}`
    );
  }
  return {
    mode: input.mode,
    maxRounds,
    stopCondition: boundedRequiredText(input.stopCondition, "workflow stopCondition", 160),
    expectedOutputs: normalizeExpectedOutputs(input.expectedOutputs),
    summary:
      input.summary === undefined
        ? defaultWorkflowInput(input.mode).summary
        : boundedRequiredText(input.summary, "workflow summary", 160)
  };
}

function normalizeExpectedOutputs(input: unknown): string[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 8) {
    throw new Error("workflow expectedOutputs must contain 1 to 8 entries");
  }
  return input.map((entry) =>
    boundedRequiredText(entry, "workflow expectedOutputs", 80)
  );
}

function boundedRequiredText(
  input: unknown,
  label: string,
  maxLength: number
): string {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  const trimmed = input.trim();
  if (trimmed.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer`);
  }
  return trimmed;
}

function isCollaborationWorkflowMode(
  value: unknown
): value is CollaborationWorkflowMode {
  return (
    typeof value === "string" &&
    workflowModeSet.has(value as CollaborationWorkflowMode)
  );
}

function createWorkflowState(input: {
  workflowId: string;
  workflow: CollaborationWorkflowInput;
  taskId: string;
  threadId: string;
  sourceMessageId: string;
  assignments: WorkgroupTaskAssignmentMetadata[];
  createdAt: string;
  updatedAt: string;
}): CollaborationWorkflowState {
  const participants = workflowParticipants(input.assignments);
  const hasExecutableParticipants = participants.some(
    (participant) => participant.executable
  );
  return {
    workflowId: input.workflowId,
    mode: input.workflow.mode,
    status: hasExecutableParticipants ? "active" : "completed",
    taskId: input.taskId,
    threadId: input.threadId,
    sourceMessageId: input.sourceMessageId,
    maxRounds: input.workflow.maxRounds,
    currentRound: 1,
    stopCondition: input.workflow.stopCondition,
    expectedOutputs: input.workflow.expectedOutputs,
    summary: input.workflow.summary ?? defaultWorkflowInput(input.workflow.mode).summary ?? input.workflow.mode,
    participants,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    completedAt: hasExecutableParticipants ? undefined : input.updatedAt
  };
}

function refreshWorkflowState(
  state: CollaborationWorkflowState,
  assignments: WorkgroupTaskAssignmentMetadata[],
  updatedAt: string
): CollaborationWorkflowState {
  const participants = workflowParticipants(assignments);
  const completed = participants.every((participant) =>
    workflowParticipantIsTerminal(participant)
  );
  return {
    ...state,
    status: completed ? "completed" : "active",
    participants,
    updatedAt,
    completedAt: completed ? updatedAt : undefined
  };
}

function completeWorkflowState(
  state: CollaborationWorkflowState,
  updatedAt: string
): CollaborationWorkflowState {
  return {
    ...state,
    status: "completed",
    currentRound: Math.min(state.maxRounds, Math.max(1, state.currentRound)),
    updatedAt,
    completedAt: state.completedAt ?? updatedAt
  };
}

function workflowParticipants(
  assignments: WorkgroupTaskAssignmentMetadata[]
): CollaborationWorkflowParticipant[] {
  return assignments.map((assignment) => ({
    assignmentId: assignment.assignmentId,
    label: assignment.roleHandle ? `@${assignment.roleHandle}` : assignment.displayName,
    assignmentRole: assignment.assignmentRole,
    agentId: assignment.agentId,
    roleHandle: assignment.roleHandle,
    executorKind: assignment.executorKind,
    executable: assignment.executable,
    runId: assignment.runId,
    status: assignment.status
  }));
}

function workflowHasExecutableParticipants(
  state: Pick<CollaborationWorkflowState, "participants">
): boolean {
  return state.participants.some((participant) => participant.executable);
}

function workflowParticipantIsTerminal(
  participant: CollaborationWorkflowParticipant
): boolean {
  if (!participant.executable) {
    return true;
  }
  return (
    participant.status === "completed" ||
    participant.status === "failed" ||
    participant.status === "cancelled" ||
    participant.status === "skipped"
  );
}

function workflowStartKind(
  mode: CollaborationWorkflowMode
): Extract<
  TimelineEventKind,
  "workflow_handoff" | "workflow_review_requested"
> {
  return mode === "handoff" ? "workflow_handoff" : "workflow_review_requested";
}

function workflowStartTitle(mode: CollaborationWorkflowMode): string {
  if (mode === "handoff") {
    return "Handoff started";
  }
  if (mode === "panel_discussion") {
    return "Panel discussion started";
  }
  return "Review requested";
}

function workflowStartSummary(state: CollaborationWorkflowState): string {
  return `${workflowModeLabel(state.mode)} started with ${state.participants.length} participant(s), max ${state.maxRounds} round(s), stop: ${state.stopCondition}.`;
}

function workflowCompletionSummary(state: CollaborationWorkflowState): string {
  return `${workflowModeLabel(state.mode)} completed after ${state.currentRound}/${state.maxRounds} round(s).`;
}

function workflowModeLabel(mode: CollaborationWorkflowMode): string {
  if (mode === "handoff") {
    return "Handoff";
  }
  if (mode === "panel_discussion") {
    return "Panel discussion";
  }
  return "Review loop";
}

function workflowChips(
  state: CollaborationWorkflowState
): TimelineEventMetadata["chips"] {
  return [
    {
      kind: workflowStartKind(state.mode),
      label: workflowModeLabel(state.mode),
      tone: "accent"
    },
    {
      kind: "system_event",
      label: `rounds ${state.currentRound}/${state.maxRounds}`,
      tone: state.status === "completed" ? "success" : "warning"
    },
    {
      kind: "system_event",
      label: state.stopCondition,
      tone: "neutral"
    },
    ...state.expectedOutputs.slice(0, 3).map((output) => ({
      kind: "artifact_created" as const,
      label: output,
      tone: "neutral" as const
    }))
  ];
}

function timelineEvent(input: {
  kind: TimelineEventKind;
  actor: TimelineEventMetadata["actor"];
  title?: string;
  summary?: string;
  status?: string;
  tone?: TimelineEventMetadata["tone"];
  taskId?: string;
  runId?: string;
  workflowId?: string;
  assignmentId?: string;
  assignmentIds?: string[];
  chips?: TimelineEventMetadata["chips"];
}): TimelineEventMetadata {
  return {
    kind: input.kind,
    actor: input.actor,
    title: boundedTimelineText(input.title, 120),
    summary: boundedTimelineText(input.summary, 240),
    status: boundedTimelineText(input.status, 48),
    tone: input.tone,
    linkedIds: {
      taskId: boundedTimelineText(input.taskId, 120),
      runId: boundedTimelineText(input.runId, 120),
      workflowId: boundedTimelineText(input.workflowId, 120),
      assignmentId: boundedTimelineText(input.assignmentId, 120),
      assignmentIds: input.assignmentIds?.slice(0, 12).map((id) => id.slice(0, 120))
    },
    chips: input.chips?.slice(0, 10).map((chip) => ({
      kind: chip.kind,
      label: boundedTimelineText(chip.label, 80) ?? "",
      tone: chip.tone,
      tab: chip.tab
    }))
  };
}

function metadataTimelineEvent(
  metadata: ConversationMessage["metadata"]
): TimelineEventMetadata | undefined {
  const value = metadata?.timelineEvent;
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const event = value as TimelineEventMetadata;
  if (
    typeof event.kind !== "string" ||
    typeof event.actor !== "string"
  ) {
    return undefined;
  }
  return event;
}

function terminalRunTimelineKind(status: RunStatus): TimelineEventKind {
  if (status === "failed") {
    return "run_failed";
  }
  if (status === "cancelled") {
    return "run_cancelled";
  }
  return "run_completed";
}

function terminalRunTitle(
  message: ConversationMessage,
  status: RunStatus
): string {
  const assignment = metadataAssignment(message.metadata);
  const actor = assignment?.roleHandle
    ? `@${assignment.roleHandle}`
    : message.agentKind
      ? `@${toAgentId(message.agentKind)}`
      : "Run";
  if (status === "failed") {
    return `${actor} run failed`;
  }
  if (status === "cancelled") {
    return `${actor} run cancelled`;
  }
  return `${actor} run completed`;
}

function isTerminalRunTimelineKind(
  kind: TimelineEventKind | undefined
): boolean {
  return (
    kind === "run_completed" ||
    kind === "run_failed" ||
    kind === "run_cancelled"
  );
}

function terminalStatusTone(
  status: RunStatus
): NonNullable<TimelineEventMetadata["tone"]> {
  if (status === "completed") {
    return "success";
  }
  if (status === "failed" || status === "cancelled") {
    return "danger";
  }
  return "warning";
}

function boundedTimelineText(
  value: string | undefined,
  maxLength: number
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length > maxLength
    ? `${trimmed.slice(0, Math.max(0, maxLength - 1))}...`
    : trimmed;
}

function roomMetadataForThread(thread: ConversationThread): RoomMetadata {
  const metadata = thread.metadata ?? {};
  const roomType =
    parseRoomType(metadata.roomType) ??
    (metadata.legacyRunImport === true ? "legacy" : "custom");
  return {
    roomType,
    roomHandle:
      normalizeRoomHandle(
        typeof metadata.roomHandle === "string" ? metadata.roomHandle : thread.title
      ) ??
      normalizeRoomHandle(thread.id) ??
      "room",
    description:
      typeof metadata.description === "string" && metadata.description.trim()
        ? metadata.description.trim()
        : undefined,
    pinned: metadata.pinned === true,
    sharedContextEnabled: metadata.sharedContextEnabled !== false
  };
}

function parseRoomType(value: unknown): RoomType | undefined {
  if (value === "default" || value === "custom" || value === "legacy") {
    return value;
  }
  return undefined;
}

function normalizeRoomHandle(value: string): string | undefined {
  const normalized = value
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return normalized.length > 0 ? normalized : undefined;
}

function isDefaultRoom(thread: ConversationThread, handle: string): boolean {
  const metadata = thread.metadata ?? {};
  return metadata.roomType === "default" && metadata.roomHandle === handle;
}

function compareThreadSummaries(
  left: ThreadSummary,
  right: ThreadSummary
): number {
  const leftProject = left.projectId ?? "";
  const rightProject = right.projectId ?? "";
  if (leftProject !== rightProject) {
    return leftProject.localeCompare(rightProject);
  }
  const leftPinned = left.pinned === true ? 0 : 1;
  const rightPinned = right.pinned === true ? 0 : 1;
  if (leftPinned !== rightPinned) {
    return leftPinned - rightPinned;
  }
  const leftOrder = defaultRoomOrder.get(left.roomHandle ?? "") ?? 1000;
  const rightOrder = defaultRoomOrder.get(right.roomHandle ?? "") ?? 1000;
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  return right.updatedAt.localeCompare(left.updatedAt);
}

function toThreadDetail(
  thread: ConversationThread,
  messages: ConversationMessage[],
  runStatusById: Map<string, RunStatus>,
  roleCallSummariesByMessageId: ReadonlyMap<string, RoleCallUiSummary> = new Map()
): ThreadDetail {
  const threadMessages = messages
    .map((message) =>
      toThreadMessage(message, runStatusById, roleCallSummariesByMessageId)
    )
    .filter((message): message is ThreadMessage => message !== undefined);
  const room = roomMetadataForThread(thread);
  return {
    id: thread.id,
    title: thread.title,
    projectId: thread.projectId,
    roomType: room.roomType,
    roomHandle: room.roomHandle,
    description: room.description,
    pinned: room.pinned,
    sharedContextEnabled: room.sharedContextEnabled,
    createdAt: thread.createdAt,
    updatedAt: latestUpdatedAt(thread, messages),
    messages: threadMessages
  };
}

function todoBelongsToRoleCallGroup(
  todo: RoleTodo,
  roleCallIds: ReadonlySet<string>
): boolean {
  if (todo.sourceRoleCallId && roleCallIds.has(todo.sourceRoleCallId)) {
    return true;
  }
  return todo.relatedRoleCallIds.some((roleCallId) => roleCallIds.has(roleCallId));
}

function latestRoleCallSummaryTimestamp(
  calls: readonly RoleCall[],
  todos: readonly RoleTodo[],
  events: readonly RoleCallEvent[]
): string | undefined {
  return [
    ...calls.flatMap((call) => [
      call.completedAt,
      call.startedAt,
      call.createdAt
    ]),
    ...todos.map((todo) => todo.updatedAt),
    ...events.map((event) => event.createdAt)
  ]
    .filter((value): value is string => typeof value === "string")
    .sort((left, right) => right.localeCompare(left))[0];
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
    `role_skills: ${
      role.defaultSkillReferences
        ?.map((reference) =>
          reference.scope ? `${reference.scope}:${reference.id}` : reference.id
        )
        .join(", ") ?? "none"
    }`,
    `role_context_policy: ${role.contextPolicy.scope}; approved_memory=${String(
      role.contextPolicy.includeApprovedMemory
    )}; thread_summary=${String(role.contextPolicy.includeThreadSummary)}`,
    `role_approval_policy: ${role.approvalPolicy.summary}`
  ];
}

function roleProtocolReferences(
  role: WorkgroupRoleRunMetadata | undefined,
  roles: readonly WorkgroupRole[]
): string[] {
  if (!role) {
    return [];
  }
  const caller = roles.find((entry) => entry.handle === role.roleHandle);
  const callerPolicy = caller ? roleDelegationPolicy(caller) : undefined;
  const available = roles
    .filter(
      (entry) =>
        entry.enabled &&
        entry.handle !== role.roleHandle &&
        callerPolicy !== undefined &&
        roleDelegationPolicyAllowsTarget(callerPolicy, entry)
    )
    .slice(0, 12)
    .map((entry) =>
      `@${entry.handle}: ${entry.purpose}; executor=${executorReference(entry)}; capability=${entry.capabilitySummary}`
    );
  return [
    "role_call_protocol: Agent Hub owns delegation. Do not simulate subagents, worker roles, or hidden role chats inside your own response.",
    "role_call_protocol: To request another role, emit a line-start role call exactly as '@role bounded task'. Agent Hub will parse it into a RoleCall.",
    "role_call_protocol: Delegation-only requests do not require repository reconnaissance. Emit the role call first and let Agent Hub schedule the callee.",
    "role_call_protocol: Do not inspect the repository merely to discover available roles or delegation syntax; use the role directory below.",
    "role_call_protocol: Mentions inside prose or code blocks are not delegation requests. Use separate line-start calls only.",
    `available_role_calls: ${available.length > 0 ? available.join(" | ") : "none"}`
  ];
}

function roleDefinitionsForWorkgroupRoles(
  roles: readonly WorkgroupRole[]
): RoleDefinition[] {
  return roles
    .filter((role) => role.enabled)
    .map((role) =>
      validateRoleDefinition({
        id: role.id,
        handle: role.handle,
        displayName: role.displayName,
        purpose: role.purpose,
        defaultInstructions: role.defaultInstructions,
        capabilities: roleCapabilities(role),
        permissions: rolePermissions(role),
        contextPolicy: {
          scope: role.contextPolicy.scope,
          includeApprovedMemory: role.contextPolicy.includeApprovedMemory,
          includeThreadSummary: role.contextPolicy.includeThreadSummary,
          instructions: [...role.contextPolicy.instructions]
        },
        approvalPolicy: {
          requiredFor: [...role.approvalPolicy.requiredFor],
          summary: role.approvalPolicy.summary
        },
        delegationPolicy: roleDelegationPolicy(role),
        intakePolicy: roleIntakePolicy(role),
        executor: roleExecutor(role),
        trustLevel: presetWorkgroupRoles.some((preset) => preset.handle === role.handle)
          ? "preset"
          : "user_defined",
        enabled: role.enabled
      })
    );
}

function executorReference(role: WorkgroupRole): string {
  return role.executor.kind === "agent_adapter"
    ? `agent_adapter/${role.executor.adapterKind}`
    : `${role.executor.kind}/reserved`;
}

function roleCapabilities(role: WorkgroupRole): string[] {
  const explicit = String(role.metadata?.capabilities ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (explicit.length > 0) {
    return explicit;
  }
  const defaults: Record<string, string[]> = {
    analyst: ["analysis", "planning"],
    operator: ["operations", "local_execution"],
    reviewer: ["review", "risk"],
    researcher: ["research", "context"],
    writer: ["writing", "documentation"],
    engineer: ["implementation", "local_execution"],
    memory: ["memory", "knowledge"]
  };
  return defaults[role.handle] ?? [role.handle];
}

function rolePermissions(role: WorkgroupRole): RoleDefinition["permissions"] {
  const permissionSet = new Set(role.permissions);
  const canRunCommands =
    permissionSet.has("run_commands") ||
    permissionSet.has("local_execution") ||
    permissionSet.has("write_isolated_worktree");
  const canEditFiles =
    permissionSet.has("write_files") || permissionSet.has("write_isolated_worktree");
  return {
    canReadFiles:
      permissionSet.has("read_project_context") ||
      permissionSet.has("read_thread_context") ||
      permissionSet.has("read_run_evidence"),
    canEditFiles,
    canRunCommands,
    canUseNetwork: permissionSet.has("network"),
    canAskUser: permissionSet.has("ask_user"),
    requiresApprovalForShell: true,
    requiresApprovalForFileWrite: true
  };
}

function roleDelegationPolicy(role: WorkgroupRole): RoleDefinition["delegationPolicy"] {
  if (role.handle === "analyst") {
    return {
      canInitiateRoleCalls: true,
      allowedIntentTypes: ["delegate", "request_analysis", "request_review", "request_evidence"],
      allowedTargetRoles: ["operator", "reviewer", "researcher", "writer", "engineer"]
    };
  }
  if (role.handle === "operator") {
    return {
      canInitiateRoleCalls: true,
      allowedIntentTypes: ["delegate", "request_review", "request_evidence"],
      allowedTargetRoles: ["reviewer", "researcher"],
      requiresApprovalForTargets: ["engineer"]
    };
  }
  if (role.handle === "engineer") {
    return {
      canInitiateRoleCalls: true,
      allowedIntentTypes: ["request_review", "request_evidence"],
      allowedTargetRoles: ["reviewer", "operator"]
    };
  }
  return {
    canInitiateRoleCalls: false,
    allowedIntentTypes: [],
    allowedTargetRoles: [],
    allowedTargetCapabilities: [],
    requiresApprovalForTargets: ["operator", "engineer"]
  };
}

function roleDelegationPolicyAllowsTarget(
  policy: RoleDefinition["delegationPolicy"],
  target: WorkgroupRole
): boolean {
  if (!policy.canInitiateRoleCalls) {
    return false;
  }
  const allowedTargetRoles = policy.allowedTargetRoles ?? [];
  const allowedTargetCapabilities = policy.allowedTargetCapabilities ?? [];
  if (allowedTargetRoles.includes(target.handle) || allowedTargetRoles.includes("*")) {
    return true;
  }
  const targetCapabilities = roleCapabilities(target);
  if (
    targetCapabilities.some((capability) =>
      allowedTargetCapabilities.includes(capability)
    )
  ) {
    return true;
  }
  return allowedTargetRoles.length === 0 && allowedTargetCapabilities.length === 0;
}

function roleIntakePolicy(role: WorkgroupRole): RoleDefinition["intakePolicy"] {
  const acceptedIntentTypes: RoleDefinition["intakePolicy"]["acceptedIntentTypes"] =
    role.handle === "reviewer"
      ? ["delegate", "request_review"]
      : role.handle === "operator"
        ? ["delegate", "request_evidence"]
        : role.handle === "analyst"
          ? ["delegate", "request_analysis", "request_review"]
          : ["delegate", "request_analysis", "request_review", "request_evidence"];
  return {
    acceptsRoleCalls: true,
    acceptedIntentTypes,
    canReject: true,
    canDefer: true
  };
}

function roleExecutor(role: WorkgroupRole): RoleDefinition["executor"] {
  if (role.executor.kind === "agent_adapter") {
    return {
      kind: "agent_adapter",
      adapter: role.executor.adapterKind
    };
  }
  if (role.executor.kind === "workflow") {
    return {
      kind: "local_workflow",
      workflowId: role.executor.configRef ?? role.handle
    };
  }
  if (role.executor.kind === "llm_api") {
    return {
      kind: "llm_api",
      modelRef: role.executor.configRef ?? role.handle
    };
  }
  return {
    kind: "human",
    configRef: role.executor.configRef,
    unavailableReason: role.executor.unavailableReason
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

function toThreadMessage(
  message: ConversationMessage,
  runStatusById: Map<string, RunStatus>,
  roleCallSummariesByMessageId: ReadonlyMap<string, RoleCallUiSummary>
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
    return toAssistantMessage(
      message,
      roleCallSummariesByMessageId.get(message.id)
    );
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
    timelineEvent: metadataTimelineEvent(message.metadata),
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
    taskId: metadataString(message.metadata, "taskId"),
    taskTitle: metadataString(message.metadata, "taskTitle"),
    roleCallId: metadataString(message.metadata, "roleCallId"),
    assignment: metadataAssignment(message.metadata),
    timelineEvent: metadataTimelineEvent(message.metadata),
    createdAt: message.createdAt
  };
}

function toAssistantMessage(
  message: ConversationMessage,
  roleCallSummary?: RoleCallUiSummary
): AssistantMessage {
  return {
    id: message.id,
    threadId: message.threadId,
    type: "assistant",
    text: message.content,
    agentId: message.agentKind ? toAgentId(message.agentKind) : undefined,
    runId: message.runId,
    status: message.status ? toDesktopRunStatus(message.status) : undefined,
    assignment: metadataAssignment(message.metadata),
    roleCallSummary:
      roleCallSummary ??
      roleCallSummaryFromMetadata(message.metadata?.roleCallSummary),
    timelineEvent: metadataTimelineEvent(message.metadata),
    createdAt: message.createdAt
  };
}

function toSystemMessage(message: ConversationMessage): SystemMessage {
  return {
    id: message.id,
    threadId: message.threadId,
    type: "system",
    text: message.content,
    metadata: message.metadata,
    timelineEvent: metadataTimelineEvent(message.metadata),
    createdAt: message.createdAt
  };
}

function metadataString(
  metadata: ConversationMessage["metadata"],
  key: string
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function metadataAssignment(
  metadata: ConversationMessage["metadata"]
): WorkgroupTaskAssignmentMetadata | undefined {
  const value = metadata?.assignment;
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const assignment = value as WorkgroupTaskAssignmentMetadata;
  if (
    typeof assignment.assignmentId !== "string" ||
    typeof assignment.taskId !== "string" ||
    typeof assignment.displayName !== "string" ||
    typeof assignment.executorKind !== "string"
  ) {
    return undefined;
  }
  return assignment;
}

function metadataRoleRun(
  metadata: ConversationMessage["metadata"]
): WorkgroupRoleRunMetadata | undefined {
  const value = metadata?.role;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const role = value as WorkgroupRoleRunMetadata;
  if (
    typeof role.roleId !== "string" ||
    typeof role.roleHandle !== "string" ||
    typeof role.displayName !== "string" ||
    typeof role.executorKind !== "string"
  ) {
    return undefined;
  }
  return role;
}

function runCardRoleHandle(message: ConversationMessage): string | undefined {
  const role = metadataRoleRun(message.metadata);
  if (role?.roleHandle.trim()) {
    return role.roleHandle;
  }
  const assignment = metadataAssignment(message.metadata);
  return typeof assignment?.roleHandle === "string" &&
    assignment.roleHandle.trim().length > 0
    ? assignment.roleHandle
    : undefined;
}

function messageParticipantHandle(message: ConversationMessage): string {
  const roleHandle = runCardRoleHandle(message);
  if (roleHandle) {
    return `@${roleHandle}`;
  }
  return message.agentKind ? `@${toAgentId(message.agentKind)}` : "Assistant";
}

function agentSessionIdFromEvents(events: RunEvent[]): string | undefined {
  for (const event of events) {
    const adapterEvent = event.payload.adapterEvent;
    if (!adapterEvent || typeof adapterEvent !== "object" || Array.isArray(adapterEvent)) {
      continue;
    }
    const record = adapterEvent as Record<string, unknown>;
    const sessionId = record.thread_id ?? record.threadId ?? record.session_id;
    if (
      typeof sessionId === "string" &&
      sessionId.trim().length > 0 &&
      record.type === "thread.started"
    ) {
      return sessionId.trim();
    }
  }
  return undefined;
}

function metadataWorkflowState(metadata: JsonObject | undefined): CollaborationWorkflowState | undefined {
  const value = metadata?.workflowState;
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const state = value as CollaborationWorkflowState;
  if (
    typeof state.workflowId !== "string" ||
    !isCollaborationWorkflowMode(state.mode) ||
    typeof state.taskId !== "string" ||
    typeof state.threadId !== "string" ||
    typeof state.maxRounds !== "number" ||
    !Array.isArray(state.participants)
  ) {
    return undefined;
  }
  return state;
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

function parseAgentId(
  value: unknown,
  availability: AgentAvailabilityOptions
): AgentId {
  if (isAgentId(value) && isAgentKindEnabled(toCoreAgentKind(value), availability)) {
    return value;
  }
  if (value === "fake") {
    throw new Error("fake agent is disabled outside Agent Hub debug/development mode");
  }
  throw new Error("agent must be fake, codex, or claude");
}

function availableDesktopAgents(availability: AgentAvailabilityOptions): AgentId[] {
  return (["fake", "codex", "claude"] as const).filter((agentId) =>
    isAgentKindEnabled(toCoreAgentKind(agentId), availability)
  );
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

function contextSourceMessagesForParticipant(
  messages: ConversationMessage[],
  participant: { agentId: AgentId; roleHandle?: string }
): ConversationMessage[] {
  const assistantRunIds = new Set(
    messages
      .filter((message) => isAssistantContextMessage(message) && message.runId)
      .map((message) => message.runId as string)
  );
  return messages.filter((message) => {
    if (isPendingAssistantOutputMessage(message) || isInternalTimelineMessage(message)) {
      return false;
    }
    if (
      message.kind === "run_card" &&
      message.runId &&
      assistantRunIds.has(message.runId)
    ) {
      return false;
    }
    if (message.role === "user") {
      return userMessageTargetsParticipant(message, participant);
    }
    if (message.role === "assistant" || message.kind === "run_card") {
      return messageBelongsToParticipant(message, participant);
    }
    return true;
  });
}

function messageBelongsToParticipant(
  message: ConversationMessage,
  participant: { agentId: AgentId; roleHandle?: string }
): boolean {
  if (message.agentKind && toAgentId(message.agentKind) !== participant.agentId) {
    return false;
  }
  const messageRoleHandle = runCardRoleHandle(message);
  return participant.roleHandle
    ? messageRoleHandle === participant.roleHandle
    : messageRoleHandle === undefined;
}

function userMessageTargetsParticipant(
  message: ConversationMessage,
  participant: { agentId: AgentId; roleHandle?: string }
): boolean {
  const roleMentions = metadataRoleMentions(message.metadata);
  if (participant.roleHandle) {
    return (
      roleMentions?.some(
        (roleMention) => roleMention.roleHandle === participant.roleHandle
      ) ?? false
    );
  }
  if (roleMentions && roleMentions.length > 0) {
    return false;
  }
  const mentions = metadataAgents(message.metadata);
  return mentions.length === 0 || mentions.includes(participant.agentId);
}

function isInternalTimelineMessage(message: ConversationMessage): boolean {
  return (
    message.role === "system" &&
    (typeof message.metadata?.taskEvent === "string" ||
      typeof message.metadata?.workflowEvent === "string")
  );
}

function terminalAssistantContent(run: ConversationRunSnapshot): string {
  const roleResultSummary = latestRoleResultSummary(run.events);
  if (roleResultSummary) {
    return truncateAssistantContent(roleResultSummary);
  }
  const extracted = extractAgentFacingOutput(
    {
      events: run.events.map(toAgentOutputEvent)
    },
    {
      includeRawStreams: false,
      includeTerminalSummaries: false
    }
  ).trim();
  return truncateAssistantContent(extracted || terminalStatusSummary(run));
}

function latestRoleResultSummary(events: readonly RunEvent[]): string | undefined {
  for (const event of [...events].reverse()) {
    const message =
      typeof event.payload.message === "string"
        ? event.payload.message.trim()
        : "";
    if (!message) {
      continue;
    }
    const summary = roleResultSummaryFromText(message);
    if (summary) {
      return summary;
    }
  }
  return undefined;
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
  if (run.status === "completed") {
    return `@${run.agentId} completed without agent-facing output. Review evidence is available.`;
  }
  if (run.status === "cancelled") {
    return `@${run.agentId} was cancelled before producing agent-facing output. Review evidence is available.`;
  }
  return `@${run.agentId} failed before producing agent-facing output. Review evidence is available.`;
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
