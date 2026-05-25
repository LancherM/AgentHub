import type { RunEvent } from "./types";

export interface CliUnavailableDiagnostic {
  adapter?: string;
  reason: string;
  executable?: string;
  detectCommand?: string;
  verifyCommand?: string;
  cwd?: string;
  pathEntries: string[];
}

export function findCliUnavailableDiagnostic(
  events: RunEvent[]
): CliUnavailableDiagnostic | undefined {
  for (const event of events) {
    const payload = event.payload as Record<string, unknown>;
    const detection = objectValue(payload.detection);
    const diagnostics =
      objectValue(payload.cliDiagnostics) ?? objectValue(detection?.diagnostics);
    if (!detection || detection.available !== false || !diagnostics) {
      continue;
    }
    return {
      adapter: stringValue(payload.adapter),
      reason:
        stringValue(detection.reason) ??
        stringValue(payload.message) ??
        "CLI unavailable.",
      executable: stringValue(diagnostics.executable),
      detectCommand: stringValue(diagnostics.detectCommand),
      verifyCommand: stringValue(diagnostics.verifyCommand),
      cwd: stringValue(diagnostics.cwd),
      pathEntries: arrayOfStrings(diagnostics.pathEntries)
    };
  }
  return undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}
