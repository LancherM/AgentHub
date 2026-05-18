import type { VerificationReport } from "../lib/types";

interface VerificationPanelProps {
  report: VerificationReport;
}

export function VerificationPanel({
  report
}: VerificationPanelProps): JSX.Element {
  return (
    <div className="verification-panel">
      <div className={`verification-head ${report.status}`}>
        <span>{report.status}</span>
        <strong>{report.summary}</strong>
      </div>
      {report.results.length === 0 ? (
        <p className="muted-copy">No verification rows recorded.</p>
      ) : (
        <div className="verification-list">
          {report.results.map((result) => (
            <article key={result.id} className="verification-row">
              <div>
                <strong>{result.command}</strong>
                <span>{result.status}</span>
              </div>
              {result.stdout ? <pre>{result.stdout}</pre> : null}
              {result.stderr ? <pre>{result.stderr}</pre> : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
