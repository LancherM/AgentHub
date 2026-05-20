import path from "node:path";
import {
  DomainValidationError,
  agentKinds,
  conversationMessageKinds,
  conversationMessageRoles,
  contextDeliveryModes,
  memoryCategories,
  memoryStatuses,
  riskLevels,
  runEventTypes,
  taskRunStatuses,
  taskStatuses,
  verificationStatuses,
  type AgentProfile,
  type ComparisonReport,
  type ConversationMessage,
  type ConversationThread,
  type ConversationThreadSummary,
  type ContextPack,
  type MemoryItem,
  type MemoryStatus,
  type Project,
  type RiskReport,
  type RunArtifact,
  type RunEvent,
  type Setting,
  type Skill,
  type Task,
  type TaskBrief,
  type TaskRun,
  type TaskRunStatus,
  type TaskStatus,
  type VerificationResult
} from "@agent-hub/shared";

export * from "@agent-hub/shared";

export class DomainStateTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainStateTransitionError";
  }
}

export function validateTaskStatusTransition(
  from: TaskStatus,
  to: TaskStatus
): void {
  validateStatusTransition(from, to, taskStatusTransitions, "task");
}

export function validateTaskRunStatusTransition(
  from: TaskRunStatus,
  to: TaskRunStatus
): void {
  validateStatusTransition(from, to, taskRunStatusTransitions, "task run");
}

export function validateMemoryStatusTransition(
  from: MemoryStatus,
  to: MemoryStatus
): void {
  validateStatusTransition(from, to, memoryStatusTransitions, "memory item");
}

export function validateProject(input: Project): Project {
  const issues: string[] = [];
  required(input.id, "project.id", issues);
  required(input.name, "project.name", issues);
  required(input.rootPath, "project.rootPath", issues);
  if (input.rootPath && !path.isAbsolute(input.rootPath)) {
    issues.push("project.rootPath must be absolute");
  }
  timestamp(input.createdAt, "project.createdAt", issues);
  timestamp(input.updatedAt, "project.updatedAt", issues);
  return finish(input, issues);
}

export function validateAgentProfile(input: AgentProfile): AgentProfile {
  const issues: string[] = [];
  required(input.id, "agentProfile.id", issues);
  enumValue(input.kind, agentKinds, "agentProfile.kind", issues);
  required(input.displayName, "agentProfile.displayName", issues);
  optionalString(input.command, "agentProfile.command", issues);
  if (typeof input.enabled !== "boolean") {
    issues.push("agentProfile.enabled must be a boolean");
  }
  timestamp(input.createdAt, "agentProfile.createdAt", issues);
  timestamp(input.updatedAt, "agentProfile.updatedAt", issues);
  return finish(input, issues);
}

export function validateTask(input: Task): Task {
  const issues: string[] = [];
  required(input.id, "task.id", issues);
  required(input.projectId, "task.projectId", issues);
  required(input.title, "task.title", issues);
  optionalString(input.description, "task.description", issues);
  enumValue(input.status, taskStatuses, "task.status", issues);
  timestamp(input.createdAt, "task.createdAt", issues);
  timestamp(input.updatedAt, "task.updatedAt", issues);
  return finish(input, issues);
}

export function validateTaskRun(input: TaskRun): TaskRun {
  const issues: string[] = [];
  required(input.id, "taskRun.id", issues);
  required(input.taskId, "taskRun.taskId", issues);
  optionalString(input.agentProfileId, "taskRun.agentProfileId", issues);
  enumValue(input.agentKind, agentKinds, "taskRun.agentKind", issues);
  enumValue(input.status, taskRunStatuses, "taskRun.status", issues);
  optionalString(input.worktreePath, "taskRun.worktreePath", issues);
  optionalString(input.branchName, "taskRun.branchName", issues);
  optionalString(input.parentRunId, "taskRun.parentRunId", issues);
  optionalString(input.parentMessageId, "taskRun.parentMessageId", issues);
  optionalTimestamp(input.startedAt, "taskRun.startedAt", issues);
  optionalTimestamp(input.completedAt, "taskRun.completedAt", issues);
  timestamp(input.createdAt, "taskRun.createdAt", issues);
  timestamp(input.updatedAt, "taskRun.updatedAt", issues);
  return finish(input, issues);
}

export function validateRunEvent(input: RunEvent): RunEvent {
  const issues: string[] = [];
  required(input.id, "runEvent.id", issues);
  required(input.taskRunId, "runEvent.taskRunId", issues);
  if (!Number.isInteger(input.sequence) || input.sequence < 0) {
    issues.push("runEvent.sequence must be a non-negative integer");
  }
  enumValue(input.type, runEventTypes, "runEvent.type", issues);
  required(input.message, "runEvent.message", issues);
  objectValue(input.metadata, "runEvent.metadata", issues);
  timestamp(input.createdAt, "runEvent.createdAt", issues);
  return finish(input, issues);
}

export function validateRunArtifact(input: RunArtifact): RunArtifact {
  const issues: string[] = [];
  required(input.id, "runArtifact.id", issues);
  required(input.taskRunId, "runArtifact.taskRunId", issues);
  required(input.kind, "runArtifact.kind", issues);
  required(input.content, "runArtifact.content", issues);
  objectValue(input.metadata, "runArtifact.metadata", issues);
  timestamp(input.createdAt, "runArtifact.createdAt", issues);
  return finish(input, issues);
}

export function validateConversationThread(
  input: ConversationThread
): ConversationThread {
  const issues: string[] = [];
  required(input.id, "conversationThread.id", issues);
  required(input.projectId, "conversationThread.projectId", issues);
  required(input.title, "conversationThread.title", issues);
  optionalObject(input.metadata, "conversationThread.metadata", issues);
  optionalTimestamp(input.archivedAt, "conversationThread.archivedAt", issues);
  timestamp(input.createdAt, "conversationThread.createdAt", issues);
  timestamp(input.updatedAt, "conversationThread.updatedAt", issues);
  return finish(input, issues);
}

export function validateConversationMessage(
  input: ConversationMessage
): ConversationMessage {
  const issues: string[] = [];
  required(input.id, "conversationMessage.id", issues);
  required(input.threadId, "conversationMessage.threadId", issues);
  if (!Number.isInteger(input.sequence) || input.sequence < 0) {
    issues.push("conversationMessage.sequence must be a non-negative integer");
  }
  enumValue(input.role, conversationMessageRoles, "conversationMessage.role", issues);
  enumValue(input.kind, conversationMessageKinds, "conversationMessage.kind", issues);
  required(input.content, "conversationMessage.content", issues);
  if (input.agentKind !== undefined) {
    enumValue(input.agentKind, agentKinds, "conversationMessage.agentKind", issues);
  }
  optionalString(input.runId, "conversationMessage.runId", issues);
  if (input.status !== undefined) {
    enumValue(input.status, taskRunStatuses, "conversationMessage.status", issues);
  }
  optionalObject(input.metadata, "conversationMessage.metadata", issues);
  timestamp(input.createdAt, "conversationMessage.createdAt", issues);
  return finish(input, issues);
}

export function validateConversationThreadSummary(
  input: ConversationThreadSummary
): ConversationThreadSummary {
  const issues: string[] = [];
  required(input.id, "conversationThreadSummary.id", issues);
  required(input.threadId, "conversationThreadSummary.threadId", issues);
  required(input.summary, "conversationThreadSummary.summary", issues);
  stringArray(input.decisions, "conversationThreadSummary.decisions", issues);
  stringArray(input.openItems, "conversationThreadSummary.openItems", issues);
  stringArray(input.constraints, "conversationThreadSummary.constraints", issues);
  optionalString(
    input.lastKnownUserGoal,
    "conversationThreadSummary.lastKnownUserGoal",
    issues
  );
  if (!Number.isInteger(input.sourceMessageCount) || input.sourceMessageCount < 0) {
    issues.push("conversationThreadSummary.sourceMessageCount must be a non-negative integer");
  }
  optionalString(
    input.sourceLatestMessageId,
    "conversationThreadSummary.sourceLatestMessageId",
    issues
  );
  optionalObject(input.metadata, "conversationThreadSummary.metadata", issues);
  timestamp(input.createdAt, "conversationThreadSummary.createdAt", issues);
  timestamp(input.updatedAt, "conversationThreadSummary.updatedAt", issues);
  return finish(input, issues);
}

export function validateVerificationResult(
  input: VerificationResult
): VerificationResult {
  const issues: string[] = [];
  required(input.id, "verificationResult.id", issues);
  required(input.taskRunId, "verificationResult.taskRunId", issues);
  required(input.command, "verificationResult.command", issues);
  enumValue(input.status, verificationStatuses, "verificationResult.status", issues);
  optionalInteger(input.exitCode, "verificationResult.exitCode", issues);
  optionalString(input.stdout, "verificationResult.stdout", issues);
  optionalString(input.stderr, "verificationResult.stderr", issues);
  optionalTimestamp(input.startedAt, "verificationResult.startedAt", issues);
  optionalTimestamp(input.completedAt, "verificationResult.completedAt", issues);
  timestamp(input.createdAt, "verificationResult.createdAt", issues);
  return finish(input, issues);
}

export function validateComparisonReport(input: ComparisonReport): ComparisonReport {
  const issues: string[] = [];
  required(input.id, "comparisonReport.id", issues);
  required(input.taskId, "comparisonReport.taskId", issues);
  optionalString(input.baselineRunId, "comparisonReport.baselineRunId", issues);
  optionalString(input.candidateRunId, "comparisonReport.candidateRunId", issues);
  required(input.summary, "comparisonReport.summary", issues);
  optionalObject(input.details, "comparisonReport.details", issues);
  timestamp(input.createdAt, "comparisonReport.createdAt", issues);
  return finish(input, issues);
}

export function validateMemoryItem(input: MemoryItem): MemoryItem {
  const issues: string[] = [];
  required(input.id, "memoryItem.id", issues);
  required(input.projectId, "memoryItem.projectId", issues);
  optionalString(input.taskId, "memoryItem.taskId", issues);
  enumValue(input.category, memoryCategories, "memoryItem.category", issues);
  enumValue(input.status, memoryStatuses, "memoryItem.status", issues);
  required(input.content, "memoryItem.content", issues);
  timestamp(input.createdAt, "memoryItem.createdAt", issues);
  timestamp(input.updatedAt, "memoryItem.updatedAt", issues);
  return finish(input, issues);
}

export function validateRiskReport(input: RiskReport): RiskReport {
  const issues: string[] = [];
  required(input.id, "riskReport.id", issues);
  required(input.taskRunId, "riskReport.taskRunId", issues);
  enumValue(input.level, riskLevels, "riskReport.level", issues);
  required(input.summary, "riskReport.summary", issues);
  stringArray(input.changedFiles, "riskReport.changedFiles", issues);
  required(input.verificationSummary, "riskReport.verificationSummary", issues);
  stringArray(input.failedChecks, "riskReport.failedChecks", issues);
  stringArray(input.riskFactors, "riskReport.riskFactors", issues);
  stringArray(input.manualReviewChecklist, "riskReport.manualReviewChecklist", issues);
  required(
    input.acceptanceRecommendation,
    "riskReport.acceptanceRecommendation",
    issues
  );
  if (!Array.isArray(input.findings)) {
    issues.push("riskReport.findings must be an array");
  } else {
    input.findings.forEach((finding, index) => {
      enumValue(finding.level, riskLevels, `riskReport.findings.${index}.level`, issues);
      required(finding.summary, `riskReport.findings.${index}.summary`, issues);
      optionalString(finding.details, `riskReport.findings.${index}.details`, issues);
    });
  }
  timestamp(input.createdAt, "riskReport.createdAt", issues);
  return finish(input, issues);
}

export function validateSkill(input: Skill): Skill {
  const issues: string[] = [];
  required(input.id, "skill.id", issues);
  optionalString(input.projectId, "skill.projectId", issues);
  required(input.name, "skill.name", issues);
  required(input.description, "skill.description", issues);
  required(input.path, "skill.path", issues);
  timestamp(input.createdAt, "skill.createdAt", issues);
  timestamp(input.updatedAt, "skill.updatedAt", issues);
  return finish(input, issues);
}

export function validateSetting(input: Setting): Setting {
  const issues: string[] = [];
  required(input.key, "setting.key", issues);
  secretFreeSettingKey(input.key, "setting.key", issues);
  if (input.value === undefined) {
    issues.push("setting.value is required");
  } else {
    secretFreeSettingValue(input.value, "setting.value", issues, new WeakSet<object>());
  }
  timestamp(input.updatedAt, "setting.updatedAt", issues);
  return finish(input, issues);
}

export function validateContextPack(input: ContextPack): ContextPack {
  const issues: string[] = [];
  required(input.id, "contextPack.id", issues);
  required(input.projectId, "contextPack.projectId", issues);
  required(input.taskId, "contextPack.taskId", issues);
  optionalString(input.taskTitle, "contextPack.taskTitle", issues);
  optionalString(input.taskPrompt, "contextPack.taskPrompt", issues);
  enumValue(input.deliveryMode, contextDeliveryModes, "contextPack.deliveryMode", issues);
  stringArray(input.contextSections, "contextPack.contextSections", issues);
  stringArray(input.approvedMemorySections, "contextPack.approvedMemorySections", issues);
  stringArray(input.skillReferences, "contextPack.skillReferences", issues);
  timestamp(input.createdAt, "contextPack.createdAt", issues);
  return finish(input, issues);
}

export function validateTaskBrief(input: TaskBrief): TaskBrief {
  const issues: string[] = [];
  required(input.taskId, "taskBrief.taskId", issues);
  required(input.taskTitle, "taskBrief.taskTitle", issues);
  optionalString(input.taskPrompt, "taskBrief.taskPrompt", issues);
  required(input.renderedContent, "taskBrief.renderedContent", issues);
  required(input.contextPackId, "taskBrief.contextPackId", issues);
  timestamp(input.createdAt, "taskBrief.createdAt", issues);
  return finish(input, issues);
}

function required(value: unknown, field: string, issues: string[]): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(`${field} is required`);
  }
}

function optionalString(value: unknown, field: string, issues: string[]): void {
  if (value !== undefined && typeof value !== "string") {
    issues.push(`${field} must be a string when provided`);
  }
}

function timestamp(value: unknown, field: string, issues: string[]): void {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    issues.push(`${field} must be an ISO-style timestamp`);
  }
}

function optionalTimestamp(value: unknown, field: string, issues: string[]): void {
  if (value !== undefined) {
    timestamp(value, field, issues);
  }
}

function optionalInteger(value: unknown, field: string, issues: string[]): void {
  if (value !== undefined && !Number.isInteger(value)) {
    issues.push(`${field} must be an integer when provided`);
  }
}

function objectValue(value: unknown, field: string, issues: string[]): void {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    issues.push(`${field} must be an object`);
  }
}

function optionalObject(value: unknown, field: string, issues: string[]): void {
  if (value !== undefined) {
    objectValue(value, field, issues);
  }
}

function stringArray(value: unknown, field: string, issues: string[]): void {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    issues.push(`${field} must be an array of strings`);
  }
}

function secretFreeSettingKey(value: unknown, field: string, issues: string[]): void {
  if (typeof value !== "string") {
    return;
  }
  if (isSecretLikeSettingKey(value)) {
    issues.push(`${field} must not store secrets`);
  }
}

function secretFreeSettingValue(
  value: unknown,
  field: string,
  issues: string[],
  seen: WeakSet<object>
): void {
  if (typeof value === "string") {
    if (
      secretLikeSettingValuePatterns.some((pattern) => pattern.test(value)) ||
      containsSecretLikeAssignment(value)
    ) {
      issues.push(`${field} must not store secret-like string values`);
    }
    return;
  }

  if (value === null || typeof value !== "object") {
    return;
  }

  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      secretFreeSettingValue(entry, `${field}.${index}`, issues, seen);
    });
    return;
  }

  Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
    secretFreeSettingKey(key, `${field}.${key}`, issues);
    secretFreeSettingValue(entry, `${field}.${key}`, issues, seen);
  });
}

function enumValue<T extends readonly string[]>(
  value: unknown,
  values: T,
  field: string,
  issues: string[]
): void {
  if (typeof value !== "string" || !values.includes(value)) {
    issues.push(`${field} must be one of ${values.join(", ")}`);
  }
}

const taskStatusTransitions: Record<TaskStatus, readonly TaskStatus[]> = {
  open: ["running", "cancelled"],
  running: ["open", "completed", "cancelled"],
  completed: [],
  cancelled: []
};

const taskRunStatusTransitions: Record<TaskRunStatus, readonly TaskRunStatus[]> = {
  queued: ["running", "cancelled"],
  running: ["succeeded", "failed", "cancelled"],
  succeeded: [],
  failed: [],
  cancelled: []
};

const memoryStatusTransitions: Record<MemoryStatus, readonly MemoryStatus[]> = {
  proposed: ["approved", "rejected"],
  approved: [],
  rejected: []
};

const secretLikeSettingValuePatterns = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i,
  /\b(api[_-]?key|token|password|private[_-]?key|credentials?)\b\s*[:=]\s*["']?[^"'\s]+/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/i,
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|sk-[A-Za-z0-9]{20,})\b/i
];

const secretLikeAssignmentPattern =
  /([A-Za-z0-9_.:-]+)\s*[:=]\s*["']?[^"'\s]+/g;

function isSecretLikeSettingKey(key: string): boolean {
  const terms = splitSettingKeyTerms(key);
  return terms.some((term, index) =>
    term === "token" ||
    term === "secret" ||
    term === "password" ||
    term === "credential" ||
    term === "credentials" ||
    term === "apikey" ||
    term === "privatekey" ||
    (term === "api" && terms[index + 1] === "key") ||
    (term === "private" && terms[index + 1] === "key")
  );
}

function splitSettingKeyTerms(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[._:\-\s]+/)
    .map((term) => term.toLowerCase())
    .filter((term) => term.length > 0);
}

function containsSecretLikeAssignment(value: string): boolean {
  for (const match of value.matchAll(secretLikeAssignmentPattern)) {
    const key = match[1];
    if (key && isSecretLikeSettingKey(key)) {
      return true;
    }
  }
  return false;
}

function validateStatusTransition<T extends string>(
  from: T,
  to: T,
  transitions: Record<T, readonly T[]>,
  label: string
): void {
  if (from === to) {
    return;
  }
  if (!transitions[from]?.includes(to)) {
    throw new DomainStateTransitionError(
      `invalid ${label} status transition ${from} -> ${to}`
    );
  }
}

function finish<T>(input: T, issues: string[]): T {
  if (issues.length > 0) {
    throw new DomainValidationError(issues);
  }

  return input;
}
