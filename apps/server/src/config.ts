/**
 * ServerConfig - Runtime configuration for the Greenlight server.
 *
 * Resolved once at startup (from env vars in production, explicitly in
 * tests) and provided to every other service as a Layer.
 *
 * @module config
 */
import * as NodeOs from "node:os";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

export const DEFAULT_PORT = 4773;

/**
 * Paths derived from the data directory.
 */
export interface ServerDerivedPaths {
  readonly dbPath: string;
  readonly evidenceDir: string;
  readonly browsersDir: string;
  readonly logsDir: string;
}

export interface ServerConfigShape extends ServerDerivedPaths {
  readonly port: number;
  readonly host: string;
  readonly dataDir: string;
  readonly version: string;
}

export class ServerConfig extends Context.Service<ServerConfig, ServerConfigShape>()(
  "greenlight/config/ServerConfig",
) {}

export const deriveServerPaths = Effect.fn(function* (
  dataDir: string,
): Effect.fn.Return<ServerDerivedPaths, never, Path.Path> {
  const { join } = yield* Path.Path;
  return {
    dbPath: join(dataDir, "greenlight.db"),
    evidenceDir: join(dataDir, "evidence"),
    browsersDir: join(dataDir, "browsers"),
    logsDir: join(dataDir, "logs"),
  };
});

export const ensureServerDirectories = Effect.fn(function* (config: ServerConfigShape) {
  const fs = yield* FileSystem.FileSystem;
  yield* Effect.all(
    [
      fs.makeDirectory(config.dataDir, { recursive: true }),
      fs.makeDirectory(config.evidenceDir, { recursive: true }),
      fs.makeDirectory(config.logsDir, { recursive: true }),
    ],
    { concurrency: "unbounded" },
  );
});

const defaultDataDir = Effect.fn(function* () {
  const { join } = yield* Path.Path;
  const home = NodeOs.homedir();
  switch (process.platform) {
    case "darwin":
      return join(home, "Library", "Application Support", "Greenlight");
    case "win32":
      return join(process.env["APPDATA"] ?? join(home, "AppData", "Roaming"), "Greenlight");
    default:
      return join(process.env["XDG_DATA_HOME"] ?? join(home, ".local", "share"), "greenlight");
  }
});

export interface MakeServerConfigOptions {
  readonly port?: number;
  readonly host?: string;
  readonly dataDir?: string;
  readonly version: string;
}

export const makeServerConfig = Effect.fn(function* (options: MakeServerConfigOptions) {
  const dataDir = options.dataDir ?? (yield* defaultDataDir());
  const derived = yield* deriveServerPaths(dataDir);
  const config: ServerConfigShape = {
    port: options.port ?? DEFAULT_PORT,
    host: options.host ?? "127.0.0.1",
    dataDir,
    version: options.version,
    ...derived,
  };
  yield* ensureServerDirectories(config);
  return config;
});

/**
 * Resolve configuration from GREENLIGHT_* environment variables.
 */
export const layerFromEnv = (version: string) =>
  Layer.effect(
    ServerConfig,
    Effect.suspend(() => {
      const rawPort = process.env["GREENLIGHT_PORT"];
      const parsedPort = rawPort === undefined ? undefined : Number.parseInt(rawPort, 10);
      return makeServerConfig({
        version,
        ...(parsedPort !== undefined && Number.isInteger(parsedPort) ? { port: parsedPort } : {}),
        ...(process.env["GREENLIGHT_HOST"] ? { host: process.env["GREENLIGHT_HOST"] } : {}),
        ...(process.env["GREENLIGHT_DATA_DIR"]
          ? { dataDir: process.env["GREENLIGHT_DATA_DIR"] }
          : {}),
      });
    }),
  );

/**
 * Test configuration: ephemeral port and a temporary data directory.
 */
export const layerTest = Layer.effect(
  ServerConfig,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dataDir = yield* fs.makeTempDirectoryScoped({ prefix: "greenlight-test-" });
    return yield* makeServerConfig({ version: "0.0.0-test", port: 0, dataDir });
  }),
);
