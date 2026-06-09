import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  validateAgentProfile,
  validateCodeGraphEntry,
  validateComparisonReport,
  validateConversationMessage,
  validateConversationThread,
  validateConversationThreadSummary,
  validateContextEvalEvent,
  validateContextIndexEntry,
  validateMemoryItem,
  validateProject,
  validateRiskReport,
  validateRoleCall,
  validateRoleCallEvent,
  validateRoleCallStatusTransition,
  validateRoleTodo,
  validateRoleTodoStatusTransition,
  validateRunArtifact,
  validateRunEvent,
  validateSetting,
  validateSkill,
  validateTask,
  validateTaskRun,
  validateVerificationResult,
  validateMemoryStatusTransition,
  validateTaskRunStatusTransition,
  validateTaskStatusTransition,
  type AgentKind,
  type AgentProfile,
  type CodeGraphEntry,
  type CodeGraphRebuildResult,
  type CodeGraphSearchInput,
  type CodeGraphSearchResult,
  type ComparisonReport,
  type ConversationMessage,
  type ConversationThread,
  type ConversationThreadSummary,
  type ContextEvalEvent,
  type ContextIndexEntry,
  type ContextIndexSearchInput,
  type ContextIndexSearchResult,
  normalizePathSet,
  normalizeSearchTerms,
  scoreCodeGraphEntry,
  type MemoryItem,
  type Project,
  type RiskReport,
  type RiskLevel,
  type RoleCall,
  type RoleCallEvent,
  type RoleCallStatus,
  type RoleTodo,
  type RoleTodoStatus,
  type RunArtifact,
  type RunEvent,
  type RunEventType,
  type Setting,
  type Skill,
  type Task,
  type TaskRun,
  type TaskRunStatus,
  type TaskStatus,
  type VerificationResult,
  type VerificationStatus
} from "@agent-hub/core";
import {
  cloneRunMetadata,
  type AgentProfileRepository,
  type ComparisonReportRepository,
  type ConversationMessageRepository,
  type ConversationThreadSummaryRepository,
  type ConversationThreadRepository,
  type ContextEvalEventRepository,
  type ContextIndexRepository,
  type CodeGraphRepository,
  type MemoryItemRepository,
  type ProjectRepository,
  type RiskReportRepository,
  type RoleCallEventRepository,
  type RoleCallListFilter,
  type RoleCallRepository,
  type RoleTodoListFilter,
  type RoleTodoRepository,
  type RunArtifactRepository,
  type RunEventRepository,
  type RunMetadata,
  type RunMetadataRepository,
  type RunStatusTransition,
  type SettingsRepository,
  type SkillRepository,
  type TaskRepository,
  type TaskRunRepository,
  type VerificationResultRepository
} from "@agent-hub/core";

type SqlitePrimitive = string | number | bigint | Buffer | null;
type SqliteParameterValue = SqlitePrimitive | boolean | undefined;
type SqliteParameterMap = Record<string, SqliteParameterValue>;
type SqliteParameters = SqliteParameterValue[] | SqliteParameterMap;

interface NativeSqliteStatement {
  all(parameters?: SqliteParameters): Record<string, unknown>[];
  run(parameters?: SqliteParameters): unknown;
}

interface NativeSqliteConnection {
  exec(sql: string): void;
  prepare(sql: string): NativeSqliteStatement;
  pragma(sql: string): unknown;
  close(): void;
}

interface NativeSqliteConstructor {
  new(databasePath: string, options?: { timeout?: number }): NativeSqliteConnection;
}

const BetterSqlite3 = require("better-sqlite3") as NativeSqliteConstructor;

export interface SqliteStorageOptions {
  databasePath?: string;
}

export interface SqliteRepositories {
  database: SqliteDatabase;
  projectRepository: ProjectRepository;
  agentProfileRepository: AgentProfileRepository;
  taskRepository: TaskRepository;
  taskRunRepository: TaskRunRepository;
  runEventRepository: RunEventRepository;
  runArtifactRepository: RunArtifactRepository;
  verificationResultRepository: VerificationResultRepository;
  riskReportRepository: RiskReportRepository;
  runMetadataRepository: RunMetadataRepository;
  conversationThreadRepository: ConversationThreadRepository;
  conversationMessageRepository: ConversationMessageRepository;
  conversationThreadSummaryRepository: ConversationThreadSummaryRepository;
  memoryItemRepository: MemoryItemRepository;
  comparisonReportRepository: ComparisonReportRepository;
  skillRepository: SkillRepository;
  contextIndexRepository: ContextIndexRepository;
  codeGraphRepository: CodeGraphRepository;
  contextEvalEventRepository: ContextEvalEventRepository;
  settingsRepository: SettingsRepository;
  roleCallRepository: RoleCallRepository;
  roleCallEventRepository: RoleCallEventRepository;
  roleTodoRepository: RoleTodoRepository;
}

export interface StableContextIndexRebuildInput {
  projectId: string;
  projectContextStoreRoot: string;
  contextIndexRepository: ContextIndexRepository;
  globalSkillStoreRoot?: string;
  indexedAt?: string;
}

export async function rebuildStableContextIndex(
  input: StableContextIndexRebuildInput
) {
  const indexedAt = input.indexedAt ?? new Date().toISOString();
  const skipped: Array<{ sourcePath?: string; reason: string }> = [];
  const entries: ContextIndexEntry[] = [];

  for (const relativePath of stableProjectContextFiles) {
    const sourcePath = path.join(input.projectContextStoreRoot, relativePath);
    const content = await readTextIfExists(sourcePath);
    if (!content || content.trim().length === 0 || isPlaceholderContextFile(relativePath, content)) {
      continue;
    }
    if (secretLikePathReason(sourcePath)) {
      skipped.push({ sourcePath, reason: secretLikePathReason(sourcePath) ?? "secret-like path" });
      continue;
    }
    entries.push(contextIndexEntry({
      projectId: input.projectId,
      sourceKind: "project_context",
      sourceId: relativePath,
      layer: "project",
      scope: "project",
      trustLevel: "high",
      lifetime: "static",
      title: contextTitle(relativePath),
      content,
      sourcePath,
      indexedAt,
      metadata: { relativePath }
    }));
  }

  const approvedMemoryPath = path.join(
    input.projectContextStoreRoot,
    "memory",
    "approved.md"
  );
  const approvedMemory = approvedMemoryContent(
    await readTextIfExists(approvedMemoryPath) ?? ""
  );
  if (approvedMemory.length > 0) {
    if (secretLikePathReason(approvedMemoryPath)) {
      skipped.push({
        sourcePath: approvedMemoryPath,
        reason: secretLikePathReason(approvedMemoryPath) ?? "secret-like path"
      });
    } else {
      entries.push(contextIndexEntry({
        projectId: input.projectId,
        sourceKind: "approved_memory",
        sourceId: "memory/approved.md",
        layer: "approved_memory",
        scope: "project",
        trustLevel: "high",
        lifetime: "approved",
        title: "Approved Memory",
        content: approvedMemory,
        sourcePath: approvedMemoryPath,
        indexedAt,
        metadata: { relativePath: "memory/approved.md" }
      }));
    }
  }

  entries.push(
    ...(await readSkillIndexEntries({
      projectId: input.projectId,
      storeRoot: input.projectContextStoreRoot,
      sourceKind: "project_skill",
      indexedAt,
      skipped
    }))
  );
  if (input.globalSkillStoreRoot) {
    entries.push(
      ...(await readSkillIndexEntries({
        projectId: input.projectId,
        storeRoot: input.globalSkillStoreRoot,
        sourceKind: "global_skill",
        indexedAt,
        skipped
      }))
    );
  }

  const result = await input.contextIndexRepository.rebuildProject(
    input.projectId,
    entries,
    indexedAt
  );
  return {
    ...result,
    skippedCount: skipped.length,
    skipped
  };
}

export const SQLITE_MIGRATIONS: Array<{
  version: number;
  sql: string;
  transaction?: boolean;
}> = [
  {
    version: 1,
    sql: `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  agent_profile_id TEXT,
  agent_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  worktree_path TEXT,
  branch_name TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_runs_task_id ON task_runs(task_id);

CREATE TABLE IF NOT EXISTS run_metadata (
  run_id TEXT PRIMARY KEY,
  workspace_json TEXT,
  workspace_cleanup_json TEXT,
  diff_json TEXT,
  verification_json TEXT,
  risk_report_json TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS status_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL,
  at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_status_transitions_run_id
  ON status_transitions(run_id, id);
`
  },
  {
    version: 2,
    sql: `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_root_path
  ON projects(root_path);

CREATE TABLE IF NOT EXISTS agent_profiles (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('fake', 'codex', 'claude-code')),
  display_name TEXT NOT NULL,
  command TEXT,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_profiles_kind ON agent_profiles(kind);
CREATE INDEX IF NOT EXISTS idx_agent_profiles_enabled ON agent_profiles(enabled);
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project_id, status);
CREATE INDEX IF NOT EXISTS idx_task_runs_task_agent ON task_runs(task_id, agent_kind);
CREATE INDEX IF NOT EXISTS idx_task_runs_status ON task_runs(status);

CREATE TABLE IF NOT EXISTS run_events (
  id TEXT PRIMARY KEY,
  task_run_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  type TEXT NOT NULL CHECK (type IN ('stdout', 'stderr', 'message', 'status', 'error', 'exit')),
  message TEXT NOT NULL,
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_run_id) REFERENCES task_runs(id) ON DELETE CASCADE,
  UNIQUE (task_run_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_run_events_run_sequence
  ON run_events(task_run_id, sequence);

CREATE TABLE IF NOT EXISTS run_artifacts (
  id TEXT PRIMARY KEY,
  task_run_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_run_id) REFERENCES task_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_run_artifacts_run_created
  ON run_artifacts(task_run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_run_artifacts_kind ON run_artifacts(kind);

CREATE TABLE IF NOT EXISTS verification_results (
  id TEXT PRIMARY KEY,
  task_run_id TEXT NOT NULL,
  command TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'skipped')),
  exit_code INTEGER,
  stdout TEXT,
  stderr TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_run_id) REFERENCES task_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_verification_results_run
  ON verification_results(task_run_id);
CREATE INDEX IF NOT EXISTS idx_verification_results_run_status
  ON verification_results(task_run_id, status);

CREATE TABLE IF NOT EXISTS risk_reports (
  id TEXT PRIMARY KEY,
  task_run_id TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('low', 'medium', 'high', 'blocking')),
  summary TEXT NOT NULL,
  findings_json TEXT NOT NULL CHECK (json_valid(findings_json) AND json_type(findings_json) = 'array'),
  changed_files_json TEXT NOT NULL CHECK (json_valid(changed_files_json) AND json_type(changed_files_json) = 'array'),
  verification_summary TEXT NOT NULL,
  failed_checks_json TEXT NOT NULL CHECK (json_valid(failed_checks_json) AND json_type(failed_checks_json) = 'array'),
  risk_factors_json TEXT NOT NULL CHECK (json_valid(risk_factors_json) AND json_type(risk_factors_json) = 'array'),
  manual_review_checklist_json TEXT NOT NULL CHECK (json_valid(manual_review_checklist_json) AND json_type(manual_review_checklist_json) = 'array'),
  acceptance_recommendation TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_run_id) REFERENCES task_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_risk_reports_run ON risk_reports(task_run_id);
CREATE INDEX IF NOT EXISTS idx_risk_reports_level ON risk_reports(level);

CREATE TABLE IF NOT EXISTS comparison_reports (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  baseline_run_id TEXT,
  candidate_run_id TEXT,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (baseline_run_id) REFERENCES task_runs(id) ON DELETE SET NULL,
  FOREIGN KEY (candidate_run_id) REFERENCES task_runs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_comparison_reports_task
  ON comparison_reports(task_id);

CREATE TABLE IF NOT EXISTS memory_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT,
  category TEXT NOT NULL CHECK (category IN ('project_fact', 'workflow_rule', 'user_preference', 'temporary_note')),
  status TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'rejected')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_items_project ON memory_items(project_id);
CREATE INDEX IF NOT EXISTS idx_memory_items_status ON memory_items(status);
CREATE INDEX IF NOT EXISTS idx_memory_items_project_status
  ON memory_items(project_id, status);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_skills_project ON skills(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_skills_project_name
  ON skills(project_id, name);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  updated_at TEXT NOT NULL
);
`
  },
  {
    version: 3,
    transaction: false,
    sql: `
PRAGMA foreign_keys = OFF;
PRAGMA legacy_alter_table = ON;
BEGIN;

CREATE TEMP TABLE migration_guard (ok INTEGER NOT NULL);

INSERT INTO projects (id, name, root_path, created_at, updated_at)
SELECT
  missing_projects.project_id,
  CASE
    WHEN missing_projects.project_id = 'adhoc_project' THEN 'Ad-hoc Project'
    ELSE missing_projects.project_id
  END,
  '/agent-hub/legacy-projects/' || missing_projects.project_id,
  missing_projects.created_at,
  missing_projects.updated_at
FROM (
  SELECT
    tasks.project_id,
    COALESCE(MIN(tasks.created_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) AS created_at,
    COALESCE(MAX(tasks.updated_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) AS updated_at
  FROM tasks
  LEFT JOIN projects ON projects.id = tasks.project_id
  WHERE projects.id IS NULL
  GROUP BY tasks.project_id
) AS missing_projects;

INSERT INTO migration_guard (ok)
SELECT CASE
  WHEN EXISTS (
    SELECT 1
    FROM tasks
    LEFT JOIN projects ON projects.id = tasks.project_id
    WHERE projects.id IS NULL
  ) THEN NULL
  ELSE 1
END;

INSERT INTO migration_guard (ok)
SELECT CASE
  WHEN EXISTS (
    SELECT 1
    FROM task_runs
    LEFT JOIN tasks ON tasks.id = task_runs.task_id
    WHERE tasks.id IS NULL
  ) THEN NULL
  ELSE 1
END;

INSERT INTO migration_guard (ok)
SELECT CASE
  WHEN EXISTS (
    SELECT 1
    FROM task_runs
    WHERE agent_profile_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM agent_profiles
        WHERE agent_profiles.id = task_runs.agent_profile_id
      )
  ) THEN NULL
  ELSE 1
END;

INSERT INTO migration_guard (ok)
SELECT CASE
  WHEN EXISTS (
    SELECT 1
    FROM tasks
    WHERE status NOT IN ('open', 'running', 'completed', 'cancelled')
  ) THEN NULL
  ELSE 1
END;

INSERT INTO migration_guard (ok)
SELECT CASE
  WHEN EXISTS (
    SELECT 1
    FROM task_runs
    WHERE agent_kind NOT IN ('fake', 'codex', 'claude-code')
      OR status NOT IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')
  ) THEN NULL
  ELSE 1
END;

DROP TABLE migration_guard;

ALTER TABLE tasks RENAME TO tasks_old;

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL CHECK (status IN ('open', 'running', 'completed', 'cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

INSERT INTO tasks (
  id, project_id, title, description, status, created_at, updated_at
)
SELECT id, project_id, title, description, status, created_at, updated_at
FROM tasks_old;

DROP TABLE tasks_old;

ALTER TABLE task_runs RENAME TO task_runs_old;

CREATE TABLE task_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  agent_profile_id TEXT,
  agent_kind TEXT NOT NULL CHECK (agent_kind IN ('fake', 'codex', 'claude-code')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  worktree_path TEXT,
  branch_name TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_profile_id) REFERENCES agent_profiles(id) ON DELETE SET NULL
);

INSERT INTO task_runs (
  id,
  task_id,
  agent_profile_id,
  agent_kind,
  status,
  worktree_path,
  branch_name,
  started_at,
  completed_at,
  created_at,
  updated_at
)
SELECT
  id,
  task_id,
  agent_profile_id,
  agent_kind,
  status,
  worktree_path,
  branch_name,
  started_at,
  completed_at,
  created_at,
  updated_at
FROM task_runs_old;

DROP TABLE task_runs_old;

CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project_id, status);
CREATE INDEX IF NOT EXISTS idx_task_runs_task_id ON task_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_task_runs_task_agent ON task_runs(task_id, agent_kind);
CREATE INDEX IF NOT EXISTS idx_task_runs_status ON task_runs(status);

INSERT INTO schema_migrations (version, applied_at)
VALUES (3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
PRAGMA legacy_alter_table = OFF;
PRAGMA foreign_keys = ON;
`
  },
  {
    version: 4,
    sql: `
	CREATE TABLE IF NOT EXISTS conversation_threads (
	  id TEXT PRIMARY KEY,
	  project_id TEXT NOT NULL,
	  title TEXT NOT NULL,
	  metadata_json TEXT CHECK (metadata_json IS NULL OR json_valid(metadata_json)),
	  archived_at TEXT,
	  created_at TEXT NOT NULL,
	  updated_at TEXT NOT NULL,
	  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_conversation_threads_project_updated
	  ON conversation_threads(project_id, updated_at);

	CREATE TABLE IF NOT EXISTS conversation_messages (
	  id TEXT PRIMARY KEY,
	  thread_id TEXT NOT NULL,
	  sequence INTEGER NOT NULL CHECK (sequence >= 0),
	  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
	  kind TEXT NOT NULL CHECK (kind IN ('text', 'run_card')),
	  content TEXT NOT NULL,
	  agent_kind TEXT CHECK (agent_kind IS NULL OR agent_kind IN ('fake', 'codex', 'claude-code')),
	  run_id TEXT,
	  status TEXT CHECK (status IS NULL OR status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
	  metadata_json TEXT CHECK (metadata_json IS NULL OR json_valid(metadata_json)),
	  created_at TEXT NOT NULL,
	  FOREIGN KEY (thread_id) REFERENCES conversation_threads(id) ON DELETE CASCADE,
	  FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE SET NULL,
	  UNIQUE (thread_id, sequence)
	);

	CREATE INDEX IF NOT EXISTS idx_conversation_messages_thread_sequence
	  ON conversation_messages(thread_id, sequence);
	CREATE INDEX IF NOT EXISTS idx_conversation_messages_run
	  ON conversation_messages(run_id);
	`
  },
  {
    version: 5,
    sql: `
ALTER TABLE comparison_reports
  ADD COLUMN details_json TEXT CHECK (details_json IS NULL OR json_valid(details_json));
`
  },
  {
    version: 6,
    sql: `
CREATE TABLE IF NOT EXISTS conversation_thread_summaries (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL UNIQUE,
  summary TEXT NOT NULL,
  decisions_json TEXT NOT NULL CHECK (json_valid(decisions_json)),
  open_items_json TEXT NOT NULL CHECK (json_valid(open_items_json)),
  constraints_json TEXT NOT NULL CHECK (json_valid(constraints_json)),
  last_known_user_goal TEXT,
  source_message_count INTEGER NOT NULL CHECK (source_message_count >= 0),
  source_latest_message_id TEXT,
  metadata_json TEXT CHECK (metadata_json IS NULL OR json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES conversation_threads(id) ON DELETE CASCADE,
  FOREIGN KEY (source_latest_message_id) REFERENCES conversation_messages(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_conversation_thread_summaries_thread
  ON conversation_thread_summaries(thread_id);
`
  },
  {
    version: 7,
    transaction: false,
    sql: `
PRAGMA foreign_keys = OFF;
PRAGMA legacy_alter_table = ON;
BEGIN;

ALTER TABLE risk_reports RENAME TO risk_reports_old;

CREATE TABLE risk_reports (
  id TEXT PRIMARY KEY,
  task_run_id TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('low', 'medium', 'high', 'blocking')),
  summary TEXT NOT NULL,
  findings_json TEXT NOT NULL CHECK (json_valid(findings_json) AND json_type(findings_json) = 'array'),
  changed_files_json TEXT NOT NULL CHECK (json_valid(changed_files_json) AND json_type(changed_files_json) = 'array'),
  verification_summary TEXT NOT NULL,
  failed_checks_json TEXT NOT NULL CHECK (json_valid(failed_checks_json) AND json_type(failed_checks_json) = 'array'),
  risk_factors_json TEXT NOT NULL CHECK (json_valid(risk_factors_json) AND json_type(risk_factors_json) = 'array'),
  manual_review_checklist_json TEXT NOT NULL CHECK (json_valid(manual_review_checklist_json) AND json_type(manual_review_checklist_json) = 'array'),
  acceptance_recommendation TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_run_id) REFERENCES task_runs(id) ON DELETE CASCADE
);

INSERT INTO risk_reports (
  id,
  task_run_id,
  level,
  summary,
  findings_json,
  changed_files_json,
  verification_summary,
  failed_checks_json,
  risk_factors_json,
  manual_review_checklist_json,
  acceptance_recommendation,
  created_at
)
SELECT
  id,
  task_run_id,
  level,
  summary,
  CASE WHEN json_type(findings_json) = 'array' THEN findings_json ELSE '[]' END,
  CASE WHEN json_type(changed_files_json) = 'array' THEN changed_files_json ELSE '[]' END,
  verification_summary,
  CASE WHEN json_type(failed_checks_json) = 'array' THEN failed_checks_json ELSE '[]' END,
  CASE WHEN json_type(risk_factors_json) = 'array' THEN risk_factors_json ELSE '[]' END,
  CASE WHEN json_type(manual_review_checklist_json) = 'array' THEN manual_review_checklist_json ELSE '[]' END,
  acceptance_recommendation,
  created_at
FROM risk_reports_old;

DROP TABLE risk_reports_old;

CREATE INDEX IF NOT EXISTS idx_risk_reports_run ON risk_reports(task_run_id);
CREATE INDEX IF NOT EXISTS idx_risk_reports_level ON risk_reports(level);

INSERT INTO schema_migrations (version, applied_at)
VALUES (7, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
PRAGMA foreign_keys = ON;
PRAGMA legacy_alter_table = OFF;
`
  },
  {
    version: 8,
    sql: `
CREATE TABLE IF NOT EXISTS conversation_thread_summaries (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL UNIQUE,
  summary TEXT NOT NULL,
  decisions_json TEXT NOT NULL CHECK (json_valid(decisions_json)),
  open_items_json TEXT NOT NULL CHECK (json_valid(open_items_json)),
  constraints_json TEXT NOT NULL CHECK (json_valid(constraints_json)),
  last_known_user_goal TEXT,
  source_message_count INTEGER NOT NULL CHECK (source_message_count >= 0),
  source_latest_message_id TEXT,
  metadata_json TEXT CHECK (metadata_json IS NULL OR json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES conversation_threads(id) ON DELETE CASCADE,
  FOREIGN KEY (source_latest_message_id) REFERENCES conversation_messages(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_conversation_thread_summaries_thread
  ON conversation_thread_summaries(thread_id);
`
  },
  {
    version: 9,
    sql: `
ALTER TABLE task_runs
  ADD COLUMN parent_run_id TEXT REFERENCES task_runs(id) ON DELETE SET NULL;

ALTER TABLE task_runs
  ADD COLUMN parent_message_id TEXT REFERENCES conversation_messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_task_runs_parent_run
  ON task_runs(parent_run_id);
CREATE INDEX IF NOT EXISTS idx_task_runs_parent_message
  ON task_runs(parent_message_id);
`
  },
  {
    version: 10,
    sql: `
ALTER TABLE run_metadata
  ADD COLUMN role_json TEXT CHECK (role_json IS NULL OR json_valid(role_json));
`
  },
  {
    version: 11,
    sql: `
ALTER TABLE tasks
  ADD COLUMN metadata_json TEXT CHECK (metadata_json IS NULL OR json_valid(metadata_json));
`
  },
  {
    version: 12,
    sql: `
CREATE TABLE IF NOT EXISTS role_calls (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  parent_message_id TEXT,
  parent_role_call_id TEXT,
  caller_role TEXT NOT NULL,
  callee_role TEXT NOT NULL,
  task TEXT NOT NULL,
  reason TEXT,
  context_json TEXT NOT NULL CHECK (json_valid(context_json) AND json_type(context_json) = 'object'),
  permissions_json TEXT NOT NULL CHECK (json_valid(permissions_json) AND json_type(permissions_json) = 'object'),
  expected_output_json TEXT NOT NULL CHECK (json_valid(expected_output_json) AND json_type(expected_output_json) = 'object'),
  priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  depth INTEGER NOT NULL CHECK (depth >= 0),
  status TEXT NOT NULL CHECK (
    status IN (
      'proposed',
      'assessing',
      'accepted',
      'queued',
      'running',
      'deferred',
      'rejected',
      'waiting_context',
      'waiting_approval',
      'succeeded',
      'failed',
      'cancelled'
    )
  ),
  decision_json TEXT CHECK (decision_json IS NULL OR (json_valid(decision_json) AND json_type(decision_json) = 'object')),
  result_json TEXT CHECK (result_json IS NULL OR (json_valid(result_json) AND json_type(result_json) = 'object')),
  task_run_id TEXT,
  todo_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (thread_id) REFERENCES conversation_threads(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_message_id) REFERENCES conversation_messages(id) ON DELETE SET NULL,
  FOREIGN KEY (parent_role_call_id) REFERENCES role_calls(id) ON DELETE SET NULL,
  FOREIGN KEY (task_run_id) REFERENCES task_runs(id) ON DELETE SET NULL,
  FOREIGN KEY (todo_id) REFERENCES role_todos(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_role_calls_thread_created
  ON role_calls(thread_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_role_calls_caller_role
  ON role_calls(caller_role);
CREATE INDEX IF NOT EXISTS idx_role_calls_callee_role
  ON role_calls(callee_role);
CREATE INDEX IF NOT EXISTS idx_role_calls_parent
  ON role_calls(parent_role_call_id);
CREATE INDEX IF NOT EXISTS idx_role_calls_status
  ON role_calls(status);
CREATE INDEX IF NOT EXISTS idx_role_calls_task_run
  ON role_calls(task_run_id);
CREATE INDEX IF NOT EXISTS idx_role_calls_todo
  ON role_calls(todo_id);

CREATE TABLE IF NOT EXISTS role_todos (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL,
  source_role_call_id TEXT,
  parent_todo_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('open', 'in_progress', 'deferred', 'blocked', 'done', 'rejected', 'cancelled')
  ),
  priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  reason TEXT,
  blocked_by_json TEXT CHECK (blocked_by_json IS NULL OR (json_valid(blocked_by_json) AND json_type(blocked_by_json) = 'array')),
  related_role_call_ids_json TEXT NOT NULL CHECK (json_valid(related_role_call_ids_json) AND json_type(related_role_call_ids_json) = 'array'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (thread_id) REFERENCES conversation_threads(id) ON DELETE CASCADE,
  FOREIGN KEY (source_role_call_id) REFERENCES role_calls(id) ON DELETE SET NULL,
  FOREIGN KEY (parent_todo_id) REFERENCES role_todos(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_role_todos_thread_role
  ON role_todos(thread_id, role, status);
CREATE INDEX IF NOT EXISTS idx_role_todos_status
  ON role_todos(status);
CREATE INDEX IF NOT EXISTS idx_role_todos_source_call
  ON role_todos(source_role_call_id);

CREATE TABLE IF NOT EXISTS role_call_events (
  id TEXT PRIMARY KEY,
  role_call_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (
    type IN (
      'created',
      'assessment_started',
      'accepted',
      'deferred',
      'rejected',
      'context_requested',
      'approval_requested',
      'queued',
      'started',
      'todo_created',
      'todo_updated',
      'result_reported',
      'failed',
      'cancelled'
    )
  ),
  actor_role TEXT,
  message TEXT NOT NULL,
  metadata_json TEXT CHECK (metadata_json IS NULL OR (json_valid(metadata_json) AND json_type(metadata_json) = 'object')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (role_call_id) REFERENCES role_calls(id) ON DELETE CASCADE,
  FOREIGN KEY (thread_id) REFERENCES conversation_threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_role_call_events_call_created
  ON role_call_events(role_call_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_role_call_events_thread_created
  ON role_call_events(thread_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_role_call_events_type
  ON role_call_events(type);
`
  },
  {
    version: 13,
    sql: `
CREATE TABLE IF NOT EXISTS context_index_entries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  layer TEXT NOT NULL CHECK (
    layer IN (
      'runtime_policy',
      'task',
      'project',
      'code',
      'test',
      'run_evidence',
      'approved_memory',
      'skill',
      'role',
      'conversation',
      'global'
    )
  ),
  source_kind TEXT NOT NULL CHECK (
    source_kind IN (
      'project_context',
      'approved_memory',
      'project_skill',
      'global_skill'
    )
  ),
  source_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (
    scope IN ('global', 'project', 'thread', 'task', 'run', 'role')
  ),
  trust_level TEXT NOT NULL CHECK (trust_level IN ('system', 'high', 'medium', 'low')),
  lifetime TEXT NOT NULL CHECK (
    lifetime IN ('static', 'approved', 'session', 'thread', 'run', 'indexed_snapshot')
  ),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  source_path TEXT,
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json) AND json_type(metadata_json) = 'object'),
  created_at TEXT NOT NULL,
  updated_at TEXT,
  indexed_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE (project_id, source_kind, source_id)
);

CREATE INDEX IF NOT EXISTS idx_context_index_entries_project
  ON context_index_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_context_index_entries_project_source
  ON context_index_entries(project_id, source_kind, source_id);
CREATE INDEX IF NOT EXISTS idx_context_index_entries_project_layer
  ON context_index_entries(project_id, layer);
CREATE INDEX IF NOT EXISTS idx_context_index_entries_hash
  ON context_index_entries(project_id, content_hash);

CREATE VIRTUAL TABLE IF NOT EXISTS context_text_fts USING fts5(
  id UNINDEXED,
  project_id UNINDEXED,
  source_kind UNINDEXED,
  title,
  content,
  source_path
);
`
  },
  {
    version: 14,
    sql: `
CREATE TABLE IF NOT EXISTS context_eval_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  plan_id TEXT,
  kind TEXT NOT NULL CHECK (
    kind IN (
      'run_outcome',
      'verification',
      'risk',
      'missing_context',
      'noisy_context',
      'review_decision'
    )
  ),
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
  message TEXT NOT NULL,
  selected_item_ids_json TEXT NOT NULL CHECK (
    json_valid(selected_item_ids_json) AND json_type(selected_item_ids_json) = 'array'
  ),
  omitted_item_ids_json TEXT NOT NULL CHECK (
    json_valid(omitted_item_ids_json) AND json_type(omitted_item_ids_json) = 'array'
  ),
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json) AND json_type(metadata_json) = 'object'),
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_context_eval_events_run_created
  ON context_eval_events(run_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_context_eval_events_project_created
  ON context_eval_events(project_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_context_eval_events_kind
  ON context_eval_events(kind);
`
  },
  {
    version: 15,
    sql: `
CREATE TABLE IF NOT EXISTS code_graph_entries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  package_name TEXT NOT NULL,
  is_test INTEGER NOT NULL CHECK (is_test IN (0, 1)),
  imports_json TEXT NOT NULL CHECK (json_valid(imports_json) AND json_type(imports_json) = 'array'),
  exports_json TEXT NOT NULL CHECK (json_valid(exports_json) AND json_type(exports_json) = 'array'),
  symbols_json TEXT NOT NULL CHECK (json_valid(symbols_json) AND json_type(symbols_json) = 'array'),
  related_tests_json TEXT NOT NULL CHECK (json_valid(related_tests_json) AND json_type(related_tests_json) = 'array'),
  content_hash TEXT NOT NULL,
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json) AND json_type(metadata_json) = 'object'),
  indexed_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE (project_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_code_graph_entries_project
  ON code_graph_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_code_graph_entries_project_path
  ON code_graph_entries(project_id, file_path);
CREATE INDEX IF NOT EXISTS idx_code_graph_entries_project_package
  ON code_graph_entries(project_id, package_name);
CREATE INDEX IF NOT EXISTS idx_code_graph_entries_hash
  ON code_graph_entries(project_id, content_hash);
`
  }
];

export function createSqliteRepositories(
  options: SqliteStorageOptions = {}
): SqliteRepositories {
  const database = new SqliteDatabase(
    options.databasePath ?? defaultSqliteDatabasePath()
  );
  return {
    database,
    projectRepository: new SQLiteProjectRepository(database),
    agentProfileRepository: new SQLiteAgentProfileRepository(database),
    taskRepository: new SQLiteTaskRepository(database),
    taskRunRepository: new SQLiteTaskRunRepository(database),
    runEventRepository: new SQLiteRunEventRepository(database),
    runArtifactRepository: new SQLiteRunArtifactRepository(database),
    verificationResultRepository: new SQLiteVerificationResultRepository(database),
    riskReportRepository: new SQLiteRiskReportRepository(database),
    runMetadataRepository: new SQLiteRunMetadataRepository(database),
    conversationThreadRepository: new SQLiteConversationThreadRepository(database),
    conversationMessageRepository: new SQLiteConversationMessageRepository(database),
    conversationThreadSummaryRepository:
      new SQLiteConversationThreadSummaryRepository(database),
    memoryItemRepository: new SQLiteMemoryItemRepository(database),
    comparisonReportRepository: new SQLiteComparisonReportRepository(database),
    skillRepository: new SQLiteSkillRepository(database),
    contextIndexRepository: new SQLiteContextIndexRepository(database),
    codeGraphRepository: new SQLiteCodeGraphRepository(database),
    contextEvalEventRepository: new SQLiteContextEvalEventRepository(database),
    settingsRepository: new SQLiteSettingsRepository(database),
    roleCallRepository: new SQLiteRoleCallRepository(database),
    roleCallEventRepository: new SQLiteRoleCallEventRepository(database),
    roleTodoRepository: new SQLiteRoleTodoRepository(database)
  };
}

export function defaultSqliteDatabasePath(): string {
  const explicitPath = process.env.AGENT_HUB_DB_PATH;
  if (explicitPath && explicitPath.trim().length > 0) {
    return path.resolve(explicitPath);
  }

  const explicitHome = process.env.AGENT_HUB_HOME;
  if (explicitHome && explicitHome.trim().length > 0) {
    return path.join(path.resolve(explicitHome), "agent-hub.sqlite");
  }

  return path.join(defaultAppDataDirectory(), "agent-hub.sqlite");
}

function defaultAppDataDirectory(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Agent Hub");
  }

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    return path.join(localAppData ?? os.homedir(), "Agent Hub");
  }

  const xdgDataHome = process.env.XDG_DATA_HOME;
  return path.join(xdgDataHome ?? path.join(os.homedir(), ".local", "share"), "agent-hub");
}

export class SqliteDatabase {
  private initializePromise: Promise<void> | undefined;
  private closed = false;
  private readonly driver: NativeSqliteDriver;

  constructor(readonly databasePath: string) {
    this.driver = new NativeSqliteDriver(databasePath);
  }

  async open(): Promise<void> {
    await this.ensureInitialized();
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.driver.close();
  }

  async execute(sql: string, parameters?: SqliteParameters): Promise<void> {
    await this.ensureInitialized();
    await this.executeWithoutInitialization(sql, parameters);
  }

  async query<T extends Record<string, unknown>>(
    sql: string,
    parameters?: SqliteParameters
  ): Promise<T[]> {
    await this.ensureInitialized();
    return this.queryWithoutInitialization<T>(sql, parameters);
  }

  async ensureInitialized(): Promise<void> {
    if (this.closed) {
      throw new Error("sqlite database is closed");
    }
    this.initializePromise ??= this.initialize();
    await this.initializePromise;
  }

  private async initialize(): Promise<void> {
    await fs.mkdir(path.dirname(this.databasePath), { recursive: true });
    await this.executeWithoutInitialization(`
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
`);

    const rows = await this.queryWithoutInitialization<{ version: number }>(
      "SELECT version FROM schema_migrations ORDER BY version ASC;"
    );
    const appliedVersions = new Set(rows.map((row) => row.version));
    await this.reconcileLegacyColumnMigrationMarkers(appliedVersions);
    for (const migration of SQLITE_MIGRATIONS) {
      if (appliedVersions.has(migration.version)) {
        continue;
      }
      const migrationSql = migration.transaction === false
        ? migration.sql
        : `
BEGIN;
${migration.sql}
INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES (${migration.version}, ${sqlString(new Date().toISOString())});
COMMIT;
`;
      await this.executeWithoutInitialization(migrationSql);
    }
  }

  private async reconcileLegacyColumnMigrationMarkers(
    appliedVersions: Set<number>
  ): Promise<void> {
    if (hasAppliedMigrationRange(appliedVersions, 1, 8) && !appliedVersions.has(9)) {
      await this.addColumnIfMissing(
        "task_runs",
        "parent_run_id",
        "TEXT REFERENCES task_runs(id) ON DELETE SET NULL"
      );
      await this.addColumnIfMissing(
        "task_runs",
        "parent_message_id",
        "TEXT REFERENCES conversation_messages(id) ON DELETE SET NULL"
      );
      await this.executeWithoutInitialization(`
CREATE INDEX IF NOT EXISTS idx_task_runs_parent_run
  ON task_runs(parent_run_id);
CREATE INDEX IF NOT EXISTS idx_task_runs_parent_message
  ON task_runs(parent_message_id);
INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES (9, ${sqlString(new Date().toISOString())});
`);
      appliedVersions.add(9);
    }
  }

  private async addColumnIfMissing(
    tableName: string,
    columnName: string,
    columnDefinition: string
  ): Promise<void> {
    const columns = await this.queryWithoutInitialization<{ name: string }>(
      `SELECT name FROM pragma_table_info(${sqlString(tableName)}) ORDER BY cid ASC;`
    );
    if (columns.some((column) => column.name === columnName)) {
      return;
    }
    await this.executeWithoutInitialization(
      `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition};`
    );
  }

  private async queryWithoutInitialization<T extends Record<string, unknown>>(
    sql: string,
    parameters?: SqliteParameters
  ): Promise<T[]> {
    return this.driver.query<T>(sql, parameters);
  }

  private async executeWithoutInitialization(
    sql: string,
    parameters?: SqliteParameters
  ): Promise<void> {
    this.driver.execute(sql, parameters);
  }
}

export class SQLiteProjectRepository implements ProjectRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async create(project: Project): Promise<Project> {
    const validProject = validateProject(project);
    await this.database.execute(`
INSERT INTO projects (id, name, root_path, created_at, updated_at)
VALUES (
  ${sqlString(validProject.id)},
  ${sqlString(validProject.name)},
  ${sqlString(validProject.rootPath)},
  ${sqlString(validProject.createdAt)},
  ${sqlString(validProject.updatedAt)}
)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  root_path = excluded.root_path,
  created_at = excluded.created_at,
  updated_at = excluded.updated_at;
`);
    return { ...validProject };
  }

  async get(projectId: string): Promise<Project | undefined> {
    const rows = await this.database.query<ProjectRow>(`
SELECT
  id,
  name,
  root_path AS rootPath,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM projects
WHERE id = ${sqlString(projectId)}
LIMIT 1;
`);
    const row = rows[0];
    return row ? projectFromRow(row) : undefined;
  }

  async getByRootPath(rootPath: string): Promise<Project | undefined> {
    const rows = await this.database.query<ProjectRow>(`
SELECT
  id,
  name,
  root_path AS rootPath,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM projects
WHERE root_path = ${sqlString(path.resolve(rootPath))}
LIMIT 1;
`);
    const row = rows[0];
    return row ? projectFromRow(row) : undefined;
  }

  async list(): Promise<Project[]> {
    const rows = await this.database.query<ProjectRow>(`
SELECT
  id,
  name,
  root_path AS rootPath,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM projects
ORDER BY created_at ASC, id ASC;
`);
    return rows.map(projectFromRow);
  }
}

export class SQLiteAgentProfileRepository implements AgentProfileRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async create(profile: AgentProfile): Promise<AgentProfile> {
    const validProfile = validateAgentProfile(profile);
    await this.database.execute(`
INSERT INTO agent_profiles (
  id, kind, display_name, command, enabled, created_at, updated_at
) VALUES (
  ${sqlString(validProfile.id)},
  ${sqlString(validProfile.kind)},
  ${sqlString(validProfile.displayName)},
  ${sqlNullableString(validProfile.command)},
  ${validProfile.enabled ? 1 : 0},
  ${sqlString(validProfile.createdAt)},
  ${sqlString(validProfile.updatedAt)}
)
ON CONFLICT(id) DO UPDATE SET
  kind = excluded.kind,
  display_name = excluded.display_name,
  command = excluded.command,
  enabled = excluded.enabled,
  created_at = excluded.created_at,
  updated_at = excluded.updated_at;
`);
    return { ...validProfile };
  }

  async get(profileId: string): Promise<AgentProfile | undefined> {
    const rows = await this.database.query<AgentProfileRow>(`
SELECT
  id,
  kind,
  display_name AS displayName,
  command,
  enabled,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM agent_profiles
WHERE id = ${sqlString(profileId)}
LIMIT 1;
`);
    const row = rows[0];
    return row ? agentProfileFromRow(row) : undefined;
  }

  async list(): Promise<AgentProfile[]> {
    const rows = await this.database.query<AgentProfileRow>(`
SELECT
  id,
  kind,
  display_name AS displayName,
  command,
  enabled,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM agent_profiles
ORDER BY created_at ASC, id ASC;
`);
    return rows.map(agentProfileFromRow);
  }
}

export class SQLiteTaskRepository implements TaskRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async create(task: Task): Promise<Task> {
    const validTask = validateTask(task);
    const existing = await this.get(validTask.id);
    if (existing) {
      validateTaskStatusTransition(existing.status, validTask.status);
    }
    await this.database.execute(`
INSERT INTO tasks (
  id,
  project_id,
  title,
  description,
  metadata_json,
  status,
  created_at,
  updated_at
) VALUES (
  ${sqlString(validTask.id)},
  ${sqlString(validTask.projectId)},
  ${sqlString(validTask.title)},
  ${sqlNullableString(validTask.description)},
  ${sqlJson(validTask.metadata)},
  ${sqlString(validTask.status)},
  ${sqlString(validTask.createdAt)},
  ${sqlString(validTask.updatedAt)}
)
ON CONFLICT(id) DO UPDATE SET
  project_id = excluded.project_id,
  title = excluded.title,
  description = excluded.description,
  metadata_json = excluded.metadata_json,
  status = excluded.status,
  created_at = excluded.created_at,
  updated_at = excluded.updated_at;
`);
    return { ...validTask };
  }

  async updateStatus(
    taskId: string,
    status: TaskStatus,
    updatedAt: string
  ): Promise<Task> {
    const existing = await this.get(taskId);
    if (!existing) {
      throw new Error(`task ${taskId} not found`);
    }
    validateTaskStatusTransition(existing.status, status);
    await this.database.execute(`
UPDATE tasks
SET status = ${sqlString(status)}, updated_at = ${sqlString(updatedAt)}
WHERE id = ${sqlString(taskId)};
`);
    const task = await this.get(taskId);
    if (!task) {
      throw new Error(`task ${taskId} not found`);
    }
    return task;
  }

  async get(taskId: string): Promise<Task | undefined> {
    const rows = await this.database.query<TaskRow>(`
SELECT
  id,
  project_id AS projectId,
  title,
  description,
  metadata_json AS metadataJson,
  status,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM tasks
WHERE id = ${sqlString(taskId)}
LIMIT 1;
`);
    const row = rows[0];
    return row ? taskFromRow(row) : undefined;
  }

  async list(): Promise<Task[]> {
    const rows = await this.database.query<TaskRow>(`
SELECT
  id,
  project_id AS projectId,
  title,
  description,
  metadata_json AS metadataJson,
  status,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM tasks
ORDER BY created_at ASC, id ASC;
`);
    return rows.map(taskFromRow);
  }

  async listByProjectId(projectId: string): Promise<Task[]> {
    const rows = await this.database.query<TaskRow>(`
SELECT
  id,
  project_id AS projectId,
  title,
  description,
  metadata_json AS metadataJson,
  status,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM tasks
WHERE project_id = ${sqlString(projectId)}
ORDER BY created_at ASC, id ASC;
`);
    return rows.map(taskFromRow);
  }
}

export class SQLiteTaskRunRepository implements TaskRunRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async create(run: TaskRun): Promise<TaskRun> {
    const validRun = validateTaskRun(run);
    const existing = await this.get(validRun.id);
    if (existing) {
      validateTaskRunStatusTransition(existing.status, validRun.status);
    }
    await this.database.execute(`
BEGIN;
INSERT INTO task_runs (
  id,
  task_id,
  agent_profile_id,
  agent_kind,
  status,
  worktree_path,
  branch_name,
  parent_run_id,
  parent_message_id,
  started_at,
  completed_at,
  created_at,
  updated_at
) VALUES (
  ${sqlString(validRun.id)},
  ${sqlString(validRun.taskId)},
  ${sqlNullableString(validRun.agentProfileId)},
  ${sqlString(validRun.agentKind)},
  ${sqlString(validRun.status)},
  ${sqlNullableString(validRun.worktreePath)},
  ${sqlNullableString(validRun.branchName)},
  ${sqlNullableString(validRun.parentRunId)},
  ${sqlNullableString(validRun.parentMessageId)},
  ${sqlNullableString(validRun.startedAt)},
  ${sqlNullableString(validRun.completedAt)},
  ${sqlString(validRun.createdAt)},
  ${sqlString(validRun.updatedAt)}
)
ON CONFLICT(id) DO UPDATE SET
  task_id = excluded.task_id,
  agent_profile_id = excluded.agent_profile_id,
  agent_kind = excluded.agent_kind,
  status = excluded.status,
  worktree_path = excluded.worktree_path,
  branch_name = excluded.branch_name,
  parent_run_id = excluded.parent_run_id,
  parent_message_id = excluded.parent_message_id,
  started_at = excluded.started_at,
  completed_at = excluded.completed_at,
  created_at = excluded.created_at,
  updated_at = excluded.updated_at;
DELETE FROM status_transitions WHERE run_id = ${sqlString(validRun.id)};
INSERT INTO status_transitions (run_id, status, at)
VALUES (
  ${sqlString(validRun.id)},
  ${sqlString(validRun.status)},
  ${sqlString(validRun.createdAt)}
);
COMMIT;
`);
    return { ...validRun };
  }

  async updateExecutionPaths(
    runId: string,
    paths: { worktreePath?: string; branchName?: string },
    updatedAt: string
  ): Promise<TaskRun> {
    await this.database.execute(`
UPDATE task_runs
SET
  worktree_path = ${sqlNullableString(paths.worktreePath)},
  branch_name = ${sqlNullableString(paths.branchName)},
  updated_at = ${sqlString(updatedAt)}
WHERE id = ${sqlString(runId)};
`);
    const run = await this.get(runId);
    if (!run) {
      throw new Error(`task run ${runId} not found`);
    }
    return run;
  }

  async updateStatus(
    runId: string,
    status: TaskRunStatus,
    updatedAt: string
  ): Promise<TaskRun> {
    const existing = await this.get(runId);
    if (!existing) {
      throw new Error(`task run ${runId} not found`);
    }
    validateTaskRunStatusTransition(existing.status, status);
    await this.database.execute(`
BEGIN;
UPDATE task_runs
SET
  status = ${sqlString(status)},
  updated_at = ${sqlString(updatedAt)},
  started_at = CASE
    WHEN ${sqlString(status)} = 'running' AND started_at IS NULL
      THEN ${sqlString(updatedAt)}
    ELSE started_at
  END,
  completed_at = CASE
    WHEN ${sqlString(status)} IN ('succeeded', 'failed', 'cancelled')
      THEN ${sqlString(updatedAt)}
    ELSE completed_at
  END
WHERE id = ${sqlString(runId)};
INSERT INTO status_transitions (run_id, status, at)
SELECT ${sqlString(runId)}, ${sqlString(status)}, ${sqlString(updatedAt)}
WHERE EXISTS (SELECT 1 FROM task_runs WHERE id = ${sqlString(runId)})
  AND ${sqlString(existing.status)} <> ${sqlString(status)};
COMMIT;
`);
    const run = await this.get(runId);
    if (!run) {
      throw new Error(`task run ${runId} not found`);
    }
    return run;
  }

  async get(runId: string): Promise<TaskRun | undefined> {
    const rows = await this.database.query<TaskRunRow>(`
SELECT
  id,
  task_id AS taskId,
  agent_profile_id AS agentProfileId,
  agent_kind AS agentKind,
  status,
  worktree_path AS worktreePath,
  branch_name AS branchName,
  parent_run_id AS parentRunId,
  parent_message_id AS parentMessageId,
  started_at AS startedAt,
  completed_at AS completedAt,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM task_runs
WHERE id = ${sqlString(runId)}
LIMIT 1;
`);
    const row = rows[0];
    return row ? taskRunFromRow(row) : undefined;
  }

  async list(): Promise<TaskRun[]> {
    const rows = await this.database.query<TaskRunRow>(`
SELECT
  id,
  task_id AS taskId,
  agent_profile_id AS agentProfileId,
  agent_kind AS agentKind,
  status,
  worktree_path AS worktreePath,
  branch_name AS branchName,
  parent_run_id AS parentRunId,
  parent_message_id AS parentMessageId,
  started_at AS startedAt,
  completed_at AS completedAt,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM task_runs
ORDER BY created_at ASC, id ASC;
`);
    return rows.map(taskRunFromRow);
  }

  async listByTaskId(taskId: string): Promise<TaskRun[]> {
    const rows = await this.database.query<TaskRunRow>(`
SELECT
  id,
  task_id AS taskId,
  agent_profile_id AS agentProfileId,
  agent_kind AS agentKind,
  status,
  worktree_path AS worktreePath,
  branch_name AS branchName,
  parent_run_id AS parentRunId,
  parent_message_id AS parentMessageId,
  started_at AS startedAt,
  completed_at AS completedAt,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM task_runs
WHERE task_id = ${sqlString(taskId)}
ORDER BY created_at ASC, id ASC;
`);
    return rows.map(taskRunFromRow);
  }

  async getStatusTransitions(runId: string): Promise<RunStatusTransition[]> {
    const rows = await this.database.query<RunStatusTransitionRow>(`
SELECT
  run_id AS runId,
  status,
  at
FROM status_transitions
WHERE run_id = ${sqlString(runId)}
ORDER BY id ASC;
`);
    return rows.map((row) => ({
      runId: row.runId,
      status: row.status as TaskRunStatus,
      at: row.at
    }));
  }
}

export class SQLiteRunMetadataRepository implements RunMetadataRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async save(metadata: RunMetadata): Promise<RunMetadata> {
    const existing = await this.get(metadata.runId);
    const updated = cloneRunMetadata({ ...existing, ...metadata });
    await this.database.execute(`
INSERT INTO run_metadata (
  run_id,
  workspace_json,
  workspace_cleanup_json,
  diff_json,
  verification_json,
  risk_report_json,
  role_json,
  updated_at
) VALUES (
  ${sqlString(updated.runId)},
  ${sqlJson(updated.workspace)},
  ${sqlJson(updated.workspaceCleanup)},
  ${sqlJson(updated.diff)},
  ${sqlJson(updated.verification)},
  ${sqlJson(updated.riskReport)},
  ${sqlJson(updated.role)},
  ${sqlString(new Date().toISOString())}
)
ON CONFLICT(run_id) DO UPDATE SET
  workspace_json = excluded.workspace_json,
  workspace_cleanup_json = excluded.workspace_cleanup_json,
  diff_json = excluded.diff_json,
  verification_json = excluded.verification_json,
  risk_report_json = excluded.risk_report_json,
  role_json = excluded.role_json,
  updated_at = excluded.updated_at;
`);
    return cloneRunMetadata(updated);
  }

  async get(runId: string): Promise<RunMetadata | undefined> {
    const rows = await this.database.query<RunMetadataRow>(`
SELECT
  run_id AS runId,
  workspace_json AS workspaceJson,
  workspace_cleanup_json AS workspaceCleanupJson,
  diff_json AS diffJson,
  verification_json AS verificationJson,
  risk_report_json AS riskReportJson,
  role_json AS roleJson
FROM run_metadata
WHERE run_id = ${sqlString(runId)}
LIMIT 1;
`);
    const row = rows[0];
    return row ? cloneRunMetadata(metadataFromRow(row)) : undefined;
  }
}

export class SQLiteRunEventRepository implements RunEventRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async create(event: RunEvent): Promise<RunEvent> {
    const validEvent = validateRunEvent(event);
    await this.database.execute(`
INSERT INTO run_events (
  id, task_run_id, sequence, type, message, metadata_json, created_at
) VALUES (
  ${sqlString(validEvent.id)},
  ${sqlString(validEvent.taskRunId)},
  ${validEvent.sequence},
  ${sqlString(validEvent.type)},
  ${sqlString(validEvent.message)},
  ${sqlJson(validEvent.metadata)},
  ${sqlString(validEvent.createdAt)}
);
`);
    return cloneRunEvent(validEvent);
  }

  async createMany(events: RunEvent[]): Promise<RunEvent[]> {
    if (events.length === 0) {
      return [];
    }
    const values = events.map((event) => {
      const validEvent = validateRunEvent(event);
      return `(
  ${sqlString(validEvent.id)},
  ${sqlString(validEvent.taskRunId)},
  ${validEvent.sequence},
  ${sqlString(validEvent.type)},
  ${sqlString(validEvent.message)},
  ${sqlJson(validEvent.metadata)},
  ${sqlString(validEvent.createdAt)}
)`;
    });
    await this.database.execute(`
INSERT INTO run_events (
  id, task_run_id, sequence, type, message, metadata_json, created_at
) VALUES
${values.join(",\n")};
`);
    return events.map((event) => cloneRunEvent(validateRunEvent(event)));
  }

  async listByRunId(runId: string): Promise<RunEvent[]> {
    const rows = await this.database.query<RunEventRow>(`
SELECT
  id,
  task_run_id AS taskRunId,
  sequence,
  type,
  message,
  metadata_json AS metadataJson,
  created_at AS createdAt
FROM run_events
WHERE task_run_id = ${sqlString(runId)}
ORDER BY sequence ASC;
`);
    return rows.map(runEventFromRow);
  }

  async countByRunId(runId: string): Promise<number> {
    const rows = await this.database.query<{ count: number }>(`
SELECT COUNT(*) AS count
FROM run_events
WHERE task_run_id = ${sqlString(runId)};
`);
    return rows[0]?.count ?? 0;
  }
}

export class SQLiteRunArtifactRepository implements RunArtifactRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async create(artifact: RunArtifact): Promise<RunArtifact> {
    const validArtifact = validateRunArtifact(artifact);
    await this.database.execute(`
INSERT INTO run_artifacts (
  id, task_run_id, kind, content, metadata_json, created_at
) VALUES (
  ${sqlString(validArtifact.id)},
  ${sqlString(validArtifact.taskRunId)},
  ${sqlString(validArtifact.kind)},
  ${sqlString(validArtifact.content)},
  ${sqlJson(validArtifact.metadata)},
  ${sqlString(validArtifact.createdAt)}
);
`);
    return cloneRunArtifact(validArtifact);
  }

  async listByRunId(runId: string): Promise<RunArtifact[]> {
    const rows = await this.database.query<RunArtifactRow>(`
SELECT
  id,
  task_run_id AS taskRunId,
  kind,
  content,
  metadata_json AS metadataJson,
  created_at AS createdAt
FROM run_artifacts
WHERE task_run_id = ${sqlString(runId)}
ORDER BY created_at ASC, id ASC;
`);
    return rows.map(runArtifactFromRow);
  }

  async getLatestByRunIdAndKind(
    runId: string,
    kind: string
  ): Promise<RunArtifact | undefined> {
    const rows = await this.database.query<RunArtifactRow>(`
SELECT
  id,
  task_run_id AS taskRunId,
  kind,
  content,
  metadata_json AS metadataJson,
  created_at AS createdAt
FROM run_artifacts
WHERE task_run_id = ${sqlString(runId)}
  AND kind = ${sqlString(kind)}
ORDER BY created_at DESC, id DESC
LIMIT 1;
`);
    const row = rows[0];
    return row ? runArtifactFromRow(row) : undefined;
  }
}

export class SQLiteConversationThreadRepository
  implements ConversationThreadRepository
{
  constructor(private readonly database: SqliteDatabase) {}

  async create(thread: ConversationThread): Promise<ConversationThread> {
    const validThread = validateConversationThread(thread);
    await this.database.execute(`
INSERT INTO conversation_threads (
  id,
  project_id,
  title,
  metadata_json,
  archived_at,
  created_at,
  updated_at
) VALUES (
  ${sqlString(validThread.id)},
  ${sqlString(validThread.projectId)},
  ${sqlString(validThread.title)},
  ${sqlJson(validThread.metadata)},
  ${sqlNullableString(validThread.archivedAt)},
  ${sqlString(validThread.createdAt)},
  ${sqlString(validThread.updatedAt)}
);
`);
    return cloneConversationThread(validThread);
  }

  async update(thread: ConversationThread): Promise<ConversationThread> {
    const validThread = validateConversationThread(thread);
    const existing = await this.get(validThread.id);
    if (!existing) {
      throw new Error(`conversation thread ${validThread.id} not found`);
    }
    await this.database.execute(`
UPDATE conversation_threads
SET
  project_id = ${sqlString(validThread.projectId)},
  title = ${sqlString(validThread.title)},
  metadata_json = ${sqlJson(validThread.metadata)},
  archived_at = ${sqlNullableString(validThread.archivedAt)},
  created_at = ${sqlString(validThread.createdAt)},
  updated_at = ${sqlString(validThread.updatedAt)}
WHERE id = ${sqlString(validThread.id)};
`);
    return cloneConversationThread(validThread);
  }

  async get(threadId: string): Promise<ConversationThread | undefined> {
    const rows = await this.database.query<ConversationThreadRow>(`
SELECT
  id,
  project_id AS projectId,
  title,
  metadata_json AS metadataJson,
  archived_at AS archivedAt,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM conversation_threads
WHERE id = ${sqlString(threadId)}
LIMIT 1;
`);
    const row = rows[0];
    return row ? conversationThreadFromRow(row) : undefined;
  }

  async list(projectId?: string): Promise<ConversationThread[]> {
    const whereClause =
      projectId === undefined ? "" : `WHERE project_id = ${sqlString(projectId)}`;
    const rows = await this.database.query<ConversationThreadRow>(`
SELECT
  id,
  project_id AS projectId,
  title,
  metadata_json AS metadataJson,
  archived_at AS archivedAt,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM conversation_threads
${whereClause}
ORDER BY created_at ASC, id ASC;
`);
    return rows.map(conversationThreadFromRow);
  }
}

export class SQLiteConversationMessageRepository
  implements ConversationMessageRepository
{
  constructor(private readonly database: SqliteDatabase) {}

  async create(message: ConversationMessage): Promise<ConversationMessage> {
    const validMessage = validateConversationMessage(message);
    await this.database.execute(conversationMessageInsertSql(validMessage));
    return cloneConversationMessage(validMessage);
  }

  async update(message: ConversationMessage): Promise<ConversationMessage> {
    const validMessage = validateConversationMessage(message);
    const existingRows = await this.database.query<{ id: string }>(`
SELECT id
FROM conversation_messages
WHERE id = ${sqlString(validMessage.id)}
LIMIT 1;
`);
    if (!existingRows[0]) {
      throw new Error(`conversation message ${validMessage.id} not found`);
    }
    await this.database.execute(`
UPDATE conversation_messages
SET
  thread_id = ${sqlString(validMessage.threadId)},
  sequence = ${validMessage.sequence},
  role = ${sqlString(validMessage.role)},
  kind = ${sqlString(validMessage.kind)},
  content = ${sqlString(validMessage.content)},
  agent_kind = ${sqlNullableString(validMessage.agentKind)},
  run_id = ${sqlNullableString(validMessage.runId)},
  status = ${sqlNullableString(validMessage.status)},
  metadata_json = ${sqlJson(validMessage.metadata)},
  created_at = ${sqlString(validMessage.createdAt)}
WHERE id = ${sqlString(validMessage.id)};
`);
    return cloneConversationMessage(validMessage);
  }

  async createMany(
    messages: ConversationMessage[]
  ): Promise<ConversationMessage[]> {
    if (messages.length === 0) {
      return [];
    }
    await this.database.execute(messages.map(conversationMessageInsertSql).join("\n"));
    return messages.map((message) =>
      cloneConversationMessage(validateConversationMessage(message))
    );
  }

  async get(messageId: string): Promise<ConversationMessage | undefined> {
    const rows = await this.database.query<ConversationMessageRow>(`
SELECT
  id,
  thread_id AS threadId,
  sequence,
  role,
  kind,
  content,
  agent_kind AS agentKind,
  run_id AS runId,
  status,
  metadata_json AS metadataJson,
  created_at AS createdAt
FROM conversation_messages
WHERE id = ${sqlString(messageId)}
LIMIT 1;
`);
    const row = rows[0];
    return row ? conversationMessageFromRow(row) : undefined;
  }

  async listByThreadId(threadId: string): Promise<ConversationMessage[]> {
    const rows = await this.database.query<ConversationMessageRow>(`
SELECT
  id,
  thread_id AS threadId,
  sequence,
  role,
  kind,
  content,
  agent_kind AS agentKind,
  run_id AS runId,
  status,
  metadata_json AS metadataJson,
  created_at AS createdAt
FROM conversation_messages
WHERE thread_id = ${sqlString(threadId)}
ORDER BY sequence ASC, id ASC;
`);
    return rows.map(conversationMessageFromRow);
  }

  async countByThreadId(threadId: string): Promise<number> {
    const rows = await this.database.query<{ count: number }>(`
SELECT COUNT(*) AS count
FROM conversation_messages
WHERE thread_id = ${sqlString(threadId)};
`);
    return rows[0]?.count ?? 0;
  }
}

export class SQLiteConversationThreadSummaryRepository
  implements ConversationThreadSummaryRepository
{
  constructor(private readonly database: SqliteDatabase) {}

  async upsert(
    summary: ConversationThreadSummary
  ): Promise<ConversationThreadSummary> {
    const validSummary = validateConversationThreadSummary(summary);
    await this.database.execute(`
INSERT INTO conversation_thread_summaries (
  id,
  thread_id,
  summary,
  decisions_json,
  open_items_json,
  constraints_json,
  last_known_user_goal,
  source_message_count,
  source_latest_message_id,
  metadata_json,
  created_at,
  updated_at
) VALUES (
  ${sqlString(validSummary.id)},
  ${sqlString(validSummary.threadId)},
  ${sqlString(validSummary.summary)},
  ${sqlString(JSON.stringify(validSummary.decisions))},
  ${sqlString(JSON.stringify(validSummary.openItems))},
  ${sqlString(JSON.stringify(validSummary.constraints))},
  ${sqlNullableString(validSummary.lastKnownUserGoal)},
  ${validSummary.sourceMessageCount},
  ${sqlNullableString(validSummary.sourceLatestMessageId)},
  ${sqlJson(validSummary.metadata)},
  ${sqlString(validSummary.createdAt)},
  ${sqlString(validSummary.updatedAt)}
)
ON CONFLICT(thread_id) DO UPDATE SET
  id = excluded.id,
  summary = excluded.summary,
  decisions_json = excluded.decisions_json,
  open_items_json = excluded.open_items_json,
  constraints_json = excluded.constraints_json,
  last_known_user_goal = excluded.last_known_user_goal,
  source_message_count = excluded.source_message_count,
  source_latest_message_id = excluded.source_latest_message_id,
  metadata_json = excluded.metadata_json,
  created_at = conversation_thread_summaries.created_at,
  updated_at = excluded.updated_at;
`);
    return cloneConversationThreadSummary(validSummary);
  }

  async getByThreadId(
    threadId: string
  ): Promise<ConversationThreadSummary | undefined> {
    const rows = await this.database.query<ConversationThreadSummaryRow>(`
SELECT
  id,
  thread_id AS threadId,
  summary,
  decisions_json AS decisionsJson,
  open_items_json AS openItemsJson,
  constraints_json AS constraintsJson,
  last_known_user_goal AS lastKnownUserGoal,
  source_message_count AS sourceMessageCount,
  source_latest_message_id AS sourceLatestMessageId,
  metadata_json AS metadataJson,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM conversation_thread_summaries
WHERE thread_id = ${sqlString(threadId)}
LIMIT 1;
`);
    const row = rows[0];
    return row ? conversationThreadSummaryFromRow(row) : undefined;
  }
}

export class SQLiteVerificationResultRepository
  implements VerificationResultRepository
{
  constructor(private readonly database: SqliteDatabase) {}

  async create(result: VerificationResult): Promise<VerificationResult> {
    const validResult = validateVerificationResult(result);
    await this.database.execute(verificationInsertSql(validResult));
    return { ...validResult };
  }

  async createMany(results: VerificationResult[]): Promise<VerificationResult[]> {
    if (results.length === 0) {
      return [];
    }
    await this.database.execute(results.map(verificationInsertSql).join("\n"));
    return results.map((result) => ({ ...validateVerificationResult(result) }));
  }

  async listByRunId(runId: string): Promise<VerificationResult[]> {
    const rows = await this.database.query<VerificationResultRow>(`
SELECT
  id,
  task_run_id AS taskRunId,
  command,
  status,
  exit_code AS exitCode,
  stdout,
  stderr,
  started_at AS startedAt,
  completed_at AS completedAt,
  created_at AS createdAt
FROM verification_results
WHERE task_run_id = ${sqlString(runId)}
ORDER BY created_at ASC, id ASC;
`);
    return rows.map(verificationResultFromRow);
  }
}

export class SQLiteRiskReportRepository implements RiskReportRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async create(report: RiskReport): Promise<RiskReport> {
    const validReport = validateRiskReport(report);
    await this.database.execute(`
INSERT INTO risk_reports (
  id,
  task_run_id,
  level,
  summary,
  findings_json,
  changed_files_json,
  verification_summary,
  failed_checks_json,
  risk_factors_json,
  manual_review_checklist_json,
  acceptance_recommendation,
  created_at
) VALUES (
  ${sqlString(validReport.id)},
  ${sqlString(validReport.taskRunId)},
  ${sqlString(validReport.level)},
  ${sqlString(validReport.summary)},
  ${sqlJson(validReport.findings)},
  ${sqlJson(validReport.changedFiles)},
  ${sqlString(validReport.verificationSummary)},
  ${sqlJson(validReport.failedChecks)},
  ${sqlJson(validReport.riskFactors)},
  ${sqlJson(validReport.manualReviewChecklist)},
  ${sqlString(validReport.acceptanceRecommendation)},
  ${sqlString(validReport.createdAt)}
)
ON CONFLICT(id) DO UPDATE SET
  task_run_id = excluded.task_run_id,
  level = excluded.level,
  summary = excluded.summary,
  findings_json = excluded.findings_json,
  changed_files_json = excluded.changed_files_json,
  verification_summary = excluded.verification_summary,
  failed_checks_json = excluded.failed_checks_json,
  risk_factors_json = excluded.risk_factors_json,
  manual_review_checklist_json = excluded.manual_review_checklist_json,
  acceptance_recommendation = excluded.acceptance_recommendation,
  created_at = excluded.created_at;
`);
    return cloneRiskReport(validReport);
  }

  async listByRunId(runId: string): Promise<RiskReport[]> {
    const rows = await this.database.query<RiskReportRow>(`
SELECT
  id,
  task_run_id AS taskRunId,
  level,
  summary,
  findings_json AS findingsJson,
  changed_files_json AS changedFilesJson,
  verification_summary AS verificationSummary,
  failed_checks_json AS failedChecksJson,
  risk_factors_json AS riskFactorsJson,
  manual_review_checklist_json AS manualReviewChecklistJson,
  acceptance_recommendation AS acceptanceRecommendation,
  created_at AS createdAt
FROM risk_reports
WHERE task_run_id = ${sqlString(runId)}
ORDER BY created_at ASC, id ASC;
`);
    return rows.map(riskReportFromRow);
  }

  async getLatestByRunId(runId: string): Promise<RiskReport | undefined> {
    const rows = await this.database.query<RiskReportRow>(`
SELECT
  id,
  task_run_id AS taskRunId,
  level,
  summary,
  findings_json AS findingsJson,
  changed_files_json AS changedFilesJson,
  verification_summary AS verificationSummary,
  failed_checks_json AS failedChecksJson,
  risk_factors_json AS riskFactorsJson,
  manual_review_checklist_json AS manualReviewChecklistJson,
  acceptance_recommendation AS acceptanceRecommendation,
  created_at AS createdAt
FROM risk_reports
WHERE task_run_id = ${sqlString(runId)}
ORDER BY created_at DESC, id DESC
LIMIT 1;
`);
    const row = rows[0];
    return row ? riskReportFromRow(row) : undefined;
  }
}

export class SQLiteMemoryItemRepository implements MemoryItemRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async create(item: MemoryItem): Promise<MemoryItem> {
    const validItem = validateMemoryItem(item);
    const existing = await this.get(validItem.id);
    if (existing) {
      validateMemoryStatusTransition(existing.status, validItem.status);
    }
    await this.database.execute(`
INSERT INTO memory_items (
  id, project_id, task_id, category, status, content, created_at, updated_at
) VALUES (
  ${sqlString(validItem.id)},
  ${sqlString(validItem.projectId)},
  ${sqlNullableString(validItem.taskId)},
  ${sqlString(validItem.category)},
  ${sqlString(validItem.status)},
  ${sqlString(validItem.content)},
  ${sqlString(validItem.createdAt)},
  ${sqlString(validItem.updatedAt)}
)
ON CONFLICT(id) DO UPDATE SET
  project_id = excluded.project_id,
  task_id = excluded.task_id,
  category = excluded.category,
  status = excluded.status,
  content = excluded.content,
  created_at = excluded.created_at,
  updated_at = excluded.updated_at;
`);
    return { ...validItem };
  }

  async updateStatus(
    memoryId: string,
    status: MemoryItem["status"],
    updatedAt: string
  ): Promise<MemoryItem> {
    const existing = await this.get(memoryId);
    if (!existing) {
      throw new Error(`memory item ${memoryId} not found`);
    }
    validateMemoryStatusTransition(existing.status, status);
    await this.database.execute(`
UPDATE memory_items
SET status = ${sqlString(status)}, updated_at = ${sqlString(updatedAt)}
WHERE id = ${sqlString(memoryId)};
`);
    const item = await this.get(memoryId);
    if (!item) {
      throw new Error(`memory item ${memoryId} not found`);
    }
    return item;
  }

  async get(memoryId: string): Promise<MemoryItem | undefined> {
    const rows = await this.database.query<MemoryItemRow>(`
SELECT
  id,
  project_id AS projectId,
  task_id AS taskId,
  category,
  status,
  content,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM memory_items
WHERE id = ${sqlString(memoryId)}
LIMIT 1;
`);
    const row = rows[0];
    return row ? memoryItemFromRow(row) : undefined;
  }

  async listByProjectId(projectId: string): Promise<MemoryItem[]> {
    const rows = await this.database.query<MemoryItemRow>(`
SELECT
  id,
  project_id AS projectId,
  task_id AS taskId,
  category,
  status,
  content,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM memory_items
WHERE project_id = ${sqlString(projectId)}
ORDER BY created_at ASC, id ASC;
`);
    return rows.map(memoryItemFromRow);
  }
}

export class SQLiteComparisonReportRepository
  implements ComparisonReportRepository
{
  constructor(private readonly database: SqliteDatabase) {}

  async create(report: ComparisonReport): Promise<ComparisonReport> {
    const validReport = validateComparisonReport(report);
    await this.database.execute(`
INSERT INTO comparison_reports (
  id, task_id, baseline_run_id, candidate_run_id, summary, details_json, created_at
) VALUES (
  ${sqlString(validReport.id)},
  ${sqlString(validReport.taskId)},
  ${sqlNullableString(validReport.baselineRunId)},
  ${sqlNullableString(validReport.candidateRunId)},
  ${sqlString(validReport.summary)},
  ${sqlJson(validReport.details)},
  ${sqlString(validReport.createdAt)}
)
ON CONFLICT(id) DO UPDATE SET
  task_id = excluded.task_id,
  baseline_run_id = excluded.baseline_run_id,
  candidate_run_id = excluded.candidate_run_id,
  summary = excluded.summary,
  details_json = excluded.details_json,
  created_at = excluded.created_at;
`);
    return { ...validReport };
  }

  async listByTaskId(taskId: string): Promise<ComparisonReport[]> {
    const rows = await this.database.query<ComparisonReportRow>(`
SELECT
  id,
  task_id AS taskId,
  baseline_run_id AS baselineRunId,
  candidate_run_id AS candidateRunId,
  summary,
  details_json AS detailsJson,
  created_at AS createdAt
FROM comparison_reports
WHERE task_id = ${sqlString(taskId)}
ORDER BY created_at ASC, id ASC;
`);
    return rows.map(comparisonReportFromRow);
  }

  async listByRunId(runId: string): Promise<ComparisonReport[]> {
    const rows = await this.database.query<ComparisonReportRow>(`
SELECT
  id,
  task_id AS taskId,
  baseline_run_id AS baselineRunId,
  candidate_run_id AS candidateRunId,
  summary,
  details_json AS detailsJson,
  created_at AS createdAt
FROM comparison_reports
WHERE baseline_run_id = ${sqlString(runId)}
  OR candidate_run_id = ${sqlString(runId)}
ORDER BY created_at ASC, id ASC;
`);
    return rows.map(comparisonReportFromRow);
  }
}

export class SQLiteSkillRepository implements SkillRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async create(skill: Skill): Promise<Skill> {
    const validSkill = validateSkill(skill);
    await this.database.execute(`
INSERT INTO skills (
  id, project_id, name, description, path, created_at, updated_at
) VALUES (
  ${sqlString(validSkill.id)},
  ${sqlNullableString(validSkill.projectId)},
  ${sqlString(validSkill.name)},
  ${sqlString(validSkill.description)},
  ${sqlString(validSkill.path)},
  ${sqlString(validSkill.createdAt)},
  ${sqlString(validSkill.updatedAt)}
)
ON CONFLICT(id) DO UPDATE SET
  project_id = excluded.project_id,
  name = excluded.name,
  description = excluded.description,
  path = excluded.path,
  created_at = excluded.created_at,
  updated_at = excluded.updated_at;
`);
    return { ...validSkill };
  }

  async list(projectId?: string): Promise<Skill[]> {
    const whereClause =
      projectId === undefined ? "" : `WHERE project_id = ${sqlString(projectId)}`;
    const rows = await this.database.query<SkillRow>(`
SELECT
  id,
  project_id AS projectId,
  name,
  description,
  path,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM skills
${whereClause}
ORDER BY created_at ASC, id ASC;
`);
    return rows.map(skillFromRow);
  }
}

export class SQLiteContextIndexRepository implements ContextIndexRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async rebuildProject(
    projectId: string,
    entries: ContextIndexEntry[],
    indexedAt: string
  ) {
    const validEntries = entries.map(validateContextIndexEntry);
    for (const entry of validEntries) {
      if (entry.projectId !== projectId) {
        throw new Error(`context index entry ${entry.id} belongs to project ${entry.projectId}, not ${projectId}`);
      }
    }

    const existingEntries = await this.listByProjectId(projectId);
    const existingById = new Map(existingEntries.map((entry) => [entry.id, entry]));
    const incomingIds = new Set(validEntries.map((entry) => entry.id));
    let createdCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;
    let deletedCount = 0;

    for (const entry of validEntries) {
      const existing = existingById.get(entry.id);
      if (existing && contextIndexEntryUnchanged(existing, entry)) {
        unchangedCount += 1;
        continue;
      }
      const indexedEntry = validateContextIndexEntry({ ...entry, indexedAt });
      await this.database.execute(`
${upsertContextIndexEntrySql(indexedEntry)}
DELETE FROM context_text_fts WHERE id = ${sqlString(indexedEntry.id)};
${insertContextIndexFtsSql(indexedEntry)}
`);
      if (existing) {
        updatedCount += 1;
      } else {
        createdCount += 1;
      }
    }

    for (const entry of existingEntries) {
      if (!incomingIds.has(entry.id)) {
        await this.database.execute(`
DELETE FROM context_text_fts WHERE id = ${sqlString(entry.id)};
DELETE FROM context_index_entries WHERE id = ${sqlString(entry.id)};
`);
        deletedCount += 1;
      }
    }

    return {
      projectId,
      indexedAt,
      createdCount,
      updatedCount,
      unchangedCount,
      deletedCount,
      skippedCount: 0,
      indexedIds: validEntries.map((entry) => entry.id).sort(),
      skipped: []
    };
  }

  async listByProjectId(projectId: string): Promise<ContextIndexEntry[]> {
    const rows = await this.database.query<ContextIndexEntryRow>(`
SELECT
  id,
  project_id AS projectId,
  layer,
  source_kind AS sourceKind,
  source_id AS sourceId,
  scope,
  trust_level AS trustLevel,
  lifetime,
  title,
  content,
  content_hash AS contentHash,
  source_path AS sourcePath,
  metadata_json AS metadataJson,
  created_at AS createdAt,
  updated_at AS updatedAt,
  indexed_at AS indexedAt
FROM context_index_entries
WHERE project_id = ${sqlString(projectId)}
ORDER BY id ASC;
`);
    return rows.map(contextIndexEntryFromRow);
  }

  async get(entryId: string): Promise<ContextIndexEntry | undefined> {
    const rows = await this.database.query<ContextIndexEntryRow>(`
SELECT
  id,
  project_id AS projectId,
  layer,
  source_kind AS sourceKind,
  source_id AS sourceId,
  scope,
  trust_level AS trustLevel,
  lifetime,
  title,
  content,
  content_hash AS contentHash,
  source_path AS sourcePath,
  metadata_json AS metadataJson,
  created_at AS createdAt,
  updated_at AS updatedAt,
  indexed_at AS indexedAt
FROM context_index_entries
WHERE id = ${sqlString(entryId)}
LIMIT 1;
`);
    const row = rows[0];
    return row ? contextIndexEntryFromRow(row) : undefined;
  }

  async search(
    input: ContextIndexSearchInput
  ): Promise<ContextIndexSearchResult[]> {
    const terms = normalizeContextIndexSearchTerms(input.terms ?? input.query);
    const ftsQuery = ftsQueryForTerms(terms);
    if (!ftsQuery) {
      return [];
    }
    const limit = Math.max(1, Math.min(input.limit ?? 10, 50));
    const rows = await this.database.query<ContextIndexSearchRow>(`
SELECT
  e.id,
  e.project_id AS projectId,
  e.layer,
  e.source_kind AS sourceKind,
  e.source_id AS sourceId,
  e.scope,
  e.trust_level AS trustLevel,
  e.lifetime,
  e.title,
  e.content,
  e.content_hash AS contentHash,
  e.source_path AS sourcePath,
  e.metadata_json AS metadataJson,
  e.created_at AS createdAt,
  e.updated_at AS updatedAt,
  e.indexed_at AS indexedAt,
  bm25(context_text_fts) AS bm25Score
FROM context_text_fts
JOIN context_index_entries e ON e.id = context_text_fts.id
WHERE context_text_fts.project_id = ${sqlString(input.projectId)}
  AND context_text_fts MATCH ${sqlString(ftsQuery)}
ORDER BY bm25Score ASC, e.id ASC
LIMIT ${limit};
`);
    return rows.map((row, index) => ({
      entry: contextIndexEntryFromRow(row),
      lexicalScore: 1 / (index + 1),
      rank: index + 1,
      diagnostics: {
        query: input.query,
        terms,
        ftsQuery,
        bm25Score: row.bm25Score
      }
    }));
  }
}

export class SQLiteCodeGraphRepository implements CodeGraphRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async rebuildProject(
    projectId: string,
    entries: CodeGraphEntry[],
    indexedAt: string
  ): Promise<CodeGraphRebuildResult> {
    const validEntries = entries.map(validateCodeGraphEntry);
    for (const entry of validEntries) {
      if (entry.projectId !== projectId) {
        throw new Error(`code graph entry ${entry.id} belongs to project ${entry.projectId}, not ${projectId}`);
      }
    }

    const existingEntries = await this.listByProjectId(projectId);
    const existingById = new Map(existingEntries.map((entry) => [entry.id, entry]));
    const incomingIds = new Set(validEntries.map((entry) => entry.id));
    let createdCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;
    let deletedCount = 0;

    for (const entry of validEntries) {
      const indexedEntry = validateCodeGraphEntry({ ...entry, indexedAt });
      const existing = existingById.get(entry.id);
      if (existing && codeGraphEntryUnchanged(existing, indexedEntry)) {
        unchangedCount += 1;
        continue;
      }
      await this.database.execute(upsertCodeGraphEntrySql(indexedEntry));
      if (existing) {
        updatedCount += 1;
      } else {
        createdCount += 1;
      }
    }

    for (const entry of existingEntries) {
      if (!incomingIds.has(entry.id)) {
        await this.database.execute(`
DELETE FROM code_graph_entries WHERE id = ${sqlString(entry.id)};
`);
        deletedCount += 1;
      }
    }

    return {
      projectId,
      indexedAt,
      createdCount,
      updatedCount,
      unchangedCount,
      deletedCount,
      indexedIds: validEntries.map((entry) => entry.id).sort()
    };
  }

  async listByProjectId(projectId: string): Promise<CodeGraphEntry[]> {
    const rows = await this.database.query<CodeGraphEntryRow>(`
SELECT
  id,
  project_id AS projectId,
  file_path AS filePath,
  package_name AS packageName,
  is_test AS isTest,
  imports_json AS importsJson,
  exports_json AS exportsJson,
  symbols_json AS symbolsJson,
  related_tests_json AS relatedTestsJson,
  content_hash AS contentHash,
  metadata_json AS metadataJson,
  indexed_at AS indexedAt
FROM code_graph_entries
WHERE project_id = ${sqlString(projectId)}
ORDER BY file_path ASC;
`);
    return rows.map(codeGraphEntryFromRow);
  }

  async search(input: CodeGraphSearchInput): Promise<CodeGraphSearchResult[]> {
    const terms = normalizeSearchTerms(input.queryTerms);
    const seedPaths = normalizePathSet(input.seedPaths ?? []);
    const changedFiles = normalizePathSet(input.changedFiles ?? []);
    if (terms.length === 0 && seedPaths.size === 0 && changedFiles.size === 0) {
      return [];
    }
    const limit = Math.max(1, Math.min(input.limit ?? 8, 50));
    const scored = (await this.listByProjectId(input.projectId))
      .map((entry) =>
        scoreCodeGraphEntry(entry, {
          terms,
          seedPaths,
          changedFiles
        })
      )
      .filter((result) => result.score > 0)
      .sort((left, right) =>
        right.score === left.score
          ? left.entry.filePath.localeCompare(right.entry.filePath)
          : right.score - left.score
      )
      .slice(0, limit);
    return scored.map((result, index) => ({
      entry: result.entry,
      score: Math.min(1, result.score),
      rank: index + 1,
      matchedTerms: result.matchedTerms,
      matchedSymbols: result.matchedSymbols,
      matchedImports: result.matchedImports,
      relatedFiles: result.relatedFiles,
      diagnostics: {
        queryTerms: terms,
        seedPaths: [...seedPaths],
        changedFiles: [...changedFiles],
        packageName: result.entry.packageName,
        isTest: result.entry.isTest
      }
    }));
  }
}

export class SQLiteContextEvalEventRepository
  implements ContextEvalEventRepository
{
  constructor(private readonly database: SqliteDatabase) {}

  async create(event: ContextEvalEvent): Promise<ContextEvalEvent> {
    const validEvent = validateContextEvalEvent(event);
    await this.database.execute(`
INSERT INTO context_eval_events (
  id,
  project_id,
  task_id,
  run_id,
  plan_id,
  kind,
  severity,
  message,
  selected_item_ids_json,
  omitted_item_ids_json,
  metadata_json,
  created_at
) VALUES (
  ${sqlString(validEvent.id)},
  ${sqlString(validEvent.projectId)},
  ${sqlString(validEvent.taskId)},
  ${sqlString(validEvent.runId)},
  ${sqlNullableString(validEvent.planId)},
  ${sqlString(validEvent.kind)},
  ${sqlString(validEvent.severity)},
  ${sqlString(validEvent.message)},
  ${sqlJson(validEvent.selectedItemIds)},
  ${sqlJson(validEvent.omittedItemIds)},
  ${sqlJson(validEvent.metadata)},
  ${sqlString(validEvent.createdAt)}
);
`);
    return cloneContextEvalEvent(validEvent);
  }

  async createMany(events: ContextEvalEvent[]): Promise<ContextEvalEvent[]> {
    const created: ContextEvalEvent[] = [];
    for (const event of events) {
      created.push(await this.create(event));
    }
    return created;
  }

  async listByRunId(runId: string): Promise<ContextEvalEvent[]> {
    const rows = await this.database.query<ContextEvalEventRow>(`
SELECT ${contextEvalEventSelectColumns()}
FROM context_eval_events
WHERE run_id = ${sqlString(runId)}
ORDER BY created_at ASC, id ASC;
`);
    return rows.map(contextEvalEventFromRow);
  }

  async listByProjectId(projectId: string): Promise<ContextEvalEvent[]> {
    const rows = await this.database.query<ContextEvalEventRow>(`
SELECT ${contextEvalEventSelectColumns()}
FROM context_eval_events
WHERE project_id = ${sqlString(projectId)}
ORDER BY created_at ASC, id ASC;
`);
    return rows.map(contextEvalEventFromRow);
  }
}

export class SQLiteSettingsRepository implements SettingsRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async set(setting: Setting): Promise<Setting> {
    const validSetting = validateSetting(setting);
    await this.database.execute(`
INSERT INTO settings (key, value_json, updated_at)
VALUES (
  ${sqlString(validSetting.key)},
  ${sqlJson(validSetting.value)},
  ${sqlString(validSetting.updatedAt)}
)
ON CONFLICT(key) DO UPDATE SET
  value_json = excluded.value_json,
  updated_at = excluded.updated_at;
`);
    return cloneSetting(validSetting);
  }

  async get(key: string): Promise<Setting | undefined> {
    const rows = await this.database.query<SettingRow>(`
SELECT
  key,
  value_json AS valueJson,
  updated_at AS updatedAt
FROM settings
WHERE key = ${sqlString(key)}
LIMIT 1;
`);
    const row = rows[0];
    return row ? settingFromRow(row) : undefined;
  }

  async list(): Promise<Setting[]> {
    const rows = await this.database.query<SettingRow>(`
SELECT
  key,
  value_json AS valueJson,
  updated_at AS updatedAt
FROM settings
ORDER BY key ASC;
`);
    return rows.map(settingFromRow);
  }
}

export class SQLiteRoleCallRepository implements RoleCallRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async create(call: RoleCall): Promise<RoleCall> {
    const validCall = validateRoleCall(call);
    await this.database.execute(roleCallInsertSql(validCall));
    return cloneRoleCall(validCall);
  }

  async update(call: RoleCall): Promise<RoleCall> {
    const validCall = validateRoleCall(call);
    const existing = await this.get(validCall.id);
    if (!existing) {
      throw new Error(`role call ${validCall.id} not found`);
    }
    validateRoleCallStatusTransition(existing.status, validCall.status);
    await this.database.execute(roleCallUpdateSql(validCall));
    return cloneRoleCall(validCall);
  }

  async updateStatus(
    roleCallId: string,
    status: RoleCallStatus,
    at: string
  ): Promise<RoleCall> {
    const existing = await this.get(roleCallId);
    if (!existing) {
      throw new Error(`role call ${roleCallId} not found`);
    }
    validateRoleCallStatusTransition(existing.status, status);
    return this.update({
      ...existing,
      status,
      startedAt: status === "running" ? existing.startedAt ?? at : existing.startedAt,
      completedAt: isTerminalRoleCallStatus(status)
        ? at
        : existing.completedAt
    });
  }

  async linkTaskRun(
    roleCallId: string,
    taskRunId: string | undefined
  ): Promise<RoleCall> {
    const existing = await this.get(roleCallId);
    if (!existing) {
      throw new Error(`role call ${roleCallId} not found`);
    }
    return this.update({ ...existing, taskRunId });
  }

  async get(roleCallId: string): Promise<RoleCall | undefined> {
    const rows = await this.database.query<RoleCallRow>(`
SELECT
  rc.id,
  rc.thread_id AS threadId,
  rc.parent_message_id AS parentMessageId,
  rc.parent_role_call_id AS parentRoleCallId,
  rc.caller_role AS callerRole,
  rc.callee_role AS calleeRole,
  rc.task,
  rc.reason,
  rc.context_json AS contextJson,
  rc.permissions_json AS permissionsJson,
  rc.expected_output_json AS expectedOutputJson,
  rc.priority,
  rc.depth,
  rc.status,
  rc.decision_json AS decisionJson,
  rc.result_json AS resultJson,
  rc.task_run_id AS taskRunId,
  rc.todo_id AS todoId,
  rc.error,
  rc.created_at AS createdAt,
  rc.started_at AS startedAt,
  rc.completed_at AS completedAt
FROM role_calls rc
WHERE rc.id = ${sqlString(roleCallId)}
LIMIT 1;
`);
    const row = rows[0];
    return row ? roleCallFromRow(row) : undefined;
  }

  async list(filter: RoleCallListFilter = {}): Promise<RoleCall[]> {
    const where = roleCallWhereClause(filter);
    const todoJoin =
      filter.todoStatus === undefined
        ? ""
        : "LEFT JOIN role_todos rt ON rt.id = rc.todo_id";
    const rows = await this.database.query<RoleCallRow>(`
SELECT
  rc.id,
  rc.thread_id AS threadId,
  rc.parent_message_id AS parentMessageId,
  rc.parent_role_call_id AS parentRoleCallId,
  rc.caller_role AS callerRole,
  rc.callee_role AS calleeRole,
  rc.task,
  rc.reason,
  rc.context_json AS contextJson,
  rc.permissions_json AS permissionsJson,
  rc.expected_output_json AS expectedOutputJson,
  rc.priority,
  rc.depth,
  rc.status,
  rc.decision_json AS decisionJson,
  rc.result_json AS resultJson,
  rc.task_run_id AS taskRunId,
  rc.todo_id AS todoId,
  rc.error,
  rc.created_at AS createdAt,
  rc.started_at AS startedAt,
  rc.completed_at AS completedAt
FROM role_calls rc
${todoJoin}
${where}
ORDER BY rc.created_at ASC, rc.id ASC;
`);
    return rows.map(roleCallFromRow);
  }
}

export class SQLiteRoleCallEventRepository
  implements RoleCallEventRepository
{
  constructor(private readonly database: SqliteDatabase) {}

  async create(event: RoleCallEvent): Promise<RoleCallEvent> {
    const validEvent = validateRoleCallEvent(event);
    await this.database.execute(roleCallEventInsertSql(validEvent));
    return cloneRoleCallEvent(validEvent);
  }

  async createMany(events: RoleCallEvent[]): Promise<RoleCallEvent[]> {
    if (events.length === 0) {
      return [];
    }
    await this.database.execute(
      events.map((event) => roleCallEventInsertSql(event)).join("\n")
    );
    return events.map((event) => cloneRoleCallEvent(validateRoleCallEvent(event)));
  }

  async listByRoleCallId(roleCallId: string): Promise<RoleCallEvent[]> {
    const rows = await this.database.query<RoleCallEventRow>(`
SELECT
  id,
  role_call_id AS roleCallId,
  thread_id AS threadId,
  type,
  actor_role AS actorRole,
  message,
  metadata_json AS metadataJson,
  created_at AS createdAt
FROM role_call_events
WHERE role_call_id = ${sqlString(roleCallId)}
ORDER BY created_at ASC, id ASC;
`);
    return rows.map(roleCallEventFromRow);
  }

  async listByThreadId(threadId: string): Promise<RoleCallEvent[]> {
    const rows = await this.database.query<RoleCallEventRow>(`
SELECT
  id,
  role_call_id AS roleCallId,
  thread_id AS threadId,
  type,
  actor_role AS actorRole,
  message,
  metadata_json AS metadataJson,
  created_at AS createdAt
FROM role_call_events
WHERE thread_id = ${sqlString(threadId)}
ORDER BY created_at ASC, id ASC;
`);
    return rows.map(roleCallEventFromRow);
  }
}

export class SQLiteRoleTodoRepository implements RoleTodoRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async create(todo: RoleTodo): Promise<RoleTodo> {
    const validTodo = validateRoleTodo(todo);
    await this.database.execute(roleTodoInsertSql(validTodo));
    return cloneRoleTodo(validTodo);
  }

  async update(todo: RoleTodo): Promise<RoleTodo> {
    const validTodo = validateRoleTodo(todo);
    const existing = await this.get(validTodo.id);
    if (!existing) {
      throw new Error(`role todo ${validTodo.id} not found`);
    }
    validateRoleTodoStatusTransition(existing.status, validTodo.status);
    await this.database.execute(roleTodoUpdateSql(validTodo));
    return cloneRoleTodo(validTodo);
  }

  async updateStatus(
    todoId: string,
    status: RoleTodoStatus,
    updatedAt: string
  ): Promise<RoleTodo> {
    const existing = await this.get(todoId);
    if (!existing) {
      throw new Error(`role todo ${todoId} not found`);
    }
    validateRoleTodoStatusTransition(existing.status, status);
    return this.update({
      ...existing,
      status,
      updatedAt,
      completedAt: isTerminalRoleTodoStatus(status)
        ? updatedAt
        : existing.completedAt
    });
  }

  async get(todoId: string): Promise<RoleTodo | undefined> {
    const rows = await this.database.query<RoleTodoRow>(`
SELECT
  id,
  thread_id AS threadId,
  role,
  source_role_call_id AS sourceRoleCallId,
  parent_todo_id AS parentTodoId,
  title,
  description,
  status,
  priority,
  reason,
  blocked_by_json AS blockedByJson,
  related_role_call_ids_json AS relatedRoleCallIdsJson,
  created_at AS createdAt,
  updated_at AS updatedAt,
  completed_at AS completedAt
FROM role_todos
WHERE id = ${sqlString(todoId)}
LIMIT 1;
`);
    const row = rows[0];
    return row ? roleTodoFromRow(row) : undefined;
  }

  async list(filter: RoleTodoListFilter = {}): Promise<RoleTodo[]> {
    const rows = await this.database.query<RoleTodoRow>(`
SELECT
  id,
  thread_id AS threadId,
  role,
  source_role_call_id AS sourceRoleCallId,
  parent_todo_id AS parentTodoId,
  title,
  description,
  status,
  priority,
  reason,
  blocked_by_json AS blockedByJson,
  related_role_call_ids_json AS relatedRoleCallIdsJson,
  created_at AS createdAt,
  updated_at AS updatedAt,
  completed_at AS completedAt
FROM role_todos
${roleTodoWhereClause(filter)}
ORDER BY created_at ASC, id ASC;
`);
    return rows.map(roleTodoFromRow);
  }
}

interface ProjectRow extends Record<string, unknown> {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
}

interface AgentProfileRow extends Record<string, unknown> {
  id: string;
  kind: string;
  displayName: string;
  command: string | null;
  enabled: number;
  createdAt: string;
  updatedAt: string;
}

interface TaskRow extends Record<string, unknown> {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  metadataJson: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface TaskRunRow extends Record<string, unknown> {
  id: string;
  taskId: string;
  agentProfileId: string | null;
  agentKind: string;
  status: string;
  worktreePath: string | null;
  branchName: string | null;
  parentRunId: string | null;
  parentMessageId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RunStatusTransitionRow extends Record<string, unknown> {
  runId: string;
  status: string;
  at: string;
}

interface RunMetadataRow extends Record<string, unknown> {
  runId: string;
  workspaceJson: string | null;
  workspaceCleanupJson: string | null;
  diffJson: string | null;
  verificationJson: string | null;
  riskReportJson: string | null;
  roleJson: string | null;
}

interface RunEventRow extends Record<string, unknown> {
  id: string;
  taskRunId: string;
  sequence: number;
  type: string;
  message: string;
  metadataJson: string;
  createdAt: string;
}

interface RunArtifactRow extends Record<string, unknown> {
  id: string;
  taskRunId: string;
  kind: string;
  content: string;
  metadataJson: string;
  createdAt: string;
}

interface ContextEvalEventRow extends Record<string, unknown> {
  id: string;
  projectId: string;
  taskId: string;
  runId: string;
  planId: string | null;
  kind: string;
  severity: string;
  message: string;
  selectedItemIdsJson: string;
  omittedItemIdsJson: string;
  metadataJson: string;
  createdAt: string;
}

interface ConversationThreadRow extends Record<string, unknown> {
  id: string;
  projectId: string;
  title: string;
  metadataJson: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ConversationMessageRow extends Record<string, unknown> {
  id: string;
  threadId: string;
  sequence: number;
  role: string;
  kind: string;
  content: string;
  agentKind: string | null;
  runId: string | null;
  status: string | null;
  metadataJson: string | null;
  createdAt: string;
}

interface ConversationThreadSummaryRow extends Record<string, unknown> {
  id: string;
  threadId: string;
  summary: string;
  decisionsJson: string;
  openItemsJson: string;
  constraintsJson: string;
  lastKnownUserGoal: string | null;
  sourceMessageCount: number;
  sourceLatestMessageId: string | null;
  metadataJson: string | null;
  createdAt: string;
  updatedAt: string;
}

interface VerificationResultRow extends Record<string, unknown> {
  id: string;
  taskRunId: string;
  command: string;
  status: string;
  exitCode: number | null;
  stdout: string | null;
  stderr: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface RiskReportRow extends Record<string, unknown> {
  id: string;
  taskRunId: string;
  level: string;
  summary: string;
  findingsJson: string;
  changedFilesJson: string;
  verificationSummary: string;
  failedChecksJson: string;
  riskFactorsJson: string;
  manualReviewChecklistJson: string;
  acceptanceRecommendation: string;
  createdAt: string;
}

interface MemoryItemRow extends Record<string, unknown> {
  id: string;
  projectId: string;
  taskId: string | null;
  category: string;
  status: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface ComparisonReportRow extends Record<string, unknown> {
  id: string;
  taskId: string;
  baselineRunId: string | null;
  candidateRunId: string | null;
  summary: string;
  detailsJson: string | null;
  createdAt: string;
}

interface SkillRow extends Record<string, unknown> {
  id: string;
  projectId: string | null;
  name: string;
  description: string;
  path: string;
  createdAt: string;
  updatedAt: string;
}

interface ContextIndexEntryRow extends Record<string, unknown> {
  id: string;
  projectId: string;
  layer: string;
  sourceKind: string;
  sourceId: string;
  scope: string;
  trustLevel: string;
  lifetime: string;
  title: string;
  content: string;
  contentHash: string;
  sourcePath: string | null;
  metadataJson: string;
  createdAt: string;
  updatedAt: string | null;
  indexedAt: string;
}

interface ContextIndexSearchRow extends ContextIndexEntryRow {
  bm25Score: number;
}

interface CodeGraphEntryRow extends Record<string, unknown> {
  id: string;
  projectId: string;
  filePath: string;
  packageName: string;
  isTest: number;
  importsJson: string;
  exportsJson: string;
  symbolsJson: string;
  relatedTestsJson: string;
  contentHash: string;
  metadataJson: string;
  indexedAt: string;
}

interface SettingRow extends Record<string, unknown> {
  key: string;
  valueJson: string;
  updatedAt: string;
}

interface RoleCallRow extends Record<string, unknown> {
  id: string;
  threadId: string;
  parentMessageId: string | null;
  parentRoleCallId: string | null;
  callerRole: string;
  calleeRole: string;
  task: string;
  reason: string | null;
  contextJson: string;
  permissionsJson: string;
  expectedOutputJson: string;
  priority: string;
  depth: number;
  status: string;
  decisionJson: string | null;
  resultJson: string | null;
  taskRunId: string | null;
  todoId: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

interface RoleCallEventRow extends Record<string, unknown> {
  id: string;
  roleCallId: string;
  threadId: string;
  type: string;
  actorRole: string | null;
  message: string;
  metadataJson: string | null;
  createdAt: string;
}

interface RoleTodoRow extends Record<string, unknown> {
  id: string;
  threadId: string;
  role: string;
  sourceRoleCallId: string | null;
  parentTodoId: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  reason: string | null;
  blockedByJson: string | null;
  relatedRoleCallIdsJson: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

function projectFromRow(row: ProjectRow): Project {
  return validateProject({
    id: row.id,
    name: row.name,
    rootPath: row.rootPath,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  });
}

function agentProfileFromRow(row: AgentProfileRow): AgentProfile {
  return validateAgentProfile({
    id: row.id,
    kind: row.kind as AgentKind,
    displayName: row.displayName,
    command: nullToUndefined(row.command),
    enabled: row.enabled === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  });
}

function taskFromRow(row: TaskRow): Task {
  return validateTask({
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    description: nullToUndefined(row.description),
    metadata: parseJson(row.metadataJson),
    status: row.status as TaskStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  });
}

function taskRunFromRow(row: TaskRunRow): TaskRun {
  return validateTaskRun({
    id: row.id,
    taskId: row.taskId,
    agentProfileId: nullToUndefined(row.agentProfileId),
    agentKind: row.agentKind as TaskRun["agentKind"],
    status: row.status as TaskRunStatus,
    worktreePath: nullToUndefined(row.worktreePath),
    branchName: nullToUndefined(row.branchName),
    parentRunId: nullToUndefined(row.parentRunId),
    parentMessageId: nullToUndefined(row.parentMessageId),
    startedAt: nullToUndefined(row.startedAt),
    completedAt: nullToUndefined(row.completedAt),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  });
}

function metadataFromRow(row: RunMetadataRow): RunMetadata {
  return {
    runId: row.runId,
    workspace: parseJson(row.workspaceJson),
    workspaceCleanup: parseJson(row.workspaceCleanupJson),
    diff: parseJson(row.diffJson),
    verification: parseJson(row.verificationJson),
    riskReport: parseJson(row.riskReportJson),
    role: parseJson(row.roleJson)
  };
}

function runEventFromRow(row: RunEventRow): RunEvent {
  return validateRunEvent({
    id: row.id,
    taskRunId: row.taskRunId,
    sequence: row.sequence,
    type: row.type as RunEventType,
    message: row.message,
    metadata: parseJson(row.metadataJson) ?? {},
    createdAt: row.createdAt
  });
}

function runArtifactFromRow(row: RunArtifactRow): RunArtifact {
  return validateRunArtifact({
    id: row.id,
    taskRunId: row.taskRunId,
    kind: row.kind,
    content: row.content,
    metadata: parseJson(row.metadataJson) ?? {},
    createdAt: row.createdAt
  });
}

function contextEvalEventFromRow(row: ContextEvalEventRow): ContextEvalEvent {
  return validateContextEvalEvent({
    id: row.id,
    projectId: row.projectId,
    taskId: row.taskId,
    runId: row.runId,
    planId: nullToUndefined(row.planId),
    kind: row.kind as ContextEvalEvent["kind"],
    severity: row.severity as ContextEvalEvent["severity"],
    message: row.message,
    selectedItemIds: parseJson(row.selectedItemIdsJson) ?? [],
    omittedItemIds: parseJson(row.omittedItemIdsJson) ?? [],
    metadata: parseJson(row.metadataJson) ?? {},
    createdAt: row.createdAt
  });
}

function conversationThreadFromRow(
  row: ConversationThreadRow
): ConversationThread {
  return validateConversationThread({
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    metadata: parseJson(row.metadataJson),
    archivedAt: nullToUndefined(row.archivedAt),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  });
}

function conversationMessageFromRow(
  row: ConversationMessageRow
): ConversationMessage {
  return validateConversationMessage({
    id: row.id,
    threadId: row.threadId,
    sequence: row.sequence,
    role: row.role as ConversationMessage["role"],
    kind: row.kind as ConversationMessage["kind"],
    content: row.content,
    agentKind: nullToUndefined(row.agentKind) as ConversationMessage["agentKind"],
    runId: nullToUndefined(row.runId),
    status: nullToUndefined(row.status) as ConversationMessage["status"],
    metadata: parseJson(row.metadataJson),
    createdAt: row.createdAt
  });
}

function conversationThreadSummaryFromRow(
  row: ConversationThreadSummaryRow
): ConversationThreadSummary {
  return validateConversationThreadSummary({
    id: row.id,
    threadId: row.threadId,
    summary: row.summary,
    decisions: parseJson<string[]>(row.decisionsJson) ?? [],
    openItems: parseJson<string[]>(row.openItemsJson) ?? [],
    constraints: parseJson<string[]>(row.constraintsJson) ?? [],
    lastKnownUserGoal: nullToUndefined(row.lastKnownUserGoal),
    sourceMessageCount: row.sourceMessageCount,
    sourceLatestMessageId: nullToUndefined(row.sourceLatestMessageId),
    metadata: parseJson(row.metadataJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  });
}

function verificationResultFromRow(row: VerificationResultRow): VerificationResult {
  return validateVerificationResult({
    id: row.id,
    taskRunId: row.taskRunId,
    command: row.command,
    status: row.status as VerificationStatus,
    exitCode: nullToUndefined(row.exitCode),
    stdout: nullToUndefined(row.stdout),
    stderr: nullToUndefined(row.stderr),
    startedAt: nullToUndefined(row.startedAt),
    completedAt: nullToUndefined(row.completedAt),
    createdAt: row.createdAt
  });
}

function riskReportFromRow(row: RiskReportRow): RiskReport {
  return validateRiskReport({
    id: row.id,
    taskRunId: row.taskRunId,
    level: row.level as RiskLevel,
    summary: row.summary,
    changedFiles: parseJson(row.changedFilesJson) ?? [],
    verificationSummary: row.verificationSummary,
    failedChecks: parseJson(row.failedChecksJson) ?? [],
    riskFactors: parseJson(row.riskFactorsJson) ?? [],
    manualReviewChecklist: parseJson(row.manualReviewChecklistJson) ?? [],
    acceptanceRecommendation: row.acceptanceRecommendation,
    findings: parseJson(row.findingsJson) ?? [],
    createdAt: row.createdAt
  });
}

function memoryItemFromRow(row: MemoryItemRow): MemoryItem {
  return validateMemoryItem({
    id: row.id,
    projectId: row.projectId,
    taskId: nullToUndefined(row.taskId),
    category: row.category as MemoryItem["category"],
    status: row.status as MemoryItem["status"],
    content: row.content,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  });
}

function comparisonReportFromRow(row: ComparisonReportRow): ComparisonReport {
  return validateComparisonReport({
    id: row.id,
    taskId: row.taskId,
    baselineRunId: nullToUndefined(row.baselineRunId),
    candidateRunId: nullToUndefined(row.candidateRunId),
    summary: row.summary,
    details: parseJson<Record<string, unknown>>(row.detailsJson),
    createdAt: row.createdAt
  });
}

function skillFromRow(row: SkillRow): Skill {
  return validateSkill({
    id: row.id,
    projectId: nullToUndefined(row.projectId),
    name: row.name,
    description: row.description,
    path: row.path,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  });
}

function contextIndexEntryFromRow(row: ContextIndexEntryRow): ContextIndexEntry {
  return validateContextIndexEntry({
    id: row.id,
    projectId: row.projectId,
    layer: row.layer as ContextIndexEntry["layer"],
    sourceKind: row.sourceKind as ContextIndexEntry["sourceKind"],
    sourceId: row.sourceId,
    scope: row.scope as ContextIndexEntry["scope"],
    trustLevel: row.trustLevel as ContextIndexEntry["trustLevel"],
    lifetime: row.lifetime as ContextIndexEntry["lifetime"],
    title: row.title,
    content: row.content,
    contentHash: row.contentHash,
    sourcePath: nullToUndefined(row.sourcePath),
    createdAt: row.createdAt,
    updatedAt: nullToUndefined(row.updatedAt),
    indexedAt: row.indexedAt,
    metadata: parseJson<Record<string, unknown>>(row.metadataJson) ?? {}
  });
}

function codeGraphEntryFromRow(row: CodeGraphEntryRow): CodeGraphEntry {
  return validateCodeGraphEntry({
    id: row.id,
    projectId: row.projectId,
    filePath: row.filePath,
    packageName: row.packageName,
    isTest: row.isTest === 1,
    imports: parseJson<string[]>(row.importsJson) ?? [],
    exports: parseJson<string[]>(row.exportsJson) ?? [],
    symbols: parseJson<string[]>(row.symbolsJson) ?? [],
    relatedTests: parseJson<string[]>(row.relatedTestsJson) ?? [],
    contentHash: row.contentHash,
    indexedAt: row.indexedAt,
    metadata: parseJson<Record<string, unknown>>(row.metadataJson) ?? {}
  });
}

function settingFromRow(row: SettingRow): Setting {
  return validateSetting({
    key: row.key,
    value: parseJson(row.valueJson),
    updatedAt: row.updatedAt
  });
}

function roleCallFromRow(row: RoleCallRow): RoleCall {
  return validateRoleCall({
    id: row.id,
    threadId: row.threadId,
    parentMessageId: nullToUndefined(row.parentMessageId),
    parentRoleCallId: nullToUndefined(row.parentRoleCallId),
    callerRole: row.callerRole,
    calleeRole: row.calleeRole,
    task: row.task,
    reason: nullToUndefined(row.reason),
    context: parseJson(row.contextJson) as RoleCall["context"],
    permissions: parseJson(row.permissionsJson) as RoleCall["permissions"],
    expectedOutput: parseJson(row.expectedOutputJson) as RoleCall["expectedOutput"],
    priority: row.priority as RoleCall["priority"],
    depth: row.depth,
    status: row.status as RoleCallStatus,
    decision: parseJson(row.decisionJson),
    result: parseJson(row.resultJson),
    taskRunId: nullToUndefined(row.taskRunId),
    todoId: nullToUndefined(row.todoId),
    error: nullToUndefined(row.error),
    createdAt: row.createdAt,
    startedAt: nullToUndefined(row.startedAt),
    completedAt: nullToUndefined(row.completedAt)
  });
}

function roleCallEventFromRow(row: RoleCallEventRow): RoleCallEvent {
  return validateRoleCallEvent({
    id: row.id,
    roleCallId: row.roleCallId,
    threadId: row.threadId,
    type: row.type as RoleCallEvent["type"],
    actorRole: nullToUndefined(row.actorRole),
    message: row.message,
    metadata: parseJson(row.metadataJson),
    createdAt: row.createdAt
  });
}

function roleTodoFromRow(row: RoleTodoRow): RoleTodo {
  return validateRoleTodo({
    id: row.id,
    threadId: row.threadId,
    role: row.role,
    sourceRoleCallId: nullToUndefined(row.sourceRoleCallId),
    parentTodoId: nullToUndefined(row.parentTodoId),
    title: row.title,
    description: nullToUndefined(row.description),
    status: row.status as RoleTodoStatus,
    priority: row.priority as RoleTodo["priority"],
    reason: nullToUndefined(row.reason),
    blockedBy: parseJson(row.blockedByJson),
    relatedRoleCallIds: parseJson(row.relatedRoleCallIdsJson) ?? [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: nullToUndefined(row.completedAt)
  });
}

function conversationMessageInsertSql(message: ConversationMessage): string {
  const validMessage = validateConversationMessage(message);
  return `
INSERT INTO conversation_messages (
  id,
  thread_id,
  sequence,
  role,
  kind,
  content,
  agent_kind,
  run_id,
  status,
  metadata_json,
  created_at
) VALUES (
  ${sqlString(validMessage.id)},
  ${sqlString(validMessage.threadId)},
  ${validMessage.sequence},
  ${sqlString(validMessage.role)},
  ${sqlString(validMessage.kind)},
  ${sqlString(validMessage.content)},
  ${sqlNullableString(validMessage.agentKind)},
  ${sqlNullableString(validMessage.runId)},
  ${sqlNullableString(validMessage.status)},
  ${sqlJson(validMessage.metadata)},
  ${sqlString(validMessage.createdAt)}
);`;
}

function verificationInsertSql(result: VerificationResult): string {
  const validResult = validateVerificationResult(result);
  return `
INSERT INTO verification_results (
  id,
  task_run_id,
  command,
  status,
  exit_code,
  stdout,
  stderr,
  started_at,
  completed_at,
  created_at
) VALUES (
  ${sqlString(validResult.id)},
  ${sqlString(validResult.taskRunId)},
  ${sqlString(validResult.command)},
  ${sqlString(validResult.status)},
  ${sqlNullableInteger(validResult.exitCode)},
  ${sqlNullableString(validResult.stdout)},
  ${sqlNullableString(validResult.stderr)},
  ${sqlNullableString(validResult.startedAt)},
  ${sqlNullableString(validResult.completedAt)},
  ${sqlString(validResult.createdAt)}
);`;
}

function roleCallInsertSql(call: RoleCall): string {
  const validCall = validateRoleCall(call);
  return `
INSERT INTO role_calls (
  id,
  thread_id,
  parent_message_id,
  parent_role_call_id,
  caller_role,
  callee_role,
  task,
  reason,
  context_json,
  permissions_json,
  expected_output_json,
  priority,
  depth,
  status,
  decision_json,
  result_json,
  task_run_id,
  todo_id,
  error,
  created_at,
  started_at,
  completed_at
) VALUES (
  ${sqlString(validCall.id)},
  ${sqlString(validCall.threadId)},
  ${sqlNullableString(validCall.parentMessageId)},
  ${sqlNullableString(validCall.parentRoleCallId)},
  ${sqlString(validCall.callerRole)},
  ${sqlString(validCall.calleeRole)},
  ${sqlString(validCall.task)},
  ${sqlNullableString(validCall.reason)},
  ${sqlJson(validCall.context)},
  ${sqlJson(validCall.permissions)},
  ${sqlJson(validCall.expectedOutput)},
  ${sqlString(validCall.priority)},
  ${validCall.depth},
  ${sqlString(validCall.status)},
  ${sqlJson(validCall.decision)},
  ${sqlJson(validCall.result)},
  ${sqlNullableString(validCall.taskRunId)},
  ${sqlNullableString(validCall.todoId)},
  ${sqlNullableString(validCall.error)},
  ${sqlString(validCall.createdAt)},
  ${sqlNullableString(validCall.startedAt)},
  ${sqlNullableString(validCall.completedAt)}
);`;
}

function roleCallUpdateSql(call: RoleCall): string {
  const validCall = validateRoleCall(call);
  return `
UPDATE role_calls
SET
  thread_id = ${sqlString(validCall.threadId)},
  parent_message_id = ${sqlNullableString(validCall.parentMessageId)},
  parent_role_call_id = ${sqlNullableString(validCall.parentRoleCallId)},
  caller_role = ${sqlString(validCall.callerRole)},
  callee_role = ${sqlString(validCall.calleeRole)},
  task = ${sqlString(validCall.task)},
  reason = ${sqlNullableString(validCall.reason)},
  context_json = ${sqlJson(validCall.context)},
  permissions_json = ${sqlJson(validCall.permissions)},
  expected_output_json = ${sqlJson(validCall.expectedOutput)},
  priority = ${sqlString(validCall.priority)},
  depth = ${validCall.depth},
  status = ${sqlString(validCall.status)},
  decision_json = ${sqlJson(validCall.decision)},
  result_json = ${sqlJson(validCall.result)},
  task_run_id = ${sqlNullableString(validCall.taskRunId)},
  todo_id = ${sqlNullableString(validCall.todoId)},
  error = ${sqlNullableString(validCall.error)},
  created_at = ${sqlString(validCall.createdAt)},
  started_at = ${sqlNullableString(validCall.startedAt)},
  completed_at = ${sqlNullableString(validCall.completedAt)}
WHERE id = ${sqlString(validCall.id)};`;
}

function roleCallEventInsertSql(event: RoleCallEvent): string {
  const validEvent = validateRoleCallEvent(event);
  return `
INSERT INTO role_call_events (
  id,
  role_call_id,
  thread_id,
  type,
  actor_role,
  message,
  metadata_json,
  created_at
) VALUES (
  ${sqlString(validEvent.id)},
  ${sqlString(validEvent.roleCallId)},
  ${sqlString(validEvent.threadId)},
  ${sqlString(validEvent.type)},
  ${sqlNullableString(validEvent.actorRole)},
  ${sqlString(validEvent.message)},
  ${sqlJson(validEvent.metadata)},
  ${sqlString(validEvent.createdAt)}
);`;
}

function roleTodoInsertSql(todo: RoleTodo): string {
  const validTodo = validateRoleTodo(todo);
  return `
INSERT INTO role_todos (
  id,
  thread_id,
  role,
  source_role_call_id,
  parent_todo_id,
  title,
  description,
  status,
  priority,
  reason,
  blocked_by_json,
  related_role_call_ids_json,
  created_at,
  updated_at,
  completed_at
) VALUES (
  ${sqlString(validTodo.id)},
  ${sqlString(validTodo.threadId)},
  ${sqlString(validTodo.role)},
  ${sqlNullableString(validTodo.sourceRoleCallId)},
  ${sqlNullableString(validTodo.parentTodoId)},
  ${sqlString(validTodo.title)},
  ${sqlNullableString(validTodo.description)},
  ${sqlString(validTodo.status)},
  ${sqlString(validTodo.priority)},
  ${sqlNullableString(validTodo.reason)},
  ${sqlJson(validTodo.blockedBy)},
  ${sqlJson(validTodo.relatedRoleCallIds)},
  ${sqlString(validTodo.createdAt)},
  ${sqlString(validTodo.updatedAt)},
  ${sqlNullableString(validTodo.completedAt)}
);`;
}

function roleTodoUpdateSql(todo: RoleTodo): string {
  const validTodo = validateRoleTodo(todo);
  return `
UPDATE role_todos
SET
  thread_id = ${sqlString(validTodo.threadId)},
  role = ${sqlString(validTodo.role)},
  source_role_call_id = ${sqlNullableString(validTodo.sourceRoleCallId)},
  parent_todo_id = ${sqlNullableString(validTodo.parentTodoId)},
  title = ${sqlString(validTodo.title)},
  description = ${sqlNullableString(validTodo.description)},
  status = ${sqlString(validTodo.status)},
  priority = ${sqlString(validTodo.priority)},
  reason = ${sqlNullableString(validTodo.reason)},
  blocked_by_json = ${sqlJson(validTodo.blockedBy)},
  related_role_call_ids_json = ${sqlJson(validTodo.relatedRoleCallIds)},
  created_at = ${sqlString(validTodo.createdAt)},
  updated_at = ${sqlString(validTodo.updatedAt)},
  completed_at = ${sqlNullableString(validTodo.completedAt)}
WHERE id = ${sqlString(validTodo.id)};`;
}

function roleCallWhereClause(filter: RoleCallListFilter): string {
  const conditions: string[] = [];
  if (filter.threadId !== undefined) {
    conditions.push(`rc.thread_id = ${sqlString(filter.threadId)}`);
  }
  if (filter.role !== undefined) {
    conditions.push(
      `(rc.caller_role = ${sqlString(filter.role)} OR rc.callee_role = ${sqlString(filter.role)})`
    );
  }
  if (filter.callerRole !== undefined) {
    conditions.push(`rc.caller_role = ${sqlString(filter.callerRole)}`);
  }
  if (filter.calleeRole !== undefined) {
    conditions.push(`rc.callee_role = ${sqlString(filter.calleeRole)}`);
  }
  if (filter.parentRoleCallId !== undefined) {
    conditions.push(`rc.parent_role_call_id = ${sqlString(filter.parentRoleCallId)}`);
  }
  if (filter.status !== undefined) {
    conditions.push(`rc.status = ${sqlString(filter.status)}`);
  }
  if (filter.todoStatus !== undefined) {
    conditions.push(`rt.status = ${sqlString(filter.todoStatus)}`);
  }
  return conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
}

function roleTodoWhereClause(filter: RoleTodoListFilter): string {
  const conditions: string[] = [];
  if (filter.threadId !== undefined) {
    conditions.push(`thread_id = ${sqlString(filter.threadId)}`);
  }
  if (filter.role !== undefined) {
    conditions.push(`role = ${sqlString(filter.role)}`);
  }
  if (filter.sourceRoleCallId !== undefined) {
    conditions.push(`source_role_call_id = ${sqlString(filter.sourceRoleCallId)}`);
  }
  if (filter.status !== undefined) {
    conditions.push(`status = ${sqlString(filter.status)}`);
  }
  return conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
}

function cloneRunEvent(event: RunEvent): RunEvent {
  return {
    ...event,
    metadata: cloneJsonObject(event.metadata)
  };
}

function cloneRunArtifact(artifact: RunArtifact): RunArtifact {
  return {
    ...artifact,
    metadata: cloneJsonObject(artifact.metadata)
  };
}

function cloneContextEvalEvent(event: ContextEvalEvent): ContextEvalEvent {
  return {
    ...event,
    selectedItemIds: [...event.selectedItemIds],
    omittedItemIds: [...event.omittedItemIds],
    metadata: cloneJsonObject(event.metadata)
  };
}

function cloneConversationThread(thread: ConversationThread): ConversationThread {
  return {
    ...thread,
    metadata: thread.metadata ? cloneJsonObject(thread.metadata) : undefined
  };
}

function cloneConversationMessage(
  message: ConversationMessage
): ConversationMessage {
  return {
    ...message,
    metadata: message.metadata ? cloneJsonObject(message.metadata) : undefined
  };
}

function cloneConversationThreadSummary(
  summary: ConversationThreadSummary
): ConversationThreadSummary {
  return {
    ...summary,
    decisions: [...summary.decisions],
    openItems: [...summary.openItems],
    constraints: [...summary.constraints],
    metadata: summary.metadata ? cloneJsonObject(summary.metadata) : undefined
  };
}

function cloneRiskReport(report: RiskReport): RiskReport {
  return {
    ...report,
    changedFiles: [...report.changedFiles],
    failedChecks: [...report.failedChecks],
    riskFactors: [...report.riskFactors],
    manualReviewChecklist: [...report.manualReviewChecklist],
    findings: report.findings.map((finding) => ({ ...finding }))
  };
}

function cloneSetting(setting: Setting): Setting {
  return {
    ...setting,
    value: cloneJsonValue(setting.value)
  };
}

function cloneRoleCall(call: RoleCall): RoleCall {
  return cloneJsonValue(call) as RoleCall;
}

function cloneRoleCallEvent(event: RoleCallEvent): RoleCallEvent {
  return cloneJsonValue(event) as RoleCallEvent;
}

function cloneRoleTodo(todo: RoleTodo): RoleTodo {
  return cloneJsonValue(todo) as RoleTodo;
}

function cloneJsonObject<T extends Record<string, unknown>>(value: T): T {
  return cloneJsonValue(value) as T;
}

function cloneJsonValue(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

const stableProjectContextFiles = [
  "context/project.md",
  "context/architecture.md",
  "context/conventions.md",
  "context/testing.md",
  "context/security.md"
] as const;

async function readSkillIndexEntries(input: {
  projectId: string;
  storeRoot: string;
  sourceKind: "project_skill" | "global_skill";
  indexedAt: string;
  skipped: Array<{ sourcePath?: string; reason: string }>;
}): Promise<ContextIndexEntry[]> {
  const skillsRoot = path.join(input.storeRoot, "skills");
  let entries: Array<import("node:fs").Dirent>;
  try {
    entries = await fs.readdir(skillsRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const skillEntries: ContextIndexEntry[] = [];
  for (const entry of entries
    .filter((candidate) => candidate.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const sourcePath = path.join(skillsRoot, entry.name, "SKILL.md");
    const secretReason = secretLikePathReason(sourcePath);
    if (secretReason) {
      input.skipped.push({ sourcePath, reason: secretReason });
      continue;
    }
    const content = await readTextIfExists(sourcePath);
    if (content === undefined || content.trim().length === 0) {
      input.skipped.push({
        sourcePath,
        reason: "skill file is missing or empty"
      });
      continue;
    }
    const metadata = parseSkillMetadata(content);
    const name = metadata.name?.trim();
    const description = metadata.description?.trim();
    if (!name || !description) {
      input.skipped.push({
        sourcePath,
        reason: "skill metadata must include name and description"
      });
      continue;
    }
    const scope = input.sourceKind === "global_skill" ? "global" : "project";
    const sourceId = `${scope}:${entry.name}`;
    skillEntries.push(contextIndexEntry({
      projectId: input.projectId,
      sourceKind: input.sourceKind,
      sourceId,
      layer: input.sourceKind === "global_skill" ? "global" : "skill",
      scope,
      trustLevel: "medium",
      lifetime: "static",
      title: `${scope === "global" ? "Global Skill" : "Project Skill"}: ${name}`,
      content,
      sourcePath,
      indexedAt: input.indexedAt,
      metadata: {
        skillId: entry.name,
        skillName: name,
        skillDescription: description,
        scope
      }
    }));
  }
  return skillEntries;
}

function contextIndexEntry(input: {
  projectId: string;
  sourceKind: ContextIndexEntry["sourceKind"];
  sourceId: string;
  layer: ContextIndexEntry["layer"];
  scope: ContextIndexEntry["scope"];
  trustLevel: ContextIndexEntry["trustLevel"];
  lifetime: ContextIndexEntry["lifetime"];
  title: string;
  content: string;
  sourcePath: string;
  indexedAt: string;
  metadata: Record<string, unknown>;
}): ContextIndexEntry {
  return validateContextIndexEntry({
    id: stableContextIndexId(input.projectId, input.sourceKind, input.sourceId),
    projectId: input.projectId,
    layer: input.layer,
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    scope: input.scope,
    trustLevel: input.trustLevel,
    lifetime: input.lifetime,
    title: input.title,
    content: input.content,
    contentHash: sha256(input.content),
    sourcePath: input.sourcePath,
    createdAt: input.indexedAt,
    updatedAt: input.indexedAt,
    indexedAt: input.indexedAt,
    metadata: input.metadata
  });
}

function stableContextIndexId(
  projectId: string,
  sourceKind: ContextIndexEntry["sourceKind"],
  sourceId: string
): string {
  return `context_index:${projectId}:${sourceKind}:${sourceId}`;
}

async function readTextIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function approvedMemoryContent(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (normalized === "# Approved Memory") {
    return "";
  }
  return normalized.replace(/^# Approved Memory[ \t]*\n+/, "").trim();
}

function isPlaceholderContextFile(relativePath: string, content: string): boolean {
  return content.trim() === `# ${relativePath.replace(/\.md$/, "")}`;
}

function contextTitle(relativePath: string): string {
  const label = relativePath
    .replace(/^context\//, "")
    .replace(/\.md$/, "")
    .replace(/[-_]/g, " ");
  return `Project Context: ${label}`;
}

function parseSkillMetadata(content: string): Partial<Record<"name" | "description", string>> {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) {
    return {};
  }
  const endIndex = trimmed.indexOf("\n---", 3);
  if (endIndex === -1) {
    return {};
  }
  const metadataBlock = trimmed.slice(3, endIndex).trim();
  const metadata: Partial<Record<"name" | "description", string>> = {};
  for (const line of metadataBlock.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    if (key !== "name" && key !== "description") {
      continue;
    }
    metadata[key] = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return metadata;
}

function secretLikePathReason(value: string): string | undefined {
  const normalized = value.split(path.sep).join("/").toLowerCase();
  const segments = normalized.split("/");
  for (const segment of segments) {
    if (
      segment === ".env" ||
      segment.startsWith(".env.") ||
      segment === "id_rsa" ||
      segment === "id_ed25519" ||
      segment.endsWith(".pem") ||
      segment.endsWith(".key") ||
      segment.startsWith("secrets.") ||
      segment.startsWith("credentials.") ||
      segment.startsWith("token.")
    ) {
      return "secret-like source paths are rejected before context indexing";
    }
  }
  return undefined;
}

function normalizeContextIndexSearchTerms(value: string | string[]): string[] {
  const rawTerms = Array.isArray(value)
    ? value
    : value.split(/[^A-Za-z0-9_./-]+/);
  return [
    ...new Set(
      rawTerms
        .flatMap((term) => term.split(/[^A-Za-z0-9_]+/))
        .map((term) => term.trim().toLowerCase())
        .filter((term) => term.length >= 2)
    )
  ].slice(0, 32);
}

function ftsQueryForTerms(terms: string[]): string | undefined {
  const safeTerms = terms
    .map((term) => term.replace(/"/g, ""))
    .filter((term) => /^[a-z0-9_]+$/i.test(term));
  if (safeTerms.length === 0) {
    return undefined;
  }
  return safeTerms.map((term) => `"${term}"`).join(" OR ");
}

function sha256(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function upsertContextIndexEntrySql(entry: ContextIndexEntry): string {
  return `
INSERT INTO context_index_entries (
  id,
  project_id,
  layer,
  source_kind,
  source_id,
  scope,
  trust_level,
  lifetime,
  title,
  content,
  content_hash,
  source_path,
  metadata_json,
  created_at,
  updated_at,
  indexed_at
) VALUES (
  ${sqlString(entry.id)},
  ${sqlString(entry.projectId)},
  ${sqlString(entry.layer)},
  ${sqlString(entry.sourceKind)},
  ${sqlString(entry.sourceId)},
  ${sqlString(entry.scope)},
  ${sqlString(entry.trustLevel)},
  ${sqlString(entry.lifetime)},
  ${sqlString(entry.title)},
  ${sqlString(entry.content)},
  ${sqlString(entry.contentHash)},
  ${sqlNullableString(entry.sourcePath)},
  ${sqlJson(entry.metadata)},
  ${sqlString(entry.createdAt)},
  ${sqlNullableString(entry.updatedAt)},
  ${sqlString(entry.indexedAt)}
)
ON CONFLICT(id) DO UPDATE SET
  project_id = excluded.project_id,
  layer = excluded.layer,
  source_kind = excluded.source_kind,
  source_id = excluded.source_id,
  scope = excluded.scope,
  trust_level = excluded.trust_level,
  lifetime = excluded.lifetime,
  title = excluded.title,
  content = excluded.content,
  content_hash = excluded.content_hash,
  source_path = excluded.source_path,
  metadata_json = excluded.metadata_json,
  created_at = excluded.created_at,
  updated_at = excluded.updated_at,
  indexed_at = excluded.indexed_at;
`;
}

function insertContextIndexFtsSql(entry: ContextIndexEntry): string {
  return `
INSERT INTO context_text_fts (
  id,
  project_id,
  source_kind,
  title,
  content,
  source_path
) VALUES (
  ${sqlString(entry.id)},
  ${sqlString(entry.projectId)},
  ${sqlString(entry.sourceKind)},
  ${sqlString(entry.title)},
  ${sqlString(entry.content)},
  ${sqlNullableString(entry.sourcePath)}
);
  `;
}

function upsertCodeGraphEntrySql(entry: CodeGraphEntry): string {
  return `
INSERT INTO code_graph_entries (
  id,
  project_id,
  file_path,
  package_name,
  is_test,
  imports_json,
  exports_json,
  symbols_json,
  related_tests_json,
  content_hash,
  metadata_json,
  indexed_at
) VALUES (
  ${sqlString(entry.id)},
  ${sqlString(entry.projectId)},
  ${sqlString(entry.filePath)},
  ${sqlString(entry.packageName)},
  ${entry.isTest ? 1 : 0},
  ${sqlString(JSON.stringify(entry.imports))},
  ${sqlString(JSON.stringify(entry.exports))},
  ${sqlString(JSON.stringify(entry.symbols))},
  ${sqlString(JSON.stringify(entry.relatedTests))},
  ${sqlString(entry.contentHash)},
  ${sqlJson(entry.metadata)},
  ${sqlString(entry.indexedAt)}
)
ON CONFLICT(id) DO UPDATE SET
  project_id = excluded.project_id,
  file_path = excluded.file_path,
  package_name = excluded.package_name,
  is_test = excluded.is_test,
  imports_json = excluded.imports_json,
  exports_json = excluded.exports_json,
  symbols_json = excluded.symbols_json,
  related_tests_json = excluded.related_tests_json,
  content_hash = excluded.content_hash,
  metadata_json = excluded.metadata_json,
  indexed_at = excluded.indexed_at;
`;
}

function contextEvalEventSelectColumns(): string {
  return `
  id,
  project_id AS projectId,
  task_id AS taskId,
  run_id AS runId,
  plan_id AS planId,
  kind,
  severity,
  message,
  selected_item_ids_json AS selectedItemIdsJson,
  omitted_item_ids_json AS omittedItemIdsJson,
  metadata_json AS metadataJson,
  created_at AS createdAt
`;
}

function contextIndexEntryUnchanged(
  existing: ContextIndexEntry,
  incoming: ContextIndexEntry
): boolean {
  return (
    existing.projectId === incoming.projectId &&
    existing.layer === incoming.layer &&
    existing.sourceKind === incoming.sourceKind &&
    existing.sourceId === incoming.sourceId &&
    existing.scope === incoming.scope &&
    existing.trustLevel === incoming.trustLevel &&
    existing.lifetime === incoming.lifetime &&
    existing.title === incoming.title &&
    existing.contentHash === incoming.contentHash &&
    existing.sourcePath === incoming.sourcePath &&
    JSON.stringify(existing.metadata) === JSON.stringify(incoming.metadata)
  );
}

function codeGraphEntryUnchanged(
  existing: CodeGraphEntry,
  incoming: CodeGraphEntry
): boolean {
  return (
    existing.projectId === incoming.projectId &&
    existing.filePath === incoming.filePath &&
    existing.packageName === incoming.packageName &&
    existing.isTest === incoming.isTest &&
    existing.contentHash === incoming.contentHash &&
    arraysEqual(existing.imports, incoming.imports) &&
    arraysEqual(existing.exports, incoming.exports) &&
    arraysEqual(existing.symbols, incoming.symbols) &&
    arraysEqual(existing.relatedTests, incoming.relatedTests) &&
    JSON.stringify(existing.metadata) === JSON.stringify(incoming.metadata)
  );
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function parseJson<T>(value: string | null): T | undefined {
  return value === null ? undefined : JSON.parse(value) as T;
}

function nullToUndefined<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function hasAppliedMigrationRange(
  appliedVersions: Set<number>,
  startVersion: number,
  endVersion: number
): boolean {
  for (let version = startVersion; version <= endVersion; version += 1) {
    if (!appliedVersions.has(version)) {
      return false;
    }
  }
  return true;
}

function sqlNullableString(value: string | undefined): string {
  return value === undefined ? "NULL" : sqlString(value);
}

function sqlNullableInteger(value: number | undefined): string {
  return value === undefined ? "NULL" : String(value);
}

function sqlJson(value: unknown | undefined): string {
  return value === undefined ? "NULL" : sqlString(JSON.stringify(value));
}

function isTerminalRoleCallStatus(status: RoleCallStatus): boolean {
  return (
    status === "succeeded" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "rejected"
  );
}

function isTerminalRoleTodoStatus(status: RoleTodoStatus): boolean {
  return status === "done" || status === "cancelled" || status === "rejected";
}

class NativeSqliteDriver {
  private connection: NativeSqliteConnection | undefined;

  constructor(private readonly databasePath: string) {}

  execute(sql: string, parameters?: SqliteParameters): void {
    const connection = this.ensureConnection();
    if (parameters === undefined) {
      connection.exec(sql.trim());
      return;
    }
    connection.prepare(singleStatementSql(sql)).run(normalizeSqliteParameters(parameters));
  }

  query<T extends Record<string, unknown>>(
    sql: string,
    parameters?: SqliteParameters
  ): T[] {
    const statement = this.ensureConnection().prepare(singleStatementSql(sql));
    const rows = parameters === undefined
      ? statement.all()
      : statement.all(normalizeSqliteParameters(parameters));
    return rows as T[];
  }

  async close(): Promise<void> {
    this.connection?.close();
    this.connection = undefined;
  }

  private ensureConnection(): NativeSqliteConnection {
    this.connection ??= this.openConnection();
    return this.connection;
  }

  private openConnection(): NativeSqliteConnection {
    const connection = new BetterSqlite3(this.databasePath, { timeout: 5000 });
    connection.pragma("busy_timeout = 5000");
    connection.pragma("foreign_keys = ON");
    return connection;
  }
}

function singleStatementSql(sql: string): string {
  return sql.trim().replace(/;\s*$/, "");
}

function normalizeSqliteParameters(parameters: SqliteParameters): SqliteParameters {
  if (Array.isArray(parameters)) {
    return parameters.map(normalizeSqliteParameter);
  }

  return Object.fromEntries(
    Object.entries(parameters).map(([key, value]) => [
      key,
      normalizeSqliteParameter(value)
    ])
  );
}

function normalizeSqliteParameter(value: SqliteParameterValue): SqlitePrimitive {
  if (value === undefined) {
    return null;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  return value;
}
