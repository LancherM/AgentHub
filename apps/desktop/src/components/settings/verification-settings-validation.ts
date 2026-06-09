export interface DraftVerificationCommand {
  id: string;
  label: string;
  executable: string;
  argsText: string;
  timeoutMs: string;
  continueOnFailure: boolean;
}

export interface DraftCommandValidationResult {
  message?: string;
  commandIssues: Record<number, string>;
}

export interface DraftMemoryAutomationPolicy {
  mode: string;
  maxRiskLevel: string;
  allowSkippedVerification: boolean;
  allowedCategories: string[];
  maxAutoApprovalsPerRun: string;
}

export interface DraftMemoryPolicyValidationResult {
  message?: string;
}

export function validateDraftVerificationCommands(
  commands: DraftVerificationCommand[]
): DraftCommandValidationResult {
  const commandIssues: Record<number, string> = {};
  const seenIds = new Map<string, number>();

  commands.forEach((command, index) => {
    const label = command.label.trim() || command.id.trim() || `command ${index + 1}`;
    const id = command.id.trim();
    const executable = command.executable.trim();
    const timeout = command.timeoutMs.trim();

    if (!id) {
      commandIssues[index] = `Add an ID for ${label}.`;
      return;
    }

    const firstIndex = seenIds.get(id);
    if (firstIndex !== undefined) {
      commandIssues[index] = `Use a unique ID; "${id}" is already used by command ${firstIndex + 1}.`;
      return;
    }
    seenIds.set(id, index);

    if (!executable) {
      commandIssues[index] = `Add an executable for ${label}, for example "pnpm" or "npm".`;
      return;
    }

    if (timeout && (!/^\d+$/.test(timeout) || Number(timeout) <= 0)) {
      commandIssues[index] = `Use a positive timeout in milliseconds for ${label}.`;
    }
  });

  const firstIssue = Object.keys(commandIssues)
    .map((key) => Number(key))
    .sort((left, right) => left - right)
    .map((key) => commandIssues[key])
    .find(Boolean);

  return {
    message: firstIssue,
    commandIssues
  };
}

export function cleanSettingsError(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  return rawMessage
    .replace(/^Error invoking remote method '[^']+':\s*/u, "")
    .replace(/^Error:\s*/u, "")
    .trim();
}

export function validateDraftMemoryAutomationPolicy(
  policy: DraftMemoryAutomationPolicy
): DraftMemoryPolicyValidationResult {
  if (
    policy.mode !== "suggest_only" &&
    policy.mode !== "auto_after_review_accept" &&
    policy.mode !== "auto_safe_on_success"
  ) {
    return { message: "Choose a valid memory automation mode." };
  }
  if (
    policy.maxRiskLevel !== "low" &&
    policy.maxRiskLevel !== "medium" &&
    policy.maxRiskLevel !== "high" &&
    policy.maxRiskLevel !== "blocking"
  ) {
    return { message: "Choose a valid risk threshold." };
  }
  if (policy.allowedCategories.length === 0) {
    return { message: "Select at least one memory category." };
  }
  const limit = policy.maxAutoApprovalsPerRun.trim();
  if (!/^\d+$/.test(limit) || Number(limit) > 10) {
    return { message: "Use an auto-approval limit from 0 to 10." };
  }
  return {};
}
