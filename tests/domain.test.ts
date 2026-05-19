import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DomainValidationError,
  DomainStateTransitionError,
  InMemoryConversationMessageRepository,
  InMemoryConversationThreadSummaryRepository,
  InMemoryConversationThreadRepository,
  InMemorySettingsRepository,
  InMemoryTaskRunRepository,
  nowIso,
  parseAgentKind,
  validateConversationMessage,
  validateConversationThread,
  validateConversationThreadSummary,
  validateMemoryItem,
  validateRunEvent,
  validateMemoryStatusTransition,
  validateProject,
  validateSetting,
  validateTask,
  validateTaskRun,
  validateTaskRunStatusTransition,
  validateTaskStatusTransition
} from "@agent-hub/core";

const createdAt = "2026-01-01T00:00:00.000Z";
const updatedAt = "2026-01-01T00:00:01.000Z";

describe("domain model validation", () => {
  it("preserves valid project input", () => {
    const now = nowIso();
    const project = {
      id: "project_1",
      name: "Sample",
      rootPath: path.resolve("/tmp/sample"),
      createdAt: now,
      updatedAt: now
    };

    expect(validateProject(project)).toBe(project);
  });

  it("rejects invalid project paths and timestamps", () => {
    expect(() =>
      validateProject({
        id: "project_1",
        name: "Sample",
        rootPath: "relative/path",
        createdAt: "not-a-date",
        updatedAt: nowIso()
      })
    ).toThrow(DomainValidationError);
  });

  it("validates task and run status enums", () => {
    const now = nowIso();
    expect(
      validateTask({
        id: "task_1",
        projectId: "project_1",
        title: "Run fake task",
        status: "open",
        createdAt: now,
        updatedAt: now
      }).status
    ).toBe("open");
    expect(
      validateTaskRun({
        id: "run_child",
        taskId: "task_1",
        agentKind: "fake",
        status: "queued",
        parentRunId: "run_parent",
        parentMessageId: "message_parent",
        createdAt: now,
        updatedAt: now
      })
    ).toMatchObject({
      parentRunId: "run_parent",
      parentMessageId: "message_parent"
    });

    expect(() =>
      validateTaskRun({
        id: "run_1",
        taskId: "task_1",
        agentKind: "fake",
        status: "review_ready" as never,
        createdAt: now,
        updatedAt: now
      })
    ).toThrow(DomainValidationError);
  });

  it("keeps run event types locked to the persisted MVP model", () => {
    expect(
      validateRunEvent({
        id: "event_1",
        taskRunId: "run_1",
        sequence: 0,
        type: "status",
        message: "Tool call summarized as status metadata.",
        metadata: {
          adapterEvent: {
            type: "tool_call",
            name: "read_file"
          }
        },
        createdAt
      }).type
    ).toBe("status");

    expect(() =>
      validateRunEvent({
        id: "event_bad",
        taskRunId: "run_1",
        sequence: 0,
        type: "tool_call" as never,
        message: "First-class tool-call events are not in the MVP event model.",
        metadata: {},
        createdAt
      })
    ).toThrow(DomainValidationError);
  });

  it("validates conversation threads and messages", () => {
    expect(
      validateConversationThread({
        id: "thread_1",
        projectId: "project_1",
        title: "Persist a thread",
        metadata: { source: "desktop" },
        createdAt,
        updatedAt
      })
    ).toMatchObject({
      id: "thread_1",
      projectId: "project_1",
      title: "Persist a thread"
    });

    expect(
      validateConversationMessage({
        id: "message_1",
        threadId: "thread_1",
        sequence: 0,
        role: "tool",
        kind: "run_card",
        content: "Fake run queued.",
        agentKind: "fake",
        runId: "run_1",
        status: "queued",
        metadata: { selected: true },
        createdAt
      })
    ).toMatchObject({
      id: "message_1",
      role: "tool",
      kind: "run_card",
      runId: "run_1"
    });

    expect(() =>
      validateConversationMessage({
        id: "message_bad",
        threadId: "thread_1",
        sequence: -1,
        role: "narrator" as never,
        kind: "text",
        content: "Invalid",
        createdAt
      })
    ).toThrow(DomainValidationError);
  });

  it("orders conversation messages and rejects duplicate thread sequences in memory", async () => {
    const threads = new InMemoryConversationThreadRepository();
    const messages = new InMemoryConversationMessageRepository();
    await threads.create({
      id: "thread_memory",
      projectId: "project_1",
      title: "Memory thread",
      createdAt,
      updatedAt
    });

    await messages.create({
      id: "message_second",
      threadId: "thread_memory",
      sequence: 1,
      role: "assistant",
      kind: "text",
      content: "Second",
      createdAt: updatedAt
    });
    await messages.create({
      id: "message_first",
      threadId: "thread_memory",
      sequence: 0,
      role: "user",
      kind: "text",
      content: "First",
      createdAt
    });

    await expect(messages.listByThreadId("thread_memory")).resolves.toEqual([
      expect.objectContaining({ id: "message_first", sequence: 0 }),
      expect.objectContaining({ id: "message_second", sequence: 1 })
    ]);
    await expect(messages.countByThreadId("thread_memory")).resolves.toBe(2);
    await expect(
      messages.update({
        id: "message_second",
        threadId: "thread_memory",
        sequence: 1,
        role: "assistant",
        kind: "text",
        content: "Second updated",
        status: "succeeded",
        createdAt: updatedAt
      })
    ).resolves.toMatchObject({
      id: "message_second",
      content: "Second updated",
      status: "succeeded"
    });
    await expect(
      messages.create({
        id: "message_duplicate_sequence",
        threadId: "thread_memory",
        sequence: 1,
        role: "system",
        kind: "text",
        content: "Duplicate",
        createdAt
      })
    ).rejects.toThrow("sequence 1 already exists");
    await expect(
      messages.update({
        id: "message_second",
        threadId: "thread_memory",
        sequence: 0,
        role: "assistant",
        kind: "text",
        content: "Duplicate update",
        createdAt: updatedAt
      })
    ).rejects.toThrow("sequence 0 already exists");
  });

  it("validates and upserts thread-local summaries in memory", async () => {
    expect(
      validateConversationThreadSummary({
        id: "summary_1",
        threadId: "thread_memory",
        summary: "Last goal: keep the renderer sandboxed.",
        decisions: ["Use runtime injection"],
        openItems: ["Wire desktop refresh"],
        constraints: ["Do not promote to approved memory"],
        lastKnownUserGoal: "Continue Phase 6",
        sourceMessageCount: 3,
        sourceLatestMessageId: "message_3",
        metadata: { source: "test" },
        createdAt,
        updatedAt
      })
    ).toMatchObject({
      id: "summary_1",
      threadId: "thread_memory",
      sourceMessageCount: 3
    });

    expect(() =>
      validateConversationThreadSummary({
        id: "summary_bad",
        threadId: "thread_memory",
        summary: "Invalid",
        decisions: ["ok"],
        openItems: ["ok"],
        constraints: [1] as never,
        sourceMessageCount: -1,
        createdAt,
        updatedAt
      })
    ).toThrow(DomainValidationError);

    const summaries = new InMemoryConversationThreadSummaryRepository();
    await summaries.upsert({
      id: "summary_1",
      threadId: "thread_memory",
      summary: "Initial",
      decisions: [],
      openItems: [],
      constraints: [],
      sourceMessageCount: 1,
      createdAt,
      updatedAt: createdAt
    });
    await summaries.upsert({
      id: "summary_2",
      threadId: "thread_memory",
      summary: "Updated",
      decisions: ["Keep it local"],
      openItems: [],
      constraints: [],
      sourceMessageCount: 2,
      createdAt,
      updatedAt
    });

    await expect(summaries.getByThreadId("thread_memory")).resolves.toMatchObject({
      id: "summary_2",
      summary: "Updated",
      decisions: ["Keep it local"],
      sourceMessageCount: 2
    });
  });

  it("validates memory category and status enums", () => {
    const now = nowIso();
    expect(
      validateMemoryItem({
        id: "memory_1",
        projectId: "project_1",
        category: "workflow_rule",
        status: "proposed",
        content: "Keep runs isolated.",
        createdAt: now,
        updatedAt: now
      }).status
    ).toBe("proposed");

    expect(() =>
      validateMemoryItem({
        id: "memory_2",
        projectId: "project_1",
        category: "secret" as never,
        status: "approved",
        content: "Invalid",
        createdAt: now,
        updatedAt: now
      })
    ).toThrow(DomainValidationError);
  });

  it("rejects secret-like local settings at the domain boundary", async () => {
    const safeSetting = {
      key: "ui.theme",
      value: { theme: "system", compact: true },
      updatedAt
    };
    expect(validateSetting(safeSetting)).toBe(safeSetting);

    for (const key of [
      "api_key",
      "openaiApiKey",
      "authToken",
      "github.accessToken",
      "github.refreshToken",
      "clientSecret",
      "token",
      "secret",
      "password",
      "passwordPrompt",
      "private_key",
      "privateKey",
      "credentials.github"
    ]) {
      expect(() =>
        validateSetting({
          key,
          value: "redacted",
          updatedAt
        })
      ).toThrow("setting.key must not store secrets");
    }

    expect(() =>
      validateSetting({
        key: "ui.banner",
        value: "openaiApiKey=redacted-value",
        updatedAt
      })
    ).toThrow("setting.value must not store secret-like string values");
    expect(() =>
      validateSetting({
        key: "ui.local",
        value: { apiKey: "redacted-value" },
        updatedAt
      })
    ).toThrow("setting.value.apiKey must not store secrets");

    const repository = new InMemorySettingsRepository();
    await expect(repository.set(safeSetting)).resolves.toEqual(safeSetting);
    await expect(
      repository.set({
        key: "local.token",
        value: "redacted",
        updatedAt
      })
    ).rejects.toThrow("setting.key must not store secrets");
    await expect(
      repository.set({
        key: "ui.footer",
        value: "api_key=redacted-value",
        updatedAt
      })
    ).rejects.toThrow("setting.value must not store secret-like string values");
  });

  it("parses supported agent kinds", () => {
    expect(parseAgentKind("fake")).toBe("fake");
    expect(parseAgentKind("codex")).toBe("codex");
    expect(parseAgentKind("claude-code")).toBe("claude-code");
    expect(() => parseAgentKind("unknown")).toThrow(DomainValidationError);
  });

  it("rejects status transitions outside the imported lifecycle", () => {
    expect(() => validateTaskStatusTransition("open", "running")).not.toThrow();
    expect(() => validateTaskStatusTransition("running", "open")).not.toThrow();
    expect(() => validateTaskStatusTransition("completed", "open"))
      .toThrow(DomainStateTransitionError);

    expect(() => validateTaskRunStatusTransition("queued", "running")).not.toThrow();
    expect(() => validateTaskRunStatusTransition("queued", "failed"))
      .toThrow(DomainStateTransitionError);

    expect(() => validateMemoryStatusTransition("proposed", "approved")).not.toThrow();
    expect(() => validateMemoryStatusTransition("rejected", "approved"))
      .toThrow(DomainStateTransitionError);
  });

  it("enforces imported task run transitions in in-memory storage", async () => {
    const repository = new InMemoryTaskRunRepository();
    await repository.create({
      id: "run_in_memory",
      taskId: "task_1",
      agentKind: "fake",
      status: "queued",
      createdAt,
      updatedAt: createdAt
    });

    await expect(
      repository.updateStatus("run_in_memory", "running", updatedAt)
    ).resolves.toMatchObject({
      status: "running",
      startedAt: updatedAt
    });
    await expect(
      repository.updateStatus("run_in_memory", "running", "2026-01-01T00:00:02.000Z")
    ).resolves.toMatchObject({
      status: "running",
      startedAt: updatedAt
    });
    await expect(
      repository.updateStatus("run_in_memory", "succeeded", "2026-01-01T00:00:03.000Z")
    ).resolves.toMatchObject({
      status: "succeeded",
      completedAt: "2026-01-01T00:00:03.000Z"
    });
    await expect(repository.getStatusTransitions("run_in_memory")).resolves.toEqual([
      { runId: "run_in_memory", status: "queued", at: createdAt },
      { runId: "run_in_memory", status: "running", at: updatedAt },
      {
        runId: "run_in_memory",
        status: "succeeded",
        at: "2026-01-01T00:00:03.000Z"
      }
    ]);
  });

  it("rejects invalid task run transitions in in-memory storage", async () => {
    const repository = new InMemoryTaskRunRepository();
    await repository.create({
      id: "run_invalid_transition",
      taskId: "task_1",
      agentKind: "fake",
      status: "queued",
      createdAt,
      updatedAt: createdAt
    });

    await expect(
      repository.updateStatus("run_invalid_transition", "failed", updatedAt)
    ).rejects.toThrow("invalid task run status transition queued -> failed");
    await expect(repository.get("run_invalid_transition")).resolves.toMatchObject({
      status: "queued"
    });
    await expect(repository.getStatusTransitions("run_invalid_transition")).resolves.toEqual([
      { runId: "run_invalid_transition", status: "queued", at: createdAt }
    ]);
  });
});
