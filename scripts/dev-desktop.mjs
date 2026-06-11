/**
 * Dev orchestrator for the Electron desktop shell.
 *
 * Starts the vite dev server (apps/web), waits until it responds over HTTP,
 * then launches the Electron app (apps/desktop) with VITE_DEV_SERVER_URL set
 * so the main window loads the live renderer. When either process exits, the
 * other is torn down.
 */
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const VITE_PORT = Number(process.env.GREENLIGHT_WEB_PORT ?? 5733);
const VITE_URL = `http://localhost:${VITE_PORT}/`;
const WAIT_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 250;

const children = [];
let shuttingDown = false;

const shutdown = (code) => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
  }
  setTimeout(() => process.exit(code), 500);
};

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));

const run = (name, command, args, env = {}) => {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  child.on("exit", (code) => {
    console.log(`[dev-desktop] ${name} exited with code ${code ?? 0}`);
    shutdown(code ?? 0);
  });
  children.push(child);
  return child;
};

const waitForVite = async () => {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (shuttingDown) return false;
    try {
      const response = await fetch(VITE_URL, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return true;
    } catch {
      // not up yet
    }
    await delay(POLL_INTERVAL_MS);
  }
  return false;
};

console.log(`[dev-desktop] starting vite dev server on ${VITE_URL} ...`);
run("vite", "pnpm", ["--filter", "@greenlight/web", "dev", "--port", String(VITE_PORT), "--strictPort"]);

const ready = await waitForVite();
if (!ready) {
  console.error(`[dev-desktop] vite did not become ready within ${WAIT_TIMEOUT_MS / 1000}s`);
  shutdown(1);
} else {
  console.log("[dev-desktop] vite is ready; launching electron ...");
  run("electron", "pnpm", ["--filter", "@greenlight/desktop", "dev"], {
    VITE_DEV_SERVER_URL: VITE_URL,
  });
}
