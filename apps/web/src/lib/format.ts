/**
 * Small date/duration formatting helpers shared by run views.
 */

/** "3m ago", "2h ago", "just now"... */
export const relativeTime = (iso: string): string => {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
};

/** Duration between two ISO timestamps, e.g. "1.2s", "2m 04s". */
export const formatDuration = (
  startedAt: string | undefined,
  finishedAt: string | undefined,
): string | null => {
  if (startedAt === undefined) return null;
  const start = Date.parse(startedAt);
  const end = finishedAt !== undefined ? Date.parse(finishedAt) : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  const ms = Math.max(0, end - start);
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${String(rest).padStart(2, "0")}s`;
};

/** Absolute, locale-aware timestamp for tooltips/detail views. */
export const absoluteTime = (iso: string): string => {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? iso : new Date(parsed).toLocaleString();
};

/** Last path segment, used to compact project/feature paths. */
export const baseName = (path: string): string => {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
};
