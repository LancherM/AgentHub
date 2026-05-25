import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  validateConversationMessage,
  validateRunArtifact,
  validateRunEvent,
  type RunArtifact,
  type RunArtifactRepository,
  type RunEventRepository,
  type RunMetadata,
  type RunMetadataRepository,
  type Task,
  type TaskRepository,
  type TaskRun,
  type TaskRunRepository
} from "@agent-hub/core";
import type {
  ConversationMessageRepository,
  ConversationThreadRepository
} from "@agent-hub/core";
import type { JsonObject } from "@agent-hub/shared";
import {
  assertSafeLocalGitConfig,
  assertWorkspacePathOwned,
  formatShellCommand,
  NodeShellExecutor,
  safeGitCommand,
  safeGitExecutionOptions,
  type ShellExecutor,
  type ShellResult
} from "@agent-hub/task-runner";
import type {
  ApplyPreview,
  LifecycleActionResult,
  LifecycleAuditEntry,
  ReviewRiskLevel,
  RunLifecycle,
  TimelineEventKind,
  TimelineEventTone
} from "../../src/lib/types";
import type { DesktopServiceContext } from "./project-service";
import type { ReviewService } from "./review-service";

const LIFECYCLE_AUDIT_ARTIFACT_KIND = "lifecycle_audit";
const APPLY_PATCH_PREVIEW_CHARS = 6_000;
const APPLY_PATCH_FILE_PREFIX = "agent-hub-apply-";

export interface LifecycleService {
  get(runId: string): Promise<RunLifecycle>;
  markKeep(input: { runId: string; reason?: string }): Promise<LifecycleActionResult>;
  cleanupWorktree(input: {
    runId: string;
    confirmation?: string;
    reason?: string;
  }): Promise<LifecycleActionResult>;
  previewApply(runId: string): Promise<ApplyPreview>;
  confirmApply(input: {
    runId: string;
    confirmation?: string;
    reason?: string;
  }): Promise<LifecycleActionResult>;
}

export function createLifecycleService(
  context: DesktopServiceContext,
  dependencies: {
    reviewService: ReviewService;
    shellExecutor?: ShellExecutor;
  }
): LifecycleService {
  return new RepositoryLifecycleService(context, {
    reviewService: dependencies.reviewService,
    shellExecutor: dependencies.shellExecutor ?? new NodeShellExecutor()
  });
}

class RepositoryLifecycleService implements LifecycleService {
  private readonly runs: TaskRunRepository;
  private readonly tasks: TaskRepository;
  private readonly metadata: RunMetadataRepository;
  private readonly artifacts: RunArtifactRepository;
  private readonly events: RunEventRepository;
  private readonly threads: ConversationThreadRepository;
  private readonly messages: ConversationMessageRepository;

  constructor(
    private readonly context: DesktopServiceContext,
    private readonly dependencies: {
      reviewService: ReviewService;
      shellExecutor: ShellExecutor;
    }
  ) {
    this.runs = context.repositories.taskRunRepository;
    this.tasks = context.repositories.taskRepository;
    this.metadata = context.repositories.runMetadataRepository;
    this.artifacts = context.repositories.runArtifactRepository;
    this.events = context.repositories.runEventRepository;
    this.threads = context.repositories.conversationThreadRepository;
    this.messages = context.repositories.conversationMessageRepository;
  }

  async get(runId: string): Promise<RunLifecycle> {
    await this.requireRunAndTask(runId);
    const [handoff, applyPreview, audit] = await Promise.all([
      this.dependencies.reviewService.getHandoff(runId),
      this.buildApplyPreview(runId, { recordAudit: false }),
      this.listAudit(runId)
    ]);
    return {
      runId,
      handoff,
      applyPreview,
      audit,
      message:
        "Lifecycle controls are explicit local actions. Cleanup and apply require confirmation."
    };
  }

  async markKeep(input: {
    runId: string;
    reason?: string;
  }): Promise<LifecycleActionResult> {
    await this.requireRunAndTask(input.runId);
    const handoff = await this.dependencies.reviewService.getHandoff(input.runId);
    if (!handoff.available) {
      const message = handoff.message ?? "No retained worktree is available to keep.";
      await this.recordLifecycleDecision({
        runId: input.runId,
        action: "mark_keep",
        status: "blocked",
        message,
        reason: input.reason,
        timelineKind: "lifecycle_marked_keep",
        tone: "warning"
      });
      return {
        ok: false,
        message,
        lifecycle: await this.get(input.runId)
      };
    }
    const metadata = await this.metadata.get(input.runId);
    await this.metadata.save({
      runId: input.runId,
      workspaceCleanup: {
        cleaned: false,
        retained: true,
        reason: boundedReason(input.reason) ?? "User marked retained worktree to keep.",
        commands: metadata?.workspaceCleanup?.commands ?? []
      }
    });
    const message = "Retained worktree marked keep. No cleanup or apply was performed.";
    await this.recordLifecycleDecision({
      runId: input.runId,
      action: "mark_keep",
      status: "recorded",
      message,
      reason: input.reason,
      timelineKind: "lifecycle_marked_keep",
      tone: "accent"
    });
    return {
      ok: true,
      message,
      lifecycle: await this.get(input.runId)
    };
  }

  async cleanupWorktree(input: {
    runId: string;
    confirmation?: string;
    reason?: string;
  }): Promise<LifecycleActionResult> {
    await this.requireRunAndTask(input.runId);
    const expected = cleanupConfirmationPhrase(input.runId);
    if (input.confirmation !== expected) {
      const message = `Cleanup requires exact confirmation: ${expected}`;
      await this.recordLifecycleDecision({
        runId: input.runId,
        action: "cleanup_worktree",
        status: "blocked",
        message,
        reason: input.reason,
        timelineKind: "lifecycle_cleaned",
        tone: "warning"
      });
      return {
        ok: false,
        message,
        lifecycle: await this.get(input.runId)
      };
    }

    const handoff = await this.dependencies.reviewService.getHandoff(input.runId);
    if (!handoff.available || !handoff.worktreePath) {
      const message = handoff.message ?? "No retained worktree is available to clean up.";
      await this.recordLifecycleDecision({
        runId: input.runId,
        action: "cleanup_worktree",
        status: "blocked",
        message,
        reason: input.reason,
        timelineKind: "lifecycle_cleaned",
        tone: "warning"
      });
      return {
        ok: false,
        message,
        lifecycle: await this.get(input.runId)
      };
    }
    const metadata = await this.metadata.get(input.runId);
    const worktreePath = handoff.worktreePath;
    const sourceRepositoryPath = metadata?.workspace?.sourceRepositoryPath;
    if (!sourceRepositoryPath) {
      const message = "No source repository metadata is available for cleanup.";
      await this.recordLifecycleDecision({
        runId: input.runId,
        action: "cleanup_worktree",
        status: "blocked",
        message,
        reason: input.reason,
        timelineKind: "lifecycle_cleaned",
        tone: "warning"
      });
      return {
        ok: false,
        message,
        lifecycle: await this.get(input.runId)
      };
    }
    this.assertOwnedWorktree(worktreePath, metadata);
    await assertSafeLocalGitConfig(sourceRepositoryPath);
    const removeResult = await this.dependencies.shellExecutor.execute(
      safeGitCommand(["worktree", "remove", "--force", worktreePath]),
      safeGitExecutionOptions({ cwd: sourceRepositoryPath })
    );
    if (removeResult.exitCode !== 0) {
      const message = commandFailureMessage(removeResult, "remove retained worktree");
      await this.recordLifecycleDecision({
        runId: input.runId,
        action: "cleanup_worktree",
        status: "failed",
        message,
        reason: input.reason,
        commands: [removeResult],
        timelineKind: "lifecycle_cleaned",
        tone: "danger"
      });
      return {
        ok: false,
        message,
        lifecycle: await this.get(input.runId)
      };
    }

    await this.metadata.save({
      runId: input.runId,
      workspaceCleanup: {
        cleaned: true,
        retained: false,
        reason: boundedReason(input.reason) ?? "User confirmed retained worktree cleanup.",
        commands: [removeResult]
      }
    });
    const message = "Retained worktree cleaned up locally. No merge or push was performed.";
    await this.recordLifecycleDecision({
      runId: input.runId,
      action: "cleanup_worktree",
      status: "completed",
      message,
      reason: input.reason,
      commands: [removeResult],
      timelineKind: "lifecycle_cleaned",
      tone: "success"
    });
    return {
      ok: true,
      message,
      lifecycle: await this.get(input.runId)
    };
  }

  async previewApply(runId: string): Promise<ApplyPreview> {
    await this.requireRunAndTask(runId);
    return this.buildApplyPreview(runId, { recordAudit: true });
  }

  async confirmApply(input: {
    runId: string;
    confirmation?: string;
    reason?: string;
  }): Promise<LifecycleActionResult> {
    const { run } = await this.requireRunAndTask(input.runId);
    const preview = await this.buildApplyPreview(input.runId, { recordAudit: false });
    if (!preview.available) {
      await this.recordLifecycleDecision({
        runId: input.runId,
        action: "apply_confirm",
        status: "blocked",
        message: preview.message,
        reason: input.reason,
        timelineKind: "apply_blocked",
        tone: "warning"
      });
      return {
        ok: false,
        message: preview.message,
        lifecycle: await this.get(input.runId)
      };
    }
    if (preview.blocked) {
      const message = "Apply is blocked because the latest risk report is blocking.";
      await this.recordLifecycleDecision({
        runId: input.runId,
        action: "apply_confirm",
        status: "blocked",
        message,
        reason: input.reason,
        timelineKind: "apply_blocked",
        tone: "danger"
      });
      return {
        ok: false,
        message,
        lifecycle: await this.get(input.runId)
      };
    }
    if (input.confirmation !== preview.confirmationPhrase) {
      const message = `Apply requires exact confirmation: ${preview.confirmationPhrase}`;
      await this.recordLifecycleDecision({
        runId: input.runId,
        action: "apply_confirm",
        status: "blocked",
        message,
        reason: input.reason,
        timelineKind: "apply_blocked",
        tone: "warning"
      });
      return {
        ok: false,
        message,
        lifecycle: await this.get(input.runId)
      };
    }

    const metadata = await this.metadata.get(input.runId);
    const sourceRepositoryPath = metadata?.workspace?.sourceRepositoryPath;
    if (!sourceRepositoryPath) {
      const message = "No source repository metadata is available for local apply.";
      await this.recordLifecycleDecision({
        runId: input.runId,
        action: "apply_confirm",
        status: "blocked",
        message,
        reason: input.reason,
        timelineKind: "apply_blocked",
        tone: "warning"
      });
      return {
        ok: false,
        message,
        lifecycle: await this.get(input.runId)
      };
    }
    await assertSafeLocalGitConfig(sourceRepositoryPath);
    const patch = await this.rawApplyPatch(run, metadata);
    if (!patch || patch.trim().length === 0) {
      const message = "No patch content is available to apply.";
      await this.recordLifecycleDecision({
        runId: input.runId,
        action: "apply_confirm",
        status: "blocked",
        message,
        reason: input.reason,
        timelineKind: "apply_blocked",
        tone: "warning"
      });
      return {
        ok: false,
        message,
        lifecycle: await this.get(input.runId)
      };
    }

    const patchFilePath = await writeTemporaryPatch(patch);
    let checkResult: ShellResult | undefined;
    let applyResult: ShellResult | undefined;
    try {
      checkResult = await this.dependencies.shellExecutor.execute(
        safeGitCommand(["apply", "--check", patchFilePath]),
        safeGitExecutionOptions({ cwd: sourceRepositoryPath })
      );
      if (checkResult.exitCode !== 0) {
        const message = commandFailureMessage(checkResult, "check local apply patch");
        await this.recordLifecycleDecision({
          runId: input.runId,
          action: "apply_confirm",
          status: "blocked",
          message,
          reason: input.reason,
          commands: [checkResult],
          timelineKind: "apply_blocked",
          tone: "warning"
        });
        return {
          ok: false,
          message,
          lifecycle: await this.get(input.runId)
        };
      }

      applyResult = await this.dependencies.shellExecutor.execute(
        safeGitCommand(["apply", patchFilePath]),
        safeGitExecutionOptions({ cwd: sourceRepositoryPath })
      );
      if (applyResult.exitCode !== 0) {
        const message = commandFailureMessage(applyResult, "apply patch locally");
        await this.recordLifecycleDecision({
          runId: input.runId,
          action: "apply_confirm",
          status: "failed",
          message,
          reason: input.reason,
          commands: [checkResult, applyResult],
          timelineKind: "apply_blocked",
          tone: "danger"
        });
        return {
          ok: false,
          message,
          lifecycle: await this.get(input.runId)
        };
      }
    } finally {
      await fs.rm(path.dirname(patchFilePath), { force: true, recursive: true });
    }

    const message = "Patch applied to the local project checkout. No commit, push, or merge was performed.";
    await this.recordLifecycleDecision({
      runId: input.runId,
      action: "apply_confirm",
      status: "completed",
      message,
      reason: input.reason,
      commands: [checkResult, applyResult],
      timelineKind: "apply_applied",
      tone: "success"
    });
    return {
      ok: true,
      message,
      lifecycle: await this.get(input.runId)
    };
  }

  private async rawApplyPatch(
    run: TaskRun,
    metadata: RunMetadata | undefined
  ): Promise<string | undefined> {
    if (metadata?.diff?.diff && metadata.diff.diff.trim().length > 0) {
      return metadata.diff.diff;
    }
    const artifact = await this.artifacts.getLatestByRunIdAndKind(
      run.id,
      "git_diff"
    );
    return artifact?.metadata.placeholder === true ? undefined : artifact?.content;
  }

  private async buildApplyPreview(
    runId: string,
    options: { recordAudit: boolean }
  ): Promise<ApplyPreview> {
    const [diff, risk] = await Promise.all([
      this.dependencies.reviewService.getDiff(runId),
      this.dependencies.reviewService.getRisk(runId)
    ]);
    const patch = diff.patch ?? "";
    const preview = boundedPatchPreview(patch);
    const riskLevel = risk.level;
    const unavailableMessage =
      "No persisted diff patch is available for explicit local apply.";
    const applyPreview: ApplyPreview = {
      runId,
      available: patch.trim().length > 0 && diff.files.length > 0,
      confirmationPhrase: applyConfirmationPhrase(runId),
      blocked: riskLevel === "blocking",
      riskLevel,
      changedFiles: diff.files,
      patchPreview: preview.content,
      truncated: preview.truncated,
      message:
        patch.trim().length === 0 || diff.files.length === 0
          ? unavailableMessage
          : riskLevel === "blocking"
            ? "Preview is available, but apply is blocked by the latest blocking risk report."
            : "Preview is available. Applying requires exact confirmation and remains local only."
    };

    if (options.recordAudit) {
      await this.recordLifecycleDecision({
        runId,
        action: "apply_preview",
        status: applyPreview.blocked ? "blocked" : "recorded",
        message: applyPreview.message,
        timelineKind: applyPreview.blocked ? "apply_blocked" : "apply_previewed",
        tone: applyPreview.blocked ? "danger" : "accent",
        riskLevel,
        changedFiles: diff.files.length
      });
    }
    return applyPreview;
  }

  private async requireRunAndTask(
    runId: string
  ): Promise<{ run: TaskRun; task: Task }> {
    const run = await this.runs.get(runId);
    if (!run) {
      throw new Error(`run ${runId} not found`);
    }
    const task = await this.tasks.get(run.taskId);
    if (!task) {
      throw new Error(`task ${run.taskId} not found`);
    }
    return { run, task };
  }

  private async listAudit(runId: string): Promise<LifecycleAuditEntry[]> {
    const artifacts = await this.artifacts.listByRunId(runId);
    return artifacts
      .filter((artifact) => artifact.kind === LIFECYCLE_AUDIT_ARTIFACT_KIND)
      .map(toLifecycleAuditEntry)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  private assertOwnedWorktree(
    worktreePath: string,
    metadata: RunMetadata | undefined
  ): void {
    const workspaceBasePath = metadata?.workspace?.workspaceBasePath;
    if (!workspaceBasePath) {
      throw new Error("run metadata has no workspace ownership boundary");
    }
    assertWorkspacePathOwned(worktreePath, workspaceBasePath);
  }

  private async recordLifecycleDecision(input: {
    runId: string;
    action: string;
    status: LifecycleAuditEntry["status"];
    message: string;
    reason?: string;
    commands?: Array<ShellResult | undefined>;
    timelineKind: TimelineEventKind;
    tone: TimelineEventTone;
    riskLevel?: ReviewRiskLevel;
    changedFiles?: number;
  }): Promise<void> {
    const { run, task } = await this.requireRunAndTask(input.runId);
    const createdAt = this.context.now();
    const artifact = await this.artifacts.create(
      validateRunArtifact({
        id: this.context.nextId("lifecycle"),
        taskRunId: input.runId,
        kind: LIFECYCLE_AUDIT_ARTIFACT_KIND,
        content: lifecycleAuditContent(input),
        metadata: {
          action: input.action,
          status: input.status,
          message: input.message,
          reason: boundedReason(input.reason),
          riskLevel: input.riskLevel,
          changedFiles: input.changedFiles,
          commands: compactCommands(input.commands).map((command) => ({
            command: formatShellCommand(command.command),
            cwd: command.cwd,
            exitCode: command.exitCode,
            timedOut: command.timedOut,
            error: command.error
          }))
        },
        createdAt
      })
    );
    await this.events.create(
      validateRunEvent({
        id: this.context.nextId("event"),
        taskRunId: input.runId,
        sequence: await this.events.countByRunId(input.runId),
        type: "message",
        message: input.message,
        metadata: {
          phase: "lifecycle",
          lifecycleAction: input.action,
          lifecycleStatus: input.status,
          artifactId: artifact.id
        },
        createdAt
      })
    );
    await this.appendConversationTimeline({
      run,
      task,
      artifact,
      kind: input.timelineKind,
      tone: input.tone,
      title: lifecycleTimelineTitle(input.action, input.status),
      summary: input.message,
      status: input.status
    });
  }

  private async appendConversationTimeline(input: {
    run: TaskRun;
    task: Task;
    artifact: RunArtifact;
    kind: TimelineEventKind;
    tone: TimelineEventTone;
    title: string;
    summary: string;
    status: string;
  }): Promise<void> {
    const thread = await this.findThreadForRun(input.task.projectId, input.run.id);
    if (!thread) {
      return;
    }
    const sequence = await this.messages.countByThreadId(thread.threadId);
    await this.messages.create(
      validateConversationMessage({
        id: this.context.nextId("message"),
        threadId: thread.threadId,
        sequence,
        role: "system",
        kind: "text",
        content: input.summary,
        runId: input.run.id,
        metadata: {
          taskEvent: input.kind,
          taskId: input.task.id,
          runId: input.run.id,
          artifactId: input.artifact.id,
          timelineEvent: {
            kind: input.kind,
            actor: "system",
            title: input.title,
            summary: input.summary,
            status: input.status,
            tone: input.tone,
            linkedIds: {
              taskId: input.task.id,
              runId: input.run.id,
              artifactId: input.artifact.id
            },
            chips: [
              {
                kind: input.kind,
                label: input.status,
                tone: input.tone,
                tab: "lifecycle"
              }
            ]
          }
        },
        createdAt: this.context.now()
      })
    );
  }

  private async findThreadForRun(
    projectId: string,
    runId: string
  ): Promise<{ threadId: string } | undefined> {
    const threads = await this.threads.list(projectId);
    for (const thread of threads) {
      const messages = await this.messages.listByThreadId(thread.id);
      if (messages.some((message) => message.runId === runId)) {
        return { threadId: thread.id };
      }
    }
    return undefined;
  }
}

function retainedWorktreePath(
  run: TaskRun,
  metadata: RunMetadata | undefined
): string | undefined {
  return run.worktreePath ?? metadata?.workspace?.path;
}

function applyConfirmationPhrase(runId: string): string {
  return `apply ${runId}`;
}

function cleanupConfirmationPhrase(runId: string): string {
  return `cleanup ${runId}`;
}

function boundedReason(reason: string | undefined): string | undefined {
  const trimmed = reason?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.slice(0, 500);
}

function boundedPatchPreview(patch: string): {
  content: string;
  truncated: boolean;
} {
  if (patch.length <= APPLY_PATCH_PREVIEW_CHARS) {
    return { content: patch, truncated: false };
  }
  return {
    content: `${patch.slice(0, APPLY_PATCH_PREVIEW_CHARS)}\n[Apply preview truncated after ${APPLY_PATCH_PREVIEW_CHARS} characters.]`,
    truncated: true
  };
}

function toLifecycleAuditEntry(artifact: RunArtifact): LifecycleAuditEntry {
  const metadata = artifact.metadata as JsonObject;
  return {
    id: artifact.id,
    artifactId: artifact.id,
    action: stringMetadata(metadata, "action") ?? "unknown",
    status: lifecycleAuditStatus(metadata.status),
    createdAt: artifact.createdAt,
    message: stringMetadata(metadata, "message") ?? firstLine(artifact.content)
  };
}

function lifecycleAuditStatus(value: unknown): LifecycleAuditEntry["status"] {
  return value === "blocked" ||
    value === "failed" ||
    value === "completed" ||
    value === "recorded"
    ? value
    : "recorded";
}

function stringMetadata(metadata: JsonObject, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function firstLine(content: string): string {
  return content.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? "";
}

function lifecycleAuditContent(input: {
  action: string;
  status: string;
  message: string;
  reason?: string;
  commands?: Array<ShellResult | undefined>;
  riskLevel?: ReviewRiskLevel;
  changedFiles?: number;
}): string {
  const lines = [
    `action: ${input.action}`,
    `status: ${input.status}`,
    `message: ${input.message}`
  ];
  if (input.reason) {
    lines.push(`reason: ${boundedReason(input.reason)}`);
  }
  if (input.riskLevel) {
    lines.push(`risk_level: ${input.riskLevel}`);
  }
  if (input.changedFiles !== undefined) {
    lines.push(`changed_files: ${input.changedFiles}`);
  }
  for (const command of compactCommands(input.commands)) {
    lines.push(
      `command: ${formatShellCommand(command.command)}`,
      `exit_code: ${command.exitCode ?? "signal"}`
    );
  }
  return `${lines.join("\n")}\n`;
}

function compactCommands(
  commands: Array<ShellResult | undefined> | undefined
): ShellResult[] {
  return commands?.filter((command): command is ShellResult => Boolean(command)) ?? [];
}

function lifecycleTimelineTitle(action: string, status: string): string {
  if (action === "mark_keep") {
    return "Worktree marked keep";
  }
  if (action === "cleanup_worktree") {
    return status === "completed" ? "Worktree cleaned up" : "Worktree cleanup";
  }
  if (action === "apply_preview") {
    return "Apply preview";
  }
  if (action === "apply_confirm") {
    return status === "completed" ? "Patch applied locally" : "Apply decision";
  }
  return "Lifecycle decision";
}

function commandFailureMessage(result: ShellResult, action: string): string {
  const detail = result.stderr.trim() || result.stdout.trim() || result.error;
  return `${action} failed: ${detail ?? formatShellCommand(result.command)}`;
}

async function writeTemporaryPatch(patch: string): Promise<string> {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), APPLY_PATCH_FILE_PREFIX));
  const patchFilePath = path.join(tempDirectory, "patch.diff");
  await fs.writeFile(patchFilePath, patch, "utf8");
  return patchFilePath;
}
