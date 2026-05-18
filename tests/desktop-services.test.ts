import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createSqliteRepositories } from "@agent-hub/db";
import {
  createDesktopServiceContext,
  createProjectService
} from "../apps/desktop/electron/services/project-service";
import { createReviewService } from "../apps/desktop/electron/services/review-service";
import { createMemoryService } from "../apps/desktop/electron/services/memory-service";
import { createRunService } from "../apps/desktop/electron/services/run-service";
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
    const review = createReviewService(context);
    const memory = createMemoryService(context);
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
      changedFiles: [],
      isPlaceholder: true
    });
    await expect(review.getVerification(run.id)).resolves.toMatchObject({
      status: "passed"
    });
    await expect(review.getRisk(run.id)).resolves.toMatchObject({
      level: "low"
    });
  });

  it("cancels a running fake desktop run and emits run_cancelled", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const review = createReviewService(context);
    const memory = createMemoryService(context);
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

  it("validates IPC run creation and rejects repo_export delivery", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const review = createReviewService(context);
    const memory = createMemoryService(context);
    const runs = createRunService(context, {
      reviewService: review,
      memoryService: memory,
      fakeDelayMs: 5
    });
    const handlers = createIpcHandlers({ projects, runs, review, memory });
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
  const repositories = createSqliteRepositories({
    databasePath: path.join(root, "agent-hub.sqlite")
  });
  return { projectRoot, repositories };
}
