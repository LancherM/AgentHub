import { useState } from "react";
import type {
  CollaborationWorkflowInput,
  CollaborationWorkflowMode
} from "../../lib/types";

interface WorkflowLauncherProps {
  isBusy: boolean;
  onSubmit(input: string, workflow: CollaborationWorkflowInput): Promise<void>;
}

const modeOptions: Array<{
  id: CollaborationWorkflowMode;
  label: string;
  participants: string;
  maxRounds: number;
  stopCondition: string;
  expectedOutputs: string[];
}> = [
  {
    id: "handoff",
    label: "Handoff",
    participants: "@researcher @writer",
    maxRounds: 1,
    stopCondition: "handoff_summary_recorded",
    expectedOutputs: ["handoff_summary", "linked_run_evidence"]
  },
  {
    id: "review_loop",
    label: "Review Loop",
    participants: "@engineer @reviewer",
    maxRounds: 2,
    stopCondition: "reviewer_passed OR max_rounds_reached",
    expectedOutputs: ["reviewer_findings", "final_summary", "linked_run_evidence"]
  },
  {
    id: "panel_discussion",
    label: "Panel",
    participants: "@researcher @analyst @reviewer",
    maxRounds: 3,
    stopCondition: "all_participants_reported OR max_rounds_reached",
    expectedOutputs: ["participant_findings", "final_synthesis"]
  }
];

export function WorkflowLauncher({
  isBusy,
  onSubmit
}: WorkflowLauncherProps): JSX.Element {
  const [mode, setMode] = useState<CollaborationWorkflowMode>("review_loop");
  const selectedMode = modeOptions.find((option) => option.id === mode) ?? modeOptions[1];
  const [participants, setParticipants] = useState(selectedMode.participants);
  const [maxRounds, setMaxRounds] = useState(selectedMode.maxRounds);
  const [stopCondition, setStopCondition] = useState(selectedMode.stopCondition);
  const [expectedOutputs, setExpectedOutputs] = useState(
    selectedMode.expectedOutputs.join(", ")
  );
  const [prompt, setPrompt] = useState("Review the current implementation plan.");
  const [isExpanded, setIsExpanded] = useState(false);
  const [error, setError] = useState<string | undefined>();

  function selectMode(nextMode: CollaborationWorkflowMode): void {
    const option = modeOptions.find((entry) => entry.id === nextMode) ?? modeOptions[1];
    setMode(nextMode);
    setParticipants(option.participants);
    setMaxRounds(option.maxRounds);
    setStopCondition(option.stopCondition);
    setExpectedOutputs(option.expectedOutputs.join(", "));
  }

  async function startWorkflow(): Promise<void> {
    setError(undefined);
    const taskText = prompt.trim();
    const participantText = participants.trim();
    const outputs = expectedOutputs
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (!taskText || !participantText || outputs.length === 0) {
      setError("Workflow requires participants, scope, and outputs.");
      return;
    }
    try {
      await onSubmit(`${participantText} ${taskText}`, {
        mode,
        maxRounds,
        stopCondition,
        expectedOutputs: outputs,
        summary: taskText
      });
      setIsExpanded(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <section className={`workflow-launcher ${isExpanded ? "expanded" : ""}`}>
      <button
        className="workflow-launcher-summary"
        onClick={() => setIsExpanded((current) => !current)}
        type="button"
      >
        <span>
          <strong>Workflow</strong>
          <small>{selectedMode.label} - max {maxRounds} round(s)</small>
        </span>
        <span className="workflow-start-label">Start</span>
      </button>
      {isExpanded ? (
        <div className="workflow-launcher-body">
          <div className="workflow-mode-tabs">
            {modeOptions.map((option) => (
              <button
                className={mode === option.id ? "active" : ""}
                key={option.id}
                onClick={() => selectMode(option.id)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="workflow-form-grid">
            <label>
              <span>Participants</span>
              <input
                value={participants}
                onChange={(event) => setParticipants(event.target.value)}
              />
            </label>
            <label>
              <span>Max rounds</span>
              <input
                min={1}
                max={mode === "handoff" ? 1 : 3}
                type="number"
                value={maxRounds}
                onChange={(event) => setMaxRounds(Number(event.target.value))}
              />
            </label>
            <label>
              <span>Stop condition</span>
              <input
                value={stopCondition}
                onChange={(event) => setStopCondition(event.target.value)}
              />
            </label>
            <label>
              <span>Expected outputs</span>
              <input
                value={expectedOutputs}
                onChange={(event) => setExpectedOutputs(event.target.value)}
              />
            </label>
            <label className="wide">
              <span>Scope</span>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
              />
            </label>
          </div>
          {error ? <div className="inline-error">{error}</div> : null}
          <div className="workflow-launcher-actions">
            <span className="muted-copy">Local task metadata, no auto-apply.</span>
            <button
              className="primary-button compact"
              disabled={isBusy}
              onClick={() => void startWorkflow()}
              type="button"
            >
              Start Workflow
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
