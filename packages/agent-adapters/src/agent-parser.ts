import {
  DomainValidationError,
  parseAgentKind,
  type AgentKind
} from "@agent-hub/shared";

export interface ParsedAgentPrompt {
  agentKind: AgentKind;
  prompt: string;
  explicitAgent: boolean;
}

export class AgentPromptParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentPromptParseError";
  }
}

export function parseAgentPrompt(
  rawInput: string,
  defaultAgent: AgentKind = "fake"
): ParsedAgentPrompt {
  const input = rawInput.trim();

  if (input.length === 0) {
    throw new AgentPromptParseError("task prompt is required");
  }

  if (!input.startsWith("@")) {
    return {
      agentKind: defaultAgent,
      prompt: input,
      explicitAgent: false
    };
  }

  const match = input.match(/^@([a-zA-Z0-9_-]+)(?:\s+([\s\S]+))?$/);
  if (!match) {
    throw new AgentPromptParseError("invalid @agent prompt");
  }

  let agentKind: AgentKind;
  try {
    agentKind = parseAgentKind(match[1]);
  } catch (error) {
    if (error instanceof DomainValidationError) {
      throw new AgentPromptParseError(`unknown agent ${match[1]}`);
    }
    throw error;
  }
  const prompt = match[2]?.trim() ?? "";
  if (prompt.length === 0) {
    throw new AgentPromptParseError("task prompt is required after @agent");
  }

  return {
    agentKind,
    prompt,
    explicitAgent: true
  };
}
