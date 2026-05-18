import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  validateRunArtifact,
  validateRiskReport,
  validateTask,
  validateTaskRun
} from "@agent-hub/core";
import { createSqliteRepositories } from "@agent-hub/db";
import {
  createDesktopServiceContext,
  createProjectService
} from "../apps/desktop/electron/services/project-service";
import { createReviewService } from "../apps/desktop/electron/services/review-service";
import { createMemoryService } from "../apps/desktop/electron/services/memory-service";
import { createRunService } from "../apps/desktop/electron/services/run-service";
import { createThreadService } from "../apps/desktop/electron/services/thread-service";
import { runFakeAgent } from "../apps/desktop/electron/services/fake-agent-runner";
import {
  createIpcHandlers,
  IPC_CHANNELS
} from "../apps/desktop/electron/ipc-handlers";
import type { RunDetail, RunEvent } from "../apps/desktop/src/lib/types";

describe("desktop services", () => {
  it("registers a project and streams a fake desktop run without repository writes", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const runs = createRunService(context, {
      reviewService: review,
      memoryService: memory,
      fakeDelayMs: 5
    });

    const before = await fs.readdir(fixture.projectRoot);
    const project = await projects.open(fixture.projectRoot);
    const run = await runs.createRun({
      projectId: project.id,
      prompt: "Make the first desktop shell visible.",
      agentId: "fake",
      contextMode: "auto"
    });
    const liveEvents: RunEvent[] = [];
    const unsubscribe = runs.subscribe(run.id, (event) => liveEvents.push(event));
    const completed = await waitForRun(runs, run.id, "completed");
    unsubscribe();
    const after = await fs.readdir(fixture.projectRoot);

    expect(after).toEqual(before);
    expect(run.status).toBe("queued");
    expect(completed.status).toBe("completed");
    expect(completed.events.map((event) => event.type)).toEqual([
      "run_started",
      "context_compiled",
      "agent_step",
      "agent_output",
      "agent_step",
      "agent_output",
      "agent_step",
      "agent_output",
      "verification_started",
      "agent_output",
      "verification_finished",
      "run_completed"
    ]);
    expect(liveEvents.some((event) => event.type === "agent_output")).toBe(true);
    await expect(review.getDiff(run.id)).resolves.toMatchObject({
      files: [],
      empty: true,
      message: "No real repository files were modified in fake mode."
    });
    await expect(review.getVerification(run.id)).resolves.toMatchObject({
      status: "passed"
    });
    await expect(review.getRisk(run.id)).resolves.toMatchObject({
      level: "none",
      findings: []
    });
    await expect(review.getSummary(run.id)).resolves.toMatchObject({
      changedFileCount: 0,
      memoryProposalCount: expect.any(Number),
      reviewStatus: "pending"
    });
    const proposals = await memory.listProposals(run.id);
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals[0]).toMatchObject({
      runId: run.id,
      status: "pending"
    });
    await memory.approve([proposals[0].id]);
    await expect(memory.listProposals(run.id)).resolves.toContainEqual(
      expect.objectContaining({
        id: proposals[0].id,
        status: "approved"
      })
    );
    await expect(review.getLogs(run.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ runId: run.id, level: "info" })
      ])
    );
  });

  it("preserves persisted blocking risk reports for real review inspection", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const review = createReviewService(context);
    const project = await projects.open(fixture.projectRoot);
    const now = context.now();
    const task = await fixture.repositories.taskRepository.create(
      validateTask({
        id: "task_blocking",
        projectId: project.id,
        title: "Inspect blocking risk",
        status: "completed",
        createdAt: now,
        updatedAt: now
      })
    );
    const run = await fixture.repositories.taskRunRepository.create(
      validateTaskRun({
        id: "run_blocking",
        taskId: task.id,
        agentKind: "codex",
        status: "succeeded",
        createdAt: now,
        updatedAt: now,
        startedAt: now,
        completedAt: now
      })
    );
    await fixture.repositories.riskReportRepository.create(
      validateRiskReport({
        id: "risk_blocking",
        taskRunId: run.id,
        level: "blocking",
        summary: "Blocking safety report from TaskRunner.",
        changedFiles: [".env"],
        verificationSummary: "Verification skipped.",
        failedChecks: [],
        riskFactors: ["Sensitive path changed: .env"],
        manualReviewChecklist: ["Inspect the sensitive file change before acceptance."],
        acceptanceRecommendation: "Do not accept automatically.",
        findings: [
          {
            level: "blocking",
            summary: "Sensitive path changed",
            details: ".env was modified by the agent run."
          }
        ],
        createdAt: now
      })
    );

    await expect(review.getRisk(run.id)).resolves.toMatchObject({
      level: "blocking",
      findings: expect.arrayContaining([
        expect.objectContaining({
          severity: "blocking",
          title: "Sensitive path changed",
          description: ".env was modified by the agent run."
        }),
        expect.objectContaining({
          severity: "blocking",
          description: "Sensitive path changed: .env"
        })
      ])
    });
    await expect(review.getSummary(run.id)).resolves.toMatchObject({
      riskLevel: "blocking"
    });
  });

  it("redacts sensitive persisted diff patches in desktop review", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const review = createReviewService(context);
    const project = await projects.open(fixture.projectRoot);
    const now = context.now();
    const task = await fixture.repositories.taskRepository.create(
      validateTask({
        id: "task_sensitive_diff",
        projectId: project.id,
        title: "Inspect sensitive diff",
        status: "completed",
        createdAt: now,
        updatedAt: now
      })
    );
    const run = await fixture.repositories.taskRunRepository.create(
      validateTaskRun({
        id: "run_sensitive_diff",
        taskId: task.id,
        agentKind: "codex",
        status: "succeeded",
        createdAt: now,
        updatedAt: now,
        startedAt: now,
        completedAt: now
      })
    );
    await fixture.repositories.runArtifactRepository.create(
      validateRunArtifact({
        id: "artifact_sensitive_diff",
        taskRunId: run.id,
        kind: "git_diff",
        content: [
          "diff --git a/.env.local b/.env.local",
          "--- a/.env.local",
          "+++ b/.env.local",
          "+API_TOKEN=secret-value",
          ""
        ].join("\n"),
        metadata: {
          changedFiles: [{ path: ".env.local", status: "modified" }],
          fileSummaries: [".env.local: modified +1/-0"]
        },
        createdAt: now
      })
    );

    await expect(review.getDiff(run.id)).resolves.toMatchObject({
      files: [expect.objectContaining({ path: ".env.local" })],
      patch: expect.stringContaining("Patch redacted because sensitive file path changed")
    });
    const diff = await review.getDiff(run.id);
    expect(diff.patch).toContain(".env.local");
    expect(diff.patch).not.toContain("API_TOKEN=secret-value");
  });

  it("records accept and reject as review decisions only", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const runs = createRunService(context, {
      reviewService: review,
      memoryService: memory,
      fakeDelayMs: 5
    });
    const before = await fs.readdir(fixture.projectRoot);
    const project = await projects.open(fixture.projectRoot);
    const run = await runs.createRun({
      projectId: project.id,
      prompt: "Review decision only.",
      agentId: "fake",
      contextMode: "auto"
    });
    await waitForRun(runs, run.id, "completed");

    const accepted = await review.acceptRun(run.id);
    expect(accepted).toMatchObject({
      reviewStatus: "accepted",
      message: "Accepted for record. No merge was performed."
    });
    expect(accepted.acceptedAt).toBeDefined();

    const rejected = await review.rejectRun(run.id, "not needed");
    expect(rejected).toMatchObject({
      reviewStatus: "rejected",
      message: "Rejected for record. No files were deleted or reverted."
    });
    expect(rejected.rejectedAt).toBeDefined();
    await expect(fs.readdir(fixture.projectRoot)).resolves.toEqual(before);
  });

  it("cancels a running fake desktop run and emits run_cancelled", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const runs = createRunService(context, {
      reviewService: review,
      memoryService: memory,
      fakeDelayMs: 25
    });
    const project = await projects.open(fixture.projectRoot);
    const run = await runs.createRun({
      projectId: project.id,
      prompt: "Cancel this run.",
      agentId: "fake",
      contextMode: "auto"
    });
    const liveEvents: RunEvent[] = [];
    const unsubscribe = runs.subscribe(run.id, (event) => liveEvents.push(event));

    await waitForEvent(liveEvents, "run_started");
    await runs.cancelRun(run.id);
    const cancelled = await runs.getRun(run.id);
    unsubscribe();

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.events.at(-1)?.type).toBe("run_cancelled");
    expect(cancelled.events.some((event) => event.type === "run_completed"))
      .toBe(false);
  });

  it("fake agent runner emits cancellation without touching repositories", async () => {
    const controller = new AbortController();
    const events: RunEvent["type"][] = [];
    const promise = runFakeAgent(
      {
        prompt: "cancel",
        contextMode: "auto",
        signal: controller.signal,
        delayMs: 25
      },
      (event) => {
        events.push(event.type);
        if (event.type === "run_started") {
          controller.abort();
        }
      }
    );

    await promise;

    expect(events).toEqual(["run_started", "run_cancelled"]);
  });

  it("records unavailable real-agent desktop mentions without launching adapters", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const runs = createRunService(context, {
      reviewService: review,
      memoryService: memory,
      fakeDelayMs: 5
    });
    const before = await fs.readdir(fixture.projectRoot);
    const project = await projects.open(fixture.projectRoot);

    const run = await runs.createRun({
      projectId: project.id,
      prompt: "Compare desktop orchestration approaches.",
      agentId: "codex",
      contextMode: "auto"
    });
    const failed = await waitForRun(runs, run.id, "failed");
    const after = await fs.readdir(fixture.projectRoot);

    expect(after).toEqual(before);
    expect(failed.agentId).toBe("codex");
    expect(failed.events.map((event) => event.type)).toContain("run_failed");
    expect(failed.summary).toContain("not wired yet");
    await expect(review.getDiff(run.id)).resolves.toMatchObject({
      files: [],
      empty: true,
      message: "No real repository files were modified."
    });
  });

  it("thread sendMessage creates one user message and one run card per agent", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const runs = createRunService(context, {
      reviewService: review,
      memoryService: memory,
      fakeDelayMs: 5
    });
    const threads = createThreadService({ projects, runs });
    const project = await projects.open(fixture.projectRoot);

    const detail = await threads.sendMessage({
      projectId: project.id,
      text: "@fake @codex compare implementations",
      contextMode: "workspace"
    });
    const runMessages = detail.messages.filter(
      (message) => message.type === "agent_run"
    );

    expect(detail.title).toBe("compare implementations");
    expect(detail.messages[0]).toMatchObject({
      type: "user",
      text: "compare implementations",
      mentions: ["fake", "codex"]
    });
    expect(runMessages).toHaveLength(2);
    expect(runMessages.map((message) => message.agentId)).toEqual([
      "fake",
      "codex"
    ]);

    const fakeRun = runMessages.find((message) => message.agentId === "fake");
    const codexRun = runMessages.find((message) => message.agentId === "codex");
    if (!fakeRun || !codexRun) {
      throw new Error("expected fake and codex run messages");
    }
    await waitForRun(runs, fakeRun.runId, "completed");
    await waitForRun(runs, codexRun.runId, "failed");

    const refreshed = await threads.getThread(detail.id);
    expect(
      refreshed.messages
        .filter((message) => message.type === "agent_run")
        .map((message) => message.status)
    ).toEqual(["completed", "failed"]);
    await expect(threads.listThreads()).resolves.toMatchObject([
      {
        id: detail.id,
        activeRunCount: 0,
        runCount: 2
      }
    ]);
  });

  it("validates IPC run creation and rejects repo_export delivery", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const runs = createRunService(context, {
      reviewService: review,
      memoryService: memory,
      fakeDelayMs: 5
    });
    const threads = createThreadService({ projects, runs });
    const handlers = createIpcHandlers({ projects, runs, threads, review, memory });
    const sender = { send: vi.fn() };
    const project = await projects.open(fixture.projectRoot);

    await expect(
      handlers[IPC_CHANNELS.runsCreate]({ sender } as never, {
        projectId: project.id,
        prompt: "Run from IPC",
        agentId: "fake",
        contextMode: "auto",
        deliveryMode: "repo_export"
      })
    ).rejects.toThrow(/deliveryMode/);

    const summary = await handlers[IPC_CHANNELS.runsCreate](
      { sender } as never,
      {
        projectId: project.id,
        prompt: "Run from IPC",
        agentId: "fake",
        contextMode: "auto"
      }
    );

    expect(summary).toMatchObject({ status: "queued" });
    await handlers[IPC_CHANNELS.runsSubscribe](
      { sender } as never,
      (summary as { id: string }).id
    );
    await waitForRun(runs, (summary as { id: string }).id, "completed");
    await expect(
      handlers[IPC_CHANNELS.reviewSummary](
        { sender } as never,
        (summary as { id: string }).id
      )
    ).resolves.toMatchObject({
      reviewStatus: "pending",
      changedFileCount: 0
    });
    await expect(
      handlers[IPC_CHANNELS.reviewReject]({ sender } as never, {
        runId: (summary as { id: string }).id,
        reason: "x".repeat(1_001)
      })
    ).rejects.toThrow(/1000/);
    await expect(
      handlers[IPC_CHANNELS.reviewAccept](
        { sender } as never,
        (summary as { id: string }).id
      )
    ).resolves.toMatchObject({
      reviewStatus: "accepted"
    });
    expect(sender.send).toHaveBeenCalled();
    await handlers[IPC_CHANNELS.runsUnsubscribe](
      { sender } as never,
      (summary as { id: string }).id
    );
  });
});

async function waitForRun(
  runs: ReturnType<typeof createRunService>,
  runId: string,
  status: RunDetail["status"]
): Promise<RunDetail> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const detail = await runs.getRun(runId);
    if (detail.status === status) {
      return detail;
    }
    await sleep(10);
  }
  throw new Error(`timed out waiting for run ${runId} to become ${status}`);
}

async function waitForEvent(
  events: RunEvent[],
  type: RunEvent["type"]
): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (events.some((event) => event.type === type)) {
      return;
    }
    await sleep(10);
  }
  throw new Error(`timed out waiting for ${type}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createFixture(): Promise<{
  projectRoot: string;
  repositories: ReturnType<typeof createSqliteRepositories>;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-hub-desktop-"));
  const projectRoot = path.join(root, "repo");
  await fs.mkdir(projectRoot);
  await fs.writeFile(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ packageManager: "pnpm@10.10.0" }, null, 2),
    "utf8"
  );
  const repositories = createSqliteRepositories({
    databasePath: path.join(root, "agent-hub.sqlite")
  });
  return { projectRoot, repositories };
}
