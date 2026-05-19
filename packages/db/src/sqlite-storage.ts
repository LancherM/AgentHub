import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  validateAgentProfile,
  validateComparisonReport,
  validateConversationMessage,
  validateConversationThread,
  validateMemoryItem,
  validateProject,
  validateRiskReport,
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
  type ComparisonReport,
  type ConversationMessage,
  type ConversationThread,
  type MemoryItem,
  type Project,
  type RiskReport,
  type RiskLevel,
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
  type ConversationThreadRepository,
  type MemoryItemRepository,
  type ProjectRepository,
  type RiskReportRepository,
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
  memoryItemRepository: MemoryItemRepository;
  comparisonReportRepository: ComparisonReportRepository;
  skillRepository: SkillRepository;
  settingsRepository: SettingsRepository;
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
  findings_json TEXT NOT NULL CHECK (json_valid(findings_json)),
  changed_files_json TEXT NOT NULL CHECK (json_valid(changed_files_json)),
  verification_summary TEXT NOT NULL,
  failed_checks_json TEXT NOT NULL CHECK (json_valid(failed_checks_json)),
  risk_factors_json TEXT NOT NULL CHECK (json_valid(risk_factors_json)),
  manual_review_checklist_json TEXT NOT NULL CHECK (json_valid(manual_review_checklist_json)),
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
    memoryItemRepository: new SQLiteMemoryItemRepository(database),
    comparisonReportRepository: new SQLiteComparisonReportRepository(database),
    skillRepository: new SQLiteSkillRepository(database),
    settingsRepository: new SQLiteSettingsRepository(database)
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

  constructor(readonly databasePath: string) {}

  async open(): Promise<void> {
    await this.ensureInitialized();
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  async execute(sql: string): Promise<void> {
    await this.ensureInitialized();
    await runSqliteScript(this.databasePath, sqlScript(sql));
  }

  async query<T extends Record<string, unknown>>(sql: string): Promise<T[]> {
    await this.ensureInitialized();
    const output = await runSqliteScript(
      this.databasePath,
      sqlScript([".mode json", sql].join("\n"))
    );
    const trimmed = output.trim();
    if (trimmed.length === 0) {
      return [];
    }
    return JSON.parse(trimmed) as T[];
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
    await runSqliteScript(
      this.databasePath,
      sqlScript(`
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
`)
    );

    const rows = await this.queryWithoutInitialization<{ version: number }>(
      "SELECT version FROM schema_migrations ORDER BY version ASC;"
    );
    const appliedVersions = new Set(rows.map((row) => row.version));
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
      await runSqliteScript(this.databasePath, sqlScript(migrationSql));
    }
  }

  private async queryWithoutInitialization<T extends Record<string, unknown>>(
    sql: string
  ): Promise<T[]> {
    const output = await runSqliteScript(
      this.databasePath,
      sqlScript([".mode json", sql].join("\n"))
    );
    const trimmed = output.trim();
    return trimmed.length === 0 ? [] : JSON.parse(trimmed) as T[];
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
  id, project_id, title, description, status, created_at, updated_at
) VALUES (
  ${sqlString(validTask.id)},
  ${sqlString(validTask.projectId)},
  ${sqlString(validTask.title)},
  ${sqlNullableString(validTask.description)},
  ${sqlString(validTask.status)},
  ${sqlString(validTask.createdAt)},
  ${sqlString(validTask.updatedAt)}
)
ON CONFLICT(id) DO UPDATE SET
  project_id = excluded.project_id,
  title = excluded.title,
  description = excluded.description,
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
  updated_at
) VALUES (
  ${sqlString(updated.runId)},
  ${sqlJson(updated.workspace)},
  ${sqlJson(updated.workspaceCleanup)},
  ${sqlJson(updated.diff)},
  ${sqlJson(updated.verification)},
  ${sqlJson(updated.riskReport)},
  ${sqlString(new Date().toISOString())}
)
ON CONFLICT(run_id) DO UPDATE SET
  workspace_json = excluded.workspace_json,
  workspace_cleanup_json = excluded.workspace_cleanup_json,
  diff_json = excluded.diff_json,
  verification_json = excluded.verification_json,
  risk_report_json = excluded.risk_report_json,
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
  risk_report_json AS riskReportJson
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
  id, task_id, baseline_run_id, candidate_run_id, summary, created_at
) VALUES (
  ${sqlString(validReport.id)},
  ${sqlString(validReport.taskId)},
  ${sqlNullableString(validReport.baselineRunId)},
  ${sqlNullableString(validReport.candidateRunId)},
  ${sqlString(validReport.summary)},
  ${sqlString(validReport.createdAt)}
)
ON CONFLICT(id) DO UPDATE SET
  task_id = excluded.task_id,
  baseline_run_id = excluded.baseline_run_id,
  candidate_run_id = excluded.candidate_run_id,
  summary = excluded.summary,
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
  created_at AS createdAt
FROM comparison_reports
WHERE task_id = ${sqlString(taskId)}
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

interface SettingRow extends Record<string, unknown> {
  key: string;
  valueJson: string;
  updatedAt: string;
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
    riskReport: parseJson(row.riskReportJson)
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

function settingFromRow(row: SettingRow): Setting {
  return validateSetting({
    key: row.key,
    value: parseJson(row.valueJson),
    updatedAt: row.updatedAt
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

function cloneJsonObject<T extends Record<string, unknown>>(value: T): T {
  return cloneJsonValue(value) as T;
}

function cloneJsonValue(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function parseJson<T>(value: string | null): T | undefined {
  return value === null ? undefined : JSON.parse(value) as T;
}

function nullToUndefined<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

function sqlScript(sql: string): string {
  return [
    ".bail on",
    ".timeout 5000",
    "PRAGMA foreign_keys = ON;",
    sql.trim(),
    ""
  ].join("\n");
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
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

async function runSqliteScript(databasePath: string, script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("sqlite3", [databasePath], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });
    child.on("error", (error) => {
      reject(
        new Error(
          `sqlite3 execution failed. Ensure the sqlite3 CLI is installed: ${error.message}`
        )
      );
    });
    child.on("close", (code) => {
      const stdoutText = Buffer.concat(stdout).toString("utf8");
      const stderrText = Buffer.concat(stderr).toString("utf8");
      if (code === 0) {
        resolve(stdoutText);
        return;
      }
      reject(
        new Error(
          `sqlite3 exited with code ${code}: ${stderrText.trim() || stdoutText.trim()}`
        )
      );
    });
    child.stdin.end(script);
  });
}
