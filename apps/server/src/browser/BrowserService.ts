/**
 * BrowserService - Playwright lifecycle.
 *
 * The browser launches lazily on first use and is closed when the service
 * layer's scope closes. Each scenario gets a fresh, isolated browser
 * context via `acquirePage`.
 *
 * @module BrowserService
 */
import * as NodeFsSync from "node:fs";

import { chromium, type Browser, type Page } from "playwright";

import type { BrowserStatus } from "@greenlight/contracts";

import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";

export class BrowserError extends Data.TaggedError("BrowserError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface AcquirePageOptions {
  readonly httpCredentials?:
    | {
        readonly username: string;
        readonly password: string;
      }
    | undefined;
}

export interface BrowserServiceShape {
  /**
   * Acquire a page in a fresh browser context. The context closes with
   * the caller's scope.
   */
  readonly acquirePage: (
    options?: AcquirePageOptions,
  ) => Effect.Effect<Page, BrowserError, Scope.Scope>;
  readonly status: Effect.Effect<BrowserStatus>;
}

export class BrowserService extends Context.Service<BrowserService, BrowserServiceShape>()(
  "greenlight/browser/BrowserService",
) {}

const isHeadless = () => process.env.GREENLIGHT_HEADFUL !== "1";

/**
 * Well-known install locations for the Chromium-family browsers that
 * Playwright can drive through its `channel` option, in preference order.
 * Used so machines that cannot download the bundled chromium (e.g. blocked
 * CDN access) can still run against a system browser.
 */
const systemChannelCandidates = () => {
  switch (process.platform) {
    case "darwin":
      return [
        {
          label: "Google Chrome",
          channel: "chrome",
          paths: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
        },
        {
          label: "Microsoft Edge",
          channel: "msedge",
          paths: ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
        },
      ];
    case "win32": {
      const programFiles = process.env.PROGRAMFILES ?? "C:\\Program Files";
      const programFilesX86 = process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)";
      const localAppData = process.env.LOCALAPPDATA;
      return [
        {
          label: "Google Chrome",
          channel: "chrome",
          paths: [
            `${programFiles}\\Google\\Chrome\\Application\\chrome.exe`,
            `${programFilesX86}\\Google\\Chrome\\Application\\chrome.exe`,
            ...(localAppData !== undefined
              ? [`${localAppData}\\Google\\Chrome\\Application\\chrome.exe`]
              : []),
          ],
        },
        {
          label: "Microsoft Edge",
          channel: "msedge",
          paths: [
            `${programFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
            `${programFilesX86}\\Microsoft\\Edge\\Application\\msedge.exe`,
          ],
        },
      ];
    }
    default:
      return [
        {
          label: "Google Chrome",
          channel: "chrome",
          paths: [
            "/opt/google/chrome/chrome",
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
          ],
        },
        {
          label: "Microsoft Edge",
          channel: "msedge",
          paths: ["/opt/microsoft/msedge/msedge", "/usr/bin/microsoft-edge"],
        },
      ];
  }
};

/** True when the bundled Playwright chromium has been downloaded. */
const hasBundledChromium = (): boolean => {
  try {
    return NodeFsSync.existsSync(chromium.executablePath());
  } catch {
    // executablePath throws when no browser is registered.
    return false;
  }
};

const systemBrowserCandidates = () =>
  systemChannelCandidates().map((candidate) => ({
    label: candidate.label,
    isAvailable: () => candidate.paths.some((path) => NodeFsSync.existsSync(path)),
    launch: (headless: boolean) => chromium.launch({ headless, channel: candidate.channel }),
  }));

const bundledChromiumCandidate = {
  label: "Playwright Chromium",
  isAvailable: hasBundledChromium,
  launch: (headless: boolean) => chromium.launch({ headless }),
};

const browserCandidates = () => [bundledChromiumCandidate, ...systemBrowserCandidates()];

const availableBrowserCandidates = () =>
  browserCandidates().filter((candidate) => candidate.isAvailable());

/**
 * Launch the first available browser candidate. If none are detected, try
 * bundled Chromium once so Playwright can surface its normal install error.
 */
const launchBrowser: Effect.Effect<Browser, BrowserError> = Effect.tryPromise({
  try: async () => {
    const headless = isHeadless();
    const candidates = availableBrowserCandidates();
    const launchOrder = candidates.length > 0 ? candidates : [bundledChromiumCandidate];
    let firstError: unknown;

    for (const candidate of launchOrder) {
      try {
        return await candidate.launch(headless);
      } catch (error) {
        firstError ??= error;
      }
    }

    throw firstError;
  },
  catch: (cause) =>
    new BrowserError({
      message:
        "Failed to launch a browser. Install one with `pnpm --filter @greenlight/server exec playwright install chromium` or install Google Chrome.",
      cause,
    }),
});

export const make = Effect.gen(function* () {
  const layerScope = yield* Effect.service(Scope.Scope);
  const browserRef = yield* Ref.make<Browser | undefined>(undefined);
  const launchLock = yield* Semaphore.make(1);

  const getBrowser = launchLock.withPermits(1)(
    Effect.gen(function* () {
      const existing = yield* Ref.get(browserRef);
      if (existing?.isConnected()) {
        return existing;
      }
      const browser = yield* launchBrowser;
      yield* Scope.addFinalizer(
        layerScope,
        Effect.promise(() => browser.close()).pipe(Effect.ignore),
      );
      yield* Ref.set(browserRef, browser);
      return browser;
    }),
  );

  const acquirePage: BrowserServiceShape["acquirePage"] = (options = {}) =>
    Effect.gen(function* () {
      const browser = yield* getBrowser;
      const context = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () =>
            browser.newContext({
              viewport: { width: 1280, height: 720 },
              ...(options.httpCredentials !== undefined
                ? { httpCredentials: options.httpCredentials }
                : {}),
            }),
          catch: (cause) =>
            new BrowserError({ message: "Failed to create browser context", cause }),
        }),
        (ctx) => Effect.promise(() => ctx.close()).pipe(Effect.ignore),
      );
      return yield* Effect.tryPromise({
        try: () => context.newPage(),
        catch: (cause) => new BrowserError({ message: "Failed to open page", cause }),
      });
    });

  const status: BrowserServiceShape["status"] = Effect.sync(() => {
    if (availableBrowserCandidates().length > 0) {
      return { state: "ready" } satisfies BrowserStatus;
    }
    return {
      state: "missing",
      detail:
        "No Playwright chromium found. Run `pnpm --filter @greenlight/server exec playwright install chromium` or install Google Chrome.",
    } satisfies BrowserStatus;
  });

  return { acquirePage, status } satisfies BrowserServiceShape;
});

export const BrowserServiceLive = Layer.effect(BrowserService, make);
