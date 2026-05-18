import { useEffect, useState } from "react";
import { agentHubApi } from "../lib/agentHubApi";
import type { DiffSummary } from "../lib/types";

interface DiffViewerProps {
  runId: string;
  initialChangedFiles: string[];
}

export function DiffViewer({
  runId,
  initialChangedFiles
}: DiffViewerProps): JSX.Element {
  const [diff, setDiff] = useState<DiffSummary | undefined>();

  useEffect(() => {
    let active = true;
    void agentHubApi.review.getDiff(runId).then((summary) => {
      if (active) {
        setDiff(summary);
      }
    });
    return () => {
      active = false;
    };
  }, [runId]);

  const changedFiles = diff?.changedFiles ?? initialChangedFiles;

  return (
    <div className="diff-viewer">
      <div className="panel-label">Changed Files</div>
      {changedFiles.length === 0 ? (
        <p className="muted-copy">No changed files recorded.</p>
      ) : (
        <ul className="file-list">
          {changedFiles.map((file) => (
            <li key={file}>{file}</li>
          ))}
        </ul>
      )}
      <div className="diff-stat">
        {diff
          ? `${diff.stat.filesChanged} files, +${diff.stat.insertions}/-${diff.stat.deletions}`
          : "Loading diff..."}
      </div>
      <pre className="diff-block">
        {diff?.unifiedDiff.trim() ||
          "Unified diff is not available for this run yet."}
      </pre>
      {diff?.truncated ? (
        <p className="muted-copy">Diff preview was truncated.</p>
      ) : null}
    </div>
  );
}
