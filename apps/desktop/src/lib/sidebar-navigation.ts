import type { ThreadSummary } from "./types";

export function sortRoomsByRecentActivity(
  threads: ThreadSummary[]
): ThreadSummary[] {
  return [...threads].sort(compareRoomsByRecentActivity);
}

function compareRoomsByRecentActivity(
  left: ThreadSummary,
  right: ThreadSummary
): number {
  const recency = right.updatedAt.localeCompare(left.updatedAt);
  if (recency !== 0) {
    return recency;
  }

  const leftLabel = left.roomHandle ?? left.title;
  const rightLabel = right.roomHandle ?? right.title;
  return leftLabel.localeCompare(rightLabel);
}
