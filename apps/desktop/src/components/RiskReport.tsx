import type { RiskFinding, RiskReport as RiskReportType } from "../lib/types";

interface RiskReportProps {
  report: RiskReportType;
}

const severities = ["blocking", "high", "medium", "low"] as const;

export function RiskReport({ report }: RiskReportProps): JSX.Element {
  return (
    <div className="risk-report">
      <div className="review-section-head">
        <div>
          <div className={`risk-level ${report.level}`}>{report.level}</div>
          <p>{report.message ?? `${report.findings.length} finding(s) detected.`}</p>
        </div>
      </div>

      {report.findings.length === 0 ? (
        <p className="muted-copy">No evidence-based risk findings for this run.</p>
      ) : (
        severities.map((severity) => {
          const findings = report.findings.filter(
            (finding) => finding.severity === severity
          );
          if (findings.length === 0) {
            return null;
          }
          return (
            <section key={severity} className="risk-group">
              <div className="panel-label">{severity}</div>
              <ul className="finding-list">
                {findings.map((finding) => (
                  <FindingItem key={finding.id} finding={finding} />
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}

function FindingItem({ finding }: { finding: RiskFinding }): JSX.Element {
  return (
    <li>
      <strong>{finding.title}</strong>
      <span>{finding.description}</span>
      {finding.filePath ? <p>{finding.filePath}</p> : null}
      {finding.evidence && finding.evidence !== finding.description ? (
        <p>{finding.evidence}</p>
      ) : null}
    </li>
  );
}
