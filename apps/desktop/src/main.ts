/**
 * Electron main process entry point for the Greenlight desktop shell.
 *
 * Composes the Effect layers (Electron wrappers, backend child-process
 * manager, main window, IPC handlers) and runs the application program with
 * NodeRuntime.runMain.
 *
 * Shutdown flow: `before-quit` is intercepted once, the main program is
 * released (or runMain's SIGINT/SIGTERM handling interrupts it), all layer
 * finalizers run — killing the server child process and everything it
 * spawned (copilot, chromium) — and only then does the app exit. This
 * guarantees no orphan processes.
 *
 * @module main
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Electron from "electron";

import * as BackendManager from "./backend/BackendManager.ts";
import * as ElectronApp from "./electron/ElectronApp.ts";
import * as ElectronDialog from "./electron/ElectronDialog.ts";
import * as ElectronShell from "./electron/ElectronShell.ts";
import * as IpcHandlers from "./ipc/handlers.ts";
import * as MainWindow from "./window/MainWindow.ts";

const electronLayer = Layer.mergeAll(ElectronApp.layer, ElectronDialog.layer, ElectronShell.layer);

const mainLayer = Layer.mergeAll(BackendManager.layer, MainWindow.layer, IpcHandlers.layer).pipe(
  Layer.provideMerge(electronLayer),
);

const program = Effect.gen(function* () {
  const app = yield* Effect.service(ElectronApp.ElectronApp);
  const backend = yield* Effect.service(BackendManager.BackendManager);
  const mainWindow = yield* Effect.service(MainWindow.MainWindow);

  const quitSignal = yield* Deferred.make<void>();
  let shutdownRequested = false;

  // Intercept the first quit request so the Effect runtime can tear down
  // (killing the backend child process) before the app actually exits.
  yield* app.on("before-quit", (event: Electron.Event) => {
    if (shutdownRequested) {
      return;
    }
    shutdownRequested = true;
    event.preventDefault();
    Effect.runSync(Deferred.succeed(quitSignal, void 0));
  });

  // Quit when all windows are closed, except on macOS.
  yield* app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      Electron.app.quit();
    }
  });

  // macOS: re-create the main window when the dock icon is activated.
  yield* app.on("activate", () => {
    if (!shutdownRequested) {
      Effect.runFork(mainWindow.ensure(backend.backendUrl));
    }
  });

  yield* app.whenReady;
  yield* backend.awaitReady;
  yield* mainWindow.create(backend.backendUrl);

  yield* Deferred.await(quitSignal);
});

Effect.scoped(program).pipe(
  Effect.provide(mainLayer),
  // Runs after all layer finalizers: the backend child is dead by now, so
  // it is safe to exit without re-triggering `before-quit`.
  Effect.ensuring(
    Effect.sync(() => {
      Electron.app.exit(0);
    }),
  ),
  NodeRuntime.runMain,
);
