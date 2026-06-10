import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DomainValidationError,
  DomainStateTransitionError,
  availableAgentKinds,
  compressionModes,
  contextLayers,
  contextPolicyDecisions,
  defaultAgentKind,
  InMemoryConversationMessageRepository,
  InMemoryConversationThreadSummaryRepository,
  InMemoryConversationThreadRepository,
  InMemorySettingsRepository,
  InMemoryTaskRunRepository,
  createDefaultMemoryAutomationPolicy,
  nowIso,
  isAgentKindEnabled,
  parseMemoryAutomationPolicySettingValue,
  parseAgentKind,
  presetWorkgroupRoles,
  validateAgentProfile,
  validateComparisonReport,
  validateContextCandidate,
  validateContextEvalEvent,
  validateContextIndexEntry,
  validateContextItem,
  validateContextPack,
  validateContextPlan,
  validateContextRetrievalResult,
  validateConversationMessage,
  validateConversationThread,
  validateConversationThreadSummary,
  validateMemoryItem,
  validateMemoryAutomationDecision,
  validateMemoryAutomationEvaluation,
  validateMemoryAutomationPolicy,
  validateRiskReport,
  validateRunArtifact,
  validateRunEvent,
  validateRuntimeContextPack,
  validateMemoryStatusTransition,
  validateProject,
  validateSetting,
  validateSkill,
  validateTask,
  validateTaskBrief,
  validateTaskRun,
  validateTaskRunStatusTransition,
  validateTaskStatusTransition,
  validateVerificationResult,
  validateWorkgroupRole
} from "@agent-hub/core";

const createdAt = "2026-01-01T00:00:00.000Z";
const updatedAt = "2026-01-01T00:00:01.000Z";

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
        metadata: {
          threadId: "thread_1",
          assignments: [{ roleHandle: "researcher" }]
        },
        status: "open",
        createdAt: now,
        updatedAt: now
      })
    ).toMatchObject({
      status: "open",
      metadata: {
        threadId: "thread_1"
      }
    });
    expect(
      validateTaskRun({
        id: "run_child",
        taskId: "task_1",
        agentKind: "fake",
        status: "queued",
        parentRunId: "run_parent",
        parentMessageId: "message_parent",
        createdAt: now,
        updatedAt: now
      })
    ).toMatchObject({
      parentRunId: "run_parent",
      parentMessageId: "message_parent"
    });

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

  it("validates preset and custom workgroup role contracts", () => {
    const researcher = presetWorkgroupRoles.find(
      (role) => role.handle === "researcher"
    );
    if (!researcher) {
      throw new Error("missing researcher preset");
    }

    expect(validateWorkgroupRole(researcher)).toBe(researcher);
    expect(
      validateWorkgroupRole({
        ...researcher,
        id: "role_custom_customer",
        handle: "customer",
        displayName: "Customer",
        executor: {
          kind: "human",
          configRef: "local-human-reviewer",
          unavailableReason: "Human assignment runtime is reserved."
        }
      })
    ).toMatchObject({
      handle: "customer",
      executor: { kind: "human" }
    });

    expect(() =>
      validateWorkgroupRole({
        ...researcher,
        handle: "@Bad"
      })
    ).toThrow(DomainValidationError);
  });

  it("keeps run event types locked to the persisted MVP model", () => {
    expect(
      validateRunEvent({
        id: "event_1",
        taskRunId: "run_1",
        sequence: 0,
        type: "status",
        message: "Tool call summarized as status metadata.",
        metadata: {
          adapterEvent: {
            type: "tool_call",
            name: "read_file"
          }
        },
        createdAt
      }).type
    ).toBe("status");

    expect(() =>
      validateRunEvent({
        id: "event_bad",
        taskRunId: "run_1",
        sequence: 0,
        type: "tool_call" as never,
        message: "First-class tool-call events are not in the MVP event model.",
        metadata: {},
        createdAt
      })
    ).toThrow(DomainValidationError);
  });

  it("validates typed runtime context contracts", () => {
    expect(
      validateContextItem({
        id: "context_item_task",
        layer: "task",
        sourceKind: "task",
        sourceId: "task_1",
        scope: "task",
        trustLevel: "system",
        lifetime: "run",
        title: "Task",
        content: "Fix the failing test.",
        contentHash: "sha256:task",
        createdAt,
        metadata: {}
      })
    ).toMatchObject({ layer: "task", trustLevel: "system" });

    expect(
      validateContextIndexEntry({
        id: "context_index_project",
        projectId: "project_1",
        layer: "project",
        sourceKind: "project_context",
        sourceId: "context/project.md",
        scope: "project",
        trustLevel: "high",
        lifetime: "static",
        title: "Project Context",
        content: "Project facts.",
        contentHash: "sha256:project",
        sourcePath: "/tmp/context/project.md",
        createdAt,
        indexedAt: createdAt,
        metadata: {}
      })
    ).toMatchObject({
      sourceKind: "project_context",
      indexedAt: createdAt
    });

    expect(
      validateContextEvalEvent({
        id: "context_eval_1",
        projectId: "project_1",
        taskId: "task_1",
        runId: "run_1",
        planId: "context_plan_1",
        kind: "run_outcome",
        severity: "info",
        message: "Run succeeded with selected context.",
        selectedItemIds: ["task:task"],
        omittedItemIds: [],
        metadata: { status: "succeeded" },
        createdAt
      })
    ).toMatchObject({
      kind: "run_outcome",
      selectedItemIds: ["task:task"]
    });

    expect(
      validateContextPlan({
        id: "context_plan_1",
        taskType: "bug_fix",
        taskPromptHash: "sha256:prompt",
        requiredLayers: ["runtime_policy", "task", "project"],
        retrievalRoutes: ["explicit", "task_rule"],
        trustPolicy: Object.fromEntries(
          contextLayers.map((layer) => [layer, "allow"])
        ) as Record<(typeof contextLayers)[number], (typeof contextPolicyDecisions)[number]>,
        budgetPolicy: Object.fromEntries(
          contextLayers.map((layer) => [layer, layer === "conversation" ? 5 : 10])
        ) as Record<(typeof contextLayers)[number], number>,
        compressionPolicy: Object.fromEntries(
          contextLayers.map((layer) => [layer, "none"])
        ) as Record<(typeof contextLayers)[number], (typeof compressionModes)[number]>,
        createdAt,
        diagnostics: {}
      })
    ).toMatchObject({ taskType: "bug_fix" });

    expect(
      validateContextCandidate({
        item: {
          id: "context_item_skill",
          layer: "skill",
          sourceKind: "selected_skill",
          sourceId: "project:review",
          scope: "task",
          trustLevel: "medium",
          lifetime: "session",
          title: "Skill: Review",
          content: "Review changed files.",
          contentHash: "sha256:skill",
          createdAt,
          metadata: {}
        },
        routes: ["explicit"],
        relevanceScore: 0.9,
        freshnessScore: 0.8,
        trustScore: 0.65,
        scopeMatchScore: 1,
        inclusionReason: "skill was explicitly selected",
        diagnostics: {
          sourceItemId: "context_item_skill"
        }
      })
    ).toMatchObject({
      routes: ["explicit"],
      item: { layer: "skill" }
    });

    expect(
      validateContextRetrievalResult({
        id: "context_retrieval_1",
        planId: "context_plan_1",
        taskId: "task_1",
        runId: "run_1",
        candidates: [
          {
            item: {
              id: "context_item_task",
              layer: "task",
              sourceKind: "task",
              sourceId: "task_1",
              scope: "task",
              trustLevel: "system",
              lifetime: "run",
              title: "Task",
              content: "Fix the failing test.",
              contentHash: "sha256:task",
              createdAt,
              metadata: {}
            },
            routes: ["explicit"],
            relevanceScore: 1,
            freshnessScore: 1,
            trustScore: 1,
            scopeMatchScore: 1,
            inclusionReason: "current task is pinned",
            diagnostics: {}
          }
        ],
        omitted: [],
        diagnostics: [
          {
            severity: "info",
            message: "explicit retrieval completed"
          }
        ],
        createdAt
      })
    ).toMatchObject({
      candidates: [expect.objectContaining({ routes: ["explicit"] })]
    });

    expect(
      validateRuntimeContextPack({
        id: "runtime_context_pack_1",
        planId: "context_plan_1",
        taskId: "task_1",
        runId: "run_1",
        sections: [
          {
            id: "task:task",
            layer: "task",
            trustLevel: "system",
            title: "Task Prompt",
            content: "Fix the failing test.",
            sourceItemIds: ["task:task"],
            sourceHashes: ["sha256:task"],
            compressionMode: "none",
            originalCharacterCount: 21,
            renderedCharacterCount: 21,
            omittedItemCount: 0,
            inclusionReason: "current task is pinned"
          }
        ],
        omitted: [],
        diagnostics: [
          {
            severity: "info",
            message: "runtime context pack generated"
          }
        ],
        createdAt
      })
    ).toMatchObject({
      sections: [expect.objectContaining({ layer: "task" })]
    });

    expect(() =>
      validateContextCandidate({
        item: {
          id: "conversation:thread",
          layer: "conversation",
          sourceKind: "thread_summary",
          sourceId: "thread",
          scope: "thread",
          trustLevel: "high",
          lifetime: "thread",
          title: "Conversation",
          content: "Prior chat",
          contentHash: "sha256:conversation",
          createdAt,
          metadata: {}
        },
        routes: ["explicit"],
        relevanceScore: 0.5,
        freshnessScore: 0.8,
        trustScore: 0.9,
        scopeMatchScore: 0.8,
        inclusionReason: "invalid high-trust conversation",
        diagnostics: {}
      })
    ).toThrow(DomainValidationError);

    expect(() =>
      validateRuntimeContextPack({
        id: "runtime_context_pack_bad",
        planId: "context_plan_1",
        taskId: "task_1",
        sections: [
          {
            id: "conversation:thread",
            layer: "conversation",
            trustLevel: "high",
            title: "Conversation",
            content: "Prior chat",
            sourceItemIds: ["conversation:thread"],
            sourceHashes: ["sha256:conversation"],
            compressionMode: "summary",
            originalCharacterCount: -1,
            renderedCharacterCount: 10,
            omittedItemCount: 0,
            inclusionReason: "prior thread continuity"
          }
        ],
        omitted: [],
        diagnostics: [],
        createdAt
      })
    ).toThrow(DomainValidationError);
  });

  it("validates conversation threads and messages", () => {
    expect(
      validateConversationThread({
        id: "thread_1",
        projectId: "project_1",
        title: "Persist a thread",
        metadata: { source: "desktop" },
        createdAt,
        updatedAt
      })
    ).toMatchObject({
      id: "thread_1",
      projectId: "project_1",
      title: "Persist a thread"
    });

    expect(
      validateConversationMessage({
        id: "message_1",
        threadId: "thread_1",
        sequence: 0,
        role: "tool",
        kind: "run_card",
        content: "Fake run queued.",
        agentKind: "fake",
        runId: "run_1",
        status: "queued",
        metadata: { selected: true },
        createdAt
      })
    ).toMatchObject({
      id: "message_1",
      role: "tool",
      kind: "run_card",
      runId: "run_1"
    });

    expect(() =>
      validateConversationMessage({
        id: "message_bad",
        threadId: "thread_1",
        sequence: -1,
        role: "narrator" as never,
        kind: "text",
        content: "Invalid",
        createdAt
      })
    ).toThrow(DomainValidationError);
  });

  it("orders conversation messages and rejects duplicate thread sequences in memory", async () => {
    const threads = new InMemoryConversationThreadRepository();
    const messages = new InMemoryConversationMessageRepository();
    await threads.create({
      id: "thread_memory",
      projectId: "project_1",
      title: "Memory thread",
      createdAt,
      updatedAt
    });

    await messages.create({
      id: "message_second",
      threadId: "thread_memory",
      sequence: 1,
      role: "assistant",
      kind: "text",
      content: "Second",
      createdAt: updatedAt
    });
    await messages.create({
      id: "message_first",
      threadId: "thread_memory",
      sequence: 0,
      role: "user",
      kind: "text",
      content: "First",
      createdAt
    });

    await expect(messages.listByThreadId("thread_memory")).resolves.toEqual([
      expect.objectContaining({ id: "message_first", sequence: 0 }),
      expect.objectContaining({ id: "message_second", sequence: 1 })
    ]);
    await expect(messages.countByThreadId("thread_memory")).resolves.toBe(2);
    await expect(
      messages.update({
        id: "message_second",
        threadId: "thread_memory",
        sequence: 1,
        role: "assistant",
        kind: "text",
        content: "Second updated",
        status: "succeeded",
        createdAt: updatedAt
      })
    ).resolves.toMatchObject({
      id: "message_second",
      content: "Second updated",
      status: "succeeded"
    });
    await expect(
      messages.create({
        id: "message_duplicate_sequence",
        threadId: "thread_memory",
        sequence: 1,
        role: "system",
        kind: "text",
        content: "Duplicate",
        createdAt
      })
    ).rejects.toThrow("sequence 1 already exists");
    await expect(
      messages.update({
        id: "message_second",
        threadId: "thread_memory",
        sequence: 0,
        role: "assistant",
        kind: "text",
        content: "Duplicate update",
        createdAt: updatedAt
      })
    ).rejects.toThrow("sequence 0 already exists");
  });

  it("validates and upserts thread-local summaries in memory", async () => {
    expect(
      validateConversationThreadSummary({
        id: "summary_1",
        threadId: "thread_memory",
        summary: "Last goal: keep the renderer sandboxed.",
        decisions: ["Use runtime injection"],
        openItems: ["Wire desktop refresh"],
        constraints: ["Do not promote to approved memory"],
        lastKnownUserGoal: "Continue Phase 6",
        sourceMessageCount: 3,
        sourceLatestMessageId: "message_3",
        metadata: { source: "test" },
        createdAt,
        updatedAt
      })
    ).toMatchObject({
      id: "summary_1",
      threadId: "thread_memory",
      sourceMessageCount: 3
    });

    expect(() =>
      validateConversationThreadSummary({
        id: "summary_bad",
        threadId: "thread_memory",
        summary: "Invalid",
        decisions: ["ok"],
        openItems: ["ok"],
        constraints: [1] as never,
        sourceMessageCount: -1,
        createdAt,
        updatedAt
      })
    ).toThrow(DomainValidationError);

    const summaries = new InMemoryConversationThreadSummaryRepository();
    await summaries.upsert({
      id: "summary_1",
      threadId: "thread_memory",
      summary: "Initial",
      decisions: [],
      openItems: [],
      constraints: [],
      sourceMessageCount: 1,
      createdAt,
      updatedAt: createdAt
    });
    await summaries.upsert({
      id: "summary_2",
      threadId: "thread_memory",
      summary: "Updated",
      decisions: ["Keep it local"],
      openItems: [],
      constraints: [],
      sourceMessageCount: 2,
      createdAt,
      updatedAt
    });

    await expect(summaries.getByThreadId("thread_memory")).resolves.toMatchObject({
      id: "summary_2",
      summary: "Updated",
      decisions: ["Keep it local"],
      sourceMessageCount: 2
    });
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
        metadata: {
          sourceRunId: "run_1",
          generatedBy: "task_runner"
        },
        createdAt: now,
        updatedAt: now
      })
    ).toMatchObject({
      status: "proposed",
      metadata: {
        sourceRunId: "run_1"
      }
    });
    expect(
      validateMemoryItem({
        id: "memory_retired",
        projectId: "project_1",
        category: "workflow_rule",
        status: "retired",
        content: "Retired memory is retained for audit only.",
        createdAt: now,
        updatedAt: now
      })
    ).toMatchObject({ status: "retired" });

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
    expect(() =>
      validateMemoryItem({
        id: "memory_3",
        projectId: "project_1",
        category: "workflow_rule",
        status: "approved",
        content: "Invalid metadata",
        metadata: ["not", "an", "object"] as never,
        createdAt: now,
        updatedAt: now
      })
    ).toThrow("memoryItem.metadata must be an object");
  });

  it("validates memory automation policy and evaluation contracts", () => {
    const now = nowIso();
    expect(createDefaultMemoryAutomationPolicy()).toEqual({
      mode: "suggest_only",
      maxRiskLevel: "low",
      allowSkippedVerification: false,
      allowedCategories: ["workflow_rule"],
      maxAutoApprovalsPerRun: 2
    });

    expect(
      parseMemoryAutomationPolicySettingValue({
        mode: "auto_after_review_accept",
        maxRiskLevel: "medium",
        allowSkippedVerification: true,
        allowedCategories: ["workflow_rule", "project_fact"],
        maxAutoApprovalsPerRun: 1
      })
    ).toEqual({
      mode: "auto_after_review_accept",
      maxRiskLevel: "medium",
      allowSkippedVerification: true,
      allowedCategories: ["workflow_rule", "project_fact"],
      maxAutoApprovalsPerRun: 1
    });

    expect(parseMemoryAutomationPolicySettingValue({})).toEqual(
      createDefaultMemoryAutomationPolicy()
    );

    expect(() =>
      parseMemoryAutomationPolicySettingValue({
        mode: "automatic",
        maxRiskLevel: "low",
        allowSkippedVerification: false,
        allowedCategories: ["workflow_rule"],
        maxAutoApprovalsPerRun: 2
      })
    ).toThrow("memoryAutomationPolicy.mode must be one of");
    expect(() =>
      parseMemoryAutomationPolicySettingValue({
        mode: "suggest_only",
        maxRiskLevel: "low",
        allowSkippedVerification: false,
        allowedCategories: ["workflow_rule", "workflow_rule"],
        maxAutoApprovalsPerRun: 2
      })
    ).toThrow("memoryAutomationPolicy.allowedCategories must not contain duplicate category workflow_rule");
    expect(() =>
      parseMemoryAutomationPolicySettingValue({
        mode: "suggest_only",
        maxRiskLevel: "low",
        allowSkippedVerification: false,
        allowedCategories: ["workflow_rule"],
        maxAutoApprovalsPerRun: 11
      })
    ).toThrow("memoryAutomationPolicy.maxAutoApprovalsPerRun must be 10 or less");
    expect(() =>
      parseMemoryAutomationPolicySettingValue({
        mode: "suggest_only",
        unknown: true
      })
    ).toThrow("memoryAutomationPolicy contains unsupported field unknown");

    expect(
      validateMemoryAutomationPolicy({
        mode: "auto_safe_on_success",
        maxRiskLevel: "low",
        allowSkippedVerification: false,
        allowedCategories: ["workflow_rule"],
        maxAutoApprovalsPerRun: 1
      })
    ).toMatchObject({ mode: "auto_safe_on_success" });
    expect(
      validateMemoryAutomationDecision({
        memoryId: "memory_1",
        status: "eligible",
        reasonCodes: ["within_policy"]
      })
    ).toMatchObject({ status: "eligible" });
    expect(
      validateMemoryAutomationEvaluation({
        runId: "run_1",
        policy: createDefaultMemoryAutomationPolicy(),
        decisions: [
          {
            memoryId: "memory_1",
            status: "blocked",
            reasonCodes: ["policy_disabled"]
          }
        ],
        createdAt: now
      })
    ).toMatchObject({ runId: "run_1" });
  });

  it("validates local evidence, agent, skill, and context models", () => {
    expect(
      validateAgentProfile({
        id: "agent_profile_1",
        kind: "codex",
        displayName: "Codex",
        enabled: true,
        createdAt,
        updatedAt
      })
    ).toMatchObject({ id: "agent_profile_1", kind: "codex" });
    expect(() =>
      validateAgentProfile({
        id: "agent_profile_bad",
        kind: "remote" as never,
        displayName: "Remote",
        enabled: true,
        createdAt,
        updatedAt
      })
    ).toThrow(DomainValidationError);

    expect(
      validateRunArtifact({
        id: "artifact_1",
        taskRunId: "run_1",
        kind: "git_diff",
        content: "diff text",
        metadata: { changedFiles: [] },
        createdAt
      })
    ).toMatchObject({ kind: "git_diff" });
    expect(() =>
      validateRunArtifact({
        id: "artifact_bad",
        taskRunId: "run_1",
        kind: "git_diff",
        content: "diff text",
        metadata: [] as never,
        createdAt
      })
    ).toThrow(DomainValidationError);

    expect(
      validateVerificationResult({
        id: "verification_1",
        taskRunId: "run_1",
        command: "pnpm test",
        status: "passed",
        exitCode: 0,
        createdAt
      })
    ).toMatchObject({ status: "passed" });
    expect(() =>
      validateVerificationResult({
        id: "verification_bad",
        taskRunId: "run_1",
        command: "pnpm test",
        status: "unknown" as never,
        createdAt
      })
    ).toThrow(DomainValidationError);

    expect(
      validateComparisonReport({
        id: "comparison_1",
        taskId: "task_1",
        baselineRunId: "run_a",
        candidateRunId: "run_b",
        summary: "Candidate has lower risk.",
        details: { score: { candidate: 90 } },
        createdAt
      })
    ).toMatchObject({ taskId: "task_1" });
    expect(() =>
      validateComparisonReport({
        id: "comparison_bad",
        taskId: "task_1",
        summary: "Invalid details.",
        details: [] as never,
        createdAt
      })
    ).toThrow(DomainValidationError);

    expect(
      validateRiskReport({
        id: "risk_1",
        taskRunId: "run_1",
        level: "medium",
        summary: "Review generated code.",
        changedFiles: ["src/index.ts"],
        verificationSummary: "1 passed",
        failedChecks: [],
        riskFactors: ["source changed"],
        manualReviewChecklist: ["Review src/index.ts"],
        acceptanceRecommendation: "Review before applying.",
        findings: [{ level: "medium", summary: "Source changed." }],
        createdAt
      })
    ).toMatchObject({ level: "medium" });
    expect(() =>
      validateRiskReport({
        id: "risk_bad",
        taskRunId: "run_1",
        level: "medium",
        summary: "Invalid findings.",
        changedFiles: ["src/index.ts"],
        verificationSummary: "1 passed",
        failedChecks: [],
        riskFactors: [],
        manualReviewChecklist: [],
        acceptanceRecommendation: "Review before applying.",
        findings: {} as never,
        createdAt
      })
    ).toThrow(DomainValidationError);

    expect(
      validateSkill({
        id: "skill_1",
        projectId: "project_1",
        name: "review",
        description: "Review generated output.",
        path: "/tmp/review/SKILL.md",
        createdAt,
        updatedAt
      })
    ).toMatchObject({ name: "review" });
    expect(() =>
      validateSkill({
        id: "skill_bad",
        name: "review",
        description: "",
        path: "/tmp/review/SKILL.md",
        createdAt,
        updatedAt
      })
    ).toThrow(DomainValidationError);

    expect(
      validateContextPack({
        id: "context_pack_1",
        projectId: "project_1",
        taskId: "task_1",
        taskTitle: "Run task",
        taskPrompt: "Do the work.",
        deliveryMode: "runtime_injection",
        contextSections: ["Project context."],
        approvedMemorySections: [],
        skillReferences: ["review"],
        createdAt
      })
    ).toMatchObject({ deliveryMode: "runtime_injection" });
    expect(() =>
      validateContextPack({
        id: "context_pack_bad",
        projectId: "project_1",
        taskId: "task_1",
        deliveryMode: "repo_export" as never,
        contextSections: "Project context." as never,
        approvedMemorySections: [],
        skillReferences: [],
        createdAt
      })
    ).toThrow(DomainValidationError);

    expect(
      validateTaskBrief({
        taskId: "task_1",
        taskTitle: "Run task",
        taskPrompt: "Do the work.",
        renderedContent: "# Brief\n",
        contextPackId: "context_pack_1",
        createdAt
      })
    ).toMatchObject({ contextPackId: "context_pack_1" });
    expect(() =>
      validateTaskBrief({
        taskId: "task_1",
        taskTitle: "Run task",
        renderedContent: "",
        contextPackId: "context_pack_1",
        createdAt
      })
    ).toThrow(DomainValidationError);
  });

  it("rejects secret-like local settings at the domain boundary", async () => {
    const safeSetting = {
      key: "ui.theme",
      value: { theme: "system", compact: true },
      updatedAt
    };
    expect(validateSetting(safeSetting)).toBe(safeSetting);

    for (const key of [
      "api_key",
      "openaiApiKey",
      "authToken",
      "github.accessToken",
      "github.refreshToken",
      "clientSecret",
      "token",
      "secret",
      "password",
      "passwordPrompt",
      "private_key",
      "privateKey",
      "credentials.github"
    ]) {
      expect(() =>
        validateSetting({
          key,
          value: "redacted",
          updatedAt
        })
      ).toThrow("setting.key must not store secrets");
    }

    expect(() =>
      validateSetting({
        key: "ui.banner",
        value: "openaiApiKey=redacted-value",
        updatedAt
      })
    ).toThrow("setting.value must not store secret-like string values");
    expect(() =>
      validateSetting({
        key: "ui.local",
        value: { apiKey: "redacted-value" },
        updatedAt
      })
    ).toThrow("setting.value.apiKey must not store secrets");

    const repository = new InMemorySettingsRepository();
    await expect(repository.set(safeSetting)).resolves.toEqual(safeSetting);
    await expect(
      repository.set({
        key: "local.token",
        value: "redacted",
        updatedAt
      })
    ).rejects.toThrow("setting.key must not store secrets");
    await expect(
      repository.set({
        key: "ui.footer",
        value: "api_key=redacted-value",
        updatedAt
      })
    ).rejects.toThrow("setting.value must not store secret-like string values");
  });

  it("parses supported agent kinds", () => {
    expect(parseAgentKind("fake")).toBe("fake");
    expect(parseAgentKind("codex")).toBe("codex");
    expect(parseAgentKind("claude-code")).toBe("claude-code");
    expect(() => parseAgentKind("unknown")).toThrow(DomainValidationError);
  });

  it("keeps fake agent behind debug, development, or explicit internal config", () => {
    expect(availableAgentKinds({ env: { NODE_ENV: "production" } })).toEqual([
      "codex",
      "claude-code"
    ]);
    expect(defaultAgentKind({ env: { NODE_ENV: "production" } })).toBe("codex");
    expect(isAgentKindEnabled("fake", { debug: true })).toBe(true);
    expect(
      isAgentKindEnabled("fake", {
        env: { AGENT_HUB_AGENT_FAKE_ENABLED: "1", NODE_ENV: "production" }
      })
    ).toBe(true);
    expect(
      isAgentKindEnabled("codex", {
        env: { AGENT_HUB_AGENT_CODEX_ENABLED: "0" }
      })
    ).toBe(false);
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
    expect(() => validateMemoryStatusTransition("approved", "retired")).not.toThrow();
    expect(() => validateMemoryStatusTransition("rejected", "approved"))
      .toThrow(DomainStateTransitionError);
    expect(() => validateMemoryStatusTransition("retired", "approved"))
      .toThrow(DomainStateTransitionError);
  });

  it("enforces imported task run transitions in in-memory storage", async () => {
    const repository = new InMemoryTaskRunRepository();
    await repository.create({
      id: "run_in_memory",
      taskId: "task_1",
      agentKind: "fake",
      status: "queued",
      createdAt,
      updatedAt: createdAt
    });

    await expect(
      repository.updateStatus("run_in_memory", "running", updatedAt)
    ).resolves.toMatchObject({
      status: "running",
      startedAt: updatedAt
    });
    await expect(
      repository.updateStatus("run_in_memory", "running", "2026-01-01T00:00:02.000Z")
    ).resolves.toMatchObject({
      status: "running",
      startedAt: updatedAt
    });
    await expect(
      repository.updateStatus("run_in_memory", "succeeded", "2026-01-01T00:00:03.000Z")
    ).resolves.toMatchObject({
      status: "succeeded",
      completedAt: "2026-01-01T00:00:03.000Z"
    });
    await expect(repository.getStatusTransitions("run_in_memory")).resolves.toEqual([
      { runId: "run_in_memory", status: "queued", at: createdAt },
      { runId: "run_in_memory", status: "running", at: updatedAt },
      {
        runId: "run_in_memory",
        status: "succeeded",
        at: "2026-01-01T00:00:03.000Z"
      }
    ]);
  });

  it("rejects invalid task run transitions in in-memory storage", async () => {
    const repository = new InMemoryTaskRunRepository();
    await repository.create({
      id: "run_invalid_transition",
      taskId: "task_1",
      agentKind: "fake",
      status: "queued",
      createdAt,
      updatedAt: createdAt
    });

    await expect(
      repository.updateStatus("run_invalid_transition", "failed", updatedAt)
    ).rejects.toThrow("invalid task run status transition queued -> failed");
    await expect(repository.get("run_invalid_transition")).resolves.toMatchObject({
      status: "queued"
    });
    await expect(repository.getStatusTransitions("run_invalid_transition")).resolves.toEqual([
      { runId: "run_invalid_transition", status: "queued", at: createdAt }
    ]);
  });
});
