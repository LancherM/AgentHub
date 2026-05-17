import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DomainValidationError,
  DomainStateTransitionError,
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
});
