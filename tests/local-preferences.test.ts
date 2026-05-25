import { describe, expect, it } from "vitest";
import {
  defaultDesktopPreferences,
  desktopPreferencesKey,
  loadDesktopPreferences,
  mergeDesktopPreferences,
  saveDesktopPreferences,
  sanitizeDesktopPreferences,
  type PreferenceStorage
} from "../apps/desktop/src/lib/local-preferences";

describe("desktop local preferences", () => {
  it("sanitizes harmless preference fields and rejects unsafe shapes", () => {
    expect(
      sanitizeDesktopPreferences({
        selectedProjectId: "project_1",
        selectedThreadId: "../bad",
        activeWorkspace: "knowledge",
        contextMode: "workspace",
        inspectorTab: "risks",
        sidebarDensity: "compact",
        lastUsedAgents: ["codex", "bad"],
        lastUsedRoleHandles: ["engineer", "Bad Role"]
      })
    ).toEqual({
      selectedProjectId: "project_1",
      selectedThreadId: undefined,
      activeWorkspace: "knowledge",
      contextMode: "workspace",
      inspectorTab: "risks",
      sidebarDensity: "compact",
      lastUsedAgents: ["codex"],
      lastUsedRoleHandles: ["engineer"]
    });
  });

  it("round-trips safe preferences through storage", () => {
    const storage = memoryStorage();
    const preferences = mergeDesktopPreferences(defaultDesktopPreferences, {
      selectedProjectId: "project_1",
      selectedThreadId: "thread_1",
      contextMode: "minimal"
    });

    saveDesktopPreferences(preferences, storage);

    expect(storage.getItem(desktopPreferencesKey)).toContain("project_1");
    expect(loadDesktopPreferences(storage)).toMatchObject({
      selectedProjectId: "project_1",
      selectedThreadId: "thread_1",
      contextMode: "minimal"
    });
  });
});

function memoryStorage(): PreferenceStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    }
  };
}
