import path from "node:path";
import { randomUUID } from "node:crypto";

export const agentKinds = ["fake", "codex", "claude-code"] as const;
export type AgentKind = (typeof agentKinds)[number];

export const contextDeliveryModes = [
  "runtime_injection",
  "worktree_overlay",
  "repo_export"
] as const;
export type ContextDeliveryMode = (typeof contextDeliveryModes)[number];

export const contextStoreModes = ["external", "repo_local"] as const;
export type ContextStoreMode = (typeof contextStoreModes)[number];

export const taskStatuses = ["open", "running", "completed", "cancelled"] as const;
export type TaskStatus = (typeof taskStatuses)[number];

export const taskRunStatuses = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled"
] as const;
export type TaskRunStatus = (typeof taskRunStatuses)[number];

export const runEventTypes = [
  "stdout",
  "stderr",
  "message",
  "status",
  "error",
  "exit"
] as const;
export type RunEventType = (typeof runEventTypes)[number];

export const verificationStatuses = ["passed", "failed", "skipped"] as const;
export type VerificationStatus = (typeof verificationStatuses)[number];

export const memoryCategories = [
  "project_fact",
  "workflow_rule",
  "user_preference",
  "temporary_note"
] as const;
export type MemoryCategory = (typeof memoryCategories)[number];

export const memoryStatuses = ["proposed", "approved", "rejected"] as const;
export type MemoryStatus = (typeof memoryStatuses)[number];

export const riskLevels = ["low", "medium", "high", "blocking"] as const;
export type RiskLevel = (typeof riskLevels)[number];

export type JsonObject = Record<string, unknown>;

export interface Project {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentProfile {
  id: string;
  kind: AgentKind;
  displayName: string;
  command?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TaskRun {
  id: string;
  taskId: string;
  agentProfileId?: string;
  agentKind: AgentKind;
  status: TaskRunStatus;
  worktreePath?: string;
  branchName?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunEvent {
  id: string;
  taskRunId: string;
  sequence: number;
  type: RunEventType;
  message: string;
  metadata: JsonObject;
  createdAt: string;
}

export interface RunArtifact {
  id: string;
  taskRunId: string;
  kind: string;
  content: string;
  metadata: JsonObject;
  createdAt: string;
}

export interface VerificationResult {
  id: string;
  taskRunId: string;
  command: string;
  status: VerificationStatus;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}

export interface ComparisonReport {
  id: string;
  taskId: string;
  baselineRunId?: string;
  candidateRunId?: string;
  summary: string;
  createdAt: string;
}

export interface MemoryItem {
  id: string;
  projectId: string;
  taskId?: string;
  category: MemoryCategory;
  status: MemoryStatus;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface RiskFinding {
  level: RiskLevel;
  summary: string;
  details?: string;
}

export interface RiskReport {
  id: string;
  taskRunId: string;
  level: RiskLevel;
  summary: string;
  changedFiles: string[];
  verificationSummary: string;
  failedChecks: string[];
  riskFactors: string[];
  manualReviewChecklist: string[];
  acceptanceRecommendation: string;
  findings: RiskFinding[];
  createdAt: string;
}

export interface Skill {
  id: string;
  projectId?: string;
  name: string;
  description: string;
  path: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContextPack {
  id: string;
  projectId: string;
  taskId: string;
  taskTitle?: string;
  taskPrompt?: string;
  deliveryMode: ContextDeliveryMode;
  contextSections: string[];
  approvedMemorySections: string[];
  skillReferences: string[];
  createdAt: string;
}

export interface TaskBrief {
  taskId: string;
  taskTitle: string;
  taskPrompt?: string;
  renderedContent: string;
  contextPackId: string;
  createdAt: string;
}

export class DomainValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid domain object: ${issues.join("; ")}`);
    this.name = "DomainValidationError";
    this.issues = issues;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function createId(prefix: string): string {
  const cleanPrefix = prefix.trim().replace(/[^a-z0-9_-]+/gi, "_");
  if (cleanPrefix.length === 0) {
    throw new DomainValidationError(["id prefix is required"]);
  }

  return `${cleanPrefix}_${randomUUID()}`;
}

export function parseAgentKind(value: string): AgentKind {
  return parseEnum(value, agentKinds, "agent kind");
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

function stringArray(value: unknown, field: string, issues: string[]): void {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    issues.push(`${field} must be an array of strings`);
  }
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

function parseEnum<T extends readonly string[]>(
  value: string,
  values: T,
  label: string
): T[number] {
  if (values.includes(value)) {
    return value;
  }

  throw new DomainValidationError([`${label} must be one of ${values.join(", ")}`]);
}

function finish<T>(input: T, issues: string[]): T {
  if (issues.length > 0) {
    throw new DomainValidationError(issues);
  }

  return input;
}
