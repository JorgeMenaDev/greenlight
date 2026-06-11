/**
 * Spawned in place of the Copilot CLI (via COPILOT_CLI_PATH) when the server
 * runs under Electron-as-Node.
 *
 * commander.js inside the CLI sees `process.versions.electron` without
 * `process.defaultApp` and parses argv as `argv.slice(1)`, so the script path
 * itself becomes a positional argument ("too many arguments. Expected 0
 * arguments but got 1."). Claiming defaultApp before the CLI loads restores
 * node-style `argv.slice(2)` parsing. Under plain Node this is a no-op
 * pass-through.
 */
import { pathToFileURL } from "node:url";

if (process.versions.electron && !process.defaultApp) {
  process.defaultApp = true;
}

const realCli = process.env["GREENLIGHT_COPILOT_CLI"];
if (!realCli) {
  process.stderr.write("copilot-cli-shim: GREENLIGHT_COPILOT_CLI is not set\n");
  process.exit(1);
}

process.argv[1] = realCli;
await import(pathToFileURL(realCli).href);
