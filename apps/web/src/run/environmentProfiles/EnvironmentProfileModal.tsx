/**
 * Project environment profile management.
 */
import type { EnvironmentProfile, EnvironmentProfileId } from "@greenlight/contracts";
import { useState } from "react";

import { useRunConfigStore } from "../../stores/runConfigStore.ts";
import "./EnvironmentProfileModal.css";
import { ProfileEditor } from "./ProfileEditor.tsx";
import { ProfileList } from "./ProfileList.tsx";
import { blankDraft, draftFromProfile } from "./profileDraft.ts";

const emptyCredentials = { username: "", password: "" };

export const EnvironmentProfileModal = ({ onClose }: { onClose: () => void }) => {
  const profiles = useRunConfigStore((state) => state.environmentProfiles);
  const profilesError = useRunConfigStore((state) => state.environmentProfilesError);
  const adHocTargetUrl = useRunConfigStore((state) => state.adHocTargetUrl);
  const targetSelection = useRunConfigStore((state) => state.targetSelection);
  const credentialStatus = useRunConfigStore((state) => state.localAuthCredentialStatus);
  const saveProfile = useRunConfigStore((state) => state.saveEnvironmentProfile);
  const deleteProfile = useRunConfigStore((state) => state.deleteEnvironmentProfile);
  const saveCredentials = useRunConfigStore((state) => state.saveLocalAuthCredentials);
  const deleteCredentials = useRunConfigStore((state) => state.deleteLocalAuthCredentials);
  const selectProfile = useRunConfigStore((state) => state.selectEnvironmentProfile);

  const selectedProfileId =
    targetSelection.kind === "environmentProfile"
      ? targetSelection.environmentProfileId
      : undefined;
  const initiallySelected = profiles.find((profile) => profile.id === selectedProfileId);
  const currentTargetUrl = initiallySelected?.targetUrl ?? adHocTargetUrl;

  const [editingId, setEditingId] = useState<EnvironmentProfileId | undefined>(
    initiallySelected?.id,
  );
  const [draft, setDraft] = useState(() =>
    initiallySelected === undefined
      ? blankDraft(currentTargetUrl)
      : draftFromProfile(initiallySelected),
  );
  const [credentialDraft, setCredentialDraft] = useState(emptyCredentials);
  const [deleteLocalCredentials, setDeleteLocalCredentials] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const authRef = draft.authRef.trim();
  const hasCredentials = authRef !== "" && credentialStatus[authRef] === true;
  const editingProfile = profiles.find((profile) => profile.id === editingId);

  const edit = (profile: EnvironmentProfile) => {
    setEditingId(profile.id);
    setDraft(draftFromProfile(profile));
    setCredentialDraft(emptyCredentials);
    setDeleteLocalCredentials(false);
    setActionError(undefined);
  };

  const createFromCurrentUrl = () => {
    setEditingId(undefined);
    setDraft(blankDraft(currentTargetUrl));
    setCredentialDraft(emptyCredentials);
    setDeleteLocalCredentials(false);
    setActionError(undefined);
  };

  const onSaveProfile = async () => {
    setSaving(true);
    setActionError(undefined);
    const result = await saveProfile({
      ...(editingId !== undefined ? { id: editingId } : {}),
      name: draft.name,
      targetUrl: draft.targetUrl,
      notes: draft.notes,
      authRef: draft.authRef,
    });
    setSaving(false);
    if (typeof result === "string") {
      setActionError(result);
      return;
    }
    setEditingId(result.id);
    setDraft(draftFromProfile(result));
  };

  const onDeleteProfile = async () => {
    if (editingId === undefined) return;
    if (!window.confirm(`Delete ${editingProfile?.name ?? "this profile"}?`)) return;
    setSaving(true);
    setActionError(undefined);
    const failure = await deleteProfile(editingId, deleteLocalCredentials);
    setSaving(false);
    if (failure !== null) {
      setActionError(failure);
      return;
    }
    createFromCurrentUrl();
  };

  const onSaveCredentials = async () => {
    setSaving(true);
    setActionError(undefined);
    const failure = await saveCredentials(authRef, credentialDraft);
    setSaving(false);
    if (failure !== null) {
      setActionError(failure);
      return;
    }
    setCredentialDraft(emptyCredentials);
  };

  const onDeleteCredentials = async () => {
    if (!window.confirm(`Delete local credentials for ${authRef}?`)) return;
    setSaving(true);
    setActionError(undefined);
    const failure = await deleteCredentials(authRef);
    setSaving(false);
    if (failure !== null) setActionError(failure);
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="profile-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-modal-title"
      >
        <header className="profile-modal-head">
          <div>
            <h2 id="profile-modal-title">Environment profiles</h2>
            <p className="muted">Project targets are shared. Basic Auth credentials stay local.</p>
          </div>
          <button type="button" className="icon-button" title="Close" onClick={onClose}>
            ×
          </button>
        </header>

        {(profilesError !== undefined || actionError !== undefined) && (
          <div className="banner banner-error">{actionError ?? profilesError}</div>
        )}

        <div className="profile-modal-body">
          <ProfileList
            profiles={profiles}
            editingId={editingId}
            onCreate={createFromCurrentUrl}
            onEdit={edit}
          />
          <ProfileEditor
            draft={draft}
            editingId={editingId}
            editingProfile={editingProfile}
            authRef={authRef}
            hasCredentials={hasCredentials}
            credentialDraft={credentialDraft}
            deleteLocalCredentials={deleteLocalCredentials}
            saving={saving}
            onDraftChange={setDraft}
            onCredentialDraftChange={setCredentialDraft}
            onDeleteLocalCredentialsChange={setDeleteLocalCredentials}
            onSaveProfile={() => {
              void onSaveProfile();
            }}
            onSelectProfile={(id) => {
              selectProfile(id);
              onClose();
            }}
            onDeleteProfile={() => {
              void onDeleteProfile();
            }}
            onSaveCredentials={() => {
              void onSaveCredentials();
            }}
            onDeleteCredentials={() => {
              void onDeleteCredentials();
            }}
          />
        </div>
      </section>
    </div>
  );
};
