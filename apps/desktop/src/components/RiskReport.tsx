import type { RiskReport as RiskReportType } from "../lib/types";

interface RiskReportProps {
  report: RiskReportType;
}

export function RiskReport({ report }: RiskReportProps): JSX.Element {
  return (
    <div className="risk-report">
      <div className={`risk-level ${report.level}`}>{report.level}</div>
      <p>{report.summary}</p>
      <section>
        <div className="panel-label">Findings</div>
        {report.findings.length === 0 ? (
          <p className="muted-copy">No findings recorded.</p>
        ) : (
          <ul className="finding-list">
            {report.findings.map((finding, index) => (
              <li key={`${finding.summary}-${index}`}>
                <strong>{finding.level}</strong>
                <span>{finding.summary}</span>
                {finding.details ? <p>{finding.details}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <div className="panel-label">Manual Review</div>
        <ul className="check-list">
          {report.manualReviewChecklist.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      <section>
        <div className="panel-label">Recommendation</div>
        <p className="muted-copy">{report.acceptanceRecommendation}</p>
      </section>
    </div>
  );
}
