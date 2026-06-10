/**
 * RunManager - starts, tracks and cancels runs.
 *
 * One active run at a time. Every engine event goes through
 * persist-then-publish: append to the event log, fold into the run
 * snapshot, upsert it, then publish to live subscribers — so
 * `run.subscribe` replay is always gapless.
 *
 * @module RunManager
 */
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";

import {
  applyRunEvent,
  FeatureIoError,
  NoProjectOpenError,
  RunAlreadyActiveError,
  RunId,
  RunNotFoundError,
  RunStartError,
  type PickleId,
  type Run,
  type RunEvent,
} from "@greenlight/contracts";

import { GherkinService } from "../gherkin/GherkinService.ts";
import { ProjectService } from "../project/ProjectService.ts";
import { RunStore } from "../persistence/RunStore.ts";
import { RunEngine } from "./RunEngine.ts";
import { RunEventBus } from "./RunEventBus.ts";

export interface StartRunOptions {
  readonly featurePath: string;
  readonly baseUrl: string;
  readonly pickleIds?: ReadonlyArray<PickleId> | undefined;
  readonly model?: string | undefined;
}

export interface RunManagerShape {
  readonly start: (
    options: StartRunOptions,
  ) => Effect.Effect<
    { readonly runId: RunId },
    NoProjectOpenError | FeatureIoError | RunAlreadyActiveError | RunStartError
  >;
  readonly cancel: (runId: RunId) => Effect.Effect<void, RunNotFoundError>;
}

export class RunManager extends Context.Service<RunManager, RunManagerShape>()(
  "greenlight/engine/RunManager",
) {}

interface ActiveRun {
  readonly runId: RunId;
  readonly fiber: Fiber.Fiber<unknown, unknown>;
}

export const make = Effect.gen(function* () {
  const layerScope = yield* Effect.service(Scope.Scope);
  const project = yield* ProjectService;
  const gherkin = yield* GherkinService;
  const engine = yield* RunEngine;
  const store = yield* RunStore;
  const bus = yield* RunEventBus;
  const activeRef = yield* Ref.make<ActiveRun | undefined>(undefined);

  const start: RunManagerShape["start"] = (options) =>
    Effect.gen(function* () {
      const active = yield* Ref.get(activeRef);
      if (active !== undefined) {
        return yield* Effect.fail(new RunAlreadyActiveError({ activeRunId: active.runId }));
      }

      const content = yield* project.readFeature(options.featurePath);
      const { feature, errors } = yield* gherkin.parseFeature(content, options.featurePath);
      if (errors.length > 0) {
        return yield* Effect.fail(new RunStartError({ detail: errors[0]!.message }));
      }
      const allScenarios = feature?.scenarios.filter((scenario) => scenario.steps.length > 0) ?? [];
      const scenarios =
        options.pickleIds !== undefined && options.pickleIds.length > 0
          ? allScenarios.filter((scenario) => options.pickleIds!.includes(scenario.pickleId))
          : allScenarios;
      if (scenarios.length === 0) {
        return yield* Effect.fail(
          new RunStartError({ detail: "No runnable scenarios matched the request." }),
        );
      }

      const now = yield* DateTime.now;
      const runId = RunId.make(`run-${DateTime.toEpochMillis(now).toString(36)}`);

      // Persist-then-publish; also folds events into the snapshot the
      // store serves for runs.get.
      const snapshotRef = yield* Ref.make<Run | undefined>(undefined);
      const lastSeqRef = yield* Ref.make(-1);
      const onEvent = (event: RunEvent) =>
        Effect.gen(function* () {
          yield* store.appendEvent(event);
          yield* Ref.set(lastSeqRef, event.seq);
          const snapshot = applyRunEvent(yield* Ref.get(snapshotRef), event);
          yield* Ref.set(snapshotRef, snapshot);
          if (snapshot !== undefined) {
            yield* store.upsertRun(snapshot);
          }
          yield* bus.publish(event);
        });

      const markCancelled = Effect.gen(function* () {
        const seq = (yield* Ref.get(lastSeqRef)) + 1;
        const at = DateTime.formatIso(yield* DateTime.now);
        const event: RunEvent = { type: "run.finished", runId, seq, at, status: "cancelled" };
        yield* onEvent(event);
      });

      const fiber = yield* engine
        .executeRun({
          runId,
          featurePath: options.featurePath,
          baseUrl: options.baseUrl,
          model: options.model,
          scenarios,
          onEvent,
        })
        .pipe(
          Effect.onInterrupt(() => markCancelled),
          Effect.ensuring(Ref.set(activeRef, undefined)),
          Effect.forkIn(layerScope),
        );

      yield* Ref.set(activeRef, { runId, fiber });
      return { runId };
    });

  const cancel: RunManagerShape["cancel"] = (runId) =>
    Effect.gen(function* () {
      const active = yield* Ref.get(activeRef);
      if (active === undefined || active.runId !== runId) {
        return yield* Effect.fail(new RunNotFoundError({ runId }));
      }
      yield* Fiber.interrupt(active.fiber);
    });

  return { start, cancel } satisfies RunManagerShape;
});

export const RunManagerLive = Layer.effect(RunManager, make);
