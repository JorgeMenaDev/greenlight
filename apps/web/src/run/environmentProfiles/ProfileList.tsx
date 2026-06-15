import type { EnvironmentProfile, EnvironmentProfileId } from "@greenlight/contracts";

export const ProfileList = ({
  profiles,
  editingId,
  onCreate,
  onEdit,
}: {
  readonly profiles: ReadonlyArray<EnvironmentProfile>;
  readonly editingId: EnvironmentProfileId | undefined;
  readonly onCreate: () => void;
  readonly onEdit: (profile: EnvironmentProfile) => void;
}) => (
  <aside className="profile-list-panel">
    <button type="button" className="btn profile-new-button" onClick={onCreate}>
      New from current URL
    </button>
    {profiles.length === 0 ? (
      <div className="profile-list-empty">No profiles yet.</div>
    ) : (
      <ul className="profile-list">
        {profiles.map((profile) => (
          <li key={profile.id}>
            <button
              type="button"
              className={
                profile.id === editingId
                  ? "profile-list-item profile-list-item-active"
                  : "profile-list-item"
              }
              onClick={() => {
                onEdit(profile);
              }}
            >
              <span className="profile-list-name">{profile.name}</span>
              <span className="profile-list-url">{profile.targetUrl}</span>
            </button>
          </li>
        ))}
      </ul>
    )}
  </aside>
);
