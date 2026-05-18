import { useEffect, useRef } from "react";
import type {
  AgentId,
  ContextMode,
  ProjectSummary,
  RunDetail,
  ThreadDetail,
  ThreadMessage
} from "../../lib/types";
import { ProjectRegistrationForm } from "../projects/ProjectRegistrationForm";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";

interface ChatViewProps {
  thread?: ThreadDetail;
  project?: ProjectSummary;
  messages: ThreadMessage[];
  runDetails: Record<string, RunDetail>;
  isBusy: boolean;
  lastUsedAgents: AgentId[];
  error?: string;
  onSubmit(input: string, contextMode: ContextMode): Promise<void>;
  onRunUpdated(run: RunDetail): void;
  onOpenInspector(runId: string): void;
  onCancelRun(runId: string): Promise<void>;
  onRegisterProject(projectPath: string): Promise<void>;
}

export function ChatView({
  thread,
  project,
  messages,
  runDetails,
  isBusy,
  lastUsedAgents,
  error,
  onSubmit,
  onRunUpdated,
  onOpenInspector,
  onCancelRun,
  onRegisterProject
}: ChatViewProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const disabledReason = project
    ? undefined
    : "Select or register a local project before running agents.";

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
          <h1>{thread?.title ?? "New conversation"}</h1>
          <div className="chat-context-row">
            <span>Project: {project?.name ?? "No project selected"}</span>
            <span>Mode: local desktop</span>
            <span>Context: runtime injection by default</span>
          </div>
        </div>
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

      <Composer
        isBusy={isBusy}
        lastUsedAgents={lastUsedAgents}
        disabledReason={disabledReason}
        onSubmit={onSubmit}
      />
    </section>
  );
}
