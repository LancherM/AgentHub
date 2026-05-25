import { describe, expect, it } from "vitest";
import {
  buildRunProgress,
  compareAffordanceForRun
} from "../apps/desktop/src/lib/run-progress";
import type {
  AgentRunMessage,
  RunDetail,
  RunEvent,
  ThreadMessage
} from "../apps/desktop/src/lib/types";

describe("buildRunProgress", () => {
  it("maps active run events onto stable stages", () => {
    expect(
      buildRunProgress({
        status: "running",
        events: [runEvent("context_compiled", 1)]
      }).stageId
    ).toBe("prepare");

    expect(
      buildRunProgress({
        status: "running",
        events: [runEvent("agent_step", 2, "Writing files")]
      }).stageId
    ).toBe("run");

    const verifying = buildRunProgress({
      status: "verifying",
      events: [
        runEvent("agent_step", 2, "Writing files"),
        runEvent("verification_started", 3, "pnpm test")
      ]
    });
    expect(verifying.stageId).toBe("verify");
    expect(verifying.waitState).toBe("Waiting for checks");
    expect(verifying.activityText).toBe("pnpm test");
    expect(verifying.stages.map((stage) => stage.state)).toEqual([
      "done",
      "done",
      "current",
      "pending"
    ]);
  });

  it("maps terminal runs to review states without losing the last activity", () => {
    const progress = buildRunProgress({
      status: "completed",
      events: [
        runEvent("verification_finished", 4, "Checks passed"),
        runEvent("run_completed", 5, "Run completed")
      ]
    });

    expect(progress.stageId).toBe("review");
    expect(progress.waitState).toBe("Review ready");
    expect(progress.activityText).toBe("Run completed");
    expect(progress.stages.at(-1)?.state).toBe("current");
  });

  it("uses terminal event state when detail status has not refreshed yet", () => {
    const progress = buildRunProgress({
      status: "running",
      events: [runEvent("run_cancelled", 5, "Run cancelled")]
    });

    expect(progress.stageId).toBe("review");
    expect(progress.waitState).toBe("Cancelled");
    expect(progress.tone).toBe("danger");
  });
});

describe("compareAffordanceForRun", () => {
  it("enables compare for terminal same-task runs", () => {
    const messages: ThreadMessage[] = [
      userMessage("user_1"),
      runMessage("run_1", "task_1", "completed"),
      runMessage("run_2", "task_1", "failed")
    ];

    expect(compareAffordanceForRun("run_1", messages, {})).toMatchObject({
      enabled: true,
      candidateCount: 1,
      candidateRunIds: ["run_2"]
    });
  });

  it("enables compare for terminal same-turn runs with different tasks", () => {
    const messages: ThreadMessage[] = [
      userMessage("user_1"),
      runMessage("run_1", "task_1", "completed"),
      runMessage("run_2", "task_2", "completed"),
      userMessage("user_2"),
      runMessage("run_3", "task_3", "completed")
    ];

    expect(compareAffordanceForRun("run_1", messages, {})).toMatchObject({
      enabled: true,
      candidateCount: 1,
      candidateRunIds: ["run_2"]
    });
  });

  it("explains disabled compare states", () => {
    const messages: ThreadMessage[] = [
      userMessage("user_1"),
      runMessage("run_1", "task_1", "running"),
      runMessage("run_2", "task_1", "completed")
    ];

    expect(compareAffordanceForRun("run_1", messages, {})).toMatchObject({
      enabled: false,
      title: "Compare is available after this run reaches a terminal state."
    });

    expect(
      compareAffordanceForRun(
        "run_2",
        messages,
        runDetails({ runId: "run_2", taskId: "task_9", status: "completed" })
      )
    ).toMatchObject({
      enabled: false,
      title: "Compare needs another terminal run from this task or turn."
    });
  });
});

function runEvent(
  type: RunEvent["type"],
  sequence: number,
  message?: string
): RunEvent {
  return {
    id: `event_${sequence}`,
    runId: "run_1",
    sequence,
    type,
    timestamp: `2026-05-25T00:00:0${sequence}.000Z`,
    payload: message ? { message } : {}
  };
}

function userMessage(id: string): ThreadMessage {
  return {
    type: "user",
    id,
    threadId: "thread_1",
    text: "Run it",
    mentions: ["fake"],
    createdAt: "2026-05-25T00:00:00.000Z"
  };
}

function runMessage(
  runId: string,
  taskId: string,
  status: AgentRunMessage["status"]
): AgentRunMessage {
  return {
    type: "agent_run",
    id: `message_${runId}`,
    threadId: "thread_1",
    runId,
    agentId: "fake",
    status,
    taskId,
    createdAt: "2026-05-25T00:00:00.000Z"
  };
}

function runDetails(input: {
  runId: string;
  taskId: string;
  status: AgentRunMessage["status"];
}): Record<string, RunDetail> {
  return {
    [input.runId]: {
      id: input.runId,
      projectId: "project_1",
      projectName: "Project",
      taskId: input.taskId,
      title: "Task",
      taskPrompt: "Run it",
      agentId: "fake",
      status: input.status,
      canContinueCodeState: false,
      createdAt: "2026-05-25T00:00:00.000Z",
      updatedAt: "2026-05-25T00:00:01.000Z",
      events: [],
      changedFiles: [],
      verification: { runId: input.runId, status: "unknown", commands: [] },
      risk: {
        runId: input.runId,
        level: "low",
        findings: [],
        generatedAt: "2026-05-25T00:00:01.000Z"
      },
      memoryProposals: [],
      summary: ""
    }
  };
}
