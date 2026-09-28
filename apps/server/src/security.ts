import { timingSafeEqual } from "node:crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import { ServerConfig } from "./config.ts";

export const securityLayer = HttpRouter.middleware()(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const server = yield* HttpServer.HttpServer;
    const port = "port" in server.address ? server.address.port : config.port;
    const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
    const origins = new Set([...hosts].map((host) => `http://${host}`));
    if (config.allowedOrigin) origins.add(config.allowedOrigin);
    const cookieName = `greenlight-session-${port}`;
    const matches = (value: string | undefined) =>
      value !== undefined &&
      /^[a-f0-9]{64}$/.test(value) &&
      timingSafeEqual(Buffer.from(value), Buffer.from(config.authToken));

    return (effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const origin = request.headers.origin;
        if (
          !hosts.has(request.headers.host ?? "") ||
          (origin !== undefined && !origins.has(origin)) ||
          request.headers["sec-fetch-site"] === "cross-site"
        ) {
          return HttpServerResponse.text("Forbidden", { status: 403 });
        }
        const path = request.url.split("?")[0];
        const cors = origin
          ? {
              "access-control-allow-origin": origin,
              "access-control-allow-credentials": "true",
              vary: "Origin",
            }
          : {};
        if (path === "/session") {
          if (request.method === "OPTIONS") {
            return HttpServerResponse.empty({
              status: 204,
              headers: {
                ...cors,
                "access-control-allow-methods": "POST",
                "access-control-allow-headers": "Authorization",
              },
            });
          }
          if (
            request.method !== "POST" ||
            !matches(request.headers.authorization?.replace(/^Bearer /, ""))
          ) {
            return HttpServerResponse.text("Unauthorized", { status: 401 });
          }
          return HttpServerResponse.empty({
            status: 204,
            headers: {
              ...cors,
              "cache-control": "no-store",
              "set-cookie": `${cookieName}=${config.authToken}; HttpOnly; SameSite=Strict; Path=/`,
            },
          });
        }
        const response = yield* effect;
        return HttpServerResponse.setHeaders(response, {
          "x-frame-options": "DENY",
          "referrer-policy": "no-referrer",
        });
      });
  }),
  { global: true },
);

// Explicit routes also pass through the global security middleware.
export const sessionRoutes = Layer.mergeAll(
  HttpRouter.add("POST", "/session", Effect.succeed(HttpServerResponse.empty())),
  HttpRouter.add("OPTIONS", "/session", Effect.succeed(HttpServerResponse.empty())),
);

export const authenticatedRequest = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const config = yield* ServerConfig;
  const server = yield* HttpServer.HttpServer;
  const port = "port" in server.address ? server.address.port : config.port;
  const cookieName = `greenlight-session-${port}`;
  const matches = (value: string | undefined) =>
    value !== undefined &&
    /^[a-f0-9]{64}$/.test(value) &&
    timingSafeEqual(Buffer.from(value), Buffer.from(config.authToken));
  const cookie = request.headers.cookie
    ?.split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
  const protocol = request.headers["sec-websocket-protocol"]
    ?.split(",")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("greenlight."))
    ?.slice(11);
  return (
    matches(cookie) ||
    matches(protocol) ||
    matches(request.headers.authorization?.replace(/^Bearer /, ""))
  );
});
