/**
 * Run configuration state: ad-hoc target settings, environment profiles,
 * local credential status, and selected Copilot model.
 */
import type {
  BasicAuthCredentials,
  EnvironmentProfile,
  EnvironmentProfileId,
  EnvironmentProfileInput,
  LocalAuthCredentialStatus,
} from "@greenlight/contracts";
import { create } from "zustand";

import { errorMessage, rpc } from "../rpc/client.ts";

export type RunTargetSelection =
  | { readonly kind: "adHoc" }
  | { readonly kind: "environmentProfile"; readonly environmentProfileId: EnvironmentProfileId };

const targetUrlKey = (projectPath: string): string => `greenlight:targetUrl:${projectPath}`;
const selectedProfileKey = (projectPath: string): string =>
  `greenlight:selectedEnvironmentProfile:${projectPath}`;
const TODO_MVC_TARGET_URL = "https://demo.playwright.dev/todomvc";

const defaultTargetUrl = (projectPath: string) => {
  const normalized = projectPath.replaceAll("\\", "/");
  return normalized === "examples/todomvc" || normalized.endsWith("/examples/todomvc")
    ? TODO_MVC_TARGET_URL
    : "";
};

const readTargetUrl = (projectPath: string) => {
  try {
    return window.localStorage.getItem(targetUrlKey(projectPath)) ?? defaultTargetUrl(projectPath);
  } catch {
    return defaultTargetUrl(projectPath);
  }
};

const writeTargetUrl = (projectPath: string, url: string) => {
  try {
    window.localStorage.setItem(targetUrlKey(projectPath), url);
  } catch {
    // localStorage unavailable - non fatal
  }
};

const readSelectedProfileId = (projectPath: string): EnvironmentProfileId | undefined => {
  try {
    return (window.localStorage.getItem(selectedProfileKey(projectPath)) ?? undefined) as
      | EnvironmentProfileId
      | undefined;
  } catch {
    return undefined;
  }
};

const writeSelectedProfileId = (projectPath: string, id: EnvironmentProfileId | undefined) => {
  try {
    if (id === undefined) {
      window.localStorage.removeItem(selectedProfileKey(projectPath));
    } else {
      window.localStorage.setItem(selectedProfileKey(projectPath), id);
    }
  } catch {
    // localStorage unavailable - non fatal
  }
};

const toCredentialRecord = (statuses: ReadonlyArray<LocalAuthCredentialStatus>) =>
  Object.fromEntries(statuses.map((entry) => [entry.authRef, entry.hasCredentials]));

export interface RunConfigState {
  projectPath: string | undefined;
  environmentProfiles: ReadonlyArray<EnvironmentProfile>;
  environmentProfilesError: string | undefined;
  localAuthCredentialStatus: Readonly<Record<string, boolean>>;
  targetSelection: RunTargetSelection;
  adHocTargetUrl: string;
  adHocAuthUsername: string;
  adHocAuthPassword: string;
  /** Selected Copilot model id; "" means the server default. */
  model: string;

  reset: () => void;
  loadForProject: (projectPath: string) => Promise<void>;
  selectAdHocTarget: () => void;
  selectEnvironmentProfile: (id: EnvironmentProfileId) => void;
  saveEnvironmentProfile: (input: EnvironmentProfileInput) => Promise<EnvironmentProfile | string>;
  deleteEnvironmentProfile: (
    id: EnvironmentProfileId,
    deleteLocalCredentials: boolean,
  ) => Promise<string | null>;
  saveLocalAuthCredentials: (
    authRef: string,
    credentials: BasicAuthCredentials,
  ) => Promise<string | null>;
  deleteLocalAuthCredentials: (authRef: string) => Promise<string | null>;
  setAdHocTargetUrl: (url: string) => void;
  setAdHocAuthUsername: (username: string) => void;
  setAdHocAuthPassword: (password: string) => void;
  setModel: (model: string) => void;
}

const blankConfig = {
  projectPath: undefined,
  environmentProfiles: [],
  environmentProfilesError: undefined,
  localAuthCredentialStatus: {},
  targetSelection: { kind: "adHoc" } as RunTargetSelection,
  adHocTargetUrl: "",
  adHocAuthUsername: "",
  adHocAuthPassword: "",
  model: "",
};

export const useRunConfigStore = create<RunConfigState>()((set, get) => ({
  ...blankConfig,

  reset: () => set(blankConfig),

  loadForProject: async (projectPath) => {
    set({
      projectPath,
      environmentProfiles: [],
      environmentProfilesError: undefined,
      localAuthCredentialStatus: {},
      targetSelection: { kind: "adHoc" },
      adHocTargetUrl: readTargetUrl(projectPath),
      adHocAuthUsername: "",
      adHocAuthPassword: "",
    });

    try {
      const [environmentProfiles, credentialStatuses] = await Promise.all([
        rpc("environmentProfiles.list", {}),
        rpc("environmentProfileCredentials.list", {}),
      ]);
      const savedProfileId = readSelectedProfileId(projectPath);
      const selectedProfile = environmentProfiles.find((profile) => profile.id === savedProfileId);
      if (savedProfileId !== undefined && selectedProfile === undefined) {
        writeSelectedProfileId(projectPath, undefined);
      }
      set({
        environmentProfiles,
        environmentProfilesError: undefined,
        localAuthCredentialStatus: toCredentialRecord(credentialStatuses),
        targetSelection:
          selectedProfile === undefined
            ? { kind: "adHoc" }
            : { kind: "environmentProfile", environmentProfileId: selectedProfile.id },
      });
    } catch (error) {
      set({ environmentProfilesError: errorMessage(error) });
    }
  },

  selectAdHocTarget: () => {
    const { projectPath } = get();
    if (projectPath !== undefined) writeSelectedProfileId(projectPath, undefined);
    set({ targetSelection: { kind: "adHoc" }, adHocAuthUsername: "", adHocAuthPassword: "" });
  },

  selectEnvironmentProfile: (id) => {
    const { projectPath } = get();
    if (projectPath !== undefined) writeSelectedProfileId(projectPath, id);
    set({
      targetSelection: { kind: "environmentProfile", environmentProfileId: id },
      adHocAuthUsername: "",
      adHocAuthPassword: "",
    });
  },

  saveEnvironmentProfile: async (input) => {
    try {
      const saved = await rpc("environmentProfiles.save", input);
      const environmentProfiles = await rpc("environmentProfiles.list", {});
      set({ environmentProfiles, environmentProfilesError: undefined });
      return saved;
    } catch (error) {
      const message = errorMessage(error);
      set({ environmentProfilesError: message });
      return message;
    }
  },

  deleteEnvironmentProfile: async (id, deleteLocalCredentials) => {
    const { projectPath, targetSelection } = get();
    try {
      await rpc("environmentProfiles.delete", { id, deleteLocalCredentials });
      const [environmentProfiles, credentialStatuses] = await Promise.all([
        rpc("environmentProfiles.list", {}),
        rpc("environmentProfileCredentials.list", {}),
      ]);
      const deletingSelected =
        targetSelection.kind === "environmentProfile" &&
        targetSelection.environmentProfileId === id;
      if (projectPath !== undefined && deletingSelected)
        writeSelectedProfileId(projectPath, undefined);
      set({
        environmentProfiles,
        localAuthCredentialStatus: toCredentialRecord(credentialStatuses),
        environmentProfilesError: undefined,
        ...(deletingSelected ? { targetSelection: { kind: "adHoc" } as RunTargetSelection } : {}),
      });
      return null;
    } catch (error) {
      const message = errorMessage(error);
      set({ environmentProfilesError: message });
      return message;
    }
  },

  saveLocalAuthCredentials: async (authRef, credentials) => {
    try {
      await rpc("environmentProfileCredentials.save", { authRef, credentials });
      const statuses = await rpc("environmentProfileCredentials.list", {});
      set({
        localAuthCredentialStatus: toCredentialRecord(statuses),
        environmentProfilesError: undefined,
      });
      return null;
    } catch (error) {
      const message = errorMessage(error);
      set({ environmentProfilesError: message });
      return message;
    }
  },

  deleteLocalAuthCredentials: async (authRef) => {
    try {
      await rpc("environmentProfileCredentials.delete", { authRef });
      const statuses = await rpc("environmentProfileCredentials.list", {});
      set({
        localAuthCredentialStatus: toCredentialRecord(statuses),
        environmentProfilesError: undefined,
      });
      return null;
    } catch (error) {
      const message = errorMessage(error);
      set({ environmentProfilesError: message });
      return message;
    }
  },

  setAdHocTargetUrl: (url) => {
    const { projectPath } = get();
    if (projectPath !== undefined) writeTargetUrl(projectPath, url);
    set({ adHocTargetUrl: url });
  },

  setAdHocAuthUsername: (username) => set({ adHocAuthUsername: username }),

  setAdHocAuthPassword: (password) => set({ adHocAuthPassword: password }),

  setModel: (model) => set({ model }),
}));
