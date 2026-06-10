/**
 * Project selection: recent projects plus open-by-path. Uses the Electron
 * folder picker when available, falls back to a plain path input.
 */
import { useEffect, useState } from "react";

import { baseName, relativeTime } from "../lib/format.ts";
import { rpc } from "../rpc/client.ts";
import { useAppStore } from "../stores/appStore.ts";
import type { RecentProject } from "@greenlight/contracts";

export const ProjectPicker = () => {
  const openProject = useAppStore((state) => state.openProject);
  const [recent, setRecent] = useState<ReadonlyArray<RecentProject>>([]);
  const [pathInput, setPathInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const hasDesktopPicker = window.greenlightDesktop?.pickFolder !== undefined;

  useEffect(() => {
    let stale = false;
    void rpc("project.recent", {})
      .then((entries) => {
        if (!stale) setRecent(entries);
      })
      .catch(() => {
        // recents are best-effort
      });
    return () => {
      stale = true;
    };
  }, []);

  const open = async (path: string) => {
    const trimmed = path.trim();
    if (trimmed === "" || busy) return;
    setBusy(true);
    setError(undefined);
    const failure = await openProject(trimmed);
    setBusy(false);
    if (failure !== null) setError(failure);
  };

  const pickFolder = async () => {
    const picker = window.greenlightDesktop?.pickFolder;
    if (picker === undefined) return;
    const picked = await picker();
    if (picked !== null) {
      await open(picked);
    }
  };

  return (
    <div className="project-picker">
      <div className="project-picker-inner">
        <h1>Open a project</h1>
        <p className="muted">
          A project is any folder containing <code>.feature</code> files. Greenlight watches it and
          runs scenarios against your target URL.
        </p>

        {error !== undefined && <div className="banner banner-error">{error}</div>}

        <div className="open-row">
          {hasDesktopPicker ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => {
                void pickFolder();
              }}
            >
              Choose folder…
            </button>
          ) : (
            <form
              className="open-form"
              onSubmit={(event) => {
                event.preventDefault();
                void open(pathInput);
              }}
            >
              <input
                type="text"
                className="text-input"
                placeholder="/path/to/your/project"
                value={pathInput}
                spellCheck={false}
                onChange={(event) => {
                  setPathInput(event.target.value);
                }}
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={busy || pathInput.trim() === ""}
              >
                {busy ? "Opening…" : "Open"}
              </button>
            </form>
          )}
        </div>

        {recent.length > 0 && (
          <section className="recent-section">
            <h2>Recent</h2>
            <ul className="recent-list">
              {recent.map((entry) => (
                <li key={entry.path}>
                  <button
                    type="button"
                    className="recent-item"
                    disabled={busy}
                    onClick={() => {
                      void open(entry.path);
                    }}
                  >
                    <span className="recent-name">{baseName(entry.path)}</span>
                    <span className="recent-path" title={entry.path}>
                      {entry.path}
                    </span>
                    <span className="recent-time">{relativeTime(entry.lastOpenedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
};
