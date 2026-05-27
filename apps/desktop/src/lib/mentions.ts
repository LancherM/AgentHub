import type { AgentId } from "./types";

const mentionPattern = /(^|[\s([{])@(fake|codex|claude-code|claude)\b/gi;

export interface MentionParseResult {
  agents: AgentId[];
  cleanedPrompt: string;
}

export function parseAgentMentions(input: string): MentionParseResult {
  const agents: AgentId[] = [];
  const cleanedPrompt = input
    .replace(mentionPattern, (match, prefix: string, rawAgent: string) => {
      const agent = normalizeAgentId(rawAgent);
      if (agent && !agents.includes(agent)) {
        agents.push(agent);
      }
      return prefix.length > 0 ? prefix : "";
    })
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .trim();

  return { agents, cleanedPrompt };
}

export function resolveMentionedAgents(
  input: string,
  fallbackAgents: AgentId[] = ["codex"]
): MentionParseResult {
  const parsed = parseAgentMentions(input);
  if (parsed.agents.length > 0) {
    return parsed;
  }
  return {
    ...parsed,
    agents: fallbackAgents.length > 0 ? fallbackAgents : ["codex"]
  };
}

function normalizeAgentId(value: string): AgentId | undefined {
  const normalized = value.toLowerCase();
  if (normalized === "fake" || normalized === "codex") {
    return normalized;
  }
  if (normalized === "claude" || normalized === "claude-code") {
    return "claude";
  }
  return undefined;
}
