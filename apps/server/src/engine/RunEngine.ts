/**
 * RunEngine - executes parsed scenarios against a URL.
 *
 * One fresh browser context and one agent session per scenario; one
 * prompted agent turn per step. A failed step skips the remainder of its
 * scenario (standard Cucumber semantics); later scenarios still run.
 * Infrastructure failures (browser, Copilot) abort the run with status
 * "error".
 *
 * @module RunEngine
 */
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import {
  type EvidenceRef,
  type ParsedScenario,
  type PickleId,
  type Run,
  type RunEvent,
  type RunId,
  type ScenarioResult,
  type StepResult,
  type StepStatus,
} from "@greenlight/contracts";

import { BrowserService } from "../browser/BrowserService.ts";
import { CopilotService } from "../copilot/CopilotService.ts";
import { EvidenceStore } from "../evidence/EvidenceStore.ts";
import { makePlaywrightTools, type VerdictSlot } from "./PlaywrightTools.ts";
import { executeStep } from "./StepAgent.ts";
import { SYSTEM_MESSAGE } from "./prompts.ts";

export interface ExecuteRunOptions {
  readonly runId: RunId;
  readonly featurePath: string;
  readonly baseUrl: string;
  readonly model?: string | undefined;
  readonly scenarios: ReadonlyArray<ParsedScenario>;
  /** Receives every run event in order. Must not fail. */
  readonly onEvent: (event: RunEvent) => Effect.Effect<void>;
}

export interface RunEngineShape {
  /** Execute a run to completion. Run-level failures become status "error". */
  readonly executeRun: (options: ExecuteRunOptions) => Effect.Effect<Run>;
}

export class RunEngine extends Context.Service<RunEngine, RunEngineShape>()(
  "greenlight/engine/RunEngine",
) {}

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const pendingSteps = (scenario: ParsedScenario): Array<StepResult> =>
  scenario.steps.map((step, index) => ({
    index,
    keyword: step.keyword,
    text: step.text,
    status: "pending" as const,
    evidence: [],
  }));

export const make = Effect.gen(function* () {
  const browser = yield* BrowserService;
  const copilot = yield* CopilotService;
  const evidenceStore = yield* EvidenceStore;

  const executeRun: RunEngineShape["executeRun"] = (options) =>
    Effect.gen(function* () {
      const seqRef = yield* Ref.make(0);

      type RunEventInput = RunEvent extends infer E
        ? E extends RunEvent
          ? Omit<E, "runId" | "seq" | "at">
          : never
        : never;

      const emit = (event: RunEventInput) =>
        Effect.gen(function* () {
          const seq = yield* Ref.getAndUpdate(seqRef, (n) => n + 1);
          const at = yield* nowIso;
          yield* options.onEvent({ ...event, runId: options.runId, seq, at } as RunEvent);
        });

      // Promise bridge for the tool handlers (the Copilot SDK calls them
      // as plain async functions outside any fiber).
      const saveScreenshot = (label: string, data: Uint8Array): Promise<string> =>
        Effect.runPromise(evidenceStore.saveScreenshot(options.runId, label, data)).then(
          (ref) => ref.id,
        );
      const createdAt = yield* nowIso;
      const scenarioResults: Array<ScenarioResult> = options.scenarios.map((scenario) => ({
        pickleId: scenario.pickleId,
        name: scenario.name,
        status: "pending" as const,
        steps: pendingSteps(scenario),
      }));

      const initialRun: Run = {
        runId: options.runId,
        featurePath: options.featurePath,
        baseUrl: options.baseUrl,
        ...(options.model !== undefined ? { model: options.model } : {}),
        status: "running",
        createdAt,
        startedAt: createdAt,
        scenarios: scenarioResults,
      };

      yield* emit({ type: "run.started", run: initialRun });

      let runError: string | undefined;

      const runScenario = (scenario: ParsedScenario, scenarioIndex: number) =>
        Effect.scoped(
          Effect.gen(function* () {
            const startedAt = yield* nowIso;
            yield* emit({ type: "scenario.started", pickleId: scenario.pickleId });

            const page = yield* browser.acquirePage;
            yield* Effect.tryPromise({
              try: () => page.goto(options.baseUrl, { timeout: 30_000 }),
              catch: (cause) =>
                new Error(
                  `Failed to open ${options.baseUrl}: ${
                    cause instanceof Error ? cause.message : String(cause)
                  }`,
                ),
            });

            const verdict: VerdictSlot = { current: null };
            const budget = { remaining: 0 };
            const emitActivity = (pickleId: PickleId, stepIndex: number) =>
              (activity: { tool: string; summary: string }) => {
                Effect.runFork(
                  emit({
                    type: "agent.activity",
                    pickleId,
                    stepIndex,
                    kind: "tool_call",
                    tool: activity.tool,
                    summary: activity.summary,
                  }),
                );
              };

            const activityTarget = { stepIndex: 0 };
            const tools = makePlaywrightTools({
              page,
              baseUrl: options.baseUrl,
              onActivity: (activity) =>
                emitActivity(scenario.pickleId, activityTarget.stepIndex)(activity),
              saveScreenshot,
              verdict,
              budget,
            });

            const session = yield* copilot.createSession({
              model: options.model,
              systemMessage: SYSTEM_MESSAGE,
              tools,
            });

            const steps = scenarioResults[scenarioIndex]!.steps as Array<StepResult>;
            let failed = false;

            for (let stepIndex = 0; stepIndex < scenario.steps.length; stepIndex++) {
              const step = scenario.steps[stepIndex]!;
              activityTarget.stepIndex = stepIndex;

              if (failed) {
                steps[stepIndex] = { ...steps[stepIndex]!, status: "skipped" };
                yield* emit({
                  type: "step.finished",
                  pickleId: scenario.pickleId,
                  stepIndex,
                  result: steps[stepIndex]!,
                });
                continue;
              }

              const stepStartedAt = yield* nowIso;
              steps[stepIndex] = { ...steps[stepIndex]!, status: "running", startedAt: stepStartedAt };
              yield* emit({ type: "step.started", pickleId: scenario.pickleId, stepIndex });

              const stepVerdict = yield* executeStep({
                session,
                step,
                stepNumber: stepIndex + 1,
                totalSteps: scenario.steps.length,
                scenarioName: scenario.name,
                baseUrl: options.baseUrl,
                verdict,
                budget,
              });

              // Engine-captured screenshot: evidence even when the agent
              // didn't take one (or lied).
              const evidence: Array<EvidenceRef> = [];
              const screenshotData = yield* Effect.promise(() =>
                page.screenshot({ type: "png" }).catch(() => undefined),
              );
              if (screenshotData !== undefined) {
                evidence.push(
                  yield* evidenceStore.saveScreenshot(
                    options.runId,
                    `After step ${stepIndex + 1}`,
                    screenshotData,
                  ),
                );
              }

              const finishedAt = yield* nowIso;
              steps[stepIndex] = {
                ...steps[stepIndex]!,
                status: stepVerdict.status,
                finishedAt,
                agentSummary: stepVerdict.summary,
                ...(stepVerdict.expected !== undefined ? { expected: stepVerdict.expected } : {}),
                ...(stepVerdict.actual !== undefined ? { actual: stepVerdict.actual } : {}),
                ...(stepVerdict.status === "failed" ? { errorMessage: stepVerdict.summary } : {}),
                evidence,
              };
              yield* emit({
                type: "step.finished",
                pickleId: scenario.pickleId,
                stepIndex,
                result: steps[stepIndex]!,
              });

              if (stepVerdict.status === "failed") failed = true;
            }

            const status: StepStatus = failed ? "failed" : "passed";
            const finishedAt = yield* nowIso;
            scenarioResults[scenarioIndex] = {
              ...scenarioResults[scenarioIndex]!,
              status,
              startedAt,
              finishedAt,
              steps,
            };
            yield* emit({ type: "scenario.finished", pickleId: scenario.pickleId, status });
          }),
        );

      for (let index = 0; index < options.scenarios.length; index++) {
        const failure: string | undefined = yield* runScenario(options.scenarios[index]!, index).pipe(
          Effect.as(undefined),
          Effect.catch((error) => Effect.succeed(error.message)),
        );
        if (failure !== undefined) {
          runError = failure;
          scenarioResults[index] = { ...scenarioResults[index]!, status: "failed" };
          break;
        }
      }

      const finishedAt = yield* nowIso;
      const allPassed = scenarioResults.every((scenario) => scenario.status === "passed");
      const finalStatus = runError !== undefined ? "error" : allPassed ? "passed" : "failed";

      yield* emit({
        type: "run.finished",
        status: finalStatus,
        ...(runError !== undefined ? { error: runError } : {}),
      });

      return {
        ...initialRun,
        status: finalStatus,
        finishedAt,
        ...(runError !== undefined ? { error: runError } : {}),
        scenarios: scenarioResults,
      } satisfies Run;
    });

  return { executeRun } satisfies RunEngineShape;
});

export const RunEngineLive = Layer.effect(RunEngine, make);
