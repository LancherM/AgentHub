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
});
