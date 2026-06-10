/**
 * Preload - exposes a minimal, promise-based desktop bridge to the renderer
 * under `window.greenlightDesktop`.
 *
 * @module preload
 */
import { contextBridge, ipcRenderer } from "electron";

import { OPEN_EXTERNAL_CHANNEL, PICK_FOLDER_CHANNEL } from "./ipc/channels.ts";

export interface GreenlightDesktopBridge {
  /** Opens a native directory picker; resolves to null when cancelled. */
  readonly pickFolder: () => Promise<string | null>;
  /** Opens an http/https URL in the default browser. */
  readonly openExternal: (url: string) => Promise<boolean>;
}

const bridge: GreenlightDesktopBridge = {
  pickFolder: () => ipcRenderer.invoke(PICK_FOLDER_CHANNEL),
  openExternal: (url) => ipcRenderer.invoke(OPEN_EXTERNAL_CHANNEL, url),
};

contextBridge.exposeInMainWorld("greenlightDesktop", bridge);
