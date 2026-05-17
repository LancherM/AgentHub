import { describe, expect, it } from "vitest";
import { AgentPromptParseError, parseAgentPrompt } from "@agent-hub/agent-adapters";

describe("@agent prompt parsing", () => {
  it("routes explicit fake prompts", () => {
    expect(parseAgentPrompt("@fake update the docs")).toEqual({
      agentKind: "fake",
      prompt: "update the docs",
      explicitAgent: true
    });
  });

  it("uses the default agent for plain prompts", () => {
    expect(parseAgentPrompt("summarize this project")).toEqual({
      agentKind: "fake",
      prompt: "summarize this project",
      explicitAgent: false
    });
  });

  it("supports known future agent names without running them", () => {
    expect(parseAgentPrompt("@claude-code review this").agentKind).toBe("claude-code");
    expect(parseAgentPrompt("@codex implement this").agentKind).toBe("codex");
  });

  it("rejects unknown agents and empty prompts", () => {
    expect(() => parseAgentPrompt("@unknown task")).toThrow();
    expect(() => parseAgentPrompt("@fake")).toThrow(AgentPromptParseError);
    expect(() => parseAgentPrompt("")).toThrow(AgentPromptParseError);
  });
});

