/**
 * Browser-side RPC bridge.
 *
 * Builds the Greenlight WebSocket RPC client layer ONCE into a manually
 * created long-lived Scope at module load, then exposes plain Promise /
 * callback helpers so React components never touch Effect directly.
 *
 * The scope is intentionally never closed: the WebSocket protocol must
 * outlive every call made through the client (see the client-runtime docs).
 */
import {
  GreenlightRpcClient,
  layerGreenlightClient,
  type GreenlightClient,
} from "@greenlight/client-runtime";
import type {
  BrowserStatus,
  BasicAuthCredentials,
  CopilotAuthStatus,
  CopilotModel,
  EnvironmentProfile,
  EnvironmentProfileId,
  EnvironmentProfileInput,
  FeatureFileEntry,
  GherkinParseError,
  LocalAuthCredentialStatus,
  ParsedFeature,
  PickleId,
  ProjectInfo,
  RecentProject,
  Run,
  RunEvent,
  RunId,
  RunSummary,
  RunTarget,
  ServerInfo,
} from "@greenlight/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

/**
 * Server base URL. In production the backend serves this app, so
 * `location.origin` is correct; in development the Electron shell (or a
 * plain browser) passes `?server=http://127.0.0.1:4773`.
 */
export const serverUrl: string =
  new URLSearchParams(window.location.search).get("server") ?? window.location.origin;

/** Absolute URL for a piece of run evidence (screenshots, console logs...). */
export const evidenceUrl = (evidenceId: string): string =>
  `${serverUrl.replace(/\/$/, "")}/evidence/${evidenceId}`;

// -- long-lived client ------------------------------------------------------

const appScope = Scope.makeUnsafe();

const clientPromise: Promise<GreenlightClient> = Effect.runPromise(
  Layer.build(layerGreenlightClient(serverUrl)).pipe(Scope.provide(appScope)),
).then((context) => Context.get(context, GreenlightRpcClient));

// -- typed request/response surface -----------------------------------------

/** Shape of `features.read` / `features.write` parse results. */
export interface FeatureParse {
  readonly feature: ParsedFeature | null;
  readonly errors: ReadonlyArray<GherkinParseError>;
}

/**
 * Method-string keyed map of payload/result types, mirroring
 * `WsRpcGroup` in @greenlight/contracts.
 */
export interface RpcMethodMap {
  "project.open": { payload: { path: string }; result: ProjectInfo };
  "project.current": { payload: Record<string, never>; result: ProjectInfo | null };
  "project.recent": { payload: Record<string, never>; result: ReadonlyArray<RecentProject> };
  "environmentProfiles.list": {
    payload: Record<string, never>;
    result: ReadonlyArray<EnvironmentProfile>;
  };
  "environmentProfiles.save": {
    payload: EnvironmentProfileInput;
    result: EnvironmentProfile;
  };
  "environmentProfiles.delete": {
    payload: { id: EnvironmentProfileId; deleteLocalCredentials?: boolean };
    result: Record<string, never>;
  };
  "environmentProfileCredentials.list": {
    payload: Record<string, never>;
    result: ReadonlyArray<LocalAuthCredentialStatus>;
  };
  "environmentProfileCredentials.save": {
    payload: { authRef: string; credentials: BasicAuthCredentials };
    result: Record<string, never>;
  };
  "environmentProfileCredentials.delete": {
    payload: { authRef: string };
    result: Record<string, never>;
  };
  "features.list": { payload: Record<string, never>; result: ReadonlyArray<FeatureFileEntry> };
  "features.read": {
    payload: { path: string };
    result: { readonly content: string; readonly parsed: FeatureParse };
  };
  "features.write": {
    payload: { path: string; content: string };
    result: { readonly parsed: FeatureParse };
  };
  "features.create": { payload: { name: string }; result: FeatureFileEntry };
  "features.delete": { payload: { path: string }; result: Record<string, never> };
  "run.start": {
    payload: {
      featurePath: string;
      target: RunTarget;
      pickleIds?: ReadonlyArray<PickleId>;
      model?: string;
    };
    result: { readonly runId: RunId };
  };
  "run.cancel": { payload: { runId: RunId }; result: Record<string, never> };
  "runs.list": {
    payload: { featurePath?: string; limit?: number; offset?: number };
    result: ReadonlyArray<RunSummary>;
  };
  "runs.get": { payload: { runId: RunId }; result: Run };
  "runs.delete": { payload: { runId: RunId }; result: Record<string, never> };
  "copilot.authStatus": { payload: Record<string, never>; result: CopilotAuthStatus };
  "copilot.listModels": { payload: Record<string, never>; result: ReadonlyArray<CopilotModel> };
  "browser.status": { payload: Record<string, never>; result: BrowserStatus };
  "server.getConfig": { payload: Record<string, never>; result: ServerInfo };
}

export type RpcMethod = keyof RpcMethodMap;

/** Extract a human-readable message from any rejected RPC call. */
export const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
};

/**
 * Call a request/response RPC method by its method string.
 *
 * Rejects with the typed contract error (e.g. NoProjectOpenError) or a
 * transport error; use {@link errorMessage} to render it.
 */
export const rpc = async <K extends RpcMethod>(
  method: K,
  payload: RpcMethodMap[K]["payload"],
): Promise<RpcMethodMap[K]["result"]> => {
  const client = await clientPromise;
  const call = client[method] as unknown as (
    input: RpcMethodMap[K]["payload"],
  ) => Effect.Effect<RpcMethodMap[K]["result"]>;
  return Effect.runPromise(call(payload));
};

/** {@link rpc} with a deadline, for connection probing at bootstrap. */
export const rpcWithTimeout = async <K extends RpcMethod>(
  method: K,
  payload: RpcMethodMap[K]["payload"],
  timeoutMs: number,
): Promise<RpcMethodMap[K]["result"]> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Could not reach the Greenlight server at ${serverUrl}.`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([rpc(method, payload), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

// -- run event subscription --------------------------------------------------

export interface SubscribeRunHandlers {
  readonly onEvent: (event: RunEvent) => void;
  readonly onError?: (message: string) => void;
  /** Called when the server completes the stream (run finished + replayed). */
  readonly onDone?: () => void;
}

/**
 * Subscribe to a run's live event stream.
 *
 * Replays events with `seq > afterSeq` then tails until the run finishes.
 * Runs `Stream.runForEach` in a forked fiber; the returned function
 * interrupts the fiber (safe to call multiple times).
 */
export const subscribeRun = (
  runId: RunId,
  afterSeq: number,
  handlers: SubscribeRunHandlers,
): (() => void) => {
  let cancelled = false;
  let fiber: Fiber.Fiber<void, never> | undefined;

  void clientPromise.then((client) => {
    if (cancelled) return;
    const stream = client["run.subscribe"]({ runId, afterSeq }) as Stream.Stream<RunEvent, unknown>;
    const consume = Stream.runForEach(stream, (event) =>
      Effect.sync(() => {
        handlers.onEvent(event);
      }),
    ).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          handlers.onDone?.();
        }),
      ),
      Effect.catch((error) =>
        Effect.sync(() => {
          handlers.onError?.(errorMessage(error));
        }),
      ),
    );
    fiber = Effect.runFork(consume);
  });

  return () => {
    cancelled = true;
    if (fiber !== undefined) {
      Effect.runFork(Fiber.interrupt(fiber));
      fiber = undefined;
    }
  };
};
