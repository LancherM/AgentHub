import type { VerificationReport } from "../lib/types";

interface VerificationPanelProps {
  report: VerificationReport;
}

export function VerificationPanel({ report }: VerificationPanelProps): JSX.Element {
  return (
    <div className="verification-panel">
      <div className={`verification-head ${report.status}`}>
        <span>{report.status}</span>
        <strong>{report.message ?? "Verification status recorded."}</strong>
      </div>
      {report.commands.length === 0 ? (
        <p className="muted-copy">
          {report.message ?? "No verification rows recorded."}
        </p>
      ) : (
        <div className="verification-list">
          {report.commands.map((result) => (
            <article key={result.command} className="verification-row">
              <div>
                <strong>{result.command}</strong>
                <span>{formatCommandMeta(result)}</span>
              </div>
              {result.stdout ? (
                <pre aria-label={`${result.command} stdout`}>{result.stdout}</pre>
              ) : null}
              {result.stderr ? (
                <pre aria-label={`${result.command} stderr`}>{result.stderr}</pre>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function formatCommandMeta(result: VerificationReport["commands"][number]): string {
  const parts: string[] = [result.status];
  if (result.exitCode !== undefined) {
    parts.push(`exit ${result.exitCode}`);
  }
  if (result.durationMs !== undefined) {
    parts.push(`${result.durationMs}ms`);
  }
  return parts.join(" · ");
}
