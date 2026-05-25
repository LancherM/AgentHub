import type {
  AgentRunMessage,
  RunDetail,
  RunEvent,
  RunStatus,
  ThreadMessage
} from "./types";

export type RunProgressStageId = "prepare" | "run" | "verify" | "review";
export type RunProgressStageState = "done" | "current" | "pending";
export type RunProgressTone = "info" | "success" | "warning" | "danger";

export interface RunProgressStage {
  id: RunProgressStageId;
  label: string;
  state: RunProgressStageState;
}

export interface RunProgressModel {
  stageId: RunProgressStageId;
  stages: RunProgressStage[];
  activityText: string;
  activityTimestamp?: string;
  waitState: string;
  tone: RunProgressTone;
}

export interface CompareAffordance {
  enabled: boolean;
  candidateCount: number;
  candidateRunIds: string[];
  title: string;
}

interface RunProgressInput {
  status: RunStatus;
  events: RunEvent[];
  summary?: string;
  createdAt?: string;
  updatedAt?: string;
}

const STAGES: Array<{ id: RunProgressStageId; label: string }> = [
  { id: "prepare", label: "Prepare" },
  { id: "run", label: "Run" },
  { id: "verify", label: "Verify" },
  { id: "review", label: "Review" }
];

export function buildRunProgress(input: RunProgressInput): RunProgressModel {
  const events = sortEvents(input.events);
  const status = terminalStatusFromEvents(events) ?? input.status;
  const stageId = stageFor(status, events);
  const stageIndex = STAGES.findIndex((stage) => stage.id === stageId);
  const activity = latestActivity(events, input.summary);
  const activityTimestamp =
    activity.timestamp ?? input.updatedAt ?? input.createdAt;
  const progress: RunProgressModel = {
    stageId,
    stages: STAGES.map((stage, index) => ({
      ...stage,
      state:
        index < stageIndex
          ? "done"
          : index === stageIndex
            ? "current"
            : "pending"
    })),
    activityText: activity.text,
    waitState: waitStateFor(status, stageId),
    tone: toneFor(status, stageId)
  };
  return activityTimestamp ? { ...progress, activityTimestamp } : progress;
}

export function runStatusFromTerminalEvent(
  type: RunEvent["type"]
): RunStatus | undefined {
  if (type === "run_completed") {
    return "completed";
  }
  if (type === "run_failed") {
    return "failed";
  }
  if (type === "run_cancelled") {
    return "cancelled";
  }
  return undefined;
}

export function compareAffordanceForRun(
  runId: string,
  messages: ThreadMessage[],
  runDetails: Record<string, RunDetail>
): CompareAffordance {
  const source = findRunMessage(messages, runId);
  if (!source) {
    return disabledCompare("Compare requires a persisted run card.");
  }
  if (!isTerminalRunStatus(effectiveRunStatus(source, runDetails))) {
    return disabledCompare(
      "Compare is available after this run reaches a terminal state."
    );
  }

  const sourceTaskId = effectiveTaskId(source, runDetails);
  const candidates = new Map<string, AgentRunMessage>();
  for (const message of messages) {
    if (message.type !== "agent_run" || message.runId === runId) {
      continue;
    }
    if (!isTerminalRunStatus(effectiveRunStatus(message, runDetails))) {
      continue;
    }
    const candidateTaskId = effectiveTaskId(message, runDetails);
    if (sourceTaskId && candidateTaskId === sourceTaskId) {
      candidates.set(message.runId, message);
    }
  }

  for (const message of sameTurnRunMessages(messages, runId)) {
    if (message.runId === runId) {
      continue;
    }
    if (!isTerminalRunStatus(effectiveRunStatus(message, runDetails))) {
      continue;
    }
    candidates.set(message.runId, message);
  }

  const candidateRunIds = [...candidates.keys()];
  if (candidateRunIds.length === 0) {
    return disabledCompare(
      "Compare needs another terminal run from this task or turn."
    );
  }
  const peerLabel =
    candidateRunIds.length === 1
      ? "1 terminal peer"
      : `${candidateRunIds.length} terminal peers`;
  return {
    enabled: true,
    candidateCount: candidateRunIds.length,
    candidateRunIds,
    title: `Compare with ${peerLabel}`
  };
}

export function isTerminalRunStatus(status: RunStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function isActiveRunStatus(status: RunStatus): boolean {
  return status === "queued" || status === "running" || status === "verifying";
}

function stageFor(status: RunStatus, events: RunEvent[]): RunProgressStageId {
  if (isTerminalRunStatus(status) || hasTerminalEvent(events)) {
    return "review";
  }
  if (status === "verifying" || events.some((event) => isVerificationEvent(event))) {
    return "verify";
  }
  if (status === "running" && events.some((event) => isAgentEvent(event))) {
    return "run";
  }
  return "prepare";
}

function latestActivity(
  events: RunEvent[],
  summary: string | undefined
): { text: string; timestamp?: string } {
  const event = [...events].reverse().find((entry) => eventText(entry).length > 0);
  if (event) {
    return { text: eventText(event), timestamp: event.timestamp };
  }
  if (summary) {
    return { text: summary };
  }
  return { text: "Waiting for the first persisted event." };
}

function waitStateFor(status: RunStatus, stage: RunProgressStageId): string {
  if (status === "completed") {
    return "Review ready";
  }
  if (status === "failed") {
    return "Needs review";
  }
  if (status === "cancelled") {
    return "Cancelled";
  }
  if (status === "queued" || stage === "prepare") {
    return "Preparing context";
  }
  if (stage === "verify") {
    return "Waiting for checks";
  }
  return "Waiting for agent output";
}

function toneFor(status: RunStatus, stage: RunProgressStageId): RunProgressTone {
  if (status === "completed") {
    return "success";
  }
  if (status === "failed" || status === "cancelled") {
    return "danger";
  }
  if (stage === "verify") {
    return "warning";
  }
  return "info";
}

function sortEvents(events: RunEvent[]): RunEvent[] {
  return [...events].sort((left, right) => left.sequence - right.sequence);
}

function eventText(event: RunEvent): string {
  return (
    event.payload.message ??
    event.payload.summary ??
    event.payload.command ??
    event.type.replaceAll("_", " ")
  );
}

function isAgentEvent(event: RunEvent): boolean {
  return event.type === "agent_step" || event.type === "agent_output";
}

function isVerificationEvent(event: RunEvent): boolean {
  return event.type === "verification_started" || event.type === "verification_finished";
}

function hasTerminalEvent(events: RunEvent[]): boolean {
  return events.some(
    (event) =>
      event.type === "run_completed" ||
      event.type === "run_failed" ||
      event.type === "run_cancelled"
  );
}

function terminalStatusFromEvents(events: RunEvent[]): RunStatus | undefined {
  return [...events].reverse()
    .map((event) => runStatusFromTerminalEvent(event.type))
    .find((status): status is RunStatus => Boolean(status));
}

function findRunMessage(
  messages: ThreadMessage[],
  runId: string
): AgentRunMessage | undefined {
  return messages.find(
    (message): message is AgentRunMessage =>
      message.type === "agent_run" && message.runId === runId
  );
}

function sameTurnRunMessages(
  messages: ThreadMessage[],
  runId: string
): AgentRunMessage[] {
  const sourceIndex = messages.findIndex(
    (message) => message.type === "agent_run" && message.runId === runId
  );
  if (sourceIndex < 0) {
    return [];
  }
  let start = sourceIndex;
  while (start > 0 && messages[start - 1]?.type !== "user") {
    start -= 1;
  }
  let end = sourceIndex + 1;
  while (end < messages.length && messages[end]?.type !== "user") {
    end += 1;
  }
  return messages
    .slice(start, end)
    .filter((message): message is AgentRunMessage => message.type === "agent_run");
}

function effectiveRunStatus(
  message: AgentRunMessage,
  runDetails: Record<string, RunDetail>
): RunStatus {
  return runDetails[message.runId]?.status ?? message.status;
}

function effectiveTaskId(
  message: AgentRunMessage,
  runDetails: Record<string, RunDetail>
): string | undefined {
  return runDetails[message.runId]?.taskId ?? message.taskId;
}

function disabledCompare(title: string): CompareAffordance {
  return {
    enabled: false,
    candidateCount: 0,
    candidateRunIds: [],
    title
  };
}
