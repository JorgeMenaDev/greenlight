#!/usr/bin/env node
/**
 * Greenlight server entry point.
 *
 * Configuration comes from GREENLIGHT_PORT / GREENLIGHT_HOST /
 * GREENLIGHT_DATA_DIR environment variables.
 *
 * @module bin
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Layer from "effect/Layer";

import packageJson from "../package.json" with { type: "json" };
import { layerFromEnv } from "./config.ts";
import { makeServerLayer } from "./server.ts";

// Only ServerConfig is provided at the edge; everything else is wired
// inside `makeServerLayer`.
const configLayer = layerFromEnv(packageJson.version).pipe(Layer.provide(NodeServices.layer));

Layer.launch(makeServerLayer.pipe(Layer.provide(configLayer))).pipe(NodeRuntime.runMain);
