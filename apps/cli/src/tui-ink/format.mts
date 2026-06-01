import type {
  TuiCurrentContextModel,
  TuiEvidenceSummary,
  TuiRunSummary
} from "@agent-hub/core";

const riskRank = new Map([
  ["low", 0],
  ["medium", 1],
  ["high", 2],
  ["blocking", 3]
]);

export function compactId(id: string): string {
  const match = /^(run|task|call|message|thread)_([0-9a-f]{8})[0-9a-f-]*/i.exec(id);
  if (match) {
    return `${match[1]}_${match[2]}`;
  }
  if (id.length > 18) {
    return `${id.slice(0, 15)}...`;
  }
  return id;
}

export function runStatusLabel(status: TuiRunSummary["status"]): string {
  if (status === "succeeded") {
    return "ok";
  }
  if (status === "failed") {
    return "failed";
  }
  if (status === "running") {
    return "running";
  }
  if (status === "queued") {
    return "queued";
  }
  return "cancelled";
}

export function highestRisk(model: TuiCurrentContextModel): string {
  const levels = [
    ...model.runs.map((run) => run.evidence.risk?.level),
    ...model.roleCalls.nodes.map((node) => node.evidence.risk?.level)
  ].filter((level): level is NonNullable<typeof level> => level !== undefined);
  if (levels.length === 0) {
    return "unknown";
  }
  return levels.sort(
    (left, right) => (riskRank.get(right) ?? -1) - (riskRank.get(left) ?? -1)
  )[0];
}

export function evidenceItems(evidence: TuiEvidenceSummary): string[] {
  const items: string[] = [];
  if (evidence.linkedRunId) {
    items.push(`linked ${compactId(evidence.linkedRunId)}`);
  }
  if (evidence.latestEvent) {
    items.push(`latest ${evidence.latestEvent}`);
  }
  if (evidence.waitingReason) {
    items.push(`waiting ${evidence.waitingReason}`);
  }
  if (evidence.checks) {
    items.push(
      `checks ${evidence.checks.passed}/${evidence.checks.failed}/${evidence.checks.skipped}`
    );
  }
  if (evidence.risk) {
    items.push(
      `risk ${evidence.risk.level}${evidence.risk.primaryReason ? ` - ${evidence.risk.primaryReason}` : ""}`
    );
  }
  if (evidence.diff) {
    items.push(
      `files ${evidence.diff.changedFiles} +${evidence.diff.insertions ?? 0} -${evidence.diff.deletions ?? 0}`
    );
  }
  return items;
}

export function runLine(run: TuiRunSummary, selected: boolean): string {
  const checks = run.evidence.checks
    ? ` checks ${run.evidence.checks.passed}/${run.evidence.checks.failed}/${run.evidence.checks.skipped}`
    : "";
  const risk = run.evidence.risk ? ` risk ${run.evidence.risk.level}` : "";
  const diff = run.evidence.diff ? ` files ${run.evidence.diff.changedFiles}` : "";
  const stage = run.stage !== run.status ? ` ${run.stage}` : "";
  return `${selected ? ">" : " "} ${compactId(run.id)} @${run.agentKind} ${runStatusLabel(run.status)}${stage}${checks}${risk}${diff}`;
}

export function truncateText(value: string, maxLength: number): string {
  if (maxLength <= 0 || value.length <= maxLength) {
    return value;
  }
  if (maxLength <= 3) {
    return value.slice(0, maxLength);
  }
  return `${value.slice(0, maxLength - 3)}...`;
}
