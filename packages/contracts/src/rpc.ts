/**
 * WebSocket RPC contract surface shared by the server and all clients.
 *
 * Every method is declared once here with `Rpc.make` and composed into
 * `WsRpcGroup`; the server implements the group via `WsRpcGroup.toLayer`
 * and clients consume it via `RpcClient.make(WsRpcGroup)`.
 *
 * @module rpc
 */
import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { ServerInfo } from "./server.ts";

export const WS_METHODS = {
  // Server meta
  serverGetConfig: "server.getConfig",
} as const;

export const WsServerGetConfigRpc = Rpc.make(WS_METHODS.serverGetConfig, {
  payload: Schema.Struct({}),
  success: ServerInfo,
});

export const WsRpcGroup = RpcGroup.make(WsServerGetConfigRpc);
