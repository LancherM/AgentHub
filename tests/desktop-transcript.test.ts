import { describe, expect, it } from "vitest";
import {
  quietRunCardIds,
  visibleTranscriptMessages
} from "../apps/desktop/src/lib/transcript";
import type { ThreadMessage } from "../apps/desktop/src/lib/types";

describe("quietRunCardIds", () => {
  it("marks terminal run cards quiet only when a durable assistant answer exists", () => {
    const messages: ThreadMessage[] = [
      {
        type: "agent_run",
        id: "message_run_1",
        threadId: "thread_1",
        runId: "run_1",
        agentId: "codex",
        status: "completed",
        createdAt: "2026-05-25T00:00:00.000Z"
      },
      {
        type: "assistant",
        id: "message_assistant_1",
        threadId: "thread_1",
        runId: "run_1",
        agentId: "codex",
        text: "Implemented the transcript update.",
        status: "completed",
        createdAt: "2026-05-25T00:00:01.000Z"
      },
      {
        type: "agent_run",
        id: "message_run_2",
        threadId: "thread_1",
        runId: "run_2",
        agentId: "fake",
        status: "running",
        createdAt: "2026-05-25T00:00:02.000Z"
      }
    ];

    expect([...quietRunCardIds(messages, {})]).toEqual(["run_1"]);
  });
});

describe("visibleTranscriptMessages", () => {
  it("keeps lifecycle system events out of the default transcript", () => {
    const messages: ThreadMessage[] = [
      {
        type: "user",
        id: "message_user",
        threadId: "thread_1",
        text: "Run this",
        mentions: ["fake"],
        createdAt: "2026-05-25T00:00:00.000Z"
      },
      {
        type: "system",
        id: "message_task",
        threadId: "thread_1",
        text: "Task created: Run this",
        metadata: { taskEvent: "task_created" },
        createdAt: "2026-05-25T00:00:01.000Z"
      },
      {
        type: "assistant",
        id: "message_assistant",
        threadId: "thread_1",
        text: "Done",
        agentId: "fake",
        createdAt: "2026-05-25T00:00:02.000Z"
      }
    ];

    expect(visibleTranscriptMessages(messages).map((message) => message.id)).toEqual([
      "message_user",
      "message_assistant"
    ]);
  });
});
