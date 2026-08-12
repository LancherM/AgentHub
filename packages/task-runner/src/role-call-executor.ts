import {
  buildRoleSystemPrompt,
  extractAgentFacingOutput,
  parseRoleResultJson,
  summarizeRoleResult,
  type RoleCall,
  type RoleCallContext,
  type RoleCallEvent,
  type RoleCallEventRepository,
  type RoleCallPlanTraceContext,
  type RoleCallRepository,
  type RoleTodoRepository,
  type RoleDefinition,
  type RoleResult,
  type TraceLinkRepository,
  type TraceNode,
  type WorkgroupRoleRunMetadata
} from "@agent-hub/core";
import { TaskRunner, type RunTaskInput, type TaskRunResult } from "./task-runner";

export interface RoleCallExecutionRepositories {
  roleCallRepository: RoleCallRepository;
  roleCallEventRepository: RoleCallEventRepository;
  roleTodoRepository?: RoleTodoRepository;
  traceLinkRepository?: TraceLinkRepository;
}

export interface RoleCallTaskRunnerExecutorOptions {
  taskRunner: TaskRunner;
  repositories: RoleCallExecutionRepositories;
  roles: readonly RoleDefinition[];
  roleMetadata?: readonly WorkgroupRoleRunMetadata[];
  idFactory?: (prefix: string) => string;
  now?: () => string;
}

export interface ExecuteRoleCallInput {
  roleCallId: string;
  projectId?: string;
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
      | "agentHubHome"
      | "deliveryMode"
      | "roleSkillReferences"
      | "workspaceCleanupPolicy"
      | "dryRun"
      | "onEvent"
      | "signal"
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
  private readonly roleMetadata: readonly WorkgroupRoleRunMetadata[];
  private readonly idFactory: (prefix: string) => string;
  private readonly now: () => string;

  constructor(options: RoleCallTaskRunnerExecutorOptions) {
    this.taskRunner = options.taskRunner;
    this.repositories = options.repositories;
    this.roles = options.roles;
    this.roleMetadata = options.roleMetadata ?? [];
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
    const calleeRoleMetadata =
      this.findRoleMetadata(calleeRole.handle) ?? roleDefinitionToRunMetadata(calleeRole);

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
      projectId: input.projectId,
      taskId: roleCall.id,
      title: `Role call: @${roleCall.calleeRole} ${roleCall.task}`,
      taskPrompt: buildRoleExecutionPrompt({
        roleCall,
        calleeRole,
        context: input.context ?? roleCall.context
      }),
      agentKind: calleeRole.executor.adapter,
      role: calleeRoleMetadata,
      teamRoles: this.roles.map(
        (role) => this.findRoleMetadata(role.handle) ?? roleDefinitionToRunMetadata(role)
      ),
      deliveryMode: input.taskRunnerOptions?.deliveryMode ?? "runtime_injection",
      workspaceBasePath: input.taskRunnerOptions?.workspaceBasePath,
      runRoot: input.taskRunnerOptions?.runRoot,
      workspaceCleanupPolicy: input.taskRunnerOptions?.workspaceCleanupPolicy,
      verificationCommands: input.taskRunnerOptions?.verificationCommands,
      environmentOverrides: input.taskRunnerOptions?.environmentOverrides,
      agentAvailability: input.taskRunnerOptions?.agentAvailability,
      agentHubHome: input.taskRunnerOptions?.agentHubHome,
      roleSkillReferences:
        input.taskRunnerOptions?.roleSkillReferences ??
        calleeRoleMetadata.defaultSkillReferences,
      ...(roleCall.context.planTrace
        ? { planGraphBinding: planGraphBindingFromRoleCall(roleCall.context.planTrace) }
        : {}),
      dryRun: input.taskRunnerOptions?.dryRun,
      onEvent: input.taskRunnerOptions?.onEvent,
      signal: input.taskRunnerOptions?.signal,
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
    await this.recordCalleeTaskRunTrace(roleCall, run);

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
      await this.updateLinkedTodo(failed, status === "cancelled" ? "cancelled" : "blocked");
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
    await this.updateLinkedTodo(succeeded, "done");
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
    await this.updateLinkedTodo(failed, "blocked");
    return { ok: false, roleCall: failed, error: message };
  }

  private async updateLinkedTodo(
    roleCall: RoleCall,
    status: "blocked" | "cancelled" | "done"
  ): Promise<void> {
    if (!roleCall.todoId || !this.repositories.roleTodoRepository) {
      return;
    }
    await this.repositories.roleTodoRepository.updateStatus(
      roleCall.todoId,
      status,
      this.now()
    );
    await this.createEvent({
      roleCallId: roleCall.id,
      threadId: roleCall.threadId,
      type: "todo_updated",
      actorRole: roleCall.calleeRole,
      message: `Updated linked todo ${roleCall.todoId} to ${status}.`,
      metadata: { todoId: roleCall.todoId, todoStatus: status },
      createdAt: this.now()
    });
  }

  private async recordCalleeTaskRunTrace(
    roleCall: RoleCall,
    run: TaskRunResult
  ): Promise<void> {
    const traceLinks = this.repositories.traceLinkRepository;
    const planTrace = roleCall.context.planTrace;
    if (!traceLinks || !planTrace) {
      return;
    }
    const taskRunTraceNodeId = this.idFactory("trace_node");
    await traceLinks.createNode({
      id: taskRunTraceNodeId,
      planGraphId: planTrace.planGraphId,
      kind: "task_run",
      title: `TaskRun ${run.run.id} for @${roleCall.calleeRole}`,
      status: traceNodeStatusForRun(run.status),
      sourcePlanNodeId: planTrace.sourcePlanNodeId,
      role: roleCall.calleeRole,
      sourceType: "task_run",
      sourceId: run.run.id,
      createdAt: this.now()
    });
    await traceLinks.createEdge({
      id: this.idFactory("trace_edge"),
      planGraphId: planTrace.planGraphId,
      from: planTrace.traceNodeId ?? planTrace.sourcePlanNodeId,
      to: taskRunTraceNodeId,
      type: "runtime",
      label: `TaskRunner ${run.status}`
    });
    await traceLinks.linkEvidence({
      id: this.idFactory("trace_evidence"),
      planGraphId: planTrace.planGraphId,
      sourceType: "task_run",
      sourceId: run.run.id,
      planNodeId: planTrace.sourcePlanNodeId,
      traceNodeId: taskRunTraceNodeId,
      summary: `RoleCall ${roleCall.id} executed by run ${run.run.id}: ${run.status}`,
      createdAt: this.now()
    });
  }

  private findRole(handle: string): RoleDefinition | undefined {
    return this.roles.find((role) => role.handle === handle);
  }

  private findRoleMetadata(handle: string): WorkgroupRoleRunMetadata | undefined {
    return this.roleMetadata.find((role) => role.roleHandle === handle);
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
  const agentOutput = extractAgentFacingOutput(
    {
      events: run.events.map((event) => ({
        type: event.type,
        message: event.message,
        metadata: event.metadata
      }))
    },
    { includeRawStreams: false, includeTerminalSummaries: false }
  ).trim();
  return {
    summary:
      agentOutput ||
      `@${roleCall.calleeRole} completed role call ${roleCall.id} through TaskRunner run ${run.run.id}.`,
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

function roleDefinitionToRunMetadata(
  role: RoleDefinition
): WorkgroupRoleRunMetadata {
  return {
    roleId: role.id,
    roleHandle: role.handle,
    displayName: role.displayName,
    executorKind: roleExecutorKindForWorkgroup(role),
    adapterKind:
      role.executor.kind === "agent_adapter" ? role.executor.adapter : undefined,
    persona: role.purpose,
    defaultInstructions: role.defaultInstructions,
    permissions: rolePermissionLabels(role.permissions),
    contextPolicy: {
      ...role.contextPolicy,
      instructions: [...role.contextPolicy.instructions]
    },
    approvalPolicy: {
      ...role.approvalPolicy,
      requiredFor: [...role.approvalPolicy.requiredFor]
    }
  };
}

function roleExecutorKindForWorkgroup(
  role: RoleDefinition
): WorkgroupRoleRunMetadata["executorKind"] {
  if (role.executor.kind === "local_workflow") {
    return "workflow";
  }
  return role.executor.kind;
}

function rolePermissionLabels(
  permissions: RoleDefinition["permissions"]
): string[] {
  const labels: string[] = [];
  if (permissions.canReadFiles) labels.push("read_files");
  if (permissions.canEditFiles) labels.push("edit_files");
  if (permissions.canRunCommands) labels.push("run_commands");
  if (permissions.canUseNetwork) labels.push("use_network");
  if (permissions.canAskUser) labels.push("ask_user");
  if (permissions.requiresApprovalForShell) {
    labels.push("approval_required_for_shell");
  }
  if (permissions.requiresApprovalForFileWrite) {
    labels.push("approval_required_for_file_write");
  }
  labels.push(
    ...(permissions.allowedCommandPatterns?.map(
      (pattern) => `allowed_command:${pattern}`
    ) ?? [])
  );
  labels.push(
    ...(permissions.deniedCommandPatterns?.map(
      (pattern) => `denied_command:${pattern}`
    ) ?? [])
  );
  return labels;
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

function planGraphBindingFromRoleCall(planTrace: RoleCallPlanTraceContext) {
  return {
    planGraphId: planTrace.planGraphId,
    planGraphVersion: planTrace.planGraphVersion,
    planNodeId: planTrace.sourcePlanNodeId,
    ...(planTrace.traceNodeId ? { traceNodeId: planTrace.traceNodeId } : {}),
    ...(planTrace.allowedNextPlanNodeIds
      ? { allowedNextPlanNodeIds: [...planTrace.allowedNextPlanNodeIds] }
      : {})
  };
}

function traceNodeStatusForRun(status: TaskRunResult["status"]): TraceNode["status"] {
  if (status === "succeeded") {
    return "completed";
  }
  if (status === "cancelled") {
    return "blocked";
  }
  if (status === "running" || status === "queued") {
    return status;
  }
  return "failed";
}

function cryptoRandom(): string {
  return Math.random().toString(36).slice(2, 10);
}
