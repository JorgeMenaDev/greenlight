# Store environment profiles separately from local credentials

Environment profiles are stored as non-secret project files so they can travel with feature files and be shared by a team. Local Basic Auth credentials are stored in Greenlight's app database, keyed by project and authentication reference, and are never written to project files, run snapshots, events, or evidence.

The selected environment profile is a browser-local preference, not project state. Selecting a profile does not overwrite the browser-local ad-hoc target URL or ad-hoc credentials.

Runs start with an explicit target: either an ad-hoc HTTP target with optional Basic Auth credentials, or an environment profile id. The server resolves that target before execution so run snapshots only store the effective URL and optional profile name, never local credentials.

Environment profile persistence is owned by `EnvironmentProfileService`; `ProjectService` only owns project selection and feature files. Deleting a profile and optionally deleting its local credentials is one server command so the client does not chain partial profile/credential updates.
