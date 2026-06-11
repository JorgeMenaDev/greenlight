import { defineConfig } from "tsdown";

/**
 * Bundles the server entry to a single ESM file at dist/bin.mjs.
 *
 * The @greenlight/* workspace packages export raw .ts sources, so they are
 * bundled in. Everything that must resolve at runtime from node_modules
 * (the Copilot CLI, Playwright, and the large stable libraries) stays
 * external; the deploy script (scripts/deploy.mjs) installs exactly those
 * into deploy/node_modules.
 */
export default defineConfig({
  entry: { bin: "src/bin.ts" },
  outDir: "dist",
  format: "esm",
  platform: "node",
  target: "node22",
  // package.json has "type": "module" so plain .js would already be ESM, but
  // the Electron BackendManager and deploy layout pin the name dist/bin.mjs.
  outExtensions: () => ({ js: ".mjs" }),
  external: [
    /^playwright(\/|$)/,
    /^playwright-core(\/|$)/,
    /^@github\/copilot-sdk(\/|$)/,
    /^@github\/copilot(\/|$)/,
    /^effect(\/|$)/,
    /^@effect\/platform-node(\/|$)/,
    /^@cucumber\/gherkin(\/|$)/,
    /^@cucumber\/messages(\/|$)/,
  ],
  noExternal: [/^@greenlight\//],
  // The Copilot CLI shim is spawned as its own process entry (see
  // CopilotService.resolveCliShim), so it must ship next to the bundle.
  copy: ["src/copilot/copilot-cli-shim.js"],
  dts: false,
  clean: true,
});
