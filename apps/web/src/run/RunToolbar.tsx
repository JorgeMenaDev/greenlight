/**
 * Run configuration toolbar: target URL (persisted per project), optional
 * basic-auth credentials, Copilot model picker, Run feature / Cancel buttons.
 */
import { useAppStore } from "../stores/appStore.ts";
import { startRunWithConfig, useRunStore } from "../stores/runStore.ts";

export const RunToolbar = () => {
  const targetUrl = useAppStore((state) => state.targetUrl);
  const setTargetUrl = useAppStore((state) => state.setTargetUrl);
  const authUsername = useAppStore((state) => state.authUsername);
  const setAuthUsername = useAppStore((state) => state.setAuthUsername);
  const authPassword = useAppStore((state) => state.authPassword);
  const setAuthPassword = useAppStore((state) => state.setAuthPassword);
  const models = useAppStore((state) => state.models);
  const model = useAppStore((state) => state.model);
  const setModel = useAppStore((state) => state.setModel);
  const selectedFeaturePath = useAppStore((state) => state.selectedFeaturePath);

  const live = useRunStore((state) => state.live);
  const starting = useRunStore((state) => state.starting);
  const cancelRun = useRunStore((state) => state.cancelRun);

  const busy = live || starting;

  return (
    <div className="run-toolbar">
      <div className="toolbar-target-group toolbar-grow">
        <label className="toolbar-field">
          <span className="toolbar-label">Target URL</span>
          <input
            type="url"
            className="text-input"
            placeholder="https://staging.example.com"
            value={targetUrl}
            spellCheck={false}
            onChange={(event) => {
              setTargetUrl(event.target.value);
            }}
          />
        </label>
        <div className="toolbar-auth-row">
          <label className="toolbar-field">
            <span className="toolbar-label">Basic auth username</span>
            <input
              type="text"
              className="text-input"
              placeholder="Optional"
              value={authUsername}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setAuthUsername(event.target.value);
              }}
            />
          </label>
          <label className="toolbar-field">
            <span className="toolbar-label">Basic auth password</span>
            <input
              type="password"
              className="text-input"
              placeholder="Optional"
              value={authPassword}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setAuthPassword(event.target.value);
              }}
            />
          </label>
        </div>
      </div>

      {models.length > 0 && (
        <label className="toolbar-field">
          <span className="toolbar-label">Model</span>
          <select
            className="select-input"
            value={model}
            onChange={(event) => {
              setModel(event.target.value);
            }}
          >
            <option value="">Server default</option>
            {models.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {busy ? (
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => {
            void cancelRun();
          }}
        >
          Cancel run
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-primary"
          disabled={selectedFeaturePath === undefined}
          title={
            selectedFeaturePath === undefined
              ? "Select a feature file first"
              : "Run every scenario in this feature"
          }
          onClick={() => {
            startRunWithConfig();
          }}
        >
          ▶ Run feature
        </button>
      )}
    </div>
  );
};
