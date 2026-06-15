/**
 * Application shell: connection gate, onboarding gate and the three main
 * views (project picker, workspace, history) switched via the app store.
 */
import { useEffect } from "react";

import { FeatureEditor } from "./editor/FeatureEditor.tsx";
import { FeatureSidebar } from "./features/FeatureSidebar.tsx";
import { HistoryList } from "./history/HistoryList.tsx";
import { baseName } from "./lib/format.ts";
import { OnboardingScreen } from "./onboarding/OnboardingScreen.tsx";
import { ProjectPicker } from "./project/ProjectPicker.tsx";
import { serverUrl } from "./rpc/client.ts";
import { RunToolbar } from "./run/RunToolbar.tsx";
import { RunView } from "./run/RunView.tsx";
import { StepDetail } from "./run/StepDetail.tsx";
import { needsOnboarding, useAppStore } from "./stores/appStore.ts";
import { useRunStore } from "./stores/runStore.ts";

const ConnectionGate = () => {
  const connection = useAppStore((state) => state.connection);
  const connectionError = useAppStore((state) => state.connectionError);
  const bootstrap = useAppStore((state) => state.bootstrap);

  return (
    <div className="gate">
      <div className="gate-card">
        <div className="brand brand-large">
          <span className="brand-dot" />
          Greenlight
        </div>
        {connection === "connecting" ? (
          <>
            <p className="gate-status pulse">Connecting to {serverUrl}…</p>
            <p className="gate-hint">Waiting for the Greenlight server.</p>
          </>
        ) : (
          <>
            <p className="gate-status gate-error">Could not connect to the server.</p>
            {connectionError !== undefined && <p className="gate-hint">{connectionError}</p>}
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                void bootstrap();
              }}
            >
              Retry connection
            </button>
          </>
        )}
      </div>
    </div>
  );
};

const RunPanel = () => {
  const run = useRunStore((state) => state.run);
  const live = useRunStore((state) => state.live);
  const starting = useRunStore((state) => state.starting);
  const activity = useRunStore((state) => state.activity);
  const selectedStep = useRunStore((state) => state.selectedStep);
  const selectStep = useRunStore((state) => state.selectStep);
  const runError = useRunStore((state) => state.runError);
  const clearError = useRunStore((state) => state.clearError);

  return (
    <aside className="run-panel">
      {runError !== undefined && (
        <div className="banner banner-error">
          <span>{runError}</span>
          <button
            type="button"
            className="banner-dismiss"
            onClick={clearError}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
      {run === undefined ? (
        <div className="panel-empty">
          {starting ? (
            <p className="pulse">Starting run…</p>
          ) : (
            <>
              <p>No run yet.</p>
              <p className="muted">
                Set a target URL in the toolbar, then run the feature or a single scenario.
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          <RunView
            run={run}
            live={live}
            activity={activity}
            selectedStep={selectedStep}
            onSelectStep={selectStep}
          />
          {selectedStep !== undefined && (
            <StepDetail
              run={run}
              selection={selectedStep}
              onClose={() => {
                selectStep(undefined);
              }}
            />
          )}
        </>
      )}
    </aside>
  );
};

const WorkspaceView = () => (
  <div className="workspace">
    <FeatureSidebar />
    <div className="workspace-main">
      <RunToolbar />
      <FeatureEditor />
    </div>
    <RunPanel />
  </div>
);

const Header = () => {
  const project = useAppStore((state) => state.project);
  const view = useAppStore((state) => state.view);
  const setView = useAppStore((state) => state.setView);

  return (
    <header className="app-header">
      <button
        type="button"
        className="brand brand-button"
        onClick={() => {
          setView("project");
        }}
        title="Switch project"
      >
        <span className="brand-dot" />
        Greenlight
      </button>
      {project !== null && (
        <span className="header-project" title={project.path}>
          {baseName(project.path)}
        </span>
      )}
      <nav className="header-nav">
        <button
          type="button"
          className={view === "workspace" ? "nav-tab nav-tab-active" : "nav-tab"}
          disabled={project === null}
          onClick={() => {
            setView("workspace");
          }}
        >
          Workspace
        </button>
        <button
          type="button"
          className={view === "history" ? "nav-tab nav-tab-active" : "nav-tab"}
          disabled={project === null}
          onClick={() => {
            setView("history");
          }}
        >
          History
        </button>
      </nav>
    </header>
  );
};

export const App = () => {
  const connection = useAppStore((state) => state.connection);
  const view = useAppStore((state) => state.view);
  const showOnboarding = useAppStore(needsOnboarding);
  const bootstrap = useAppStore((state) => state.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (connection !== "connected") {
    return <ConnectionGate />;
  }

  if (showOnboarding) {
    return <OnboardingScreen />;
  }

  return (
    <div className="app-shell">
      <Header />
      <main className="app-main">
        {view === "project" && <ProjectPicker />}
        {view === "workspace" && <WorkspaceView />}
        {view === "history" && <HistoryList />}
      </main>
    </div>
  );
};
