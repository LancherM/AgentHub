import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createCliRuntime, main } from "@agent-hub/cli";
import { createTestDirectory } from "./helpers";

describe("CLI team role YAML", () => {
  it("merges existing team.yaml above SQLite role settings", async () => {
    const projectRoot = await createTestDirectory("cli-team-yaml-project");
    const runtime = createCliRuntime({ storageMode: "memory" });
    await registerProject(runtime, projectRoot);
    const io = testIo();

    await expect(
      main([
        "team",
        "roles",
        "save",
        "--project-id",
        "project_team_yaml",
        "--handle",
        "reviewer",
        "--display-name",
        "SQLite Reviewer",
        "--executor",
        "human"
      ], io, projectRoot, runtime)
    ).resolves.toBe(0);
    await expect(
      main([
        "team",
        "roles",
        "save",
        "--project-id",
        "project_team_yaml",
        "--handle",
        "sqliteonly",
        "--display-name",
        "SQLite Only",
        "--executor",
        "human"
      ], io, projectRoot, runtime)
    ).resolves.toBe(0);
    await writeTeamYaml(projectRoot, [
      yamlRole("reviewer", "YAML Reviewer"),
      yamlRole("yamlops", "YAML Ops")
    ]);

    await expect(
      main(["team", "roles", "list", "--project-id", "project_team_yaml"], io, projectRoot, runtime)
    ).resolves.toBe(0);
    await expect(
      main([
        "team",
        "roles",
        "show",
        "--project-id",
        "project_team_yaml",
        "--role",
        "reviewer"
      ], io, projectRoot, runtime)
    ).resolves.toBe(0);

    const rendered = io.output.join("");
    expect(io.errors.join("")).toBe("");
    expect(rendered).toContain("@reviewer\tyaml_override");
    expect(rendered).toContain("@yamlops\tyaml_custom");
    expect(rendered).toContain("@sqliteonly\tcustom");
    expect(rendered).toContain("display_name: YAML Reviewer");
    expect(rendered).not.toContain("display_name: SQLite Reviewer");
  });

  it("reports invalid existing team.yaml during role reads", async () => {
    const projectRoot = await createTestDirectory("cli-team-yaml-invalid");
    const runtime = createCliRuntime({ storageMode: "memory" });
    await registerProject(runtime, projectRoot);
    const io = testIo();
    await fs.mkdir(path.join(projectRoot, ".agent-hub"), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, ".agent-hub", "team.yaml"),
      "roles:\n  - handle: Bad Handle\n",
      "utf8"
    );

    await expect(
      main(["team", "roles", "list", "--project-id", "project_team_yaml"], io, projectRoot, runtime)
    ).resolves.toBe(1);

    expect(io.errors.join("")).toContain("invalid team.yaml");
  });

  it("exports team roles as preview by default and writes only with --write", async () => {
    const projectRoot = await createTestDirectory("cli-team-yaml-export");
    const runtime = createCliRuntime({ storageMode: "memory" });
    await registerProject(runtime, projectRoot);
    const io = testIo();

    await expect(
      main([
        "team",
        "roles",
        "save",
        "--project-id",
        "project_team_yaml",
        "--handle",
        "qa",
        "--display-name",
        "QA",
        "--executor",
        "human"
      ], io, projectRoot, runtime)
    ).resolves.toBe(0);
    await expect(
      main(["team", "roles", "export", "--project-id", "project_team_yaml"], io, projectRoot, runtime)
    ).resolves.toBe(0);
    await expect(
      fs.stat(path.join(projectRoot, ".agent-hub", "team.yaml"))
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      main([
        "team",
        "roles",
        "export",
        "--project-id",
        "project_team_yaml",
        "--write"
      ], io, projectRoot, runtime)
    ).resolves.toBe(0);

    const rendered = io.output.join("");
    expect(io.errors.join("")).toBe("");
    expect(rendered).toContain("Team roles export preview");
    expect(rendered).toContain("mode: preview");
    expect(rendered).toContain("handle: qa");
    expect(rendered).toContain("Exported team roles");
    await expect(
      fs.readFile(path.join(projectRoot, ".agent-hub", "team.yaml"), "utf8")
    ).resolves.toContain("handle: qa");
  });

  it("previews team.yaml import and writes to SQLite only with --write", async () => {
    const projectRoot = await createTestDirectory("cli-team-yaml-import");
    const runtime = createCliRuntime({ storageMode: "memory" });
    await registerProject(runtime, projectRoot);
    const io = testIo();
    await writeTeamYaml(projectRoot, [yamlRole("operatorx", "Operator X")]);

    await expect(
      main(["team", "roles", "import", "--project-id", "project_team_yaml"], io, projectRoot, runtime)
    ).resolves.toBe(0);
    await expect(
      runtime.settingsRepository.get("desktop.project.project_team_yaml.workgroupRoles")
    ).resolves.toBeUndefined();
    await expect(
      main([
        "team",
        "roles",
        "import",
        "--project-id",
        "project_team_yaml",
        "--write"
      ], io, projectRoot, runtime)
    ).resolves.toBe(0);

    const rendered = io.output.join("");
    expect(io.errors.join("")).toBe("");
    expect(rendered).toContain("Team roles import preview");
    expect(rendered).toContain("@operatorx");
    expect(rendered).toContain("Imported team roles");
    await expect(
      runtime.settingsRepository.get("desktop.project.project_team_yaml.workgroupRoles")
    ).resolves.toMatchObject({
      value: {
        roles: [
          expect.objectContaining({
            handle: "operatorx",
            displayName: "Operator X",
            delegationPolicy: expect.objectContaining({
              canInitiateRoleCalls: true,
              allowedTargetRoles: ["researcher"]
            })
          })
        ]
      }
    });
  });
});

async function registerProject(
  runtime: ReturnType<typeof createCliRuntime>,
  projectRoot: string
): Promise<void> {
  await runtime.projectRepository.create({
    id: "project_team_yaml",
    name: "Team YAML",
    rootPath: projectRoot,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  });
}

async function writeTeamYaml(projectRoot: string, roles: string[]): Promise<void> {
  await fs.mkdir(path.join(projectRoot, ".agent-hub"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, ".agent-hub", "team.yaml"),
    ["roles:", ...roles].join("\n"),
    "utf8"
  );
}

function yamlRole(handle: string, displayName: string): string {
  return [
    `  - id: yaml:${handle}`,
    `    handle: ${handle}`,
    `    displayName: ${displayName}`,
    `    purpose: ${displayName} purpose`,
    `    capabilitySummary: ${displayName} capability`,
    `    persona: ${displayName} persona`,
    `    defaultInstructions: ${displayName} instructions`,
    "    permissions:",
    "      - read_project_context",
    "    contextPolicy:",
    "      scope: current_thread_and_project_context",
    "      includeApprovedMemory: true",
    "      includeThreadSummary: true",
    "      instructions:",
    "        - Use YAML context.",
    "    approvalPolicy:",
    "      requiredFor:",
    "        - external_side_effects",
    "      summary: YAML approval.",
    "    delegationPolicy:",
    "      canInitiateRoleCalls: true",
    "      allowedIntentTypes:",
    "        - delegate",
    "      allowedTargetRoles:",
    "        - researcher",
    "    executor:",
    "      kind: human",
    "      unavailableReason: YAML role is not executable.",
    "    enabled: true"
  ].join("\n");
}

function testIo(): {
  output: string[];
  errors: string[];
  stdout: { write(chunk: string): boolean };
  stderr: { write(chunk: string): boolean };
} {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    output,
    errors,
    stdout: { write: (chunk: string) => { output.push(chunk); return true; } },
    stderr: { write: (chunk: string) => { errors.push(chunk); return true; } }
  };
}
