import type {
  AgentRunMessage,
  ReviewSummary,
  RunInspectorTab,
  RunStatus,
  SystemMessage,
  ThreadMessage,
  TimelineEventChip,
  TimelineEventKind,
  TimelineEventMetadata,
  TimelineEventTone
} from "./types";

export interface TimelineEventPresentation {
  kind: TimelineEventKind;
  title: string;
  subtitle?: string;
  tone: TimelineEventTone;
  actorLabel: string;
  linkedRunId?: string;
  linkedTaskId?: string;
  defaultTab?: RunInspectorTab;
  chips: TimelineEventChip[];
}

export function timelinePresentationForMessage(
  message: ThreadMessage,
  options: {
    reviewSummary?: ReviewSummary;
    eventCount?: number;
    status?: RunStatus;
  } = {}
): TimelineEventPresentation {
  const event = message.timelineEvent;
  if (message.type === "agent_run") {
    return runPresentation(message, event, options);
  }
  if (message.type === "user") {
    return {
      kind: event?.kind ?? "user_message",
      title: event?.title ?? "User message",
      subtitle: event?.summary,
      tone: event?.tone ?? "info",
      actorLabel: "You",
      linkedTaskId: event?.linkedIds?.taskId,
      chips: event?.chips ?? []
    };
  }
  if (message.type === "assistant") {
    return {
      kind: event?.kind ?? "participant_message",
      title: event?.title ?? participantTitle(message.agentId),
      subtitle: event?.summary,
      tone: event?.tone ?? toneForRunStatus(message.status),
      actorLabel: message.agentId ? `@${message.agentId}` : "Assistant",
      linkedRunId: message.runId ?? event?.linkedIds?.runId,
      linkedTaskId: event?.linkedIds?.taskId,
      defaultTab: "brief",
      chips: event?.chips ?? []
    };
  }
  return systemPresentation(message, event);
}

export function runEvidenceTimelineChips(
  summary: ReviewSummary | undefined,
  eventCount: number,
  status: RunStatus
): Array<TimelineEventChip & { tab: RunInspectorTab }> {
  const pending = isTerminalRunStatus(status) ? "unknown" : "pending";
  const verificationStatus = summary?.verificationStatus ?? pending;
  const riskLevel = summary?.riskLevel ?? pending;
  const reviewStatus = summary?.reviewStatus ?? "pending";
  const memoryCount = summary?.memoryProposalCount ?? 0;
  const diffLabel = summary
    ? summary.changedFileCount > 0
      ? `Artifacts ${summary.changedFileCount} files +${summary.additions}/-${summary.deletions}`
      : "Artifacts 0 files"
    : "Artifacts pending";
  return [
    {
      kind: "check_completed",
      label: `Checks ${verificationStatus}`,
      tone: verificationTone(verificationStatus),
      tab: "checks"
    },
    {
      kind: "risk_detected",
      label: `Risks ${riskLevel}`,
      tone: riskTone(riskLevel),
      tab: "risks"
    },
    {
      kind: "artifact_created",
      label: diffLabel,
      tone: summary?.changedFileCount ? "accent" : "neutral",
      tab: "artifacts"
    },
    {
      kind: "review_decision",
      label: "Compare",
      tone: "neutral",
      tab: "artifacts"
    },
    {
      kind: "review_decision",
      label: `Review ${reviewStatus}`,
      tone:
        reviewStatus === "accepted"
          ? "success"
          : reviewStatus === "rejected"
            ? "danger"
            : "neutral",
      tab: "brief"
    },
    {
      kind: "memory_proposed",
      label: `Memory ${memoryCount}`,
      tone: memoryCount > 0 ? "accent" : "neutral",
      tab: "memory"
    },
    {
      kind: "system_event",
      label: `Audit ${eventCount}`,
      tone: "neutral",
      tab: "audit"
    }
  ];
}

function runPresentation(
  message: AgentRunMessage,
  event: TimelineEventMetadata | undefined,
  options: {
    reviewSummary?: ReviewSummary;
    eventCount?: number;
    status?: RunStatus;
  }
): TimelineEventPresentation {
  const status = options.status ?? message.status;
  const kind = terminalRunEventKind(status) ?? event?.kind ?? "run_started";
  const displayHandle = message.assignment?.roleHandle
    ? `@${message.assignment.roleHandle}`
    : `@${message.agentId}`;
  return {
    kind,
    title: event?.title ?? `${displayHandle} ${status}`,
    subtitle: event?.summary,
    tone: toneForRunStatus(status),
    actorLabel: displayHandle,
    linkedRunId: message.runId,
    linkedTaskId: message.taskId ?? event?.linkedIds?.taskId,
    defaultTab: "brief",
    chips: [
      ...(event?.chips ?? []),
      ...runEvidenceTimelineChips(
        options.reviewSummary,
        options.eventCount ?? 0,
        status
      )
    ]
  };
}

function systemPresentation(
  message: SystemMessage,
  event: TimelineEventMetadata | undefined
): TimelineEventPresentation {
  const kind = event?.kind ?? legacySystemEventKind(message);
  return {
    kind,
    title: event?.title ?? titleForEventKind(kind),
    subtitle: event?.summary,
    tone: event?.tone ?? toneForEventKind(kind),
    actorLabel: "Agent Hub",
    linkedRunId: event?.linkedIds?.runId,
    linkedTaskId: event?.linkedIds?.taskId,
    defaultTab: event?.linkedIds?.runId ? "brief" : undefined,
    chips: event?.chips ?? []
  };
}

function legacySystemEventKind(message: SystemMessage): TimelineEventKind {
  if (message.metadata?.taskEvent === "task_created") {
    return "task_created";
  }
  if (message.metadata?.taskEvent === "participants_assigned") {
    return "assignment_created";
  }
  if (message.metadata?.taskEvent === "assignment_start_failed") {
    return "assignment_start_failed";
  }
  return "system_event";
}

function titleForEventKind(kind: TimelineEventKind): string {
  switch (kind) {
    case "task_created":
      return "Task created";
    case "assignment_created":
      return "Assignments created";
    case "assignment_start_failed":
      return "Assignment start failed";
    case "risk_detected":
      return "Risk detected";
    case "check_completed":
      return "Check completed";
    case "memory_proposed":
      return "Memory proposed";
    case "review_decision":
      return "Review decision";
    default:
      return "System event";
  }
}

function toneForEventKind(kind: TimelineEventKind): TimelineEventTone {
  if (kind === "task_created" || kind === "assignment_created") {
    return "accent";
  }
  if (kind === "assignment_start_failed" || kind === "risk_detected") {
    return "warning";
  }
  return "neutral";
}

function terminalRunEventKind(status: RunStatus): TimelineEventKind | undefined {
  if (status === "completed") {
    return "run_completed";
  }
  if (status === "failed") {
    return "run_failed";
  }
  if (status === "cancelled") {
    return "run_cancelled";
  }
  return undefined;
}

function toneForRunStatus(status: RunStatus | undefined): TimelineEventTone {
  if (status === "completed") {
    return "success";
  }
  if (status === "failed" || status === "cancelled") {
    return "danger";
  }
  if (status === "running" || status === "verifying") {
    return "warning";
  }
  return "neutral";
}

function verificationTone(status: string): TimelineEventTone {
  if (status === "passed") {
    return "success";
  }
  if (status === "failed") {
    return "danger";
  }
  if (status === "skipped") {
    return "warning";
  }
  return "neutral";
}

function riskTone(level: string): TimelineEventTone {
  if (level === "high" || level === "blocking") {
    return "danger";
  }
  if (level === "medium" || level === "unknown" || level === "pending") {
    return "warning";
  }
  if (level === "low") {
    return "accent";
  }
  return "neutral";
}

function participantTitle(agentId: string | undefined): string {
  return agentId ? `@${agentId} participant message` : "Participant message";
}

function isTerminalRunStatus(status: RunStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}
