#!/usr/bin/env node
/**
 * Greenlight server entry point.
 *
 *   greenlight-server                 start the server (GREENLIGHT_* env config)
 *   greenlight-server demo <feature> --url <baseUrl> [--model <id>]
 *   greenlight-server benchmark <feature> --url <baseUrl> [--models <a,b,c>] [--out <path>] [--no-cache|--refresh]
 *
 * Reasoning effort is not pinned: only the model id is passed to Copilot,
 * so each model runs at its runtime default.
 *
 * @module bin
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import packageJson from "../package.json" with { type: "json" };
import { benchmarkLayer, benchmarkProgram } from "./benchmark.ts";
import { layerFromEnv } from "./config.ts";
import { demoLayer, demoProgram } from "./demo.ts";
import { makeServerLayer } from "./server.ts";

const flagValue = (args: ReadonlyArray<string>, flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const hasFlag = (args: ReadonlyArray<string>, flag: string): boolean => args.includes(flag);

// Only ServerConfig is provided at the edge; everything else is wired
// inside `makeServerLayer` / `demoLayer`.
const configLayer = layerFromEnv(packageJson.version).pipe(Layer.provide(NodeServices.layer));

const args = process.argv.slice(2);

if (args[0] === "demo") {
  const featurePath = args[1];
  const baseUrl = flagValue(args, "--url");
  if (featurePath === undefined || baseUrl === undefined) {
    process.stderr.write(
      "Usage: greenlight-server demo <file.feature> --url <baseUrl> [--model <id>]\n",
    );
    process.exit(2);
  }
  demoProgram({ featurePath, baseUrl, model: flagValue(args, "--model") }).pipe(
    Effect.provide(demoLayer.pipe(Layer.provideMerge(configLayer))),
    Effect.provide(NodeServices.layer),
    Effect.scoped,
    NodeRuntime.runMain,
  );
} else if (args[0] === "benchmark") {
  const featurePath = args[1];
  const baseUrl = flagValue(args, "--url");
  const modelsArg = flagValue(args, "--models");
  if (featurePath === undefined || baseUrl === undefined) {
    process.stderr.write(
      "Usage: greenlight-server benchmark <file.feature> --url <baseUrl>\n" +
        "       [--models <a,b,c>] [--out <path>] [--no-cache|--refresh]\n" +
        "\n" +
        "  --no-cache, --refresh   Re-run every model (ignore per-model disk cache)\n" +
        "  --models                Comma-separated model ids; omit to use models.default.json\n" +
        "  --out                   Write benchmark.json here (default: <dataDir>/benchmark/benchmark.json)\n" +
        "\n" +
        "Reasoning effort is not pinned — each model runs at its Copilot runtime default.\n",
    );
    process.exit(2);
  }
  const models = (modelsArg ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter((model) => model.length > 0);
  const useCache = !(hasFlag(args, "--no-cache") || hasFlag(args, "--refresh"));
  benchmarkProgram({
    featurePath,
    baseUrl,
    models,
    outPath: flagValue(args, "--out"),
    useCache,
  }).pipe(
    Effect.provide(benchmarkLayer.pipe(Layer.provideMerge(configLayer))),
    Effect.provide(NodeServices.layer),
    Effect.scoped,
    NodeRuntime.runMain,
  );
} else {
  Layer.launch(makeServerLayer.pipe(Layer.provide(configLayer))).pipe(NodeRuntime.runMain);
}
