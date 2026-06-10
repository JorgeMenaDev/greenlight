/**
 * Bridge exposed by the Electron preload script. Absent when the app runs
 * in a plain browser, so every use must be optional-chained.
 */
export {};

declare global {
  interface Window {
    greenlightDesktop?: {
      pickFolder(): Promise<string | null>;
      openExternal(url: string): Promise<void>;
    };
  }
}
