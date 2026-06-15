/**
 * RunStore - persistence for runs and their event streams.
 *
 * Runs are stored as a full snapshot (`run_json`) that is rewritten as
 * the run progresses; `run_events` is the append-only event log used for
 * `run.subscribe` replay. Database errors are defects: this store is
 * only handed data the engine produced.
 *
 * @module RunStore
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  Run,
  RunEvent,
  RunNotFoundError,
  sumUsage,
  type RunId,
  type RunSummary,
} from "@greenlight/contracts";

export interface ListRunsOptions {
  readonly featurePath?: string | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}

export interface RunStoreShape {
  readonly upsertRun: (run: Run) => Effect.Effect<void>;
  readonly appendEvent: (event: RunEvent) => Effect.Effect<void>;
  readonly getRun: (runId: RunId) => Effect.Effect<Run, RunNotFoundError>;
  readonly listRuns: (options: ListRunsOptions) => Effect.Effect<ReadonlyArray<RunSummary>>;
  readonly deleteRun: (runId: RunId) => Effect.Effect<void, RunNotFoundError>;
  readonly eventsAfter: (runId: RunId, afterSeq: number) => Effect.Effect<ReadonlyArray<RunEvent>>;
}

export class RunStore extends Context.Service<RunStore, RunStoreShape>()(
  "greenlight/persistence/RunStore",
) {}

const decodeRun = Schema.decodeUnknownEffect(Run);
const decodeEvent = Schema.decodeUnknownEffect(RunEvent);

const toSummary = (run: Run): RunSummary => {
  const usage = sumUsage(run.scenarios);
  return {
    runId: run.runId,
    featurePath: run.featurePath,
    baseUrl: run.baseUrl,
    ...(run.environmentProfileName !== undefined
      ? { environmentProfileName: run.environmentProfileName }
      : {}),
    status: run.status,
    createdAt: run.createdAt,
    ...(run.finishedAt !== undefined ? { finishedAt: run.finishedAt } : {}),
    scenarioCounts: {
      passed: run.scenarios.filter((scenario) => scenario.status === "passed").length,
      failed: run.scenarios.filter((scenario) => scenario.status === "failed").length,
      skipped: run.scenarios.filter((scenario) => scenario.status === "skipped").length,
    },
    ...(usage !== undefined ? { usage } : {}),
    ...(run.model !== undefined ? { model: run.model } : {}),
  };
};

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRun: RunStoreShape["upsertRun"] = (run) =>
    sql`
      INSERT INTO runs (run_id, feature_path, base_url, model, status, created_at, finished_at, error, run_json)
      VALUES (${run.runId}, ${run.featurePath}, ${run.baseUrl}, ${run.model ?? null}, ${run.status},
              ${run.createdAt}, ${run.finishedAt ?? null}, ${run.error ?? null}, ${JSON.stringify(run)})
      ON CONFLICT (run_id) DO UPDATE SET
        status = excluded.status,
        finished_at = excluded.finished_at,
        error = excluded.error,
        run_json = excluded.run_json
    `.pipe(Effect.asVoid, Effect.orDie);

  const appendEvent: RunStoreShape["appendEvent"] = (event) =>
    sql`
      INSERT OR IGNORE INTO run_events (run_id, seq, payload_json)
      VALUES (${event.runId}, ${event.seq}, ${JSON.stringify(event)})
    `.pipe(Effect.asVoid, Effect.orDie);

  const getRun: RunStoreShape["getRun"] = (runId) =>
    Effect.gen(function* () {
      const rows = yield* sql`SELECT run_json FROM runs WHERE run_id = ${runId}`.pipe(Effect.orDie);
      const first = rows[0];
      if (first === undefined) {
        return yield* Effect.fail(new RunNotFoundError({ runId }));
      }
      return yield* decodeRun(JSON.parse(String(first["run_json"]))).pipe(Effect.orDie);
    });

  const listRuns: RunStoreShape["listRuns"] = (options) =>
    Effect.gen(function* () {
      const limit = options.limit ?? 50;
      const offset = options.offset ?? 0;
      const rows = yield* (
        options.featurePath !== undefined
          ? sql`SELECT run_json FROM runs WHERE feature_path = ${options.featurePath}
              ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
          : sql`SELECT run_json FROM runs ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
      ).pipe(Effect.orDie);
      const runs = yield* Effect.forEach(rows, (row) =>
        decodeRun(JSON.parse(String(row["run_json"]))).pipe(Effect.orDie),
      );
      return runs.map(toSummary);
    });

  const deleteRun: RunStoreShape["deleteRun"] = (runId) =>
    Effect.gen(function* () {
      yield* getRun(runId);
      yield* sql`DELETE FROM run_events WHERE run_id = ${runId}`.pipe(Effect.orDie);
      yield* sql`DELETE FROM evidence WHERE run_id = ${runId}`.pipe(Effect.orDie);
      yield* sql`DELETE FROM runs WHERE run_id = ${runId}`.pipe(Effect.orDie);
    });

  const eventsAfter: RunStoreShape["eventsAfter"] = (runId, afterSeq) =>
    Effect.gen(function* () {
      const rows = yield* sql`
        SELECT payload_json FROM run_events
        WHERE run_id = ${runId} AND seq > ${afterSeq}
        ORDER BY seq ASC
      `.pipe(Effect.orDie);
      return yield* Effect.forEach(rows, (row) =>
        decodeEvent(JSON.parse(String(row["payload_json"]))).pipe(Effect.orDie),
      );
    });

  return {
    upsertRun,
    appendEvent,
    getRun,
    listRuns,
    deleteRun,
    eventsAfter,
  } satisfies RunStoreShape;
});

export const RunStoreLive = Layer.effect(RunStore, make);
