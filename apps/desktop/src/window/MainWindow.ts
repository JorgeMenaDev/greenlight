/**
 * MainWindow - Creates and tracks the single main BrowserWindow.
 *
 * In dev (vite dev server running) the renderer is loaded from
 * VITE_DEV_SERVER_URL with the backend URL passed as a `?server=` query
 * parameter; in prod the renderer is served by the embedded server itself.
 *
 * @module MainWindow
 */
import * as NodePath from "node:path";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Electron from "electron";

const WINDOW_BACKGROUND_COLOR = "#111111";

const isDesktopDev = (): boolean => process.env["GREENLIGHT_DESKTOP_DEV"] === "1";

const resolveRendererUrl = (backendUrl: string): string => {
  const devServerUrl = process.env["VITE_DEV_SERVER_URL"];
  return devServerUrl !== undefined && devServerUrl.length > 0
    ? `${devServerUrl}?server=${encodeURIComponent(backendUrl)}`
    : backendUrl;
};

export interface MainWindowShape {
  /** Creates the main window and loads the renderer. */
  readonly create: (backendUrl: string) => Effect.Effect<Electron.BrowserWindow>;
  /** Focuses the existing main window, or creates one if none is open. */
  readonly ensure: (backendUrl: string) => Effect.Effect<void>;
}

export class MainWindow extends Context.Service<MainWindow, MainWindowShape>()(
  "@greenlight/desktop/window/MainWindow",
) {}

const make = Effect.sync(() => {
  let current: Electron.BrowserWindow | null = null;

  const create = (backendUrl: string): Effect.Effect<Electron.BrowserWindow> =>
    Effect.sync(() => {
      const window = new Electron.BrowserWindow({
        width: 1280,
        height: 800,
        backgroundColor: WINDOW_BACKGROUND_COLOR,
        webPreferences: {
          preload: NodePath.join(__dirname, "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      current = window;
      window.on("closed", () => {
        if (current === window) {
          current = null;
        }
      });
      void window.loadURL(resolveRendererUrl(backendUrl));
      if (isDesktopDev()) {
        window.webContents.openDevTools({ mode: "detach" });
      }
      return window;
    });

  const ensure = (backendUrl: string): Effect.Effect<void> =>
    Effect.suspend(() => {
      if (current !== null && !current.isDestroyed()) {
        const window = current;
        return Effect.sync(() => {
          if (window.isMinimized()) {
            window.restore();
          }
          window.show();
          window.focus();
        });
      }
      return Effect.asVoid(create(backendUrl));
    });

  return MainWindow.of({ create, ensure });
});

export const layer: Layer.Layer<MainWindow> = Layer.effect(MainWindow, make);
