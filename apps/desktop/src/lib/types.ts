export type AgentId = "fake" | "codex" | "claude";
export type AgentKind = AgentId;
export type MemoryCategory =
  | "project_fact"
  | "workflow_rule"
  | "user_preference"
  | "temporary_note";
export type RiskLevel = "low" | "medium" | "high" | "blocking";
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
export type VerificationStatus = "passed" | "failed" | "skipped";
export type EventPhase =
  | "lifecycle"
  | "context"
  | "agent"
  | "logs"
  | "verification"
  | "final";

export interface RiskFinding {
  level: RiskLevel;
  summary: string;
  details?: string;
}

export type ContextMode = "auto" | "minimal" | "full";

export interface ProjectSummary {
  id: string;
  name: string;
  rootPath: string;
  updatedAt: string;
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
}

export interface DiffSummary {
  runId: string;
  changedFiles: string[];
  fileSummaries: string[];
  stat: {
    filesChanged: number;
    insertions: number;
    deletions: number;
    text?: string;
  };
  unifiedDiff: string;
  truncated: boolean;
  isPlaceholder: boolean;
}

export interface VerificationItem {
  id: string;
  command: string;
  status: VerificationStatus;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  createdAt: string;
}

export interface VerificationReport {
  runId: string;
  status: VerificationStatus;
  summary: string;
  results: VerificationItem[];
}

export interface RiskReport {
  id: string;
  runId: string;
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

export interface MemoryProposal {
  id: string;
  projectId: string;
  taskId?: string;
  category: MemoryCategory;
  content: string;
  createdAt: string;
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
  review: {
    getDiff(runId: string): Promise<DiffSummary>;
    getRisk(runId: string): Promise<RiskReport>;
    getVerification(runId: string): Promise<VerificationReport>;
  };
  memory: {
    listProposals(runId: string): Promise<MemoryProposal[]>;
    approve(ids: string[]): Promise<void>;
    ignore(ids: string[]): Promise<void>;
  };
}
