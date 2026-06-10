/**
 * Server meta contracts - schemas describing the running Greenlight server.
 *
 * @module server
 */
import * as Schema from "effect/Schema";

/**
 * ServerInfo - Static information about the running server instance.
 */
export const ServerInfo = Schema.Struct({
  version: Schema.String,
  dataDir: Schema.String,
  port: Schema.Number,
});
export type ServerInfo = typeof ServerInfo.Type;
