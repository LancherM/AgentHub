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

  it("uses explicit adapter output metadata without a fake-specific result field", () => {
    const output = extractAgentFacingOutput(
      {
        events: [
          {
            type: "exit",
            message: "fake agent completed",
            metadata: { output: "full fake adapter output" }
          }
        ]
      },
      { includeRawStreams: false }
    );

    expect(output).toBe("full fake adapter output");
  });

  it("can prefer explicit output metadata for CLI rendering", () => {
    const output = extractAgentFacingOutput(
      {
        events: [
          {
            type: "message",
            message: "concise assistant output",
            metadata: { assistantOutput: true }
          },
          {
            type: "exit",
            message: "done",
            metadata: { output: "full adapter output" }
          }
        ]
      },
      { preferExplicitOutput: true }
    );

    expect(output).toBe("full adapter output");
  });

  it("filters planner events out of assistant-facing output", () => {
    const output = extractAgentFacingOutput(
      {
        events: [
          {
            type: "message",
            message: "{\"planGraph\":{\"id\":\"plan_graph:task:v1\"}}",
            metadata: {
              assistantOutput: true,
              plannerEvent: true
            }
          },
          {
            type: "exit",
            message: "planner completed",
            metadata: {
              output: "{\"planGraph\":{\"id\":\"plan_graph:task:v1\"}}",
              plannerEvent: true
            }
          },
          {
            type: "stdout",
            message: "{\"planGraph\":{\"id\":\"plan_graph:task:v1\"}}\n",
            metadata: { plannerEvent: true }
          },
          {
            type: "message",
            message: "primary assistant output",
            metadata: { assistantOutput: true }
          }
        ]
      },
      { preferExplicitOutput: true }
    );

    expect(output).toBe("primary assistant output");
  });
});
