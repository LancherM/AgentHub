import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
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
  DefaultContextCompiler,
  InMemoryMemoryProvider,
  initContextStore,
  MarkdownContextFormatter
} from "@agent-hub/context-compiler";
import type {
  AgentRunEvent,
  ChangedFile,
  DiffCollectionInput,
  DiffCollectionResult,
  DiffCollectorService
} from "@agent-hub/task-runner";
import {
  InMemoryRiskReportRepository,
  InMemoryRunArtifactRepository,
  InMemoryRunEventRepository,
  InMemoryRunMetadataRepository,
  InMemoryTaskRepository,
  InMemoryTaskRunRepository,
  InMemoryVerificationResultRepository,
  InMemoryMemoryItemRepository,
  validateRunEvent
} from "@agent-hub/core";
import {
  FixedClock,
  generateMemoryProposalsFromCompletedRun,
  SequenceIdGenerator,
  TaskRunner,
  TaskRunnerError
} from "@agent-hub/task-runner";
import {
  DEFAULT_VERIFICATION_COMMAND_TIMEOUT_MS,
  VerificationRunner
} from "@agent-hub/task-runner";
import type {
  WorkspaceConfig,
  WorkspaceManager,
  WorkspaceSession
} from "@agent-hub/task-runner";
import { createTestDirectory, MockProcessRunner, MockShellExecutor } from "./helpers";

function skillMarkdown(input: {
  name: string;
  description: string;
  body?: string;
}): string {
  return [
    "---",
    `name: ${input.name}`,
    `description: ${input.description}`,
    "---",
    "",
    input.body ?? "Generated skill.",
    ""
  ].join("\n");
}

describe("task runner", () => {
  it("runs the fake adapter in an isolated directory without modifying the project root", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");
    const runRoot = await createTestDirectory("agent-hub-runs");
    const projectMarker = path.join(projectRoot, "README.md");
    await fs.writeFile(projectMarker, "original\n", "utf8");
    const before = await fs.readdir(projectRoot);

    const runner = createTestRunner(runRoot);

    const result = await runner.run({
      projectRoot,
      taskPrompt: "Create a deterministic fake output",
      agentKind: "fake",
      taskId: "task_1"
    });

    expect(result.status).toBe("succeeded");
    expect(result.run.status).toBe("succeeded");
    expect(result.diff?.changedFiles).toEqual([
      { path: "fake-agent-output.md", status: "untracked" }
    ]);
    expect(result.verification?.status).toBe("skipped");
    expect(result.warnings).toContain(
      "No verification commands were configured; verification was skipped."
    );
    expect(result.riskReport?.level).toBe("medium");
    expect(result.worktreePath?.startsWith(runRoot)).toBe(true);
    expect(result.taskBriefPath?.startsWith(result.worktreePath ?? "")).toBe(true);
    await expect(
      fs.readFile(path.join(result.worktreePath ?? "", "fake-agent-output.md"), "utf8")
    ).resolves.toContain("Create a deterministic fake output");
    await expect(fs.readFile(projectMarker, "utf8")).resolves.toBe("original\n");
    await expect(fs.readdir(projectRoot)).resolves.toEqual(before);
  });

  it("injects and persists conversation briefs for task runs", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");
    const runRoot = await createTestDirectory("agent-hub-runs");
    const runArtifactRepository = new InMemoryRunArtifactRepository();
    const runner = new TaskRunner({
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector(),
      verificationRunner: new VerificationRunner(new MockShellExecutor()),
      runArtifactRepository,
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock("2026-01-01T00:00:00.000Z")
    });

    const result = await runner.run({
      projectRoot,
      taskPrompt: "Continue a thread-aware task",
      agentKind: "fake",
      conversationBrief: {
        renderedContent: "Thread decision: preserve the preload IPC boundary.\n",
        metadata: {
          maxRecentMessages: 12,
          maxTotalCharacters: 12_000,
          maxPerMessageCharacters: 2_000,
          maxThreadSummaryCharacters: 2_000,
          approximateTokenCount: 12,
          includedMessageCount: 2,
          omittedMessageCount: 0,
          includedThreadSummary: false,
          originalCharacterCount: 48,
          renderedCharacterCount: 48,
          truncated: false
        }
      }
    });

    expect(result.contextBundle.sections.map((section) => section.id))
      .toContain("conversation:thread");
    expect(result.contextMarkdown).toContain(
      "Thread decision: preserve the preload IPC boundary."
    );
    await expect(
      runArtifactRepository.getLatestByRunIdAndKind(
        result.run.id,
        "conversation_brief"
      )
    ).resolves.toMatchObject({
      content: expect.stringContaining("preserve the preload IPC boundary"),
      metadata: expect.objectContaining({
        source: "conversation_context_builder",
        includedMessageCount: 2
      })
    });
  });

  it("rejects run roots inside the original project root", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");

    await expect(
      createTestRunner(path.join(projectRoot, ".agent-hub", "runs")).run({
        projectRoot,
        taskPrompt: "This should fail",
        agentKind: "fake"
      })
    ).rejects.toThrow(TaskRunnerError);
  });

  it("rejects repo_export delivery mode for task runs", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");
    const runRoot = await createTestDirectory("agent-hub-runs");
    const taskRepository = new InMemoryTaskRepository();
    const runner = new TaskRunner({
      taskRepository,
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector(),
      verificationRunner: new VerificationRunner(new MockShellExecutor())
    });

    await expect(
      runner.run({
        projectRoot,
        taskPrompt: "Do not export repo context during a run",
        agentKind: "fake",
        deliveryMode: "repo_export" as never
      })
    ).rejects.toThrow(
      "deliveryMode must be runtime_injection or worktree_overlay for task runs"
    );

    await expect(taskRepository.list()).resolves.toEqual([]);
    await expect(fs.readdir(runRoot)).resolves.toEqual([]);
  });

  it("rejects unimplemented agents", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");
    const runRoot = await createTestDirectory("agent-hub-runs");

    await expect(
      new TaskRunner({
        defaultRunRoot: runRoot,
        workspaceManager: new TestWorkspaceManager(runRoot),
        diffCollector: new StaticDiffCollector(),
        verificationRunner: new VerificationRunner(new MockShellExecutor()),
        agentRegistry: new DefaultAgentRegistry([new FakeAgentAdapter()])
      }).run({
        projectRoot,
        taskPrompt: "Run codex",
        agentKind: "codex"
      })
    ).resolves.toMatchObject({
      ok: false,
      error: "agent codex is not registered"
    });
  });

  it("persists tasks, runs, and status transitions", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");
    const runRoot = await createTestDirectory("agent-hub-runs");
    const taskRepository = new InMemoryTaskRepository();
    const taskRunRepository = new InMemoryTaskRunRepository();
    const runEventRepository = new InMemoryRunEventRepository();
    const runArtifactRepository = new InMemoryRunArtifactRepository();
    const verificationResultRepository = new InMemoryVerificationResultRepository();
    const riskReportRepository = new InMemoryRiskReportRepository();
    const runner = new TaskRunner({
      taskRepository,
      taskRunRepository,
      runEventRepository,
      runArtifactRepository,
      verificationResultRepository,
      riskReportRepository,
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector(),
      verificationRunner: new VerificationRunner(new MockShellExecutor()),
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock("2026-01-01T00:00:00.000Z")
    });

    const result = await runner.run({
      projectRoot,
      rawPrompt: "@fake persist this run"
    });

    await expect(taskRepository.list()).resolves.toEqual([result.task]);
    await expect(taskRunRepository.list()).resolves.toEqual([
      expect.objectContaining({
        id: "run_0002",
        taskId: "task_0001",
        status: "succeeded",
        worktreePath: result.worktreePath
      })
    ]);
    expect(result.statusTransitions.map((transition) => transition.status)).toEqual([
      "queued",
      "running",
      "succeeded"
    ]);
    await expect(runEventRepository.listByRunId("run_0002")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sequence: 0,
          type: "status",
          metadata: expect.objectContaining({ desktopEventType: "context_compiled" })
        }),
        expect.objectContaining({ type: "stdout" }),
        expect.objectContaining({ type: "exit" }),
        expect.objectContaining({
          type: "status",
          metadata: expect.objectContaining({ desktopEventType: "run_completed" })
        })
      ])
    );
    await expect(
      runArtifactRepository.getLatestByRunIdAndKind("run_0002", "git_diff")
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "git_diff",
        metadata: expect.objectContaining({
          changedFiles: [{ path: "fake-agent-output.md", status: "untracked" }]
        })
      })
    );
    await expect(verificationResultRepository.listByRunId("run_0002")).resolves.toEqual([
      expect.objectContaining({ command: "not configured", status: "skipped" })
    ]);
    await expect(riskReportRepository.getLatestByRunId("run_0002")).resolves.toEqual(
      expect.objectContaining({ level: "medium" })
    );
  });

  it("emits deterministic progress events through the task-runner hook", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");
    const runRoot = await createTestDirectory("agent-hub-runs");
    const observed: AgentRunEvent[] = [];
    const runner = new TaskRunner({
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector(),
      verificationRunner: new VerificationRunner(new MockShellExecutor()),
      agentRegistry: new DefaultAgentRegistry([
        new FakeAgentAdapter({ stepDelayMs: 1 })
      ]),
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock("2026-01-01T00:00:00.000Z")
    });

    const result = await runner.run({
      projectRoot,
      rawPrompt: "@fake stream progress",
      onEvent: (event) => {
        observed.push(event);
      }
    });

    expect(result.status).toBe("succeeded");
    expect(observed.map((event) => event.metadata?.desktopEventType)).toEqual(
      expect.arrayContaining([
        "context_compiled",
        "run_started",
        "agent_step",
        "verification_started",
        "verification_finished",
        "run_completed"
      ])
    );
    expect(observed.some((event) => event.type === "stdout")).toBe(true);
    expect(observed.at(-1)?.metadata?.desktopEventType).toBe("run_completed");
  });

  it("backfills missing persisted run events by sequence without duplicating later events", async () => {
    const runEventRepository = new InMemoryRunEventRepository();
    let persistedEventId = 0;
    const runner = new TaskRunner({
      runEventRepository,
      idGenerator: {
        nextId: (prefix: string) => `${prefix}_persist_${++persistedEventId}`
      },
      clock: new FixedClock("2026-01-01T00:00:00.000Z")
    });
    const runId = "run_backfill";
    await runEventRepository.createMany([
      validateRunEvent({
        id: "event_0001",
        taskRunId: runId,
        sequence: 0,
        type: "status",
        message: "first",
        metadata: {},
        createdAt: "2026-01-01T00:00:00.000Z"
      }),
      validateRunEvent({
        id: "event_0002",
        taskRunId: runId,
        sequence: 2,
        type: "status",
        message: "third",
        metadata: {},
        createdAt: "2026-01-01T00:00:00.000Z"
      })
    ]);

    await (runner as unknown as { persistNewRunEvents: Function }).persistNewRunEvents(
      runId,
      [
        { type: "status", message: "first" },
        { type: "status", message: "second" },
        { type: "status", message: "third" }
      ],
      []
    );

    await expect(runEventRepository.listByRunId(runId)).resolves.toEqual([
      expect.objectContaining({ sequence: 0, message: "first" }),
      expect.objectContaining({ sequence: 1, message: "second" }),
      expect.objectContaining({ sequence: 2, message: "third" })
    ]);
  });

  it("cancels before adapter execution when the abort signal is already set", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");
    const runRoot = await createTestDirectory("agent-hub-runs");
    const controller = new AbortController();
    controller.abort();
    const runner = new TaskRunner({
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector(),
      verificationRunner: new VerificationRunner(new MockShellExecutor()),
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock("2026-01-01T00:00:00.000Z")
    });

    const result = await runner.run({
      projectRoot,
      rawPrompt: "@fake cancel before start",
      signal: controller.signal
    });

    expect(result.status).toBe("cancelled");
    expect(result.run.status).toBe("cancelled");
    expect(result.worktreePath).toBeUndefined();
    expect(result.events.at(-1)?.metadata?.desktopEventType).toBe("run_cancelled");
  });

  it("cancels a process-backed adapter only when the abort signal stops it", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");
    const runRoot = await createTestDirectory("agent-hub-runs");
    const controller = new AbortController();
    const processRunner = new AbortableMockProcessRunner(controller);
    const runner = new TaskRunner({
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector(),
      verificationRunner: new VerificationRunner(new MockShellExecutor()),
      agentRegistry: new DefaultAgentRegistry([
        new CodexAdapter({ processRunner })
      ]),
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock("2026-01-01T00:00:00.000Z")
    });

    const result = await runner.run({
      projectRoot,
      rawPrompt: "@codex cancel process",
      signal: controller.signal
    });

    expect(result.status).toBe("cancelled");
    expect(result.run.status).toBe("cancelled");
    expect(processRunner.runCalls[0].signal).toBe(controller.signal);
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "exit", signal: "SIGTERM" }),
        expect.objectContaining({
          metadata: expect.objectContaining({ desktopEventType: "run_cancelled" })
        })
      ])
    );
  });

  it("creates proposed memory from persisted successful run evidence", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");
    const runRoot = await createTestDirectory("agent-hub-runs");
    const memoryItemRepository = new InMemoryMemoryItemRepository();
    const verificationResultRepository = new InMemoryVerificationResultRepository();
    const runner = new TaskRunner({
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector(),
      verificationRunner: new VerificationRunner(
        new MockShellExecutor([{ exitCode: 0, stdout: "ok\n" }])
      ),
      verificationResultRepository,
      memoryItemRepository,
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock("2026-01-01T00:00:00.000Z")
    });

    const result = await runner.run({
      projectRoot,
      projectId: "project_memory",
      rawPrompt: "@fake remember verification",
      verificationCommands: [{ id: "test", command: "pnpm", args: ["test"] }]
    });

    await expect(
      verificationResultRepository.listByRunId(result.run.id)
    ).resolves.toEqual([
        expect.objectContaining({
          command: "pnpm test",
          status: "passed"
        })
      ]);
    await expect(
      memoryItemRepository.listByProjectId("project_memory")
    ).resolves.toEqual([
        expect.objectContaining({
          id: expect.stringMatching(/^memory_/),
          taskId: result.task.id,
          category: "workflow_rule",
          status: "proposed",
          content: "Verification command for this project is pnpm test."
        })
      ]);
  });

  it("does not propose secret-like verification commands as memory", async () => {
    const taskRepository = new InMemoryTaskRepository();
    const taskRunRepository = new InMemoryTaskRunRepository();
    const runArtifactRepository = new InMemoryRunArtifactRepository();
    const verificationResultRepository = new InMemoryVerificationResultRepository();
    const riskReportRepository = new InMemoryRiskReportRepository();
    const memoryItemRepository = new InMemoryMemoryItemRepository();
    await taskRepository.create({
      id: "task_secret_memory",
      projectId: "project_secret_memory",
      title: "Secret memory",
      status: "open",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    await taskRunRepository.create({
      id: "run_secret_memory",
      taskId: "task_secret_memory",
      agentKind: "fake",
      status: "succeeded",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    await verificationResultRepository.createMany([
      {
        id: "verification_env_api_key",
        taskRunId: "run_secret_memory",
        command: "OPENAI_API_KEY=redacted pnpm test",
        status: "passed",
        exitCode: 0,
        createdAt: "2026-01-01T00:00:00.000Z"
      },
      {
        id: "verification_env_token",
        taskRunId: "run_secret_memory",
        command: "GITHUB_TOKEN=redacted pnpm test",
        status: "passed",
        exitCode: 0,
        createdAt: "2026-01-01T00:00:00.000Z"
      },
      {
        id: "verification_camel_api_key",
        taskRunId: "run_secret_memory",
        command: "pnpm test --openaiApiKey=redacted",
        status: "passed",
        exitCode: 0,
        createdAt: "2026-01-01T00:00:00.000Z"
      },
      {
        id: "verification_client_secret",
        taskRunId: "run_secret_memory",
        command: "pnpm test --clientSecret=redacted",
        status: "passed",
        exitCode: 0,
        createdAt: "2026-01-01T00:00:00.000Z"
      }
    ]);

    await expect(
      generateMemoryProposalsFromCompletedRun(
        {
          taskRunRepository,
          taskRepository,
          runArtifactRepository,
          verificationResultRepository,
          riskReportRepository,
          memoryItemRepository
        },
        {
          runId: "run_secret_memory",
          idGenerator: new SequenceIdGenerator(),
          clock: new FixedClock("2026-01-01T00:00:00.000Z")
        }
      )
    ).resolves.toEqual([]);
    await expect(
      memoryItemRepository.listByProjectId("project_secret_memory")
    ).resolves.toEqual([]);
  });

  it("passes compiled context to the fake adapter", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");
    const runRoot = await createTestDirectory("agent-hub-runs");
    const runner = new TaskRunner({
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector(),
      verificationRunner: new VerificationRunner(new MockShellExecutor()),
      contextCompiler: new DefaultContextCompiler({
        memoryProvider: new InMemoryMemoryProvider([
          { id: "memory_1", content: "Use runtime injection." }
        ])
      }),
      contextFormatter: new MarkdownContextFormatter(),
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock("2026-01-01T00:00:00.000Z")
    });

    const result = await runner.run({
      projectRoot,
      rawPrompt: "@fake use context"
    });

    expect(result.contextMarkdown).toContain("Use runtime injection.");
    expect(result.fakeOutput).toContain("context_sections: 4");
    expect(result.fakeOutput).toContain("Use runtime injection.");
  });

  it("records failed fake adapter execution without crashing", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");
    const runRoot = await createTestDirectory("agent-hub-runs");
    const taskRepository = new InMemoryTaskRepository();
    const runner = new TaskRunner({
      taskRepository,
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector(),
      verificationRunner: new VerificationRunner(new MockShellExecutor()),
      agentRegistry: new DefaultAgentRegistry([
        new FakeAgentAdapter({ fail: true, failureMessage: "forced fake failure" })
      ]),
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock("2026-01-01T00:00:00.000Z")
    });

    const result = await runner.run({
      projectRoot,
      rawPrompt: "@fake fail this run"
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error).toBe("forced fake failure");
    expect(result.task.status).toBe("open");
    await expect(taskRepository.get(result.task.id)).resolves.toMatchObject({
      status: "open"
    });
    expect(result.statusTransitions.map((transition) => transition.status)).toEqual([
      "queued",
      "running",
      "failed"
    ]);
  });

  it("persists failed Codex process exits as inspectable failed runs", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");
    const runRoot = await createTestDirectory("agent-hub-runs");
    const runEventRepository = new InMemoryRunEventRepository();
    const runner = new TaskRunner({
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector(),
      verificationRunner: new VerificationRunner(new MockShellExecutor()),
      runEventRepository,
      agentRegistry: new DefaultAgentRegistry([
        new CodexAdapter({
          processRunner: new MockProcessRunner([
            [
              { type: "stderr", data: "codex failed\n" },
              { type: "exit", exitCode: 2, signal: null }
            ]
          ])
        })
      ]),
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock("2026-01-01T00:00:00.000Z")
    });

    const result = await runner.run({
      projectRoot,
      rawPrompt: "@codex fail this run"
    });

    expect(result.status).toBe("failed");
    expect(result.run.status).toBe("failed");
    await expect(runEventRepository.listByRunId(result.run.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "status", message: "Codex preflight passed" }),
        expect.objectContaining({ type: "status", message: "starting Codex" }),
        expect.objectContaining({ type: "stderr", message: "codex failed\n" }),
        expect.objectContaining({
          type: "exit",
          metadata: expect.objectContaining({ exitCode: 2, signal: null })
        }),
        expect.objectContaining({
          type: "status",
          metadata: expect.objectContaining({ desktopEventType: "run_failed" })
        })
      ])
    );
  });

  it("preflights unavailable real adapters into failed run events without launching them", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");
    const runRoot = await createTestDirectory("agent-hub-runs");
    const processRunner = new MockProcessRunner(
      [[{ type: "exit", exitCode: 0, signal: null }]],
      [{ available: false, reason: "not authenticated" }]
    );
    const runner = new TaskRunner({
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector(),
      verificationRunner: new VerificationRunner(new MockShellExecutor()),
      agentRegistry: new DefaultAgentRegistry([
        new CodexAdapter({ processRunner })
      ]),
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock("2026-01-01T00:00:00.000Z")
    });

    const result = await runner.run({
      projectRoot,
      rawPrompt: "@codex run unavailable adapter"
    });

    expect(result.status).toBe("failed");
    expect(processRunner.detectCalls).toHaveLength(1);
    expect(processRunner.runCalls).toHaveLength(0);
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "error",
          message: "Codex preflight failed: Codex CLI unavailable: not authenticated"
        }),
        expect.objectContaining({ type: "exit", exitCode: 1 }),
        expect.objectContaining({
          metadata: expect.objectContaining({ desktopEventType: "run_failed" })
        })
      ])
    );
  });

  it("passes explicit environment overrides to process-backed adapters", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");
    const runRoot = await createTestDirectory("agent-hub-runs");
    const processRunner = new MockProcessRunner([
      [{ type: "exit", exitCode: 0, signal: null }]
    ]);
    const runner = new TaskRunner({
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector(),
      verificationRunner: new VerificationRunner(new MockShellExecutor()),
      agentRegistry: new DefaultAgentRegistry([
        new CodexAdapter({ processRunner })
      ]),
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock("2026-01-01T00:00:00.000Z")
    });

    const environmentOverrides = {
      CUSTOM_ENV: "explicit",
      HOME: undefined
    };

    const result = await runner.run({
      projectRoot,
      rawPrompt: "@codex use explicit environment",
      environmentOverrides
    });

    expect(result.status).toBe("succeeded");
    expect(processRunner.detectCalls[0].env).toEqual(environmentOverrides);
    expect(processRunner.runCalls[0].env).toEqual(environmentOverrides);
  });

  it("does not pass arbitrary host environment through task-runner defaults", async () => {
    const previousSecret = process.env.AGENT_HUB_TEST_SECRET;
    process.env.AGENT_HUB_TEST_SECRET = "do-not-pass";
    try {
      const projectRoot = await createTestDirectory("agent-hub-project");
      const runRoot = await createTestDirectory("agent-hub-runs");
      const processRunner = new MockProcessRunner([
        [{ type: "exit", exitCode: 0, signal: null }]
      ]);
      const runner = new TaskRunner({
        defaultRunRoot: runRoot,
        workspaceManager: new TestWorkspaceManager(runRoot),
        diffCollector: new StaticDiffCollector(),
        verificationRunner: new VerificationRunner(new MockShellExecutor()),
        agentRegistry: new DefaultAgentRegistry([
          new CodexAdapter({ processRunner })
        ]),
        idGenerator: new SequenceIdGenerator(),
        clock: new FixedClock("2026-01-01T00:00:00.000Z")
      });

      const result = await runner.run({
        projectRoot,
        rawPrompt: "@codex use default environment"
      });

      expect(result.status).toBe("succeeded");
      expect(processRunner.detectCalls[0].env).toBeUndefined();
      expect(processRunner.runCalls[0].env).toBeUndefined();
    } finally {
      if (previousSecret === undefined) {
        delete process.env.AGENT_HUB_TEST_SECRET;
      } else {
        process.env.AGENT_HUB_TEST_SECRET = previousSecret;
      }
    }
  });

  it("includes adapter run events in risk report dangerous-command scanning", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");
    const runRoot = await createTestDirectory("agent-hub-runs");
    const runner = new TaskRunner({
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector(),
      verificationRunner: new VerificationRunner(new MockShellExecutor()),
      agentRegistry: new DefaultAgentRegistry([
        new CodexAdapter({
          processRunner: new MockProcessRunner([
            [
              { type: "stdout", data: "{\"type\":\"message\",\"message\":\"run sudo true\"}\n" },
              { type: "exit", exitCode: 0, signal: null }
            ]
          ])
        })
      ]),
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock("2026-01-01T00:00:00.000Z")
    });

    const result = await runner.run({
      projectRoot,
      rawPrompt: "@codex generate dangerous instruction"
    });

    expect(result.riskReport?.level).toBe("blocking");
    expect(result.riskReport?.riskFactors.join("\n")).toContain("run_event_");
    expect(result.riskReport?.riskFactors.join("\n")).toContain(
      "Privileged command"
    );
  });

  it("marks the run failed when verification fails and retains on failure when configured", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");
    const runRoot = await createTestDirectory("agent-hub-runs");
    const runner = new TaskRunner({
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector(),
      verificationRunner: new VerificationRunner(
        new MockShellExecutor([{ exitCode: 1, stderr: "tests failed\n" }])
      ),
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock("2026-01-01T00:00:00.000Z")
    });

    const result = await runner.run({
      projectRoot,
      rawPrompt: "@fake verify this run",
      workspaceCleanupPolicy: "retain_on_failure",
      verificationCommands: [{ id: "test", command: "pnpm", args: ["test"] }]
    });

    expect(result.status).toBe("failed");
    expect(result.verification?.failedCommands.map((entry) => entry.commandId)).toEqual([
      "test"
    ]);
    expect(result.riskReport?.level).toBe("high");
    expect(result.workspaceCleanup?.retained).toBe(true);
  });

  it("continues from a retained parent run by copying safe changed files into a new worktree", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");
    const runRoot = await createTestDirectory("agent-hub-runs");
    const parentWorktree = await createTestDirectory("agent-hub-parent-worktree");
    await fs.mkdir(path.join(parentWorktree, "src"), { recursive: true });
    await fs.writeFile(path.join(parentWorktree, "src", "new.ts"), "new file\n", "utf8");
    await fs.writeFile(
      path.join(parentWorktree, "src", "existing.ts"),
      "changed file\n",
      "utf8"
    );
    const taskRepository = new InMemoryTaskRepository();
    const taskRunRepository = new InMemoryTaskRunRepository();
    const runMetadataRepository = new InMemoryRunMetadataRepository();
    const runArtifactRepository = new InMemoryRunArtifactRepository();
    await seedParentRun({
      projectRoot,
      parentWorktree,
      taskRepository,
      taskRunRepository,
      runMetadataRepository
    });
    const diffCollector = new ContinuationDiffCollector(parentWorktree, [
      { path: "src/new.ts", status: "untracked" },
      { path: "src/existing.ts", status: "modified" },
      { path: "src/remove.ts", status: "deleted" }
    ]);
    const runner = new TaskRunner({
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot, {
        baseFiles: {
          "src/existing.ts": "base file\n",
          "src/remove.ts": "remove me\n"
        }
      }),
      diffCollector,
      shellExecutor: new MockShellExecutor([{ stdout: "abc123\n" }]),
      verificationRunner: new VerificationRunner(new MockShellExecutor()),
      taskRepository,
      taskRunRepository,
      runMetadataRepository,
      runArtifactRepository,
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock("2026-01-01T00:00:00.000Z")
    });

    const result = await runner.run({
      projectRoot,
      projectId: "project_1",
      taskPrompt: "continue safely",
      agentKind: "fake",
      continueFrom: { parentRunId: "run_parent", parentMessageId: "message_parent" }
    });

    expect(result.run).toMatchObject({
      parentRunId: "run_parent",
      parentMessageId: "message_parent"
    });
    expect(result.run.branchName).toContain("continue-run_parent");
    await expect(
      fs.readFile(path.join(result.worktreePath ?? "", "src", "new.ts"), "utf8")
    ).resolves.toBe("new file\n");
    await expect(
      fs.readFile(path.join(result.worktreePath ?? "", "src", "existing.ts"), "utf8")
    ).resolves.toBe("changed file\n");
    await expect(
      fs.access(path.join(result.worktreePath ?? "", "src", "remove.ts"))
    ).rejects.toThrow();
    const provenance = await runArtifactRepository.getLatestByRunIdAndKind(
      result.run.id,
      "code_state_provenance"
    );
    expect(provenance?.content).toContain("parent_run_id: run_parent");
    expect(provenance?.content).toContain("- src/new.ts");
    expect(provenance?.content).toContain("- src/remove.ts");
    expect(provenance?.metadata).toMatchObject({
      parentRunId: "run_parent",
      parentMessageId: "message_parent",
      sourceHead: "abc123",
      inheritedFileCount: 3
    });
  });

  it("rejects continuation from non-terminal or unretained parent runs", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");
    const runRoot = await createTestDirectory("agent-hub-runs");
    const taskRepository = new InMemoryTaskRepository();
    const taskRunRepository = new InMemoryTaskRunRepository();
    const runMetadataRepository = new InMemoryRunMetadataRepository();
    await taskRepository.create({
      id: "task_parent",
      projectId: "project_1",
      title: "Parent",
      status: "open",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    await taskRunRepository.create({
      id: "run_parent",
      taskId: "task_parent",
      agentKind: "fake",
      status: "running",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    const runner = new TaskRunner({
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector(),
      verificationRunner: new VerificationRunner(new MockShellExecutor()),
      taskRepository,
      taskRunRepository,
      runMetadataRepository
    });

    await expect(
      runner.run({
        projectRoot,
        projectId: "project_1",
        taskPrompt: "continue",
        agentKind: "fake",
        continueFrom: { parentRunId: "run_parent" }
      })
    ).rejects.toThrow("must be terminal");
  });

  it("rejects sensitive and symlink continuation files before creating a child run", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");
    const runRoot = await createTestDirectory("agent-hub-runs");
    const parentWorktree = await createTestDirectory("agent-hub-parent-worktree");
    const taskRepository = new InMemoryTaskRepository();
    const taskRunRepository = new InMemoryTaskRunRepository();
    const runMetadataRepository = new InMemoryRunMetadataRepository();
    await seedParentRun({
      projectRoot,
      parentWorktree,
      taskRepository,
      taskRunRepository,
      runMetadataRepository
    });
    const runner = new TaskRunner({
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new ContinuationDiffCollector(parentWorktree, [
        { path: ".env.local", status: "modified" },
        { path: "linked", status: "untracked", symlink: true }
      ]),
      shellExecutor: new MockShellExecutor([{ stdout: "abc123\n" }]),
      verificationRunner: new VerificationRunner(new MockShellExecutor()),
      taskRepository,
      taskRunRepository,
      runMetadataRepository
    });

    await expect(
      runner.run({
        projectRoot,
        projectId: "project_1",
        taskPrompt: "continue",
        agentKind: "fake",
        continueFrom: { parentRunId: "run_parent" }
      })
    ).rejects.toThrow("unsafe file paths changed");
    await expect(taskRunRepository.list()).resolves.toHaveLength(1);
  });

  it("rejects tracked symlink continuation files before creating a child run", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");
    const runRoot = await createTestDirectory("agent-hub-runs");
    const parentWorktree = await createTestDirectory("agent-hub-parent-worktree");
    const targetFile = path.join(parentWorktree, "target.txt");
    await fs.writeFile(targetFile, "target\n", "utf8");
    await fs.symlink(targetFile, path.join(parentWorktree, "linked.txt"));
    const taskRepository = new InMemoryTaskRepository();
    const taskRunRepository = new InMemoryTaskRunRepository();
    const runMetadataRepository = new InMemoryRunMetadataRepository();
    await seedParentRun({
      projectRoot,
      parentWorktree,
      taskRepository,
      taskRunRepository,
      runMetadataRepository
    });
    const runner = new TaskRunner({
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new ContinuationDiffCollector(parentWorktree, [
        { path: "linked.txt", status: "modified" }
      ]),
      shellExecutor: new MockShellExecutor([{ stdout: "abc123\n" }]),
      verificationRunner: new VerificationRunner(new MockShellExecutor()),
      taskRepository,
      taskRunRepository,
      runMetadataRepository
    });

    await expect(
      runner.run({
        projectRoot,
        projectId: "project_1",
        taskPrompt: "continue",
        agentKind: "fake",
        continueFrom: { parentRunId: "run_parent" }
      })
    ).rejects.toThrow("unsafe file paths changed");
    await expect(taskRunRepository.list()).resolves.toHaveLength(1);
  });

  it("runs verification commands with cwd set to the worktree", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");
    const runRoot = await createTestDirectory("agent-hub-runs");
    const shell = new MockShellExecutor([{ exitCode: 0, stdout: "ok\n" }]);
    const runner = new TaskRunner({
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector(),
      verificationRunner: new VerificationRunner(shell),
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock("2026-01-01T00:00:00.000Z")
    });

    const result = await runner.run({
      projectRoot,
      rawPrompt: "@fake verify cwd",
      verificationCommands: [{ id: "test", command: "pnpm", args: ["test"] }]
    });

    expect(result.status).toBe("succeeded");
    expect(shell.calls[0].options.cwd).toBe(result.worktreePath);
    expect(shell.calls[0].options.timeoutMs).toBe(
      DEFAULT_VERIFICATION_COMMAND_TIMEOUT_MS
    );
    expect(result.warnings).not.toContain(
      "No verification commands were configured; verification was skipped."
    );
  });

  it("cancels a run while verification is executing", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");
    const runRoot = await createTestDirectory("agent-hub-runs");
    const controller = new AbortController();
    const shell = new MockShellExecutor([
      (_command, options) => {
        expect(options.signal).toBe(controller.signal);
        controller.abort();
        return { exitCode: null, signal: "SIGTERM" };
      }
    ]);
    const runEventRepository = new InMemoryRunEventRepository();
    const runner = new TaskRunner({
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector(),
      verificationRunner: new VerificationRunner(shell),
      runEventRepository,
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock("2026-01-01T00:00:00.000Z")
    });

    const result = await runner.run({
      projectRoot,
      rawPrompt: "@fake verify cancellable",
      verificationCommands: [{ id: "test", command: "pnpm", args: ["test"] }],
      signal: controller.signal
    });

    expect(result.status).toBe("cancelled");
    expect(result.run.status).toBe("cancelled");
    expect(result.verification).toMatchObject({
      status: "skipped",
      results: [
        expect.objectContaining({
          status: "skipped",
          signal: "SIGTERM",
          skippedReason: "Run cancelled during verification."
        })
      ]
    });
    await expect(runEventRepository.listByRunId(result.run.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metadata: expect.objectContaining({ desktopEventType: "verification_started" })
        }),
        expect.objectContaining({
          metadata: expect.objectContaining({ desktopEventType: "run_cancelled" })
        })
      ])
    );
  });

  it("converts dangerous verification commands into an inspectable failed run", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");
    const runRoot = await createTestDirectory("agent-hub-runs");
    const runEventRepository = new InMemoryRunEventRepository();
    const runner = new TaskRunner({
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector(),
      verificationRunner: new VerificationRunner(new MockShellExecutor()),
      runEventRepository,
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock("2026-01-01T00:00:00.000Z")
    });

    const result = await runner.run({
      projectRoot,
      rawPrompt: "@fake reject dangerous verification",
      verificationCommands: [{ id: "danger", command: "sudo", args: ["true"] }]
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.verification?.failedCommands[0]).toMatchObject({
      commandId: "danger",
      stderr: expect.stringContaining("refusing to execute dangerous command")
    });
    await expect(runEventRepository.listByRunId(result.run.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "stdout" }),
        expect.objectContaining({ type: "exit" }),
        expect.objectContaining({
          metadata: expect.objectContaining({ desktopEventType: "verification_started" })
        }),
        expect.objectContaining({
          metadata: expect.objectContaining({ desktopEventType: "run_failed" })
        })
      ])
    );
  });

  it("finalizes a failed run when diff collection throws", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");
    const runRoot = await createTestDirectory("agent-hub-runs");
    const taskRepository = new InMemoryTaskRepository();
    const taskRunRepository = new InMemoryTaskRunRepository();
    const runEventRepository = new InMemoryRunEventRepository();
    const runner = new TaskRunner({
      taskRepository,
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new ThrowingDiffCollector("git exploded"),
      verificationRunner: new VerificationRunner(new MockShellExecutor()),
      taskRunRepository,
      runEventRepository,
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock("2026-01-01T00:00:00.000Z")
    });

    const result = await runner.run({
      projectRoot,
      rawPrompt: "@fake inspect failed finalization",
      workspaceCleanupPolicy: "always"
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.diff).toMatchObject({ ok: false, error: "git exploded" });
    expect(result.workspaceCleanup?.cleaned).toBe(true);
    expect(result.task.status).toBe("open");
    await expect(taskRepository.get(result.task.id)).resolves.toMatchObject({
      status: "open"
    });
    await expect(taskRunRepository.get(result.run.id)).resolves.toMatchObject({
      status: "failed",
      completedAt: "2026-01-01T00:00:00.000Z"
    });
    await expect(runEventRepository.listByRunId(result.run.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "error",
          message: "diff collection failed: git exploded"
        })
      ])
    );
  });

  it("does not read task brief artifacts from a failed symlink materialization path", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");
    const runRoot = await createTestDirectory("agent-hub-runs");
    const secretDirectory = await createTestDirectory("agent-hub-secret");
    const secretPath = path.join(secretDirectory, "secret.txt");
    await fs.writeFile(secretPath, "AGENTHUB_SYMLINK_SECRET\n", "utf8");
    const runArtifactRepository = new InMemoryRunArtifactRepository();
    const runEventRepository = new InMemoryRunEventRepository();
    const runner = new TaskRunner({
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot, {
        beforeRun: async (workspacePath) => {
          const maliciousBriefPath = path.join(
            workspacePath,
            ".agent-hub",
            "tasks",
            "task_0001",
            "brief.md"
          );
          await fs.mkdir(path.dirname(maliciousBriefPath), { recursive: true });
          await fs.symlink(secretPath, maliciousBriefPath);
        }
      }),
      diffCollector: new StaticDiffCollector(),
      verificationRunner: new VerificationRunner(new MockShellExecutor()),
      runArtifactRepository,
      runEventRepository,
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock("2026-01-01T00:00:00.000Z")
    });

    const result = await runner.run({
      projectRoot,
      rawPrompt: "@fake do not disclose symlink target"
    });

    expect(result.status).toBe("failed");
    expect(result.taskBriefPath).toBeUndefined();
    await expect(runEventRepository.listByRunId(result.run.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "error",
          message: expect.stringContaining("runtime context materialization failed")
        })
      ])
    );
    await expect(
      runArtifactRepository.getLatestByRunIdAndKind(result.run.id, "task_brief")
    ).resolves.toEqual(
      expect.objectContaining({
        content: expect.stringContaining("do not disclose symlink target")
      })
    );
    const taskBriefArtifact = await runArtifactRepository.getLatestByRunIdAndKind(
      result.run.id,
      "task_brief"
    );
    expect(taskBriefArtifact?.content).not.toContain("AGENTHUB_SYMLINK_SECRET");
  });

  it("returns a structured failed run when artifact persistence throws", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");
    const runRoot = await createTestDirectory("agent-hub-runs");
    const runEventRepository = new InMemoryRunEventRepository();
    const runner = new TaskRunner({
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot),
      diffCollector: new StaticDiffCollector(),
      verificationRunner: new VerificationRunner(new MockShellExecutor()),
      runArtifactRepository: new ThrowingRunArtifactRepository("artifact disk full"),
      runEventRepository,
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock("2026-01-01T00:00:00.000Z")
    });

    const result = await runner.run({
      projectRoot,
      rawPrompt: "@fake persist artifact failure"
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error).toBe("diff artifact persistence failed: artifact disk full");
    await expect(runEventRepository.listByRunId(result.run.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "error",
          message: "diff artifact persistence failed: artifact disk full"
        })
      ])
    );
  });

  it("returns a structured failed run when workspace cleanup throws", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");
    const runRoot = await createTestDirectory("agent-hub-runs");
    const runEventRepository = new InMemoryRunEventRepository();
    const runner = new TaskRunner({
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot, {
        cleanup: async () => {
          throw new Error("remove failed");
        }
      }),
      diffCollector: new StaticDiffCollector(),
      verificationRunner: new VerificationRunner(new MockShellExecutor()),
      runEventRepository,
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock("2026-01-01T00:00:00.000Z")
    });

    const result = await runner.run({
      projectRoot,
      rawPrompt: "@fake cleanup failure",
      workspaceCleanupPolicy: "always"
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.workspaceCleanup).toMatchObject({
      cleaned: false,
      retained: true,
      reason: "workspace cleanup failed: remove failed"
    });
    await expect(runEventRepository.listByRunId(result.run.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "error",
          message: "workspace cleanup failed: remove failed"
        })
      ])
    );
  });

  it("propagates worktree overlay warnings and generated file baselines", async () => {
    const projectRoot = await createTestDirectory("agent-hub-project");
    const runRoot = await createTestDirectory("agent-hub-runs");
    const agentHubHome = await createTestDirectory("agent-hub-context-home");
    const initialized = await initContextStore({
      projectRoot,
      projectId: "project_1",
      agentHubHome
    });
    await fs.mkdir(path.join(initialized.storeRoot, "skills", "review"), {
      recursive: true
    });
    await fs.writeFile(
      path.join(initialized.storeRoot, "skills", "review", "SKILL.md"),
      skillMarkdown({
        name: "review",
        description: "Review generated output.",
        body: "Generated skill."
      }),
      "utf8"
    );
    const diffCollector = new RecordingDiffCollector();
    const runner = new TaskRunner({
      defaultRunRoot: runRoot,
      workspaceManager: new TestWorkspaceManager(runRoot, {
        beforeRun: async (workspacePath) => {
          const conflictPath = path.join(
            workspacePath,
            ".claude",
            "skills",
            "review",
            "SKILL.md"
          );
          await fs.mkdir(path.dirname(conflictPath), { recursive: true });
          await fs.writeFile(conflictPath, "User skill.\n", "utf8");
        }
      }),
      diffCollector,
      verificationRunner: new VerificationRunner(new MockShellExecutor()),
      idGenerator: new SequenceIdGenerator(),
      clock: new FixedClock("2026-01-01T00:00:00.000Z")
    });

    const result = await runner.run({
      projectRoot,
      rawPrompt: "@fake overlay warning",
      deliveryMode: "worktree_overlay",
      contextStoreRoot: initialized.storeRoot
    });

    expect(result.warnings).toContain(
      ".claude/skills/review/SKILL.md already exists and was not overwritten"
    );
    expect(diffCollector.inputs[0].generatedFileBaselines?.map((entry) => entry.path))
      .toEqual(expect.arrayContaining([
        ".agent-hub/tasks/task_0001/brief.md",
        ".agent-hub/tasks/task_0001/context-pack.json",
        "AGENTS.md",
        "CLAUDE.md",
        ".agents/skills/review/SKILL.md"
      ]));
    expect(diffCollector.inputs[0].generatedFileBaselines?.map((entry) => entry.path))
      .not.toContain(".claude/skills/review/SKILL.md");
  });
});

async function seedParentRun(input: {
  projectRoot: string;
  parentWorktree: string;
  taskRepository: InMemoryTaskRepository;
  taskRunRepository: InMemoryTaskRunRepository;
  runMetadataRepository: InMemoryRunMetadataRepository;
}): Promise<void> {
  await input.taskRepository.create({
    id: "task_parent",
    projectId: "project_1",
    title: "Parent",
    status: "completed",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  });
  await input.taskRunRepository.create({
    id: "run_parent",
    taskId: "task_parent",
    agentKind: "fake",
    status: "succeeded",
    worktreePath: input.parentWorktree,
    branchName: "agent-hub/task_parent/fake",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  });
  await input.runMetadataRepository.save({
    runId: "run_parent",
    workspace: {
      path: input.parentWorktree,
      branchName: "agent-hub/task_parent/fake",
      sourceRepositoryPath: input.projectRoot,
      workspaceBasePath: path.dirname(input.parentWorktree),
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
}

function createTestRunner(runRoot: string): TaskRunner {
  return new TaskRunner({
    defaultRunRoot: runRoot,
    workspaceManager: new TestWorkspaceManager(runRoot),
    diffCollector: new StaticDiffCollector(),
    verificationRunner: new VerificationRunner(new MockShellExecutor()),
    idGenerator: new SequenceIdGenerator(),
    clock: new FixedClock("2026-01-01T00:00:00.000Z")
  });
}

interface TestWorkspaceManagerOptions {
  beforeRun?: (workspacePath: string) => Promise<void>;
  cleanup?: WorkspaceSession["cleanup"];
  baseFiles?: Record<string, string>;
}

class TestWorkspaceManager implements WorkspaceManager {
  constructor(
    private readonly runRoot: string,
    private readonly options: TestWorkspaceManagerOptions = {}
  ) {}

  async createSession(config: WorkspaceConfig): Promise<WorkspaceSession> {
    const workspacePath = path.join(
      this.runRoot,
      `${config.taskId}-${config.agentKind}-${config.runId}`
    );
    await fs.mkdir(workspacePath, { recursive: true });
    for (const [relativePath, content] of Object.entries(this.options.baseFiles ?? {})) {
      const filePath = path.join(workspacePath, relativePath);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, "utf8");
    }
    await this.options.beforeRun?.(workspacePath);
    return {
      workspace: {
        path: workspacePath,
        branchName: config.branchName ?? `agent-hub/${config.taskId}/${config.agentKind}`,
        sourceRepositoryPath: config.sourceRepositoryPath,
        workspaceBasePath: this.runRoot,
        taskId: config.taskId,
        runId: config.runId,
        agentKind: config.agentKind,
        startPoint: config.startPoint,
        dryRun: config.dryRun ?? false,
        sourceRepositoryDirty: false,
        cleanupPolicy: config.cleanupPolicy ?? "never"
      },
      creationCommands: [],
      cleanup: this.options.cleanup ?? (async ({ successful }) => {
        if (config.cleanupPolicy === "retain_on_failure" && !successful) {
          return {
            cleaned: false,
            retained: true,
            reason: "test retain on failure",
            commands: []
          };
        }
        return {
          cleaned: true,
          retained: false,
          reason: "test cleanup",
          commands: []
        };
      })
    };
  }
}

class StaticDiffCollector implements DiffCollectorService {
  async collect(input: { workspacePath: string }): Promise<DiffCollectionResult> {
    return {
      ok: true,
      workspacePath: input.workspacePath,
      isClean: false,
      changedFiles: [{ path: "fake-agent-output.md", status: "untracked" }],
      stat: {
        filesChanged: 1,
        insertions: 1,
        deletions: 0,
        text: "1 file changed, 1 insertion(+)"
      },
      diff: "",
      fileSummaries: ["fake-agent-output.md: untracked"],
      commands: []
    };
  }
}

class ContinuationDiffCollector extends StaticDiffCollector {
  constructor(
    private readonly parentWorktree: string,
    private readonly parentChangedFiles: ChangedFile[]
  ) {
    super();
  }

  async collect(input: DiffCollectionInput): Promise<DiffCollectionResult> {
    if (path.resolve(input.workspacePath) !== path.resolve(this.parentWorktree)) {
      return super.collect(input);
    }
    return {
      ok: true,
      workspacePath: input.workspacePath,
      isClean: this.parentChangedFiles.length === 0,
      changedFiles: this.parentChangedFiles,
      stat: {
        filesChanged: this.parentChangedFiles.length,
        insertions: this.parentChangedFiles.length,
        deletions: 0,
        text: `${this.parentChangedFiles.length} files changed`
      },
      diff: "",
      fileSummaries: this.parentChangedFiles.map(
        (file) => `${file.path}: ${file.status}`
      ),
      commands: []
    };
  }
}

class RecordingDiffCollector extends StaticDiffCollector {
  readonly inputs: DiffCollectionInput[] = [];

  async collect(input: DiffCollectionInput): Promise<DiffCollectionResult> {
    this.inputs.push(input);
    return super.collect(input);
  }
}

class ThrowingDiffCollector implements DiffCollectorService {
  constructor(private readonly message: string) {}

  async collect(): Promise<DiffCollectionResult> {
    throw new Error(this.message);
  }
}

class AbortableMockProcessRunner implements ProcessRunner {
  readonly runCalls: ProcessRunInput[] = [];
  readonly detectCalls: ProcessDetectionInput[] = [];

  constructor(private readonly controller: AbortController) {}

  async *run(input: ProcessRunInput): AsyncIterable<ProcessRunEvent> {
    this.runCalls.push(input);
    yield { type: "stdout", data: "started\n" };
    this.controller.abort();
    yield { type: "exit", exitCode: null, signal: "SIGTERM" };
  }

  async detect(input: ProcessDetectionInput): Promise<ProcessDetectionResult> {
    this.detectCalls.push(input);
    return { available: true, version: "mock" };
  }
}

class ThrowingRunArtifactRepository extends InMemoryRunArtifactRepository {
  constructor(private readonly message: string) {
    super();
  }

  async create(): Promise<never> {
    throw new Error(this.message);
  }
}
