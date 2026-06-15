/**
 * EvidenceStore - screenshot and browser console blob storage.
 *
 * Blobs live as files under `dataDir/evidence/<runId>/`; metadata lives
 * in the `evidence` table so the HTTP route can resolve ids to files.
 *
 * @module EvidenceStore
 */
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { EvidenceId, type EvidenceRef, type RunId } from "@greenlight/contracts";

import { ServerConfig } from "../config.ts";

export interface EvidenceStoreShape {
  readonly saveScreenshot: (
    runId: RunId,
    label: string,
    data: Uint8Array,
  ) => Effect.Effect<EvidenceRef>;
  readonly saveConsoleLog: (
    runId: RunId,
    label: string,
    text: string,
  ) => Effect.Effect<EvidenceRef>;
  /** Resolve an evidence id to an on-disk file path. */
  readonly resolve: (
    id: string,
  ) => Effect.Effect<{ readonly filePath: string; readonly kind: string } | undefined>;
  readonly deleteForRun: (runId: RunId) => Effect.Effect<void>;
}

export class EvidenceStore extends Context.Service<EvidenceStore, EvidenceStoreShape>()(
  "greenlight/evidence/EvidenceStore",
) {}

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const sql = yield* SqlClient.SqlClient;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const counter = yield* Ref.make(0);

  const saveEvidence = (
    runId: RunId,
    kind: "screenshot" | "console",
    label: string,
    extension: string,
    data: Uint8Array,
  ) =>
    Effect.gen(function* () {
      const n = yield* Ref.getAndUpdate(counter, (value) => value + 1);
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      const id = EvidenceId.make(
        `${runId}-${DateTime.toEpochMillis(yield* DateTime.now).toString(36)}-${n}`,
      );
      const dir = path.join(config.evidenceDir, runId);
      const filePath = path.join(dir, `${id}.${extension}`);
      yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.orDie);
      yield* fs.writeFile(filePath, data).pipe(Effect.orDie);
      yield* sql`
        INSERT INTO evidence (id, run_id, kind, label, file_path, created_at)
        VALUES (${id}, ${runId}, ${kind}, ${label}, ${filePath}, ${createdAt})
      `.pipe(Effect.orDie);
      return { id, kind, label, createdAt } satisfies EvidenceRef;
    });

  const saveScreenshot: EvidenceStoreShape["saveScreenshot"] = (runId, label, data) =>
    saveEvidence(runId, "screenshot", label, "png", data);

  const saveConsoleLog: EvidenceStoreShape["saveConsoleLog"] = (runId, label, text) =>
    saveEvidence(runId, "console", label, "log", new TextEncoder().encode(text));

  const resolve: EvidenceStoreShape["resolve"] = (id) =>
    Effect.gen(function* () {
      const rows = yield* sql`SELECT file_path, kind FROM evidence WHERE id = ${id}`.pipe(
        Effect.orDie,
      );
      const first = rows[0];
      if (first === undefined) return undefined;
      return { filePath: String(first.file_path), kind: String(first.kind) };
    });

  const deleteForRun: EvidenceStoreShape["deleteForRun"] = (runId) =>
    Effect.gen(function* () {
      yield* sql`DELETE FROM evidence WHERE run_id = ${runId}`.pipe(Effect.orDie);
      yield* fs
        .remove(path.join(config.evidenceDir, runId), { recursive: true })
        .pipe(Effect.ignore);
    });

  return { saveScreenshot, saveConsoleLog, resolve, deleteForRun } satisfies EvidenceStoreShape;
});

export const EvidenceStoreLive = Layer.effect(EvidenceStore, make);
