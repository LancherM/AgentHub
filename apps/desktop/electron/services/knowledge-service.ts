import {
  type ConversationMessage,
  type ConversationThread,
  type ConversationThreadSummary,
  type MemoryItem,
  type ProjectRepository,
  type RunArtifact,
  type Task,
  type TaskRepository,
  type TaskRun,
  type TaskRunRepository
} from "@agent-hub/core";
import type { JsonObject } from "@agent-hub/shared";
import type {
  MemoryAutoApprovalAudit,
  KnowledgeAuditEvent,
  KnowledgeItem,
  KnowledgeSourceLink,
  KnowledgeWorkspace,
  KnowledgeWorkspaceMetrics
} from "../../src/lib/types";
import type { DesktopServiceContext } from "./project-service";

const REVIEW_DECISION_ARTIFACT_KIND = "review_decision";
const MAX_KNOWLEDGE_PREVIEW_CHARS = 1_200;

export interface KnowledgeService {
  getWorkspace(projectId: string): Promise<KnowledgeWorkspace>;
}

export function createKnowledgeService(
  context: DesktopServiceContext
): KnowledgeService {
  return new RepositoryKnowledgeService(context);
}

class RepositoryKnowledgeService implements KnowledgeService {
  private readonly projects: ProjectRepository;
  private readonly tasks: TaskRepository;
  private readonly runs: TaskRunRepository;

  constructor(private readonly context: DesktopServiceContext) {
    this.projects = context.repositories.projectRepository;
    this.tasks = context.repositories.taskRepository;
    this.runs = context.repositories.taskRunRepository;
  }

  async getWorkspace(projectId: string): Promise<KnowledgeWorkspace> {
    const project = await this.projects.get(projectId);
    if (!project) {
      throw new Error(`project ${projectId} not found`);
    }

    const [memoryItems, threads, tasks] = await Promise.all([
      this.context.repositories.memoryItemRepository.listByProjectId(projectId),
      this.context.repositories.conversationThreadRepository.list(projectId),
      this.tasks.listByProjectId(projectId)
    ]);
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const runs = await this.listRunsForTasks(tasks);
    const runById = new Map(runs.map((run) => [run.id, run]));

    const [summaryItems, decisionItems] = await this.summaryItems(
      projectId,
      threads
    );
    const items = [
      ...memoryItems.map((item) =>
        knowledgeItemFromMemory(item, taskById, runs)
      ),
      ...summaryItems,
      ...decisionItems,
      ...(await this.reviewDecisionItems(projectId, tasks, runs, taskById, runById))
    ].sort((left, right) =>
      right.updatedAt === left.updatedAt
        ? right.id.localeCompare(left.id)
        : right.updatedAt.localeCompare(left.updatedAt)
    );

    return {
      projectId,
      generatedAt: this.context.now(),
      metrics: workspaceMetrics(items),
      items
    };
  }

  private async listRunsForTasks(tasks: Task[]): Promise<TaskRun[]> {
    const runsByTask = await Promise.all(
      tasks.map((task) => this.runs.listByTaskId(task.id))
    );
    return runsByTask.flat();
  }

  private async summaryItems(
    projectId: string,
    threads: ConversationThread[]
  ): Promise<[KnowledgeItem[], KnowledgeItem[]]> {
    const summaryRows = await Promise.all(
      threads.map(async (thread) => ({
        thread,
        summary:
          await this.context.repositories.conversationThreadSummaryRepository.getByThreadId(
            thread.id
          )
      }))
    );
    const summaries: KnowledgeItem[] = [];
    const decisions: KnowledgeItem[] = [];
    for (const row of summaryRows) {
      if (!row.summary) {
        continue;
      }
      const sourceMessage = row.summary.sourceLatestMessageId
        ? await this.context.repositories.conversationMessageRepository.get(
            row.summary.sourceLatestMessageId
          )
        : undefined;
      summaries.push(
        knowledgeItemFromThreadSummary(projectId, row.thread, row.summary, sourceMessage)
      );
      decisions.push(
        ...row.summary.decisions.map((decision, index) =>
          knowledgeItemFromSummaryDecision(
            projectId,
            row.thread,
            row.summary!,
            sourceMessage,
            decision,
            index
          )
        )
      );
    }
    return [summaries, decisions];
  }

  private async reviewDecisionItems(
    projectId: string,
    tasks: Task[],
    runs: TaskRun[],
    taskById: Map<string, Task>,
    runById: Map<string, TaskRun>
  ): Promise<KnowledgeItem[]> {
    const artifactsByRun = await Promise.all(
      runs.map(async (run) => ({
        run,
        artifacts:
          await this.context.repositories.runArtifactRepository.listByRunId(run.id)
      }))
    );
    return artifactsByRun.flatMap(({ run, artifacts }) =>
      artifacts
        .filter((artifact) => artifact.kind === REVIEW_DECISION_ARTIFACT_KIND)
        .map((artifact) =>
          knowledgeItemFromReviewDecision({
            projectId,
            artifact,
            run: runById.get(run.id) ?? run,
            task: taskById.get(run.taskId) ?? tasks.find((task) => task.id === run.taskId)
          })
        )
    );
  }
}

function knowledgeItemFromMemory(
  item: MemoryItem,
  taskById: Map<string, Task>,
  runs: TaskRun[]
): KnowledgeItem {
  const task = item.taskId ? taskById.get(item.taskId) : undefined;
  const taskRuns = item.taskId
    ? runs.filter((run) => run.taskId === item.taskId)
    : [];
  const sourceLinks: KnowledgeSourceLink[] = [];
  if (task) {
    sourceLinks.push({
      kind: "task",
      id: task.id,
      taskId: task.id,
      label: task.title
    });
  }
  const latestRun = taskRuns.at(-1);
  if (latestRun) {
    sourceLinks.push({
      kind: "run",
      id: latestRun.id,
      runId: latestRun.id,
      label: latestRun.id,
      inspectorTab: "memory"
    });
  }
  const preview = boundedPreview(item.content);
  return {
    id: item.id,
    kind: "memory",
    status: item.status,
    title: memoryTitle(item),
    content: item.content,
    preview: preview.content,
    category: item.category,
    source: undefined,
    projectId: item.projectId,
    taskId: item.taskId,
    runId: latestRun?.id,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    sourceLinks,
    audit: memoryAudit(item),
    bounded: preview.bounded,
    autoApproval: parseAutoApproval(item.metadata?.autoApproval)
  };
}

function knowledgeItemFromThreadSummary(
  projectId: string,
  thread: ConversationThread,
  summary: ConversationThreadSummary,
  sourceMessage: ConversationMessage | undefined
): KnowledgeItem {
  const room = threadDisplay(thread);
  const content = [
    summary.summary,
    ...summary.openItems.map((item) => `Open: ${item}`),
    ...summary.constraints.map((item) => `Constraint: ${item}`)
  ].join("\n");
  const preview = boundedPreview(content);
  return {
    id: summary.id,
    kind: "thread_summary",
    status: "summary",
    title: `${room} thread summary`,
    content,
    preview: preview.content,
    category: "thread_summary",
    source: "thread_summary",
    projectId,
    threadId: thread.id,
    messageId: sourceMessage?.id,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    sourceLinks: threadSourceLinks(thread, sourceMessage),
    audit: [
      { at: summary.updatedAt, label: "Thread summary refreshed" },
      {
        at: summary.createdAt,
        label: "Thread summary created",
        detail: `${summary.sourceMessageCount} source message(s)`
      }
    ],
    bounded: preview.bounded
  };
}

function knowledgeItemFromSummaryDecision(
  projectId: string,
  thread: ConversationThread,
  summary: ConversationThreadSummary,
  sourceMessage: ConversationMessage | undefined,
  decision: string,
  index: number
): KnowledgeItem {
  const preview = boundedPreview(decision);
  return {
    id: `${summary.id}:decision:${index}`,
    kind: "thread_decision",
    status: "decision",
    title: decisionTitle(decision),
    content: decision,
    preview: preview.content,
    category: "decision",
    source: "thread_summary",
    projectId,
    threadId: thread.id,
    messageId: sourceMessage?.id,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    sourceLinks: threadSourceLinks(thread, sourceMessage),
    audit: [
      { at: summary.updatedAt, label: "Decision captured in thread summary" }
    ],
    bounded: preview.bounded
  };
}

function knowledgeItemFromReviewDecision(input: {
  projectId: string;
  artifact: RunArtifact;
  run: TaskRun;
  task: Task | undefined;
}): KnowledgeItem {
  const metadata = input.artifact.metadata as JsonObject;
  const reviewStatus =
    stringMetadata(metadata, "reviewStatus") === "accepted" ? "accepted" : "rejected";
  const preview = boundedPreview(input.artifact.content);
  const taskTitle = input.task?.title ?? input.run.taskId;
  return {
    id: input.artifact.id,
    kind: "review_decision",
    status: reviewStatus,
    title: `${reviewStatus === "accepted" ? "Accepted" : "Rejected"}: ${taskTitle}`,
    content: input.artifact.content,
    preview: preview.content,
    category: "decision",
    source: "review_decision",
    projectId: input.projectId,
    taskId: input.task?.id ?? input.run.taskId,
    runId: input.run.id,
    artifactId: input.artifact.id,
    createdAt: input.artifact.createdAt,
    updatedAt: input.artifact.createdAt,
    sourceLinks: [
      ...(input.task
        ? [
            {
              kind: "task" as const,
              id: input.task.id,
              taskId: input.task.id,
              label: input.task.title
            }
          ]
        : []),
      {
        kind: "run",
        id: input.run.id,
        runId: input.run.id,
        label: input.run.id,
        inspectorTab: "brief"
      },
      {
        kind: "artifact",
        id: input.artifact.id,
        artifactId: input.artifact.id,
        runId: input.run.id,
        label: input.artifact.kind,
        inspectorTab: "artifacts"
      }
    ],
    audit: [
      {
        at: input.artifact.createdAt,
        label: "Review decision recorded",
        detail: reviewStatus
      }
    ],
    bounded: preview.bounded
  };
}

function threadSourceLinks(
  thread: ConversationThread,
  sourceMessage: ConversationMessage | undefined
): KnowledgeSourceLink[] {
  return [
    {
      kind: "thread",
      id: thread.id,
      threadId: thread.id,
      label: threadDisplay(thread)
    },
    ...(sourceMessage
      ? [
          {
            kind: "message" as const,
            id: sourceMessage.id,
            threadId: thread.id,
            messageId: sourceMessage.id,
            label: `message ${sourceMessage.sequence}`
          }
        ]
      : [])
  ];
}

function workspaceMetrics(items: KnowledgeItem[]): KnowledgeWorkspaceMetrics {
  return {
    total: items.length,
    proposed: items.filter((item) => item.status === "proposed").length,
    approved: items.filter((item) => item.status === "approved").length,
    rejected: items.filter((item) => item.status === "rejected").length,
    summaries: items.filter((item) => item.kind === "thread_summary").length,
    decisions: items.filter(
      (item) => item.kind === "thread_decision" || item.kind === "review_decision"
    ).length
  };
}

function memoryTitle(item: MemoryItem): string {
  const firstLine = item.content.split(/\r?\n/, 1)[0]?.trim();
  return firstLine && firstLine.length > 0 ? firstLine : item.category;
}

function memoryAudit(item: MemoryItem): KnowledgeAuditEvent[] {
  const autoApproval = parseAutoApproval(item.metadata?.autoApproval);
  return [
    ...(autoApproval
      ? [
          {
            at: autoApproval.approvedAt,
            label: "Auto-approved memory",
            detail: `${autoApproval.policyMode}${autoApproval.riskLevel ? ` / risk ${autoApproval.riskLevel}` : ""}`
          }
        ]
      : []),
    {
      at: item.updatedAt,
      label: item.status === "proposed" ? "Memory proposed" : `Memory ${item.status}`
    },
    { at: item.createdAt, label: "Memory item created", detail: item.category }
  ];
}

function parseAutoApproval(value: unknown): MemoryAutoApprovalAudit | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const policyMode = record.policyMode;
  const approvedAt = record.approvedAt;
  if (
    policyMode !== "auto_after_review_accept" &&
    policyMode !== "auto_safe_on_success"
  ) {
    return undefined;
  }
  if (typeof approvedAt !== "string") {
    return undefined;
  }
  return {
    policyMode,
    approvedAt,
    reason: typeof record.reason === "string" ? record.reason : undefined,
    riskLevel: typeof record.riskLevel === "string" ? record.riskLevel : undefined,
    verificationStatus:
      typeof record.verificationStatus === "string"
        ? record.verificationStatus
        : undefined,
    writebackPath:
      typeof record.writebackPath === "string" ? record.writebackPath : undefined
  };
}

function decisionTitle(decision: string): string {
  const trimmed = decision.trim();
  if (trimmed.length <= 84) {
    return trimmed;
  }
  return `${trimmed.slice(0, 81)}...`;
}

function threadDisplay(thread: ConversationThread): string {
  const metadata = thread.metadata as JsonObject | undefined;
  const handle = metadata ? stringMetadata(metadata, "roomHandle") : undefined;
  return handle ? `#${handle}` : thread.title;
}

function boundedPreview(content: string): { content: string; bounded: boolean } {
  if (content.length <= MAX_KNOWLEDGE_PREVIEW_CHARS) {
    return { content, bounded: false };
  }
  return {
    content: `${content.slice(0, MAX_KNOWLEDGE_PREVIEW_CHARS)}\n[Knowledge preview truncated after ${MAX_KNOWLEDGE_PREVIEW_CHARS} characters.]`,
    bounded: true
  };
}

function stringMetadata(metadata: JsonObject, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}
