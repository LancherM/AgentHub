import type { KeyboardEvent, RefObject } from "react";

interface MentionInputProps {
  value: string;
  disabled?: boolean;
  inputRef?: RefObject<HTMLTextAreaElement>;
  onChange(value: string): void;
  onSubmit(): void;
  onCursorChange?(cursor: number): void;
  onKeyCommand?(event: KeyboardEvent<HTMLTextAreaElement>): boolean;
}

export function MentionInput({
  value,
  disabled = false,
  inputRef,
  onChange,
  onSubmit,
  onCursorChange,
  onKeyCommand
}: MentionInputProps): JSX.Element {
  function reportCursor(element: HTMLTextAreaElement): void {
    onCursorChange?.(element.selectionStart);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (onKeyCommand?.(event)) {
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      onSubmit();
      return;
    }
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !value.includes("\n")
    ) {
      event.preventDefault();
      onSubmit();
    }
  }

  return (
    <textarea
      ref={inputRef}
      className="mention-input"
      value={value}
      disabled={disabled}
      onChange={(event) => {
        onChange(event.target.value);
        reportCursor(event.target);
      }}
      onClick={(event) => reportCursor(event.currentTarget)}
      onKeyDown={handleKeyDown}
      onKeyUp={(event) => reportCursor(event.currentTarget)}
      placeholder="Message agents..."
      rows={3}
      aria-label="Message agents"
    />
  );
}
