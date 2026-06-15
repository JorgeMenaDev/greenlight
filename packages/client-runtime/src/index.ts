/**
 * Greenlight WebSocket RPC client.
 *
 * `makeGreenlightClient` produces a typed client for `WsRpcGroup`; provide it
 * with `layerWsProtocol(url)` to connect over a WebSocket. Works in browsers
 * and in Node >= 22 (both expose a global `WebSocket`).
 *
 * @module client-runtime
 */
import { WsRpcGroup } from "@greenlight/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as Socket from "effect/unstable/socket/Socket";

/**
 * Effect that builds the typed RPC client. Requires `RpcClient.Protocol`
 * (see {@link layerWsProtocol}) and a `Scope`.
 *
 * Scope warning: the protocol layer must outlive every call made through
 * the client. Prefer {@link layerGreenlightClient}, which ties both to one
 * Layer scope.
 */
export const makeGreenlightClient = RpcClient.make(WsRpcGroup);

export type GreenlightClient =
  typeof makeGreenlightClient extends Effect.Effect<infer Client, infer _E, infer _R>
    ? Client
    : never;

/**
 * The connected RPC client as a service.
 */
export class GreenlightRpcClient extends Context.Service<GreenlightRpcClient, GreenlightClient>()(
  "@greenlight/client-runtime/GreenlightRpcClient",
) {}

const webSocketConstructorLayer = Layer.succeed(
  Socket.WebSocketConstructor,
  (url, protocols) => new globalThis.WebSocket(url, protocols),
);

const resolveWsUrl = (rawUrl: string): string => {
  const resolved = new URL(rawUrl);
  if (resolved.protocol === "http:") resolved.protocol = "ws:";
  if (resolved.protocol === "https:") resolved.protocol = "wss:";
  if (resolved.protocol !== "ws:" && resolved.protocol !== "wss:") {
    throw new Error(`Unsupported websocket transport URL protocol: ${resolved.protocol}`);
  }
  resolved.pathname = "/ws";
  return resolved.toString();
};

/**
 * Protocol layer for the RPC client: WebSocket transport + JSON serialization.
 *
 * @param url - The server base URL (http(s):// or ws(s)://); the /ws path is appended.
 */
export const layerWsProtocol = (url: string) =>
  Layer.effect(
    RpcClient.Protocol,
    RpcClient.makeProtocolSocket({
      retryTransientErrors: true,
    }),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        Socket.layerWebSocket(resolveWsUrl(url)).pipe(Layer.provide(webSocketConstructorLayer)),
        RpcSerialization.layerJson,
      ),
    ),
  );

/**
 * Connected client as a Layer: the WebSocket protocol lives for the
 * lifetime of whatever this layer is provided to.
 *
 * @param url - The server base URL (http(s):// or ws(s)://).
 */
export const layerGreenlightClient = (url: string) =>
  Layer.effect(GreenlightRpcClient, makeGreenlightClient).pipe(Layer.provide(layerWsProtocol(url)));
