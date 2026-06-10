import { defineConfig, type UserConfig } from "tsdown";

/**
 * Bundles the Electron main process and the preload script to CommonJS.
 *
 * Built as two separate single-entry configs so no shared chunk is emitted:
 * sandboxed preload scripts cannot `require` local files, so preload.cjs
 * must be fully self-contained.
 *
 * Everything except the `electron` builtin is bundled so the packaged app
 * does not need node_modules at runtime (workspace packages export raw .ts
 * sources which must be bundled anyway).
 */
const shared: UserConfig = {
  outDir: "dist-electron",
  format: "cjs",
  platform: "node",
  target: "node22",
  external: ["electron"],
  noExternal: [/^effect(\/|$)/, /^@effect\//, /^@greenlight\//],
  dts: false,
};

export default defineConfig([
  {
    ...shared,
    entry: { main: "src/main.ts" },
    // Both configs build concurrently into the same outDir, so cleaning is
    // disabled to avoid one build deleting the other's output.
    clean: false,
  },
  {
    ...shared,
    entry: { preload: "src/preload.ts" },
    clean: false,
  },
]);
