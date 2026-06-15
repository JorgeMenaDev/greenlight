/**
 * Static view of a past run, rendered with the same components as the
 * live run panel.
 */
import type { Run, RunId } from "@greenlight/contracts";
import { useEffect, useState } from "react";

import { absoluteTime, baseName } from "../lib/format.ts";
import { errorMessage, rpc } from "../rpc/client.ts";
import { RunView } from "../run/RunView.tsx";
import { StepDetail } from "../run/StepDetail.tsx";
import type { StepSelection } from "../stores/runStore.ts";

export interface RunDetailViewProps {
  runId: RunId;
  onBack: () => void;
}

export const RunDetailView = ({ runId, onBack }: RunDetailViewProps) => {
  const [run, setRun] = useState<Run | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [selection, setSelection] = useState<StepSelection | undefined>(undefined);

  useEffect(() => {
    let stale = false;
    setRun(undefined);
    setError(undefined);
    setSelection(undefined);
    void rpc("runs.get", { runId })
      .then((loaded) => {
        if (!stale) setRun(loaded);
      })
      .catch((failure: unknown) => {
        if (!stale) setError(errorMessage(failure));
      });
    return () => {
      stale = true;
    };
  }, [runId]);

  return (
    <div className="run-detail-view">
      <div className="run-detail-bar">
        <button type="button" className="link-button" onClick={onBack}>
          ← Back to history
        </button>
        {run !== undefined && (
          <span className="run-detail-meta" title={run.featurePath}>
            {baseName(run.featurePath)} · {absoluteTime(run.createdAt)}
            {run.model !== undefined ? ` · ${run.model}` : ""}
          </span>
        )}
      </div>

      {error !== undefined && <div className="banner banner-error">{error}</div>}
      {run === undefined && error === undefined && (
        <div className="panel-empty pulse">Loading…</div>
      )}

      {run !== undefined && (
        <div className="run-detail-content">
          <RunView
            run={run}
            live={false}
            activity={{}}
            selectedStep={selection}
            onSelectStep={setSelection}
          />
          {selection !== undefined && (
            <StepDetail
              run={run}
              selection={selection}
              onClose={() => {
                setSelection(undefined);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
};
