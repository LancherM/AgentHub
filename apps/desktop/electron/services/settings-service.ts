import {
  validateMemoryAutomationPolicy,
  type ProjectRepository,
  type SettingsRepository
} from "@agent-hub/core";
import {
  loadProjectMemoryAutomationPolicy,
  saveProjectMemoryAutomationPolicy,
  type VerificationCommand
} from "@agent-hub/task-runner";
import type {
  MemoryAutomationPolicySettings,
  VerificationCommandConfig,
  VerificationSettings
} from "../../src/lib/types";
import type { DesktopServiceContext } from "./project-service";

export interface SettingsService {
  getVerification(projectId: string): Promise<VerificationSettings>;
  saveVerification(input: VerificationSettings): Promise<VerificationSettings>;
  getMemoryPolicy(projectId: string): Promise<MemoryAutomationPolicySettings>;
  saveMemoryPolicy(
    input: MemoryAutomationPolicySettings
  ): Promise<MemoryAutomationPolicySettings>;
  verificationCommandsForProject(
    projectId: string
  ): Promise<VerificationCommand[] | undefined>;
}

const verificationSettingsPrefix = "desktop.project.";
const verificationSettingsSuffix = ".verificationCommands";
const maxCommands = 12;
const maxArgs = 48;
const maxArgLength = 500;
const maxTimeoutMs = 60 * 60 * 1000;
const executablePattern = /^[^\s|&;<>()$`]+$/;
const commandIdPattern = /^[A-Za-z0-9._-]+$/;
const secretLikeOptionTerms = new Set([
  "token",
  "secret",
  "password",
  "credential",
  "credentials",
  "apikey",
  "privatekey"
]);
const commandKeys = new Set([
  "id",
  "label",
  "executable",
  "args",
  "timeoutMs",
  "continueOnFailure"
]);
const settingsKeys = new Set(["projectId", "commands", "updatedAt"]);
const memoryPolicyKeys = new Set([
  "projectId",
  "mode",
  "maxRiskLevel",
  "allowSkippedVerification",
  "allowedCategories",
  "maxAutoApprovalsPerRun",
  "updatedAt"
]);

export function createSettingsService(
  context: DesktopServiceContext
): SettingsService {
  return new RepositorySettingsService(
    context.repositories.projectRepository,
    context.repositories.settingsRepository,
    context
  );
}

class RepositorySettingsService implements SettingsService {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly settings: SettingsRepository,
    private readonly context: DesktopServiceContext
  ) {}

  async getVerification(projectId: string): Promise<VerificationSettings> {
    const parsedProjectId = parseNonEmptyString(projectId, "projectId");
    await this.requireProject(parsedProjectId);
    const setting = await this.settings.get(verificationSettingsKey(parsedProjectId));
    const commands = setting
      ? parseVerificationCommands(settingValueCommands(setting.value), "stored setting")
      : [];
    return {
      projectId: parsedProjectId,
      commands,
      updatedAt: setting?.updatedAt
    };
  }

  async saveVerification(input: VerificationSettings): Promise<VerificationSettings> {
    const parsed = parseVerificationSettings(input);
    await this.requireProject(parsed.projectId);
    const updatedAt = this.context.now();
    await this.settings.set({
      key: verificationSettingsKey(parsed.projectId),
      value: { commands: parsed.commands },
      updatedAt
    });
    return {
      ...parsed,
      updatedAt
    };
  }

  async getMemoryPolicy(projectId: string): Promise<MemoryAutomationPolicySettings> {
    const parsedProjectId = parseNonEmptyString(projectId, "projectId");
    await this.requireProject(parsedProjectId);
    const setting = await this.settings.get(memoryPolicySettingsKey(parsedProjectId));
    const policy = await loadProjectMemoryAutomationPolicy(
      { settingsRepository: this.settings },
      parsedProjectId
    );
    return {
      projectId: parsedProjectId,
      ...policy,
      updatedAt: setting?.updatedAt
    };
  }

  async saveMemoryPolicy(
    input: MemoryAutomationPolicySettings
  ): Promise<MemoryAutomationPolicySettings> {
    const parsed = parseMemoryPolicySettings(input);
    const { projectId, ...policyInput } = parsed;
    await this.requireProject(projectId);
    const updatedAt = this.context.now();
    const policy = await saveProjectMemoryAutomationPolicy(
      { settingsRepository: this.settings },
      {
        projectId,
        policy: policyInput,
        updatedAt
      }
    );
    return {
      projectId,
      ...policy,
      updatedAt
    };
  }

  async verificationCommandsForProject(
    projectId: string
  ): Promise<VerificationCommand[] | undefined> {
    const settings = await this.getVerification(projectId);
    if (settings.commands.length === 0) {
      return undefined;
    }
    return settings.commands.map((command) => ({
      id: command.id,
      label: command.label,
      command: command.executable,
      args: command.args,
      timeoutMs: command.timeoutMs,
      continueOnFailure: command.continueOnFailure
    }));
  }

  private async requireProject(projectId: string): Promise<void> {
    const project = await this.projects.get(projectId);
    if (!project) {
      throw new Error(`project ${projectId} not found`);
    }
  }
}

function verificationSettingsKey(projectId: string): string {
  return `${verificationSettingsPrefix}${projectId}${verificationSettingsSuffix}`;
}

function memoryPolicySettingsKey(projectId: string): string {
  return `project.${projectId}.memoryAutomationPolicy`;
}

function parseVerificationSettings(input: VerificationSettings): VerificationSettings {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("verification settings input is required");
  }
  const value = input as unknown as Record<string, unknown>;
  rejectUnknownKeys(value, settingsKeys, "verification settings");
  return {
    projectId: parseNonEmptyString(value.projectId, "projectId"),
    commands: parseVerificationCommands(
      value.commands,
      "verification settings"
    )
  };
}

function settingValueCommands(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("stored verification settings must be an object");
  }
  return (value as { commands?: unknown }).commands;
}

function parseMemoryPolicySettings(
  input: MemoryAutomationPolicySettings
): MemoryAutomationPolicySettings {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("memory automation policy input is required");
  }
  const value = input as unknown as Record<string, unknown>;
  rejectUnknownKeys(value, memoryPolicyKeys, "memory automation policy");
  const projectId = parseNonEmptyString(value.projectId, "projectId");
  const policy = validateMemoryAutomationPolicy({
    mode: parseMemoryPolicyMode(value.mode),
    maxRiskLevel: parseMemoryRiskLevel(value.maxRiskLevel),
    allowSkippedVerification: parseBoolean(
      value.allowSkippedVerification,
      "memory automation allow skipped verification"
    ),
    allowedCategories: parseMemoryCategories(value.allowedCategories),
    maxAutoApprovalsPerRun: parseNonNegativeInteger(
      value.maxAutoApprovalsPerRun,
      "memory automation per-run limit"
    )
  });
  return {
    projectId,
    ...policy
  };
}

function parseMemoryPolicyMode(
  input: unknown
): MemoryAutomationPolicySettings["mode"] {
  const mode = parseNonEmptyString(input, "memory automation policy mode");
  if (mode === "suggest_only" || mode === "auto_after_review_accept") {
    return mode;
  }
  if (mode === "auto_safe_on_success") {
    throw new Error("auto_safe_on_success is not enabled in this phase");
  }
  throw new Error("memory automation policy mode is unsupported");
}

function parseMemoryRiskLevel(
  input: unknown
): MemoryAutomationPolicySettings["maxRiskLevel"] {
  const risk = parseNonEmptyString(input, "memory automation max risk");
  if (
    risk === "low" ||
    risk === "medium" ||
    risk === "high" ||
    risk === "blocking"
  ) {
    return risk;
  }
  throw new Error("memory automation max risk is unsupported");
}

function parseVerificationCommands(
  input: unknown,
  label: string
): VerificationCommandConfig[] {
  if (!Array.isArray(input)) {
    throw new Error(`${label} commands must be an array`);
  }
  if (input.length > maxCommands) {
    throw new Error(`verification commands must contain ${maxCommands} or fewer entries`);
  }
  const ids = new Set<string>();
  return input.map((entry, index) => {
    const command = parseVerificationCommand(entry, index);
    if (ids.has(command.id)) {
      throw new Error(`verification command id ${command.id} must be unique`);
    }
    ids.add(command.id);
    return command;
  });
}

function parseVerificationCommand(
  input: unknown,
  index: number
): VerificationCommandConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`verification command ${index + 1} must be an object`);
  }
  const value = input as Record<string, unknown>;
  rejectUnknownKeys(value, commandKeys, `verification command ${index + 1}`);
  const id = parseNonEmptyString(value.id, `verification command ${index + 1} id`);
  if (!commandIdPattern.test(id)) {
    throw new Error(
      `verification command ${index + 1} id may contain only letters, numbers, dots, underscores, and hyphens`
    );
  }
  const executable = parseNonEmptyString(
    value.executable,
    `verification command ${index + 1} executable`
  );
  if (!executablePattern.test(executable)) {
    throw new Error(
      `verification command ${index + 1} executable must be a single executable path or name`
    );
  }
  const args = parseArgs(value.args, index);
  const label = value.label === undefined
    ? undefined
    : parseOptionalString(value.label, `verification command ${index + 1} label`, 120);
  const timeoutMs = value.timeoutMs === undefined
    ? undefined
    : parseTimeoutMs(value.timeoutMs, index);
  const continueOnFailure = value.continueOnFailure === undefined
    ? undefined
    : parseBoolean(value.continueOnFailure, `verification command ${index + 1} continueOnFailure`);
  return {
    id,
    label,
    executable,
    args,
    timeoutMs,
    continueOnFailure
  };
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowedKeys: Set<string>,
  label: string
): void {
  const unknown = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unknown.length > 0) {
    throw new Error(`${label} contains unsupported field ${unknown[0]}`);
  }
}

function parseArgs(input: unknown, commandIndex: number): string[] {
  if (input === undefined) {
    return [];
  }
  if (!Array.isArray(input)) {
    throw new Error(`verification command ${commandIndex + 1} args must be an array`);
  }
  if (input.length > maxArgs) {
    throw new Error(`verification command ${commandIndex + 1} args must contain ${maxArgs} or fewer entries`);
  }
  return input.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new Error(`verification command ${commandIndex + 1} arg ${index + 1} must be a string`);
    }
    if (entry.length > maxArgLength) {
      throw new Error(`verification command ${commandIndex + 1} arg ${index + 1} is too long`);
    }
    if (isSecretLikeOptionName(entry)) {
      throw new Error(
        `verification command ${commandIndex + 1} arg ${index + 1} must not contain a secret-like option name`
      );
    }
    return entry;
  });
}

function isSecretLikeOptionName(arg: string): boolean {
  const trimmed = arg.trim();
  if (!trimmed.startsWith("-")) {
    return false;
  }
  const withoutPrefix = trimmed.replace(/^-+/, "");
  const optionName = withoutPrefix.split("=")[0] ?? "";
  if (!optionName) {
    return false;
  }
  const terms = splitOptionTerms(optionName);
  return terms.some((term, index) =>
    secretLikeOptionTerms.has(term) ||
    (term === "api" && terms[index + 1] === "key") ||
    (term === "private" && terms[index + 1] === "key") ||
    (term === "access" && terms[index + 1] === "token") ||
    (term === "refresh" && terms[index + 1] === "token") ||
    (term === "auth" && terms[index + 1] === "token") ||
    (term === "client" && terms[index + 1] === "secret")
  );
}

function splitOptionTerms(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[._:\-\s]+/)
    .map((term) => term.toLowerCase())
    .filter((term) => term.length > 0);
}

function parseTimeoutMs(input: unknown, commandIndex: number): number {
  if (
    typeof input !== "number" ||
    !Number.isInteger(input) ||
    input <= 0 ||
    input > maxTimeoutMs
  ) {
    throw new Error(
      `verification command ${commandIndex + 1} timeoutMs must be an integer from 1 to ${maxTimeoutMs}`
    );
  }
  return input;
}

function parseBoolean(input: unknown, label: string): boolean {
  if (typeof input !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return input;
}

function parseMemoryCategories(input: unknown): MemoryAutomationPolicySettings["allowedCategories"] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("memory automation allowedCategories must be a non-empty array");
  }
  return input.map((entry) => {
    if (
      entry !== "project_fact" &&
      entry !== "workflow_rule" &&
      entry !== "user_preference" &&
      entry !== "temporary_note"
    ) {
      throw new Error("memory automation allowedCategories contains an unsupported category");
    }
    return entry;
  });
}

function parseNonNegativeInteger(input: unknown, label: string): number {
  if (typeof input !== "number" || !Number.isInteger(input) || input < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return input;
}

function parseOptionalString(
  input: unknown,
  label: string,
  maxLength: number
): string | undefined {
  if (typeof input !== "string") {
    throw new Error(`${label} must be a string`);
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer`);
  }
  return trimmed;
}

function parseNonEmptyString(input: unknown, label: string): string {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return input.trim();
}
