export const IPC_CHANNELS = {
  projectsList: "agent-hub:projects:list",
  projectsOpen: "agent-hub:projects:open",
  runsList: "agent-hub:runs:list",
  runsGet: "agent-hub:runs:get",
  runsCreate: "agent-hub:runs:create",
  runsCancel: "agent-hub:runs:cancel",
  runsSubscribe: "agent-hub:runs:subscribe",
  runsUnsubscribe: "agent-hub:runs:unsubscribe",
  threadsList: "agent-hub:threads:list",
  threadsGet: "agent-hub:threads:get",
  threadsCreate: "agent-hub:threads:create",
  threadsSendMessage: "agent-hub:threads:send-message",
  reviewSummary: "agent-hub:review:summary",
  reviewContext: "agent-hub:review:context",
  reviewDiff: "agent-hub:review:diff",
  reviewRisk: "agent-hub:review:risk",
  reviewVerification: "agent-hub:review:verification",
  reviewLogs: "agent-hub:review:logs",
  reviewHandoff: "agent-hub:review:handoff",
  reviewHandoffOpenWorktree: "agent-hub:review:handoff:open-worktree",
  reviewHandoffCopyValue: "agent-hub:review:handoff:copy-value",
  reviewAccept: "agent-hub:review:accept",
  reviewReject: "agent-hub:review:reject",
  reviewRefresh: "agent-hub:review:refresh",
  comparisonListCandidates: "agent-hub:comparison:list-candidates",
  comparisonListForRun: "agent-hub:comparison:list-for-run",
  comparisonCreate: "agent-hub:comparison:create",
  memoryListProposals: "agent-hub:memory:list-proposals",
  memoryGenerateProposals: "agent-hub:memory:generate-proposals",
  memoryApprove: "agent-hub:memory:approve",
  memoryIgnore: "agent-hub:memory:ignore",
  settingsGetVerification: "agent-hub:settings:get-verification",
  settingsSaveVerification: "agent-hub:settings:save-verification"
} as const;

export function runEventChannel(runId: string): string {
  return `agent-hub:runs:event:${runId}`;
}
