import { describe, expect, it } from "vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpServer } from "effect/unstable/http";

import { GreenlightRpcClient, layerGreenlightClient } from "@greenlight/client-runtime";

import { layerTest } from "./config.ts";
import { makeServerLayer } from "./server.ts";

const testServerLayer = makeServerLayer.pipe(
  Layer.provide(layerTest.pipe(Layer.provide(NodeServices.layer))),
);

const withServerPort = Effect.gen(function* () {
  const context = yield* Layer.build(testServerLayer);
  const server = Context.get(context, HttpServer.HttpServer);
  const address = server.address;
  if (typeof address === "string" || !("port" in address)) {
    return yield* Effect.die("expected a TCP listening address");
  }
  return address.port;
});

describe("greenlight server", () => {
  it("serves /healthz", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const port = yield* withServerPort;
          const response = yield* Effect.promise(() =>
            fetch(`http://127.0.0.1:${port}/healthz`),
          );
          expect(response.status).toBe(200);
          const body = yield* Effect.promise(() => response.text());
          expect(body).toContain("ok");
        }),
      ),
    );
  });

  it("answers server.getConfig over the WebSocket RPC", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const port = yield* withServerPort;
          const info = yield* Effect.gen(function* () {
            const client = yield* GreenlightRpcClient;
            return yield* client["server.getConfig"]({});
          }).pipe(Effect.provide(layerGreenlightClient(`http://127.0.0.1:${port}`)));
          expect(info.version).toBe("0.0.0-test");
          expect(info.dataDir).toContain("greenlight-test-");
        }),
      ),
    );
  });
});
