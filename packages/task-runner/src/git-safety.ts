import fs from "node:fs/promises";
import path from "node:path";
import {
  ShellExecutorError,
  type ShellCommand,
  type ShellExecutionOptions
} from "./shell-executor";

const SAFE_GIT_CONFIG_OVERRIDES = [
  "core.fsmonitor=false",
  "core.hooksPath=/dev/null",
  "diff.external=",
  "interactive.diffFilter=",
  "pager.status=false",
  "pager.diff=false"
];

const SAFE_GIT_ENV: Record<string, string> = {
  GIT_CONFIG_GLOBAL: osDevNull(),
  GIT_CONFIG_SYSTEM: osDevNull(),
  GIT_TERMINAL_PROMPT: "0"
};

export function safeGitCommand(args: string[]): ShellCommand {
  return {
    executable: "git",
    args: [
      ...SAFE_GIT_CONFIG_OVERRIDES.flatMap((entry) => ["-c", entry]),
      ...args
    ]
  };
}

export function safeGitExecutionOptions(
  options: ShellExecutionOptions
): ShellExecutionOptions {
  return {
    ...options,
    env: {
      ...(options.env ?? {}),
      ...SAFE_GIT_ENV
    }
  };
}

export async function assertSafeLocalGitConfig(
  repositoryPath: string
): Promise<void> {
  const gitDirectory = await findGitDirectory(repositoryPath);
  if (!gitDirectory) {
    return;
  }
  const configPaths = await findLocalConfigPaths(gitDirectory);
  const unsafeKeys: Array<{ filePath: string; key: string }> = [];

  for (const configPath of configPaths) {
    const config = await readOptionalTextFile(configPath);
    if (!config) {
      continue;
    }
    for (const key of parseGitConfigKeys(config)) {
      if (isUnsafeLocalGitConfigKey(key)) {
        unsafeKeys.push({ filePath: configPath, key });
      }
    }
  }

  if (unsafeKeys.length > 0) {
    const details = unsafeKeys
      .map(
        (entry) =>
          `${path.relative(repositoryPath, entry.filePath) || entry.filePath}: ${entry.key}`
      )
      .join(", ");
    throw new ShellExecutorError(
      `refusing to run git in repository with executable local git config (${details})`
    );
  }
}

async function findGitDirectory(startPath: string): Promise<string | undefined> {
  let current = path.resolve(startPath);
  while (true) {
    const dotGitPath = path.join(current, ".git");
    const stats = await statOptional(dotGitPath);
    if (stats?.isDirectory()) {
      return dotGitPath;
    }
    if (stats?.isFile()) {
      const contents = await readOptionalTextFile(dotGitPath);
      const match = contents?.match(/^gitdir:\s*(.+)\s*$/im);
      if (match) {
        return path.resolve(current, match[1].trim());
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

async function findLocalConfigPaths(gitDirectory: string): Promise<string[]> {
  const paths = [
    path.join(gitDirectory, "config"),
    path.join(gitDirectory, "config.worktree")
  ];
  const commonDir = await readOptionalTextFile(
    path.join(gitDirectory, "commondir")
  );
  if (commonDir) {
    const commonGitDirectory = path.resolve(gitDirectory, commonDir.trim());
    paths.push(
      path.join(commonGitDirectory, "config"),
      path.join(commonGitDirectory, "config.worktree")
    );
  }
  return [...new Set(paths)];
}

function parseGitConfigKeys(config: string): string[] {
  const keys: string[] = [];
  let section = "";
  for (const rawLine of config.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#") || line.startsWith(";")) {
      continue;
    }
    const sectionMatch = line.match(/^\[([^\]]+)\](?:\s*(?:[#;].*)?)?$/);
    if (sectionMatch) {
      section = normalizeGitConfigSection(sectionMatch[1]);
      continue;
    }
    const keyMatch = line.match(/^([A-Za-z0-9-]+)\s*(?:=|$)/);
    if (keyMatch && section) {
      keys.push(`${section}.${keyMatch[1].toLowerCase()}`);
    }
  }
  return keys;
}

function normalizeGitConfigSection(section: string): string {
  return section
    .trim()
    .replace(/\s+"([^"]+)"$/, ".$1")
    .toLowerCase();
}

function isUnsafeLocalGitConfigKey(key: string): boolean {
  return (
    key === "core.fsmonitor" ||
    key === "core.hookspath" ||
    key === "diff.external" ||
    key === "interactive.difffilter" ||
    key === "include.path" ||
    key.startsWith("includeif.") ||
    /^filter\..+\.(clean|smudge|process)$/.test(key) ||
    /^diff\..+\.(command|textconv)$/.test(key)
  );
}

async function statOptional(filePath: string) {
  try {
    return await fs.stat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function readOptionalTextFile(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function osDevNull(): string {
  return process.platform === "win32" ? "NUL" : "/dev/null";
}
