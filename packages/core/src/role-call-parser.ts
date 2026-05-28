import {
  validateRoleIntent,
  type ExpectedOutputSpec,
  type RoleDefinition,
  type RoleIntent
} from "./domain";

export type RoleCallParseWarningType =
  | "unknown_role"
  | "duplicate_intent"
  | "empty_task";

export interface RoleCallParseWarning {
  type: RoleCallParseWarningType;
  role?: string;
  line: number;
  message: string;
}

export interface ParsedRoleIntent {
  intent: RoleIntent;
  lineStart: number;
  lineEnd: number;
  rawText: string;
}

export interface RoleCallParseResult {
  intents: ParsedRoleIntent[];
  warnings: RoleCallParseWarning[];
}

export interface RoleCallParserOptions {
  knownRoles: readonly (Pick<RoleDefinition, "handle" | "enabled"> | string)[];
  defaultReason?: string;
  defaultExpectedOutput?: ExpectedOutputSpec;
}

interface PendingIntent {
  targetRole: string;
  lineStart: number;
  taskLines: string[];
  rawLines: string[];
}

const lineStartRoleCallPattern = /^[ \t]*@([a-z][a-z0-9_-]*)\b[ \t]*(.*)$/i;
const fencePattern = /^[ \t]*```/;

export function parseRoleCallIntents(
  input: string,
  options: RoleCallParserOptions
): RoleCallParseResult {
  const knownRoles = new Set(
    options.knownRoles
      .map((role) => (typeof role === "string" ? role : role.enabled === false ? "" : role.handle))
      .map((role) => role.trim().toLowerCase())
      .filter(Boolean)
  );
  const warnings: RoleCallParseWarning[] = [];
  const intents: ParsedRoleIntent[] = [];
  const seenKeys = new Set<string>();
  const lines = input.split(/\r?\n/);
  let inFence = false;
  let pending: PendingIntent | undefined;

  const flush = (lineEnd: number): void => {
    if (!pending) {
      return;
    }
    const task = pending.taskLines.join("\n").trim();
    if (task.length === 0) {
      warnings.push({
        type: "empty_task",
        role: pending.targetRole,
        line: pending.lineStart,
        message: `Role call to @${pending.targetRole} has no task text.`
      });
      pending = undefined;
      return;
    }

    const key = `${pending.targetRole}\0${normalizeTaskForDuplicateCheck(task)}`;
    if (seenKeys.has(key)) {
      warnings.push({
        type: "duplicate_intent",
        role: pending.targetRole,
        line: pending.lineStart,
        message: `Duplicate role call to @${pending.targetRole} was ignored.`
      });
      pending = undefined;
      return;
    }
    seenKeys.add(key);

    const intent = validateRoleIntent({
      type: "delegate",
      targetRole: pending.targetRole,
      task,
      reason:
        options.defaultReason ??
        "Line-start role mention emitted from role output.",
      expectedOutput: options.defaultExpectedOutput ?? { format: "summary" }
    });
    intents.push({
      intent,
      lineStart: pending.lineStart,
      lineEnd,
      rawText: pending.rawLines.join("\n")
    });
    pending = undefined;
  };

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (fencePattern.test(line)) {
      flush(lineNumber - 1);
      inFence = !inFence;
      return;
    }
    if (inFence) {
      return;
    }

    const match = line.match(lineStartRoleCallPattern);
    if (match) {
      flush(lineNumber - 1);
      const targetRole = match[1].toLowerCase();
      if (!knownRoles.has(targetRole)) {
        warnings.push({
          type: "unknown_role",
          role: targetRole,
          line: lineNumber,
          message: `Unknown role @${targetRole} was ignored.`
        });
        return;
      }
      pending = {
        targetRole,
        lineStart: lineNumber,
        taskLines: [match[2].trim()].filter(Boolean),
        rawLines: [line]
      };
      return;
    }

    if (!pending) {
      return;
    }
    if (line.trim().length === 0) {
      flush(lineNumber - 1);
      return;
    }
    pending.taskLines.push(line.trim());
    pending.rawLines.push(line);
  });

  flush(lines.length);
  return { intents, warnings };
}

function normalizeTaskForDuplicateCheck(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}
