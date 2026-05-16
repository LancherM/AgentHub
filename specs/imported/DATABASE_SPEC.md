# Database Specification

## Storage

Use SQLite for local persistence.

The database stores structured metadata only. Do not store secrets, API keys, tokens, private keys, or credential file contents.

Assumption: large artifacts can be stored in SQLite for the MVP if simple, but the schema should allow migration to file-backed artifacts later.

## Tables

All table and field names below are generic.

## projects

Purpose: registered local repositories.

Fields:

- `id`: text primary key
- `name`: text, required
- `root_path`: text, required, unique
- `created_at`: text timestamp
- `updated_at`: text timestamp

Indexes:

- unique index on `root_path`

Relationships:

- one project has many tasks
- one project has many memory items
- one project may have many project-scoped skills

## agent_profiles

Purpose: configured agent entries.

Fields:

- `id`: text primary key
- `kind`: text, required
- `display_name`: text, required
- `command`: nullable text
- `enabled`: integer boolean
- `created_at`: text timestamp
- `updated_at`: text timestamp

Indexes:

- optional index on `kind`
- optional index on `enabled`

Constraints:

- `kind` must be a supported agent kind
- `enabled` must be boolean-like

## tasks

Purpose: user task records.

Fields:

- `id`: text primary key
- `project_id`: text, required
- `title`: text, required
- `description`: nullable text
- `status`: text, required
- `created_at`: text timestamp
- `updated_at`: text timestamp

Indexes:

- index on `project_id`
- optional composite index on `project_id, status`

Relationships:

- belongs to project
- has many task runs
- has many comparison reports
- may have many memory items

## task_runs

Purpose: one agent execution attempt for a task.

Fields:

- `id`: text primary key
- `task_id`: text, required
- `agent_profile_id`: nullable text
- `agent_kind`: text, required
- `status`: text, required
- `worktree_path`: nullable text
- `branch_name`: nullable text
- `started_at`: nullable text timestamp
- `completed_at`: nullable text timestamp
- `created_at`: text timestamp
- `updated_at`: text timestamp

Indexes:

- index on `task_id`
- optional composite index on `task_id, agent_kind`
- optional index on `status`

Relationships:

- belongs to task
- optionally references an agent profile
- has many run events
- has many run artifacts
- has many verification results
- has many risk reports

## run_events

Purpose: ordered event stream for a task run.

Fields:

- `id`: text primary key
- `task_run_id`: text, required
- `sequence`: integer, required
- `type`: text, required
- `message`: text, required
- `metadata_json`: text, required
- `created_at`: text timestamp

Indexes:

- composite unique index on `task_run_id, sequence`
- index on `task_run_id, sequence`

Relationships:

- belongs to task run

Constraints:

- metadata must be valid JSON
- sequence must be non-negative

## run_artifacts

Purpose: persisted outputs associated with a run.

Fields:

- `id`: text primary key
- `task_run_id`: text, required
- `kind`: text, required
- `content`: text, required
- `metadata_json`: text, required
- `created_at`: text timestamp

Indexes:

- index on `task_run_id, created_at`
- optional index on `kind`

Relationships:

- belongs to task run

Common artifact kinds:

- git diff
- future log bundle
- future risk source bundle

## verification_results

Purpose: result of a verification command.

Fields:

- `id`: text primary key
- `task_run_id`: text, required
- `command`: text, required
- `status`: text, required
- `exit_code`: nullable integer
- `stdout`: nullable text
- `stderr`: nullable text
- `started_at`: nullable text timestamp
- `completed_at`: nullable text timestamp
- `created_at`: text timestamp

Indexes:

- index on `task_run_id`
- optional composite index on `task_run_id, status`

Relationships:

- belongs to task run

## comparison_reports

Purpose: persisted comparison between task runs.

Fields:

- `id`: text primary key
- `task_id`: text, required
- `baseline_run_id`: nullable text
- `candidate_run_id`: nullable text
- `summary`: text, required
- `created_at`: text timestamp

Indexes:

- index on `task_id`

Relationships:

- belongs to task
- optionally references baseline and candidate runs

## memory_items

Purpose: proposed, approved, and rejected memory.

Fields:

- `id`: text primary key
- `project_id`: text, required
- `task_id`: nullable text
- `category`: text, required
- `status`: text, required
- `content`: text, required
- `created_at`: text timestamp
- `updated_at`: text timestamp

Indexes:

- index on `project_id`
- index on `status`
- optional composite index on `project_id, status`

Relationships:

- belongs to project
- optionally belongs to task

Constraints:

- approved memory can be included in future context packs
- proposed and rejected memory must not be injected as approved memory

## risk_reports

Purpose: safety assessment for a task run.

Fields:

- `id`: text primary key
- `task_run_id`: text, required
- `level`: text, required
- `summary`: text, required
- `findings_json`: text, required
- `created_at`: text timestamp

Indexes:

- index on `task_run_id`
- optional index on `level`

Relationships:

- belongs to task run

Constraints:

- findings must be valid JSON array
- level must be a supported risk level

## skills

Purpose: known reusable workflow instructions.

Fields:

- `id`: text primary key
- `project_id`: nullable text
- `name`: text, required
- `description`: text, required
- `path`: text, required
- `created_at`: text timestamp
- `updated_at`: text timestamp

Indexes:

- index on `project_id`
- optional composite unique index on `project_id, name`

Relationships:

- optionally belongs to project

## settings

Purpose: local key-value settings.

Fields:

- `key`: text primary key
- `value_json`: text, required
- `updated_at`: text timestamp

Constraints:

- value must be valid JSON
- secrets must not be stored here

## Migration Notes

Use incremental migrations with clear versioning. The initial migration should create all MVP tables, indexes, foreign keys, and enum-like checks.

Recommended migration principles:

- enable foreign keys
- use explicit transactions
- keep migrations deterministic
- never drop user data without a backup path
- add nullable fields first, then backfill, then tighten constraints
- preserve compatibility with existing local databases when possible

Future migrations likely needed:

- artifact storage metadata for file-backed large artifacts
- comparison report details beyond summary text
- memory proposal source references
- safety scanner finding categories
- desktop UI preferences
