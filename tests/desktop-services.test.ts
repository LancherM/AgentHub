import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createSqliteRepositories } from "@agent-hub/db";
import { createDesktopServiceContext, createProjectService } from "../apps/desktop/electron/services/project-service";
import { createReviewService } from "../apps/desktop/electron/services/review-service";
import { createMemoryService } from "../apps/desktop/electron/services/memory-service";
import { createRunService } from "../apps/desktop/electron/services/run-service";
import { createIpcHandlers, IPC_CHANNELS } from "../apps/desktop/electron/ipc";

describe("desktop services", () => {
  it("registers a project and creates a fake desktop run without repository writes", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const review = createReviewService(context);
    const memory = createMemoryService(context);
    const runs = createRunService(context, {
      reviewService: review,
      memoryService: memory
    });

    const before = await fs.readdir(fixture.projectRoot);
    const project = await projects.open(fixture.projectRoot);
    const run = await runs.create({
      projectId: project.id,
      prompt: "Make the first desktop shell visible.",
      agentKind: "fake",
      contextMode: "auto"
    });
    const after = await fs.readdir(fixture.projectRoot);

    expect(after).toEqual(before);
    expect(run.status).toBe("succeeded");
    await expect(review.getDiff(run.id)).resolves.toMatchObject({
      changedFiles: [],
      isPlaceholder: true
    });
    await expect(review.getVerification(run.id)).resolves.toMatchObject({
      status: "skipped"
    });
    await expect(review.getRisk(run.id)).resolves.toMatchObject({
      level: "low"
    });
  });

  it("validates IPC run creation and rejects repo_export delivery", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const review = createReviewService(context);
    const memory = createMemoryService(context);
    const runs = createRunService(context, {
      reviewService: review,
      memoryService: memory
    });
    const handlers = createIpcHandlers({ projects, runs, review, memory });
    const sender = { send: vi.fn() };
    const project = await projects.open(fixture.projectRoot);

    await expect(
      handlers[IPC_CHANNELS.runsCreate]({ sender } as never, {
        projectId: project.id,
        prompt: "Run from IPC",
        agentKind: "fake",
        contextMode: "auto",
        deliveryMode: "repo_export"
      })
    ).rejects.toThrow(/deliveryMode/);

    const summary = await handlers[IPC_CHANNELS.runsCreate](
      { sender } as never,
      {
        projectId: project.id,
        prompt: "Run from IPC",
        agentKind: "fake",
        contextMode: "auto"
      }
    );

    expect(summary).toMatchObject({ status: "succeeded" });
    expect(sender.send).toHaveBeenCalled();
  });
});

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
