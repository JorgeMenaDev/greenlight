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

import { BrowserServiceLive } from "./browser/BrowserService.ts";
import { ServerConfig } from "./config.ts";
import { CopilotServiceLive } from "./copilot/CopilotService.ts";
import { EvidenceStoreLive } from "./evidence/EvidenceStore.ts";
import { GherkinServiceLive } from "./gherkin/GherkinService.ts";
import { RunEngineLive } from "./engine/RunEngine.ts";
import { RunEventBusLive } from "./engine/RunEventBus.ts";
import { RunManagerLive } from "./engine/RunManager.ts";
import { ProjectServiceLive } from "./project/ProjectService.ts";
import { RunStoreLive } from "./persistence/RunStore.ts";
import { SqliteLive } from "./persistence/Sqlite.ts";
import { evidenceRouteLayer, healthzRouteLayer, staticRouteLayer } from "./http.ts";
import { websocketRpcRouteLayer } from "./ws.ts";

export const makeRoutesLayer = Layer.mergeAll(
  healthzRouteLayer,
  evidenceRouteLayer,
  websocketRpcRouteLayer,
  staticRouteLayer,
);

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

/** Every domain service, wired bottom-up over Sqlite + ServerConfig. */
export const servicesLayer = RunManagerLive.pipe(
  Layer.provideMerge(RunEngineLive),
  Layer.provideMerge(
    Layer.mergeAll(BrowserServiceLive, CopilotServiceLive, GherkinServiceLive),
  ),
  Layer.provideMerge(Layer.mergeAll(RunEventBusLive, ProjectServiceLive)),
  Layer.provideMerge(Layer.mergeAll(RunStoreLive, EvidenceStoreLive)),
  Layer.provideMerge(SqliteLive),
);

export const makeServerLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;

    const httpServerLayer = NodeHttpServer.layer(NodeHttp.createServer, {
      host: config.host,
      port: config.port,
    });

    return Layer.mergeAll(HttpRouter.serve(makeRoutesLayer), logListeningLayer).pipe(
      Layer.provideMerge(servicesLayer),
      Layer.provideMerge(httpServerLayer),
      Layer.provideMerge(NodeServices.layer),
    );
  }),
);

export const runServer = Layer.launch(makeServerLayer);
