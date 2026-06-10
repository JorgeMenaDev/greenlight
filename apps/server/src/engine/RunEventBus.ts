/**
 * RunEventBus - live run-event fan-out with gapless replay.
 *
 * `subscribe` attaches to the live PubSub *before* reading persisted
 * events, then concatenates replay + live deduplicated by sequence
 * number, so a client that joins mid-run misses nothing.
 *
 * @module RunEventBus
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import type { RunEvent, RunId } from "@greenlight/contracts";

import { RunStore } from "../persistence/RunStore.ts";

export interface RunEventBusShape {
  readonly publish: (event: RunEvent) => Effect.Effect<void>;
  /** Replay persisted events after `afterSeq`, then tail live events. */
  readonly subscribe: (runId: RunId, afterSeq: number) => Stream.Stream<RunEvent>;
}

export class RunEventBus extends Context.Service<RunEventBus, RunEventBusShape>()(
  "greenlight/engine/RunEventBus",
) {}

export const make = Effect.gen(function* () {
  const pubsub = yield* PubSub.unbounded<RunEvent>();
  const store = yield* RunStore;

  const publish: RunEventBusShape["publish"] = (event) =>
    PubSub.publish(pubsub, event).pipe(Effect.asVoid);

  const subscribe: RunEventBusShape["subscribe"] = (runId, afterSeq) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const queue = yield* PubSub.subscribe(pubsub);
        const replay = yield* store.eventsAfter(runId, afterSeq);
        let lastSeq = afterSeq;
        for (const event of replay) {
          if (event.seq > lastSeq) lastSeq = event.seq;
        }

        const live = Stream.fromSubscription(queue).pipe(
          Stream.filter((event) => event.runId === runId && event.seq > lastSeq),
          Stream.tap((event) =>
            Effect.sync(() => {
              lastSeq = event.seq;
            }),
          ),
        );

        const finishedInReplay = replay.some((event) => event.type === "run.finished");
        const replayStream = Stream.fromIterable(replay);
        const all = finishedInReplay ? replayStream : Stream.concat(replayStream, live);

        // Complete the stream after the terminal event so clients don't
        // hold the subscription open forever.
        let done = false;
        return all.pipe(
          Stream.takeWhile((event) => {
            if (done) return false;
            if (event.type === "run.finished") done = true;
            return true;
          }),
        );
      }),
    );

  return { publish, subscribe } satisfies RunEventBusShape;
});

export const RunEventBusLive = Layer.effect(RunEventBus, make);
