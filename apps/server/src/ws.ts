/**
 * WebSocket RPC route - implements `WsRpcGroup` and mounts it at GET /ws.
 *
 * @module ws
 */
import { WS_METHODS, WsRpcGroup } from "@greenlight/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { ServerConfig } from "./config.ts";

const makeWsRpcLayer = WsRpcGroup.toLayer(
  Effect.gen(function* () {
    const config = yield* ServerConfig;

    return {
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
