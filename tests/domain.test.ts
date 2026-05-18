import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DomainValidationError,
  DomainStateTransitionError,
  InMemoryTaskRunRepository,
  nowIso,
  parseAgentKind,
  validateMemoryItem,
  validateMemoryStatusTransition,
  validateProject,
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
