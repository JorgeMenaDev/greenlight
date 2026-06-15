/**
 * Run rendering: scenario list with per-step rows. Used live (fed by the
 * run store) and statically from history (runs.get snapshots).
 */
import type { Run, RunStatus, StepStatus } from "@greenlight/contracts";
import type { StepActivity, StepSelection } from "../stores/runStore.ts";

import { formatDuration } from "../lib/format.ts";
import { activityKey } from "../stores/runStore.ts";

const STEP_ICONS: Record<StepStatus, string> = {
  pending: "○",
  running: "◐",
  passed: "✓",
  failed: "✕",
  skipped: "–",
};

export const StatusIcon = ({ status }: { status: StepStatus }) => (
  <span className={`status-icon status-${status}`} role="img" aria-label={status} title={status}>
    {STEP_ICONS[status]}
  </span>
);

export const RunStatusBadge = ({ status }: { status: RunStatus }) => (
  <span className={`status-badge status-badge-${status}`}>{status}</span>
);

export interface RunViewProps {
  run: Run;
  live: boolean;
  activity: Readonly<Record<string, StepActivity>>;
  selectedStep: StepSelection | undefined;
  onSelectStep: (selection: StepSelection | undefined) => void;
}

export const RunView = ({ run, live, activity, selectedStep, onSelectStep }: RunViewProps) => (
  <div className="run-view">
    <div className="run-view-head">
      <RunStatusBadge status={run.status} />
      <span className="run-view-target" title={run.baseUrl}>
        {run.environmentProfileName !== undefined && (
          <span className="run-view-profile">{run.environmentProfileName}</span>
        )}
        {run.baseUrl}
      </span>
      <span className="run-view-duration">
        {formatDuration(run.startedAt, live ? undefined : run.finishedAt) ?? ""}
      </span>
    </div>

    {run.error !== undefined && <div className="banner banner-error">{run.error}</div>}

    <div className="run-scenarios">
      {run.scenarios.map((scenario) => (
        <section key={scenario.pickleId} className="run-scenario">
          <header className="run-scenario-head">
            <StatusIcon status={scenario.status} />
            <h3 className="run-scenario-name">{scenario.name}</h3>
            <span className="run-scenario-duration">
              {formatDuration(scenario.startedAt, scenario.finishedAt) ?? ""}
            </span>
          </header>
          <ol className="run-steps">
            {scenario.steps.map((step) => {
              const isSelected =
                selectedStep !== undefined &&
                selectedStep.pickleId === scenario.pickleId &&
                selectedStep.stepIndex === step.index;
              const ticker =
                step.status === "running"
                  ? activity[activityKey(scenario.pickleId, step.index)]
                  : undefined;
              return (
                <li key={step.index}>
                  <button
                    type="button"
                    className={isSelected ? "run-step run-step-selected" : "run-step"}
                    onClick={() => {
                      onSelectStep(
                        isSelected
                          ? undefined
                          : { pickleId: scenario.pickleId, stepIndex: step.index },
                      );
                    }}
                  >
                    <StatusIcon status={step.status} />
                    <span className="run-step-text">
                      <span className="run-step-keyword">{step.keyword}</span> {step.text}
                    </span>
                    <span className="run-step-duration">
                      {formatDuration(step.startedAt, step.finishedAt) ?? ""}
                    </span>
                  </button>
                  {ticker !== undefined && (
                    <div className="step-ticker pulse" title={ticker.summary}>
                      {ticker.tool !== undefined && (
                        <span className="step-ticker-tool">{ticker.tool}</span>
                      )}
                      {ticker.summary}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  </div>
);
