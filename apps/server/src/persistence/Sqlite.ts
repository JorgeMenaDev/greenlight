/**
 * Sqlite - database client layer plus schema setup.
 *
 * The v1 schema is created idempotently at startup. Runs are stored as a
 * snapshot JSON column plus an append-only `run_events` table that powers
 * gapless `run.subscribe` replay.
 *
 * @module Sqlite
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ServerConfig } from "../config.ts";
import * as SqliteClient from "./NodeSqliteClient.ts";

const setup = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`PRAGMA foreign_keys = ON;`;

    yield* sql`
      CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        feature_path TEXT NOT NULL,
        base_url TEXT NOT NULL,
        model TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        finished_at TEXT,
        error TEXT,
        run_json TEXT NOT NULL
      )
    `;
    yield* sql`
      CREATE INDEX IF NOT EXISTS idx_runs_feature ON runs(feature_path, created_at DESC)
    `;

    yield* sql`
      CREATE TABLE IF NOT EXISTS run_events (
        run_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (run_id, seq)
      )
    `;

    yield* sql`
      CREATE TABLE IF NOT EXISTS evidence (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        file_path TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `;
    yield* sql`
      CREATE INDEX IF NOT EXISTS idx_evidence_run ON evidence(run_id)
    `;

    yield* sql`
      CREATE TABLE IF NOT EXISTS recent_projects (
        path TEXT PRIMARY KEY,
        last_opened_at TEXT NOT NULL
      )
    `;

    yield* sql`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `;

    yield* sql`
      CREATE TABLE IF NOT EXISTS environment_profile_credentials (
        project_path TEXT NOT NULL,
        auth_ref TEXT NOT NULL,
        username TEXT NOT NULL,
        password TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_path, auth_ref)
      )
    `;
  }),
);

export const SqliteLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.makeDirectory(path.dirname(config.dbPath), { recursive: true });
    return Layer.provideMerge(
      setup,
      SqliteClient.layer({
        filename: config.dbPath,
        spanAttributes: { "db.name": path.basename(config.dbPath) },
      }),
    );
  }),
);

/** In-memory database for tests. */
export const SqliteMemory = Layer.provideMerge(setup, SqliteClient.layer({ filename: ":memory:" }));
