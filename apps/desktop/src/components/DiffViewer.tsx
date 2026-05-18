import type { DiffSummary } from "../lib/types";

interface DiffViewerProps {
  diff: DiffSummary;
}

export function DiffViewer({ diff }: DiffViewerProps): JSX.Element {
  return (
    <div className="diff-viewer">
      <div className="review-section-head">
        <div>
          <div className="panel-label">Changed Files</div>
          <p className="muted-copy">
            {diff.files.length} files, +{totalAdditions(diff)}/-{totalDeletions(diff)}
          </p>
        </div>
        {diff.truncated ? <span className="warning-pill">Truncated</span> : null}
      </div>

      {diff.files.length === 0 ? (
        <p className="muted-copy">{diff.message ?? "No changed files recorded."}</p>
      ) : (
        <ul className="file-list">
          {diff.files.map((file) => (
            <li key={file.path}>
              <span className={`file-status ${file.status}`}>{file.status}</span>
              <strong>{file.path}</strong>
              <em>+{file.additions}/-{file.deletions}</em>
            </li>
          ))}
        </ul>
      )}

      <pre className="diff-block">
        {diff.patch?.trim() || diff.message || "Unified diff is not available for this run."}
      </pre>
      {diff.truncated ? (
        <p className="muted-copy">
          Showing {diff.patchBytes ?? 0} of {diff.originalPatchBytes ?? 0} patch
          characters.
        </p>
      ) : null}
    </div>
  );
}

function totalAdditions(diff: DiffSummary): number {
  return diff.files.reduce((sum, file) => sum + file.additions, 0);
}

function totalDeletions(diff: DiffSummary): number {
  return diff.files.reduce((sum, file) => sum + file.deletions, 0);
}
