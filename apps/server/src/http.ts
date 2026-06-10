/**
 * HTTP routes - health checking now; evidence + static renderer later.
 *
 * @module http
 */
import * as Effect from "effect/Effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";

import { ServerConfig } from "./config.ts";

export const healthzRouteLayer = HttpRouter.add(
  "GET",
  "/healthz",
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    return HttpServerResponse.text(`ok ${config.version}`);
  }),
);
