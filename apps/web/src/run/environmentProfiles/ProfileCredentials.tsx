export const ProfileCredentials = ({
  hasCredentials,
  credentialDraft,
  saving,
  onCredentialDraftChange,
  onSaveCredentials,
  onDeleteCredentials,
}: {
  readonly hasCredentials: boolean;
  readonly credentialDraft: { readonly username: string; readonly password: string };
  readonly saving: boolean;
  readonly onCredentialDraftChange: (draft: { username: string; password: string }) => void;
  readonly onSaveCredentials: () => void;
  readonly onDeleteCredentials: () => void;
}) => (
  <section className="local-credentials-panel">
    <div className="credentials-head">
      <span className="toolbar-label">Local Basic Auth</span>
      <span className={hasCredentials ? "credential-status-ok" : "credential-status-missing"}>
        {hasCredentials ? "Saved locally" : "Missing locally"}
      </span>
    </div>
    <div className="credentials-grid">
      <input
        type="text"
        className="text-input"
        placeholder="Username"
        autoComplete="off"
        value={credentialDraft.username}
        onChange={(event) => {
          onCredentialDraftChange({ ...credentialDraft, username: event.target.value });
        }}
      />
      <input
        type="password"
        className="text-input"
        placeholder="Password"
        autoComplete="off"
        value={credentialDraft.password}
        onChange={(event) => {
          onCredentialDraftChange({ ...credentialDraft, password: event.target.value });
        }}
      />
    </div>
    <div className="credentials-actions">
      <button
        type="button"
        className="btn"
        disabled={saving}
        onClick={() => {
          onSaveCredentials();
        }}
      >
        Save local credentials
      </button>
      {hasCredentials && (
        <button
          type="button"
          className="link-button"
          disabled={saving}
          onClick={() => {
            onDeleteCredentials();
          }}
        >
          Delete local credentials
        </button>
      )}
    </div>
  </section>
);
