/**
 * IPC handlers - registers `ipcMain.handle` listeners for the renderer
 * bridge exposed by preload.ts. Handlers are removed when the layer scope
 * closes.
 *
 * @module handlers
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";

import * as Electron from "electron";

import * as ElectronDialog from "../electron/ElectronDialog.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import { OPEN_EXTERNAL_CHANNEL, PICK_FOLDER_CHANNEL } from "./channels.ts";

const decodeUrl = Schema.decodeUnknownEffect(Schema.String);

const registerHandler = (
  channel: string,
  listener: (event: Electron.IpcMainInvokeEvent, payload: unknown) => Promise<unknown>,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => {
      Electron.ipcMain.removeHandler(channel);
      Electron.ipcMain.handle(channel, listener);
    }),
    () =>
      Effect.sync(() => {
        Electron.ipcMain.removeHandler(channel);
      }),
  ).pipe(Effect.asVoid);

const registerIpcHandlers = Effect.gen(function* () {
  const dialog = yield* Effect.service(ElectronDialog.ElectronDialog);
  const shell = yield* Effect.service(ElectronShell.ElectronShell);

  yield* registerHandler(PICK_FOLDER_CHANNEL, () =>
    Effect.runPromise(Effect.map(dialog.pickFolder, Option.getOrNull)),
  );

  yield* registerHandler(OPEN_EXTERNAL_CHANNEL, (_event, rawUrl) =>
    Effect.runPromise(
      decodeUrl(rawUrl).pipe(
        Effect.flatMap((url) => shell.openExternal(url)),
        Effect.catch(() => Effect.succeed(false)),
      ),
    ),
  );
});

export const layer: Layer.Layer<
  never,
  never,
  ElectronDialog.ElectronDialog | ElectronShell.ElectronShell
> = Layer.effectDiscard(registerIpcHandlers);
