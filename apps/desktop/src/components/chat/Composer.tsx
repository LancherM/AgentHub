import { useMemo, useState } from "react";
import {
  parseAgentMentions,
  resolveMentionedAgents
} from "../../lib/mentions";
import type { AgentId, ContextMode } from "../../lib/types";
import { MentionInput } from "./MentionInput";

interface ComposerProps {
  isBusy: boolean;
  lastUsedAgents: AgentId[];
  disabledReason?: string;
  onSubmit(input: string, contextMode: ContextMode): Promise<void>;
}

export function Composer({
  isBusy,
  lastUsedAgents,
  disabledReason,
  onSubmit
}: ComposerProps): JSX.Element {
  const [input, setInput] = useState("");
  const [contextMode, setContextMode] = useState<ContextMode>("auto");
  const [localError, setLocalError] = useState<string | undefined>();
  const explicitMentions = useMemo(() => parseAgentMentions(input), [input]);
  const resolved = useMemo(
    () => resolveMentionedAgents(input, lastUsedAgents),
    [input, lastUsedAgents]
  );
  const displayedAgents =
    explicitMentions.agents.length > 0 ? explicitMentions.agents : resolved.agents;
  const canSubmit = input.trim().length > 0 && !isBusy && !disabledReason;

  async function submit(): Promise<void> {
    if (!canSubmit) {
      return;
    }
    setLocalError(undefined);
    try {
      await onSubmit(input, contextMode);
      setInput("");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <form
      className="chat-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="composer-toolbar">
        <div className="mention-chip-row" aria-label="Target agents">
          {displayedAgents.map((agent) => (
            <span className={`mention-chip ${agent}`} key={agent}>
              @{agent}
            </span>
          ))}
        </div>
        <label className="context-select">
          <span>Context</span>
          <select
            value={contextMode}
            onChange={(event) => setContextMode(event.target.value as ContextMode)}
          >
            <option value="auto">auto</option>
            <option value="minimal">minimal</option>
            <option value="full">full</option>
            <option value="workspace">workspace</option>
          </select>
        </label>
      </div>
      <MentionInput
        value={input}
        disabled={isBusy || Boolean(disabledReason)}
        onChange={setInput}
        onSubmit={() => void submit()}
      />
      <div className="composer-footer">
        <span>{disabledReason ?? "Local runtime"}</span>
        <button type="submit" disabled={!canSubmit}>
          Run
        </button>
      </div>
      {localError ? <div className="inline-error">{localError}</div> : null}
    </form>
  );
}
