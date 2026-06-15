/**
 * Run rendering: scenario list with per-step rows. Used live (fed by the
 * run store) and statically from history (runs.get snapshots).
 */
import {
  sumUsage,
  type Run,
  type RunStatus,
  type StepStatus,
  type Usage,
} from "@greenlight/contracts";
import type { StepActivity, StepSelection } from "../stores/runStore.ts";

import { formatDuration, formatPremium, formatTokens } from "../lib/format.ts";
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

/** Tokens + premium request cost for a Scenario or a derived Run total. */
export const UsageSummary = ({ usage }: { usage: Usage }) => (
  <span
    className="usage-summary"
    title={
      `${usage.inputTokens} input tokens · ${usage.outputTokens} output tokens · ` +
      `${usage.premiumRequestCost} premium requests`
    }
  >
    <span className="usage-tokens">
      {formatTokens(usage.inputTokens)} in / {formatTokens(usage.outputTokens)} out
    </span>
    <span className="usage-premium">{formatPremium(usage.premiumRequestCost)} premium</span>
  </span>
);

export interface RunViewProps {
  run: Run;
  live: boolean;
  activity: Readonly<Record<string, StepActivity>>;
  selectedStep: StepSelection | undefined;
  onSelectStep: (selection: StepSelection | undefined) => void;
}

export const RunView = ({ run, live, activity, selectedStep, onSelectStep }: RunViewProps) => {
  const totalUsage = sumUsage(run.scenarios);
  return (
    <div className="run-view">
      <div className="run-view-head">
        <RunStatusBadge status={run.status} />
        <span className="run-view-target" title={run.baseUrl}>
          {run.environmentProfileName !== undefined && (
            <span className="run-view-profile">{run.environmentProfileName}</span>
          )}
          {run.baseUrl}
        </span>
        {totalUsage !== undefined && <UsageSummary usage={totalUsage} />}
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
              {scenario.usage !== undefined && <UsageSummary usage={scenario.usage} />}
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
};
