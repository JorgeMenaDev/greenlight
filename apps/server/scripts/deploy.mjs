#!/usr/bin/env node
/**
 * Produces apps/server/deploy/ - a self-contained production server directory
 * that electron-builder ships as an extraResource (resources/server):
 *
 *   deploy/
 *     dist/bin.mjs        the tsdown bundle (run `pnpm build` first)
 *     package.json        prod deps only = the bundle's externals
 *     node_modules/       real (non-symlinked) install via `npm install --omit=dev`
 *
 * Versions are pinned from what is actually installed in the workspace so the
 * deploy install matches what the bundle was built and tested against.
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const serverDir = path.resolve(import.meta.dirname, "..");
const distDir = path.join(serverDir, "dist");
const deployDir = path.join(serverDir, "deploy");

if (!existsSync(path.join(distDir, "bin.mjs"))) {
  console.error("apps/server/dist/bin.mjs not found. Run `pnpm --filter @greenlight/server build` first.");
  process.exit(1);
}

const readPkg = (dir) => JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));

/** Exact installed version of a direct dependency of @greenlight/server. */
const direct = (name) => readPkg(path.join(serverDir, "node_modules", name));

/**
 * Exact installed version of a transitive dependency, resolved from the pnpm
 * virtual store sibling of its parent (pnpm strict layout has no flat
 * node_modules to look in).
 */
const transitive = (parentName, name) => {
  const parentReal = realpathSync(path.join(serverDir, "node_modules", parentName));
  // parentReal = .../.pnpm/<parent>@<v>/node_modules/<parentName>
  const storeNodeModules = parentName.startsWith("@")
    ? path.join(parentReal, "..", "..")
    : path.join(parentReal, "..");
  return readPkg(path.join(storeNodeModules, name));
};

const serverPkg = readPkg(serverDir);

const dependencies = {
  "@cucumber/gherkin": direct("@cucumber/gherkin").version,
  "@cucumber/messages": direct("@cucumber/messages").version,
  "@effect/platform-node": direct("@effect/platform-node").version,
  "@github/copilot": transitive("@github/copilot-sdk", "@github/copilot").version,
  "@github/copilot-sdk": direct("@github/copilot-sdk").version,
  effect: direct("effect").version,
  playwright: direct("playwright").version,
};

rmSync(deployDir, { recursive: true, force: true });
mkdirSync(deployDir, { recursive: true });
cpSync(distDir, path.join(deployDir, "dist"), { recursive: true });

writeFileSync(
  path.join(deployDir, "package.json"),
  JSON.stringify(
    {
      name: "greenlight-server",
      version: serverPkg.version,
      private: true,
      type: "module",
      bin: { "greenlight-server": "./dist/bin.mjs" },
      dependencies,
    },
    null,
    2,
  ) + "\n",
);

console.log("Installing production dependencies into deploy/ ...");
execSync("npm install --omit=dev --no-audit --no-fund --loglevel=error", {
  cwd: deployDir,
  stdio: "inherit",
});

const mustExist = [
  "dist/bin.mjs",
  "node_modules/@github/copilot",
  "node_modules/playwright",
  "node_modules/effect",
];
for (const rel of mustExist) {
  if (!existsSync(path.join(deployDir, rel))) {
    console.error(`deploy verification failed: missing ${rel}`);
    process.exit(1);
  }
}

console.log(`Deploy directory ready: ${deployDir}`);
