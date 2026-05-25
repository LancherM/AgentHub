import type { ReactNode } from "react";

interface EmptyStateAction {
  label: string;
  onClick(): void;
  variant?: "primary" | "secondary";
  disabled?: boolean;
}

interface EmptyStateProps {
  eyebrow: string;
  title: string;
  body: string;
  note?: string;
  actions?: EmptyStateAction[];
  children?: ReactNode;
}

export function EmptyState({
  eyebrow,
  title,
  body,
  note,
  actions = [],
  children
}: EmptyStateProps): JSX.Element {
  return (
    <section className="empty-state-panel">
      <div>
        <div className="panel-label">{eyebrow}</div>
        <h2>{title}</h2>
        <p>{body}</p>
        {note ? <p className="muted-copy">{note}</p> : null}
      </div>
      {children}
      {actions.length > 0 ? (
        <div className="empty-state-actions">
          {actions.map((action) => (
            <button
              key={action.label}
              className={action.variant === "primary" ? "primary-button compact" : "ghost-button compact"}
              disabled={action.disabled}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
