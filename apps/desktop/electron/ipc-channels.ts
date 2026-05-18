export const IPC_CHANNELS = {
  projectsList: "agent-hub:projects:list",
  projectsOpen: "agent-hub:projects:open",
  runsList: "agent-hub:runs:list",
  runsGet: "agent-hub:runs:get",
  runsCreate: "agent-hub:runs:create",
  runsCancel: "agent-hub:runs:cancel",
  runsSubscribe: "agent-hub:runs:subscribe",
  runsUnsubscribe: "agent-hub:runs:unsubscribe",
  reviewDiff: "agent-hub:review:diff",
  reviewRisk: "agent-hub:review:risk",
  reviewVerification: "agent-hub:review:verification",
  memoryListProposals: "agent-hub:memory:list-proposals",
  memoryApprove: "agent-hub:memory:approve",
  memoryIgnore: "agent-hub:memory:ignore"
} as const;

export function runEventChannel(runId: string): string {
  return `agent-hub:runs:event:${runId}`;
}
