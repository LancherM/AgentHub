import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  validateTask,
  validateTaskRun,
  type Task,
  type TaskRun,
  type TaskRunStatus,
  type TaskStatus
} from "./domain";
import {
  cloneRunMetadata,
  type RunMetadata,
  type RunMetadataRepository,
  type RunStatusTransition,
  type TaskRepository,
  type TaskRunRepository
} from "./storage";

export interface SqliteStorageOptions {
  databasePath?: string;
}

export interface SqliteRepositories {
  database: SqliteDatabase;
  taskRepository: TaskRepository;
  taskRunRepository: TaskRunRepository;
  runMetadataRepository: RunMetadataRepository;
}

export const SQLITE_MIGRATIONS: Array<{ version: number; sql: string }> = [
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
    taskRepository: new SQLiteTaskRepository(database),
    taskRunRepository: new SQLiteTaskRunRepository(database),
    runMetadataRepository: new SQLiteRunMetadataRepository(database)
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

  constructor(readonly databasePath: string) {}

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
      await runSqliteScript(
        this.databasePath,
        sqlScript(`
BEGIN;
${migration.sql}
INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES (${migration.version}, ${sqlString(new Date().toISOString())});
COMMIT;
`)
      );
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

export class SQLiteTaskRepository implements TaskRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async create(task: Task): Promise<Task> {
    const validTask = validateTask(task);
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
}

export class SQLiteTaskRunRepository implements TaskRunRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async create(run: TaskRun): Promise<TaskRun> {
    const validRun = validateTaskRun(run);
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
    await this.database.execute(`
BEGIN;
UPDATE task_runs
SET
  status = ${sqlString(status)},
  updated_at = ${sqlString(updatedAt)},
  completed_at = CASE
    WHEN ${sqlString(status)} IN ('succeeded', 'failed', 'cancelled')
      THEN ${sqlString(updatedAt)}
    ELSE completed_at
  END
WHERE id = ${sqlString(runId)};
INSERT INTO status_transitions (run_id, status, at)
SELECT ${sqlString(runId)}, ${sqlString(status)}, ${sqlString(updatedAt)}
WHERE EXISTS (SELECT 1 FROM task_runs WHERE id = ${sqlString(runId)});
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
