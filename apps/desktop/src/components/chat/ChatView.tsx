import { useEffect, useRef, useState } from "react";
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
  ThreadMessage
} from "../../lib/types";
import { ProjectRegistrationForm } from "../projects/ProjectRegistrationForm";
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
  pendingContinueFrom?: RunContinuationTarget;
  error?: string;
  onSubmit(
    input: string,
    contextMode: ContextMode,
    workflow?: CollaborationWorkflowInput
  ): Promise<void>;
  onContinueFromRun(target: RunContinuationTarget): void;
  onClearContinueFrom(): void;
  onRunUpdated(run: RunDetail): void;
  onOpenInspector(runId: string, tab?: RunInspectorTab): void;
  onCancelRun(runId: string): Promise<void>;
  onSetSharedContext(enabled: boolean): void;
  onRegisterProject(projectPath: string): Promise<void>;
}

export function ChatView({
  thread,
  project,
  messages,
  runDetails,
  isBusy,
  lastUsedAgents,
  lastUsedRoleHandles,
  pendingContinueFrom,
  error,
  onSubmit,
  onContinueFromRun,
  onClearContinueFrom,
  onRunUpdated,
  onOpenInspector,
  onCancelRun,
  onSetSharedContext,
  onRegisterProject
}: ChatViewProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [roleTargets, setRoleTargets] = useState<TeamRoleSummary[]>([]);
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
    <section className="chat-view">
      <header className="chat-header">
        <div>
          <h1>
            {thread?.roomHandle ? `#${thread.roomHandle}` : thread?.title ?? "Select a room"}
          </h1>
          {thread?.description ? (
            <p className="room-description">{thread.description}</p>
          ) : null}
          <div className="chat-context-row">
            <span>Project: {project?.name ?? "No project selected"}</span>
            <span>Room: {thread?.roomType ?? "none"}</span>
            <span>Mode: local desktop</span>
            <span>Context: runtime injection by default</span>
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

      {error ? <div className="error-strip inline">{error}</div> : null}

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
            <div>
              <p className="eyebrow">First run setup</p>
              <h2>Register a local project to start chatting</h2>
              <p>
                Agent Hub Desktop stays local-first. Enter a repository path to
                add it through the existing project IPC flow, then start a new
                agent conversation.
              </p>
              <ProjectRegistrationForm
                isBusy={isBusy}
                onRegister={onRegisterProject}
              />
            </div>
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
        pendingContinueFrom={pendingContinueFrom}
        disabledReason={disabledReason}
        onSubmit={onSubmit}
        onClearContinueFrom={onClearContinueFrom}
      />
    </section>
  );
}
