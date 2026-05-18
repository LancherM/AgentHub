import type { KeyboardEvent } from "react";

interface MentionInputProps {
  value: string;
  disabled?: boolean;
  onChange(value: string): void;
  onSubmit(): void;
}

export function MentionInput({
  value,
  disabled = false,
  onChange,
  onSubmit
}: MentionInputProps): JSX.Element {
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
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
      className="mention-input"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={handleKeyDown}
      placeholder="Message agents..."
      rows={3}
      aria-label="Message agents"
    />
  );
}
