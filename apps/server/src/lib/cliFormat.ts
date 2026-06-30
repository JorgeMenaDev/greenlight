/**
 * Shared terminal formatting helpers for demo and benchmark CLIs.
 *
 * @module cliFormat
 */
import * as Effect from "effect/Effect";

import type { Usage } from "@greenlight/contracts";

export const color = {
  green: (text: string) => `\x1b[32m${text}\x1b[0m`,
  red: (text: string) => `\x1b[31m${text}\x1b[0m`,
  yellow: (text: string) => `\x1b[33m${text}\x1b[0m`,
  dim: (text: string) => `\x1b[2m${text}\x1b[0m`,
  bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
};

export const writeLine = (text: string) =>
  Effect.sync(() => {
    process.stdout.write(`${text}\n`);
  });

/** Compact token count for terminal tables, e.g. "812", "12.3k". */
export const formatTokens = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;

/** Wall-clock duration for benchmark rows. */
export const formatDurationMs = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m${rest.toString().padStart(2, "0")}s`;
};

export const formatUsage = (usage: Usage): string =>
  `${formatTokens(usage.inputTokens)} in / ${formatTokens(usage.outputTokens)} out \u00b7 ` +
  `${usage.premiumRequestCost.toFixed(2)} premium req`;
