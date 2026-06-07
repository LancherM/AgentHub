import { describe, expect, it } from "vitest";
import { buildTypeScriptCodeGraphEntries } from "@agent-hub/task-runner";

const indexedAt = "2026-01-01T00:00:00.000Z";

describe("TypeScript code graph indexing", () => {
  it("parses imports, exports, symbols, package boundaries, and related tests", () => {
    const entries = buildTypeScriptCodeGraphEntries({
      projectId: "project_graph",
      indexedAt,
      files: [
        {
          path: "packages/core/src/parser.ts",
          content: [
            "import { TOKEN } from './tokens';",
            "export class Parser {}",
            "export function parse(input: string) { return TOKEN + input; }",
            "const privateHelper = () => input;"
          ].join("\n")
        },
        {
          path: "packages/core/src/tokens.ts",
          content: "export const TOKEN = 'token';\n"
        },
        {
          path: "packages/core/src/parser.test.ts",
          content: [
            "import { parse } from './parser';",
            "export const parserSpec = () => parse('input');"
          ].join("\n")
        },
        {
          path: "README.md",
          content: "Not TypeScript."
        }
      ]
    });

    expect(entries.map((entry) => entry.filePath)).toEqual([
      "packages/core/src/parser.test.ts",
      "packages/core/src/parser.ts",
      "packages/core/src/tokens.ts"
    ]);
    expect(entries.find((entry) => entry.filePath.endsWith("parser.ts"))).toMatchObject({
      packageName: "packages/core",
      isTest: false,
      imports: ["packages/core/src/tokens.ts"],
      exports: ["parse", "Parser"],
      symbols: ["parse", "Parser", "privateHelper"],
      relatedTests: ["packages/core/src/parser.test.ts"],
      metadata: expect.objectContaining({
        parser: "typescript_regex_v1"
      })
    });
    expect(entries.find((entry) => entry.filePath.endsWith("parser.test.ts"))).toMatchObject({
      isTest: true,
      imports: ["packages/core/src/parser.ts"],
      exports: ["parserSpec"]
    });
  });

  it("resolves extensionless directory imports to module-format index files", () => {
    const entries = buildTypeScriptCodeGraphEntries({
      projectId: "project_graph",
      indexedAt,
      files: [
        {
          path: "apps/cli/src/consumer.mts",
          content: [
            "import { loadFeature } from './feature';",
            "export const run = () => loadFeature();"
          ].join("\n")
        },
        {
          path: "apps/cli/src/feature/index.mts",
          content: "export function loadFeature() { return 'ok'; }\n"
        },
        {
          path: "apps/cli/src/feature/index.test.mts",
          content: [
            "import { loadFeature } from './index';",
            "export const spec = () => loadFeature();"
          ].join("\n")
        }
      ]
    });

    expect(entries.find((entry) => entry.filePath.endsWith("consumer.mts"))).toMatchObject({
      imports: ["apps/cli/src/feature/index.mts"]
    });
    expect(entries.find((entry) => entry.filePath.endsWith("feature/index.mts"))).toMatchObject({
      relatedTests: ["apps/cli/src/feature/index.test.mts"]
    });
  });
});
