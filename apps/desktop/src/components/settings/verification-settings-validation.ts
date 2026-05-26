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
