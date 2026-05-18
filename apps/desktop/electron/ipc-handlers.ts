import type {
  AgentHubApi,
  CreateRunInput,
  RunEvent
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

export { IPC_CHANNELS, runEventChannel } from "./ipc-channels";

export interface DesktopServices {
  projects: ProjectService;
  runs: RunService;
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
  return {
    projects: createProjectService(context),
    runs: createRunService(context, {
      reviewService: review,
      memoryService: memory
    }),
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
    contextMode !== "full"
  ) {
    throw new Error("contextMode must be auto, minimal, or full");
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

type _ApiShapeCheck = AgentHubApi;
