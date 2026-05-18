import type { RunStatus } from "../lib/types";

interface RunStatusBadgeProps {
  status: RunStatus;
  compact?: boolean;
}

export function RunStatusBadge({
  status,
  compact = false
}: RunStatusBadgeProps): JSX.Element {
  return (
    <span className={`status-badge ${status} ${compact ? "compact" : ""}`}>
      {status}
    </span>
  );
}
