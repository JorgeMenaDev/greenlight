/**
 * BrowserDiagnostics - per-scenario browser logs and engine-owned evidence.
 *
 * The agent can inspect recent console output through a tool, while the
 * engine persists only the new console/page-error lines captured during each
 * step alongside the automatic post-step screenshot.
 */
import type { ConsoleMessage, Page } from "playwright";
import * as Effect from "effect/Effect";

import type { EvidenceRef, RunId } from "@greenlight/contracts";

import type { EvidenceStoreShape } from "../evidence/EvidenceStore.ts";

const BROWSER_LOG_LIMIT = 500;

export const makeBrowserDiagnostics = ({
  page,
  evidenceStore,
  runId,
}: {
  readonly page: Page;
  readonly evidenceStore: EvidenceStoreShape;
  readonly runId: RunId;
}) => {
  const messages: Array<string> = [];
  let cursor = 0;

  const push = (line: string) => {
    if (messages.length >= BROWSER_LOG_LIMIT) {
      messages.shift();
      cursor = Math.max(0, cursor - 1);
    }
    messages.push(line);
  };

  const formatConsoleMessage = (message: ConsoleMessage) =>
    `[console:${message.type()}] ${message.text()}`;

  page.on("console", (message) => {
    push(formatConsoleMessage(message));
  });
  page.on("pageerror", (error) => {
    push(`[pageerror] ${error.message}`);
  });

  const consumeConsoleMessages = () => {
    const next = messages.slice(cursor);
    cursor = messages.length;
    return next;
  };

  const captureStepEvidence = (stepNumber: number) =>
    Effect.gen(function* () {
      const evidence: Array<EvidenceRef> = [];
      const screenshotData = yield* Effect.promise(() =>
        page.screenshot({ type: "png" }).catch(() => undefined),
      );
      if (screenshotData !== undefined) {
        evidence.push(
          yield* evidenceStore.saveScreenshot(runId, `After step ${stepNumber}`, screenshotData),
        );
      }

      const consoleText = consumeConsoleMessages().join("\n");
      if (consoleText !== "") {
        evidence.push(
          yield* evidenceStore.saveConsoleLog(
            runId,
            `Console after step ${stepNumber}`,
            consoleText,
          ),
        );
      }

      return evidence;
    });

  return {
    readConsoleMessages: (): ReadonlyArray<string> => messages,
    captureStepEvidence,
  };
};
