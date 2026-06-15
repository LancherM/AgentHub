import {
  nowIso,
  validateConversationMessage,
  type ConversationMessage,
  type ExpectedOutputSpec,
  type JsonObject,
  type RoleDefinition
} from "./domain";
import { parseRoleCallIntents } from "./role-call-parser";
import {
  RoleCallOrchestrator,
  type RoleCallLedgerSummary,
  type RoleCallPolicyValidator,
  type RoleCallSourcePlanBinding
} from "./role-call-orchestrator";
import type {
  ConversationMessageRepository,
  RunMetadataRepository,
  RoleCallEventRepository,
  RoleCallRepository,
  RoleTodoRepository,
  TraceLinkRepository
} from "./storage";

export interface AssistantRoleCallOutputRepositories {
  conversationMessageRepository: ConversationMessageRepository;
  roleCallRepository: RoleCallRepository;
  roleCallEventRepository: RoleCallEventRepository;
  roleTodoRepository: RoleTodoRepository;
  runMetadataRepository?: RunMetadataRepository;
  traceLinkRepository?: TraceLinkRepository;
}

export interface AssistantRoleCallExecutionInput {
  parentMessageId: string;
  roleDefinitions: readonly RoleDefinition[];
}

export interface AssistantRoleCallExecutionResult {
  ok: boolean;
  warnings?: readonly string[];
}

export interface ProcessAssistantRoleCallOutputInput {
  repositories: AssistantRoleCallOutputRepositories;
  threadId: string;
  callerRole: string | undefined;
  message: ConversationMessage;
  roles: readonly RoleDefinition[];
  userGoal: string;
  currentPlan?: string;
  policyValidator?: RoleCallPolicyValidator;
  idFactory?: (prefix: string) => string;
  now?: () => string;
  defaultReason?: string;
  defaultExpectedOutput?: ExpectedOutputSpec;
  sourceRunId?: string;
  executeAcceptedRoleCalls?: (
    input: AssistantRoleCallExecutionInput
  ) => Promise<AssistantRoleCallExecutionResult>;
  roleCallSummary?: () => Promise<unknown> | unknown;
}

export interface ProcessAssistantRoleCallOutputResult {
  ok: boolean;
  processed: boolean;
  skippedReason?:
    | "missing_caller_role"
    | "not_successful_assistant_message"
    | "already_processed"
    | "no_intents";
  parseWarnings: string[];
  executionWarnings: string[];
  ledgerSummaries: RoleCallLedgerSummary[];
}

export async function processAssistantRoleCallOutput(
  input: ProcessAssistantRoleCallOutputInput
): Promise<ProcessAssistantRoleCallOutputResult> {
  const now = input.now ?? nowIso;
  if (!input.callerRole) {
    return skippedRoleCallOutputResult("missing_caller_role");
  }
  if (input.message.role !== "assistant" || input.message.status !== "succeeded") {
    return skippedRoleCallOutputResult("not_successful_assistant_message");
  }
  if (input.message.metadata?.roleCallProcessed === true) {
    return skippedRoleCallOutputResult("already_processed");
  }

  const existingForMessage = (await input.repositories.roleCallRepository.list({
    threadId: input.threadId
  })).filter((call) => call.parentMessageId === input.message.id);
  if (existingForMessage.length > 0) {
    await markAssistantRoleCallOutputProcessed({
      repository: input.repositories.conversationMessageRepository,
      message: input.message,
      warnings: [],
      ledgerSummaries: [],
      roleCallSummary: await optionalRoleCallSummary(input),
      now
    });
    return {
      ok: true,
      processed: true,
      parseWarnings: [],
      executionWarnings: [],
      ledgerSummaries: []
    };
  }

  const parsed = parseRoleCallIntents(input.message.content, {
    knownRoles: input.roles,
    defaultReason:
      input.defaultReason ??
      `Line-start role mention emitted by @${input.callerRole}.`,
    defaultExpectedOutput: input.defaultExpectedOutput ?? { format: "summary" }
  });
  const parseWarnings = parsed.warnings.map((warning) => warning.message);
  if (parsed.intents.length === 0) {
    if (parseWarnings.length > 0) {
      await markAssistantRoleCallOutputProcessed({
        repository: input.repositories.conversationMessageRepository,
        message: input.message,
        warnings: parseWarnings,
        ledgerSummaries: [],
        roleCallSummary: await optionalRoleCallSummary(input),
        now
      });
    }
    return {
      ok: true,
      processed: parseWarnings.length > 0,
      skippedReason: "no_intents",
      parseWarnings,
      executionWarnings: [],
      ledgerSummaries: []
    };
  }

  const orchestrator = new RoleCallOrchestrator({
    repositories: {
      roleCallRepository: input.repositories.roleCallRepository,
      roleCallEventRepository: input.repositories.roleCallEventRepository,
      roleTodoRepository: input.repositories.roleTodoRepository,
      traceLinkRepository: input.repositories.traceLinkRepository
    },
    roles: input.roles,
    policyValidator: input.policyValidator,
    idFactory: input.idFactory,
    now
  });
  const ledgerSummaries = await orchestrator.processRoleIntents({
    threadId: input.threadId,
    callerRole: input.callerRole,
    intents: parsed.intents.map((entry) => entry.intent),
    userGoal: input.userGoal,
    parentMessageId: input.message.id,
    currentPlan: input.currentPlan ?? input.message.content,
    sourcePlanBinding: await resolveSourcePlanBinding(input)
  });
  let ok = true;
  let executionWarnings: string[] = [];
  if (input.executeAcceptedRoleCalls) {
    try {
      const execution = await input.executeAcceptedRoleCalls({
        parentMessageId: input.message.id,
        roleDefinitions: input.roles
      });
      ok = execution.ok;
      executionWarnings = [...(execution.warnings ?? [])];
    } catch (error) {
      ok = false;
      executionWarnings = [`RoleCall execution failed: ${roleCallErrorMessage(error)}`];
    }
  }

  await markAssistantRoleCallOutputProcessed({
    repository: input.repositories.conversationMessageRepository,
    message: input.message,
    warnings: [...parseWarnings, ...executionWarnings],
    ledgerSummaries,
    roleCallSummary: await optionalRoleCallSummary(input),
    now
  });
  return {
    ok,
    processed: true,
    parseWarnings,
    executionWarnings,
    ledgerSummaries
  };
}

export async function markAssistantRoleCallOutputProcessed(input: {
  repository: ConversationMessageRepository;
  message: ConversationMessage;
  warnings: readonly string[];
  ledgerSummaries: readonly RoleCallLedgerSummary[];
  roleCallSummary?: unknown;
  now?: () => string;
}): Promise<ConversationMessage> {
  const now = input.now ?? nowIso;
  const metadata: JsonObject = {
    ...(input.message.metadata ?? {}),
    roleCallProcessed: true,
    roleCallProcessedAt: now(),
    roleCallParseWarnings: [...input.warnings],
    roleCallLedgerSummaries: input.ledgerSummaries.map(roleCallLedgerSummaryMetadata)
  };
  if (input.roleCallSummary !== undefined) {
    metadata.roleCallSummary = input.roleCallSummary;
  }
  return input.repository.update(
    validateConversationMessage({
      ...input.message,
      metadata
    })
  );
}

function skippedRoleCallOutputResult(
  skippedReason: NonNullable<ProcessAssistantRoleCallOutputResult["skippedReason"]>
): ProcessAssistantRoleCallOutputResult {
  return {
    ok: true,
    processed: false,
    skippedReason,
    parseWarnings: [],
    executionWarnings: [],
    ledgerSummaries: []
  };
}

async function optionalRoleCallSummary(
  input: Pick<ProcessAssistantRoleCallOutputInput, "roleCallSummary">
): Promise<unknown> {
  return input.roleCallSummary ? input.roleCallSummary() : undefined;
}

async function resolveSourcePlanBinding(
  input: ProcessAssistantRoleCallOutputInput
): Promise<RoleCallSourcePlanBinding | undefined> {
  const sourceRunId = input.sourceRunId ?? input.message.runId;
  if (!sourceRunId || !input.repositories.runMetadataRepository) {
    return undefined;
  }
  const metadata = await input.repositories.runMetadataRepository.get(sourceRunId);
  const binding = metadata?.planBinding;
  if (!binding) {
    return undefined;
  }
  return {
    sourceRunId,
    planGraphId: binding.planGraphId,
    planGraphVersion: binding.planGraphVersion,
    planNodeId: binding.planNodeId,
    ...(binding.traceNodeId ? { traceNodeId: binding.traceNodeId } : {}),
    allowedNextPlanNodeIds: [...binding.allowedNextPlanNodeIds]
  };
}

function roleCallLedgerSummaryMetadata(summary: RoleCallLedgerSummary): JsonObject {
  const value: JsonObject = {
    status: summary.status,
    message: summary.message
  };
  if (summary.roleCallId) {
    value.roleCallId = summary.roleCallId;
  }
  if (summary.targetRole) {
    value.targetRole = summary.targetRole;
  }
  if (summary.decision) {
    value.decision = summary.decision;
  }
  if (summary.reasons && summary.reasons.length > 0) {
    value.reasons = [...summary.reasons];
  }
  return value;
}

function roleCallErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
