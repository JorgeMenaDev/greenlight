/**
 * Demo command - run a feature file headlessly and print verdicts.
 *
 *   greenlight-server demo <file.feature> --url <baseUrl> [--model <id>]
 *
 * @module demo
 */
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import { RunId, type ParsedFeature, type RunEvent } from "@greenlight/contracts";

import { BrowserServiceLive } from "./browser/BrowserService.ts";
import { CopilotService, CopilotServiceLive } from "./copilot/CopilotService.ts";
import { GherkinService, GherkinServiceLive } from "./gherkin/GherkinService.ts";
import { RunEngine, RunEngineLive } from "./engine/RunEngine.ts";

const color = {
  green: (text: string) => `[32m${text}[0m`,
  red: (text: string) => `[31m${text}[0m`,
  yellow: (text: string) => `[33m${text}[0m`,
  dim: (text: string) => `[2m${text}[0m`,
  bold: (text: string) => `[1m${text}[0m`,
};

const writeLine = (text: string) =>
  Effect.sync(() => {
    process.stdout.write(`${text}\n`);
  });

const makeEventPrinter = (feature: ParsedFeature) => {
  const scenarioName = new Map(
    feature.scenarios.map((scenario) => [scenario.pickleId, scenario.name]),
  );
  const stepText = new Map(
    feature.scenarios.map((scenario) => [
      scenario.pickleId,
      scenario.steps.map((step) => `${step.keyword} ${step.text}`),
    ]),
  );

  return (event: RunEvent): Effect.Effect<void> => {
    switch (event.type) {
      case "run.started":
        return writeLine(
          color.bold(`\nRunning ${event.run.scenarios.length} scenario(s) against ${event.run.baseUrl}\n`),
        );
      case "scenario.started":
        return writeLine(color.bold(`Scenario: ${scenarioName.get(event.pickleId) ?? event.pickleId}`));
      case "step.started":
        return writeLine(
          color.dim(`  … ${stepText.get(event.pickleId)?.[event.stepIndex] ?? `step ${event.stepIndex + 1}`}`),
        );
      case "agent.activity":
        return writeLine(color.dim(`      · ${event.tool ?? "agent"}: ${event.summary}`));
      case "step.finished": {
        const text = stepText.get(event.pickleId)?.[event.stepIndex] ?? `step ${event.stepIndex + 1}`;
        switch (event.result.status) {
          case "passed":
            return writeLine(`  ${color.green("✓")} ${text}`);
          case "failed":
            return writeLine(
              `  ${color.red("✗")} ${text}\n` +
                color.red(`      ${event.result.errorMessage ?? "failed"}`) +
                (event.result.expected !== undefined
                  ? `\n      expected: ${event.result.expected}\n      actual:   ${event.result.actual ?? "?"}`
                  : ""),
            );
          case "skipped":
            return writeLine(color.dim(`  ○ ${text} (skipped)`));
          default:
            return Effect.void;
        }
      }
      case "scenario.finished":
        return writeLine(
          event.status === "passed" ? color.green("  PASSED\n") : color.red("  FAILED\n"),
        );
      case "run.finished":
        return writeLine(
          event.status === "passed"
            ? color.green(color.bold("Run passed."))
            : event.status === "error"
              ? color.red(color.bold(`Run errored: ${event.error ?? "unknown error"}`))
              : color.red(color.bold("Run failed.")),
        );
      default:
        return Effect.void;
    }
  };
};

export interface DemoOptions {
  readonly featurePath: string;
  readonly baseUrl: string;
  readonly model?: string | undefined;
}

export const demoProgram = (options: DemoOptions) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const gherkin = yield* GherkinService;
    const engine = yield* RunEngine;
    const copilot = yield* CopilotService;

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
    const emptyCount = (feature?.scenarios.length ?? 0) - scenarios.length;
    if (emptyCount > 0) {
      yield* writeLine(color.yellow(`Skipping ${emptyCount} scenario(s) with no steps.`));
    }
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

    const runId = RunId.make(
      `demo-${DateTime.toEpochMillis(yield* DateTime.now).toString(36)}`,
    );

    const run = yield* engine.executeRun({
      runId,
      featurePath: options.featurePath,
      baseUrl: options.baseUrl,
      model: options.model,
      scenarios,
      onEvent: makeEventPrinter(feature!),
    });

    if (run.status !== "passed") {
      process.exitCode = 1;
    }
  });

export const demoLayer = Layer.mergeAll(
  GherkinServiceLive,
  CopilotServiceLive,
  RunEngineLive.pipe(
    Layer.provide(Layer.mergeAll(BrowserServiceLive, CopilotServiceLive, GherkinServiceLive)),
  ),
);
