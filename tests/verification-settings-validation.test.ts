import { describe, expect, it } from "vitest";
import {
  cleanSettingsError,
  validateDraftVerificationCommands,
  type DraftVerificationCommand
} from "../apps/desktop/src/components/settings/verification-settings-validation";

describe("verification settings renderer validation", () => {
  it("reports missing executables before save reaches IPC", () => {
    expect(
      validateDraftVerificationCommands([
        draftCommand({ id: "verify-1", executable: "" })
      ])
    ).toEqual({
      message: 'Add an executable for verify-1, for example "pnpm" or "npm".',
      commandIssues: {
        0: 'Add an executable for verify-1, for example "pnpm" or "npm".'
      }
    });
  });

  it("reports duplicate IDs and invalid timeout values", () => {
    expect(
      validateDraftVerificationCommands([
        draftCommand({ id: "verify" }),
        draftCommand({ id: "verify" }),
        draftCommand({ id: "verify-3", timeoutMs: "soon" })
      ])
    ).toEqual({
      message: 'Use a unique ID; "verify" is already used by command 1.',
      commandIssues: {
        1: 'Use a unique ID; "verify" is already used by command 1.',
        2: "Use a positive timeout in milliseconds for verify-3."
      }
    });
  });

  it("strips Electron remote-method prefixes from settings errors", () => {
    expect(
      cleanSettingsError(
        new Error(
          "Error invoking remote method 'agent-hub:settings:save-verification': Error: verification command 1 executable is required"
        )
      )
    ).toBe("verification command 1 executable is required");
  });
});

function draftCommand(
  patch: Partial<DraftVerificationCommand> = {}
): DraftVerificationCommand {
  return {
    id: "verify-1",
    label: "",
    executable: "pnpm",
    argsText: "test",
    timeoutMs: "",
    continueOnFailure: false,
    ...patch
  };
}
