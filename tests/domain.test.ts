import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DomainValidationError,
  nowIso,
  parseAgentKind,
  validateMemoryItem,
  validateProject,
  validateTask,
  validateTaskRun
} from "../src/domain";

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
});

