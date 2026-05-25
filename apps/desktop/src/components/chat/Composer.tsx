import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type { KeyboardEvent } from "react";
import {
  activeComposerTrigger,
  applyComposerSuggestion,
  buildComposerSuggestions,
  contextModeOptions,
  insertComposerTarget,
  removeComposerTarget,
  resolveComposerTargets,
  type ComposerSuggestion,
  type ComposerTarget
} from "../../lib/composer-controls";
import type {
  AgentId,
  ContextMode,
  RunContinuationTarget,
  TeamRoleSummary
} from "../../lib/types";
import { MentionInput } from "./MentionInput";

interface ComposerProps {
  isBusy: boolean;
  lastUsedAgents: AgentId[];
  lastUsedRoleHandles: string[];
  roleTargets: TeamRoleSummary[];
  pendingContinueFrom?: RunContinuationTarget;
  disabledReason?: string;
  onSubmit(input: string, contextMode: ContextMode): Promise<void>;
  onClearContinueFrom(): void;
}

export function Composer({
  isBusy,
  lastUsedAgents,
  lastUsedRoleHandles,
  roleTargets,
  pendingContinueFrom,
  disabledReason,
  onSubmit,
  onClearContinueFrom
}: ComposerProps): JSX.Element {
  const [input, setInput] = useState("");
  const [contextMode, setContextMode] = useState<ContextMode>("auto");
  const [localError, setLocalError] = useState<string | undefined>();
  const [cursor, setCursor] = useState(0);
  const [dismissedTriggerKey, setDismissedTriggerKey] = useState<string | undefined>();
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const trigger = useMemo(
    () => activeComposerTrigger(input, cursor),
    [cursor, input]
  );
  const triggerKey = trigger
    ? `${trigger.kind}:${trigger.start}:${trigger.end}:${trigger.query}`
    : undefined;
  const suggestions = useMemo(
    () =>
      triggerKey === dismissedTriggerKey
        ? []
        : buildComposerSuggestions({
            roles: roleTargets,
            recentAgents: lastUsedAgents,
            recentRoleHandles: lastUsedRoleHandles,
            trigger
          }).slice(0, 7),
    [
      dismissedTriggerKey,
      lastUsedAgents,
      lastUsedRoleHandles,
      roleTargets,
      trigger,
      triggerKey
    ]
  );
  const targetResolution = useMemo(
    () =>
      resolveComposerTargets({
        value: input,
        roles: roleTargets,
        fallbackAgents: lastUsedAgents,
        fallbackRoleHandles: lastUsedRoleHandles
      }),
    [input, lastUsedAgents, lastUsedRoleHandles, roleTargets]
  );
  const displayedTargets = targetResolution.targets;
  const canSubmit = input.trim().length > 0 && !isBusy && !disabledReason;
  const submitLabel = isBusy
    ? "Running..."
    : `Run ${targetResolution.runCount} target${targetResolution.runCount === 1 ? "" : "s"}`;
  const suggestionHint =
    suggestions.length > 0
      ? "Arrow keys select suggestions"
      : targetResolution.explicitTargetCount === 0
        ? "Using recent/default target until an @ mention is added"
        : "Local runtime";

  useEffect(() => {
    setActiveSuggestionIndex(0);
  }, [triggerKey]);

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

  function focusComposer(cursorPosition: number): void {
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(cursorPosition, cursorPosition);
      setCursor(cursorPosition);
    });
  }

  function selectSuggestion(suggestion: ComposerSuggestion): void {
    if (!trigger) {
      return;
    }
    const applied = applyComposerSuggestion(input, trigger, suggestion);
    setInput(applied.value);
    setDismissedTriggerKey(undefined);
    focusComposer(applied.cursor);
  }

  function handleSuggestionKeys(
    event: KeyboardEvent<HTMLTextAreaElement>
  ): boolean {
    if (suggestions.length === 0) {
      return false;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSuggestionIndex((index) => (index + 1) % suggestions.length);
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSuggestionIndex(
        (index) => (index - 1 + suggestions.length) % suggestions.length
      );
      return true;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      selectSuggestion(suggestions[activeSuggestionIndex] ?? suggestions[0]);
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setDismissedTriggerKey(triggerKey);
      return true;
    }
    return false;
  }

  function removeTarget(target: ComposerTarget): void {
    if (!target.removable) {
      const next = insertComposerTarget(input, target);
      setInput(next);
      focusComposer(next.length);
      return;
    }
    const next = removeComposerTarget(input, target);
    setInput(next);
    focusComposer(Math.min(cursor, next.length));
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
          {displayedTargets.map((target) => (
            <span
              className={`mention-chip ${target.kind} ${target.handle} ${
                target.source === "fallback" ? "fallback" : ""
              }`}
              key={target.id}
              title={
                target.removable
                  ? `Remove ${target.label}`
                  : `Pin ${target.label} as an explicit mention`
              }
            >
              <span>{target.label}</span>
              <small>{target.detail}</small>
              <button
                type="button"
                aria-label={
                  target.removable
                    ? `Remove ${target.label}`
                    : `Pin ${target.label} as an explicit mention`
                }
                onClick={() => removeTarget(target)}
              >
                {target.removable ? "x" : "+"}
              </button>
            </span>
          ))}
          {pendingContinueFrom ? (
            <span className="continue-chip">
              Continue {shortId(pendingContinueFrom.parentRunId)}
              <button
                type="button"
                aria-label="Clear continuation"
                onClick={onClearContinueFrom}
              >
                x
              </button>
            </span>
          ) : null}
        </div>
        <div
          className="context-segmented-control"
          role="radiogroup"
          aria-label="Context mode"
        >
          {contextModeOptions.map((mode) => (
            <button
              type="button"
              className={contextMode === mode ? "selected" : ""}
              key={mode}
              role="radio"
              aria-checked={contextMode === mode}
              onClick={() => setContextMode(mode)}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>
      <div className="composer-input-shell">
        <MentionInput
          inputRef={inputRef}
          value={input}
          disabled={isBusy || Boolean(disabledReason)}
          onChange={(value) => {
            setInput(value);
            setDismissedTriggerKey(undefined);
          }}
          onCursorChange={setCursor}
          onKeyCommand={handleSuggestionKeys}
          onSubmit={() => void submit()}
        />
        {suggestions.length > 0 ? (
          <div className="composer-suggestions" role="listbox">
            {suggestions.map((suggestion, index) => (
              <button
                type="button"
                className={index === activeSuggestionIndex ? "selected" : ""}
                key={suggestion.id}
                role="option"
                aria-selected={index === activeSuggestionIndex}
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectSuggestion(suggestion);
                }}
              >
                <span className={`suggestion-mark ${suggestion.kind}`}>
                  {suggestion.kind === "command"
                    ? "/"
                    : suggestion.handle.slice(0, 1).toUpperCase()}
                </span>
                <span className="suggestion-copy">
                  <strong>
                    {suggestion.label}
                    {suggestion.recent ? <em> recent</em> : null}
                  </strong>
                  <small>{suggestion.detail}</small>
                </span>
                <span className="suggestion-kind">{suggestion.kind}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="composer-footer">
        <span>{disabledReason ?? suggestionHint}</span>
        <button type="submit" disabled={!canSubmit}>
          {submitLabel}
        </button>
      </div>
      {localError ? <div className="inline-error">{localError}</div> : null}
    </form>
  );
}

function shortId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 12)}...`;
}
