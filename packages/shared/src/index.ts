import { randomUUID } from "node:crypto";
import {
  findWorkgroupRoleByHandle as importedFindWorkgroupRoleByHandle,
  normalizeWorkgroupRoleHandle as importedNormalizeWorkgroupRoleHandle,
  presetWorkgroupRoleHandles as importedPresetWorkgroupRoleHandles,
  presetWorkgroupRoles as importedPresetWorkgroupRoles,
  toWorkgroupRoleRunMetadata as importedToWorkgroupRoleRunMetadata,
  workgroupExecutorKinds as importedWorkgroupExecutorKinds
} from "./workgroup-roles";
import {
  builtInWorkgroupPacks as importedBuiltInWorkgroupPacks,
  coreWorkgroupSurfaceLabels as importedCoreWorkgroupSurfaceLabels,
  engineeringTermSurface as importedEngineeringTermSurface,
  getBuiltInWorkgroupPack as importedGetBuiltInWorkgroupPack,
  labelWorkgroupVocabulary as importedLabelWorkgroupVocabulary,
  listBuiltInWorkgroupPacks as importedListBuiltInWorkgroupPacks,
  requireBuiltInWorkgroupPack as importedRequireBuiltInWorkgroupPack,
  validateWorkgroupPackDefinition as importedValidateWorkgroupPackDefinition
} from "./workgroup-packs";

export * from "./process-environment";
export type {
  PresetWorkgroupRoleHandle,
  WorkgroupAgentAdapterExecutor,
  WorkgroupAgentAdapterKind,
  WorkgroupApprovalPolicy,
  WorkgroupContextPolicy,
  WorkgroupExecutor,
  WorkgroupExecutorKind,
  WorkgroupReservedExecutor,
  WorkgroupRole,
  WorkgroupRoleRunMetadata,
  WorkgroupTaskAssignmentMetadata,
  WorkgroupTaskAssignmentStatus
} from "./workgroup-roles";
export type {
  EngineeringVocabularyTerm,
  WorkgroupPack,
  WorkgroupPackArtifactType,
  WorkgroupPackCheckType,
  WorkgroupPackContextSectionProvider,
  WorkgroupPackExecutorCapability,
  WorkgroupPackId,
  WorkgroupPackLabels,
  WorkgroupPackRiskCategory,
  WorkgroupSurfaceTerm,
  WorkgroupVocabularyTerm
} from "./workgroup-packs";

export const findWorkgroupRoleByHandle = importedFindWorkgroupRoleByHandle;
export const normalizeWorkgroupRoleHandle = importedNormalizeWorkgroupRoleHandle;
export const presetWorkgroupRoleHandles = importedPresetWorkgroupRoleHandles;
export const presetWorkgroupRoles = importedPresetWorkgroupRoles;
export const toWorkgroupRoleRunMetadata = importedToWorkgroupRoleRunMetadata;
export const workgroupExecutorKinds = importedWorkgroupExecutorKinds;
export const builtInWorkgroupPacks = importedBuiltInWorkgroupPacks;
export const coreWorkgroupSurfaceLabels = importedCoreWorkgroupSurfaceLabels;
export const engineeringTermSurface = importedEngineeringTermSurface;
export const getBuiltInWorkgroupPack = importedGetBuiltInWorkgroupPack;
export const labelWorkgroupVocabulary = importedLabelWorkgroupVocabulary;
export const listBuiltInWorkgroupPacks = importedListBuiltInWorkgroupPacks;
export const requireBuiltInWorkgroupPack = importedRequireBuiltInWorkgroupPack;
export const validateWorkgroupPackDefinition =
  importedValidateWorkgroupPackDefinition;

export const agentKinds = ["fake", "codex", "claude-code"] as const;
export type AgentKind = (typeof agentKinds)[number];

export const contextDeliveryModes = [
  "runtime_injection",
  "worktree_overlay",
  "repo_export"
] as const;
export type ContextDeliveryMode = (typeof contextDeliveryModes)[number];

export const runContextDeliveryModes = [
  "runtime_injection",
  "worktree_overlay"
] as const;
export type RunContextDeliveryMode = (typeof runContextDeliveryModes)[number];

export const contextStoreModes = ["external", "repo_local"] as const;
export type ContextStoreMode = (typeof contextStoreModes)[number];

export const skillScopes = ["task", "role", "project", "global"] as const;
export type SkillScope = (typeof skillScopes)[number];

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

export const conversationMessageRoles = [
  "user",
  "assistant",
  "system",
  "tool"
] as const;
export type ConversationMessageRole = (typeof conversationMessageRoles)[number];

export const conversationMessageKinds = [
  "text",
  "run_card"
] as const;
export type ConversationMessageKind = (typeof conversationMessageKinds)[number];

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
  metadata?: JsonObject;
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
  parentRunId?: string;
  parentMessageId?: string;
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

export interface ConversationThread {
  id: string;
  projectId: string;
  title: string;
  metadata?: JsonObject;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessage {
  id: string;
  threadId: string;
  sequence: number;
  role: ConversationMessageRole;
  kind: ConversationMessageKind;
  content: string;
  agentKind?: AgentKind;
  runId?: string;
  status?: TaskRunStatus;
  metadata?: JsonObject;
  createdAt: string;
}

export interface ConversationThreadSummary {
  id: string;
  threadId: string;
  summary: string;
  decisions: string[];
  openItems: string[];
  constraints: string[];
  lastKnownUserGoal?: string;
  sourceMessageCount: number;
  sourceLatestMessageId?: string;
  metadata?: JsonObject;
  createdAt: string;
  updatedAt: string;
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
  details?: JsonObject;
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

export interface Setting {
  key: string;
  value: unknown;
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
  injectedSkills?: InjectedSkillEvidence[];
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


export interface ShellCommand {
  executable: string;
  args?: string[];
  displayName?: string;
}

export interface ShellResult {
  command: ShellCommand;
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal?: NodeJS.Signals | string | null;
  durationMs: number;
  timedOut: boolean;
  dryRun: boolean;
  error?: string;
}

export function formatShellCommand(command: ShellCommand): string {
  return [command.executable, ...(command.args ?? [])]
    .map((part) => (/\s/.test(part) ? JSON.stringify(part) : part))
    .join(" ");
}

export type ChangedFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "unknown";

export interface ChangedFile {
  path: string;
  status: ChangedFileStatus;
  binary?: boolean;
  sizeBytes?: number;
  symlink?: boolean;
  symlinkTarget?: string;
  omittedReason?: string;
}

export interface DiffStat {
  filesChanged: number;
  insertions: number;
  deletions: number;
  text: string;
}

export interface DiffCollectionResult {
  ok: boolean;
  workspacePath: string;
  isClean: boolean;
  changedFiles: ChangedFile[];
  stat: DiffStat;
  diff: string;
  fileSummaries: string[];
  commands: ShellResult[];
  error?: string;
}

export interface VerificationCommand {
  id: string;
  label?: string;
  command: string;
  args?: string[];
  timeoutMs?: number;
  continueOnFailure?: boolean;
}

export interface VerificationCommandResult {
  commandId: string;
  label: string;
  command: ShellCommand;
  status: VerificationStatus;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal?: NodeJS.Signals | string | null;
  durationMs: number;
  timedOut: boolean;
  dryRun: boolean;
  skippedReason?: string;
  error?: string;
}

export interface VerificationSuiteResult {
  status: VerificationStatus;
  results: VerificationCommandResult[];
  failedCommands: VerificationCommandResult[];
  missingCommandConfig: boolean;
  summary: string;
  durationMs: number;
}

export type WorkspaceCleanupPolicy =
  | "always"
  | "on_success"
  | "retain_on_failure"
  | "never";

export interface Workspace {
  path: string;
  branchName: string;
  sourceRepositoryPath: string;
  workspaceBasePath: string;
  taskId: string;
  runId: string;
  agentKind: AgentKind;
  startPoint?: string;
  dryRun: boolean;
  sourceRepositoryDirty: boolean;
  cleanupPolicy: WorkspaceCleanupPolicy;
}

export interface WorkspaceCleanupResult {
  cleaned: boolean;
  retained: boolean;
  reason: string;
  commands: ShellResult[];
}

export type ContextSourceKind =
  | "task"
  | "agent"
  | "repository"
  | "project"
  | "conversation"
  | "memory"
  | "skill"
  | "user_constraint"
  | "execution_hint";

export interface TargetRepositoryMetadata {
  id: string;
  name: string;
  rootPath: string;
}

export interface ContextSource {
  kind: ContextSourceKind;
  id: string;
  label: string;
}

export interface ContextSection {
  id: string;
  title: string;
  body: string;
  source: ContextSource;
  order: number;
}

export interface ContextBundle {
  id: string;
  taskPrompt: string;
  selectedAgentId: AgentKind;
  targetRepository: TargetRepositoryMetadata;
  sections: ContextSection[];
  warnings: string[];
}

export interface MemoryContextItem {
  id: string;
  content: string;
}

export interface SkillContextItem {
  id: string;
  name: string;
  description: string;
  content?: string;
  scope?: SkillScope;
  contentHash?: string;
  sourcePath?: string;
}

export interface SkillReference {
  id: string;
  scope?: SkillScope;
}

export interface InjectedSkillEvidence {
  id: string;
  scope: SkillScope;
  name: string;
  description: string;
  contentHash: string;
  sourcePath?: string;
}

export interface ProjectContext {
  summary?: string;
  warnings?: string[];
}
