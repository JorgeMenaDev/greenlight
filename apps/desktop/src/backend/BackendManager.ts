/**
 * BackendManager - Spawns and supervises the Greenlight server as a child
 * process of the Electron main process.
 *
 * - Resolves a free loopback port via the shared Net helpers.
 * - Runs the server with `ELECTRON_RUN_AS_NODE=1` so the child is a plain
 *   Node process (dev: repo's apps/server/src/bin.ts; prod: the bundled
 *   server entry under process.resourcesPath).
 * - Polls GET /healthz every 250ms (up to 30s) for readiness.
 * - Restarts on unexpected exit with capped exponential backoff (500ms→10s).
 * - On scope close (app quit), terminates the child with SIGTERM, escalating
 *   to SIGKILL after 3s, so no orphan node/copilot/chromium processes remain.
 *
 * @module BackendManager
 */
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";

import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

import * as Net from "@greenlight/shared/Net";

import * as ElectronApp from "../electron/ElectronApp.ts";

const PREFERRED_PORT = 4773;
const READINESS_INTERVAL_MS = 250;
const READINESS_TIMEOUT_MS = 30_000;
const TERMINATE_GRACE_MS = 3_000;
const INITIAL_RESTART_DELAY_MS = 500;
const MAX_RESTART_DELAY_MS = 10_000;

export class BackendStartupError extends Data.TaggedError("BackendStartupError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface BackendManagerShape {
  /** Resolved base URL of the embedded server, e.g. `http://127.0.0.1:4773`. */
  readonly backendUrl: string;
  /** Resolves once the server has passed its first /healthz check. */
  readonly awaitReady: Effect.Effect<void, BackendStartupError>;
}

export class BackendManager extends Context.Service<BackendManager, BackendManagerShape>()(
  "@greenlight/desktop/backend/BackendManager",
) {}

interface BackendCommand {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}

/**
 * In dev (`GREENLIGHT_DESKTOP_DEV=1`) the bundled main.cjs lives at
 * apps/desktop/dist-electron, so the repo root is three levels up and the
 * server runs straight from its TypeScript entry (Node 22 type stripping).
 * In prod the packaged server bundle ships under process.resourcesPath.
 */
const resolveBackendCommand = (): BackendCommand => {
  if (process.env["GREENLIGHT_DESKTOP_DEV"] === "1") {
    const repoRoot = NodePath.resolve(__dirname, "..", "..", "..");
    return {
      // Electron-as-Node (ELECTRON_RUN_AS_NODE=1), same as prod: the server
      // has no native modules, so dev and packaged runs share a runtime.
      command: process.execPath,
      args: [NodePath.join(repoRoot, "apps", "server", "src", "bin.ts")],
    };
  }
  return {
    command: process.execPath,
    args: [NodePath.join(process.resourcesPath, "server", "dist", "bin.mjs")],
  };
};

const hasExited = (child: NodeChildProcess.ChildProcess): boolean =>
  child.exitCode !== null || child.signalCode !== null;

/**
 * Spawns the server child process; the release action sends SIGTERM and
 * escalates to SIGKILL after a grace period, resuming once the child exits.
 */
const spawnBackend = (
  command: BackendCommand,
  env: Record<string, string>,
): Effect.Effect<NodeChildProcess.ChildProcess, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() =>
      NodeChildProcess.spawn(command.command, [...command.args], {
        env: {
          ...process.env,
          ...env,
          ELECTRON_RUN_AS_NODE: "1",
        },
        stdio: ["ignore", "inherit", "inherit"],
      }),
    ),
    (child) =>
      Effect.callback<void>((resume) => {
        if (child.pid === undefined || hasExited(child)) {
          resume(Effect.void);
          return;
        }
        const forceKill = setTimeout(() => {
          if (!hasExited(child)) {
            child.kill("SIGKILL");
          }
        }, TERMINATE_GRACE_MS);
        const settle = () => {
          clearTimeout(forceKill);
          resume(Effect.void);
        };
        child.once("exit", settle);
        child.once("error", settle);
        child.kill("SIGTERM");
      }),
  );

/** Waits for the child to exit (or fail to spawn) and describes why. */
const awaitExit = (child: NodeChildProcess.ChildProcess): Effect.Effect<string> =>
  Effect.callback<string>((resume) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resume(Effect.succeed(`code=${child.exitCode} signal=${child.signalCode}`));
      return;
    }
    child.once("exit", (code, signal) => {
      resume(Effect.succeed(`code=${code} signal=${signal}`));
    });
    child.once("error", (error) => {
      resume(Effect.succeed(`spawn error: ${error.message}`));
    });
  });

/** Polls GET /healthz until it responds OK; resolves to readiness. */
const pollHealthz = (backendUrl: string): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const attempts = Math.ceil(READINESS_TIMEOUT_MS / READINESS_INTERVAL_MS);
    for (let attempt = 0; attempt < attempts; attempt++) {
      const healthy = yield* Effect.promise(() =>
        fetch(`${backendUrl}/healthz`).then(
          (response) => response.ok,
          () => false,
        ),
      );
      if (healthy) {
        return true;
      }
      yield* Effect.sleep(Duration.millis(READINESS_INTERVAL_MS));
    }
    return false;
  });

const make = Effect.gen(function* () {
  const scope = yield* Effect.service(Scope.Scope);
  const electronApp = yield* Effect.service(ElectronApp.ElectronApp);

  const net = Net.make();
  const port = yield* net.findAvailablePort(PREFERRED_PORT).pipe(
    Effect.mapError(
      (error) =>
        new BackendStartupError({
          message: `Could not find a free port for the Greenlight server: ${error.message}`,
          cause: error.cause,
        }),
    ),
  );
  const backendUrl = `http://127.0.0.1:${port}`;
  const dataDir = yield* electronApp.getPath("userData");
  const firstReady = yield* Deferred.make<void, BackendStartupError>();

  const command = resolveBackendCommand();
  const env: Record<string, string> = {
    GREENLIGHT_PORT: String(port),
    GREENLIGHT_HOST: "127.0.0.1",
    GREENLIGHT_DATA_DIR: dataDir,
  };

  const supervise = Effect.gen(function* () {
    let restartAttempt = 0;
    while (true) {
      let becameReady = false;
      const exitReason = yield* Effect.scoped(
        Effect.gen(function* () {
          const child = yield* spawnBackend(command, env);
          yield* Effect.forkScoped(
            pollHealthz(backendUrl).pipe(
              Effect.flatMap((ready) =>
                ready
                  ? Effect.sync(() => {
                      becameReady = true;
                    }).pipe(Effect.andThen(Deferred.succeed(firstReady, void 0)))
                  : Deferred.fail(
                      firstReady,
                      new BackendStartupError({
                        message: `Greenlight server did not become ready at ${backendUrl}/healthz within ${READINESS_TIMEOUT_MS}ms.`,
                      }),
                    ),
              ),
            ),
          );
          return yield* awaitExit(child);
        }),
      );

      if (becameReady) {
        restartAttempt = 0;
      }
      const delayMs = Math.min(
        INITIAL_RESTART_DELAY_MS * 2 ** restartAttempt,
        MAX_RESTART_DELAY_MS,
      );
      restartAttempt += 1;
      yield* Effect.logWarning(
        `Greenlight server exited unexpectedly (${exitReason}); restarting in ${delayMs}ms.`,
      );
      yield* Effect.sleep(Duration.millis(delayMs));
    }
  });

  yield* Effect.forkIn(supervise, scope);

  return BackendManager.of({
    backendUrl,
    awaitReady: Deferred.await(firstReady),
  });
});

export const layer: Layer.Layer<BackendManager, BackendStartupError, ElectronApp.ElectronApp> =
  Layer.effect(BackendManager, make);
