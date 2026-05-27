import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import {
  validateConversationMessage,
  validateConversationThreadSummary,
  validateConversationThread,
  validateMemoryItem,
  validateRunArtifact,
  validateRiskReport,
  validateTask,
  validateTaskRun,
  validateVerificationResult
} from "@agent-hub/core";
import { createSqliteRepositories } from "@agent-hub/db";
import {
  createDesktopServiceContext,
  createProjectService
} from "../apps/desktop/electron/services/project-service";
import { createReviewService } from "../apps/desktop/electron/services/review-service";
import { createLifecycleService } from "../apps/desktop/electron/services/lifecycle-service";
import { createMemoryService } from "../apps/desktop/electron/services/memory-service";
import { createKnowledgeService } from "../apps/desktop/electron/services/knowledge-service";
import { createTeamService } from "../apps/desktop/electron/services/team-service";
import { createRunService } from "../apps/desktop/electron/services/run-service";
import { createThreadService } from "../apps/desktop/electron/services/thread-service";
import { createSettingsService } from "../apps/desktop/electron/services/settings-service";
import { createComparisonService } from "../apps/desktop/electron/services/comparison-service";
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
  createDesktopServices,
  createIpcHandlers,
  IPC_CHANNELS,
  runEventChannel
} from "../apps/desktop/electron/ipc-handlers";
import type {
  AgentRunMessage,
  RunDetail,
  RunEvent
} from "../apps/desktop/src/lib/types";
import { MockProcessRunner, MockShellExecutor } from "./helpers";
import {
  VerificationRunner,
  type TaskRunnerDependencies
} from "@agent-hub/task-runner";
import { buildContextArtifacts } from "@agent-hub/context-compiler";
import {
  presetWorkgroupRoles,
  toWorkgroupRoleRunMetadata,
  type WorkgroupRole
} from "@agent-hub/shared";

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
    await expectNoRepositoryContextWrites(fixture.projectRoot);
    await expect(fs.readdir(fixture.projectRoot)).resolves.toEqual(before);
    await expect(review.getLogs(run.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ runId: run.id, level: "stdout" })
      ])
    );
  });

  it("keeps renderer source behind preload instead of privileged APIs", async () => {
    const rendererRoot = path.join(process.cwd(), "apps", "desktop", "src");
    const files = await collectSourceFiles(rendererRoot);
    const forbidden = forbiddenRendererApiPattern();
    const offenders: string[] = [];
    for (const file of files) {
      const content = await fs.readFile(file, "utf8");
      if (forbidden.test(content)) {
        offenders.push(path.relative(process.cwd(), file));
      }
    }

    expect(offenders).toEqual([]);
  });

  it("stores per-project verification settings through service and IPC validation", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const settings = createSettingsService(context);
    const comparison = createComparisonService(context);
    const knowledge = createKnowledgeService(context);
    const team = createTeamService(context);
    const runs = createTestRunService(context, review, memory, fixture);
    const threads = createThreadService({ context, projects, runs, team });
    const lifecycle = createLifecycleService(context, { reviewService: review });
    const handlers = createIpcHandlers({
      projects,
      runs,
      threads,
      review,
      lifecycle,
      comparison,
      memory,
      knowledge,
      team,
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

  it("keeps fake agent out of normal desktop runtime config", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousDebug = process.env.AGENT_HUB_DEBUG;
    const previousFake = process.env.AGENT_HUB_AGENT_FAKE_ENABLED;
    process.env.NODE_ENV = "production";
    delete process.env.AGENT_HUB_DEBUG;
    delete process.env.AGENT_HUB_AGENT_FAKE_ENABLED;
    try {
      const fixture = await createFixture();
      const context = createDesktopServiceContext(fixture.repositories);
      const services = createDesktopServices(context);
      const handlers = createIpcHandlers(services);
      const sender = { send: vi.fn() };
      const project = await services.projects.open(fixture.projectRoot);

      await expect(
        handlers[IPC_CHANNELS.appRuntimeConfig]({ sender } as never)
      ).resolves.toMatchObject({
        agents: {
          availableAgents: ["codex", "claude"],
          defaultAgent: "codex",
          fakeAgentEnabled: false
        }
      });
      await expect(
        handlers[IPC_CHANNELS.runsCreate]({ sender } as never, {
          projectId: project.id,
          prompt: "should not use fake",
          agentId: "fake",
          contextMode: "auto"
        })
      ).rejects.toThrow("fake agent is disabled");
    } finally {
      restoreEnv("NODE_ENV", previousNodeEnv);
      restoreEnv("AGENT_HUB_DEBUG", previousDebug);
      restoreEnv("AGENT_HUB_AGENT_FAKE_ENABLED", previousFake);
    }
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

  it("exposes persisted conversation brief context for the inspector", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const review = createReviewService(context);
    const project = await projects.open(fixture.projectRoot);
    const now = context.now();
    const task = await fixture.repositories.taskRepository.create(
      validateTask({
        id: "task_context_preview",
        projectId: project.id,
        title: "Inspect conversation context",
        status: "completed",
        createdAt: now,
        updatedAt: now
      })
    );
    const run = await fixture.repositories.taskRunRepository.create(
      validateTaskRun({
        id: "run_context_preview",
        taskId: task.id,
        agentKind: "codex",
        status: "succeeded",
        createdAt: now,
        updatedAt: now,
        startedAt: now,
        completedAt: now
      })
    );

    await expect(review.getContext(run.id)).resolves.toMatchObject({
      runId: run.id,
      available: false,
      message: expect.stringContaining("No persisted conversation brief")
    });

    await fixture.repositories.runArtifactRepository.create(
      validateRunArtifact({
        id: "artifact_context_preview",
        taskRunId: run.id,
        kind: "conversation_brief",
        content: "## Thread Summary\nLast known user goal: inspect context.",
        metadata: {
          threadId: "thread_context_preview"
        },
        createdAt: now
      })
    );

    await expect(review.getContext(run.id)).resolves.toMatchObject({
      runId: run.id,
      available: true,
      artifactId: "artifact_context_preview",
      content: expect.stringContaining("Last known user goal"),
      message: "Conversation brief captured for runtime injection."
    });
  });

  it("maps run artifacts into bounded inspector artifact metadata", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const review = createReviewService(context);
    const project = await projects.open(fixture.projectRoot);
    const now = context.now();
    const task = await fixture.repositories.taskRepository.create(
      validateTask({
        id: "task_artifact_metadata",
        projectId: project.id,
        title: "Inspect artifact metadata",
        status: "completed",
        createdAt: now,
        updatedAt: now
      })
    );
    const run = await fixture.repositories.taskRunRepository.create(
      validateTaskRun({
        id: "run_artifact_metadata",
        taskId: task.id,
        agentKind: "codex",
        status: "succeeded",
        createdAt: now,
        updatedAt: now,
        startedAt: now,
        completedAt: now
      })
    );
    await fixture.repositories.runMetadataRepository.save({
      runId: run.id,
      role: toWorkgroupRoleRunMetadata(
        presetWorkgroupRoles.find((role) => role.handle === "engineer") ??
          presetWorkgroupRoles[0]
      )
    });
    await fixture.repositories.runArtifactRepository.create(
      validateRunArtifact({
        id: "artifact_context_metadata",
        taskRunId: run.id,
        kind: "conversation_brief",
        content: [
          "# Agent Hub Conversation Brief",
          "thread_id: thread_artifacts",
          "User: inspect artifact metadata",
          "x".repeat(4_200)
        ].join("\n"),
        metadata: {
          summary: "Bounded runtime context snapshot."
        },
        createdAt: now
      })
    );
    await fixture.repositories.runArtifactRepository.create(
      validateRunArtifact({
        id: "artifact_diff_metadata",
        taskRunId: run.id,
        kind: "git_diff",
        content: "diff --git a/a b/a\n+hello\n",
        metadata: {
          changedFiles: [{ path: "a", status: "modified" }],
          stat: "1 file changed, 1 insertion"
        },
        createdAt: now
      })
    );

    await expect(review.getArtifacts(run.id)).resolves.toEqual([
      expect.objectContaining({
        id: "artifact_context_metadata",
        kind: "conversation_brief",
        artifactType: "context",
        title: "Conversation brief for Inspect artifact metadata",
        sourceRunId: run.id,
        sourceTaskId: task.id,
        threadId: "thread_artifacts",
        createdBy: "@engineer",
        summary: "Bounded runtime context snapshot.",
        availability: "bounded",
        truncated: true,
        contentPreview: expect.stringContaining("Artifact preview truncated")
      }),
      expect.objectContaining({
        id: "artifact_diff_metadata",
        kind: "git_diff",
        artifactType: "diff",
        summary: "1 changed file(s). 1 file changed, 1 insertion",
        availability: "local",
        truncated: false
      })
    ]);
  });

  it("redacts sensitive git diff artifact previews", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const review = createReviewService(context);
    const project = await projects.open(fixture.projectRoot);
    const now = context.now();
    const task = await fixture.repositories.taskRepository.create(
      validateTask({
        id: "task_sensitive_artifact_preview",
        projectId: project.id,
        title: "Inspect sensitive artifact preview",
        status: "completed",
        createdAt: now,
        updatedAt: now
      })
    );
    const run = await fixture.repositories.taskRunRepository.create(
      validateTaskRun({
        id: "run_sensitive_artifact_preview",
        taskId: task.id,
        agentKind: "codex",
        status: "succeeded",
        createdAt: now,
        updatedAt: now
      })
    );
    await fixture.repositories.runArtifactRepository.create(
      validateRunArtifact({
        id: "artifact_sensitive_artifact_preview",
        taskRunId: run.id,
        kind: "git_diff",
        content: [
          "diff --git a/.env.local b/.env.local",
          "--- a/.env.local",
          "+++ b/.env.local",
          "@@ -1 +1 @@",
          "-TOKEN=old",
          "+TOKEN=secret-value"
        ].join("\n"),
        metadata: {
          changedFiles: [{ path: ".env.local", status: "modified" }]
        },
        createdAt: now
      })
    );

    const artifacts = await review.getArtifacts(run.id);

    expect(artifacts[0]).toMatchObject({
      kind: "git_diff",
      contentPreview: "Patch redacted because sensitive file path changed: .env.local",
      truncated: false
    });
    expect(artifacts[0]?.contentPreview).not.toContain("secret-value");
  });

  it("lists knowledge workspace memory, thread summaries, and review decisions", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const knowledge = createKnowledgeService(context);
    const project = await projects.open(fixture.projectRoot);
    const now = context.now();
    const task = await fixture.repositories.taskRepository.create(
      validateTask({
        id: "task_knowledge_review",
        projectId: project.id,
        title: "Record review decision",
        status: "completed",
        createdAt: now,
        updatedAt: now
      })
    );
    const run = await fixture.repositories.taskRunRepository.create(
      validateTaskRun({
        id: "run_knowledge_review",
        taskId: task.id,
        agentKind: "fake",
        status: "succeeded",
        startedAt: now,
        completedAt: now,
        createdAt: now,
        updatedAt: now
      })
    );
    await fixture.repositories.memoryItemRepository.create(
      validateMemoryItem({
        id: "memory_knowledge_proposed",
        projectId: project.id,
        taskId: "task_knowledge_review",
        category: "workflow_rule",
        status: "proposed",
        content: "Keep proposed memory out of future context briefs.",
        createdAt: now,
        updatedAt: now
      })
    );
    await fixture.repositories.memoryItemRepository.create(
      validateMemoryItem({
        id: "memory_knowledge_approved",
        projectId: project.id,
        category: "project_fact",
        status: "approved",
        content: "Approved project memory remains explicitly governed.",
        createdAt: now,
        updatedAt: now
      })
    );
    await fixture.repositories.memoryItemRepository.create(
      validateMemoryItem({
        id: "memory_knowledge_rejected",
        projectId: project.id,
        category: "temporary_note",
        status: "rejected",
        content: "Rejected memory remains visible but inactive.",
        createdAt: now,
        updatedAt: now
      })
    );
    const thread = await fixture.repositories.conversationThreadRepository.create(
      validateConversationThread({
        id: "thread_knowledge_review",
        projectId: project.id,
        title: "review",
        metadata: {
          roomHandle: "review"
        },
        createdAt: now,
        updatedAt: now
      })
    );
    const sourceMessage =
      await fixture.repositories.conversationMessageRepository.create(
        validateConversationMessage({
          id: "message_knowledge_review",
          threadId: thread.id,
          sequence: 0,
          role: "assistant",
          kind: "text",
          content: "Review summary source",
          metadata: {},
          createdAt: now
        })
      );
    await fixture.repositories.conversationThreadSummaryRepository.upsert(
      validateConversationThreadSummary({
        id: "summary_knowledge_review",
        threadId: thread.id,
        summary: "Review room summary stays thread-local.",
        decisions: ["Keep review decisions source linked."],
        openItems: ["Audit memory approval path."],
        constraints: ["Do not auto-approve memory."],
        lastKnownUserGoal: "Govern knowledge records",
        sourceMessageCount: 1,
        sourceLatestMessageId: sourceMessage.id,
        metadata: {},
        createdAt: now,
        updatedAt: now
      })
    );
    await fixture.repositories.runArtifactRepository.create(
      validateRunArtifact({
        id: "artifact_knowledge_review_decision",
        taskRunId: run.id,
        kind: "review_decision",
        content: "Accepted for record. No merge was performed.",
        metadata: {
          reviewStatus: "accepted",
          acceptedAt: now
        },
        createdAt: now
      })
    );

    const workspace = await knowledge.getWorkspace(project.id);

    expect(workspace.metrics).toMatchObject({
      proposed: 1,
      approved: 1,
      rejected: 1,
      summaries: 1,
      decisions: 2
    });
    expect(workspace.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "memory_knowledge_proposed",
          kind: "memory",
          status: "proposed",
          taskId: task.id
        }),
        expect.objectContaining({
          id: "summary_knowledge_review",
          kind: "thread_summary",
          status: "summary",
          threadId: thread.id,
          sourceLinks: expect.arrayContaining([
            expect.objectContaining({ kind: "thread", threadId: thread.id }),
            expect.objectContaining({
              kind: "message",
              messageId: sourceMessage.id
            })
          ])
        }),
        expect.objectContaining({
          id: "summary_knowledge_review:decision:0",
          kind: "thread_decision",
          status: "decision",
          content: "Keep review decisions source linked."
        }),
        expect.objectContaining({
          id: "artifact_knowledge_review_decision",
          kind: "review_decision",
          status: "accepted",
          runId: run.id,
          sourceLinks: expect.arrayContaining([
            expect.objectContaining({ kind: "run", runId: run.id }),
            expect.objectContaining({
              kind: "artifact",
              artifactId: "artifact_knowledge_review_decision"
            })
          ])
        })
      ])
    );
    expect(
      workspace.items.filter((item) =>
        item.content.includes("Review room summary stays thread-local.")
      )
    ).toEqual([
      expect.objectContaining({
        kind: "thread_summary",
        status: "summary"
      })
    ]);

    const handlers = createIpcHandlers(createDesktopServices(context));
    await expect(
      handlers[IPC_CHANNELS.knowledgeWorkspace](
        { sender: { send: vi.fn() } } as never,
        project.id
      )
    ).resolves.toMatchObject({
      projectId: project.id,
      metrics: expect.objectContaining({ decisions: 2 })
    });
  });

  it("redacts sensitive retained worktree diff patches in desktop review", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const review = createReviewService(context);
    const project = await projects.open(fixture.projectRoot);
    const now = context.now();
    const task = await fixture.repositories.taskRepository.create(
      validateTask({
        id: "task_sensitive_retained_diff",
        projectId: project.id,
        title: "Inspect retained sensitive diff",
        status: "completed",
        createdAt: now,
        updatedAt: now
      })
    );
    const runId = "run_sensitive_retained_diff";
    const worktreePath = path.join(fixture.workspaceBasePath, "sensitive-retained");
    await execFileAsync(
      "git",
      [
        "worktree",
        "add",
        "-b",
        `agent-hub/${runId}/fake`,
        worktreePath,
        "HEAD"
      ],
      { cwd: fixture.projectRoot }
    );
    await fs.writeFile(
      path.join(worktreePath, ".env.local"),
      "API_TOKEN=secret-value\n",
      "utf8"
    );
    await createRetainedRunFixture({
      context,
      fixture,
      taskId: task.id,
      runId,
      worktreePath,
      metadataPath: worktreePath,
      retained: true,
      cleaned: false
    });

    const diff = await review.getDiff(runId);
    expect(diff).toMatchObject({
      files: [expect.objectContaining({ path: ".env.local" })],
      patch: expect.stringContaining("Patch redacted because sensitive file path changed")
    });
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

  it("records explicit lifecycle keep and cleanup decisions", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const shell = new MockShellExecutor();
    const lifecycle = createLifecycleService(context, {
      reviewService: review,
      shellExecutor: shell
    });
    const runs = createTestRunService(context, review, memory, fixture);
    const project = await projects.open(fixture.projectRoot);
    const run = await runs.createRun({
      projectId: project.id,
      prompt: "Exercise lifecycle controls.",
      agentId: "fake",
      contextMode: "auto"
    });
    await waitForRun(runs, run.id, "completed");

    await expect(lifecycle.get(run.id)).resolves.toMatchObject({
      handoff: {
        available: true,
        cleanup: {
          retained: true,
          cleaned: false
        }
      },
      applyPreview: {
        available: true,
        confirmationPhrase: `apply ${run.id}`
      },
      audit: []
    });

    await expect(
      lifecycle.markKeep({ runId: run.id, reason: "Need reviewer handoff." })
    ).resolves.toMatchObject({
      ok: true,
      lifecycle: {
        audit: [
          expect.objectContaining({
            action: "mark_keep",
            status: "recorded"
          })
        ]
      }
    });

    await expect(
      lifecycle.cleanupWorktree({ runId: run.id, confirmation: "wrong" })
    ).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining(`cleanup ${run.id}`)
    });

    await expect(
      lifecycle.cleanupWorktree({
        runId: run.id,
        confirmation: `cleanup ${run.id}`,
        reason: "Reviewed locally."
      })
    ).resolves.toMatchObject({
      ok: true,
      lifecycle: {
        handoff: {
          available: false,
          message: expect.stringContaining("cleaned up")
        }
      }
    });
    expect(shell.calls.at(-1)?.command.args?.join(" ")).toContain("worktree");
    await expect(fixture.repositories.runMetadataRepository.get(run.id)).resolves.toMatchObject({
      workspaceCleanup: {
        cleaned: true,
        retained: false,
        reason: "Reviewed locally."
      }
    });
    await expect(
      fixture.repositories.runArtifactRepository.getLatestByRunIdAndKind(
        run.id,
        "lifecycle_audit"
      )
    ).resolves.toMatchObject({
      metadata: expect.objectContaining({
        action: "cleanup_worktree",
        status: "completed"
      })
    });
    await expect(fixture.repositories.runEventRepository.listByRunId(run.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "message",
          message: expect.stringContaining("Retained worktree cleaned up")
        })
      ])
    );
  });

  it("blocks explicit apply on blocking risk", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const shell = new MockShellExecutor();
    const lifecycle = createLifecycleService(context, {
      reviewService: review,
      shellExecutor: shell
    });
    const runs = createTestRunService(context, review, memory, fixture);
    const project = await projects.open(fixture.projectRoot);
    const run = await runs.createRun({
      projectId: project.id,
      prompt: "Preview local apply.",
      agentId: "fake",
      contextMode: "auto"
    });
    await waitForRun(runs, run.id, "completed");
    const blockingRisk = validateRiskReport({
      id: "risk_lifecycle_blocking",
      taskRunId: run.id,
      level: "blocking",
      summary: "Sensitive path changed.",
      verificationSummary: "Verification skipped.",
      findings: [
        {
          level: "blocking",
          summary: "Blocking lifecycle test risk",
          details: "Do not apply this patch."
        }
      ],
      riskFactors: ["blocking lifecycle test risk"],
      failedChecks: [],
      manualReviewChecklist: ["Inspect lifecycle blocking risk."],
      acceptanceRecommendation: "Do not apply.",
      changedFiles: ["fake-agent-output.md"],
      createdAt: context.now()
    });
    await fixture.repositories.riskReportRepository.create(blockingRisk);

    await expect(lifecycle.previewApply(run.id)).resolves.toMatchObject({
      blocked: true,
      riskLevel: "blocking",
      message: expect.stringContaining("blocked")
    });
    await expect(
      lifecycle.confirmApply({
        runId: run.id,
        confirmation: `apply ${run.id}`
      })
    ).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("blocking")
    });
    expect(shell.calls).toEqual([]);
  });

  it("checks and applies a previewed patch only after exact confirmation", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const shell = new MockShellExecutor();
    const lifecycle = createLifecycleService(context, {
      reviewService: review,
      shellExecutor: shell
    });
    const runs = createTestRunService(context, review, memory, fixture);
    const project = await projects.open(fixture.projectRoot);
    const run = await runs.createRun({
      projectId: project.id,
      prompt: "Apply after explicit confirmation.",
      agentId: "fake",
      contextMode: "auto"
    });
    await waitForRun(runs, run.id, "completed");

    await expect(
      lifecycle.confirmApply({
        runId: run.id,
        confirmation: "apply"
      })
    ).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining(`apply ${run.id}`)
    });
    expect(shell.calls).toEqual([]);

    await expect(
      lifecycle.confirmApply({
        runId: run.id,
        confirmation: `apply ${run.id}`,
        reason: "Manual approval."
      })
    ).resolves.toMatchObject({
      ok: true,
      message: expect.stringContaining("Patch applied")
    });
    expect(shell.calls.map((call) => call.command.args?.join(" "))).toEqual([
      expect.stringContaining("apply --check"),
      expect.stringContaining("apply")
    ]);
    await expect(
      fixture.repositories.runArtifactRepository.getLatestByRunIdAndKind(
        run.id,
        "lifecycle_audit"
      )
    ).resolves.toMatchObject({
      metadata: expect.objectContaining({
        action: "apply_confirm",
        status: "completed"
      })
    });
  });

  it("applies raw persisted patch content when the preview is truncated", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const review = createReviewService(context);
    const observedPatches: string[] = [];
    const shell = new MockShellExecutor([
      (command) => {
        observedPatches.push(readFileSync(command.args?.at(-1) ?? "", "utf8"));
        return {};
      },
      (command) => {
        observedPatches.push(readFileSync(command.args?.at(-1) ?? "", "utf8"));
        return {};
      }
    ]);
    const lifecycle = createLifecycleService(context, {
      reviewService: review,
      shellExecutor: shell
    });
    const project = await projects.open(fixture.projectRoot);
    const now = context.now();
    const task = await fixture.repositories.taskRepository.create(
      validateTask({
        id: "task_raw_apply_patch",
        projectId: project.id,
        title: "Apply raw patch",
        status: "completed",
        createdAt: now,
        updatedAt: now
      })
    );
    const run = await fixture.repositories.taskRunRepository.create(
      validateTaskRun({
        id: "run_raw_apply_patch",
        taskId: task.id,
        agentKind: "codex",
        status: "succeeded",
        createdAt: now,
        updatedAt: now
      })
    );
    const rawPatch = [
      "diff --git a/large.txt b/large.txt",
      "--- a/large.txt",
      "+++ b/large.txt",
      "@@ -1 +1 @@",
      "-old",
      `+${"new-value-".repeat(14_000)}`
    ].join("\n");
    await fixture.repositories.runMetadataRepository.save({
      runId: run.id,
      workspace: {
        path: path.join(fixture.workspaceBasePath, "raw-apply"),
        branchName: "agent-hub/raw-apply/codex",
        sourceRepositoryPath: fixture.projectRoot,
        workspaceBasePath: fixture.workspaceBasePath,
        taskId: task.id,
        runId: run.id,
        agentKind: "codex",
        dryRun: false,
        sourceRepositoryDirty: false,
        cleanupPolicy: "never"
      },
      diff: {
        ok: true,
        workspacePath: fixture.projectRoot,
        isClean: false,
        changedFiles: [{ path: "large.txt", status: "modified" }],
        stat: { filesChanged: 1, insertions: 1, deletions: 1, text: "1 file changed" },
        diff: rawPatch,
        fileSummaries: ["large.txt: +1/-1"],
        commands: []
      }
    });
    await fixture.repositories.runArtifactRepository.create(
      validateRunArtifact({
        id: "artifact_raw_apply_patch",
        taskRunId: run.id,
        kind: "git_diff",
        content: rawPatch,
        metadata: {
          changedFiles: [{ path: "large.txt", status: "modified" }],
          fileSummaries: ["large.txt: +1/-1"]
        },
        createdAt: now
      })
    );

    await expect(lifecycle.previewApply(run.id)).resolves.toMatchObject({
      truncated: true,
      patchPreview: expect.stringContaining("Apply preview truncated")
    });
    await expect(
      lifecycle.confirmApply({
        runId: run.id,
        confirmation: `apply ${run.id}`
      })
    ).resolves.toMatchObject({
      ok: true
    });

    expect(observedPatches).toEqual([rawPatch, rawPatch]);
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

  it("does not propose secret-like desktop verification commands as memory", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const project = await projects.open(fixture.projectRoot);
    const now = context.now();
    const taskId = "task_desktop_secret_memory";
    const runId = "run_desktop_secret_memory";

    await fixture.repositories.taskRepository.create(
      validateTask({
        id: taskId,
        projectId: project.id,
        title: "Remember verification command",
        status: "open",
        createdAt: now,
        updatedAt: now
      })
    );
    await fixture.repositories.taskRunRepository.create(
      validateTaskRun({
        id: runId,
        taskId,
        agentKind: "fake",
        status: "succeeded",
        startedAt: now,
        completedAt: now,
        createdAt: now,
        updatedAt: now
      })
    );
    await fixture.repositories.verificationResultRepository.createMany([
      validateVerificationResult({
        id: "verification_secret_command",
        taskRunId: runId,
        command: "OPENAI_API_KEY=redacted pnpm test",
        status: "passed",
        exitCode: 0,
        stdout: "",
        stderr: "",
        startedAt: now,
        completedAt: now,
        createdAt: now
      }),
      validateVerificationResult({
        id: "verification_safe_command",
        taskRunId: runId,
        command: "pnpm test -- tests/desktop-services.test.ts",
        status: "passed",
        exitCode: 0,
        stdout: "",
        stderr: "",
        startedAt: now,
        completedAt: now,
        createdAt: now
      })
    ]);

    const proposals = await memory.listProposals(runId);
    const proposalText = proposals.map((proposal) => proposal.content).join("\n");

    expect(proposalText).not.toContain("OPENAI_API_KEY");
    expect(proposals).toContainEqual(
      expect.objectContaining({
        content:
          "Verification command for this project is pnpm test -- tests/desktop-services.test.ts."
      })
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

    expect(detail).toMatchObject({
      title: "general",
      roomType: "default",
      roomHandle: "general",
      pinned: true,
      sharedContextEnabled: true
    });
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
    expect(new Set(runMessages.map((message) => message.taskId)).size).toBe(1);

    const fakeRun = runMessages.find((message) => message.agentId === "fake");
    const codexRun = runMessages.find((message) => message.agentId === "codex");
    if (!fakeRun || !codexRun) {
      throw new Error("expected fake and codex run messages");
    }
    expect(fakeRun.taskId).toBe(codexRun.taskId);
    const groupedTask = await fixture.repositories.taskRepository.get(
      fakeRun.taskId ?? ""
    );
    expect(groupedTask).toMatchObject({
      id: fakeRun.taskId,
      metadata: expect.objectContaining({
        threadId: detail.id,
        assignments: expect.arrayContaining([
          expect.objectContaining({
            assignmentRole: "agent",
            agentId: "fake",
            runId: fakeRun.runId
          }),
          expect.objectContaining({
            assignmentRole: "agent",
            agentId: "codex",
            runId: codexRun.runId
          })
        ])
      })
    });
    const rawTimelineMessages =
      await fixture.repositories.conversationMessageRepository.listByThreadId(
        detail.id
      );
    expect(rawTimelineMessages[0]?.metadata?.timelineEvent).toMatchObject({
      kind: "user_message",
      actor: "user",
      linkedIds: {
        taskId: fakeRun.taskId
      }
    });
    expect(
      rawTimelineMessages.find((message) => message.metadata?.taskEvent === "task_created")
        ?.metadata?.timelineEvent
    ).toMatchObject({
      kind: "task_created",
      linkedIds: {
        taskId: fakeRun.taskId
      }
    });
    expect(
      rawTimelineMessages.find(
        (message) => message.metadata?.taskEvent === "participants_assigned"
      )?.metadata?.timelineEvent
    ).toMatchObject({
      kind: "assignment_created",
      linkedIds: {
        taskId: fakeRun.taskId
      }
    });
    expect(
      rawTimelineMessages.find((message) => message.runId === fakeRun.runId)
        ?.metadata?.timelineEvent
    ).toMatchObject({
      kind: "run_started",
      linkedIds: {
        taskId: fakeRun.taskId,
        runId: fakeRun.runId
      }
    });
    await waitForRun(runs, fakeRun.runId, "completed");
    await waitForRun(runs, codexRun.runId, "failed");

    const refreshed = await threads.getThread(detail.id);
    expect(refreshed.messages.map((message) => message.type)).toEqual([
      "user",
      "system",
      "system",
      "agent_run",
      "agent_run",
      "assistant",
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
    expect(assistantMessages[1]?.text).toBe(
      "@codex failed before producing agent-facing output. Review evidence is available."
    );
    expect(
      refreshed.messages
        .filter((message) => message.type === "assistant")
        .map((message) => message.text)
        .join("\n")
    ).not.toContain("Found package.json");
    const terminalTimelineMessages =
      await fixture.repositories.conversationMessageRepository.listByThreadId(
        detail.id
      );
    expect(
      terminalTimelineMessages.find((message) => message.runId === fakeRun.runId)
        ?.metadata?.timelineEvent
    ).toMatchObject({
      kind: "run_completed",
      status: "completed",
      linkedIds: {
        runId: fakeRun.runId
      }
    });
    expect(
      terminalTimelineMessages.find((message) => message.runId === codexRun.runId)
        ?.metadata?.timelineEvent
    ).toMatchObject({
      kind: "run_failed",
      status: "failed",
      linkedIds: {
        runId: codexRun.runId
      }
    });
    expect(
      terminalTimelineMessages.find(
        (message) =>
          message.role === "assistant" &&
          message.runId === fakeRun.runId
      )?.metadata?.timelineEvent
    ).toMatchObject({
      kind: "participant_message",
      linkedIds: {
        runId: fakeRun.runId
      }
    });
    const summaries = await threads.listThreads();
    expect(summaries.find((thread) => thread.id === detail.id)).toMatchObject({
      activeRunCount: 0,
      runCount: 2
    });
  });

  it("seeds default project rooms in conversation thread metadata", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const runs = createTestRunService(context, review, memory, fixture);
    const threads = createThreadService({ context, projects, runs });
    const project = await projects.open(fixture.projectRoot);

    const summaries = await threads.listThreads();
    const projectRooms = summaries.filter((thread) => thread.projectId === project.id);

    expect(projectRooms.map((thread) => thread.roomHandle)).toEqual([
      "general",
      "planning",
      "research",
      "review",
      "knowledge"
    ]);
    expect(projectRooms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "general",
          roomType: "default",
          roomHandle: "general",
          pinned: true,
          sharedContextEnabled: true,
          description: expect.stringContaining("Project-wide")
        })
      ])
    );

    const rawThreads =
      await fixture.repositories.conversationThreadRepository.list(project.id);
    expect(rawThreads.find((thread) => thread.title === "general")?.metadata)
      .toMatchObject({
        roomType: "default",
        roomHandle: "general",
        pinned: true,
        sharedContextEnabled: true
      });
  });

  it("maps custom and legacy conversation threads as readable rooms", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const runs = createTestRunService(context, review, memory, fixture);
    const threads = createThreadService({ context, projects, runs });
    const project = await projects.open(fixture.projectRoot);
    const now = context.now();

    const custom = await threads.createThread({
      projectId: project.id,
      title: "Design Review",
      roomHandle: "#Design Review",
      description: "Focused review room."
    });
    expect(custom).toMatchObject({
      title: "Design Review",
      roomType: "custom",
      roomHandle: "design-review",
      description: "Focused review room.",
      sharedContextEnabled: true
    });

    await fixture.repositories.conversationThreadRepository.create(
      validateConversationThread({
        id: "thread_legacy_room",
        projectId: project.id,
        title: "Legacy Topic",
        createdAt: now,
        updatedAt: now
      })
    );
    const legacy = await threads.getThread("thread_legacy_room");
    expect(legacy).toMatchObject({
      title: "Legacy Topic",
      roomType: "custom",
      roomHandle: "legacy-topic",
      sharedContextEnabled: true
    });
  });

  it("resolves preset role mentions through executor metadata without changing adapter execution", async () => {
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
      text: "@researcher summarize the current thread",
      contextMode: "auto"
    });
    const runMessage = detail.messages.find(
      (message) => message.type === "agent_run"
    );
    if (!runMessage || runMessage.type !== "agent_run") {
      throw new Error("expected a role-backed run card");
    }

    expect(detail.messages[0]).toMatchObject({
      type: "user",
      text: "summarize the current thread",
      mentions: ["fake"],
      roleMentions: [
        expect.objectContaining({
          roleHandle: "researcher",
          executorKind: "agent_adapter",
          adapterKind: "fake"
        })
      ]
    });
    expect(runMessage.agentId).toBe("fake");
    expect(runMessage).toMatchObject({
      taskId: expect.any(String),
      assignment: expect.objectContaining({
        assignmentRole: "role",
        roleHandle: "researcher",
        executorKind: "agent_adapter",
        runId: runMessage.runId
      })
    });

    const rawMessages =
      await fixture.repositories.conversationMessageRepository.listByThreadId(
        detail.id
      );
    expect(rawMessages.filter((message) => message.role === "system")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metadata: expect.objectContaining({
            taskEvent: "task_created",
            taskId: runMessage.taskId
          })
        }),
        expect.objectContaining({
          metadata: expect.objectContaining({
            taskEvent: "participants_assigned",
            taskId: runMessage.taskId
          })
        })
      ])
    );
    expect(rawMessages[0]?.metadata).toMatchObject({
      roleMentions: [
        expect.objectContaining({
          roleHandle: "researcher",
          executorKind: "agent_adapter",
          adapterKind: "fake"
        })
      ]
    });
    const rawRunCard = rawMessages.find((message) => message.kind === "run_card");
    expect(rawRunCard?.metadata).toMatchObject({
      role: expect.objectContaining({
        roleHandle: "researcher",
        executorKind: "agent_adapter",
        adapterKind: "fake"
      }),
      executor: {
        kind: "agent_adapter",
        adapterKind: "fake"
      },
      taskId: runMessage.taskId,
      assignment: expect.objectContaining({
        assignmentRole: "role",
        roleHandle: "researcher",
        runId: runMessage.runId
      })
    });
    await expect(
      fixture.repositories.taskRepository.get(runMessage.taskId ?? "")
    ).resolves.toMatchObject({
      metadata: expect.objectContaining({
        threadId: detail.id,
        assignments: [
          expect.objectContaining({
            assignmentRole: "role",
            roleHandle: "researcher",
            executorKind: "agent_adapter",
            runId: runMessage.runId
          })
        ]
      })
    });

    await waitForRun(runs, runMessage.runId, "completed");
    await expect(
      fixture.repositories.runMetadataRepository.get(runMessage.runId)
    ).resolves.toMatchObject({
      role: expect.objectContaining({
        roleHandle: "researcher",
        executorKind: "agent_adapter",
        adapterKind: "fake"
      })
    });
    const brief =
      await fixture.repositories.runArtifactRepository.getLatestByRunIdAndKind(
        runMessage.runId,
        "conversation_brief"
      );
    expect(brief?.content).toContain("workgroup_role: @researcher");
    expect(brief?.content).toContain("role_instructions:");
  });

  it("stores project team roles and resolves custom role mentions through IPC-safe services", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const settings = createSettingsService(context);
    const comparison = createComparisonService(context);
    const knowledge = createKnowledgeService(context);
    const team = createTeamService(context);
    const runs = createTestRunService(context, review, memory, fixture);
    const threads = createThreadService({ context, projects, runs, team });
    const lifecycle = createLifecycleService(context, { reviewService: review });
    const handlers = createIpcHandlers({
      projects,
      runs,
      threads,
      review,
      lifecycle,
      comparison,
      memory,
      knowledge,
      team,
      settings
    });
    const sender = { send: vi.fn() };
    const project = await projects.open(fixture.projectRoot);
    const researcher = presetWorkgroupRoles.find(
      (role) => role.handle === "researcher"
    );
    const analyst = presetWorkgroupRoles.find((role) => role.handle === "analyst");
    if (!researcher || !analyst) {
      throw new Error("missing role preset");
    }

    await expect(
      handlers[IPC_CHANNELS.teamWorkspace]({ sender } as never, project.id)
    ).resolves.toMatchObject({
      projectId: project.id,
      metrics: expect.objectContaining({
        total: presetWorkgroupRoles.length,
        custom: 0
      }),
      roles: expect.arrayContaining([
        expect.objectContaining({
          source: "preset",
          role: expect.objectContaining({ handle: "researcher" })
        })
      ])
    });

    const qaRole: WorkgroupRole = {
      ...researcher,
      id: "custom:qa",
      handle: "qa",
      displayName: "QA Reviewer",
      purpose: "Review acceptance evidence.",
      capabilitySummary: "Acceptance checks and release risk notes.",
      persona: "Careful QA reviewer focused on local evidence.",
      defaultInstructions:
        "Review run evidence, list missing acceptance checks, and do not apply changes.",
      permissions: ["read_thread_context", "read_run_evidence"],
      executor: {
        kind: "human",
        unavailableReason: "Human role execution is reserved."
      },
      defaultRoom: "review",
      tags: ["qa", "review"]
    };
    const analystOverride: WorkgroupRole = {
      ...analyst,
      displayName: "Planning Analyst",
      permissions: [...analyst.permissions, "read_comparison_reports"],
      executor: { kind: "agent_adapter", adapterKind: "fake" }
    };

    await expect(
      handlers[IPC_CHANNELS.teamSaveRole]({ sender } as never, {
        projectId: project.id,
        role: qaRole
      })
    ).resolves.toMatchObject({
      source: "custom",
      executorRunnable: false,
      role: expect.objectContaining({
        handle: "qa",
        executor: expect.objectContaining({ kind: "human" })
      })
    });
    await expect(
      team.saveRole({ projectId: project.id, role: analystOverride })
    ).resolves.toMatchObject({
      source: "preset_override",
      role: expect.objectContaining({
        id: "preset:analyst",
        handle: "analyst",
        displayName: "Planning Analyst"
      })
    });

    await expect(
      fixture.repositories.settingsRepository.get(
        `desktop.project.${project.id}.workgroupRoles`
      )
    ).resolves.toBeDefined();
    const reloadedTeam = createTeamService(context);
    await expect(reloadedTeam.getWorkspace(project.id)).resolves.toMatchObject({
      metrics: expect.objectContaining({
        custom: 1,
        presetOverrides: 1,
        reservedExecutors: 1
      }),
      roles: expect.arrayContaining([
        expect.objectContaining({
          source: "custom",
          role: expect.objectContaining({ handle: "qa" })
        }),
        expect.objectContaining({
          source: "preset_override",
          role: expect.objectContaining({
            handle: "analyst",
            displayName: "Planning Analyst"
          })
        })
      ])
    });

    const detail = await threads.sendMessage({
      projectId: project.id,
      text: "@qa review release evidence",
      contextMode: "auto"
    });
    expect(detail.messages.find((message) => message.type === "agent_run")).toBeUndefined();
    expect(detail.messages[0]).toMatchObject({
      type: "user",
      text: "review release evidence",
      roleMentions: [
        expect.objectContaining({
          roleHandle: "qa",
          executorKind: "human"
        })
      ]
    });
    const taskEvent = detail.messages.find((message) => {
      if (message.type !== "system") {
        return false;
      }
      return message.metadata?.taskEvent === "participants_assigned";
    });
    if (taskEvent?.type !== "system") {
      throw new Error("expected participants assignment event");
    }
    expect(taskEvent?.metadata).toMatchObject({
      assignments: [
        expect.objectContaining({
          assignmentRole: "role",
          roleHandle: "qa",
          executorKind: "human",
          executable: false,
          status: "assigned"
        })
      ]
    });
    await fixture.repositories.memoryItemRepository.create(
      validateMemoryItem({
        id: "memory_qa_role",
        projectId: project.id,
        category: "workflow_rule",
        status: "proposed",
        content: "@qa should review release acceptance evidence.",
        createdAt: context.now(),
        updatedAt: context.now()
      })
    );
    const workspace = await team.getWorkspace(project.id);
    const qaSummary = workspace.roles.find((entry) => entry.role.handle === "qa");
    expect(qaSummary).toMatchObject({
      recentActivity: [
        expect.objectContaining({
          title: "review release evidence",
          status: "assigned"
        })
      ],
      linkedMemory: [
        expect.objectContaining({
          id: "memory_qa_role",
          status: "proposed"
        })
      ]
    });

    await expect(
      handlers[IPC_CHANNELS.teamSaveRole]({ sender } as never, {
        projectId: project.id,
        role: {
          ...qaRole,
          handle: "bad role"
        }
      })
    ).rejects.toThrow(/role handle/);
  });

  it("persists bounded workflow state and completion timeline metadata", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const settings = createSettingsService(context);
    const comparison = createComparisonService(context);
    const knowledge = createKnowledgeService(context);
    const team = createTeamService(context);
    const runs = createTestRunService(context, review, memory, fixture);
    const threads = createThreadService({ context, projects, runs, team });
    const handlers = createIpcHandlers({
      projects,
      runs,
      threads,
      review,
      comparison,
      memory,
      knowledge,
      team,
      settings
    });
    const sender = { send: vi.fn() };
    const project = await projects.open(fixture.projectRoot);

    const detail = await handlers[IPC_CHANNELS.threadsSendMessage](
      { sender } as never,
      {
        projectId: project.id,
        text: "@researcher review the bounded workflow implementation",
        contextMode: "auto",
        workflow: {
          mode: "review_loop",
          maxRounds: 2,
          stopCondition: "reviewer_passed OR max_rounds_reached",
          expectedOutputs: ["reviewer_findings", "final_summary"]
        }
      }
    );
    const threadDetail = detail as Awaited<ReturnType<typeof threads.getThread>>;
    const runMessage = threadDetail.messages.find(
      (message): message is AgentRunMessage => message.type === "agent_run"
    );
    if (!runMessage) {
      throw new Error("expected workflow-linked run");
    }
    await waitForRun(runs, runMessage.runId, "completed");
    const completed = await threads.getThread(threadDetail.id);
    const tasks = await fixture.repositories.taskRepository.listByProjectId(project.id);
    const workflowTask = tasks.find((task) => task.id === runMessage.taskId);
    const workflowState = workflowTask?.metadata?.workflowState as
      | { mode?: string; status?: string; maxRounds?: number; participants?: unknown[] }
      | undefined;

    expect(workflowState).toMatchObject({
      mode: "review_loop",
      status: "completed",
      maxRounds: 2
    });
    expect(workflowState?.participants).toEqual([
      expect.objectContaining({
        roleHandle: "researcher",
        runId: runMessage.runId,
        status: "completed"
      })
    ]);
    expect(
      completed.messages
        .filter((message) => message.type === "system")
        .map((message) => message.metadata?.workflowEvent)
    ).toEqual(
      expect.arrayContaining([
        "workflow_review_requested",
        "workflow_review_completed",
        "workflow_completed"
      ])
    );
    expect(runMessage.timelineEvent?.linkedIds?.workflowId).toEqual(
      expect.any(String)
    );
    expect(
      completed.messages.find(
        (message) =>
          message.type === "system" &&
          message.metadata?.workflowEvent === "workflow_completed"
      )?.timelineEvent
    ).toMatchObject({
      kind: "workflow_completed",
      linkedIds: expect.objectContaining({
        taskId: runMessage.taskId,
        workflowId: expect.any(String)
      })
    });
  });

  it("enforces workflow max rounds and records handoff start events", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const settings = createSettingsService(context);
    const comparison = createComparisonService(context);
    const knowledge = createKnowledgeService(context);
    const team = createTeamService(context);
    const runs = createTestRunService(context, review, memory, fixture);
    const threads = createThreadService({ context, projects, runs, team });
    const handlers = createIpcHandlers({
      projects,
      runs,
      threads,
      review,
      comparison,
      memory,
      knowledge,
      team,
      settings
    });
    const sender = { send: vi.fn() };
    const project = await projects.open(fixture.projectRoot);

    await expect(
      handlers[IPC_CHANNELS.threadsSendMessage]({ sender } as never, {
        projectId: project.id,
        text: "@researcher hand off scoped findings",
        workflow: {
          mode: "handoff",
          maxRounds: 2,
          stopCondition: "handoff_summary_recorded",
          expectedOutputs: ["handoff_summary"]
        }
      })
    ).rejects.toThrow(/workflow maxRounds/);

    const detail = (await threads.sendMessage({
      projectId: project.id,
      text: "/workflow handoff @researcher hand off scoped findings",
      contextMode: "auto"
    })) as Awaited<ReturnType<typeof threads.getThread>>;
    expect(
      detail.messages
        .filter((message) => message.type === "system")
        .map((message) => message.metadata?.workflowEvent)
    ).toContain("workflow_handoff");
  });

  it("keeps non-executable role assignments on the shared task without starting a run", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const runs = createTestRunService(context, review, memory, fixture);
    const researcher = presetWorkgroupRoles.find(
      (role) => role.handle === "researcher"
    );
    if (!researcher) {
      throw new Error("missing researcher preset");
    }
    const qaRole: WorkgroupRole = {
      ...researcher,
      id: "role_custom_qa",
      handle: "qa",
      displayName: "QA",
      purpose: "Human acceptance review.",
      executor: {
        kind: "human",
        unavailableReason: "Human role execution is reserved."
      }
    };
    const threads = createThreadService({
      context,
      projects,
      runs,
      roles: [qaRole, ...presetWorkgroupRoles]
    });
    const project = await projects.open(fixture.projectRoot);

    const detail = await threads.sendMessage({
      projectId: project.id,
      text: "@qa @researcher analyze this",
      contextMode: "auto"
    });
    const runMessages = detail.messages.filter(
      (message): message is AgentRunMessage => message.type === "agent_run"
    );

    expect(runMessages).toHaveLength(1);
    const runMessage = runMessages[0];
    if (!runMessage) {
      throw new Error("expected executable researcher run");
    }
    expect(runMessage).toMatchObject({
      agentId: "fake",
      assignment: expect.objectContaining({
        roleHandle: "researcher",
        runId: runMessage.runId
      })
    });
    const task = await fixture.repositories.taskRepository.get(
      runMessage.taskId ?? ""
    );
    expect(task?.metadata).toMatchObject({
      threadId: detail.id,
      assignments: expect.arrayContaining([
        expect.objectContaining({
          assignmentRole: "role",
          roleHandle: "qa",
          executorKind: "human",
          executable: false,
          status: "assigned"
        }),
        expect.objectContaining({
          assignmentRole: "role",
          roleHandle: "researcher",
          executorKind: "agent_adapter",
          executable: true,
          runId: runMessage.runId
        })
      ])
    });
    await expect(
      fixture.repositories.taskRunRepository.listByTaskId(runMessage.taskId ?? "")
    ).resolves.toHaveLength(1);
  });

  it("uses unique worktree branches for same-adapter role assignments on one task", async () => {
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
      text: "@researcher @writer compare the plan",
      contextMode: "auto"
    });
    const runMessages = detail.messages.filter(
      (message): message is AgentRunMessage => message.type === "agent_run"
    );
    expect(runMessages).toHaveLength(2);
    expect(new Set(runMessages.map((message) => message.taskId)).size).toBe(1);

    for (const message of runMessages) {
      await waitForRun(runs, message.runId, "completed");
    }
    const storedRuns = await fixture.repositories.taskRunRepository.listByTaskId(
      runMessages[0]?.taskId ?? ""
    );
    expect(storedRuns).toHaveLength(2);
    const branchNames = storedRuns.map((run) => run.branchName);
    expect(branchNames.every(Boolean)).toBe(true);
    expect(new Set(branchNames).size).toBe(2);
    expect(branchNames).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`agent-hub/${runMessages[0]?.taskId}/fake/`)
      ])
    );
    await expect(
      fixture.repositories.taskRepository.get(runMessages[0]?.taskId ?? "")
    ).resolves.toMatchObject({
      status: "completed",
      metadata: expect.objectContaining({
        assignments: expect.arrayContaining([
          expect.objectContaining({
            roleHandle: "researcher",
            status: "completed"
          }),
          expect.objectContaining({
            roleHandle: "writer",
            status: "completed"
          })
        ])
      })
    });
  });

  it("creates desktop comparison reports for terminal runs in the same multi-agent turn", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const settings = createSettingsService(context);
    const comparison = createComparisonService(context);
    const knowledge = createKnowledgeService(context);
    const team = createTeamService(context);
    const runs = createTestRunService(context, review, memory, fixture);
    const threads = createThreadService({ context, projects, runs, team });
    const handlers = createIpcHandlers({
      projects,
      runs,
      threads,
      review,
      comparison,
      memory,
      knowledge,
      team,
      settings
    });
    const sender = { send: vi.fn() };
    const project = await projects.open(fixture.projectRoot);

    const detail = await threads.sendMessage({
      projectId: project.id,
      text: "@fake @codex compare this turn",
      contextMode: "auto"
    });
    const runMessages = detail.messages.filter(
      (message) => message.type === "agent_run"
    );
    const fakeRun = runMessages.find((message) => message.agentId === "fake");
    const codexRun = runMessages.find((message) => message.agentId === "codex");
    if (!fakeRun || !codexRun) {
      throw new Error("expected fake and codex run cards");
    }
    await waitForRun(runs, fakeRun.runId, "completed");
    await waitForRun(runs, codexRun.runId, "failed");

    await expect(
      handlers[IPC_CHANNELS.comparisonListCandidates](
        { sender } as never,
        fakeRun.runId
      )
    ).resolves.toEqual([
      expect.objectContaining({
        runId: codexRun.runId,
        agentId: "codex",
        scope: "task"
      })
    ]);

    const report = await handlers[IPC_CHANNELS.comparisonCreate](
      { sender } as never,
      {
        baselineRunId: fakeRun.runId,
        candidateRunId: codexRun.runId
      }
    );
    expect(report).toMatchObject({
      baselineRunId: fakeRun.runId,
      candidateRunId: codexRun.runId,
      scope: "task",
      details: expect.objectContaining({
        runs: expect.objectContaining({
          baseline: expect.objectContaining({ agent: "fake", status: "succeeded" }),
          candidate: expect.objectContaining({ agent: "codex", status: "failed" })
        }),
        score: expect.objectContaining({
          winner: "baseline"
        })
      })
    });
    expect((report as { summary: string }).summary).toContain("comparison_score");

    await expect(comparison.listForRun(codexRun.runId)).resolves.toEqual([
      expect.objectContaining({
        baselineRunId: fakeRun.runId,
        candidateRunId: codexRun.runId
      })
    ]);
    await expect(
      fixture.repositories.comparisonReportRepository.listByRunId(fakeRun.runId)
    ).resolves.toHaveLength(1);
    await expect(
      handlers[IPC_CHANNELS.comparisonListForRun](
        { sender } as never,
        fakeRun.runId
      )
    ).resolves.toEqual([
      expect.objectContaining({
        id: (report as { id: string }).id
      })
    ]);

    const other = await threads.sendMessage({
      projectId: project.id,
      text: "@fake unrelated comparison candidate",
      contextMode: "auto"
    });
    const otherRun = other.messages
      .filter(
        (message): message is AgentRunMessage => message.type === "agent_run"
      )
      .at(-1);
    if (!otherRun) {
      throw new Error("expected unrelated run card");
    }
    await waitForRun(runs, otherRun.runId, "completed");
    await expect(
      comparison.createComparison({
        baselineRunId: fakeRun.runId,
        candidateRunId: otherRun.runId
      })
    ).rejects.toThrow(/same task or the same multi-agent desktop turn/);
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
      "system",
      "system",
      "agent_run",
      "assistant",
      "user",
      "system",
      "system",
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
    const summaries = await restartedThreads.listThreads();
    expect(summaries.find((thread) => thread.id === first.id)).toMatchObject({
      runCount: 2,
      activeRunCount: 0
    });
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

    const summaries = await threads.listThreads();
    expect(summaries.find((thread) => thread.id === detail.id)).toMatchObject({
      runCount: 1,
      activeRunCount: 0
    });
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
    const initialSummary = initialSummaries.find((thread) => thread.id === detail.id);
    expect(initialSummary).toMatchObject({
      runCount: 1
    });
    expect([0, 1]).toContain(initialSummary?.activeRunCount);
    await waitForRun(runs, run.runId, "completed");
    const finalSummaries = await threads.listThreads();
    expect(finalSummaries.find((thread) => thread.id === detail.id)).toMatchObject({
      runCount: 1,
      activeRunCount: 0
    });
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
    expect(summary?.sourceMessageCount).toBeGreaterThanOrEqual(2);
  });

  it("omits prior room messages and summaries when room shared context is disabled", async () => {
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
      text: "@fake prior shared-context prompt",
      contextMode: "auto"
    });
    const firstRun = first.messages.find(
      (message) => message.type === "agent_run"
    );
    if (!firstRun) {
      throw new Error("expected first run card");
    }
    await waitForRun(runs, firstRun.runId, "completed");
    await threads.getThread(first.id);

    const enabledSummary =
      await fixture.repositories.conversationThreadSummaryRepository.getByThreadId(first.id);
    expect(enabledSummary?.lastKnownUserGoal).toBe("prior shared-context prompt");

    const disabled = await threads.updateThread({
      threadId: first.id,
      sharedContextEnabled: false
    });
    expect(disabled.sharedContextEnabled).toBe(false);

    const second = await threads.sendMessage({
      threadId: first.id,
      text: "@fake isolated prompt",
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
        includedMessageCount: 0
      })
    });
    expect(artifact?.content).toContain("isolated prompt");
    expect(artifact?.content).toContain("room_shared_context:disabled");
    expect(artifact?.content).not.toContain("prior shared-context prompt");
    expect(artifact?.content).not.toContain("## Thread Summary");
    expect(artifact?.content).not.toContain("Last known user goal");
    expect(artifact?.content).not.toContain("Assistant @fake");
    expect(artifact?.content).not.toContain("fake agent completed");

    const summaries = await threads.listThreads();
    expect(summaries.find((thread) => thread.id === first.id)).toMatchObject({
      sharedContextEnabled: false
    });
  });

  it("excludes other direct agents from follow-up conversation briefs", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const processRunner = new MockProcessRunner(
      [[{ type: "exit", exitCode: 0, signal: null }]],
      [{ available: true, version: "codex-test" }]
    );
    const runs = createTestRunService(context, review, memory, fixture, {
      processRunner
    });
    const threads = createThreadService({ context, projects, runs });
    const project = await projects.open(fixture.projectRoot);

    const first = await threads.sendMessage({
      projectId: project.id,
      text: "@fake first agent answer",
      contextMode: "auto"
    });
    const firstRun = first.messages.find(
      (message) => message.type === "agent_run"
    );
    if (!firstRun) {
      throw new Error("expected first run card");
    }
    await waitForRun(runs, firstRun.runId, "completed");

    const second = await threads.sendMessage({
      threadId: first.id,
      text: "@codex second agent prompt",
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
    expect(artifact?.content).toContain("second agent prompt");
    expect(artifact?.content).not.toContain("first agent answer");
    expect(artifact?.content).not.toContain("Assistant @fake");
    expect(artifact?.content).not.toContain("fake agent completed");
    expect(artifact?.content).not.toContain("Task created:");
  });

  it("isolates role-targeted conversation briefs for roles sharing one executor", async () => {
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
      text: "@researcher Decision: researcher private fact",
      contextMode: "auto"
    });
    const firstRun = first.messages.find(
      (message): message is AgentRunMessage => message.type === "agent_run"
    );
    if (!firstRun) {
      throw new Error("expected first role run");
    }
    await waitForRun(runs, firstRun.runId, "completed");

    const second = await threads.sendMessage({
      threadId: first.id,
      text: "@writer writer follow-up",
      contextMode: "auto"
    });
    const secondRun = second.messages
      .filter((message): message is AgentRunMessage => message.type === "agent_run")
      .at(-1);
    if (!secondRun) {
      throw new Error("expected second role run");
    }
    await waitForRun(runs, secondRun.runId, "completed");

    const writerBrief =
      await fixture.repositories.runArtifactRepository.getLatestByRunIdAndKind(
        secondRun.runId,
        "conversation_brief"
      );
    expect(writerBrief?.content).toContain("workgroup_role: @writer");
    expect(writerBrief?.content).not.toContain("researcher private fact");
    expect(writerBrief?.content).not.toContain("workgroup_role: @researcher");

    const third = await threads.sendMessage({
      threadId: first.id,
      text: "@researcher researcher follow-up",
      contextMode: "auto"
    });
    const thirdRun = third.messages
      .filter((message): message is AgentRunMessage => message.type === "agent_run")
      .at(-1);
    if (!thirdRun) {
      throw new Error("expected third role run");
    }
    await waitForRun(runs, thirdRun.runId, "completed");

    const researcherBrief =
      await fixture.repositories.runArtifactRepository.getLatestByRunIdAndKind(
        thirdRun.runId,
        "conversation_brief"
      );
    expect(researcherBrief?.content).toContain("workgroup_role: @researcher");
    expect(researcherBrief?.content).toContain("researcher private fact");
    expect(researcherBrief?.content).not.toContain("writer follow-up");
  });

  it("resumes the previous Codex CLI session for follow-up turns to the same role", async () => {
    const fixture = await createFixture();
    const context = createDesktopServiceContext(fixture.repositories);
    const projects = createProjectService(context);
    const memory = createMemoryService(context);
    const review = createReviewService(context, { memoryService: memory });
    const processRunner = new MockProcessRunner(
      [
        [
          {
            type: "stdout",
            data: "{\"type\":\"thread.started\",\"thread_id\":\"019e5f4d-a2fb-7b71-9a69-b6ecc2795aa2\"}\n"
          },
          {
            type: "stdout",
            data: "{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"first role reply\"}}\n"
          },
          { type: "exit", exitCode: 0, signal: null }
        ],
        [
          {
            type: "stdout",
            data: "{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"continued role reply\"}}\n"
          },
          { type: "exit", exitCode: 0, signal: null }
        ]
      ],
      Array.from({ length: 10 }, () => ({
        available: true,
        version: "codex-cli 0.130.0"
      }))
    );
    const runs = createTestRunService(context, review, memory, fixture, {
      processRunner
    });
    const threads = createThreadService({
      context,
      projects,
      runs,
      roles: presetWorkgroupRoles
    });
    const project = await projects.open(fixture.projectRoot);

    const first = await threads.sendMessage({
      projectId: project.id,
      text: "@engineer first role turn",
      contextMode: "auto"
    });
    const firstRun = first.messages.find(
      (message): message is AgentRunMessage => message.type === "agent_run"
    );
    if (!firstRun) {
      throw new Error("expected first role run");
    }
    await waitForRun(runs, firstRun.runId, "completed");

    const second = await threads.sendMessage({
      threadId: first.id,
      text: "@engineer second role turn",
      contextMode: "auto"
    });
    const secondRun = second.messages
      .filter((message): message is AgentRunMessage => message.type === "agent_run")
      .at(-1);
    if (!secondRun) {
      throw new Error("expected second role run");
    }
    await waitForRun(runs, secondRun.runId, "completed");

    expect(processRunner.runCalls[0].args).toEqual(["exec", "--json", "-"]);
    expect(processRunner.runCalls[1].args).toEqual([
      "exec",
      "resume",
      "--json",
      "019e5f4d-a2fb-7b71-9a69-b6ecc2795aa2",
      "-"
    ]);
    await expect(threads.getThread(first.id)).resolves.toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({
          type: "assistant",
          text: "continued role reply",
          agentId: "codex",
          assignment: expect.objectContaining({
            roleHandle: "engineer"
          }),
          timelineEvent: expect.objectContaining({
            title: "@engineer response"
          })
        })
      ])
    });
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
    const comparison = createComparisonService(context);
    const knowledge = createKnowledgeService(context);
    const team = createTeamService(context);
    const runs = createTestRunService(context, review, memory, fixture);
    const threads = createThreadService({ context, projects, runs, team });
    const lifecycle = createLifecycleService(context, { reviewService: review });
    const handlers = createIpcHandlers({
      projects,
      runs,
      threads,
      review,
      lifecycle,
      comparison,
      memory,
      knowledge,
      team,
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
      handlers[IPC_CHANNELS.reviewContext](
        { sender } as never,
        runId
      )
    ).resolves.toMatchObject({
      available: false,
      message: expect.stringContaining("No persisted conversation brief")
    });
    await expect(
      handlers[IPC_CHANNELS.reviewArtifacts](
        { sender } as never,
        runId
      )
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "git_diff",
          sourceRunId: runId,
          sourceTaskId: expect.any(String),
          contentPreview: expect.any(String)
        })
      ])
    );
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
      handlers[IPC_CHANNELS.lifecycleGet](
        { sender } as never,
        runId
      )
    ).resolves.toMatchObject({
      handoff: {
        available: true
      },
      applyPreview: {
        confirmationPhrase: `apply ${runId}`
      }
    });
    await expect(
      handlers[IPC_CHANNELS.lifecycleConfirmApply]({ sender } as never, {
        runId,
        confirmation: "not exact"
      })
    ).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining(`apply ${runId}`)
    });
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

async function expectNoRepositoryContextWrites(projectRoot: string): Promise<void> {
  for (const relativePath of [
    "AGENTS.md",
    "CLAUDE.md",
    ".agent-hub",
    ".agents",
    ".claude"
  ]) {
    await expect(fs.access(path.join(projectRoot, relativePath))).rejects.toMatchObject({
      code: "ENOENT"
    });
  }
}

async function collectSourceFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectSourceFiles(entryPath));
    } else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

function forbiddenRendererApiPattern(): RegExp {
  const modules = [
    "fs",
    "path",
    "os",
    "child_process",
    "better-sqlite3",
    "sqlite3",
    "simple-git",
    "electron"
  ].join("|");
  return new RegExp(
    [
      `from\\s+["'](?:node:)?(?:${modules})["']`,
      `require\\(["'](?:node:)?(?:${modules})["']\\)`,
      "\\bipcRenderer\\b",
      "\\bwindow\\.require\\b",
      "\\bprocess\\.(?:env|cwd)\\b"
    ].join("|")
  );
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

function restoreEnv(key: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = previousValue;
}
