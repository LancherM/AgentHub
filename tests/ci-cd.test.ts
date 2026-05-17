import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("CI/CD workflow", () => {
  it("packages files needed by advertised validation scripts", async () => {
    const workflow = await fs.readFile(
      path.join(process.cwd(), ".github", "workflows", "ci-cd.yml"),
      "utf8"
    );
    const packageLine = workflow
      .split(/\r?\n/)
      .find((line) => line.includes("tar -czf"));

    expect(packageLine).toContain("apps");
    expect(packageLine).toContain(".github/workflows/ci-cd.yml");
    expect(packageLine).toContain("packages");
    expect(packageLine).toContain("tests");
    expect(packageLine).toContain("tsconfig.json");
    expect(packageLine).toContain("tsconfig.build.json");
    expect(packageLine).toContain("vitest.config.ts");
  });
});
