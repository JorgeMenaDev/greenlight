import type { EnvironmentProfile, EnvironmentProfileId } from "@greenlight/contracts";

import { ProfileCredentials } from "./ProfileCredentials.tsx";
import type { EnvironmentProfileDraft } from "./profileDraft.ts";

export const ProfileEditor = ({
  draft,
  editingId,
  editingProfile,
  authRef,
  hasCredentials,
  credentialDraft,
  deleteLocalCredentials,
  saving,
  onDraftChange,
  onCredentialDraftChange,
  onDeleteLocalCredentialsChange,
  onSaveProfile,
  onSelectProfile,
  onDeleteProfile,
  onSaveCredentials,
  onDeleteCredentials,
}: {
  readonly draft: EnvironmentProfileDraft;
  readonly editingId: EnvironmentProfileId | undefined;
  readonly editingProfile: EnvironmentProfile | undefined;
  readonly authRef: string;
  readonly hasCredentials: boolean;
  readonly credentialDraft: { readonly username: string; readonly password: string };
  readonly deleteLocalCredentials: boolean;
  readonly saving: boolean;
  readonly onDraftChange: (draft: EnvironmentProfileDraft) => void;
  readonly onCredentialDraftChange: (draft: { username: string; password: string }) => void;
  readonly onDeleteLocalCredentialsChange: (value: boolean) => void;
  readonly onSaveProfile: () => void;
  readonly onSelectProfile: (id: EnvironmentProfileId) => void;
  readonly onDeleteProfile: () => void;
  readonly onSaveCredentials: () => void;
  readonly onDeleteCredentials: () => void;
}) => (
  <section className="profile-editor-panel">
    <label className="toolbar-field">
      <span className="toolbar-label">Name</span>
      <input
        type="text"
        className="text-input"
        value={draft.name}
        placeholder="Staging"
        onChange={(event) => {
          onDraftChange({ ...draft, name: event.target.value });
        }}
      />
    </label>

    <label className="toolbar-field">
      <span className="toolbar-label">Target URL</span>
      <input
        type="url"
        className="text-input"
        value={draft.targetUrl}
        placeholder="https://staging.example.com"
        spellCheck={false}
        onChange={(event) => {
          onDraftChange({ ...draft, targetUrl: event.target.value });
        }}
      />
    </label>

    <label className="toolbar-field">
      <span className="toolbar-label">Notes</span>
      <textarea
        className="text-input text-area"
        value={draft.notes}
        placeholder="Optional team notes"
        onChange={(event) => {
          onDraftChange({ ...draft, notes: event.target.value });
        }}
      />
    </label>

    <label className="toolbar-field">
      <span className="toolbar-label">Authentication reference</span>
      <input
        type="text"
        className="text-input"
        value={draft.authRef}
        placeholder="staging-basic-auth"
        spellCheck={false}
        onChange={(event) => {
          onDraftChange({ ...draft, authRef: event.target.value });
        }}
      />
    </label>

    {authRef !== "" && (
      <ProfileCredentials
        hasCredentials={hasCredentials}
        credentialDraft={credentialDraft}
        saving={saving}
        onCredentialDraftChange={onCredentialDraftChange}
        onSaveCredentials={onSaveCredentials}
        onDeleteCredentials={onDeleteCredentials}
      />
    )}

    {editingId !== undefined && authRef !== "" && hasCredentials && (
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={deleteLocalCredentials}
          onChange={(event) => {
            onDeleteLocalCredentialsChange(event.target.checked);
          }}
        />
        Also delete local credentials if this profile is deleted
      </label>
    )}

    <footer className="profile-editor-actions">
      <button type="button" className="btn btn-primary" disabled={saving} onClick={onSaveProfile}>
        Save profile
      </button>
      {editingId !== undefined && (
        <>
          <button
            type="button"
            className="btn"
            disabled={saving}
            onClick={() => {
              onSelectProfile(editingId);
            }}
          >
            Select profile
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={saving}
            onClick={onDeleteProfile}
          >
            Delete profile
          </button>
        </>
      )}
    </footer>
    {editingProfile === undefined && editingId !== undefined && (
      <div className="profile-list-empty">This profile is no longer available.</div>
    )}
  </section>
);
