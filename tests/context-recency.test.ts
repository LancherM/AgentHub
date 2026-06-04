import { describe, expect, it } from "vitest";
import {
  collectRecentRunEvidence,
  collectThreadSummaryContext,
  createContextPlan,
  ExplicitContextRetriever
} from "@agent-hub/task-runner";
import {
  InMemoryConversationThreadSummaryRepository,
  InMemoryRiskReportRepository,
  InMemoryRunArtifactRepository,
  InMemoryTaskRepository,
  InMemoryTaskRunRepository,
  InMemoryVerificationResultRepository,
  validateConversationThreadSummary,
  validateRiskReport,
  validateRunArtifact,
  validateTask,
  validateTaskRun,
  validateVerificationResult,
  type ContextBundle,
  type ContextSection,
  type Task
} from "@agent-hub/core";

const createdAt = "2026-01-01T00:00:00.000Z";
const completedAt = "2026-01-01T00:00:01.000Z";

describe("context recency retrieval", () => {
  it("collects bounded recent run evidence without raw logs, diffs, verification bodies, or risk bodies", async () => {
    const repositories = await recentRunRepositories();
    const sources = await collectRecentRunEvidence({
      projectId: "project_recency",
      ...repositories,
      limit: 2
    });

    expect(sources).toEqual([
      expect.objectContaining({
        runId: "run_recent",
        taskTitle: "Fix parser",
        status: "succeeded",
        changedFiles: ["src/parser.ts"],
        verificationSummary: "0 passed, 1 failed, 0 skipped; failed commands: pnpm test",
        riskSummary: "medium: Parser behavior changed."
      })
    ]);
    const serialized = JSON.stringify(sources);
    expect(serialized).not.toContain("RAW_DIFF_BODY");
    expect(serialized).not.toContain("RAW_STDOUT_BODY");
    expect(serialized).not.toContain("RAW_STDERR_BODY");
    expect(serialized).not.toContain("RAW_RISK_FINDING_DETAIL");
  });

  it("builds medium-trust run recency candidates and low-trust thread summary candidates", async () => {
    const repositories = await recentRunRepositories();
    const recentRunEvidence = await collectRecentRunEvidence({
      projectId: "project_recency",
      ...repositories,
      limit: 1
    });
    const threadSummaries = new InMemoryConversationThreadSummaryRepository();
    const summary = await threadSummaries.upsert(
      validateConversationThreadSummary({
        id: "summary_1",
        threadId: "thread_1",
        summary: "Keep context retrieval local.",
        decisions: ["Do not index raw transcripts"],
        openItems: ["Wire runtime selection later"],
        constraints: ["Conversation cannot override project facts"],
        lastKnownUserGoal: "Continue CR4",
        sourceMessageCount: 4,
        sourceLatestMessageId: "message_4",
        createdAt,
        updatedAt: completedAt
      })
    );
    await expect(
      collectThreadSummaryContext({
        threadId: "thread_1",
        includeThreadSummary: false,
        disabledReason: "role policy disabled thread context",
        conversationThreadSummaryRepository: threadSummaries
      })
    ).resolves.toEqual({
      diagnostics: [
        {
          severity: "info",
          message: "role policy disabled thread context"
        }
      ]
    });

    const retriever = new ExplicitContextRetriever();
    const task = testTask();
    const result = await retriever.retrieve({
      id: "context_retrieval_recency",
      plan: createContextPlan({
        id: "context_plan_recency",
        taskPrompt: "Continue parser follow-up",
        createdAt
      }),
      task,
      runId: "run_current",
      taskPrompt: "Continue parser follow-up",
      contextBundle: contextBundle(),
      recentRunEvidence,
      threadSummary: summary,
      createdAt
    });

    expect(
      result.candidates.find((candidate) => candidate.item.layer === "run_evidence")
    ).toMatchObject({
      routes: ["recency"],
      item: {
        sourceKind: "recent_run_summary",
        trustLevel: "medium",
        content: expect.stringContaining("changed_files:")
      }
    });
    expect(
      result.candidates.find((candidate) => candidate.item.layer === "conversation")
    ).toMatchObject({
      routes: ["recency"],
      item: {
        sourceKind: "thread_summary",
        trustLevel: "low",
        content: expect.stringContaining("may_override_current_task: false")
      }
    });
    expect(JSON.stringify(result.candidates)).not.toContain("RAW_DIFF_BODY");
  });
});

async function recentRunRepositories() {
  const taskRepository = new InMemoryTaskRepository();
  const taskRunRepository = new InMemoryTaskRunRepository();
  const runArtifactRepository = new InMemoryRunArtifactRepository();
  const verificationResultRepository = new InMemoryVerificationResultRepository();
  const riskReportRepository = new InMemoryRiskReportRepository();

  await taskRepository.create(
    validateTask({
      id: "task_recent",
      projectId: "project_recency",
      title: "Fix parser",
      status: "completed",
      createdAt,
      updatedAt: completedAt
    })
  );
  await taskRunRepository.create(
    validateTaskRun({
      id: "run_recent",
      taskId: "task_recent",
      agentKind: "fake",
      status: "succeeded",
      completedAt,
      createdAt,
      updatedAt: completedAt
    })
  );
  await runArtifactRepository.create(
    validateRunArtifact({
      id: "artifact_diff",
      taskRunId: "run_recent",
      kind: "git_diff",
      content: "RAW_DIFF_BODY",
      metadata: {
        changedFiles: [{ path: "src/parser.ts", status: "modified" }],
        stat: { filesChanged: 1, insertions: 3, deletions: 1 }
      },
      createdAt
    })
  );
  await verificationResultRepository.create(
    validateVerificationResult({
      id: "verification_failed",
      taskRunId: "run_recent",
      command: "pnpm test",
      status: "failed",
      exitCode: 1,
      stdout: "RAW_STDOUT_BODY",
      stderr: "RAW_STDERR_BODY",
      createdAt
    })
  );
  await riskReportRepository.create(
    validateRiskReport({
      id: "risk_recent",
      taskRunId: "run_recent",
      level: "medium",
      summary: "Parser behavior changed.",
      changedFiles: ["src/parser.ts"],
      verificationSummary: "1 failed",
      failedChecks: ["pnpm test"],
      riskFactors: ["Parser regression risk"],
      manualReviewChecklist: ["Review parser behavior"],
      acceptanceRecommendation: "Review before accept.",
      findings: [
        {
          level: "medium",
          summary: "Parser risk",
          details: "RAW_RISK_FINDING_DETAIL"
        }
      ],
      createdAt
    })
  );

  return {
    taskRepository,
    taskRunRepository,
    runArtifactRepository,
    verificationResultRepository,
    riskReportRepository
  };
}

function testTask(): Task {
  return {
    id: "task_current",
    projectId: "project_recency",
    title: "Continue parser follow-up",
    description: "Continue parser follow-up",
    status: "open",
    createdAt,
    updatedAt: createdAt
  };
}

function contextBundle(): ContextBundle {
  return {
    id: "context_bundle_recency",
    taskPrompt: "Continue parser follow-up",
    selectedAgentId: "fake",
    targetRepository: {
      id: "project_recency",
      name: "Project Recency",
      rootPath: "/tmp/project-recency"
    },
    sections: [
      section("task:task", "task", "task", "Current Task", "Continue parser follow-up")
    ],
    warnings: []
  };
}

function section(
  id: string,
  kind: ContextSection["source"]["kind"],
  sourceId: string,
  title: string,
  body: string
): ContextSection {
  return {
    id,
    title,
    body,
    source: {
      kind,
      id: sourceId,
      label: title
    },
    order: 1
  };
}
