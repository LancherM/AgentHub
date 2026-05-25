import type {
  AgentId,
  ContextMode,
  TeamRoleSummary
} from "./types";

export type ComposerSuggestionKind = "agent" | "role" | "command";
export type ComposerTargetKind = "agent" | "role";
export type ComposerTargetSource = "explicit" | "fallback";

export interface ComposerTrigger {
  kind: "mention" | "command";
  start: number;
  end: number;
  query: string;
}

export interface ComposerSuggestion {
  id: string;
  kind: ComposerSuggestionKind;
  handle: string;
  label: string;
  detail: string;
  insertText: string;
  runCount: number;
  recent?: boolean;
}

export interface ComposerTarget {
  id: string;
  kind: ComposerTargetKind;
  handle: string;
  label: string;
  detail: string;
  runCount: number;
  removable: boolean;
  source: ComposerTargetSource;
}

export interface ComposerTargetResolution {
  targets: ComposerTarget[];
  explicitTargetCount: number;
  runCount: number;
}

export interface ComposerSuggestionApplication {
  value: string;
  cursor: number;
}

export const contextModeOptions: ContextMode[] = [
  "auto",
  "minimal",
  "full",
  "workspace"
];

const agentSuggestions: ComposerSuggestion[] = [
  {
    id: "agent:fake",
    kind: "agent",
    handle: "fake",
    label: "@fake",
    detail: "Use the deterministic local fake agent",
    insertText: "@fake",
    runCount: 1
  },
  {
    id: "agent:codex",
    kind: "agent",
    handle: "codex",
    label: "@codex",
    detail: "Run Codex CLI in the task worktree",
    insertText: "@codex",
    runCount: 1
  },
  {
    id: "agent:claude",
    kind: "agent",
    handle: "claude",
    label: "@claude",
    detail: "Run Claude Code in the task worktree",
    insertText: "@claude",
    runCount: 1
  }
];

const commandSuggestions: ComposerSuggestion[] = [
  {
    id: "command:workflow-review",
    kind: "command",
    handle: "workflow review_loop",
    label: "/workflow review_loop",
    detail: "Start a bounded local review workflow",
    insertText: "/workflow review_loop",
    runCount: 0
  },
  {
    id: "command:workflow-handoff",
    kind: "command",
    handle: "workflow handoff",
    label: "/workflow handoff",
    detail: "Record a local handoff workflow",
    insertText: "/workflow handoff",
    runCount: 0
  },
  {
    id: "command:continue",
    kind: "command",
    handle: "continue",
    label: "/continue run",
    detail: "Prepare an explicit code-state continuation prompt",
    insertText: "/continue run",
    runCount: 0
  },
  {
    id: "command:compare",
    kind: "command",
    handle: "compare",
    label: "/compare",
    detail: "Prompt for a local comparison review",
    insertText: "/compare",
    runCount: 0
  },
  {
    id: "command:memory",
    kind: "command",
    handle: "memory",
    label: "/memory",
    detail: "Prompt for memory review or proposal handling",
    insertText: "/memory",
    runCount: 0
  },
  {
    id: "command:review",
    kind: "command",
    handle: "review",
    label: "/review",
    detail: "Prompt for run evidence review",
    insertText: "/review",
    runCount: 0
  },
  {
    id: "command:room-timeline",
    kind: "command",
    handle: "room timeline",
    label: "/room timeline",
    detail: "Prompt for room timeline inspection",
    insertText: "/room timeline",
    runCount: 0
  }
];

const triggerPattern = /(^|[\s([{])([@/])([a-z0-9_-]*)$/i;
const mentionPattern = /(^|[\s([{])@([a-z][a-z0-9_-]*)\b/gi;

export function activeComposerTrigger(
  input: string,
  cursor: number
): ComposerTrigger | undefined {
  const boundedCursor = Math.max(0, Math.min(cursor, input.length));
  const beforeCursor = input.slice(0, boundedCursor);
  const match = triggerPattern.exec(beforeCursor);
  if (!match) {
    return undefined;
  }
  const marker = match[2];
  const query = match[3].toLowerCase();
  const tokenLength = marker.length + match[3].length;
  return {
    kind: marker === "@" ? "mention" : "command",
    start: boundedCursor - tokenLength,
    end: boundedCursor,
    query
  };
}

export function buildComposerSuggestions(input: {
  roles: readonly TeamRoleSummary[];
  recentAgents?: readonly AgentId[];
  recentRoleHandles?: readonly string[];
  trigger?: ComposerTrigger;
}): ComposerSuggestion[] {
  if (!input.trigger) {
    return [];
  }
  const query = input.trigger.query;
  if (input.trigger.kind === "command") {
    return commandSuggestions.filter((suggestion) =>
      matchesSuggestion(suggestion, query)
    );
  }

  const suggestions = [
    ...recentMentionSuggestions(
      input.roles,
      input.recentAgents ?? [],
      input.recentRoleHandles ?? []
    ),
    ...agentSuggestions,
    ...roleSuggestions(input.roles)
  ];
  return dedupeSuggestions(suggestions).filter((suggestion) =>
    matchesSuggestion(suggestion, query)
  );
}

export function applyComposerSuggestion(
  input: string,
  trigger: ComposerTrigger,
  suggestion: ComposerSuggestion
): ComposerSuggestionApplication {
  const before = input.slice(0, trigger.start);
  const after = input.slice(trigger.end);
  const spacer =
    after.length === 0 || /^\s/.test(after)
      ? " "
      : " ";
  const value = `${before}${suggestion.insertText}${spacer}${after}`.replace(
    /[ \t]{2,}/g,
    " "
  );
  return {
    value,
    cursor: before.length + suggestion.insertText.length + spacer.length
  };
}

export function removeComposerTarget(
  input: string,
  target: Pick<ComposerTarget, "handle">
): string {
  const handle = escapeRegExp(target.handle);
  return input
    .replace(new RegExp(`(^|[\\s([{])@${handle}\\b`, "i"), "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trimStart();
}

export function insertComposerTarget(input: string, target: ComposerTarget): string {
  const mention = `@${target.handle}`;
  if (new RegExp(`(^|[\\s([{])${escapeRegExp(mention)}\\b`, "i").test(input)) {
    return input;
  }
  return `${mention} ${input}`.trim();
}

export function resolveComposerTargets(input: {
  value: string;
  roles: readonly TeamRoleSummary[];
  fallbackAgents?: readonly AgentId[];
  fallbackRoleHandles?: readonly string[];
}): ComposerTargetResolution {
  const targets: ComposerTarget[] = [];
  const keys = new Set<string>();
  const rolesByHandle = roleMap(input.roles);

  input.value.replace(
    mentionPattern,
    (_match, _prefix: string, rawMention: string) => {
      const agent = normalizeAgentId(rawMention);
      if (agent) {
        pushTarget(targets, keys, agentTarget(agent, "explicit"));
        return "";
      }
      const role = rolesByHandle.get(normalizeHandle(rawMention));
      if (role) {
        pushTarget(targets, keys, roleTarget(role, "explicit"));
      }
      return "";
    }
  );

  const explicitTargetCount = targets.length;
  if (targets.length === 0) {
    for (const handle of input.fallbackRoleHandles ?? []) {
      const role = rolesByHandle.get(normalizeHandle(handle));
      if (role) {
        pushTarget(targets, keys, roleTarget(role, "fallback"));
      }
    }
    for (const agent of input.fallbackAgents ?? ["fake"]) {
      pushTarget(targets, keys, agentTarget(agent, "fallback"));
    }
    if (targets.length === 0) {
      pushTarget(targets, keys, agentTarget("fake", "fallback"));
    }
  }

  return {
    targets,
    explicitTargetCount,
    runCount: Math.max(
      1,
      targets.reduce((total, target) => total + target.runCount, 0)
    )
  };
}

function recentMentionSuggestions(
  roles: readonly TeamRoleSummary[],
  recentAgents: readonly AgentId[],
  recentRoleHandles: readonly string[]
): ComposerSuggestion[] {
  const rolesByHandle = roleMap(roles);
  return [
    ...recentRoleHandles.flatMap((handle) => {
      const role = rolesByHandle.get(normalizeHandle(handle));
      return role ? [{ ...roleSuggestion(role), recent: true }] : [];
    }),
    ...recentAgents.map((agent) => ({
      ...agentSuggestions.find((suggestion) => suggestion.handle === agent)!,
      recent: true,
      detail: "Recent target"
    }))
  ];
}

function roleSuggestions(roles: readonly TeamRoleSummary[]): ComposerSuggestion[] {
  return roles
    .filter((summary) => summary.status === "enabled" && summary.role.enabled)
    .map(roleSuggestion);
}

function roleSuggestion(summary: TeamRoleSummary): ComposerSuggestion {
  return {
    id: `role:${summary.role.handle}`,
    kind: "role",
    handle: summary.role.handle,
    label: `@${summary.role.handle}`,
    detail: `${summary.role.displayName}; ${summary.executorLabel}`,
    insertText: `@${summary.role.handle}`,
    runCount: summary.executorRunnable ? 1 : 0
  };
}

function matchesSuggestion(suggestion: ComposerSuggestion, query: string): boolean {
  if (!query) {
    return true;
  }
  return [suggestion.handle, suggestion.label, suggestion.detail]
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function dedupeSuggestions(
  suggestions: readonly ComposerSuggestion[]
): ComposerSuggestion[] {
  const seen = new Set<string>();
  const deduped: ComposerSuggestion[] = [];
  for (const suggestion of suggestions) {
    if (seen.has(suggestion.id)) {
      continue;
    }
    seen.add(suggestion.id);
    deduped.push(suggestion);
  }
  return deduped;
}

function agentTarget(
  agent: AgentId,
  source: ComposerTargetSource
): ComposerTarget {
  return {
    id: `agent:${agent}`,
    kind: "agent",
    handle: agent,
    label: `@${agent}`,
    detail: source === "fallback" ? "recent target" : "adapter",
    runCount: 1,
    removable: source === "explicit",
    source
  };
}

function roleTarget(
  summary: TeamRoleSummary,
  source: ComposerTargetSource
): ComposerTarget {
  return {
    id: `role:${summary.role.handle}`,
    kind: "role",
    handle: summary.role.handle,
    label: `@${summary.role.handle}`,
    detail: summary.executorLabel,
    runCount: summary.executorRunnable ? 1 : 0,
    removable: source === "explicit",
    source
  };
}

function pushTarget(
  targets: ComposerTarget[],
  keys: Set<string>,
  target: ComposerTarget
): void {
  if (keys.has(target.id)) {
    return;
  }
  keys.add(target.id);
  targets.push(target);
}

function roleMap(
  roles: readonly TeamRoleSummary[]
): Map<string, TeamRoleSummary> {
  return new Map(
    roles
      .filter((summary) => summary.status === "enabled" && summary.role.enabled)
      .map((summary) => [normalizeHandle(summary.role.handle), summary])
  );
}

function normalizeAgentId(value: string): AgentId | undefined {
  const normalized = value.toLowerCase();
  if (normalized === "fake" || normalized === "codex") {
    return normalized;
  }
  if (normalized === "claude" || normalized === "claude-code") {
    return "claude";
  }
  return undefined;
}

function normalizeHandle(value: string): string {
  return value.trim().toLowerCase().replace(/^@/, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
