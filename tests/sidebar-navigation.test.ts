import { describe, expect, it } from "vitest";
import { sortRoomsByRecentActivity } from "../apps/desktop/src/lib/sidebar-navigation";
import type { ThreadSummary } from "../apps/desktop/src/lib/types";

describe("sidebar room navigation", () => {
  it("sorts rooms by latest activity instead of room defaults or selection state", () => {
    const rooms: ThreadSummary[] = [
      room({
        id: "thread_general",
        roomHandle: "general",
        updatedAt: "2026-05-26T08:00:00.000Z",
        pinned: true
      }),
      room({
        id: "thread_review",
        roomHandle: "review",
        updatedAt: "2026-05-26T10:00:00.000Z"
      }),
      room({
        id: "thread_planning",
        roomHandle: "planning",
        updatedAt: "2026-05-26T09:00:00.000Z"
      })
    ];

    expect(sortRoomsByRecentActivity(rooms).map((thread) => thread.id)).toEqual([
      "thread_review",
      "thread_planning",
      "thread_general"
    ]);
    expect(rooms.map((thread) => thread.id)).toEqual([
      "thread_general",
      "thread_review",
      "thread_planning"
    ]);
  });
});

function room(input: Partial<ThreadSummary> & Pick<ThreadSummary, "id">): ThreadSummary {
  return {
    id: input.id,
    title: input.title ?? input.roomHandle ?? input.id,
    projectId: input.projectId ?? "project_1",
    roomType: input.roomType ?? "custom",
    roomHandle: input.roomHandle,
    description: input.description,
    pinned: input.pinned,
    sharedContextEnabled: input.sharedContextEnabled ?? true,
    createdAt: input.createdAt ?? "2026-05-26T07:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-05-26T07:00:00.000Z",
    lastMessagePreview: input.lastMessagePreview,
    runCount: input.runCount,
    activeRunCount: input.activeRunCount
  };
}
