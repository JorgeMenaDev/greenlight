/**
 * Live run state: starts runs, subscribes to the run event stream and
 * folds events into a Run snapshot with the shared `applyRunEvent` reducer.
 */
import {
  applyRunEvent,
  type BasicAuthCredentials,
  type PickleId,
  type Run,
  type RunEvent,
  type RunId,
} from "@greenlight/contracts";
import { create } from "zustand";

import { errorMessage, rpc, subscribeRun } from "../rpc/client.ts";
import { useAppStore } from "./appStore.ts";

export interface StepActivity {
  summary: string;
  tool: string | undefined;
}

export interface StepSelection {
  pickleId: PickleId;
  stepIndex: number;
}

export const activityKey = (pickleId: PickleId, stepIndex: number): string =>
  `${pickleId}:${stepIndex}`;

export interface StartRunParams {
  featurePath: string;
  baseUrl: string;
  httpCredentials?: BasicAuthCredentials;
  pickleIds?: ReadonlyArray<PickleId>;
  model?: string;
}

export interface RunState {
  runId: RunId | undefined;
  run: Run | undefined;
  /** True while the subscription is tailing an unfinished run. */
  live: boolean;
  /** True between `run.start` being sent and the subscription attaching. */
  starting: boolean;
  /** Latest agent.activity line per `pickleId:stepIndex`. */
  activity: Readonly<Record<string, StepActivity>>;
  runError: string | undefined;
  selectedStep: StepSelection | undefined;
  unsubscribe: (() => void) | undefined;

  startRun: (params: StartRunParams) => Promise<void>;
  cancelRun: () => Promise<void>;
  attach: (runId: RunId, afterSeq: number) => void;
  applyEvent: (event: RunEvent) => void;
  selectStep: (selection: StepSelection | undefined) => void;
  clearError: () => void;
  reset: () => void;
}

export const useRunStore = create<RunState>()((set, get) => ({
  runId: undefined,
  run: undefined,
  live: false,
  starting: false,
  activity: {},
  runError: undefined,
  selectedStep: undefined,
  unsubscribe: undefined,

  startRun: async (params) => {
    const state = get();
    if (state.live || state.starting) return;
    state.unsubscribe?.();
    set({
      starting: true,
      runId: undefined,
      run: undefined,
      activity: {},
      runError: undefined,
      selectedStep: undefined,
      unsubscribe: undefined,
    });
    try {
      const { runId } = await rpc("run.start", params);
      get().attach(runId, -1);
    } catch (error) {
      set({ starting: false, runError: errorMessage(error) });
    }
  },

  cancelRun: async () => {
    const { runId } = get();
    if (runId === undefined) return;
    try {
      await rpc("run.cancel", { runId });
    } catch (error) {
      set({ runError: errorMessage(error) });
    }
  },

  attach: (runId, afterSeq) => {
    get().unsubscribe?.();
    const unsubscribe = subscribeRun(runId, afterSeq, {
      onEvent: (event) => {
        get().applyEvent(event);
      },
      onError: (message) => {
        set({ live: false, runError: message });
      },
      onDone: () => {
        set({ live: false });
      },
    });
    set({ runId, live: true, starting: false, unsubscribe });
  },

  applyEvent: (event) => {
    set((state) => {
      const next: Partial<RunState> = { run: applyRunEvent(state.run, event) };
      if (event.type === "agent.activity") {
        next.activity = {
          ...state.activity,
          [activityKey(event.pickleId, event.stepIndex)]: {
            summary: event.summary,
            tool: event.tool,
          },
        };
      }
      if (event.type === "run.finished") {
        next.live = false;
      }
      return next;
    });
  },

  selectStep: (selection) => set({ selectedStep: selection }),

  clearError: () => set({ runError: undefined }),

  reset: () => {
    get().unsubscribe?.();
    set({
      runId: undefined,
      run: undefined,
      live: false,
      starting: false,
      activity: {},
      runError: undefined,
      selectedStep: undefined,
      unsubscribe: undefined,
    });
  },
}));

/**
 * Start a run for the currently selected feature using the run config in
 * the app store (target URL, model). Pass `pickleIds` to run a subset of
 * scenarios; omit it to run the whole feature.
 */
export const startRunWithConfig = (pickleIds?: ReadonlyArray<PickleId>): void => {
  const app = useAppStore.getState();
  const featurePath = app.selectedFeaturePath;
  const baseUrl = app.targetUrl.trim();
  const authUsername = app.authUsername.trim();
  const authPassword = app.authPassword;
  const hasUsername = authUsername !== "";
  const hasPassword = authPassword !== "";
  if (featurePath === undefined) {
    useRunStore.setState({ runError: "Select a feature file first." });
    return;
  }
  if (baseUrl === "") {
    useRunStore.setState({ runError: "Set a target URL in the toolbar first." });
    return;
  }
  if (hasUsername !== hasPassword) {
    useRunStore.setState({
      runError: "Enter both basic auth username and password, or leave both blank.",
    });
    return;
  }
  const httpCredentials: BasicAuthCredentials | undefined =
    hasUsername && hasPassword ? { username: authUsername, password: authPassword } : undefined;
  void useRunStore.getState().startRun({
    featurePath,
    baseUrl,
    ...(httpCredentials !== undefined ? { httpCredentials } : {}),
    ...(pickleIds !== undefined ? { pickleIds } : {}),
    ...(app.model !== "" ? { model: app.model } : {}),
  });
};
