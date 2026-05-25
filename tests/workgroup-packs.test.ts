import { describe, expect, it } from "vitest";
import {
  builtInWorkgroupPacks,
  engineeringTermSurface,
  getBuiltInWorkgroupPack,
  labelWorkgroupVocabulary,
  presetWorkgroupRoleHandles,
  requireBuiltInWorkgroupPack,
  validateWorkgroupPackDefinition
} from "@agent-hub/core";

describe("workgroup packs", () => {
  it("defines deterministic built-in packs with valid metadata", () => {
    expect(builtInWorkgroupPacks.map((pack) => pack.id)).toEqual([
      "core-workgroup",
      "engineering",
      "research",
      "writing",
      "analysis",
      "operations"
    ]);

    for (const pack of builtInWorkgroupPacks) {
      expect(validateWorkgroupPackDefinition(pack)).toBe(pack);
      expect(pack.allowsCustomRoles).toBe(true);
      expect(pack.artifactTypes.length).toBeGreaterThan(0);
      expect(pack.checkTypes.length).toBeGreaterThan(0);
      expect(pack.riskCategories.length).toBeGreaterThan(0);
      expect(pack.contextSectionProviders.length).toBeGreaterThan(0);
      expect(
        pack.defaultRoleTemplateHandles.every((handle) =>
          presetWorkgroupRoleHandles.includes(handle)
        )
      ).toBe(true);
    }
  });

  it("looks up packs without making the registry editable", () => {
    expect(getBuiltInWorkgroupPack("engineering")).toMatchObject({
      id: "engineering",
      displayName: "Engineering"
    });
    expect(requireBuiltInWorkgroupPack("research").defaultRoleTemplateHandles)
      .toContain("researcher");
    expect(() => requireBuiltInWorkgroupPack("marketplace")).toThrow(
      /workgroup pack marketplace not found/
    );
  });

  it("keeps core labels general and gates engineering terms behind engineering metadata", () => {
    expect(labelWorkgroupVocabulary("brief")).toBe("Brief");
    expect(labelWorkgroupVocabulary("context")).toBe("Context");
    expect(labelWorkgroupVocabulary("artifacts")).toBe("Artifacts");
    expect(labelWorkgroupVocabulary("checks")).toBe("Checks");
    expect(labelWorkgroupVocabulary("risks")).toBe("Risks");
    expect(labelWorkgroupVocabulary("memory")).toBe("Memory");

    expect(labelWorkgroupVocabulary("diff")).toBe("Artifacts");
    expect(labelWorkgroupVocabulary("tests")).toBe("Checks");
    expect(labelWorkgroupVocabulary("worktree")).toBe("Artifacts");
    expect(labelWorkgroupVocabulary("pr")).toBe("Artifacts");
    expect(labelWorkgroupVocabulary("ci")).toBe("Checks");

    expect(labelWorkgroupVocabulary("diff", "engineering")).toBe("Diff");
    expect(labelWorkgroupVocabulary("tests", "engineering")).toBe("Tests");
    expect(labelWorkgroupVocabulary("worktree", "engineering")).toBe("Worktree");
    expect(labelWorkgroupVocabulary("pr", "engineering")).toBe("PR");
    expect(labelWorkgroupVocabulary("ci", "engineering")).toBe("CI");
    expect(engineeringTermSurface("diff")).toBe("artifacts");
    expect(engineeringTermSurface("tests")).toBe("checks");
  });
});
