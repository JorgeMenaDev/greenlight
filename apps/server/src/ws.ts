/**
 * WebSocket RPC route - implements `WsRpcGroup` and mounts it at GET /ws.
 *
 * @module ws
 */
import {
  type BasicAuthCredentials,
  CopilotUnavailableError,
  WS_METHODS,
  WsRpcGroup,
  type CopilotAuthStatus,
} from "@greenlight/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { HttpRouter } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { BrowserService } from "./browser/BrowserService.ts";
import { CopilotService } from "./copilot/CopilotService.ts";
import { GherkinService } from "./gherkin/GherkinService.ts";
import { ProjectService } from "./project/ProjectService.ts";
import { RunManager } from "./engine/RunManager.ts";
import { RunEventBus } from "./engine/RunEventBus.ts";
import { RunStore } from "./persistence/RunStore.ts";
import { EvidenceStore } from "./evidence/EvidenceStore.ts";
import { ServerConfig } from "./config.ts";

const makeWsRpcLayer = WsRpcGroup.toLayer(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const project = yield* ProjectService;
    const gherkin = yield* GherkinService;
    const runManager = yield* RunManager;
    const runStore = yield* RunStore;
    const eventBus = yield* RunEventBus;
    const evidence = yield* EvidenceStore;
    const copilot = yield* CopilotService;
    const browser = yield* BrowserService;

    const parseFor = (content: string, uri: string) =>
      Effect.map(gherkin.parseFeature(content, uri), ({ feature, errors }) => ({
        feature: feature ?? null,
        errors,
      }));

    return {
      [WS_METHODS.projectOpen]: ({ path }: { readonly path: string }) => project.open(path),

      [WS_METHODS.projectCurrent]: () => project.current,

      [WS_METHODS.projectRecent]: () => project.recent,

      [WS_METHODS.featuresList]: () => project.listFeatures,

      [WS_METHODS.featuresRead]: ({ path }: { readonly path: string }) =>
        Effect.gen(function* () {
          const content = yield* project.readFeature(path);
          const parsed = yield* parseFor(content, path);
          return { content, parsed };
        }),

      [WS_METHODS.featuresWrite]: ({
        path,
        content,
      }: {
        readonly path: string;
        readonly content: string;
      }) =>
        Effect.gen(function* () {
          yield* project.writeFeature(path, content);
          const parsed = yield* parseFor(content, path);
          return { parsed };
        }),

      [WS_METHODS.featuresCreate]: ({ name }: { readonly name: string }) =>
        project.createFeature(name),

      [WS_METHODS.featuresDelete]: ({ path }: { readonly path: string }) =>
        Effect.as(project.deleteFeature(path), {}),

      [WS_METHODS.runStart]: (payload: {
        readonly featurePath: string;
        readonly baseUrl: string;
        readonly httpCredentials?: BasicAuthCredentials | undefined;
        readonly pickleIds?: ReadonlyArray<string> | undefined;
        readonly model?: string | undefined;
      }) =>
        runManager.start({
          featurePath: payload.featurePath,
          baseUrl: payload.baseUrl,
          httpCredentials: payload.httpCredentials,
          pickleIds: payload.pickleIds as never,
          model: payload.model,
        }),

      [WS_METHODS.runCancel]: ({ runId }: { readonly runId: string }) =>
        Effect.as(runManager.cancel(runId as never), {}),

      [WS_METHODS.runSubscribe]: (payload: {
        readonly runId: string;
        readonly afterSeq?: number | undefined;
      }) =>
        Stream.unwrap(
          Effect.gen(function* () {
            // Fails with RunNotFoundError when the run id is unknown.
            yield* runStore.getRun(payload.runId as never);
            return eventBus.subscribe(payload.runId as never, payload.afterSeq ?? -1);
          }),
        ),

      [WS_METHODS.runsList]: (payload: {
        readonly featurePath?: string | undefined;
        readonly limit?: number | undefined;
        readonly offset?: number | undefined;
      }) => runStore.listRuns(payload),

      [WS_METHODS.runsGet]: ({ runId }: { readonly runId: string }) =>
        runStore.getRun(runId as never),

      [WS_METHODS.runsDelete]: ({ runId }: { readonly runId: string }) =>
        Effect.gen(function* () {
          yield* runStore.deleteRun(runId as never);
          yield* evidence.deleteForRun(runId as never);
          return {};
        }),

      [WS_METHODS.copilotAuthStatus]: () =>
        Effect.map(
          copilot.authStatus,
          (status): CopilotAuthStatus => ({
            state: status.state,
            ...(status.login !== undefined ? { login: status.login } : {}),
            ...(status.message !== undefined ? { message: status.message } : {}),
          }),
        ),

      [WS_METHODS.copilotListModels]: () =>
        copilot.listModels.pipe(
          Effect.mapError((error) => new CopilotUnavailableError({ detail: error.message })),
        ),

      [WS_METHODS.browserStatus]: () => browser.status,

      [WS_METHODS.serverGetConfig]: () =>
        Effect.succeed({
          version: config.version,
          dataDir: config.dataDir,
          port: config.port,
        }),
    };
  }),
);

export const websocketRpcRouteLayer = HttpRouter.add(
  "GET",
  "/ws",
  Effect.gen(function* () {
    const rpcWebSocketHttpEffect = yield* RpcServer.toHttpEffectWebsocket(WsRpcGroup, {
      disableTracing: true,
    }).pipe(Effect.provide(makeWsRpcLayer.pipe(Layer.provideMerge(RpcSerialization.layerJson))));
    return yield* rpcWebSocketHttpEffect;
  }),
);
