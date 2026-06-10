/**
 * IPC channel names shared between the main process handlers and the
 * preload bridge. Kept dependency-free so the preload bundle stays tiny.
 *
 * @module channels
 */
export const PICK_FOLDER_CHANNEL = "greenlight:pick-folder";
export const OPEN_EXTERNAL_CHANNEL = "greenlight:open-external";
