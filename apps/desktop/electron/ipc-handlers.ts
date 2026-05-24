import type {
  AgentId,
  AgentHubApi,
  ComparisonCreateInput,
  CreateThreadInput,
  CreateRunInput,
  HandoffCopyKind,
  RunEvent,
  SendThreadMessageInput,
  VerificationSettings
} from "../src/lib/types";
import { IPC_CHANNELS, runEventChannel } from "./ipc-channels";
import {
  createDesktopServiceContext,
  createProjectService,
  type DesktopServiceContext,
  type ProjectService
} from "./services/project-service";
import {
  createReviewService,
  type ReviewHandoffPlatform,
  type ReviewService
} from "./services/review-service";
import {
  createMemoryService,
  type MemoryService
} from "./services/memory-service";
import {
  createRunService,
  type RunService
} from "./services/run-service";
import {
  createThreadService,
  type ThreadService
} from "./services/thread-service";
import {
  createSettingsService,
  type SettingsService
} from "./services/settings-service";
import {
  createComparisonService,
  type ComparisonService
} from "./services/comparison-service";
import {
  createKnowledgeService,
  type KnowledgeService
} from "./services/knowledge-service";

export { IPC_CHANNELS, runEventChannel } from "./ipc-channels";

export interface DesktopServices {
  projects: ProjectService;
  runs: RunService;
  threads: ThreadService;
  review: ReviewService;
  comparison: ComparisonService;
  memory: MemoryService;
  knowledge: KnowledgeService;
  settings: SettingsService;
}

export interface DesktopServiceOptions {
  handoffPlatform?: ReviewHandoffPlatform;
}

export interface IpcEventSender {
  send(channel: string, ...args: unknown[]): void;
}

export type IpcHandler = (
  event: { sender: IpcEventSender },
  input?: unknown
) => Promise<unknown>;

export function createDesktopServices(
  context: DesktopServiceContext = createDesktopServiceContext(),
  options: DesktopServiceOptions = {}
): DesktopServices {
  const memory = createMemoryService(context);
  const review = createReviewService(context, {
    memoryService: memory,
    handoffPlatform: options.handoffPlatform
  });
  const projects = createProjectService(context);
  const settings = createSettingsService(context);
  const runs = createRunService(context, {
    reviewService: review,
    memoryService: memory,
    settingsService: settings
  });
  const comparison = createComparisonService(context);
  const knowledge = createKnowledgeService(context);
  return {
    projects,
    runs,
    threads: createThreadService({ context, projects, runs }),
    review,
    comparison,
    memory,
    knowledge,
    settings
  };
}

export function createIpcHandlers(
  services: DesktopServices
): Record<string, IpcHandler> {
  const subscriptions = new WeakMap<
    IpcEventSender,
    Map<string, () => void>
  >();

  return safeHandlers({
    [IPC_CHANNELS.projectsList]: async () => services.projects.list(),
    [IPC_CHANNELS.projectsOpen]: async (_event, input) =>
      services.projects.open(parsePath(input)),
    [IPC_CHANNELS.runsList]: async (_event, input) =>
      services.runs.listRuns(parseOptionalId(input, "projectId")),
    [IPC_CHANNELS.runsGet]: async (_event, input) =>
      services.runs.getRun(parseId(input, "runId")),
    [IPC_CHANNELS.runsCreate]: async (_event, input) =>
      services.runs.createRun(parseCreateRunInput(input)),
    [IPC_CHANNELS.runsCancel]: async (_event, input) => {
      await services.runs.cancelRun(parseId(input, "runId"));
    },
    [IPC_CHANNELS.runsSubscribe]: async (event, input) => {
      const runId = parseId(input, "runId");
      await services.runs.getRun(runId);
      unsubscribeSenderRun(subscriptions, event.sender, runId);
      const unsubscribe = services.runs.subscribe(runId, (runEvent) => {
        sendRunEvent(event.sender, runId, runEvent);
      });
      let senderSubscriptions = subscriptions.get(event.sender);
      if (!senderSubscriptions) {
        senderSubscriptions = new Map();
        subscriptions.set(event.sender, senderSubscriptions);
      }
      senderSubscriptions.set(runId, unsubscribe);
    },
    [IPC_CHANNELS.runsUnsubscribe]: async (event, input) => {
      unsubscribeSenderRun(subscriptions, event.sender, parseId(input, "runId"));
    },
    [IPC_CHANNELS.threadsList]: async () => services.threads.listThreads(),
    [IPC_CHANNELS.threadsGet]: async (_event, input) =>
      services.threads.getThread(parseId(input, "threadId")),
    [IPC_CHANNELS.threadsCreate]: async (_event, input) =>
      services.threads.createThread(parseCreateThreadInput(input)),
    [IPC_CHANNELS.threadsSendMessage]: async (_event, input) =>
      services.threads.sendMessage(parseSendThreadMessageInput(input)),
    [IPC_CHANNELS.reviewSummary]: async (_event, input) =>
      services.review.getSummary(parseId(input, "runId")),
    [IPC_CHANNELS.reviewContext]: async (_event, input) =>
      services.review.getContext(parseId(input, "runId")),
    [IPC_CHANNELS.reviewArtifacts]: async (_event, input) =>
      services.review.getArtifacts(parseId(input, "runId")),
    [IPC_CHANNELS.reviewDiff]: async (_event, input) =>
      services.review.getDiff(parseId(input, "runId")),
    [IPC_CHANNELS.reviewRisk]: async (_event, input) =>
      services.review.getRisk(parseId(input, "runId")),
    [IPC_CHANNELS.reviewVerification]: async (_event, input) =>
      services.review.getVerification(parseId(input, "runId")),
    [IPC_CHANNELS.reviewLogs]: async (_event, input) =>
      services.review.getLogs(parseId(input, "runId")),
    [IPC_CHANNELS.reviewHandoff]: async (_event, input) =>
      services.review.getHandoff(parseId(input, "runId")),
    [IPC_CHANNELS.reviewHandoffOpenWorktree]: async (_event, input) =>
      services.review.openHandoffWorktree(parseId(input, "runId")),
    [IPC_CHANNELS.reviewHandoffCopyValue]: async (_event, input) => {
      const parsed = parseHandoffCopyInput(input);
      return services.review.copyHandoffValue(parsed.runId, parsed.kind);
    },
    [IPC_CHANNELS.reviewAccept]: async (_event, input) =>
      services.review.acceptRun(parseId(input, "runId")),
    [IPC_CHANNELS.reviewReject]: async (_event, input) => {
      const parsed = parseRejectReviewInput(input);
      return services.review.rejectRun(parsed.runId, parsed.reason);
    },
    [IPC_CHANNELS.reviewRefresh]: async (_event, input) =>
      services.review.refreshReview(parseId(input, "runId")),
    [IPC_CHANNELS.comparisonListCandidates]: async (_event, input) =>
      services.comparison.listCandidates(parseId(input, "runId")),
    [IPC_CHANNELS.comparisonListForRun]: async (_event, input) =>
      services.comparison.listForRun(parseId(input, "runId")),
    [IPC_CHANNELS.comparisonCreate]: async (_event, input) =>
      services.comparison.createComparison(parseComparisonCreateInput(input)),
    [IPC_CHANNELS.memoryListProposals]: async (_event, input) =>
      services.memory.listProposals(parseId(input, "runId")),
    [IPC_CHANNELS.memoryGenerateProposals]: async (_event, input) =>
      services.memory.generateProposalsForRun(parseId(input, "runId")),
    [IPC_CHANNELS.memoryApprove]: async (_event, input) =>
      services.memory.approve(parseIdList(input, "memory ids")),
    [IPC_CHANNELS.memoryIgnore]: async (_event, input) =>
      services.memory.ignore(parseIdList(input, "memory ids")),
    [IPC_CHANNELS.knowledgeWorkspace]: async (_event, input) =>
      services.knowledge.getWorkspace(parseId(input, "projectId")),
    [IPC_CHANNELS.settingsGetVerification]: async (_event, input) =>
      services.settings.getVerification(parseId(input, "projectId")),
    [IPC_CHANNELS.settingsSaveVerification]: async (_event, input) =>
      services.settings.saveVerification(input as VerificationSettings)
  });
}

function safeHandlers(handlers: Record<string, IpcHandler>): Record<string, IpcHandler> {
  return Object.fromEntries(
    Object.entries(handlers).map(([channel, handler]) => [
      channel,
      async (event: { sender: IpcEventSender }, input?: unknown) => {
        try {
          return await handler(event, input);
        } catch (error) {
          const safeMessage = safeErrorMessage(error);
          if (safeMessage === GENERIC_IPC_ERROR) {
            console.error(`IPC handler failed on ${channel}`, error);
          }
          throw new Error(safeMessage);
        }
      }
    ])
  );
}

function sendRunEvent(
  sender: IpcEventSender,
  runId: string,
  event: RunEvent
): void {
  sender.send(runEventChannel(runId), event);
}

function unsubscribeSenderRun(
  subscriptions: WeakMap<IpcEventSender, Map<string, () => void>>,
  sender: IpcEventSender,
  runId: string
): void {
  const senderSubscriptions = subscriptions.get(sender);
  const unsubscribe = senderSubscriptions?.get(runId);
  if (!unsubscribe) {
    return;
  }
  unsubscribe();
  senderSubscriptions?.delete(runId);
}

function parsePath(input: unknown): string {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new Error("project path is required");
  }
  return input;
}

function parseOptionalId(input: unknown, label: string): string | undefined {
  if (input === undefined || input === null || input === "") {
    return undefined;
  }
  return parseId(input, label);
}

function parseId(input: unknown, label: string): string {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return input.trim();
}

function parseIdList(input: unknown, label: string): string[] {
  if (!Array.isArray(input)) {
    throw new Error(`${label} must be an array`);
  }
  return input.map((entry) => parseId(entry, label));
}

function parseRejectReviewInput(input: unknown): {
  runId: string;
  reason?: string;
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("review rejection input is required");
  }
  const value = input as { runId?: unknown; reason?: unknown };
  const runId = parseId(value.runId, "runId");
  if (value.reason === undefined || value.reason === null || value.reason === "") {
    return { runId };
  }
  if (typeof value.reason !== "string") {
    throw new Error("reject reason must be a string");
  }
  const reason = value.reason.trim();
  if (reason.length > 1_000) {
    throw new Error("reject reason must be 1000 characters or fewer");
  }
  return { runId, reason };
}

function parseHandoffCopyInput(input: unknown): {
  runId: string;
  kind: HandoffCopyKind;
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("handoff copy input is required");
  }
  const value = input as { runId?: unknown; kind?: unknown };
  const runId = parseId(value.runId, "runId");
  if (
    value.kind !== "worktree_path" &&
    value.kind !== "branch_name" &&
    value.kind !== "review_commands"
  ) {
    throw new Error(
      "handoff copy kind must be worktree_path, branch_name, or review_commands"
    );
  }
  return { runId, kind: value.kind };
}

function parseComparisonCreateInput(input: unknown): ComparisonCreateInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("comparison input is required");
  }
  const value = input as Partial<ComparisonCreateInput>;
  return {
    baselineRunId: parseId(value.baselineRunId, "baselineRunId"),
    candidateRunId: parseId(value.candidateRunId, "candidateRunId")
  };
}

function parseCreateRunInput(input: unknown): CreateRunInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("run input is required");
  }
  const value = input as Partial<CreateRunInput>;
  const projectId = parseId(value.projectId, "projectId");
  const prompt = parseId(value.prompt, "prompt");
  const title =
    value.title === undefined ? undefined : parseId(value.title, "title");
  const agentId = value.agentId;
  if (
    agentId !== "fake" &&
    agentId !== "codex" &&
    agentId !== "claude"
  ) {
    throw new Error("agentId must be fake, codex, or claude");
  }
  const contextMode = value.contextMode;
  if (
    contextMode !== "auto" &&
    contextMode !== "minimal" &&
    contextMode !== "full" &&
    contextMode !== "workspace"
  ) {
    throw new Error("contextMode must be auto, minimal, full, or workspace");
  }
  const deliveryMode = value.deliveryMode ?? "runtime_injection";
  if (
    deliveryMode !== "runtime_injection" &&
    deliveryMode !== "worktree_overlay"
  ) {
    throw new Error(
      "deliveryMode must be runtime_injection or worktree_overlay"
    );
  }
  return {
    taskId:
      value.taskId === undefined ? undefined : parseId(value.taskId, "taskId"),
    projectId,
    prompt,
    title,
    agentId,
    role: value.role,
    contextMode,
    deliveryMode,
    continueFromRunId:
      value.continueFromRunId === undefined
        ? undefined
        : parseId(value.continueFromRunId, "continueFromRunId"),
    continueFromMessageId:
      value.continueFromMessageId === undefined
        ? undefined
        : parseId(value.continueFromMessageId, "continueFromMessageId")
  };
}

function parseCreateThreadInput(input: unknown): CreateThreadInput {
  if (input === undefined || input === null) {
    return {};
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new Error("thread input must be an object");
  }
  const value = input as Partial<CreateThreadInput>;
  return {
    projectId:
      value.projectId === undefined
        ? undefined
        : parseId(value.projectId, "projectId"),
    title:
      value.title === undefined ? undefined : parseId(value.title, "title"),
    roomType:
      value.roomType === undefined ? undefined : parseRoomType(value.roomType),
    roomHandle:
      value.roomHandle === undefined
        ? undefined
        : parseId(value.roomHandle, "roomHandle"),
    description:
      value.description === undefined
        ? undefined
        : parseId(value.description, "description"),
    pinned: value.pinned === undefined ? undefined : parseBoolean(value.pinned, "pinned")
  };
}

function parseRoomType(value: unknown): CreateThreadInput["roomType"] {
  if (value === "default" || value === "custom" || value === "legacy") {
    return value;
  }
  throw new Error("roomType must be default, custom, or legacy");
}

function parseBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function parseSendThreadMessageInput(input: unknown): SendThreadMessageInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("thread message input is required");
  }
  const value = input as Partial<SendThreadMessageInput>;
  const text = parseId(value.text, "text");
  const contextMode = value.contextMode ?? "auto";
  if (
    contextMode !== "auto" &&
    contextMode !== "minimal" &&
    contextMode !== "full" &&
    contextMode !== "workspace"
  ) {
    throw new Error("contextMode must be auto, minimal, full, or workspace");
  }
  return {
    threadId:
      value.threadId === undefined ? undefined : parseId(value.threadId, "threadId"),
    projectId:
      value.projectId === undefined ? undefined : parseId(value.projectId, "projectId"),
    text,
    contextMode,
    agents: value.agents === undefined ? undefined : parseAgentList(value.agents),
    continueFromRunId:
      value.continueFromRunId === undefined
        ? undefined
        : parseId(value.continueFromRunId, "continueFromRunId"),
    continueFromMessageId:
      value.continueFromMessageId === undefined
        ? undefined
        : parseId(value.continueFromMessageId, "continueFromMessageId")
  };
}

function parseAgentList(input: unknown): AgentId[] {
  if (!Array.isArray(input)) {
    throw new Error("agents must be an array");
  }
  const agents: AgentId[] = [];
  for (const value of input) {
    if (value !== "fake" && value !== "codex" && value !== "claude") {
      throw new Error("agents must be fake, codex, or claude");
    }
    if (!agents.includes(value)) {
      agents.push(value);
    }
  }
  return agents;
}

const GENERIC_IPC_ERROR = "Agent Hub could not complete that local desktop request.";

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/not found|required|must be|cannot be|already|deliveryMode|agentId|contextMode|reason|projectId|runId|threadId|prompt|text|settings|verification|command|executable|args|timeout|handoff|comparison|baseline|candidate|same task|multi-agent/i.test(message)) {
    return message;
  }
  return GENERIC_IPC_ERROR;
}

type _ApiShapeCheck = AgentHubApi;
