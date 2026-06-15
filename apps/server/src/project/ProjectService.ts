/**
 * ProjectService - a project is a folder of .feature files on disk.
 *
 * The current project path persists in the settings table; recently
 * opened projects are tracked for the picker. All feature paths are
 * project-relative and validated against escaping the project root.
 *
 * @module ProjectService
 */
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  FeatureIoError,
  NoProjectOpenError,
  ProjectError,
  type FeatureFileEntry,
  type ProjectInfo,
  type RecentProject,
} from "@greenlight/contracts";

const CURRENT_PROJECT_KEY = "currentProjectPath";
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git", "dist", "build"]);
const DEFAULT_PROJECT_PARTS = ["examples", "todomvc"] as const;
const DEFAULT_PROJECT_FEATURE = "todo.feature";

export interface ProjectServiceShape {
  readonly open: (path: string) => Effect.Effect<ProjectInfo, ProjectError>;
  readonly current: Effect.Effect<ProjectInfo | null>;
  readonly recent: Effect.Effect<ReadonlyArray<RecentProject>>;
  readonly listFeatures: Effect.Effect<
    ReadonlyArray<FeatureFileEntry>,
    NoProjectOpenError | ProjectError
  >;
  readonly readFeature: (
    relativePath: string,
  ) => Effect.Effect<string, NoProjectOpenError | FeatureIoError>;
  readonly writeFeature: (
    relativePath: string,
    content: string,
  ) => Effect.Effect<void, NoProjectOpenError | FeatureIoError>;
  readonly createFeature: (
    name: string,
  ) => Effect.Effect<FeatureFileEntry, NoProjectOpenError | FeatureIoError>;
  readonly deleteFeature: (
    relativePath: string,
  ) => Effect.Effect<void, NoProjectOpenError | FeatureIoError>;
}

export class ProjectService extends Context.Service<ProjectService, ProjectServiceShape>()(
  "greenlight/project/ProjectService",
) {}

const FEATURE_TEMPLATE = (name: string) => `Feature: ${name}
  Describe the behaviour under test in plain English.

  Scenario: First scenario
    Given I am on the home page
    When I do something
    Then I should see the expected result
`;

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const getCurrentPath = Effect.gen(function* () {
    const rows = yield* sql`SELECT value FROM settings WHERE key = ${CURRENT_PROJECT_KEY}`.pipe(
      Effect.orDie,
    );
    const first = rows[0];
    return first === undefined ? undefined : String(first["value"]);
  });

  const requireProject = Effect.gen(function* () {
    const root = yield* getCurrentPath;
    if (root === undefined) return yield* Effect.fail(new NoProjectOpenError({}));
    return root;
  });

  const resolveInside = (root: string, relativePath: string) =>
    Effect.gen(function* () {
      const resolved = path.resolve(root, relativePath);
      if (resolved !== root && !resolved.startsWith(root + path.sep)) {
        return yield* Effect.fail(
          new FeatureIoError({ path: relativePath, detail: "Path escapes the project folder." }),
        );
      }
      return resolved;
    });

  const walkFeatures = (
    root: string,
  ): Effect.Effect<ReadonlyArray<FeatureFileEntry>, ProjectError> =>
    Effect.gen(function* () {
      const entries: Array<FeatureFileEntry> = [];
      const walk = (dir: string): Effect.Effect<void, ProjectError> =>
        Effect.gen(function* () {
          const names = yield* fs
            .readDirectory(dir)
            .pipe(
              Effect.mapError(
                (cause) => new ProjectError({ detail: `Failed to read ${dir}: ${cause.message}` }),
              ),
            );
          for (const name of names) {
            const fullPath = path.join(dir, name);
            const info = yield* fs.stat(fullPath).pipe(Effect.option);
            if (info._tag === "None") continue;
            if (info.value.type === "Directory") {
              if (!name.startsWith(".") && !SKIPPED_DIRECTORIES.has(name)) {
                yield* walk(fullPath);
              }
            } else if (name.endsWith(".feature")) {
              entries.push({
                path: path.relative(root, fullPath),
                name: name.replace(/\.feature$/, ""),
                sizeBytes: Number(info.value.size),
                modifiedAt:
                  info.value.mtime._tag === "Some"
                    ? DateTime.formatIso(DateTime.fromDateUnsafe(info.value.mtime.value))
                    : DateTime.formatIso(DateTime.nowUnsafe()),
              });
            }
          }
        });
      yield* walk(root);
      return entries.sort((a, b) => a.path.localeCompare(b.path));
    });

  const findDefaultProjectFrom = (start: string) =>
    Effect.gen(function* () {
      let current = path.resolve(start);
      while (true) {
        const candidate = path.join(current, ...DEFAULT_PROJECT_PARTS);
        const hasDemoFeature = yield* fs
          .exists(path.join(candidate, DEFAULT_PROJECT_FEATURE))
          .pipe(Effect.orElseSucceed(() => false));
        if (hasDemoFeature) return candidate;

        const parent = path.dirname(current);
        if (parent === current) return undefined;
        current = parent;
      }
    });

  const findDefaultProject = Effect.gen(function* () {
    const starts = [process.cwd(), import.meta.dirname];
    for (const start of starts) {
      const project = yield* findDefaultProjectFrom(start);
      if (project !== undefined) return project;
    }
    return undefined;
  });

  const open: ProjectServiceShape["open"] = (rawPath) =>
    Effect.gen(function* () {
      const root = path.resolve(rawPath);
      const info = yield* fs
        .stat(root)
        .pipe(Effect.mapError(() => new ProjectError({ detail: `Folder not found: ${root}` })));
      if (info.type !== "Directory") {
        return yield* Effect.fail(new ProjectError({ detail: `Not a folder: ${root}` }));
      }
      const features = yield* walkFeatures(root);
      const now = DateTime.formatIso(yield* DateTime.now);
      yield* sql`
        INSERT INTO settings (key, value) VALUES (${CURRENT_PROJECT_KEY}, ${root})
        ON CONFLICT (key) DO UPDATE SET value = excluded.value
      `.pipe(Effect.orDie);
      yield* sql`
        INSERT INTO recent_projects (path, last_opened_at) VALUES (${root}, ${now})
        ON CONFLICT (path) DO UPDATE SET last_opened_at = excluded.last_opened_at
      `.pipe(Effect.orDie);
      return { path: root, featureCount: features.length } satisfies ProjectInfo;
    });

  const current: ProjectServiceShape["current"] = Effect.gen(function* () {
    const root = yield* getCurrentPath;
    if (root !== undefined) {
      const currentProject = yield* walkFeatures(root).pipe(Effect.option);
      if (currentProject._tag === "Some") {
        return { path: root, featureCount: currentProject.value.length } satisfies ProjectInfo;
      }
    }

    const defaultProject = yield* findDefaultProject;
    if (defaultProject === undefined) return null;
    return yield* open(defaultProject).pipe(Effect.orElseSucceed(() => null));
  });

  const recent: ProjectServiceShape["recent"] = Effect.gen(function* () {
    const rows = yield* sql`
      SELECT path, last_opened_at FROM recent_projects ORDER BY last_opened_at DESC LIMIT 10
    `.pipe(Effect.orDie);
    return rows.map((row) => ({
      path: String(row["path"]),
      lastOpenedAt: String(row["last_opened_at"]),
    }));
  });

  const listFeatures: ProjectServiceShape["listFeatures"] = Effect.gen(function* () {
    const root = yield* requireProject;
    return yield* walkFeatures(root);
  });

  const readFeature: ProjectServiceShape["readFeature"] = (relativePath) =>
    Effect.gen(function* () {
      const root = yield* requireProject;
      const fullPath = yield* resolveInside(root, relativePath);
      return yield* fs
        .readFileString(fullPath)
        .pipe(
          Effect.mapError(
            (cause) => new FeatureIoError({ path: relativePath, detail: cause.message }),
          ),
        );
    });

  const writeFeature: ProjectServiceShape["writeFeature"] = (relativePath, content) =>
    Effect.gen(function* () {
      const root = yield* requireProject;
      const fullPath = yield* resolveInside(root, relativePath);
      yield* fs
        .writeFileString(fullPath, content)
        .pipe(
          Effect.mapError(
            (cause) => new FeatureIoError({ path: relativePath, detail: cause.message }),
          ),
        );
    });

  const createFeature: ProjectServiceShape["createFeature"] = (name) =>
    Effect.gen(function* () {
      const root = yield* requireProject;
      const safeName = name.replace(/[^A-Za-z0-9 _-]/g, "").trim() || "new-feature";
      const fileName = `${safeName.toLowerCase().replace(/\s+/g, "-")}.feature`;
      const fullPath = yield* resolveInside(root, fileName);
      const exists = yield* fs.exists(fullPath).pipe(Effect.orElseSucceed(() => false));
      if (exists) {
        return yield* Effect.fail(
          new FeatureIoError({
            path: fileName,
            detail: "A feature with this name already exists.",
          }),
        );
      }
      yield* fs
        .writeFileString(fullPath, FEATURE_TEMPLATE(safeName))
        .pipe(
          Effect.mapError((cause) => new FeatureIoError({ path: fileName, detail: cause.message })),
        );
      const info = yield* fs
        .stat(fullPath)
        .pipe(
          Effect.mapError((cause) => new FeatureIoError({ path: fileName, detail: cause.message })),
        );
      return {
        path: fileName,
        name: safeName,
        sizeBytes: Number(info.size),
        modifiedAt: DateTime.formatIso(yield* DateTime.now),
      } satisfies FeatureFileEntry;
    });

  const deleteFeature: ProjectServiceShape["deleteFeature"] = (relativePath) =>
    Effect.gen(function* () {
      const root = yield* requireProject;
      const fullPath = yield* resolveInside(root, relativePath);
      yield* fs
        .remove(fullPath)
        .pipe(
          Effect.mapError(
            (cause) => new FeatureIoError({ path: relativePath, detail: cause.message }),
          ),
        );
    });

  return {
    open,
    current,
    recent,
    listFeatures,
    readFeature,
    writeFeature,
    createFeature,
    deleteFeature,
  } satisfies ProjectServiceShape;
});

export const ProjectServiceLive = Layer.effect(ProjectService, make);
