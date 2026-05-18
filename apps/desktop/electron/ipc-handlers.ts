import type {
  AgentId,
  AgentHubApi,
  CreateThreadInput,
  CreateRunInput,
  RunEvent,
  SendThreadMessageInput
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

export { IPC_CHANNELS, runEventChannel } from "./ipc-channels";

export interface DesktopServices {
  projects: ProjectService;
  runs: RunService;
  threads: ThreadService;
  review: ReviewService;
  memory: MemoryService;
}

export interface IpcEventSender {
  send(channel: string, ...args: unknown[]): void;
}

export type IpcHandler = (
  event: { sender: IpcEventSender },
  input?: unknown
) => Promise<unknown>;

export function createDesktopServices(
  context: DesktopServiceContext = createDesktopServiceContext()
): DesktopServices {
  const review = createReviewService(context);
  const memory = createMemoryService(context);
  const projects = createProjectService(context);
  const runs = createRunService(context, {
    reviewService: review,
    memoryService: memory
  });
  return {
    projects,
    runs,
    threads: createThreadService({ projects, runs }),
    review,
    memory
  };
}

export function createIpcHandlers(
  services: DesktopServices
): Record<string, IpcHandler> {
  const subscriptions = new WeakMap<
    IpcEventSender,
    Map<string, () => void>
  >();

  return {
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
    [IPC_CHANNELS.reviewDiff]: async (_event, input) =>
      services.review.getDiff(parseId(input, "runId")),
    [IPC_CHANNELS.reviewRisk]: async (_event, input) =>
      services.review.getRisk(parseId(input, "runId")),
    [IPC_CHANNELS.reviewVerification]: async (_event, input) =>
      services.review.getVerification(parseId(input, "runId")),
    [IPC_CHANNELS.memoryListProposals]: async (_event, input) =>
      services.memory.listProposals(parseId(input, "runId")),
    [IPC_CHANNELS.memoryApprove]: async (_event, input) =>
      services.memory.approve(parseIdList(input, "memory ids")),
    [IPC_CHANNELS.memoryIgnore]: async (_event, input) =>
      services.memory.ignore(parseIdList(input, "memory ids"))
  };
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
    projectId,
    prompt,
    title,
    agentId,
    contextMode,
    deliveryMode
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
      value.title === undefined ? undefined : parseId(value.title, "title")
  };
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
    agents: value.agents === undefined ? undefined : parseAgentList(value.agents)
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

type _ApiShapeCheck = AgentHubApi;
