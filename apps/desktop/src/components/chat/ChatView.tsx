import type {
  AgentId,
  ContextMode,
  ProjectSummary,
  RunDetail,
  ThreadMessage,
  ThreadSummary
} from "../../lib/types";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";

interface ChatViewProps {
  thread?: ThreadSummary;
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
  onCancelRun
}: ChatViewProps): JSX.Element {
  const disabledReason = project
    ? undefined
    : "Select or register a local project before running agents.";

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

      <div className="chat-scroll">
        <MessageList
          messages={messages}
          runDetails={runDetails}
          onRunUpdated={onRunUpdated}
          onOpenInspector={onOpenInspector}
          onCancelRun={onCancelRun}
        />
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
