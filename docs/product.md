# Product

Agent Hub is a local-first CLI-first developer tool for orchestrating coding
agents on a developer machine.

The current verified rebuild slice supports registered projects, registered
tasks, Agent Hub-owned context stores, context artifact build/export,
deterministic fake-agent runs, process-backed Codex and Claude Code runs, and
cross-process SQLite-backed run inspection, manual run-event recording, memory
workflows, and comparison reports. Running `agent-hub` with no subcommand
starts an interactive shell over the same local core services:

The implementation now uses the imported workspace shape for the CLI, local
core packages, and first desktop shell. `apps/cli` contains CLI parsing,
interactive mode, command dispatch, and output rendering. `apps/desktop`
contains the Electron + React shell over the same local persistence/review
interfaces. Shared contracts and local services live under `packages/shared`,
`packages/core`, `packages/db`, `packages/context-compiler`,
`packages/task-runner`, `packages/agent-adapters`, and `packages/safety`.
The desktop app is not a hosted web app and does not add an API server, login,
cloud sync, remote execution, automatic merge, automatic push, or repository
export behavior.

```sh
agent-hub [--project <path>] [--agent fake|codex|claude-code]
agent-hub [--debug] run ...
agent-hub [--db <path>] project add --name <name> --root <path>
agent-hub [--db <path>] project list
agent-hub [--db <path>] task create --project-id <project-id> --title <title> [--description <text>]
agent-hub [--db <path>] task list [--project-id <project-id>]
agent-hub [--db <path>] task history --task-id <task-id>
agent-hub context init --project-root <path> --project-id <project-id>
agent-hub context show --project-root <path> --project-id <project-id>
agent-hub context build --project-root <path> --project-id <project-id> --task-id <task-id> --title <title> --prompt <prompt>
agent-hub context export --project-root <path> --project-id <project-id> --dry-run|--write
agent-hub [--db <path>] run --task <task-id> --agent fake|codex|claude-code
agent-hub run [--repo <path>] [--workspace-base <path>] [--retain-on-failure] "@fake|@codex|@claude-code <task>"
agent-hub [--db <path>] run event add --run-id <run-id> --type <type> --message <message>
agent-hub tasks list
agent-hub runs list
agent-hub runs events <run-id>
agent-hub runs diff <run-id> [--stat|--patch] [--full]
agent-hub runs show <run-id>
agent-hub risks show <run-id>
agent-hub [--db <path>] memory list --project-id <project-id>
agent-hub [--db <path>] memory propose --project-id <project-id> --category <category> --content <text>
agent-hub [--db <path>] memory approve --memory-id <memory-id>
agent-hub [--db <path>] memory reject --memory-id <memory-id>
agent-hub [--db <path>] compare --task-id <task-id> --baseline <run-id> --candidate <run-id>
```

Interactive mode accepts natural language prompts plus `@fake`, `@codex`, and
`@claude-code` prompt prefixes. It supports `/help`, `/agents`, `/use`,
`/context`, `/context init`, `/clear`, `/exit`, and `/quit`. Interactive task
execution calls the same task runner and repositories as command mode, so it
does not duplicate orchestration logic or create a separate execution path.

The context commands initialize and inspect a project context store, build a
task-specific context pack and task brief, and explicitly export managed
repository context only when requested. External context stores are the default
and live under Agent Hub application data rather than the user repository.
Missing optional context files are surfaced as build/export warnings.
Supported store files are:

- `context/project.md`
- `context/architecture.md`
- `context/conventions.md`
- `context/testing.md`
- `context/security.md`
- `memory/approved.md`
- `skills/<skill-name>/SKILL.md`

Skill files must include YAML-style frontmatter with `name` and `description`.
Malformed or empty skills are skipped and surfaced as build/export warnings
instead of being silently injected as generic text.

`context export --dry-run` previews repository writes. `context export --write`
uses Agent Hub managed blocks in `AGENTS.md` and optionally `CLAUDE.md`,
preserves user-authored content outside those blocks, and ignores marker
examples inside fenced code blocks. Runtime context files are generated in
Agent Hub-owned artifacts or inside isolated worktrees; default context build
does not write repository-level agent files. `context build --delivery-mode`
accepts only `runtime_injection` and `worktree_overlay`; `repo_export` remains
exclusive to `context export`.

The run command validates the task input, compiles non-invasive context, routes
to the selected adapter, rejects unsafe repository-local Git config before any
worktree checkout, creates an isolated git worktree outside the original
project checkout, materializes runtime task brief/context-pack files inside
that workspace, runs the adapter with the context payload, collects git diff
metadata, runs explicitly configured verification commands, generates a
structured risk report from safety scanner findings, captures events, applies
the workspace cleanup policy, and prints a concise summary. The pre-flight Git
config check covers worktree-local config files, inline section comments, and
dotted filter or diff driver names that could otherwise enable executable Git
helpers during checkout.
`runtime_injection` remains the default delivery mode. Codex and Claude Code
receive the task brief/context through stdin-driven runtime injection and do
not require repository-level `AGENTS.md` or `CLAUDE.md`. `worktree_overlay` is
opt-in and writes generated `AGENTS.md`, `CLAUDE.md`, and skill copies only
inside the isolated worktree, never the original checkout. Task runs accept
only `runtime_injection` and `worktree_overlay`; `repo_export` remains an
explicit `context export` action and is rejected as a run delivery mode.

Task runs are inspectable even when later execution stages fail. After a run
row exists, failures in diff collection, verification execution, risk report
generation, artifact persistence, metadata persistence, or workspace cleanup
are converted into diagnostic run events and warnings. The task run is
finalized as `failed`, the task is returned to `open`, partial structured
outputs are returned when available, and workspace cleanup is still attempted
according to the selected cleanup policy. Dangerous verification commands are
reported as failed verification results instead of bypassing finalization;
verification commands receive a 10-minute default timeout unless an explicit
command timeout is configured, and timeout or process signal details are
preserved in the command result.
Runs without configured verification commands still record skipped verification
and include a run warning so the missing validation is visible in run metadata
and debug output without opening the risk report.
Task brief artifacts are persisted from Agent Hub's generated brief content,
not by rereading worktree paths after materialization, so malicious symlinks in
an untrusted worktree cannot be captured as task brief artifact contents.

Normal run output is optimized for CLI use and shows the agent-facing output
only. Agent Hub extracts fake-agent output, structured message/error events,
or raw non-JSON stdout/stderr fallbacks instead of printing run metadata or
adapter lifecycle events after every task. Structured lifecycle summaries and
non-assistant message items remain persisted status events rather than normal
agent output. Interactive mode follows the same rule and does not echo
`run: <prompt>` in normal mode.

Manual event recording is available for persisted task runs:
`run event add --run-id ... --type ... --message ...`. The command validates
the run exists, validates the event type, appends through the
`RunEventRepository`, and assigns the next sequence number after existing
events for that run.

Persisted run review is explicit and read-only. `runs events <run-id>` prints
the ordered adapter/manual event stream stored in `run_events` across CLI
processes. `runs diff <run-id> --stat` prints stored changed-file and diff-stat
metadata, while `runs diff <run-id> --patch` prints the stored git diff artifact
with default truncation and an explicit `--full` flag for complete local output.
These commands inspect SQLite-backed evidence only; they do not rerun agents,
modify worktrees, accept output, merge branches, or push code.

`--debug` is opt-in and does not change run behavior. For supported run
commands it appends the detailed run summary, selected `context_delivery` mode,
`branch_name`, run boundary details, context artifact paths, verification
stdout/stderr, changed-file summaries, warnings, and a truncated diff preview
to the normal agent output. `AGENT_HUB_DEBUG=1` or `AGENT_HUB_DEBUG=true`
enables the same debug rendering for local troubleshooting.

The process-backed adapters use direct executable-plus-args spawning:

- Codex runs `codex exec --json -` in the isolated worktree.
- Claude Code runs `claude --print --output-format stream-json` in the isolated
  worktree.
- Before launching Codex or Claude Code for a run, Agent Hub first validates
  the isolated worktree and runtime task brief boundary, then runs adapter
  detection from that worktree with the run environment. Missing CLI,
  authentication, or setup failures become failed run events and no real
  adapter process is started.
- Child processes receive only Agent Hub's explicit environment overrides plus
  a small inherited allowlist for path lookup, home/config/cache paths, temp
  directories, locale/terminal flags, CI, and required Windows process
  variables.
- stdout and stderr are captured as run events; structured JSONL output is
  parsed into message/status/error events when possible, while raw output is
  preserved.
- non-zero process exits and signal exits make the run fail, but the task run,
  events, artifacts, verification rows, and risk report remain inspectable.
- unsafe permission-bypass flags are not used.

The list/show/history commands read from local SQLite storage by default, so
projects, tasks, runs, run details, and risk reports remain visible across CLI
processes. Ad hoc fake runs remain supported for the older vertical slice.

Risk reports are backed by a standalone safety scanner. It checks sensitive
paths, dangerous commands in generated diffs or configured verification
commands, dangerous generated instructions in captured adapter run events,
risky diff shape, large deletion volume, and binary file changes. The dangerous
command rules are shared with verification command rejection and cover direct
and common shell-wrapped variants of `sudo`, `rm -rf /`, `chmod -R 777`,
`curl | sh`, `wget | sh`, `git push --force`, and `git clean -fdx`. Blocking
findings remain `blocking` in the aggregated risk level and are surfaced in
`risks show`; they are not downgraded to high. Agent Hub still does not
automatically accept, merge, or push any run output. Debug run output redacts
the raw diff preview when a blocking sensitive-path finding exists, or when
changed-file metadata identifies a sensitive path before a risk report is
available.

The memory workflow is explicit and user-approved. `memory propose` creates a
SQLite memory item in `proposed` state, `memory list` shows project memory
items, `memory approve` marks an item approved and appends it to the Agent
Hub-owned context store at `memory/approved.md`, and `memory reject` marks it
rejected. Context builds read approved memory only from the context store and
ignore the default `# Approved Memory` placeholder, so proposed, rejected, and
empty placeholder memory items are not injected into future task briefs.

The compare workflow generates a persisted comparison report for two runs of a
task. `compare --task-id ... --baseline ... --candidate ...` compares changed
files, diff stats, verification summaries, per-command verification outcomes,
failed checks, risk levels, risk factors, and summary tradeoffs from persisted
run artifacts and reports, then stores the summary in `comparison_reports`. It
is a review aid only; it does not accept, merge, or push changes.

Agent Hub Desktop is now available as a local conversation console under
`apps/desktop`. It starts with `pnpm --filter desktop dev` and presents a
thread-first shell: threads and projects on the left, a conversation timeline
in the center, and a bottom composer as the primary interaction surface. When
there are no registered projects, the desktop renders local project path
registration controls in the project sidebar and the empty conversation pane;
submitting either control calls the existing `window.agentHub.projects.open`
IPC path and seeds a new conversation for the registered project.

The composer accepts mention-based prompts such as `@fake ...` or multi-agent
mentions. The renderer sends prompt text through the safe
`window.agentHub.threads.sendMessage` preload API; the Electron main-process
thread service strips known agent mentions from the task body, records one
user message in the active thread, creates one run per selected agent through
`RunService`, and appends one inline run card message per run. If no agent is
mentioned or supplied by the caller, desktop falls back to `@fake`.

Each inline run card subscribes to the existing desktop run event stream and
shows agent identity, status, the latest streamed line, compact review pills,
and an expandable event log. Diff, tests, risk, memory proposals, summary, and
full logs are hidden by default and open through an on-demand run inspector
drawer. Existing persisted run records are synthesized into thread-shaped
conversations by the main-process thread service so old desktop run data
remains inspectable. Core conversation thread/message storage is now available
through local repositories and SQLite tables, but the current desktop thread
service still uses its isolated in-memory facade until the follow-up service
wiring phase lands. Run records, events, simulated verification, placeholder
diffs, and risk review rows remain SQLite-backed.

The planned real multi-turn conversation route is captured in
`docs/multiturn-conversation-prompts.md`. It keeps project context, thread
context, current-turn context, and per-run context snapshots as separate
layers, then replaces the current in-memory thread facade with persisted
threads/messages and bounded runtime injection of prior conversation context.
The first storage slice adds durable conversation tables only; until the desktop
service and context builder phases are implemented, desktop threads are a
conversation UI and run review surface, not a guarantee that each new agent run
sees the previous messages.

The run inspector is the desktop drill-down surface for review evidence. It
loads review summaries, changed-file stats, bounded unified diffs, captured
verification rows, persisted TaskRunner safety reports when present,
deterministic fallback risk findings, conservative memory proposals, and
bounded raw logs through `window.agentHub.review.*` and
`window.agentHub.memory.*` IPC methods. Blocking persisted safety reports keep
their `blocking` level and mapped evidence in the inspector so sensitive-path
or dangerous-instruction findings are not downgraded by the desktop fallback
risk classifier. Fake desktop runs explicitly show that no real repository
files were modified and do not invent changed files. When a retained worktree
exists, desktop diff loading uses read-only Git inspection from the Electron
main process only; renderer code never receives shell, filesystem, SQLite, or
Git access.

Inspector accept/reject actions are audit decisions only. Accepting a run
records `accepted` review state and shows "Accepted for record. No merge was
performed." Rejecting records `rejected` review state and shows "Rejected for
record. No files were deleted or reverted." Neither action merges, pushes,
resets, cleans, deletes worktrees, reverts files, writes repository context
files, or creates pull requests. Memory proposals remain pending until the
user approves or ignores them, and desktop approval updates Agent Hub local
storage only.

The selected run timeline receives live semantic events such as `run_started`,
`context_compiled`, `agent_step`, `agent_output`, `verification_started`,
`verification_finished`, `run_completed`, `run_failed`, and `run_cancelled`.
Sidebar and card status update through the desktop status sequence
`queued -> running -> verifying -> completed`, or to `failed`/`cancelled` for
terminal interruptions. Running fake runs can be cancelled from their inline
cards.

The renderer only calls the safe `window.agentHub` preload API. It has no
direct Node.js, shell, filesystem, SQLite, or git access; privileged
operations go through Electron main-process IPC registered in
`apps/desktop/electron/ipc.ts`. The IPC handler factory is kept in
`apps/desktop/electron/ipc-handlers.ts` so service-level validation and
subscription behavior remain testable in the root Vitest suite without loading
Electron.

The current desktop execution path is intentionally fake-agent backed for real
streaming work. The main process `RunService` creates SQLite task/run rows,
streams live events through an in-memory emitter, persists run events as the DB
layer supports them, records simulated verification output, and stores
placeholder diff/risk review rows that explicitly say no real files were
modified. The fake runner never writes files into the selected target
repository and does not export Agent Hub context files. Mentioned `@codex` and
`@claude` desktop runs currently create safe placeholder run records that fail
with an explicit "not wired yet" message instead of launching real adapters.
CodexAdapter, ClaudeCodeAdapter, real TaskRunner streaming/cancellation, real
verification command configuration, approved-memory context-store writeback,
multi-agent comparison review, worktree lifecycle management, and explicit
merge/apply workflows remain follow-up desktop wiring tasks.

SQLite is stored in Agent Hub-owned application data by default, not in the
target project repository. `AGENT_HUB_HOME` can point Agent Hub at an alternate
app data directory, and `AGENT_HUB_DB_PATH` can point at an explicit database
file for local testing or development. In-memory repositories remain available
for injected tests and focused runner verification.

Persisted run metadata currently covers:

- workspace path, branch, source repository, and worktree ownership details
- workspace cleanup result; workspaces are retained by default unless an
  explicit cleanup policy is selected
- collected diff metadata and summaries for staged, unstaged, and untracked
  changes
- verification suite result
- generated risk report

Diff collection records binary file metadata, synthesizes reviewable patches
for bounded untracked text files, and excludes generated overlay files only
while they still match their Agent Hub baseline. Untracked symlinks are recorded
as symlinks without dereferencing their targets, oversized untracked files have
their contents omitted, and synthetic untracked file reads are constrained to
real paths inside the isolated worktree. If an agent modifies generated overlay
files, those files are included in the diff. Git worktree and diff operations
apply hardened Git invocation defaults and reject repository-local Git config
keys that can execute helpers, hooks, filters, external diff commands, or
included config before Agent Hub invokes Git in the selected repository or
generated worktree.

Structured run data is now also persisted in first-class SQLite tables:

- adapter event streams in `run_events`
- manually recorded run events in `run_events`
- git diff artifacts in `run_artifacts`
- verification command rows in `verification_results`
- risk reports in `risk_reports`
- memory proposals and decisions in `memory_items`
- run comparison summaries in `comparison_reports`

The initialized SQLite schema covers the imported MVP table set: projects,
agent profiles, tasks, task runs, run events, run artifacts, verification
results, risk reports, memory items, comparison reports, skills, settings, and
status transitions.

SQLite now enforces the important imported storage constraints at the database
boundary. Tasks reference projects with cascade delete, task runs reference
agent profiles when one is selected, task and run status values are checked,
agent kinds are checked, JSON columns reject invalid JSON, and run event
sequence numbers remain unique per run. Local settings reject secret-like keys
and string values before they can be stored in SQLite or in-memory test
repositories, so settings remain limited to safe local behavior preferences.
Ad-hoc CLI runs reuse an existing project for the same repository root. The
first legacy ad-hoc root may still use `adhoc_project` for compatibility;
additional ad-hoc roots get deterministic root-scoped project ids so tasks and
later memory writeback stay attached to the correct local repository. Upgrades
from older SQLite databases also backfill missing legacy task project rows,
including pre-change ad-hoc tasks, before adding the stricter task foreign key.

Task, task-run, and memory status changes follow the imported lifecycle rather
than arbitrary enum changes in both SQLite and injected in-memory
repositories. Same-status updates remain idempotent. Failed task runs remain
inspectable and return the parent task from `running` back to `open` so task
lists and later `--task` runs reflect that no run is currently active. A later
successful run can complete the task, or the user can cancel it.

The product remains local-only. This rebuild does not add cloud sync, accounts,
team features, hosted dashboards, automatic pull requests, automatic merges, or
automatic pushes.

GitHub CI/CD is available for repository maintenance. Pull requests to `main`
run the validation suite (`pnpm typecheck`, `pnpm lint`, `pnpm test`,
`pnpm build`, and the desktop Electron/Vite bundle build). Pushes to `main`
and manual workflow runs build a packaged CLI artifact from the workspace app/
package directories, tests, the CI workflow, root package metadata, `README.md`,
workspace/lock files, and root TypeScript/Vitest config files needed by those
advertised validation scripts. They also build ad-hoc signed macOS desktop DMG
artifacts for x64 and arm64 on GitHub-hosted macOS runners. Version tags that
match `v*.*.*` create or update a GitHub Release with both the workspace
package artifact and the DMG artifacts. The workflow publishes local release
assets only; it does not deploy a hosted service, notarize the desktop app, or
change Agent Hub's local-first product model.

Deferred product capabilities include richer Codex/Claude structured event
mapping, automatic memory proposal generation from completed runs, richer
comparison scoring, and real desktop TaskRunner/adapter execution beyond the
current fake-agent-backed desktop run path.
