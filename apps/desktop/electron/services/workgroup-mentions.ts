import {
  findWorkgroupRoleByHandle,
  presetWorkgroupRoles,
  toWorkgroupRoleRunMetadata,
  type WorkgroupRole,
  type WorkgroupRoleRunMetadata
} from "@agent-hub/shared";
import type { AgentId } from "../../src/lib/types";

const anyMentionPattern = /(^|[\s([{])@([a-z][a-z0-9_-]*)\b/gi;

export interface WorkgroupMentionParticipant {
  agentId: AgentId;
  role?: WorkgroupRoleRunMetadata;
  source: "adapter_mention" | "role_mention";
}

export interface WorkgroupMentionParseResult {
  agents: AgentId[];
  agentMentions: AgentId[];
  roleMentions: WorkgroupRoleRunMetadata[];
  participants: WorkgroupMentionParticipant[];
  cleanedPrompt: string;
}

export interface WorkgroupMentionOptions {
  availableAgents?: readonly AgentId[];
  rejectUnavailableAgents?: boolean;
}

export function parseWorkgroupMentions(
  input: string,
  roles: readonly WorkgroupRole[] = presetWorkgroupRoles,
  options: WorkgroupMentionOptions = {}
): WorkgroupMentionParseResult {
  const agentMentions: AgentId[] = [];
  const roleMentions: WorkgroupRoleRunMetadata[] = [];
  const participants: WorkgroupMentionParticipant[] = [];
  const participantKeys = new Set<string>();
  const cleanedPrompt = input
    .replace(anyMentionPattern, (match, prefix: string, rawMention: string) => {
      const agent = normalizeAgentId(rawMention);
      if (agent && isAvailableAgent(agent, options.availableAgents)) {
        addAgentMention(agentMentions, participants, participantKeys, agent);
        return prefix.length > 0 ? prefix : "";
      }
      if (agent && options.rejectUnavailableAgents) {
        throw new Error(
          agent === "fake"
            ? "fake agent is disabled outside Agent Hub debug/development mode"
            : `${agent} agent is disabled by Agent Hub agent availability config`
        );
      }
      const role = findWorkgroupRoleByHandle(roles, rawMention);
      if (role?.enabled) {
        const metadata = toWorkgroupRoleRunMetadata(role);
        if (!roleMentions.some((mention) => mention.roleHandle === metadata.roleHandle)) {
          roleMentions.push(metadata);
        }
        const adapter = adapterForRole(role, options.availableAgents);
        if (adapter) {
          addRoleMention(participants, participantKeys, adapter, metadata);
        }
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

function adapterForRole(
  role: WorkgroupRole,
  availableAgents: readonly AgentId[] | undefined
): AgentId | undefined {
  if (role.executor.kind !== "agent_adapter") {
    return undefined;
  }
  const agentId = toAgentId(role.executor.adapterKind);
  return agentId && isAvailableAgent(agentId, availableAgents) ? agentId : undefined;
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

function isAvailableAgent(
  agentId: AgentId,
  availableAgents: readonly AgentId[] | undefined
): boolean {
  return availableAgents === undefined || availableAgents.includes(agentId);
}
