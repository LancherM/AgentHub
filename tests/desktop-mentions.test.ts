import { describe, expect, it } from "vitest";
import {
  parseAgentMentions,
  resolveMentionedAgents
} from "../apps/desktop/src/lib/mentions";

describe("desktop mention parsing", () => {
  it("extracts a leading agent mention and strips it from the task", () => {
    expect(parseAgentMentions("@fake implement desktop streaming")).toEqual({
      agents: ["fake"],
      cleanedPrompt: "implement desktop streaming"
    });
  });

  it("extracts multiple ordered agent mentions from the prompt body", () => {
    expect(
      parseAgentMentions("@fake compare with @codex and @claude-code")
    ).toEqual({
      agents: ["fake", "codex", "claude"],
      cleanedPrompt: "compare with and"
    });
  });

  it("deduplicates repeated mentions", () => {
    expect(parseAgentMentions("@codex @codex @claude plan")).toEqual({
      agents: ["codex", "claude"],
      cleanedPrompt: "plan"
    });
  });

  it("preserves unknown mentions in the cleaned prompt", () => {
    expect(parseAgentMentions("@reviewer ask @fake to check")).toEqual({
      agents: ["fake"],
      cleanedPrompt: "@reviewer ask to check"
    });
  });

  it("falls back to the last used agent set when no mention is present", () => {
    expect(resolveMentionedAgents("summarize the run", ["codex"])).toEqual({
      agents: ["codex"],
      cleanedPrompt: "summarize the run"
    });
  });
});
