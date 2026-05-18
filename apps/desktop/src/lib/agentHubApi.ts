import type { AgentHubApi } from "./types";

declare global {
  interface Window {
    agentHub: AgentHubApi;
  }
}

export const agentHubApi: AgentHubApi = window.agentHub;
