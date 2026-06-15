/**
 * Benchmark command - run the same feature across several models and
 * compare speed (wall-clock) and Copilot usage (tokens + premium req).
 *
 *   greenlight-server benchmark <file.feature> --url <baseUrl> [--models a,b,c]
 *
 * Models run sequentially, one Run each, reusing the engine. Results are
 * printed as a comparison table and written as `benchmark.json` (the input
 * the dashboard reads). Each model's result is cached on disk keyed by the
 * feature content + baseUrl, so re-running the suite with a new model only
 * executes the new model.
 *
 * @module benchmark
 */
import * as NodeCrypto from "node:crypto";

import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  RunId,
  sumUsage,
  type ParsedScenario,
  type Run,
  type RunEvent,
  type RunStatus,
  type Usage,
} from "@greenlight/contracts";

import defaultModelTemplate from "../benchmark/models.default.json" with { type: "json" };
import { ServerConfig } from "./config.ts";
import { CopilotService } from "./copilot/CopilotService.ts";
import { GherkinService } from "./gherkin/GherkinService.ts";
import { RunEngine } from "./engine/RunEngine.ts";
import { servicesLayer } from "./server.ts";

const color = {
  green: (text: string) => `\x1b[32m${text}\x1b[0m`,
  red: (text: string) => `\x1b[31m${text}\x1b[0m`,
  yellow: (text: string) => `\x1b[33m${text}\x1b[0m`,
  dim: (text: string) => `\x1b[2m${text}\x1b[0m`,
  bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
};

const writeLine = (text: string) =>
  Effect.sync(() => {
    process.stdout.write(`${text}\n`);
  });

const formatTokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m${rest.toString().padStart(2, "0")}s`;
};

/** Per-model scenario tally; `total` mirrors the dashboard schema. */
interface ScenarioCounts {
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly total: number;
}

/**
 * One row in the comparison table and one entry in `benchmark.json`.
 * Matches `apps/server/benchmark/benchmark.sample.json` exactly.
 */
interface ModelResult {
  readonly model: string;
  readonly name: string;
  readonly status: RunStatus;
  readonly durationMs: number;
  readonly cached: boolean;
  readonly scenarios: ScenarioCounts;
  readonly usage: Usage | null;
}

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const stripAnsi = (text: string): string => text.replace(ANSI_PATTERN, "");

const renderTable = (rows: ReadonlyArray<ModelResult>): string => {
  const header = ["MODEL", "STATUS", "TIME", "IN", "OUT", "PREMIUM", "SCN"] as const;
  const body = rows.map((row) => {
    const scn =
      `${row.scenarios.passed}\u2713 ${row.scenarios.failed}\u2717` +
      (row.scenarios.skipped > 0 ? ` ${row.scenarios.skipped}\u25cb` : "");
    const label = row.cached ? `${row.model} ${color.dim("(cached)")}` : row.model;
    return [
      label,
      row.status,
      formatDuration(row.durationMs),
      row.usage !== null ? formatTokens(row.usage.inputTokens) : "\u2014",
      row.usage !== null ? formatTokens(row.usage.outputTokens) : "\u2014",
      row.usage !== null ? row.usage.premiumRequestCost.toFixed(2) : "\u2014",
      scn,
    ];
  });

  // The cached label carries ANSI codes; measure the visible width instead.
  const widths = header.map((label, column) =>
    Math.max(label.length, ...body.map((cells) => stripAnsi(cells[column]!).length)),
  );
  const pad = (text: string, width: number, left: boolean): string => {
    const fill = " ".repeat(Math.max(0, width - stripAnsi(text).length));
    return left ? text + fill : fill + text;
  };
  // MODEL, STATUS and SCN read better left-aligned; the rest are numeric.
  const leftAligned = new Set([0, 1, 6]);
  const renderCells = (cells: ReadonlyArray<string>): string =>
    cells.map((cell, column) => pad(cell, widths[column]!, leftAligned.has(column))).join("  ");

  const separator = widths.map((width) => "\u2500".repeat(width)).join("  ");
  return [
    color.bold(renderCells(header)),
    color.dim(separator),
    ...body.map((cells) => renderCells(cells)),
  ].join("\n");
};

const makeProgressPrinter = (scenarioName: Map<string, string>) => {
  return (event: RunEvent): Effect.Effect<void> => {
    if (event.type === "scenario.finished") {
      const name = scenarioName.get(event.pickleId) ?? event.pickleId;
      const mark = event.status === "passed" ? color.green("\u2713") : color.red("\u2717");
      return writeLine(`    ${mark} ${color.dim(name)}`);
    }
    return Effect.void;
  };
};

/** id -> human label, from the committed default template. */
const modelNames = new Map<string, string>(
  defaultModelTemplate.models.map((entry) => [entry.id, entry.name]),
);
const DEFAULT_BENCHMARK_MODELS: ReadonlyArray<string> = defaultModelTemplate.models.map(
  (entry) => entry.id,
);
const nameFor = (model: string): string => modelNames.get(model) ?? model;

const countScenarios = (run: Run): ScenarioCounts => {
  const counts = run.scenarios.reduce(
    (acc, scenario) => ({
      passed: acc.passed + (scenario.status === "passed" ? 1 : 0),
      failed: acc.failed + (scenario.status === "failed" ? 1 : 0),
      skipped: acc.skipped + (scenario.status === "skipped" ? 1 : 0),
    }),
    { passed: 0, failed: 0, skipped: 0 },
  );
  return { ...counts, total: run.scenarios.length };
};

/** Filesystem-safe model id for use as a cache filename. */
const cacheFileName = (model: string): string => `${model.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`;

/** Cache namespace = feature content + target URL, so editing either re-runs. */
const cacheKey = (featureContent: string, baseUrl: string): string =>
  NodeCrypto.createHash("sha256")
    .update(`${featureContent}\n${baseUrl}`)
    .digest("hex")
    .slice(0, 16);

/** Parse a cached result blob; refreshes the display name + cached flag. */
const parseCachedResult = (raw: string, model: string): ModelResult | undefined => {
  try {
    const parsed = JSON.parse(raw) as ModelResult;
    return { ...parsed, model, name: nameFor(model), cached: true };
  } catch {
    return undefined;
  }
};

/** Load a cached per-model result, or `undefined` when absent/unreadable. */
const readCachedResult = (
  fs: FileSystem.FileSystem,
  cacheFile: string,
  model: string,
): Effect.Effect<ModelResult | undefined> =>
  Effect.gen(function* () {
    const exists = yield* fs.exists(cacheFile).pipe(Effect.orElseSucceed(() => false));
    if (!exists) return undefined;
    const raw = yield* fs.readFileString(cacheFile).pipe(Effect.orElseSucceed(() => ""));
    if (raw.length === 0) return undefined;
    return parseCachedResult(raw, model);
  });

export interface BenchmarkOptions {
  readonly featurePath: string;
  readonly baseUrl: string;
  readonly models: ReadonlyArray<string>;
  readonly outPath?: string | undefined;
  readonly useCache?: boolean | undefined;
}

export const benchmarkProgram = (options: BenchmarkOptions) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* ServerConfig;
    const gherkin = yield* GherkinService;
    const engine = yield* RunEngine;
    const copilot = yield* CopilotService;

    const models = options.models.length > 0 ? options.models : DEFAULT_BENCHMARK_MODELS;
    const useCache = options.useCache ?? true;

    const content = yield* fs.readFileString(options.featurePath);
    const { feature, errors } = yield* gherkin.parseFeature(content, options.featurePath);

    if (errors.length > 0) {
      for (const error of errors) {
        yield* writeLine(color.red(error.message));
      }
      process.exitCode = 1;
      return;
    }
    const scenarios = feature?.scenarios.filter((scenario) => scenario.steps.length > 0) ?? [];
    if (scenarios.length === 0) {
      yield* writeLine(color.yellow("No runnable scenarios found in the feature file."));
      process.exitCode = 1;
      return;
    }

    const auth = yield* copilot.authStatus;
    if (auth.state !== "authenticated") {
      yield* writeLine(
        color.red(
          `Copilot is not authenticated (${auth.message ?? auth.state}).\n` +
            "Run `gh auth login` or `copilot` once, or set COPILOT_GITHUB_TOKEN.",
        ),
      );
      process.exitCode = 1;
      return;
    }
    yield* writeLine(color.dim(`Copilot authenticated${auth.login ? ` as ${auth.login}` : ""}.`));
    yield* writeLine(
      color.bold(
        `\nBenchmarking ${scenarios.length} scenario(s) across ${models.length} model(s) ` +
          `against ${options.baseUrl}`,
      ),
    );

    const scenarioName = new Map<string, string>(
      scenarios.map((scenario: ParsedScenario) => [scenario.pickleId, scenario.name]),
    );
    const onEvent = makeProgressPrinter(scenarioName);

    const cacheDir = path.join(
      config.dataDir,
      "benchmark",
      "cache",
      cacheKey(content, options.baseUrl),
    );
    yield* fs.makeDirectory(cacheDir, { recursive: true }).pipe(Effect.ignore);

    const results: Array<ModelResult> = [];
    for (let index = 0; index < models.length; index++) {
      const model = models[index]!;
      const cacheFile = path.join(cacheDir, cacheFileName(model));

      if (useCache) {
        const cached = yield* readCachedResult(fs, cacheFile, model);
        if (cached !== undefined) {
          yield* writeLine(color.bold(`\n\u25b6 ${model} ${color.dim("(cached)")}`));
          results.push(cached);
          continue;
        }
      }

      yield* writeLine(color.bold(`\n\u25b6 ${model}`));
      const startedAt = DateTime.toEpochMillis(yield* DateTime.now);
      const runId = RunId.make(`bench-${index}-${startedAt.toString(36)}`);
      const run = yield* engine.executeRun({
        runId,
        featurePath: options.featurePath,
        baseUrl: options.baseUrl,
        model,
        scenarios,
        onEvent,
      });
      const durationMs = DateTime.toEpochMillis(yield* DateTime.now) - startedAt;

      const result: ModelResult = {
        model,
        name: nameFor(model),
        status: run.status,
        durationMs,
        cached: false,
        scenarios: countScenarios(run),
        usage: sumUsage(run.scenarios) ?? null,
      };
      results.push(result);
      yield* fs
        .writeFileString(cacheFile, `${JSON.stringify(result, null, 2)}\n`)
        .pipe(Effect.ignore);
    }

    yield* writeLine("");
    yield* writeLine(renderTable(results));

    const outPath = options.outPath ?? path.join(config.dataDir, "benchmark", "benchmark.json");
    const report = {
      feature: options.featurePath,
      baseUrl: options.baseUrl,
      generatedAt: new Date().toISOString(),
      models: results,
    };
    yield* fs.makeDirectory(path.dirname(outPath), { recursive: true }).pipe(Effect.ignore);
    yield* fs.writeFileString(outPath, `${JSON.stringify(report, null, 2)}\n`);
    yield* writeLine(color.dim(`\nWrote ${outPath}`));

    if (results.some((result) => result.status !== "passed")) {
      process.exitCode = 1;
    }
  });

export const benchmarkLayer = servicesLayer;
