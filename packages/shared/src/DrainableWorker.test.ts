import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

import { makeDrainableWorker } from "./DrainableWorker.ts";

describe("DrainableWorker", () => {
  it("processes enqueued items and drain resolves when idle", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const processed = yield* Ref.make<ReadonlyArray<number>>([]);
          const worker = yield* makeDrainableWorker((item: number) =>
            Ref.update(processed, (items) => [...items, item]),
          );

          yield* worker.enqueue(1);
          yield* worker.enqueue(2);
          yield* worker.enqueue(3);
          yield* worker.drain;

          return yield* Ref.get(processed);
        }),
      ),
    );

    expect(result).toEqual([1, 2, 3]);
  });

  it("drain resolves immediately when nothing was enqueued", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const worker = yield* makeDrainableWorker((_: number) => Effect.void);
          yield* worker.drain;
        }),
      ),
    );
  });

  it("drain waits for slow in-flight items", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const processed = yield* Ref.make(0);
          const worker = yield* makeDrainableWorker((_: number) =>
            Effect.sleep("20 millis").pipe(Effect.andThen(Ref.update(processed, (n) => n + 1))),
          );

          yield* worker.enqueue(1);
          yield* worker.enqueue(2);
          yield* worker.drain;

          return yield* Ref.get(processed);
        }),
      ),
    );

    expect(result).toBe(2);
  });
});
