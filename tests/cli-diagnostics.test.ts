import { describe, expect, it } from "vitest";
import { findCliUnavailableDiagnostic } from "../apps/desktop/src/lib/cli-diagnostics";
import type { RunEvent } from "../apps/desktop/src/lib/types";

describe("findCliUnavailableDiagnostic", () => {
  it("extracts actionable CLI preflight evidence from run events", () => {
    const diagnostic = findCliUnavailableDiagnostic([
      {
        id: "event_1",
        runId: "run_1",
        sequence: 1,
        type: "run_failed",
        timestamp: "2026-05-25T00:00:00.000Z",
        payload: {
          adapter: "codex",
          detection: {
            available: false,
            reason: "Codex CLI unavailable: not authenticated",
            diagnostics: {
              executable: "codex",
              detectCommand: "codex --version",
              verifyCommand: "codex --version",
              cwd: "/tmp/worktree",
              pathEntries: ["/opt/homebrew/bin", "/usr/local/bin"]
            }
          }
        }
      } satisfies RunEvent
    ]);

    expect(diagnostic).toEqual({
      adapter: "codex",
      reason: "Codex CLI unavailable: not authenticated",
      executable: "codex",
      detectCommand: "codex --version",
      verifyCommand: "codex --version",
      cwd: "/tmp/worktree",
      pathEntries: ["/opt/homebrew/bin", "/usr/local/bin"]
    });
  });
});
