/**
 * Detail panel for a selected step: verdict, expected vs actual on failure,
 * agent summary and screenshot evidence.
 */
import type { Run } from "@greenlight/contracts";

import { formatDuration } from "../lib/format.ts";
import { evidenceUrl } from "../rpc/client.ts";
import type { StepSelection } from "../stores/runStore.ts";
import { StatusIcon } from "./RunView.tsx";

export interface StepDetailProps {
  run: Run;
  selection: StepSelection;
  onClose: () => void;
}

export const StepDetail = ({ run, selection, onClose }: StepDetailProps) => {
  const scenario = run.scenarios.find((entry) => entry.pickleId === selection.pickleId);
  const step = scenario?.steps.find((entry) => entry.index === selection.stepIndex);

  if (scenario === undefined || step === undefined) {
    return null;
  }

  const screenshots = step.evidence.filter((entry) => entry.kind === "screenshot");
  const otherEvidence = step.evidence.filter((entry) => entry.kind !== "screenshot");
  const duration = formatDuration(step.startedAt, step.finishedAt);

  return (
    <div className="step-detail">
      <header className="step-detail-head">
        <StatusIcon status={step.status} />
        <span className="step-detail-title">
          <span className="run-step-keyword">{step.keyword}</span> {step.text}
        </span>
        {duration !== null && <span className="run-step-duration">{duration}</span>}
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close detail">
          ×
        </button>
      </header>

      <div className="step-detail-body">
        {step.agentSummary !== undefined && (
          <section className="detail-section">
            <h4>Agent summary</h4>
            <p>{step.agentSummary}</p>
          </section>
        )}

        {step.status === "failed" && (step.expected !== undefined || step.actual !== undefined) && (
          <section className="detail-section detail-compare">
            {step.expected !== undefined && (
              <div className="compare-block compare-expected">
                <h4>Expected</h4>
                <p>{step.expected}</p>
              </div>
            )}
            {step.actual !== undefined && (
              <div className="compare-block compare-actual">
                <h4>Actual</h4>
                <p>{step.actual}</p>
              </div>
            )}
          </section>
        )}

        {step.errorMessage !== undefined && (
          <section className="detail-section">
            <h4>Error</h4>
            <pre className="detail-error">{step.errorMessage}</pre>
          </section>
        )}

        {screenshots.length > 0 && (
          <section className="detail-section">
            <h4>Screenshots</h4>
            <div className="screenshot-grid">
              {screenshots.map((entry) => (
                <a
                  key={entry.id}
                  href={evidenceUrl(entry.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="screenshot-link"
                  title={entry.label}
                >
                  <img src={evidenceUrl(entry.id)} alt={entry.label} loading="lazy" />
                  <span className="screenshot-label">{entry.label}</span>
                </a>
              ))}
            </div>
          </section>
        )}

        {otherEvidence.length > 0 && (
          <section className="detail-section">
            <h4>Evidence</h4>
            <ul className="evidence-list">
              {otherEvidence.map((entry) => (
                <li key={entry.id}>
                  <a href={evidenceUrl(entry.id)} target="_blank" rel="noreferrer">
                    {entry.kind}: {entry.label}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
};
