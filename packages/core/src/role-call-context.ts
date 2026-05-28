import {
  type RoleCall,
  type RoleCallContext,
  type RoleCallDecision,
  type RoleCallEvent,
  type RoleDefinition,
  type RoleResult,
  validateRoleResult
} from "./domain";
import {
  type RoleCallEventRepository,
  type RoleCallRepository,
  type RoleTodoRepository
} from "./storage";

export const MAX_INVALID_ROLE_RESULT_RAW_OUTPUT_CHARS = 4000;
export const DEFAULT_CALLER_SUMMARY_CHARS = 600;

export interface RoleCallContextBuilderRepositories {
  roleCallRepository: RoleCallRepository;
  roleTodoRepository: RoleTodoRepository;
}

export interface RoleCallContextBuildInput {
  threadId: string;
  callerRole: string;
  calleeRole: string;
  userGoal: string;
  currentPlan?: string;
  constraints?: string[];
  relevantFiles?: string[];
  recentFindings?: string[];
  repoState?: RoleCallContext["repoState"];
  maxPreviousResults?: number;
}

export class RoleCallContextBuilder {
  constructor(private readonly repositories: RoleCallContextBuilderRepositories) {}

  async build(input: RoleCallContextBuildInput): Promise<RoleCallContext> {
    const [calls, callerTodos, calleeTodos] = await Promise.all([
      this.repositories.roleCallRepository.list({ threadId: input.threadId }),
      this.repositories.roleTodoRepository.list({
        threadId: input.threadId,
        role: input.callerRole
      }),
      this.repositories.roleTodoRepository.list({
        threadId: input.threadId,
        role: input.calleeRole
      })
    ]);
    const relevantRoles = new Set([input.callerRole, input.calleeRole]);
    const previousRoleResults = calls
      .filter(
        (call) =>
          call.result &&
          (relevantRoles.has(call.callerRole) || relevantRoles.has(call.calleeRole))
      )
      .sort((left, right) =>
        left.createdAt === right.createdAt
          ? left.id.localeCompare(right.id)
          : left.createdAt.localeCompare(right.createdAt)
      )
      .slice(-(input.maxPreviousResults ?? 5))
      .map((call) => stripRawOutputFromResult(call.result as RoleResult));

    return {
      userGoal: input.userGoal,
      currentPlan: input.currentPlan,
      relevantFiles: input.relevantFiles,
      recentFindings: input.recentFindings,
      constraints: input.constraints,
      previousRoleResults,
      callerTodoState: callerTodos,
      calleeTodoState: calleeTodos,
      repoState: input.repoState
    };
  }
}

export interface RoleSystemPromptInput {
  role: RoleDefinition;
  expectedOutput?: RoleCall["expectedOutput"];
}

export function buildRoleSystemPrompt(input: RoleSystemPromptInput): string {
  const { role } = input;
  return [
    `You are @${role.handle} (${role.displayName}).`,
    role.purpose,
    role.defaultInstructions,
    `Capabilities: ${role.capabilities.join(", ") || "none"}.`,
    `Permissions: ${permissionSummary(role)}.`,
    "Emit RoleIntent records for collaboration requests; do not directly message other roles.",
    "Return strict RoleResult JSON when completing executable work.",
    `Expected output: ${input.expectedOutput?.format ?? "summary"}.`,
    "Do not include raw logs unless the Orchestrator requests invalid-result audit evidence."
  ].join("\n");
}

export function summarizeRoleCallDecision(
  decision: RoleCallDecision,
  maxChars = DEFAULT_CALLER_SUMMARY_CHARS
): string {
  const parts = [
    `Decision: ${decision.disposition}.`,
    `Reason: ${decision.reason}`,
    decision.suggestedResumeCondition
      ? `Resume: ${decision.suggestedResumeCondition}`
      : undefined,
    decision.requiredContext?.length
      ? `Needs context: ${decision.requiredContext.join(", ")}`
      : undefined,
    decision.todo ? `Todo: ${decision.todo.title}` : undefined
  ].filter((entry): entry is string => Boolean(entry));
  return truncateForCaller(parts.join(" "), maxChars);
}

export function summarizeRoleResult(
  result: RoleResult,
  maxChars = DEFAULT_CALLER_SUMMARY_CHARS
): string {
  const parts = [
    result.summary,
    result.evidence.length ? `Evidence: ${result.evidence.join(", ")}` : undefined,
    result.risks?.length ? `Risks: ${result.risks.join(", ")}` : undefined,
    result.nextSteps?.length ? `Next: ${result.nextSteps.join(", ")}` : undefined
  ].filter((entry): entry is string => Boolean(entry));
  return truncateForCaller(parts.join(" "), maxChars);
}

export interface RoleResultJsonParseResult {
  ok: boolean;
  result?: RoleResult;
  error?: string;
  rawOutput?: string;
}

export function parseRoleResultJson(rawOutput: string): RoleResultJsonParseResult {
  try {
    const parsed = JSON.parse(rawOutput) as RoleResult;
    const result = validateRoleResult(stripRawOutputFromResult(parsed));
    return { ok: true, result };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid RoleResult JSON",
      rawOutput: boundRawOutput(rawOutput)
    };
  }
}

export interface PersistRoleResultJsonInput {
  roleCallRepository: RoleCallRepository;
  roleCallEventRepository: RoleCallEventRepository;
  roleCallId: string;
  rawOutput: string;
  at: string;
}

export async function persistRoleResultJson(
  input: PersistRoleResultJsonInput
): Promise<RoleResultJsonParseResult> {
  const call = await input.roleCallRepository.get(input.roleCallId);
  if (!call) {
    throw new Error(`role call ${input.roleCallId} not found`);
  }
  const parseResult = parseRoleResultJson(input.rawOutput);
  const runningCall =
    call.status === "running"
      ? call
      : await input.roleCallRepository.updateStatus(
          input.roleCallId,
          "running",
          input.at
        );
  if (parseResult.ok && parseResult.result) {
    await input.roleCallRepository.update({
      ...runningCall,
      status: "succeeded",
      result: parseResult.result,
      completedAt: input.at
    });
    await input.roleCallEventRepository.create(resultEvent({
      roleCallId: input.roleCallId,
      threadId: runningCall.threadId,
      type: "result_reported",
      actorRole: runningCall.calleeRole,
      message: summarizeRoleResult(parseResult.result),
      createdAt: input.at
    }));
    return parseResult;
  }

  await input.roleCallRepository.update({
    ...runningCall,
    status: "failed",
    error: parseResult.error,
    completedAt: input.at
  });
  await input.roleCallEventRepository.create(resultEvent({
    roleCallId: input.roleCallId,
    threadId: runningCall.threadId,
    type: "failed",
    actorRole: runningCall.calleeRole,
    message: `Invalid RoleResult JSON: ${parseResult.error}`,
    metadata: {
      rawOutput: parseResult.rawOutput,
      parseError: parseResult.error
    },
    createdAt: input.at
  }));
  return parseResult;
}

function permissionSummary(role: RoleDefinition): string {
  const permissions = role.permissions;
  return [
    permissions.canReadFiles ? "read files" : undefined,
    permissions.canEditFiles ? "edit files" : undefined,
    permissions.canRunCommands ? "run commands" : undefined,
    permissions.canUseNetwork ? "network" : undefined,
    permissions.canAskUser ? "ask user" : undefined,
    permissions.requiresApprovalForShell ? "shell requires approval" : undefined,
    permissions.requiresApprovalForFileWrite ? "file writes require approval" : undefined
  ]
    .filter((entry): entry is string => Boolean(entry))
    .join(", ");
}

function stripRawOutputFromResult(result: RoleResult): RoleResult {
  const { rawOutput: _rawOutput, ...safeResult } = result;
  return safeResult;
}

function truncateForCaller(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function boundRawOutput(rawOutput: string): string {
  if (rawOutput.length <= MAX_INVALID_ROLE_RESULT_RAW_OUTPUT_CHARS) {
    return rawOutput;
  }
  return rawOutput.slice(0, MAX_INVALID_ROLE_RESULT_RAW_OUTPUT_CHARS);
}

function resultEvent(
  input: Omit<RoleCallEvent, "id">
): RoleCallEvent {
  return {
    ...input,
    id: `role_call_event_result_${input.roleCallId}_${input.createdAt.replace(/[^0-9]/g, "")}`
  };
}
