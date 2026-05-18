export type AgentKind = "fake" | "codex" | "claude-code";
export type MemoryCategory =
  | "project_fact"
  | "workflow_rule"
  | "user_preference"
  | "temporary_note";
export type RiskLevel = "low" | "medium" | "high" | "blocking";
export type RunEventType =
  | "stdout"
  | "stderr"
  | "message"
  | "status"
  | "error"
  | "exit";
export type TaskRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";
export type VerificationStatus = "passed" | "failed" | "skipped";

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
  agentKind: AgentKind;
  status: TaskRunStatus;
  createdAt: string;
  updatedAt: string;
}

export interface RunEvent {
  id: string;
  runId: string;
  sequence: number;
  type: RunEventType;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
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
  agentKind: AgentKind;
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
