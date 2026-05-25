import { describe, expect, it } from "vitest";
import { extractAgentFacingOutput } from "@agent-hub/core";

describe("extractAgentFacingOutput", () => {
  it("does not promote terminal summaries when extracting agent-facing output", () => {
    const output = extractAgentFacingOutput(
      {
        events: [
          {
            type: "run_completed",
            message: "Codex exited with code 0",
            metadata: { exitCode: 0 }
          }
        ]
      },
      { includeRawStreams: false }
    );

    expect(output).toBe("");
  });

  it("keeps adapter failure diagnostics out of assistant output when flagged", () => {
    const output = extractAgentFacingOutput(
      {
        events: [
          {
            type: "error",
            message: "Codex preflight failed: CLI unavailable",
            metadata: { assistantOutput: false }
          }
        ]
      },
      { includeRawStreams: false }
    );

    expect(output).toBe("");
  });

  it("keeps explicit assistant output when semantic event names differ", () => {
    const output = extractAgentFacingOutput(
      {
        events: [
          {
            type: "agent_step",
            message: "fake agent completed",
            metadata: { assistantOutput: true }
          }
        ]
      },
      { includeRawStreams: false }
    );

    expect(output).toBe("fake agent completed");
  });
});
