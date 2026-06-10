/**
 * Sidebar listing the project's .feature files with create/delete/select.
 */
import { useState } from "react";

import { relativeTime } from "../lib/format.ts";
import { useAppStore } from "../stores/appStore.ts";

export const FeatureSidebar = () => {
  const features = useAppStore((state) => state.features);
  const featuresError = useAppStore((state) => state.featuresError);
  const selectedFeaturePath = useAppStore((state) => state.selectedFeaturePath);
  const selectFeature = useAppStore((state) => state.selectFeature);
  const createFeature = useAppStore((state) => state.createFeature);
  const deleteFeature = useAppStore((state) => state.deleteFeature);
  const loadFeatures = useAppStore((state) => state.loadFeatures);

  const [actionError, setActionError] = useState<string | undefined>(undefined);

  const onCreate = async () => {
    const name = window.prompt("New feature name", "my-feature");
    if (name === null || name.trim() === "") return;
    setActionError(undefined);
    const failure = await createFeature(name.trim());
    if (failure !== null) setActionError(failure);
  };

  const onDelete = async (path: string) => {
    if (!window.confirm(`Delete ${path}? This cannot be undone.`)) return;
    setActionError(undefined);
    const failure = await deleteFeature(path);
    if (failure !== null) setActionError(failure);
  };

  return (
    <aside className="feature-sidebar">
      <div className="sidebar-head">
        <h2>Features</h2>
        <div className="sidebar-actions">
          <button
            type="button"
            className="icon-button"
            title="Refresh"
            onClick={() => {
              void loadFeatures();
            }}
          >
            ⟳
          </button>
          <button
            type="button"
            className="icon-button"
            title="New feature file"
            onClick={() => {
              void onCreate();
            }}
          >
            +
          </button>
        </div>
      </div>

      {featuresError !== undefined && <div className="banner banner-error">{featuresError}</div>}
      {actionError !== undefined && <div className="banner banner-error">{actionError}</div>}

      {features.length === 0 ? (
        <div className="sidebar-empty">
          <p className="muted">No .feature files yet.</p>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              void onCreate();
            }}
          >
            Create your first feature
          </button>
        </div>
      ) : (
        <ul className="feature-list">
          {features.map((entry) => (
            <li
              key={entry.path}
              className={
                entry.path === selectedFeaturePath
                  ? "feature-item feature-item-active"
                  : "feature-item"
              }
            >
              <button
                type="button"
                className="feature-item-main"
                title={entry.path}
                onClick={() => {
                  selectFeature(entry.path);
                }}
              >
                <span className="feature-name">{entry.name}</span>
                <span className="feature-meta">{relativeTime(entry.modifiedAt)}</span>
              </button>
              <button
                type="button"
                className="icon-button feature-delete"
                title={`Delete ${entry.path}`}
                onClick={() => {
                  void onDelete(entry.path);
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
};
