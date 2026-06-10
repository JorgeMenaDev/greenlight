/**
 * Server layer composition - wires every service and route into one Layer.
 *
 * Only `ServerConfig` is expected from the launch site (bin or tests);
 * everything else is provided here.
 *
 * @module server
 */
import * as NodeHttp from "node:http";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter, HttpServer } from "effect/unstable/http";

import { ServerConfig } from "./config.ts";
import { healthzRouteLayer } from "./http.ts";
import { websocketRpcRouteLayer } from "./ws.ts";

export const makeRoutesLayer = Layer.mergeAll(healthzRouteLayer, websocketRpcRouteLayer);

const logListeningLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const server = yield* HttpServer.HttpServer;
    const address = server.address;
    if (typeof address !== "string" && "port" in address) {
      yield* Effect.logInfo(
        `Greenlight server listening on http://${config.host}:${address.port}`,
      );
    }
  }),
);

export const makeServerLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;

    const httpServerLayer = NodeHttpServer.layer(NodeHttp.createServer, {
      host: config.host,
      port: config.port,
    });

    return Layer.mergeAll(HttpRouter.serve(makeRoutesLayer), logListeningLayer).pipe(
      Layer.provideMerge(httpServerLayer),
      Layer.provideMerge(NodeServices.layer),
    );
  }),
);

export const runServer = Layer.launch(makeServerLayer);
