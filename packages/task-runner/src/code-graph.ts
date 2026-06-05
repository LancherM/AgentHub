import { createHash } from "node:crypto";
import path from "node:path";
import { validateCodeGraphEntry, type CodeGraphEntry } from "@agent-hub/core";

export interface TypeScriptCodeGraphFile {
  path: string;
  content: string;
  packageName?: string;
}

export interface TypeScriptCodeGraphInput {
  projectId: string;
  files: TypeScriptCodeGraphFile[];
  indexedAt: string;
}

interface ParsedTypeScriptFile {
  filePath: string;
  content: string;
  packageName: string;
  isTest: boolean;
  imports: string[];
  exports: string[];
  symbols: string[];
}

export function buildTypeScriptCodeGraphEntries(
  input: TypeScriptCodeGraphInput
): CodeGraphEntry[] {
  const files = input.files
    .map((file) => ({
      ...file,
      path: normalizeGraphPath(file.path)
    }))
    .filter((file) => isTypeScriptPath(file.path))
    .sort((left, right) => left.path.localeCompare(right.path));
  const filePathSet = new Set(files.map((file) => file.path));
  const parsedFiles = files.map((file) =>
    parseTypeScriptFile(file, filePathSet)
  );
  const relatedTestsBySource = relatedTests(parsedFiles);

  return parsedFiles.map((file) =>
    validateCodeGraphEntry({
      id: `code_graph:${input.projectId}:${file.filePath}`,
      projectId: input.projectId,
      filePath: file.filePath,
      packageName: file.packageName,
      isTest: file.isTest,
      imports: file.imports,
      exports: file.exports,
      symbols: file.symbols,
      relatedTests: relatedTestsBySource.get(file.filePath) ?? [],
      contentHash: `sha256:${sha256(file.content)}`,
      indexedAt: input.indexedAt,
      metadata: {
        parser: "typescript_regex_v1",
        importCount: file.imports.length,
        exportCount: file.exports.length,
        symbolCount: file.symbols.length
      }
    })
  );
}

function parseTypeScriptFile(
  file: TypeScriptCodeGraphFile,
  filePathSet: Set<string>
): ParsedTypeScriptFile {
  const filePath = normalizeGraphPath(file.path);
  return {
    filePath,
    content: file.content,
    packageName: file.packageName ?? packageNameForPath(filePath),
    isTest: isTestPath(filePath),
    imports: parseImports(file.content, filePath, filePathSet),
    exports: parseExports(file.content),
    symbols: parseSymbols(file.content)
  };
}

function parseImports(
  content: string,
  fromPath: string,
  filePathSet: Set<string>
): string[] {
  const imports: string[] = [];
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[^'"]+\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+[^'"]+\s+from\s+["']([^"']+)["']/g
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const specifier = match[1];
      if (!specifier) {
        continue;
      }
      imports.push(resolveImportSpecifier(specifier, fromPath, filePathSet));
    }
  }
  return uniqueSorted(imports);
}

function parseExports(content: string): string[] {
  const names: string[] = [];
  for (const match of content.matchAll(/\bexport\s+(?:async\s+)?(?:function|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
    if (match[1]) {
      names.push(match[1]);
    }
  }
  for (const match of content.matchAll(/\bexport\s*\{([^}]+)\}/g)) {
    for (const rawName of (match[1] ?? "").split(",")) {
      const name = rawName.trim().split(/\s+as\s+/i)[0]?.trim();
      if (name) {
        names.push(name);
      }
    }
  }
  return uniqueSorted(names);
}

function parseSymbols(content: string): string[] {
  const symbols: string[] = [];
  for (const match of content.matchAll(/\b(?:function|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
    if (match[1]) {
      symbols.push(match[1]);
    }
  }
  return uniqueSorted(symbols);
}

function relatedTests(files: ParsedTypeScriptFile[]): Map<string, string[]> {
  const tests = files.filter((file) => file.isTest);
  const sources = files.filter((file) => !file.isTest);
  const related = new Map<string, string[]>();
  for (const source of sources) {
    const sourceStem = pathStem(source.filePath);
    const matches = tests
      .filter((test) =>
        test.imports.includes(source.filePath) ||
        pathStem(test.filePath).includes(sourceStem) ||
        samePackage(source, test) &&
          test.imports.some((importPath) => importPath === source.filePath)
      )
      .map((test) => test.filePath)
      .sort();
    if (matches.length > 0) {
      related.set(source.filePath, matches);
    }
  }
  return related;
}

function resolveImportSpecifier(
  specifier: string,
  fromPath: string,
  filePathSet: Set<string>
): string {
  if (!specifier.startsWith(".")) {
    return specifier;
  }
  const basePath = normalizeGraphPath(
    path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), specifier))
  );
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.mts`,
    `${basePath}.cts`,
    `${basePath}/index.ts`,
    `${basePath}/index.tsx`
  ];
  return candidates.find((candidate) => filePathSet.has(candidate)) ?? basePath;
}

function packageNameForPath(filePath: string): string {
  const segments = filePath.split("/");
  if ((segments[0] === "packages" || segments[0] === "apps") && segments[1]) {
    return `${segments[0]}/${segments[1]}`;
  }
  if (segments[0] === "tests") {
    return "tests";
  }
  return "root";
}

function isTypeScriptPath(filePath: string): boolean {
  return /\.(?:ts|tsx|mts|cts)$/.test(filePath) && !filePath.endsWith(".d.ts");
}

function isTestPath(filePath: string): boolean {
  return /(?:^|\/)(?:tests?|__tests__)\//.test(filePath) ||
    /\.(?:test|spec)\.(?:ts|tsx|mts|cts)$/.test(filePath);
}

function samePackage(left: ParsedTypeScriptFile, right: ParsedTypeScriptFile): boolean {
  return left.packageName === right.packageName;
}

function pathStem(filePath: string): string {
  return path.posix
    .basename(filePath)
    .replace(/\.(?:test|spec)?\.(?:ts|tsx|mts|cts)$/, "")
    .replace(/\.(?:ts|tsx|mts|cts)$/, "");
}

function normalizeGraphPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
