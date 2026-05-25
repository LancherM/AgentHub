import type {
  JsonObject,
  WorkgroupRole,
  WorkgroupRoleRunMetadata,
  WorkgroupTaskAssignmentMetadata
} from "@agent-hub/shared";

export type AgentId = "fake" | "codex" | "claude";
export type AgentKind = AgentId;
export type MemoryCategory =
  | "project_fact"
  | "workflow_rule"
  | "user_preference"
  | "temporary_note";
export type ReviewRiskLevel =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "blocking"
  | "unknown";
export type RiskSeverity = "low" | "medium" | "high" | "blocking";
export type RunEventType =
  | "run_started"
  | "context_compiled"
  | "agent_step"
  | "agent_output"
  | "verification_started"
  | "verification_finished"
  | "run_completed"
  | "run_failed"
  | "run_cancelled";
export type RunStatus =
  | "queued"
  | "running"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled";
export type TaskRunStatus = RunStatus;
export type VerificationStatus = "passed" | "failed" | "skipped" | "unknown";
export type EventPhase =
  | "lifecycle"
  | "context"
  | "agent"
  | "logs"
  | "verification"
  | "final";

export type ContextMode = "auto" | "minimal" | "full" | "workspace";
export type RoomType = "default" | "custom" | "legacy";
export type WorkgroupInspectorTab =
  | "brief"
  | "context"
  | "artifacts"
  | "checks"
  | "risks"
  | "memory"
  | "audit";
export type LegacyRunInspectorTab =
  | "summary"
  | "diff"
  | "tests"
  | "risk"
  | "handoff"
  | "compare"
  | "logs";
export type RunInspectorTab = WorkgroupInspectorTab | LegacyRunInspectorTab;

export type TimelineEventKind =
  | "user_message"
  | "participant_message"
  | "system_event"
  | "task_created"
  | "assignment_created"
  | "assignment_start_failed"
  | "run_started"
  | "run_completed"
  | "run_failed"
  | "run_cancelled"
  | "artifact_created"
  | "check_completed"
  | "risk_detected"
  | "memory_proposed"
  | "review_decision";
export type TimelineEventActor = "user" | "system" | "agent" | "assistant";
export type TimelineEventTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "accent";

export interface TimelineEventLinkedIds extends JsonObject {
  taskId?: string;
  runId?: string;
  assignmentId?: string;
  assignmentIds?: string[];
  artifactId?: string;
  memoryItemId?: string;
  reviewArtifactId?: string;
}

export interface TimelineEventChip extends JsonObject {
  kind: TimelineEventKind;
  label: string;
  tone?: TimelineEventTone;
  tab?: RunInspectorTab;
}

export interface TimelineEventMetadata extends JsonObject {
  kind: TimelineEventKind;
  actor: TimelineEventActor;
  title?: string;
  summary?: string;
  status?: string;
  tone?: TimelineEventTone;
  linkedIds?: TimelineEventLinkedIds;
  chips?: TimelineEventChip[];
}

export type ReviewStatus = "pending" | "accepted" | "rejected";
export type HandoffCopyKind =
  | "worktree_path"
  | "branch_name"
  | "review_commands";
export type ChangedFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "unknown";
export type RiskCategory =
  | "auth"
  | "security"
  | "data"
  | "migration"
  | "dependency"
  | "test"
  | "config"
  | "generated"
  | "large_change"
  | "unknown";
export type MemoryProposalSource = "run" | "diff" | "verification" | "manual";
export type MemoryProposalStatus = "pending" | "approved" | "ignored";
export type RunLogLevel = "info" | "stdout" | "stderr" | "error" | "debug";
export type KnowledgeItemKind =
  | "memory"
  | "thread_summary"
  | "thread_decision"
  | "review_decision";
export type KnowledgeItemStatus =
  | "proposed"
  | "approved"
  | "rejected"
  | "summary"
  | "accepted"
  | "decision";
export type KnowledgeSourceKind =
  | "thread"
  | "message"
  | "task"
  | "run"
  | "artifact";
export type TeamRoleSource = "preset" | "preset_override" | "custom";
export type TeamRoleStatus = "enabled" | "disabled";

export interface ProjectSummary {
  id: string;
  name: string;
  rootPath: string;
  updatedAt: string;
}

export interface ThreadSummary {
  id: string;
  title: string;
  projectId?: string;
  roomType?: RoomType;
  roomHandle?: string;
  description?: string;
  pinned?: boolean;
  createdAt: string;
  updatedAt: string;
  lastMessagePreview?: string;
  activeRunCount?: number;
  runCount?: number;
}

export interface ThreadDetail {
  id: string;
  title: string;
  projectId?: string;
  roomType?: RoomType;
  roomHandle?: string;
  description?: string;
  pinned?: boolean;
  createdAt: string;
  updatedAt: string;
  messages: ThreadMessage[];
}

interface BaseThreadMessage {
  id: string;
  threadId: string;
  timelineEvent?: TimelineEventMetadata;
  createdAt: string;
}

export interface UserMessage extends BaseThreadMessage {
  type: "user";
  text: string;
  mentions: AgentId[];
  roleMentions?: WorkgroupRoleRunMetadata[];
}

export interface AgentRunMessage extends BaseThreadMessage {
  type: "agent_run";
  runId: string;
  agentId: AgentId;
  status: RunStatus;
  taskId?: string;
  taskTitle?: string;
  assignment?: WorkgroupTaskAssignmentMetadata;
}

export interface AssistantMessage extends BaseThreadMessage {
  type: "assistant";
  text: string;
  agentId?: AgentId;
  runId?: string;
  status?: RunStatus;
}

export interface SystemMessage extends BaseThreadMessage {
  type: "system";
  text: string;
  metadata?: JsonObject;
}

export type ThreadMessage =
  | UserMessage
  | AgentRunMessage
  | AssistantMessage
  | SystemMessage;

export interface CreateThreadInput {
  projectId?: string;
  title?: string;
  roomType?: RoomType;
  roomHandle?: string;
  description?: string;
  pinned?: boolean;
}

export interface SendThreadMessageInput {
  threadId?: string;
  projectId?: string;
  text: string;
  contextMode?: ContextMode;
  agents?: AgentId[];
  continueFromRunId?: string;
  continueFromMessageId?: string;
}

export interface RunSummary {
  id: string;
  projectId: string;
  projectName: string;
  taskId: string;
  title: string;
  taskPrompt: string;
  agentId: AgentId;
  status: RunStatus;
  parentRunId?: string;
  parentMessageId?: string;
  canContinueCodeState: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RunEventPayload extends Record<string, unknown> {
  message?: string;
  phase?: EventPhase;
  status?: RunStatus;
  command?: string;
  passed?: boolean;
  summary?: string;
}

export interface RunEvent {
  id: string;
  runId: string;
  sequence: number;
  type: RunEventType;
  timestamp: string;
  payload: RunEventPayload;
}

export interface RunDetail extends RunSummary {
  events: RunEvent[];
  changedFiles: string[];
  verification: VerificationReport;
  risk: RiskReport;
  memoryProposals: MemoryProposal[];
  summary: string;
}

export interface CreateRunInput {
  taskId?: string;
  projectId: string;
  prompt: string;
  title?: string;
  agentId: AgentId;
  role?: WorkgroupRoleRunMetadata;
  contextMode: ContextMode;
  deliveryMode?: "runtime_injection" | "worktree_overlay";
  continueFromRunId?: string;
  continueFromMessageId?: string;
}

export interface ReviewSummary {
  runId: string;
  agentId: AgentId;
  status: RunStatus;
  task: string;
  summary: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  changedFileCount: number;
  additions: number;
  deletions: number;
  verificationStatus: VerificationStatus;
  riskLevel: ReviewRiskLevel;
  memoryProposalCount: number;
  acceptedAt?: string;
  rejectedAt?: string;
  reviewStatus: ReviewStatus;
  parentRunId?: string;
  parentMessageId?: string;
  message?: string;
}

export interface ReviewContext {
  runId: string;
  available: boolean;
  content?: string;
  artifactId?: string;
  createdAt?: string;
  message?: string;
}

export type ReviewArtifactAvailability = "local" | "bounded";

export interface ReviewArtifact {
  id: string;
  runId: string;
  taskId: string;
  kind: string;
  artifactType: string;
  title: string;
  sourceRunId: string;
  sourceTaskId: string;
  threadId?: string;
  createdBy?: string;
  summary: string;
  createdAt: string;
  availability: ReviewArtifactAvailability;
  contentPreview?: string;
  contentCharacters: number;
  previewCharacters: number;
  truncated: boolean;
}

export interface ReviewHandoff {
  runId: string;
  available: boolean;
  worktreePath?: string;
  branchName?: string;
  baseRef?: string;
  headRef?: string;
  cleanup: {
    retained?: boolean;
    cleaned?: boolean;
    reason?: string;
  };
  changedFiles: ChangedFile[];
  commands: Array<{
    label: string;
    command: string;
  }>;
  message?: string;
}

export interface ReviewHandoffActionResult {
  ok: boolean;
  message: string;
}

export type ComparisonScopeKind = "task" | "conversation_turn";

export interface ComparisonCreateInput {
  baselineRunId: string;
  candidateRunId: string;
}

export interface ComparisonCandidate {
  runId: string;
  taskId: string;
  agentId: AgentId;
  status: RunStatus;
  title: string;
  scope: ComparisonScopeKind;
  createdAt: string;
}

export interface ComparisonReport {
  id: string;
  taskId: string;
  baselineRunId?: string;
  candidateRunId?: string;
  summary: string;
  details?: ComparisonStructuredSignals;
  scope: ComparisonScopeKind;
  createdAt: string;
}

export interface ComparisonStructuredSignals extends Record<string, unknown> {
  runs?: {
    baseline?: ComparisonRunSignal;
    candidate?: ComparisonRunSignal;
  };
  changedFiles?: {
    baselineCount?: number;
    candidateCount?: number;
    overlapCount?: number;
    overlapRatio?: number;
  };
  diffSize?: {
    baseline?: ComparisonDiffSizeSignal;
    candidate?: ComparisonDiffSizeSignal;
    fileDelta?: number;
    insertionDelta?: number;
    deletionDelta?: number;
    totalLineDelta?: number;
  };
  verification?: {
    baseline?: ComparisonVerificationSignal;
    candidate?: ComparisonVerificationSignal;
    failedCheckDelta?: number;
  };
  risk?: {
    baseline?: ComparisonRiskSignal;
    candidate?: ComparisonRiskSignal;
    rankDelta?: number;
  };
  score?: {
    baseline?: number;
    candidate?: number;
    winner?: "baseline" | "candidate" | "tie";
    reasons?: string[];
  };
  tradeoffs?: string[];
}

export interface ComparisonRunSignal {
  runId: string;
  agent: string;
  status: string;
  changedFiles: number;
  verification: string;
  risk: string;
}

export interface ComparisonDiffSizeSignal {
  filesChanged: number;
  insertions: number;
  deletions: number;
  totalLineChanges: number;
}

export interface ComparisonVerificationSignal {
  passed: number;
  failed: number;
  skipped: number;
}

export interface ComparisonRiskSignal {
  level: string;
  rank: number;
  factors: string[];
}

export interface RunContinuationTarget {
  parentRunId: string;
  parentMessageId?: string;
}

export interface ChangedFile {
  path: string;
  status: ChangedFileStatus;
  additions: number;
  deletions: number;
  isGenerated?: boolean;
  isTest?: boolean;
  isConfig?: boolean;
  isMigration?: boolean;
}

export interface DiffSummary {
  runId: string;
  baseRef?: string;
  headRef?: string;
  files: ChangedFile[];
  patch?: string;
  empty: boolean;
  message?: string;
  truncated?: boolean;
  originalPatchBytes?: number;
  patchBytes?: number;
}

export interface VerificationCommandResult {
  command: string;
  status: Exclude<VerificationStatus, "unknown">;
  exitCode?: number;
  durationMs?: number;
  stdout?: string;
  stderr?: string;
}

export interface VerificationReport {
  runId: string;
  status: VerificationStatus;
  commands: VerificationCommandResult[];
  message?: string;
}

export interface VerificationCommandConfig {
  id: string;
  label?: string;
  executable: string;
  args: string[];
  timeoutMs?: number;
  continueOnFailure?: boolean;
}

export interface VerificationSettings {
  projectId: string;
  commands: VerificationCommandConfig[];
  updatedAt?: string;
}

export interface RiskReport {
  runId: string;
  level: ReviewRiskLevel;
  findings: RiskFinding[];
  generatedAt: string;
  message?: string;
}

export interface RiskFinding {
  id: string;
  severity: RiskSeverity;
  title: string;
  description: string;
  evidence?: string;
  filePath?: string;
  category: RiskCategory;
}

export interface MemoryProposal {
  id: string;
  runId: string;
  content: string;
  rationale?: string;
  source: MemoryProposalSource;
  status: MemoryProposalStatus;
  createdAt: string;
  decidedAt?: string;
  approvedMemoryPath?: string;
}

export interface KnowledgeSourceLink {
  kind: KnowledgeSourceKind;
  id: string;
  label: string;
  threadId?: string;
  messageId?: string;
  taskId?: string;
  runId?: string;
  artifactId?: string;
  inspectorTab?: RunInspectorTab;
}

export interface KnowledgeAuditEvent {
  at: string;
  label: string;
  detail?: string;
}

export interface KnowledgeItem {
  id: string;
  kind: KnowledgeItemKind;
  status: KnowledgeItemStatus;
  title: string;
  content: string;
  preview: string;
  category?: MemoryCategory | "thread_summary" | "decision";
  source?: MemoryProposalSource | "thread_summary" | "review_decision";
  projectId: string;
  taskId?: string;
  runId?: string;
  threadId?: string;
  messageId?: string;
  artifactId?: string;
  createdAt: string;
  updatedAt: string;
  sourceLinks: KnowledgeSourceLink[];
  audit: KnowledgeAuditEvent[];
  bounded: boolean;
}

export interface KnowledgeWorkspaceMetrics {
  total: number;
  proposed: number;
  approved: number;
  rejected: number;
  summaries: number;
  decisions: number;
}

export interface KnowledgeWorkspace {
  projectId: string;
  generatedAt: string;
  metrics: KnowledgeWorkspaceMetrics;
  items: KnowledgeItem[];
}

export interface TeamRoleActivity {
  taskId: string;
  title: string;
  status: WorkgroupTaskAssignmentMetadata["status"];
  runId?: string;
  updatedAt: string;
}

export interface TeamRoleLinkedMemory {
  id: string;
  status: "proposed" | "approved" | "rejected";
  content: string;
  updatedAt: string;
}

export interface TeamRoleSummary {
  role: WorkgroupRole;
  source: TeamRoleSource;
  executorRunnable: boolean;
  executorLabel: string;
  permissionSummary: string;
  contextPolicySummary: string;
  approvalPolicySummary: string;
  status: TeamRoleStatus;
  recentActivity: TeamRoleActivity[];
  linkedMemory: TeamRoleLinkedMemory[];
}

export interface TeamWorkspaceMetrics {
  total: number;
  enabled: number;
  custom: number;
  presetOverrides: number;
  reservedExecutors: number;
}

export interface TeamWorkspace {
  projectId: string;
  generatedAt: string;
  metrics: TeamWorkspaceMetrics;
  roles: TeamRoleSummary[];
}

export interface SaveTeamRoleInput {
  projectId: string;
  role: WorkgroupRole;
}

export type MemoryApprovalWriteback = "written" | "already_present" | "skipped";

export interface MemoryApprovalResult {
  id: string;
  content?: string;
  status: "approved" | "skipped";
  approvedMemoryPath?: string;
  writeback: MemoryApprovalWriteback;
  message?: string;
}

export interface RunLog {
  id: string;
  runId: string;
  timestamp: string;
  level: RunLogLevel;
  message: string;
}

export type Unsubscribe = () => void;

export interface AgentHubApi {
  projects: {
    list(): Promise<ProjectSummary[]>;
    open(path: string): Promise<ProjectSummary>;
  };
  runs: {
    list(projectId?: string): Promise<RunSummary[]>;
    get(runId: string): Promise<RunDetail>;
    create(input: CreateRunInput): Promise<RunSummary>;
    cancel(runId: string): Promise<void>;
    onEvent(runId: string, callback: (event: RunEvent) => void): Unsubscribe;
  };
  threads: {
    list(): Promise<ThreadSummary[]>;
    create(input?: CreateThreadInput): Promise<ThreadSummary>;
    get(threadId: string): Promise<ThreadDetail>;
    sendMessage(input: SendThreadMessageInput): Promise<ThreadDetail>;
  };
  review: {
    getSummary(runId: string): Promise<ReviewSummary>;
    getContext(runId: string): Promise<ReviewContext>;
    getArtifacts(runId: string): Promise<ReviewArtifact[]>;
    getDiff(runId: string): Promise<DiffSummary>;
    getRisk(runId: string): Promise<RiskReport>;
    getVerification(runId: string): Promise<VerificationReport>;
    getLogs(runId: string): Promise<RunLog[]>;
    accept(runId: string): Promise<ReviewSummary>;
    reject(runId: string, reason?: string): Promise<ReviewSummary>;
    refresh(runId: string): Promise<ReviewSummary>;
    getHandoff(runId: string): Promise<ReviewHandoff>;
    openHandoffWorktree(runId: string): Promise<ReviewHandoffActionResult>;
    copyHandoffValue(
      runId: string,
      kind: HandoffCopyKind
    ): Promise<ReviewHandoffActionResult>;
  };
  comparison: {
    listCandidates(runId: string): Promise<ComparisonCandidate[]>;
    listForRun(runId: string): Promise<ComparisonReport[]>;
    create(input: ComparisonCreateInput): Promise<ComparisonReport>;
  };
  memory: {
    listProposals(runId: string): Promise<MemoryProposal[]>;
    generateProposalsForRun(runId: string): Promise<MemoryProposal[]>;
    approve(ids: string[]): Promise<MemoryApprovalResult[]>;
    ignore(ids: string[]): Promise<void>;
  };
  knowledge: {
    getWorkspace(projectId: string): Promise<KnowledgeWorkspace>;
  };
  team: {
    getWorkspace(projectId: string): Promise<TeamWorkspace>;
    saveRole(input: SaveTeamRoleInput): Promise<TeamRoleSummary>;
  };
  settings: {
    getVerification(projectId: string): Promise<VerificationSettings>;
    saveVerification(input: VerificationSettings): Promise<VerificationSettings>;
  };
}
