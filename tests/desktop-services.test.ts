import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import {
  validateConversationMessage,
  validateMemoryItem,
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
import { createSettingsService } from "../apps/desktop/electron/services/settings-service";
import { runFakeAgent } from "../apps/desktop/electron/services/fake-agent-runner";
import {
  CodexAdapter,
  DefaultAgentRegistry,
  FakeAgentAdapter,
  type ProcessDetectionInput,
  type ProcessDetectionResult,
  type ProcessRunEvent,
  type ProcessRunInput,
  type ProcessRunner
} from "@agent-hub/agent-adapters";
import {
  createIpcHandlers,
  IPC_CHANNELS,
  runEventChannel
} from "../apps/desktop/electron/ipc-handlers";
import type { RunDetail, RunEvent } from "../apps/desktop/src/lib/types";
import { MockProcessRunner, MockShellExecutor } from "./helpers";
import {
  VerificationRunner,
  type TaskRunnerDependencies
} from "@agent-hub/task-runner";
import { buildContextArtifacts } from "@agent-hub/context-compiler";

const execFileAsync = promisify(execFile);

describe("desktop services", () => {
  it("registers a project and completes a fake TaskRunner desktop run without repository root writes", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories, {
      agentHubHome: fixture.agentHubHome
    });
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const runs = createTestRunService(context, review, memory, fixture);

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
    await waitForEvent(liveEvents, "agent_output");
    await waitForEvent(liveEvents, "run_completed");
    unsubscribe();
    const completedWithEvents = await runs.getRun(run.id);
    const after = await fs.readdir(fixture.projectRoot);

    expect(after).toEqual(before);
    expect(run.status).toBe("queued");
    expect(completed.status).toBe("completed");
    expect(completedWithEvents.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "context_compiled",
        "run_started",
        "agent_output",
        "verification_started",
        "verification_finished",
        "run_completed"
      ])
    );
    expect(liveEvents.some((event) => event.type === "agent_output")).toBe(true);
    await expect(review.getDiff(run.id)).resolves.toMatchObject({
      files: [expect.objectContaining({ path: "fake-agent-output.md" })],
      empty: false
    });
    await expect(review.getVerification(run.id)).resolves.toMatchObject({
      status: "skipped",
      commands: [],
      message: "No verification commands were configured."
    });
    await expect(review.getRisk(run.id)).resolves.toMatchObject({
      level: "medium"
    });
    await expect(review.getSummary(run.id)).resolves.toMatchObject({
      changedFileCount: 1,
      memoryProposalCount: expect.any(Number),
      reviewStatus: "pending"
    });
    const proposals = await memory.listProposals(run.id);
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals[0]).toMatchObject({
      runId: run.id,
      status: "pending"
    });
    const approval = await memory.approve([proposals[0].id]);
    await expect(memory.listProposals(run.id)).resolves.toContainEqual(
      expect.objectContaining({
        id: proposals[0].id,
        status: "approved",
        approvedMemoryPath: approval[0].approvedMemoryPath
      })
    );
    expect(approval).toEqual([
      expect.objectContaining({
        id: proposals[0].id,
        status: "approved",
        writeback: "written",
        approvedMemoryPath: path.join(
          fixture.agentHubHome,
          "context-stores",
          project.id,
          "memory",
          "approved.md"
        )
      })
    ]);
    const repeatedApproval = await memory.approve([proposals[0].id]);
    expect(repeatedApproval).toEqual([
      expect.objectContaining({
        id: proposals[0].id,
        status: "approved",
        writeback: "already_present"
      })
    ]);
    await fixture.repositories.memoryItemRepository.create(
      validateMemoryItem({
        id: "memory_duplicate",
        projectId: project.id,
        taskId: run.taskId,
        category: "workflow_rule",
        status: "proposed",
        content: proposals[0].content,
        createdAt: context.now(),
        updatedAt: context.now()
      })
    );
    const duplicateApproval = await memory.approve(["memory_duplicate"]);
    expect(duplicateApproval).toEqual([
      expect.objectContaining({
        id: "memory_duplicate",
        status: "approved",
        writeback: "already_present"
      })
    ]);
    const approvedMemory = await fs.readFile(approval[0].approvedMemoryPath!, "utf8");
    expect(countOccurrences(approvedMemory, proposals[0].content)).toBe(1);
    const built = await buildContextArtifacts({
      projectRoot: fixture.projectRoot,
      projectId: project.id,
      taskId: "task_desktop_memory_context",
      title: "Use approved desktop memory",
      prompt: "Build future context",
      selectedAgentId: "fake",
      agentHubHome: fixture.agentHubHome
    });
    expect(built.contextPack.approvedMemorySections.join("\n")).toContain(
      proposals[0].content
    );
    await expect(review.getLogs(run.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ runId: run.id, level: "stdout" })
      ])
    );
  });

  it("stores per-project verification settings through service and IPC validation", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const settings = createSettingsService(context);
    const runs = createTestRunService(context, review, memory, fixture);
    const threads = createThreadService({ context, projects, runs });
    const handlers = createIpcHandlers({
      projects,
      runs,
      threads,
      review,
      memory,
      settings
    });
    const sender = { send: vi.fn() };
    const project = await projects.open(fixture.projectRoot);

    await expect(
      handlers[IPC_CHANNELS.settingsSaveVerification]({ sender } as never, {
        projectId: project.id,
        commands: [
          {
            id: "typecheck",
            label: "Desktop typecheck",
            executable: "pnpm",
            args: ["--filter", "desktop", "typecheck"],
            timeoutMs: 1234,
            continueOnFailure: true
          }
        ]
      })
    ).resolves.toMatchObject({
      projectId: project.id,
      commands: [
        expect.objectContaining({
          id: "typecheck",
          executable: "pnpm",
          args: ["--filter", "desktop", "typecheck"]
        })
      ]
    });
    await expect(settings.getVerification(project.id)).resolves.toMatchObject({
      commands: [
        expect.objectContaining({
          id: "typecheck",
          label: "Desktop typecheck",
          timeoutMs: 1234,
          continueOnFailure: true
        })
      ]
    });
    await expect(
      handlers[IPC_CHANNELS.settingsGetVerification](
        { sender } as never,
        project.id
      )
    ).resolves.toMatchObject({
      projectId: project.id,
      commands: [expect.objectContaining({ id: "typecheck" })]
    });
    await expect(
      handlers[IPC_CHANNELS.settingsSaveVerification]({ sender } as never, {
        projectId: project.id,
        commands: [
          { id: "bad", executable: "pnpm test", args: [] }
        ]
      })
    ).rejects.toThrow(/executable/);
    await expect(
      handlers[IPC_CHANNELS.settingsSaveVerification]({ sender } as never, {
        projectId: project.id,
        commands: [
          { id: "dup", executable: "pnpm", args: [] },
          { id: "dup", executable: "pnpm", args: [] }
        ]
      })
    ).rejects.toThrow(/unique/);
    await expect(
      handlers[IPC_CHANNELS.settingsSaveVerification]({ sender } as never, {
        projectId: project.id,
        commands: [
          { id: "cwd", executable: "pnpm", args: [], cwd: fixture.projectRoot }
        ]
      })
    ).rejects.toThrow(/unsupported field cwd/);
    await expect(
      handlers[IPC_CHANNELS.settingsSaveVerification]({ sender } as never, {
        projectId: project.id,
        commands: [
          {
            id: "secret-arg",
            executable: "agent-hub",
            args: ["--api-key", "redacted-value"]
          }
        ]
      })
    ).rejects.toThrow(/secret-like option name/);
  });

  it("passes configured desktop verification commands to TaskRunner in the isolated worktree", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const settings = createSettingsService(context);
    const shell = new MockShellExecutor([{ stdout: "ok\n" }]);
    const runs = createTestRunService(context, review, memory, fixture, {
      verificationRunner: new VerificationRunner(shell)
    });
    const project = await projects.open(fixture.projectRoot);
    await settings.saveVerification({
      projectId: project.id,
      commands: [
        {
          id: "test",
          label: "Project tests",
          executable: "pnpm",
          args: ["test"]
        }
      ]
    });

    const run = await runs.createRun({
      projectId: project.id,
      prompt: "Run configured verification.",
      agentId: "fake",
      contextMode: "auto"
    });
    await waitForRun(runs, run.id, "completed");

    expect(shell.calls).toHaveLength(1);
    expect(shell.calls[0].command).toMatchObject({
      executable: "pnpm",
      args: ["test"],
      displayName: "Project tests"
    });
    expect(shell.calls[0].options.cwd).not.toBe(fixture.projectRoot);
    expect(shell.calls[0].options.cwd).toContain(fixture.workspaceBasePath);
    await expect(review.getVerification(run.id)).resolves.toMatchObject({
      status: "passed",
      commands: [
        expect.objectContaining({
          command: "pnpm test",
          status: "passed",
          stdout: "ok\n"
        })
      ]
    });
  });

  it("converts dangerous desktop verification commands into inspectable failed evidence", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const settings = createSettingsService(context);
    const runs = createTestRunService(context, review, memory, fixture, {
      verificationRunner: new VerificationRunner(new MockShellExecutor())
    });
    const project = await projects.open(fixture.projectRoot);
    await settings.saveVerification({
      projectId: project.id,
      commands: [
        {
          id: "danger",
          executable: "sudo",
          args: ["true"]
        }
      ]
    });

    const run = await runs.createRun({
      projectId: project.id,
      prompt: "Reject dangerous verification.",
      agentId: "fake",
      contextMode: "auto"
    });
    const failed = await waitForRun(runs, run.id, "failed");
    const failedWithTerminalEvent =
      await waitForPersistedRunEvent(runs, run.id, "run_failed");

    expect(failed.status).toBe("failed");
    expect(failedWithTerminalEvent.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["verification_started", "verification_finished", "run_failed"])
    );
    await expect(review.getVerification(run.id)).resolves.toMatchObject({
      status: "failed",
      commands: [
        expect.objectContaining({
          command: "sudo true",
          status: "failed",
          stderr: expect.stringContaining("refusing to execute dangerous command")
        })
      ]
    });
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
    const runs = createTestRunService(context, review, memory, fixture);
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

  it("exposes retained worktree handoff evidence and copy/open actions", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const openedPaths: string[] = [];
    const copiedValues: string[] = [];
    const review = createReviewService(context, {
      memoryService: memory,
      handoffPlatform: {
        openPath: async (worktreePath) => {
          openedPaths.push(worktreePath);
          return "";
        },
        writeText: (value) => {
          copiedValues.push(value);
        }
      }
    });
    const runs = createTestRunService(context, review, memory, fixture);
    const before = await fs.readdir(fixture.projectRoot);
    const project = await projects.open(fixture.projectRoot);
    const run = await runs.createRun({
      projectId: project.id,
      prompt: "Expose this retained handoff.",
      agentId: "fake",
      contextMode: "auto"
    });
    await waitForRun(runs, run.id, "completed");

    const handoff = await review.getHandoff(run.id);
    expect(handoff).toMatchObject({
      runId: run.id,
      available: true,
      cleanup: {
        retained: true,
        cleaned: false
      },
      changedFiles: [expect.objectContaining({ path: "fake-agent-output.md" })]
    });
    expect(handoff.worktreePath).toContain(fixture.workspaceBasePath);
    expect(handoff.worktreePath).not.toBe(fixture.projectRoot);
    expect(handoff.branchName).toMatch(/^agent-hub\//);
    expect(handoff.baseRef).toBeDefined();
    expect(handoff.headRef).toBe(handoff.branchName);
    expect(handoff.commands.map((command) => command.command)).toEqual([
      `git -C '${handoff.worktreePath}' status --short`,
      `git -C '${handoff.worktreePath}' diff --stat HEAD`,
      `git -C '${handoff.worktreePath}' diff HEAD`
    ]);
    expect(handoff.commands.map((command) => command.command).join("\n")).not.toMatch(
      /merge|push|cherry-pick|worktree remove|delete/i
    );

    await expect(review.openHandoffWorktree(run.id)).resolves.toMatchObject({
      ok: true
    });
    expect(openedPaths).toEqual([handoff.worktreePath]);

    await expect(
      review.copyHandoffValue(run.id, "worktree_path")
    ).resolves.toMatchObject({ ok: true });
    await expect(
      review.copyHandoffValue(run.id, "branch_name")
    ).resolves.toMatchObject({ ok: true });
    await expect(
      review.copyHandoffValue(run.id, "review_commands")
    ).resolves.toMatchObject({ ok: true });
    expect(copiedValues).toEqual([
      handoff.worktreePath,
      handoff.branchName,
      handoff.commands
        .map((command) => `${command.label}:\n${command.command}`)
        .join("\n\n")
    ]);
    await expect(fs.readdir(fixture.projectRoot)).resolves.toEqual(before);
  });

  it("keeps unsafe or unavailable handoff worktrees unavailable", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const openedPaths: string[] = [];
    const review = createReviewService(context, {
      memoryService: memory,
      handoffPlatform: {
        openPath: async (worktreePath) => {
          openedPaths.push(worktreePath);
          return "";
        },
        writeText: () => undefined
      }
    });
    const project = await projects.open(fixture.projectRoot);
    const now = context.now();
    const task = await fixture.repositories.taskRepository.create(
      validateTask({
        id: "task_handoff_unavailable",
        projectId: project.id,
        title: "Unavailable handoffs",
        status: "completed",
        createdAt: now,
        updatedAt: now
      })
    );
    const validPath = path.join(fixture.workspaceBasePath, "valid");
    const missingPath = path.join(fixture.workspaceBasePath, "missing");
    const mismatchedRunPath = path.join(fixture.workspaceBasePath, "mismatched-run");
    const mismatchedMetadataPath = path.join(
      fixture.workspaceBasePath,
      "mismatched-metadata"
    );
    const outsidePath = path.join(path.dirname(fixture.workspaceBasePath), "outside");
    await fs.mkdir(validPath);
    await fs.mkdir(mismatchedRunPath);
    await fs.mkdir(mismatchedMetadataPath);
    await fs.mkdir(outsidePath);

    await createRetainedRunFixture({
      context,
      fixture,
      taskId: task.id,
      runId: "run_handoff_missing",
      worktreePath: undefined,
      metadataPath: undefined,
      retained: true,
      cleaned: false
    });
    await createRetainedRunFixture({
      context,
      fixture,
      taskId: task.id,
      runId: "run_handoff_cleaned",
      worktreePath: validPath,
      metadataPath: validPath,
      retained: false,
      cleaned: true
    });
    await createRetainedRunFixture({
      context,
      fixture,
      taskId: task.id,
      runId: "run_handoff_nonexistent",
      worktreePath: missingPath,
      metadataPath: missingPath,
      retained: true,
      cleaned: false
    });
    await createRetainedRunFixture({
      context,
      fixture,
      taskId: task.id,
      runId: "run_handoff_mismatched",
      worktreePath: mismatchedRunPath,
      metadataPath: mismatchedMetadataPath,
      retained: true,
      cleaned: false
    });
    await createRetainedRunFixture({
      context,
      fixture,
      taskId: task.id,
      runId: "run_handoff_outside",
      worktreePath: outsidePath,
      metadataPath: outsidePath,
      retained: true,
      cleaned: false
    });

    await expect(review.getHandoff("run_handoff_missing")).resolves.toMatchObject({
      available: false,
      message: expect.stringContaining("absolute retained worktree")
    });
    await expect(review.getHandoff("run_handoff_cleaned")).resolves.toMatchObject({
      available: false,
      message: expect.stringContaining("cleaned up")
    });
    await expect(
      review.getHandoff("run_handoff_nonexistent")
    ).resolves.toMatchObject({
      available: false,
      message: expect.stringContaining("no longer exists")
    });
    await expect(
      review.getHandoff("run_handoff_mismatched")
    ).resolves.toMatchObject({
      available: false,
      message: expect.stringContaining("does not match")
    });
    await expect(review.getHandoff("run_handoff_outside")).resolves.toMatchObject({
      available: false,
      message: expect.stringContaining("outside the recorded Agent Hub workspace base")
    });

    await expect(
      review.openHandoffWorktree("run_handoff_outside")
    ).resolves.toMatchObject({ ok: false });
    await expect(
      review.copyHandoffValue("run_handoff_outside", "worktree_path")
    ).resolves.toMatchObject({ ok: false });
    expect(openedPaths).toEqual([]);
  });

  it("cancels a queued desktop run before TaskRunner execution starts", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const runs = createTestRunService(context, review, memory, fixture);
    const project = await projects.open(fixture.projectRoot);
    const now = context.now();
    const task = await fixture.repositories.taskRepository.create(
      validateTask({
        id: "task_queued_cancel",
        projectId: project.id,
        title: "Queued cancel",
        status: "open",
        createdAt: now,
        updatedAt: now
      })
    );
    const run = await fixture.repositories.taskRunRepository.create(
      validateTaskRun({
        id: "run_queued_cancel",
        taskId: task.id,
        agentKind: "fake",
        status: "queued",
        createdAt: now,
        updatedAt: now
      })
    );
    const liveEvents: RunEvent[] = [];
    const unsubscribe = runs.subscribe(run.id, (event) => liveEvents.push(event));

    await runs.cancelRun(run.id);
    const cancelled = await runs.getRun(run.id);
    unsubscribe();

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.events.at(-1)?.type).toBe("run_cancelled");
    expect(liveEvents.map((event) => event.type)).toContain("run_cancelled");
  });

  it("replays persisted run events exactly once to late subscribers", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const runs = createTestRunService(context, review, memory, fixture);
    const project = await projects.open(fixture.projectRoot);
    const run = await runs.createRun({
      projectId: project.id,
      prompt: "Replay this completed run.",
      agentId: "fake",
      contextMode: "auto"
    });
    await waitForRun(runs, run.id, "completed");
    const replayed: RunEvent[] = [];

    const unsubscribe = runs.subscribe(run.id, (event) => replayed.push(event));
    await waitForEvent(replayed, "run_completed");
    unsubscribe();

    expect(new Set(replayed.map((event) => event.id)).size).toBe(replayed.length);
    const refreshed = await runs.getRun(run.id);
    expect(replayed.map((event) => event.id)).toEqual(
      refreshed.events.map((event) => event.id)
    );
  });

  it("emits live progress before final TaskRunner persistence completes", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const runs = createTestRunService(context, review, memory, fixture, {
      agentRegistry: new DefaultAgentRegistry([
        new FakeAgentAdapter({ stepDelayMs: 100 })
      ])
    });
    const project = await projects.open(fixture.projectRoot);
    const run = await runs.createRun({
      projectId: project.id,
      prompt: "Stream progress before finalization.",
      agentId: "fake",
      contextMode: "auto"
    });
    const liveEvents: RunEvent[] = [];
    const unsubscribe = runs.subscribe(run.id, (event) => liveEvents.push(event));

    await waitForEvent(liveEvents, "run_started");
    const inProgress = await runs.getRun(run.id);
    unsubscribe();

    expect(inProgress.status).toBe("running");
    expect(inProgress.events.map((event) => event.type)).toContain("run_started");
    await waitForRun(runs, run.id, "completed");
  });

  it("cancels a running fake TaskRunner-backed desktop run", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const runs = createTestRunService(context, review, memory, fixture, {
      agentRegistry: new DefaultAgentRegistry([
        new FakeAgentAdapter({ stepDelayMs: 100 })
      ])
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
    await waitForRun(runs, run.id, "running");

    await runs.cancelRun(run.id);
    await waitForEvent(liveEvents, "run_cancelled");
    const cancelled = await waitForRun(runs, run.id, "cancelled");
    unsubscribe();

    expect(cancelled.events.map((event) => event.type)).toContain("run_cancelled");
    expect(cancelled.events.at(-1)?.type).toBe("run_cancelled");
  });

  it("cancels a process-backed desktop run with signaled evidence", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const processRunner = new DesktopAbortProcessRunner();
    const runs = createTestRunService(context, review, memory, fixture, {
      agentRegistry: new DefaultAgentRegistry([
        new CodexAdapter({ processRunner })
      ])
    });
    const project = await projects.open(fixture.projectRoot);
    const run = await runs.createRun({
      projectId: project.id,
      prompt: "Cancel process-backed run.",
      agentId: "codex",
      contextMode: "auto"
    });
    const liveEvents: RunEvent[] = [];
    const unsubscribe = runs.subscribe(run.id, (event) => liveEvents.push(event));
    await waitForEvent(liveEvents, "agent_output");

    await runs.cancelRun(run.id);
    const cancelled = await waitForRun(runs, run.id, "cancelled");
    unsubscribe();

    expect(processRunner.runCalls[0].signal?.aborted).toBe(true);
    expect(cancelled.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "run_cancelled",
          payload: expect.objectContaining({ status: "cancelled" })
        })
      ])
    );
    expect(cancelled.events.some((event) => event.payload.signal === "SIGTERM")).toBe(true);
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

  it("records unavailable real-agent desktop mentions through TaskRunner preflight", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const runs = createTestRunService(context, review, memory, fixture);
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
    expect(failed.summary).toContain("Codex preflight failed");
    await expect(review.getDiff(run.id)).resolves.toMatchObject({
      files: [],
      empty: true,
      message: "No real repository files were modified."
    });
  });

  it("generates desktop memory proposals idempotently across repeated review loads", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const runs = createTestRunService(context, review, memory, fixture);
    const project = await projects.open(fixture.projectRoot);
    const run = await runs.createRun({
      projectId: project.id,
      prompt: "Verify desktop memory proposal generation.",
      agentId: "fake",
      contextMode: "auto"
    });
    await waitForRun(runs, run.id, "completed");

    const [firstList, firstSummary, runDetail, secondSummary] = await Promise.all([
      memory.listProposals(run.id),
      review.getSummary(run.id),
      runs.getRun(run.id),
      review.getSummary(run.id)
    ]);
    const secondList = await memory.listProposals(run.id);
    const storedItems = await fixture.repositories.memoryItemRepository.listByProjectId(
      project.id
    );
    const storedRunItems = storedItems.filter((item) => item.taskId === run.taskId);

    expect(firstList.length).toBeGreaterThan(0);
    expect(secondList).toHaveLength(firstList.length);
    expect(runDetail.memoryProposals).toHaveLength(firstList.length);
    expect(firstSummary.memoryProposalCount).toBe(firstList.length);
    expect(secondSummary.memoryProposalCount).toBe(firstList.length);
    expect(storedRunItems).toHaveLength(firstList.length);
    expect(new Set(storedRunItems.map((item) => item.content)).size).toBe(
      firstList.length
    );
  });

  it("thread sendMessage creates one user message and one run card per agent", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const runs = createTestRunService(context, review, memory, fixture);
    const threads = createThreadService({ context, projects, runs });
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
    expect(refreshed.messages.map((message) => message.type)).toEqual([
      "user",
      "agent_run",
      "assistant",
      "agent_run",
      "assistant"
    ]);
    expect(
      refreshed.messages
        .filter((message) => message.type === "agent_run")
        .map((message) => message.status)
    ).toEqual(["completed", "failed"]);
    const assistantMessages = refreshed.messages.filter(
      (message) => message.type === "assistant"
    );
    expect(
      assistantMessages.map((message) => ({
        agentId: message.agentId,
        status: message.status
      }))
    ).toEqual([
      {
        agentId: "fake",
        status: "completed"
      },
      {
        agentId: "codex",
        status: "failed"
      }
    ]);
    expect(assistantMessages[0]?.text).toBe("fake agent completed");
    expect(assistantMessages[1]?.text).toContain(
      "Codex preflight failed: Codex CLI unavailable: desktop test unavailable"
    );
    expect(
      refreshed.messages
        .filter((message) => message.type === "assistant")
        .map((message) => message.text)
        .join("\n")
    ).not.toContain("Found package.json");
    await expect(threads.listThreads()).resolves.toMatchObject([
      {
        id: detail.id,
        activeRunCount: 0,
        runCount: 2
      }
    ]);
  });

  it("persists desktop thread messages across service recreation", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const runs = createTestRunService(context, review, memory, fixture);
    const threads = createThreadService({ context, projects, runs });
    const project = await projects.open(fixture.projectRoot);

    const first = await threads.sendMessage({
      projectId: project.id,
      text: "@fake first durable prompt",
      contextMode: "auto"
    });
    const second = await threads.sendMessage({
      threadId: first.id,
      text: "@fake second durable prompt",
      contextMode: "workspace"
    });
    const runIds = second.messages
      .filter((message) => message.type === "agent_run")
      .map((message) => message.runId);

    for (const runId of runIds) {
      await waitForRun(runs, runId, "completed");
    }

    const restartedRepositories = createSqliteRepositories({
      databasePath: fixture.databasePath
    });
    const restartedContext =
      createDesktopServiceContext(restartedRepositories);
    const restartedProjects = createProjectService(restartedContext);
    const restartedMemory = createMemoryService(restartedContext);
    const restartedReview = createReviewService(restartedContext, {
      memoryService: restartedMemory
    });
    const restartedRuns = createTestRunService(
      restartedContext,
      restartedReview,
      restartedMemory,
      fixture
    );
    const restartedThreads = createThreadService({
      context: restartedContext,
      projects: restartedProjects,
      runs: restartedRuns
    });

    const restored = await restartedThreads.getThread(first.id);
    expect(restored.messages.map((message) => message.type)).toEqual([
      "user",
      "agent_run",
      "assistant",
      "user",
      "agent_run",
      "assistant"
    ]);
    expect(
      restored.messages
        .filter((message) => message.type === "user")
        .map((message) => message.text)
    ).toEqual(["first durable prompt", "second durable prompt"]);
    expect(
      restored.messages
        .filter((message) => message.type === "agent_run")
        .map((message) => message.status)
    ).toEqual(["completed", "completed"]);
    expect(
      restored.messages
        .filter((message) => message.type === "assistant")
        .map((message) => message.text)
    ).toEqual([
      "fake agent completed",
      "fake agent completed"
    ]);
    await expect(restartedThreads.listThreads()).resolves.toMatchObject([
      {
        id: first.id,
        runCount: 2,
        activeRunCount: 0
      }
    ]);
  });

  it("lists thread summaries without full run-detail hydration", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const runs = createTestRunService(context, review, memory, fixture);
    const threads = createThreadService({ context, projects, runs });
    const project = await projects.open(fixture.projectRoot);

    const detail = await threads.sendMessage({
      projectId: project.id,
      text: "@fake hydrate lazily",
      contextMode: "auto"
    });
    const run = detail.messages.find((message) => message.type === "agent_run");
    if (!run) {
      throw new Error("expected run card");
    }
    await waitForRun(runs, run.runId, "completed");
    await threads.getThread(detail.id);

    const getRunSpy = vi.spyOn(runs, "getRun");
    const snapshotSpy = vi.spyOn(runs, "getConversationRunSnapshot");
    const statusSpy = vi.spyOn(runs, "listRunStatuses");

    await expect(threads.listThreads()).resolves.toMatchObject([
      {
        id: detail.id,
        runCount: 1,
        activeRunCount: 0
      }
    ]);
    expect(statusSpy).toHaveBeenCalledTimes(1);
    expect(getRunSpy).not.toHaveBeenCalled();
    expect(snapshotSpy).not.toHaveBeenCalled();
  });

  it("does not refinalize stable assistant messages when opening a thread", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const runs = createTestRunService(context, review, memory, fixture);
    const threads = createThreadService({ context, projects, runs });
    const project = await projects.open(fixture.projectRoot);

    const detail = await threads.sendMessage({
      projectId: project.id,
      text: "@fake stable assistant output",
      contextMode: "auto"
    });
    const run = detail.messages.find((message) => message.type === "agent_run");
    if (!run) {
      throw new Error("expected run card");
    }
    await waitForRun(runs, run.runId, "completed");
    const finalized = await threads.getThread(detail.id);
    expect(finalized.messages.some((message) => message.type === "assistant")).toBe(true);

    const snapshotSpy = vi.spyOn(runs, "getConversationRunSnapshot");
    const updateSpy = vi.spyOn(
      fixture.repositories.conversationMessageRepository,
      "update"
    );

    await expect(threads.getThread(detail.id)).resolves.toMatchObject({
      id: detail.id
    });
    expect(snapshotSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("finalizes pending assistant placeholders through lightweight run snapshots", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const runs = createTestRunService(context, review, memory, fixture);
    const threads = createThreadService({ context, projects, runs });
    const project = await projects.open(fixture.projectRoot);

    const detail = await threads.sendMessage({
      projectId: project.id,
      text: "@fake pending assistant output",
      contextMode: "auto"
    });
    const run = detail.messages.find((message) => message.type === "agent_run");
    if (!run) {
      throw new Error("expected run card");
    }
    const pendingMessages =
      await fixture.repositories.conversationMessageRepository.listByThreadId(
        detail.id
      );
    expect(
      pendingMessages.some((message) => message.metadata?.pending === true)
    ).toBe(true);

    await waitForRun(runs, run.runId, "completed");
    const snapshotSpy = vi.spyOn(runs, "getConversationRunSnapshot");
    const refreshed = await threads.getThread(detail.id);

    expect(snapshotSpy).toHaveBeenCalledWith(run.runId);
    expect(
      refreshed.messages
        .filter((message) => message.type === "assistant")
        .map((message) => message.text)
    ).toEqual(["fake agent completed"]);
  });

  it("keeps thread run counts current from lightweight statuses", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const runs = createTestRunService(context, review, memory, fixture);
    const threads = createThreadService({ context, projects, runs });
    const project = await projects.open(fixture.projectRoot);

    const detail = await threads.sendMessage({
      projectId: project.id,
      text: "@fake status counts",
      contextMode: "auto"
    });
    const run = detail.messages.find((message) => message.type === "agent_run");
    if (!run) {
      throw new Error("expected run card");
    }

    const initialSummaries = await threads.listThreads();
    expect(initialSummaries).toMatchObject([
      {
        id: detail.id,
        runCount: 1
      }
    ]);
    expect([0, 1]).toContain(initialSummaries[0]?.activeRunCount);
    await waitForRun(runs, run.runId, "completed");
    await expect(threads.listThreads()).resolves.toMatchObject([
      {
        id: detail.id,
        runCount: 1,
        activeRunCount: 0
      }
    ]);
  });

  it("persists bounded conversation brief artifacts for follow-up desktop turns", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const runs = createTestRunService(context, review, memory, fixture);
    const threads = createThreadService({ context, projects, runs });
    const project = await projects.open(fixture.projectRoot);

    const first = await threads.sendMessage({
      projectId: project.id,
      text: "@fake first thread-aware prompt",
      contextMode: "auto"
    });
    const firstRun = first.messages.find(
      (message) => message.type === "agent_run"
    );
    if (!firstRun) {
      throw new Error("expected first run card");
    }
    await waitForRun(runs, firstRun.runId, "completed");
    await fixture.repositories.runArtifactRepository.create(
      validateRunArtifact({
        id: "artifact_sensitive_prior_diff",
        taskRunId: firstRun.runId,
        kind: "git_diff",
        content: [
          "diff --git a/.env.local b/.env.local",
          "+API_TOKEN=secret-value",
          ""
        ].join("\n"),
        metadata: {
          changedFiles: [{ path: ".env.local", status: "modified" }],
          fileSummaries: [".env.local: modified +1/-0"]
        },
        createdAt: context.now()
      })
    );

    const second = await threads.sendMessage({
      threadId: first.id,
      text: "@fake second thread-aware prompt",
      contextMode: "workspace"
    });
    const secondRun = second.messages
      .filter((message) => message.type === "agent_run")
      .at(-1);
    if (!secondRun) {
      throw new Error("expected second run card");
    }
    await waitForRun(runs, secondRun.runId, "completed");

    const artifact =
      await fixture.repositories.runArtifactRepository.getLatestByRunIdAndKind(
        secondRun.runId,
        "conversation_brief"
      );
    expect(artifact).toMatchObject({
      kind: "conversation_brief",
      metadata: expect.objectContaining({
        source: "conversation_context_builder",
        includedMessageCount: 2
      })
    });
    expect(artifact?.content).toContain("second thread-aware prompt");
    expect(artifact?.content).toContain("first thread-aware prompt");
    expect(artifact?.content).toContain("## Thread Summary");
    expect(artifact?.content).toContain("Last known user goal: first thread-aware prompt");
    expect(artifact?.content).toContain("Assistant @fake");
    expect(artifact?.content).toContain("fake agent completed");
    expect(artifact?.content).not.toContain("Found package.json");
    expect(artifact?.content).not.toContain("pnpm test -- simulated");
    expect(artifact?.content).not.toContain("API_TOKEN=secret-value");
    expect(artifact?.content).not.toContain("diff --git");
    expect(artifact?.content).not.toContain("Sensitive path changed");
    const summary =
      await fixture.repositories.conversationThreadSummaryRepository.getByThreadId(first.id);
    expect(summary).toMatchObject({
      lastKnownUserGoal: "second thread-aware prompt"
    });
    expect(summary?.sourceMessageCount).toBeGreaterThanOrEqual(3);
  });

  it("uses the retitled thread in first-turn conversation briefs", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const runs = createTestRunService(context, review, memory, fixture);
    const threads = createThreadService({ context, projects, runs });
    const project = await projects.open(fixture.projectRoot);
    const thread = await threads.createThread({ projectId: project.id });

    const detail = await threads.sendMessage({
      threadId: thread.id,
      text: "@fake rename this empty chat",
      contextMode: "auto"
    });
    const run = detail.messages.find((message) => message.type === "agent_run");
    if (!run) {
      throw new Error("expected run card");
    }
    await waitForRun(runs, run.runId, "completed");
    const artifact =
      await fixture.repositories.runArtifactRepository.getLatestByRunIdAndKind(
        run.runId,
        "conversation_brief"
      );

    expect(detail.title).toBe("rename this empty chat");
    expect(artifact?.content).toContain("thread_title: rename this empty chat");
    expect(artifact?.content).not.toContain("thread_title: New Chat");
  });

  it("passes explicit desktop continuation provenance through thread run creation", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const runs = createTestRunService(context, review, memory, fixture);
    const threads = createThreadService({ context, projects, runs });
    const project = await projects.open(fixture.projectRoot);
    const parentWorktree = path.join(path.dirname(fixture.databasePath), "parent");
    const parentBranch = "agent-hub/task_parent/fake-parent";
    await execFileAsync(
      "git",
      ["worktree", "add", "-b", parentBranch, parentWorktree],
      { cwd: fixture.projectRoot }
    );
    await fixture.repositories.taskRepository.create(
      validateTask({
        id: "task_parent",
        projectId: project.id,
        title: "Parent",
        status: "completed",
        createdAt: context.now(),
        updatedAt: context.now()
      })
    );
    await fixture.repositories.taskRunRepository.create(
      validateTaskRun({
        id: "run_parent",
        taskId: "task_parent",
        agentKind: "fake",
        status: "succeeded",
        worktreePath: parentWorktree,
        branchName: parentBranch,
        createdAt: context.now(),
        updatedAt: context.now()
      })
    );
    await fixture.repositories.runMetadataRepository.save({
      runId: "run_parent",
      workspace: {
        path: parentWorktree,
        branchName: parentBranch,
        sourceRepositoryPath: fixture.projectRoot,
        workspaceBasePath: fixture.workspaceBasePath,
        taskId: "task_parent",
        runId: "run_parent",
        agentKind: "fake",
        dryRun: false,
        sourceRepositoryDirty: false,
        cleanupPolicy: "never"
      },
      workspaceCleanup: {
        cleaned: false,
        retained: true,
        reason: "test retained parent",
        commands: []
      }
    });
    const thread = await threads.createThread({ projectId: project.id });
    await fixture.repositories.conversationMessageRepository.create(
      validateConversationMessage({
        id: "message_parent",
        threadId: thread.id,
        sequence: 0,
        role: "tool",
        kind: "run_card",
        content: "Parent run",
        agentKind: "fake",
        runId: "run_parent",
        status: "succeeded",
        createdAt: context.now()
      })
    );

    const detail = await threads.sendMessage({
      threadId: thread.id,
      text: "@fake continue desktop state",
      contextMode: "auto",
      continueFromRunId: "run_parent",
      continueFromMessageId: "message_parent"
    });
    const run = detail.messages.find(
      (message) => message.type === "agent_run" && message.runId !== "run_parent"
    );
    if (!run || run.type !== "agent_run") {
      throw new Error("expected run card");
    }
    await waitForRun(runs, run.runId, "completed");
    const persisted = await fixture.repositories.taskRunRepository.get(run.runId);
    expect(persisted).toMatchObject({
      parentRunId: "run_parent",
      parentMessageId: "message_parent"
    });
    await expect(review.getSummary(run.runId)).resolves.toMatchObject({
      parentRunId: "run_parent",
      parentMessageId: "message_parent"
    });
    await expect(
      fixture.repositories.runArtifactRepository.getLatestByRunIdAndKind(
        run.runId,
        "code_state_provenance"
      )
    ).resolves.toMatchObject({
      metadata: expect.objectContaining({
        parentRunId: "run_parent",
        parentMessageId: "message_parent",
        mode: "continue_from_run"
      })
    });
  });

  it("rejects desktop continuation when the parent run has no retained worktree", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const runs = createTestRunService(context, review, memory, fixture);
    const threads = createThreadService({ context, projects, runs });
    const project = await projects.open(fixture.projectRoot);
    const now = context.now();
    await fixture.repositories.taskRepository.create(
      validateTask({
        id: "task_parent_no_worktree",
        projectId: project.id,
        title: "Parent without worktree",
        status: "completed",
        createdAt: now,
        updatedAt: now
      })
    );
    await fixture.repositories.taskRunRepository.create(
      validateTaskRun({
        id: "run_parent_no_worktree",
        taskId: "task_parent_no_worktree",
        agentKind: "fake",
        status: "succeeded",
        createdAt: now,
        updatedAt: now
      })
    );

    const second = await threads.sendMessage({
      projectId: project.id,
      text: "@fake should not continue",
      contextMode: "auto",
      continueFromRunId: "run_parent_no_worktree"
    });

    expect(second.messages.at(-1)).toMatchObject({
      type: "system",
      text: expect.stringContaining("does not have a retained worktree")
    });
  });

  it("validates IPC run creation and rejects repo_export delivery", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const settings = createSettingsService(context);
    const runs = createTestRunService(context, review, memory, fixture);
    const threads = createThreadService({ context, projects, runs });
    const handlers = createIpcHandlers({
      projects,
      runs,
      threads,
      review,
      memory,
      settings
    });
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
    const runId = (summary as { id: string }).id;
    await waitForRun(runs, runId, "completed");
    await handlers[IPC_CHANNELS.runsSubscribe]({ sender } as never, runId);
    await waitForIpcSend(sender);
    await expect(
      handlers[IPC_CHANNELS.reviewSummary](
        { sender } as never,
        runId
      )
    ).resolves.toMatchObject({
      reviewStatus: "pending",
      changedFileCount: 1
    });
    await expect(
      handlers[IPC_CHANNELS.reviewHandoff](
        { sender } as never,
        runId
      )
    ).resolves.toMatchObject({
      available: true,
      changedFiles: [expect.objectContaining({ path: "fake-agent-output.md" })]
    });
    await expect(
      handlers[IPC_CHANNELS.reviewHandoffOpenWorktree](
        { sender } as never,
        runId
      )
    ).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("unavailable in this environment")
    });
    await expect(
      handlers[IPC_CHANNELS.reviewHandoffCopyValue]({ sender } as never, {
        runId,
        kind: "dangerous_text"
      })
    ).rejects.toThrow(/handoff copy kind/);
    await expect(
      handlers[IPC_CHANNELS.reviewReject]({ sender } as never, {
        runId,
        reason: "x".repeat(1_001)
      })
    ).rejects.toThrow(/1000/);
    await expect(
      handlers[IPC_CHANNELS.reviewAccept](
        { sender } as never,
        runId
      )
    ).resolves.toMatchObject({
      reviewStatus: "accepted"
    });
    expect(sender.send).toHaveBeenCalledWith(
      runEventChannel(runId),
      expect.objectContaining({ type: "agent_output" })
    );
    await handlers[IPC_CHANNELS.runsUnsubscribe]({ sender } as never, runId);
  });
});

async function waitForRun(
  runs: ReturnType<typeof createRunService>,
  runId: string,
  status: RunDetail["status"]
): Promise<RunDetail> {
  const deadline = Date.now() + 10_000;
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

async function waitForPersistedRunEvent(
  runs: ReturnType<typeof createRunService>,
  runId: string,
  type: RunEvent["type"]
): Promise<RunDetail> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const detail = await runs.getRun(runId);
    if (detail.events.some((event) => event.type === type)) {
      return detail;
    }
    await sleep(10);
  }
  throw new Error(`timed out waiting for persisted ${type}`);
}

async function waitForIpcSend(sender: {
  send: { mock: { calls: unknown[][] } };
}): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (sender.send.mock.calls.length > 0) {
      return;
    }
    await sleep(10);
  }
  throw new Error("timed out waiting for IPC run event");
}

function countOccurrences(content: string, needle: string): number {
  return content.split(needle).length - 1;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createFixture(): Promise<{
  projectRoot: string;
  workspaceBasePath: string;
  agentHubHome: string;
  databasePath: string;
  repositories: ReturnType<typeof createSqliteRepositories>;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-hub-desktop-"));
  const projectRoot = path.join(root, "repo");
  const workspaceBasePath = path.join(root, "worktrees");
  const agentHubHome = path.join(root, "agent-home");
  const databasePath = path.join(root, "agent-hub.sqlite");
  await fs.mkdir(projectRoot);
  await fs.mkdir(workspaceBasePath);
  await fs.writeFile(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ packageManager: "pnpm@10.10.0" }, null, 2),
    "utf8"
  );
  await initGitRepository(projectRoot);
  const repositories = createSqliteRepositories({
    databasePath
  });
  return { projectRoot, workspaceBasePath, agentHubHome, databasePath, repositories };
}

async function createRetainedRunFixture(input: {
  context: ReturnType<typeof createDesktopServiceContext>;
  fixture: {
    projectRoot: string;
    workspaceBasePath: string;
    repositories: ReturnType<typeof createSqliteRepositories>;
  };
  taskId: string;
  runId: string;
  worktreePath?: string;
  metadataPath?: string;
  retained: boolean;
  cleaned: boolean;
}): Promise<void> {
  const branchName = `agent-hub/${input.runId}/fake`;
  await input.fixture.repositories.taskRunRepository.create(
    validateTaskRun({
      id: input.runId,
      taskId: input.taskId,
      agentKind: "fake",
      status: "succeeded",
      worktreePath: input.worktreePath,
      branchName,
      createdAt: input.context.now(),
      updatedAt: input.context.now()
    })
  );
  await input.fixture.repositories.runMetadataRepository.save({
    runId: input.runId,
    workspace: input.metadataPath
      ? {
          path: input.metadataPath,
          branchName,
          sourceRepositoryPath: input.fixture.projectRoot,
          workspaceBasePath: input.fixture.workspaceBasePath,
          taskId: input.taskId,
          runId: input.runId,
          agentKind: "fake",
          dryRun: false,
          sourceRepositoryDirty: false,
          cleanupPolicy: "never"
        }
      : undefined,
    workspaceCleanup: {
      cleaned: input.cleaned,
      retained: input.retained,
      reason: input.cleaned ? "test cleanup" : "test retained",
      commands: []
    }
  });
}

function createTestRunService(
  context: ReturnType<typeof createDesktopServiceContext>,
  review: ReturnType<typeof createReviewService>,
  memory: ReturnType<typeof createMemoryService>,
  fixture: { workspaceBasePath: string },
  taskRunnerDependencies: TaskRunnerDependencies = {}
): ReturnType<typeof createRunService> {
  const settings = createSettingsService(context);
  return createRunService(context, {
    reviewService: review,
    memoryService: memory,
    settingsService: settings,
    workspaceBasePath: fixture.workspaceBasePath,
    taskRunnerDependencies: {
      processRunner: new MockProcessRunner(
        [],
        Array.from({ length: 100 }, () => ({
          available: false,
          reason: "desktop test unavailable"
        }))
      ),
      ...taskRunnerDependencies
    }
  });
}

class DesktopAbortProcessRunner implements ProcessRunner {
  readonly runCalls: ProcessRunInput[] = [];
  readonly detectCalls: ProcessDetectionInput[] = [];

  async *run(input: ProcessRunInput): AsyncIterable<ProcessRunEvent> {
    this.runCalls.push(input);
    yield { type: "stdout", data: "started\n" };
    await new Promise<void>((resolve) => {
      if (input.signal?.aborted) {
        resolve();
        return;
      }
      input.signal?.addEventListener("abort", () => resolve(), { once: true });
    });
    yield { type: "exit", exitCode: null, signal: "SIGTERM" };
  }

  async detect(input: ProcessDetectionInput): Promise<ProcessDetectionResult> {
    this.detectCalls.push(input);
    return { available: true, version: "mock" };
  }
}

async function initGitRepository(projectRoot: string): Promise<void> {
  await execFileAsync("git", ["init"], { cwd: projectRoot });
  await execFileAsync("git", ["add", "package.json"], { cwd: projectRoot });
  await execFileAsync(
    "git",
    [
      "-c",
      "user.name=Agent Hub Test",
      "-c",
      "user.email=agent-hub@example.com",
      "commit",
      "-m",
      "Initial commit"
    ],
    { cwd: projectRoot }
  );
}
