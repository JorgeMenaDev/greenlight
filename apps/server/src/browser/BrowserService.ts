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
  /** Used only for labeling; navigation is the engine's job. */
  readonly headless?: boolean;
}

export interface BrowserServiceShape {
  /**
   * Acquire a page in a fresh browser context. The context closes with
   * the caller's scope.
   */
  readonly acquirePage: Effect.Effect<Page, BrowserError, Scope.Scope>;
  readonly status: Effect.Effect<BrowserStatus>;
}

export class BrowserService extends Context.Service<BrowserService, BrowserServiceShape>()(
  "greenlight/browser/BrowserService",
) {}

const isHeadless = () => process.env["GREENLIGHT_HEADFUL"] !== "1";

/**
 * Launch the bundled chromium; fall back to the system Chrome channel so
 * users who never ran `playwright install` can still run tests.
 */
const launchBrowser: Effect.Effect<Browser, BrowserError> = Effect.tryPromise({
  try: async () => {
    const headless = isHeadless();
    try {
      return await chromium.launch({ headless });
    } catch (chromiumError) {
      try {
        return await chromium.launch({ headless, channel: "chrome" });
      } catch {
        throw chromiumError;
      }
    }
  },
  catch: (cause) =>
    new BrowserError({
      message:
        "Failed to launch a browser. Install one with `npx playwright install chromium` or install Google Chrome.",
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
      if (existing !== undefined && existing.isConnected()) {
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

  const acquirePage: BrowserServiceShape["acquirePage"] = Effect.gen(function* () {
    const browser = yield* getBrowser;
    const context = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () => browser.newContext({ viewport: { width: 1280, height: 720 } }),
        catch: (cause) => new BrowserError({ message: "Failed to create browser context", cause }),
      }),
      (ctx) => Effect.promise(() => ctx.close()).pipe(Effect.ignore),
    );
    return yield* Effect.tryPromise({
      try: () => context.newPage(),
      catch: (cause) => new BrowserError({ message: "Failed to open page", cause }),
    });
  });

  const status: BrowserServiceShape["status"] = Effect.sync(() => {
    try {
      if (NodeFsSync.existsSync(chromium.executablePath())) {
        return { state: "ready" } satisfies BrowserStatus;
      }
    } catch {
      // executablePath throws when no browser is registered.
    }
    return {
      state: "missing",
      detail:
        "No Playwright chromium found. Run `npx playwright install chromium` or install Google Chrome.",
    } satisfies BrowserStatus;
  });

  return { acquirePage, status } satisfies BrowserServiceShape;
});

export const BrowserServiceLive = Layer.effect(BrowserService, make);
