/**
 * ElectronDialog - Thin Effect service wrapper over `Electron.dialog`.
 *
 * @module ElectronDialog
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as Electron from "electron";

export interface ElectronDialogShape {
  /**
   * Opens a native directory picker. Resolves to `None` when the user
   * cancels the dialog.
   */
  readonly pickFolder: Effect.Effect<Option.Option<string>>;
}

export class ElectronDialog extends Context.Service<ElectronDialog, ElectronDialogShape>()(
  "@greenlight/desktop/electron/ElectronDialog",
) {}

const make = ElectronDialog.of({
  pickFolder: Effect.promise(() =>
    Electron.dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
    }),
  ).pipe(
    Effect.map((result) =>
      result.canceled ? Option.none<string>() : Option.fromNullishOr(result.filePaths[0]),
    ),
  ),
});

export const layer = Layer.succeed(ElectronDialog, make);
