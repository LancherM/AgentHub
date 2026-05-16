# Adapter Specification

## AgentAdapter Contract

Every agent adapter must provide:

- a stable agent kind
- a display name
- a detection method
- a run method that returns an async event stream

Detection returns:

- whether the agent is available
- optional version text
- optional reason when unavailable

Run input contains:

- original project root
- isolated worktree path
- generated task brief path
- optional generated context pack path
- optional runtime directory
- task ID
- task title
- task prompt
- optional environment overrides

Run events include:

- stdout chunks
- stderr chunks
- agent messages
- tool call summaries or payloads
- system events
- errors
- exit information

## Required Invariants

- The adapter must run in the isolated worktree.
- The adapter must not run in the original project root.
- The adapter must consume the generated task brief through runtime injection by default.
- The adapter must not require repository-level agent files for normal operation.
- The adapter must stream output as events.
- The adapter must emit an exit event.
- The adapter must not merge, push, or clean up branches.
- The adapter must not use dangerous permission-bypass flags.

## FakeAgentAdapter

Purpose:

- deterministic test adapter
- validates task-run plumbing without requiring an external agent
- writes a simple output artifact inside the worktree

Detection:

- always available

Run behavior:

- validates the worktree and task brief path
- refuses to run if the worktree path is the original project root
- refuses task briefs outside the worktree
- reads the generated task brief
- writes a small output file inside the worktree
- emits stdout and exit events

Failure handling:

- missing task brief emits an error event and non-zero exit
- invalid task brief path emits an error event and non-zero exit
- original-root execution emits an error event and non-zero exit

## CodexAdapter

Purpose:

- run a Codex-compatible CLI non-interactively inside the isolated worktree

Detection:

- call the external CLI version command
- parse a friendly version if available
- return unavailable when the command cannot be spawned or exits unsuccessfully

Run behavior:

- read the generated task brief
- spawn the external CLI with the worktree as current directory
- pass the task brief through stdin or equivalent non-invasive input
- request structured output when supported
- stream stdout, stderr, parsed agent messages, parsed tool calls, and exit status
- avoid unsafe bypass flags

Error handling:

- missing CLI returns unavailable during detection
- spawn failure emits error and exit events
- malformed structured output is preserved as stdout or warning-like event rather than crashing the task runner
- non-zero external exit becomes a non-zero adapter exit

Shell execution safety:

- use argument arrays instead of shell-interpolated command strings
- set current directory to the worktree
- pass only intentional environment overrides
- avoid invoking a shell unless absolutely required
- never request full disk access or permission bypass

## ClaudeCodeAdapter

Purpose:

- run a Claude Code-compatible CLI non-interactively inside the isolated worktree

Detection:

- call the external CLI version command or a lightweight availability command
- return unavailable with a clear reason when missing or unauthenticated

Run behavior:

- read the generated task brief
- spawn the external CLI in non-interactive print mode when available
- use structured or streamed output when available
- pass the task brief through stdin
- set current directory to the worktree
- stream stdout, stderr, agent messages, system events, and exit status
- avoid repository-level context file requirements in default mode

Error handling:

- missing CLI returns unavailable during detection
- authentication or setup failure should be surfaced in stderr or error events
- non-zero exit should fail the run
- malformed stream events should be handled without losing raw output

Shell execution safety:

- run only inside the task worktree
- do not use flags that skip safety prompts wholesale
- do not enable remote sessions or remote execution in the MVP
- do not write generated context into the original checkout

## Error Handling Rules

Adapter errors should be explicit and recoverable:

- detection errors should not crash the CLI
- run setup errors should emit an error event and non-zero exit when possible
- child process spawn errors should be converted into adapter events
- process signals should be captured in exit payloads
- stdout and stderr should be preserved for debugging
- event parsing should be tolerant of unknown event shapes

## Shell Execution Safety

Adapters and verification runners should follow these rules:

- prefer direct process spawn with an executable plus argument list
- avoid shell interpolation
- set `cwd` to the worktree path
- pass stdin explicitly
- close stdin after writing prompt input
- capture stdout and stderr separately
- enforce timeouts for verification commands
- preserve exit code and signal
- do not run in the original project root
- do not push, merge, or delete branches
- flag dangerous generated commands before user acceptance

Dangerous command patterns to flag include:

- recursive root deletion
- unsafe permission broadening
- pipe-to-shell installers
- force pushes
- destructive git cleanup
- privileged commands

Sensitive paths to flag include:

- environment files
- private keys
- token files
- credential files
- secret configuration files
