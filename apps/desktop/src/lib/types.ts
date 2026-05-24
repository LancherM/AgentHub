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
export type RunInspectorTab =
  | "summary"
  | "diff"
  | "tests"
  | "risk"
  | "memory"
  | "logs";

export type ReviewStatus = "pending" | "accepted" | "rejected";
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
  createdAt: string;
  updatedAt: string;
  messages: ThreadMessage[];
}

interface BaseThreadMessage {
  id: string;
  threadId: string;
  createdAt: string;
}

export interface UserMessage extends BaseThreadMessage {
  type: "user";
  text: string;
  mentions: AgentId[];
}

export interface AgentRunMessage extends BaseThreadMessage {
  type: "agent_run";
  runId: string;
  agentId: AgentId;
  status: RunStatus;
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
}

export type ThreadMessage =
  | UserMessage
  | AgentRunMessage
  | AssistantMessage
  | SystemMessage;

export interface CreateThreadInput {
  projectId?: string;
  title?: string;
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
  projectId: string;
  prompt: string;
  title?: string;
  agentId: AgentId;
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
    getDiff(runId: string): Promise<DiffSummary>;
    getRisk(runId: string): Promise<RiskReport>;
    getVerification(runId: string): Promise<VerificationReport>;
    getLogs(runId: string): Promise<RunLog[]>;
    accept(runId: string): Promise<ReviewSummary>;
    reject(runId: string, reason?: string): Promise<ReviewSummary>;
    refresh(runId: string): Promise<ReviewSummary>;
  };
  memory: {
    listProposals(runId: string): Promise<MemoryProposal[]>;
    generateProposalsForRun(runId: string): Promise<MemoryProposal[]>;
    approve(ids: string[]): Promise<void>;
    ignore(ids: string[]): Promise<void>;
  };
  settings: {
    getVerification(projectId: string): Promise<VerificationSettings>;
    saveVerification(input: VerificationSettings): Promise<VerificationSettings>;
  };
}
