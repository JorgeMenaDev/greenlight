/**
 * ElectronApp - Thin Effect service wrapper over `Electron.app`.
 *
 * @module ElectronApp
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

import * as Electron from "electron";

export type ElectronAppPathName = Parameters<Electron.App["getPath"]>[0];

export interface ElectronAppShape {
  /** Resolves once Electron has finished initialization. */
  readonly whenReady: Effect.Effect<void>;
  /** Asks Electron to quit (fires `before-quit`). */
  readonly quit: Effect.Effect<void>;
  /** Exits immediately, skipping `before-quit` / `will-quit`. */
  readonly exit: (code: number) => Effect.Effect<void>;
  readonly getPath: (name: ElectronAppPathName) => Effect.Effect<string>;
  readonly isPackaged: Effect.Effect<boolean>;
  /** Registers an app event listener, removed when the scope closes. */
  readonly on: <Args extends ReadonlyArray<unknown>>(
    eventName: string,
    listener: (...args: Args) => void,
  ) => Effect.Effect<void, never, Scope.Scope>;
}

export class ElectronApp extends Context.Service<ElectronApp, ElectronAppShape>()(
  "@greenlight/desktop/electron/ElectronApp",
) {}

const addScopedAppListener = <Args extends ReadonlyArray<unknown>>(
  eventName: string,
  listener: (...args: Args) => void,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => {
      Electron.app.on(eventName as never, listener as never);
    }),
    () =>
      Effect.sync(() => {
        Electron.app.removeListener(eventName as never, listener as never);
      }),
  ).pipe(Effect.asVoid);

const make = ElectronApp.of({
  whenReady: Effect.promise(() => Electron.app.whenReady()).pipe(Effect.asVoid),
  quit: Effect.sync(() => {
    Electron.app.quit();
  }),
  exit: (code) =>
    Effect.sync(() => {
      Electron.app.exit(code);
    }),
  getPath: (name) => Effect.sync(() => Electron.app.getPath(name)),
  isPackaged: Effect.sync(() => Electron.app.isPackaged),
  on: addScopedAppListener,
});

export const layer = Layer.succeed(ElectronApp, make);
