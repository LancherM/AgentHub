import {
  findWorkgroupRoleByHandle,
  presetWorkgroupRoles,
  toWorkgroupRoleRunMetadata,
  type WorkgroupRole,
  type WorkgroupRoleRunMetadata
} from "@agent-hub/shared";
import type { AgentId } from "./types";

const mentionPattern = /(^|[\s([{])@(fake|codex|claude-code|claude)\b/gi;
const anyMentionPattern = /(^|[\s([{])@([a-z][a-z0-9_-]*)\b/gi;

export interface MentionParseResult {
  agents: AgentId[];
  cleanedPrompt: string;
}

export interface WorkgroupMentionParticipant {
  agentId: AgentId;
  role?: WorkgroupRoleRunMetadata;
  source: "adapter_mention" | "role_mention";
}

export interface WorkgroupMentionParseResult extends MentionParseResult {
  agentMentions: AgentId[];
  roleMentions: WorkgroupRoleRunMetadata[];
  participants: WorkgroupMentionParticipant[];
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
  fallbackAgents: AgentId[] = ["fake"]
): MentionParseResult {
  const parsed = parseAgentMentions(input);
  if (parsed.agents.length > 0) {
    return parsed;
  }
  return {
    ...parsed,
    agents: fallbackAgents.length > 0 ? fallbackAgents : ["fake"]
  };
}

export function parseWorkgroupMentions(
  input: string,
  roles: readonly WorkgroupRole[] = presetWorkgroupRoles
): WorkgroupMentionParseResult {
  const agentMentions: AgentId[] = [];
  const roleMentions: WorkgroupRoleRunMetadata[] = [];
  const participants: WorkgroupMentionParticipant[] = [];
  const participantKeys = new Set<string>();
  const cleanedPrompt = input
    .replace(anyMentionPattern, (match, prefix: string, rawMention: string) => {
      const agent = normalizeAgentId(rawMention);
      if (agent) {
        addAgentMention(agentMentions, participants, participantKeys, agent);
        return prefix.length > 0 ? prefix : "";
      }
      const role = findWorkgroupRoleByHandle(roles, rawMention);
      const adapter = role?.enabled ? adapterForRole(role) : undefined;
      if (role && adapter) {
        const metadata = toWorkgroupRoleRunMetadata(role);
        if (!roleMentions.some((mention) => mention.roleHandle === metadata.roleHandle)) {
          roleMentions.push(metadata);
        }
        addRoleMention(participants, participantKeys, adapter, metadata);
        return prefix.length > 0 ? prefix : "";
      }
      return match;
    })
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .trim();

  return {
    agents: uniqueAgents(participants.map((participant) => participant.agentId)),
    agentMentions,
    roleMentions,
    participants,
    cleanedPrompt
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

function adapterForRole(role: WorkgroupRole): AgentId | undefined {
  if (role.executor.kind !== "agent_adapter") {
    return undefined;
  }
  return toAgentId(role.executor.adapterKind);
}

function toAgentId(value: string): AgentId | undefined {
  if (value === "fake" || value === "codex") {
    return value;
  }
  if (value === "claude-code" || value === "claude") {
    return "claude";
  }
  return undefined;
}

function addAgentMention(
  agentMentions: AgentId[],
  participants: WorkgroupMentionParticipant[],
  participantKeys: Set<string>,
  agentId: AgentId
): void {
  if (!agentMentions.includes(agentId)) {
    agentMentions.push(agentId);
  }
  const key = `adapter:${agentId}`;
  if (participantKeys.has(key)) {
    return;
  }
  participantKeys.add(key);
  participants.push({ agentId, source: "adapter_mention" });
}

function addRoleMention(
  participants: WorkgroupMentionParticipant[],
  participantKeys: Set<string>,
  agentId: AgentId,
  role: WorkgroupRoleRunMetadata
): void {
  const key = `role:${role.roleHandle}`;
  if (participantKeys.has(key)) {
    return;
  }
  participantKeys.add(key);
  participants.push({ agentId, role, source: "role_mention" });
}

function uniqueAgents(agents: AgentId[]): AgentId[] {
  const unique: AgentId[] = [];
  for (const agent of agents) {
    if (!unique.includes(agent)) {
      unique.push(agent);
    }
  }
  return unique;
}
