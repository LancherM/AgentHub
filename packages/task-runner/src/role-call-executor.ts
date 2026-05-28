import {
  buildRoleSystemPrompt,
  parseRoleResultJson,
  summarizeRoleResult,
  type RoleCall,
  type RoleCallContext,
  type RoleCallEvent,
  type RoleCallEventRepository,
  type RoleCallRepository,
  type RoleDefinition,
  type RoleResult
} from "@agent-hub/core";
import { TaskRunner, type RunTaskInput, type TaskRunResult } from "./task-runner";

export interface RoleCallExecutionRepositories {
  roleCallRepository: RoleCallRepository;
  roleCallEventRepository: RoleCallEventRepository;
}

export interface RoleCallTaskRunnerExecutorOptions {
  taskRunner: TaskRunner;
  repositories: RoleCallExecutionRepositories;
  roles: readonly RoleDefinition[];
  idFactory?: (prefix: string) => string;
  now?: () => string;
}

export interface ExecuteRoleCallInput {
  roleCallId: string;
  projectRoot: string;
  context?: RoleCallContext;
  taskRunnerOptions?: Partial<
    Pick<
      RunTaskInput,
      | "workspaceBasePath"
      | "runRoot"
      | "verificationCommands"
      | "environmentOverrides"
      | "agentAvailability"
      | "deliveryMode"
      | "workspaceCleanupPolicy"
      | "dryRun"
    >
  >;
}

export interface RoleCallExecutionResult {
  ok: boolean;
  roleCall: RoleCall;
  run?: TaskRunResult;
  result?: RoleResult;
  error?: string;
}

export class RoleCallTaskRunnerExecutor {
  private readonly taskRunner: TaskRunner;
  private readonly repositories: RoleCallExecutionRepositories;
  private readonly roles: readonly RoleDefinition[];
  private readonly idFactory: (prefix: string) => string;
  private readonly now: () => string;

  constructor(options: RoleCallTaskRunnerExecutorOptions) {
    this.taskRunner = options.taskRunner;
    this.repositories = options.repositories;
    this.roles = options.roles;
    this.idFactory = options.idFactory ?? ((prefix) => `${prefix}_${cryptoRandom()}`);
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async execute(input: ExecuteRoleCallInput): Promise<RoleCallExecutionResult> {
    let roleCall = await this.requireRoleCall(input.roleCallId);
    const calleeRole = this.findRole(roleCall.calleeRole);
    if (!calleeRole) {
      return this.failRoleCall(roleCall, `Callee role @${roleCall.calleeRole} not found.`);
    }
    if (calleeRole.executor.kind !== "agent_adapter") {
      return this.failRoleCall(
        roleCall,
        `Callee role @${calleeRole.handle} executor ${calleeRole.executor.kind} is not executable by TaskRunner.`
      );
    }
    if (!["accepted", "queued", "running"].includes(roleCall.status)) {
      return this.failRoleCall(
        roleCall,
        `Role call ${roleCall.id} must be accepted before execution; current status is ${roleCall.status}.`
      );
    }

    if (roleCall.status === "accepted") {
      roleCall = await this.repositories.roleCallRepository.updateStatus(
        roleCall.id,
        "queued",
        this.now()
      );
      await this.createEvent({
        roleCallId: roleCall.id,
        threadId: roleCall.threadId,
        type: "queued",
        actorRole: calleeRole.handle,
        message: `Queued @${calleeRole.handle} role call for TaskRunner execution.`,
        createdAt: this.now()
      });
    }
    if (roleCall.status === "queued") {
      roleCall = await this.repositories.roleCallRepository.updateStatus(
        roleCall.id,
        "running",
        this.now()
      );
      await this.createEvent({
        roleCallId: roleCall.id,
        threadId: roleCall.threadId,
        type: "started",
        actorRole: calleeRole.handle,
        message: `Started @${calleeRole.handle} role call execution.`,
        createdAt: this.now()
      });
    }

    const run = await this.taskRunner.run({
      projectRoot: input.projectRoot,
      taskId: roleCall.id,
      title: `Role call: @${roleCall.calleeRole} ${roleCall.task}`,
      taskPrompt: buildRoleExecutionPrompt({
        roleCall,
        calleeRole,
        context: input.context ?? roleCall.context
      }),
      agentKind: calleeRole.executor.adapter,
      deliveryMode: input.taskRunnerOptions?.deliveryMode ?? "runtime_injection",
      workspaceBasePath: input.taskRunnerOptions?.workspaceBasePath,
      runRoot: input.taskRunnerOptions?.runRoot,
      workspaceCleanupPolicy: input.taskRunnerOptions?.workspaceCleanupPolicy,
      verificationCommands: input.taskRunnerOptions?.verificationCommands,
      environmentOverrides: input.taskRunnerOptions?.environmentOverrides,
      agentAvailability: input.taskRunnerOptions?.agentAvailability,
      dryRun: input.taskRunnerOptions?.dryRun,
      userConstraints: [
        "Run only inside the isolated TaskRunner worktree.",
        "Do not push, merge, export repository context, or approve memory.",
        `Permission summary: ${JSON.stringify(roleCall.permissions)}`
      ],
      executionHints: [
        `RoleCall id: ${roleCall.id}`,
        `Expected output format: ${roleCall.expectedOutput.format}`,
        "Return a strict RoleResult JSON object if this adapter supports structured output."
      ]
    });
    roleCall = await this.repositories.roleCallRepository.linkTaskRun(
      roleCall.id,
      run.run.id
    );

    if (!run.ok || run.status === "failed" || run.status === "cancelled") {
      const status = run.status === "cancelled" ? "cancelled" : "failed";
      const failed = await this.repositories.roleCallRepository.update({
        ...roleCall,
        status,
        error: run.error ?? `TaskRunner run ${run.run.id} ${status}.`,
        completedAt: this.now()
      });
      await this.createEvent({
        roleCallId: roleCall.id,
        threadId: roleCall.threadId,
        type: status,
        actorRole: calleeRole.handle,
        message: failed.error ?? `TaskRunner run ${run.run.id} ${status}.`,
        metadata: { taskRunId: run.run.id },
        createdAt: this.now()
      });
      return { ok: false, roleCall: failed, run, error: failed.error };
    }

    const result = extractRoleResultFromRun(run, roleCall);
    const succeeded = await this.repositories.roleCallRepository.update({
      ...roleCall,
      status: "succeeded",
      result,
      completedAt: this.now()
    });
    await this.createEvent({
      roleCallId: roleCall.id,
      threadId: roleCall.threadId,
      type: "result_reported",
      actorRole: calleeRole.handle,
      message: summarizeRoleResult(result),
      metadata: { taskRunId: run.run.id },
      createdAt: this.now()
    });
    return { ok: true, roleCall: succeeded, run, result };
  }

  private async failRoleCall(
    roleCall: RoleCall,
    message: string
  ): Promise<RoleCallExecutionResult> {
    let current = roleCall;
    if (current.status !== "running") {
      current = await this.repositories.roleCallRepository.updateStatus(
        roleCall.id,
        "running",
        this.now()
      );
    }
    const failed = await this.repositories.roleCallRepository.update({
      ...current,
      status: "failed",
      error: message,
      completedAt: this.now()
    });
    await this.createEvent({
      roleCallId: failed.id,
      threadId: failed.threadId,
      type: "failed",
      actorRole: failed.calleeRole,
      message,
      createdAt: this.now()
    });
    return { ok: false, roleCall: failed, error: message };
  }

  private findRole(handle: string): RoleDefinition | undefined {
    return this.roles.find((role) => role.handle === handle);
  }

  private async requireRoleCall(roleCallId: string): Promise<RoleCall> {
    const roleCall = await this.repositories.roleCallRepository.get(roleCallId);
    if (!roleCall) {
      throw new Error(`role call ${roleCallId} not found`);
    }
    return roleCall;
  }

  private async createEvent(event: Omit<RoleCallEvent, "id">): Promise<void> {
    await this.repositories.roleCallEventRepository.create({
      ...event,
      id: this.idFactory("role_call_event")
    });
  }
}

export function buildRoleExecutionPrompt(input: {
  roleCall: RoleCall;
  calleeRole: RoleDefinition;
  context: RoleCallContext;
}): string {
  return [
    buildRoleSystemPrompt({
      role: input.calleeRole,
      expectedOutput: input.roleCall.expectedOutput
    }),
    "",
    "## RoleCall",
    `id: ${input.roleCall.id}`,
    `caller: @${input.roleCall.callerRole}`,
    `callee: @${input.roleCall.calleeRole}`,
    `task: ${input.roleCall.task}`,
    input.roleCall.reason ? `reason: ${input.roleCall.reason}` : undefined,
    "",
    "## RoleCallContext",
    JSON.stringify(input.context, null, 2),
    "",
    "## Expected RoleResult JSON",
    JSON.stringify(roleResultSchemaExample(), null, 2)
  ]
    .filter((entry): entry is string => typeof entry === "string")
    .join("\n");
}

export function extractRoleResultFromRun(
  run: TaskRunResult,
  roleCall: RoleCall
): RoleResult {
  const structured = findStructuredRoleResult(run);
  if (structured) {
    return structured;
  }
  return {
    summary: `@${roleCall.calleeRole} completed role call ${roleCall.id} through TaskRunner run ${run.run.id}.`,
    evidence: [
      `task_run:${run.run.id}`,
      run.verification?.summary ?? "verification not available",
      run.riskReport?.summary ?? "risk report not available"
    ],
    commandsRun: run.verification?.results.map((result) => ({
      command: [
        result.command.executable,
        ...(result.command.args ?? [])
      ].join(" "),
      exitCode: result.exitCode,
      outputSummary: result.status
    })),
    filesTouched: run.diff?.changedFiles.map((file) => file.path),
    risks: run.riskReport?.riskFactors,
    nextSteps: run.warnings.length > 0 ? run.warnings : undefined
  };
}

function findStructuredRoleResult(run: TaskRunResult): RoleResult | undefined {
  for (const event of run.events) {
    const candidates = [
      event.message,
      typeof event.metadata?.output === "string" ? event.metadata.output : undefined
    ].filter((entry): entry is string => Boolean(entry));
    for (const candidate of candidates) {
      const parsed = parseRoleResultJson(candidate);
      if (parsed.ok && parsed.result) {
        return parsed.result;
      }
    }
  }
  return undefined;
}

function roleResultSchemaExample(): RoleResult {
  return {
    summary: "Concise result summary.",
    evidence: ["source-backed evidence item"],
    commandsRun: [
      {
        command: "example command",
        exitCode: 0,
        outputSummary: "short output summary"
      }
    ],
    filesRead: ["path/to/file"],
    filesTouched: ["path/to/file"],
    patchSummary: "what changed, if anything",
    risks: ["risk or none"],
    nextSteps: ["next action or none"]
  };
}

function cryptoRandom(): string {
  return Math.random().toString(36).slice(2, 10);
}
