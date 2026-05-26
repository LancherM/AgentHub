import { useEffect, useMemo, useRef, useState } from "react";
import { agentHubApi } from "../../lib/agentHubApi";
import type {
  AgentId,
  CollaborationWorkflowInput,
  ContextMode,
  ProjectSummary,
  RunDetail,
  RunInspectorTab,
  RunContinuationTarget,
  TeamRoleSummary,
  ThreadDetail,
  ThreadMessage,
  RunStatus
} from "../../lib/types";
import { ProjectRegistrationForm } from "../projects/ProjectRegistrationForm";
import { EmptyState } from "../EmptyState";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { WorkflowLauncher } from "./WorkflowLauncher";

interface ChatViewProps {
  thread?: ThreadDetail;
  project?: ProjectSummary;
  messages: ThreadMessage[];
  runDetails: Record<string, RunDetail>;
  isBusy: boolean;
  lastUsedAgents: AgentId[];
  lastUsedRoleHandles: string[];
  initialContextMode: ContextMode;
  pendingContinueFrom?: RunContinuationTarget;
  error?: string;
  onSubmit(
    input: string,
    contextMode: ContextMode,
    workflow?: CollaborationWorkflowInput
  ): Promise<void>;
  onContextModeChange(contextMode: ContextMode): void;
  onContinueFromRun(target: RunContinuationTarget): void;
  onClearContinueFrom(): void;
  onRunUpdated(run: RunDetail): void;
  onOpenInspector(runId: string, tab?: RunInspectorTab): void;
  onCancelRun(runId: string): Promise<void>;
  onSetSharedContext(enabled: boolean): void;
  onRegisterProject(projectPath: string): Promise<void>;
  onSelectProjectDirectory(): Promise<string | undefined>;
  onOpenSettings(): void;
}

export function ChatView({
  thread,
  project,
  messages,
  runDetails,
  isBusy,
  lastUsedAgents,
  lastUsedRoleHandles,
  initialContextMode,
  pendingContinueFrom,
  error,
  onSubmit,
  onContextModeChange,
  onContinueFromRun,
  onClearContinueFrom,
  onRunUpdated,
  onOpenInspector,
  onCancelRun,
  onSetSharedContext,
  onRegisterProject,
  onSelectProjectDirectory,
  onOpenSettings
}: ChatViewProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [roleTargets, setRoleTargets] = useState<TeamRoleSummary[]>([]);
  const chatState = useMemo(
    () => deriveChatViewState(messages, runDetails),
    [messages, runDetails]
  );
  const disabledReason = project
    ? undefined
    : "Select or register a local project before running agents.";

  useEffect(() => {
    let cancelled = false;
    if (!project?.id) {
      setRoleTargets([]);
      return;
    }
    agentHubApi.team
      .getWorkspace(project.id)
      .then((workspace) => {
        if (!cancelled) {
          setRoleTargets(
            workspace.roles.filter(
              (summary) => summary.status === "enabled" && summary.role.enabled
            )
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRoleTargets([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [project?.id]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  }, [messages, runDetails]);

  return (
    <section className={`chat-view state-${chatState}`}>
      <header className="chat-header">
        <div>
          <h1>
            {thread?.roomHandle ? `#${thread.roomHandle}` : thread?.title ?? "Select a room"}
          </h1>
          {thread?.description ? (
            <p className="room-description">{thread.description}</p>
          ) : null}
          <div className="chat-context-row">
            <span className="chat-product-context">
              {project?.name ?? "No project"} · {roomContextLabel(thread)} · local desktop
            </span>
            <span
              className="chat-context-mode"
              title="Agent Hub injects task briefs and context at runtime unless a different delivery mode is explicitly selected."
            >
              Context: runtime injection
            </span>
          </div>
        </div>
        {thread ? (
          <label className="room-context-toggle">
            <input
              type="checkbox"
              role="switch"
              checked={thread.sharedContextEnabled}
              disabled={isBusy}
              onChange={(event) => onSetSharedContext(event.target.checked)}
            />
            <span>Use this room's prior conversation in future agent runs</span>
          </label>
        ) : null}
      </header>

      {error ? (
        <div className="error-strip inline actionable">
          <span>{error}</span>
          {error.toLowerCase().includes("verification") ? (
            <button className="ghost-button compact" onClick={onOpenSettings}>
              Open Settings
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="chat-scroll" ref={scrollRef}>
        {project ? (
          <MessageList
            messages={messages}
            runDetails={runDetails}
            onRunUpdated={onRunUpdated}
            onOpenInspector={onOpenInspector}
            onCancelRun={onCancelRun}
            onContinueFromRun={onContinueFromRun}
          />
        ) : (
          <div className="empty-chat project-onboarding">
            <EmptyState
              eyebrow="First Run Setup"
              title="Register a local project to start chatting"
              body="Agent Hub Desktop stays local-first. Enter a repository path to add it through the existing project IPC flow, then start a new agent conversation."
              note="No Agent Hub context files are written to the repository by default."
            >
              <ProjectRegistrationForm
                isBusy={isBusy}
                onRegister={onRegisterProject}
                onSelectDirectory={onSelectProjectDirectory}
              />
            </EmptyState>
          </div>
        )}
      </div>

      {project ? (
        <WorkflowLauncher
          isBusy={isBusy}
          onSubmit={(input, workflow) => onSubmit(input, "auto", workflow)}
        />
      ) : null}

      <Composer
        isBusy={isBusy}
        lastUsedAgents={lastUsedAgents}
        lastUsedRoleHandles={lastUsedRoleHandles}
        roleTargets={roleTargets}
        initialContextMode={initialContextMode}
        pendingContinueFrom={pendingContinueFrom}
        disabledReason={disabledReason}
        onSubmit={onSubmit}
        onContextModeChange={onContextModeChange}
        onClearContinueFrom={onClearContinueFrom}
      />
    </section>
  );
}

type ChatViewState = "idle" | "running" | "failed" | "review-ready";

function deriveChatViewState(
  messages: ThreadMessage[],
  runDetails: Record<string, RunDetail>
): ChatViewState {
  const latestRun = [...messages]
    .reverse()
    .find((message) => message.type === "agent_run");
  if (!latestRun || latestRun.type !== "agent_run") {
    return "idle";
  }
  const status = runDetails[latestRun.runId]?.status ?? latestRun.status;
  if (status === "failed") {
    return "failed";
  }
  if (isActiveStatus(status)) {
    return "running";
  }
  return "review-ready";
}

function isActiveStatus(status: RunStatus): boolean {
  return status === "queued" || status === "running" || status === "verifying";
}

function roomContextLabel(thread: ThreadDetail | undefined): string {
  if (!thread) {
    return "no room";
  }
  if (thread.roomType === "default") {
    return "default room";
  }
  if (thread.roomType === "custom") {
    return "custom room";
  }
  return "legacy room";
}
