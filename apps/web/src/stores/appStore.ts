/**
 * Global application state: connection lifecycle, environment statuses,
 * the open project, feature files and available Copilot models.
 */
import type {
  BrowserStatus,
  CopilotAuthStatus,
  CopilotModel,
  FeatureFileEntry,
  ProjectInfo,
  ServerInfo,
} from "@greenlight/contracts";
import { create } from "zustand";

import { errorMessage, rpc, rpcWithTimeout, type FeatureParse } from "../rpc/client.ts";
import { useRunConfigStore } from "./runConfigStore.ts";

export type ConnectionState = "connecting" | "connected" | "error";
export type AppView = "project" | "workspace" | "history";

export interface AppState {
  connection: ConnectionState;
  connectionError: string | undefined;
  serverInfo: ServerInfo | undefined;

  copilotStatus: CopilotAuthStatus | undefined;
  browserStatus: BrowserStatus | undefined;
  statusChecking: boolean;
  onboardingDismissed: boolean;

  project: ProjectInfo | null;
  view: AppView;

  features: ReadonlyArray<FeatureFileEntry>;
  featuresError: string | undefined;
  selectedFeaturePath: string | undefined;
  /** Parse result for the selected feature (kept in sync by the editor). */
  parsed: FeatureParse | null;

  models: ReadonlyArray<CopilotModel>;

  bootstrap: () => Promise<void>;
  recheckStatuses: () => Promise<void>;
  dismissOnboarding: () => void;
  setView: (view: AppView) => void;
  openProject: (path: string) => Promise<string | null>;
  loadFeatures: () => Promise<void>;
  selectFeature: (path: string | undefined) => void;
  setParsed: (parsed: FeatureParse | null) => void;
  createFeature: (name: string) => Promise<string | null>;
  deleteFeature: (path: string) => Promise<string | null>;
  loadModels: () => Promise<void>;
}

const loadProjectConfig = (project: ProjectInfo | null) => {
  const runConfig = useRunConfigStore.getState();
  if (project === null) {
    runConfig.reset();
    return;
  }
  void runConfig.loadForProject(project.path);
};

export const useAppStore = create<AppState>()((set, get) => ({
  connection: "connecting",
  connectionError: undefined,
  serverInfo: undefined,

  copilotStatus: undefined,
  browserStatus: undefined,
  statusChecking: false,
  onboardingDismissed: false,

  project: null,
  view: "project",

  features: [],
  featuresError: undefined,
  selectedFeaturePath: undefined,
  parsed: null,

  models: [],

  bootstrap: async () => {
    set({ connection: "connecting", connectionError: undefined });
    try {
      const serverInfo = await rpcWithTimeout("server.getConfig", {}, 15_000);
      const [copilotStatus, browserStatus, project] = await Promise.all([
        rpc("copilot.authStatus", {}),
        rpc("browser.status", {}),
        rpc("project.current", {}),
      ]);
      set({
        connection: "connected",
        connectionError: undefined,
        serverInfo,
        copilotStatus,
        browserStatus,
        project,
        view: project !== null ? "workspace" : "project",
      });
      loadProjectConfig(project);
      if (project !== null) {
        void get().loadFeatures();
        void get().loadModels();
      }
    } catch (error) {
      set({ connection: "error", connectionError: errorMessage(error) });
    }
  },

  recheckStatuses: async () => {
    set({ statusChecking: true });
    try {
      const [copilotStatus, browserStatus] = await Promise.all([
        rpc("copilot.authStatus", {}),
        rpc("browser.status", {}),
      ]);
      set({ copilotStatus, browserStatus, statusChecking: false });
    } catch {
      set({ statusChecking: false });
    }
  },

  dismissOnboarding: () => set({ onboardingDismissed: true }),

  setView: (view) => set({ view }),

  openProject: async (path) => {
    try {
      const project = await rpc("project.open", { path });
      set({
        project,
        view: "workspace",
        features: [],
        featuresError: undefined,
        selectedFeaturePath: undefined,
        parsed: null,
      });
      loadProjectConfig(project);
      void get().loadFeatures();
      void get().loadModels();
      return null;
    } catch (error) {
      return errorMessage(error);
    }
  },

  loadFeatures: async () => {
    try {
      const features = await rpc("features.list", {});
      const { selectedFeaturePath } = get();
      const stillExists =
        selectedFeaturePath !== undefined &&
        features.some((entry) => entry.path === selectedFeaturePath);
      const fallback = features[0]?.path;
      set({
        features,
        featuresError: undefined,
        ...(stillExists ? {} : { selectedFeaturePath: fallback, parsed: null }),
      });
    } catch (error) {
      set({ featuresError: errorMessage(error) });
    }
  },

  selectFeature: (path) => {
    if (path !== get().selectedFeaturePath) {
      set({ selectedFeaturePath: path, parsed: null });
    }
  },

  setParsed: (parsed) => set({ parsed }),

  createFeature: async (name) => {
    try {
      const entry = await rpc("features.create", { name });
      await get().loadFeatures();
      set({ selectedFeaturePath: entry.path, parsed: null });
      return null;
    } catch (error) {
      return errorMessage(error);
    }
  },

  deleteFeature: async (path) => {
    try {
      await rpc("features.delete", { path });
      if (get().selectedFeaturePath === path) {
        set({ selectedFeaturePath: undefined, parsed: null });
      }
      await get().loadFeatures();
      return null;
    } catch (error) {
      return errorMessage(error);
    }
  },

  loadModels: async () => {
    try {
      const models = await rpc("copilot.listModels", {});
      set({ models });
    } catch {
      set({ models: [] });
    }
  },
}));

/** True when the environment is not ready and onboarding should be shown. */
export const needsOnboarding = (state: AppState): boolean => {
  if (state.onboardingDismissed) return false;
  if (state.copilotStatus === undefined || state.browserStatus === undefined) return false;
  return state.copilotStatus.state !== "authenticated" || state.browserStatus.state === "missing";
};
