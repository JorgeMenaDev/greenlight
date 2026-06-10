/**
 * Run history: list of past runs with status badges and relative time;
 * selecting one opens a static RunDetailView.
 */
import type { RunId, RunSummary } from "@greenlight/contracts";
import { useCallback, useEffect, useState } from "react";

import { baseName, relativeTime } from "../lib/format.ts";
import { errorMessage, rpc } from "../rpc/client.ts";
import { RunStatusBadge } from "../run/RunView.tsx";
import { RunDetailView } from "./RunDetailView.tsx";

export const HistoryList = () => {
  const [runs, setRuns] = useState<ReadonlyArray<RunSummary>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [selectedRunId, setSelectedRunId] = useState<RunId | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const entries = await rpc("runs.list", { limit: 100 });
      setRuns(entries);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onDelete = async (runId: RunId) => {
    if (!window.confirm("Delete this run and its evidence?")) return;
    try {
      await rpc("runs.delete", { runId });
      setRuns((current) => current.filter((entry) => entry.runId !== runId));
      if (selectedRunId === runId) setSelectedRunId(undefined);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  if (selectedRunId !== undefined) {
    return (
      <RunDetailView
        runId={selectedRunId}
        onBack={() => {
          setSelectedRunId(undefined);
        }}
      />
    );
  }

  return (
    <div className="history-view">
      <div className="history-head">
        <h1>Run history</h1>
        <button
          type="button"
          className="icon-button"
          title="Refresh"
          onClick={() => {
            void load();
          }}
        >
          ⟳
        </button>
      </div>

      {error !== undefined && <div className="banner banner-error">{error}</div>}

      {loading && runs.length === 0 ? (
        <div className="panel-empty pulse">Loading…</div>
      ) : runs.length === 0 ? (
        <div className="panel-empty">
          <p>No runs yet.</p>
          <p className="muted">Run a feature from the workspace to see results here.</p>
        </div>
      ) : (
        <ul className="history-list">
          {runs.map((entry) => {
            const counts = entry.scenarioCounts;
            return (
              <li key={entry.runId} className="history-item">
                <button
                  type="button"
                  className="history-item-main"
                  onClick={() => {
                    setSelectedRunId(entry.runId);
                  }}
                >
                  <RunStatusBadge status={entry.status} />
                  <span className="history-feature" title={entry.featurePath}>
                    {baseName(entry.featurePath)}
                  </span>
                  <span className="history-target" title={entry.baseUrl}>
                    {entry.baseUrl}
                  </span>
                  <span className="history-counts">
                    {counts.passed > 0 && (
                      <span className="count count-passed">{counts.passed} passed</span>
                    )}
                    {counts.failed > 0 && (
                      <span className="count count-failed">{counts.failed} failed</span>
                    )}
                    {counts.skipped > 0 && (
                      <span className="count count-skipped">{counts.skipped} skipped</span>
                    )}
                  </span>
                  <span className="history-time">{relativeTime(entry.createdAt)}</span>
                </button>
                <button
                  type="button"
                  className="icon-button"
                  title="Delete run"
                  onClick={() => {
                    void onDelete(entry.runId);
                  }}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
