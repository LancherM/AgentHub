import type {
  AgentId,
  ContextMode,
  RunInspectorTab
} from "./types";

export type DesktopWorkspacePreference = "chat" | "knowledge" | "team";
export type SidebarDensityPreference = "comfortable" | "compact";

export interface DesktopPreferences {
  selectedProjectId?: string;
  selectedThreadId?: string;
  activeWorkspace: DesktopWorkspacePreference;
  contextMode: ContextMode;
  inspectorTab: RunInspectorTab;
  sidebarDensity: SidebarDensityPreference;
  lastUsedAgents: AgentId[];
  lastUsedRoleHandles: string[];
}

export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const desktopPreferencesKey = "agent-hub.desktop.preferences.v1";

export const defaultDesktopPreferences: DesktopPreferences = {
  activeWorkspace: "chat",
  contextMode: "auto",
  inspectorTab: "brief",
  sidebarDensity: "comfortable",
  lastUsedAgents: ["codex"],
  lastUsedRoleHandles: []
};

export function loadDesktopPreferences(
  storage: PreferenceStorage | undefined = browserStorage()
): DesktopPreferences {
  if (!storage) {
    return { ...defaultDesktopPreferences };
  }
  const raw = storage.getItem(desktopPreferencesKey);
  if (!raw) {
    return { ...defaultDesktopPreferences };
  }
  try {
    return sanitizeDesktopPreferences(JSON.parse(raw));
  } catch {
    return { ...defaultDesktopPreferences };
  }
}

export function mergeDesktopPreferences(
  current: DesktopPreferences,
  patch: Partial<DesktopPreferences>
): DesktopPreferences {
  return sanitizeDesktopPreferences({ ...current, ...patch });
}

export function saveDesktopPreferences(
  preferences: DesktopPreferences,
  storage: PreferenceStorage | undefined = browserStorage()
): void {
  if (!storage) {
    return;
  }
  storage.setItem(
    desktopPreferencesKey,
    JSON.stringify(sanitizeDesktopPreferences(preferences))
  );
}

export function sanitizeDesktopPreferences(input: unknown): DesktopPreferences {
  const value = input && typeof input === "object" && !Array.isArray(input)
    ? (input as Partial<DesktopPreferences>)
    : {};
  return {
    selectedProjectId: safeOptionalId(value.selectedProjectId),
    selectedThreadId: safeOptionalId(value.selectedThreadId),
    activeWorkspace: isWorkspace(value.activeWorkspace)
      ? value.activeWorkspace
      : defaultDesktopPreferences.activeWorkspace,
    contextMode: isContextMode(value.contextMode)
      ? value.contextMode
      : defaultDesktopPreferences.contextMode,
    inspectorTab: isInspectorTab(value.inspectorTab)
      ? value.inspectorTab
      : defaultDesktopPreferences.inspectorTab,
    sidebarDensity: value.sidebarDensity === "compact"
      ? "compact"
      : defaultDesktopPreferences.sidebarDensity,
    lastUsedAgents: safeAgentList(value.lastUsedAgents),
    lastUsedRoleHandles: safeRoleHandleList(value.lastUsedRoleHandles)
  };
}

function browserStorage(): PreferenceStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function safeOptionalId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return /^[A-Za-z0-9._:-]{1,160}$/.test(trimmed) ? trimmed : undefined;
}

function isWorkspace(value: unknown): value is DesktopWorkspacePreference {
  return value === "chat" || value === "knowledge" || value === "team";
}

function isContextMode(value: unknown): value is ContextMode {
  return value === "auto" ||
    value === "minimal" ||
    value === "full" ||
    value === "workspace";
}

function isInspectorTab(value: unknown): value is RunInspectorTab {
  return value === "summary" ||
    value === "brief" ||
    value === "context" ||
    value === "artifacts" ||
    value === "diff" ||
    value === "tests" ||
    value === "checks" ||
    value === "risk" ||
    value === "risks" ||
    value === "trace" ||
    value === "handoff" ||
    value === "lifecycle" ||
    value === "memory" ||
    value === "logs" ||
    value === "audit" ||
    value === "compare";
}

function safeAgentList(value: unknown): AgentId[] {
  if (!Array.isArray(value)) {
    return [...defaultDesktopPreferences.lastUsedAgents];
  }
  const agents = value.filter((entry): entry is AgentId =>
    entry === "fake" || entry === "codex" || entry === "claude"
  );
  return agents.length > 0 ? unique(agents).slice(0, 5) : ["codex"];
}

function safeRoleHandleList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return unique(
    value.filter((entry): entry is string =>
      typeof entry === "string" && /^[a-z][a-z0-9_-]{0,62}$/.test(entry)
    )
  ).slice(0, 8);
}

function unique<T>(values: T[]): T[] {
  return values.filter((value, index, all) => all.indexOf(value) === index);
}
