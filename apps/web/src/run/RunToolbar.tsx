/**
 * Run configuration toolbar: target URL (persisted per project), optional
 * basic-auth credentials, Copilot model picker, Run feature / Cancel buttons.
 */
import { useState } from "react";

import type { EnvironmentProfileId } from "@greenlight/contracts";

import { useAppStore } from "../stores/appStore.ts";
import { useRunConfigStore } from "../stores/runConfigStore.ts";
import { startRunWithConfig, useRunStore } from "../stores/runStore.ts";
import { EnvironmentProfileModal } from "./environmentProfiles/EnvironmentProfileModal.tsx";

export const RunToolbar = () => {
  const models = useAppStore((state) => state.models);
  const selectedFeaturePath = useAppStore((state) => state.selectedFeaturePath);
  const environmentProfiles = useRunConfigStore((state) => state.environmentProfiles);
  const targetSelection = useRunConfigStore((state) => state.targetSelection);
  const selectAdHocTarget = useRunConfigStore((state) => state.selectAdHocTarget);
  const selectEnvironmentProfile = useRunConfigStore((state) => state.selectEnvironmentProfile);
  const credentialStatus = useRunConfigStore((state) => state.localAuthCredentialStatus);
  const adHocTargetUrl = useRunConfigStore((state) => state.adHocTargetUrl);
  const setAdHocTargetUrl = useRunConfigStore((state) => state.setAdHocTargetUrl);
  const authUsername = useRunConfigStore((state) => state.adHocAuthUsername);
  const setAuthUsername = useRunConfigStore((state) => state.setAdHocAuthUsername);
  const authPassword = useRunConfigStore((state) => state.adHocAuthPassword);
  const setAuthPassword = useRunConfigStore((state) => state.setAdHocAuthPassword);
  const model = useRunConfigStore((state) => state.model);
  const setModel = useRunConfigStore((state) => state.setModel);

  const live = useRunStore((state) => state.live);
  const starting = useRunStore((state) => state.starting);
  const cancelRun = useRunStore((state) => state.cancelRun);

  const [profileModalOpen, setProfileModalOpen] = useState(false);

  const busy = live || starting;
  const selectedProfileId =
    targetSelection.kind === "environmentProfile"
      ? targetSelection.environmentProfileId
      : undefined;
  const selectedProfile = environmentProfiles.find((profile) => profile.id === selectedProfileId);
  const selectedAuthRef = selectedProfile?.authRef;
  const targetUrl = selectedProfile?.targetUrl ?? adHocTargetUrl;
  const selectedProfileHasCredentials =
    selectedAuthRef !== undefined && credentialStatus[selectedAuthRef] === true;
  const selectedProfileMissingCredentials =
    selectedAuthRef !== undefined && !selectedProfileHasCredentials;

  return (
    <div className="run-toolbar">
      <div className="toolbar-target-group toolbar-grow">
        <div className="toolbar-profile-row">
          <label className="toolbar-field toolbar-profile-field">
            <span className="toolbar-label">Environment profile</span>
            <select
              className="select-input"
              value={selectedProfileId ?? ""}
              onChange={(event) => {
                if (event.target.value === "") {
                  selectAdHocTarget();
                } else {
                  selectEnvironmentProfile(event.target.value as EnvironmentProfileId);
                }
              }}
            >
              <option value="">Ad-hoc target</option>
              {environmentProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setProfileModalOpen(true);
            }}
          >
            Manage profiles
          </button>
        </div>
        <label className="toolbar-field">
          <span className="toolbar-label">Target URL</span>
          <input
            type="url"
            className="text-input"
            placeholder="https://staging.example.com"
            value={targetUrl}
            spellCheck={false}
            readOnly={selectedProfile !== undefined}
            onChange={(event) => {
              setAdHocTargetUrl(event.target.value);
            }}
          />
        </label>
        {selectedProfile === undefined ? (
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
        ) : selectedAuthRef !== undefined ? (
          <div
            className={
              selectedProfileMissingCredentials
                ? "toolbar-profile-auth toolbar-profile-auth-missing"
                : "toolbar-profile-auth"
            }
          >
            <span>{selectedAuthRef}</span>
            <span>
              {selectedProfileHasCredentials
                ? "local credentials saved"
                : "local credentials missing"}
            </span>
          </div>
        ) : null}
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
      {profileModalOpen && (
        <EnvironmentProfileModal
          onClose={() => {
            setProfileModalOpen(false);
          }}
        />
      )}
    </div>
  );
};
