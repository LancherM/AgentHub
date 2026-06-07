import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
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
    expect(packageLine).toContain("scripts");
    expect(packageLine).toContain("tests");
    expect(packageLine).toContain("tsconfig.json");
    expect(packageLine).toContain("tsconfig.build.json");
    expect(packageLine).toContain("vitest.config.ts");
  });

  it("builds macOS DMG desktop artifacts in CI and publishes them on tag releases", async () => {
    const [
      workflow,
      packageScript,
      builderConfig,
      rootPackageJson,
      desktopPackageJson
    ] = await Promise.all([
      fs.readFile(
        path.join(process.cwd(), ".github", "workflows", "ci-cd.yml"),
        "utf8"
      ),
      fs.readFile(
        path.join(process.cwd(), "scripts", "build-macos-dmg.sh"),
        "utf8"
      ),
      fs.readFile(
        path.join(process.cwd(), "apps", "desktop", "electron-builder.yml"),
        "utf8"
      ),
      fs.readFile(path.join(process.cwd(), "package.json"), "utf8"),
      fs.readFile(
        path.join(process.cwd(), "apps", "desktop", "package.json"),
        "utf8"
      )
    ]);

    const rootPackage = JSON.parse(rootPackageJson) as {
      scripts?: Record<string, string>;
    };
    const desktopPackage = JSON.parse(desktopPackageJson) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(rootPackage.scripts?.["desktop:dist:mac"]).toContain(
      "scripts/build-macos-dmg.sh"
    );
    expect(desktopPackage.scripts?.["package:mac"]).toContain(
      "electron-builder --mac dmg"
    );
    expect(desktopPackage.devDependencies).toHaveProperty("electron-builder");
    expect(workflow).toContain("runs-on: macos-latest");
    expect(workflow).toContain("CSC_IDENTITY_AUTO_DISCOVERY");
    expect(workflow).toContain("bash scripts/build-macos-dmg.sh");
    expect(workflow).toContain("agent-hub-macos-dmg-${{ matrix.arch }}");
    expect(workflow).toContain("artifacts/*.dmg");
    expect(packageScript).toContain("electron-builder --mac dmg");
    expect(packageScript).toContain("./node_modules/.bin/pnpm");
    expect(packageScript).toContain("for attempt in 1 2 3");
    expect(builderConfig).toContain("target: dmg");
    expect(builderConfig).toContain('identity: "-"');
  });

  it("runs report-only total coverage and blocking PR diff coverage in Validate", async () => {
    const [workflow, rootPackageJson] = await Promise.all([
      fs.readFile(
        path.join(process.cwd(), ".github", "workflows", "ci-cd.yml"),
        "utf8"
      ),
      fs.readFile(path.join(process.cwd(), "package.json"), "utf8")
    ]);
    const rootPackage = JSON.parse(rootPackageJson) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(rootPackage.scripts?.["test:coverage"]).toContain("vitest run --coverage");
    expect(rootPackage.scripts?.["coverage:diff"]).toBe(
      "node scripts/check-diff-coverage.mjs"
    );
    expect(rootPackage.devDependencies).toHaveProperty("@vitest/coverage-v8");
    expect(workflow).toContain("DIFF_COVERAGE_THRESHOLD");
    expect(workflow).toContain("name: Coverage");
    expect(workflow).toContain("name: Check diff coverage");
    expect(workflow).toContain("if: github.event_name == 'pull_request'");
    expect(workflow).toContain("pnpm run coverage:diff");
    expect(workflow).toContain("tee -a \"$GITHUB_STEP_SUMMARY\"");
  });

  it("calculates changed-line coverage from git diff and lcov data", async () => {
    const diffCoverage = await import(
      pathToFileURL(path.join(process.cwd(), "scripts", "check-diff-coverage.mjs")).href
    );
    const changedLinesByFile = diffCoverage.parseChangedLines(
      [
        "diff --git a/packages/core/src/example.ts b/packages/core/src/example.ts",
        "--- a/packages/core/src/example.ts",
        "+++ b/packages/core/src/example.ts",
        "@@ -1,0 +1,3 @@",
        "+export function covered() {",
        "+  return 1;",
        "+}",
        "diff --git a/README.md b/README.md",
        "--- a/README.md",
        "+++ b/README.md",
        "@@ -1,0 +1 @@",
        "+docs only"
      ].join("\n")
    );
    const coverageByFile = diffCoverage.parseLcov(
      [
        "TN:",
        `SF:${path.join(process.cwd(), "packages", "core", "src", "example.ts")}`,
        "DA:1,1",
        "DA:2,0",
        "DA:3,1",
        "end_of_record"
      ].join("\n")
    );

    const result = diffCoverage.calculateDiffCoverage({
      changedLinesByFile,
      coverageByFile,
      threshold: 80
    });

    expect(result).toMatchObject({
      passed: false,
      totals: {
        covered: 2,
        instrumented: 3,
        ignored: 1
      }
    });
    expect(result.pct).toBeCloseTo(66.66, 1);
    expect(diffCoverage.formatDiffCoverageMarkdown(result)).toContain(
      "Diff coverage failed"
    );
  });

  it("covers diff coverage argument parsing and missing lcov handling", async () => {
    const diffCoverage = await import(
      pathToFileURL(path.join(process.cwd(), "scripts", "check-diff-coverage.mjs")).href
    );
    const options = diffCoverage.parseArgs([
      "--base",
      "origin/main",
      "--head",
      "HEAD",
      "--lcov",
      "coverage/lcov.info",
      "--threshold",
      "70"
    ]);

    expect(options).toEqual({
      base: "origin/main",
      head: "HEAD",
      lcovPath: "coverage/lcov.info",
      threshold: 70
    });
    expect(() => diffCoverage.parseArgs(["--threshold", "101"])).toThrow(
      /threshold/
    );
    expect(() => diffCoverage.parseArgs(["--unknown"])).toThrow(/Unknown/);
    expect(diffCoverage.isDiffCoverageSource("packages/core/src/domain.ts")).toBe(
      true
    );
    expect(diffCoverage.isDiffCoverageSource("packages/core/src/domain.d.ts")).toBe(
      false
    );
    expect(diffCoverage.isDiffCoverageSource("README.md")).toBe(false);
    expect(diffCoverage.formatLineList([1, 2, 3], 2)).toBe("1, 2, +1 more");

    const result = diffCoverage.calculateDiffCoverage({
      changedLinesByFile: new Map([
        ["packages/core/src/missing.ts", new Set([1, 2])],
        ["README.md", new Set([1])]
      ]),
      coverageByFile: new Map(),
      threshold: 70
    });

    expect(result).toMatchObject({
      passed: false,
      totals: {
        instrumented: 2,
        missingCoverage: 2,
        ignored: 1
      }
    });
    expect(diffCoverage.formatDiffCoverageMarkdown(result)).toContain(
      "missing lcov"
    );
  });
});
