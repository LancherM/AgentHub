const childEnvironmentAllowlist = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "FORCE_COLOR",
  "CI",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "APPDATA",
  "LOCALAPPDATA",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT"
] as const;

export type ChildEnvironmentOverrides = Record<string, string | undefined>;

export function buildChildProcessEnv(
  overrides: ChildEnvironmentOverrides = {}
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  for (const key of childEnvironmentAllowlist) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
      continue;
    }
    env[key] = value;
  }

  return env;
}

export function childProcessEnvironmentAllowlist(): string[] {
  return [...childEnvironmentAllowlist];
}
