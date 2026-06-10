/**
 * ElectronShell - Thin Effect service wrapper over `Electron.shell`.
 *
 * Only http/https URLs are allowed through {@link parseSafeExternalUrl} so
 * the renderer can never ask the main process to open arbitrary protocols.
 *
 * @module ElectronShell
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as Electron from "electron";

const SAFE_EXTERNAL_PROTOCOLS = new Set(["http:", "https:"]);

export function parseSafeExternalUrl(rawUrl: unknown): Option.Option<string> {
  if (typeof rawUrl !== "string") {
    return Option.none();
  }

  try {
    const url = new URL(rawUrl);
    return SAFE_EXTERNAL_PROTOCOLS.has(url.protocol) ? Option.some(url.href) : Option.none();
  } catch {
    return Option.none();
  }
}

export interface ElectronShellShape {
  /**
   * Opens an http/https URL in the user's default browser. Resolves to
   * `false` for invalid/unsafe URLs or when the OS refuses to open it.
   */
  readonly openExternal: (rawUrl: unknown) => Effect.Effect<boolean>;
}

export class ElectronShell extends Context.Service<ElectronShell, ElectronShellShape>()(
  "@greenlight/desktop/electron/ElectronShell",
) {}

const make = ElectronShell.of({
  openExternal: (rawUrl) =>
    Option.match(parseSafeExternalUrl(rawUrl), {
      onNone: () => Effect.succeed(false),
      onSome: (externalUrl) =>
        Effect.promise(() =>
          Electron.shell.openExternal(externalUrl).then(
            () => true,
            () => false,
          ),
        ),
    }),
});

export const layer = Layer.succeed(ElectronShell, make);
