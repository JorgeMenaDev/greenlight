#!/usr/bin/env node
/**
 * Greenlight server entry point.
 *
 *   greenlight-server                 start the server (GREENLIGHT_* env config)
 *   greenlight-server demo <feature> --url <baseUrl> [--model <id>]
 *
 * @module bin
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import packageJson from "../package.json" with { type: "json" };
import { layerFromEnv } from "./config.ts";
import { demoLayer, demoProgram } from "./demo.ts";
import { makeServerLayer } from "./server.ts";

const flagValue = (args: ReadonlyArray<string>, flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

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
} else {
  Layer.launch(makeServerLayer.pipe(Layer.provide(configLayer))).pipe(NodeRuntime.runMain);
}
