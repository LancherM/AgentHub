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
  return {
    [IPC_CHANNELS.projectsList]: async () => services.projects.list(),
    [IPC_CHANNELS.projectsOpen]: async (_event, input) =>
      services.projects.open(parsePath(input)),
    [IPC_CHANNELS.runsList]: async (_event, input) =>
      services.runs.list(parseOptionalId(input, "projectId")),
    [IPC_CHANNELS.runsGet]: async (_event, input) =>
      services.runs.get(parseId(input, "runId")),
    [IPC_CHANNELS.runsCreate]: async (event, input) => {
      const summary = await services.runs.create(parseCreateRunInput(input));
      const detail = await services.runs.get(summary.id);
      for (const runEvent of detail.events) {
        sendRunEvent(event.sender, summary.id, runEvent);
      }
      return summary;
    },
    [IPC_CHANNELS.runsCancel]: async (_event, input) => {
      await services.runs.cancel(parseId(input, "runId"));
    },
    [IPC_CHANNELS.runsSubscribe]: async (_event, input) => {
      parseId(input, "runId");
    },
    [IPC_CHANNELS.runsUnsubscribe]: async (_event, input) => {
      parseId(input, "runId");
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
  const agentKind = value.agentKind;
  if (
    agentKind !== "fake" &&
    agentKind !== "codex" &&
    agentKind !== "claude-code"
  ) {
    throw new Error("agentKind must be fake, codex, or claude-code");
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
    agentKind,
    contextMode,
    deliveryMode
  };
}

type _ApiShapeCheck = AgentHubApi;
