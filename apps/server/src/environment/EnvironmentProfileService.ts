/**
 * EnvironmentProfileService - project-scoped run targets and local credentials.
 *
 * Environment profiles are non-secret project files. Local Basic Auth
 * credentials stay in the app database and are keyed by project + auth ref.
 *
 * @module EnvironmentProfileService
 */
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  type BasicAuthCredentials,
  EnvironmentProfileError,
  type EnvironmentProfileId,
  EnvironmentProfilesDocument,
  type EnvironmentProfile,
  type EnvironmentProfileInput,
  type HttpTargetUrl,
  type LocalAuthCredentialStatus,
  NoProjectOpenError,
  parseHttpTargetUrl,
  type RunTarget,
} from "@greenlight/contracts";

import { ProjectService } from "../project/ProjectService.ts";

const PROFILES_DIR = ".greenlight";
const PROFILES_FILE = "environment-profiles.json";

export interface ResolvedRunTarget {
  readonly baseUrl: HttpTargetUrl;
  readonly httpCredentials?: BasicAuthCredentials | undefined;
  readonly environmentProfileName?: string | undefined;
}

export interface EnvironmentProfileServiceShape {
  readonly list: Effect.Effect<
    ReadonlyArray<EnvironmentProfile>,
    NoProjectOpenError | EnvironmentProfileError
  >;
  readonly get: (
    id: EnvironmentProfileId,
  ) => Effect.Effect<EnvironmentProfile, NoProjectOpenError | EnvironmentProfileError>;
  readonly save: (
    input: EnvironmentProfileInput,
  ) => Effect.Effect<EnvironmentProfile, NoProjectOpenError | EnvironmentProfileError>;
  readonly delete: (
    id: EnvironmentProfileId,
    deleteLocalCredentials: boolean,
  ) => Effect.Effect<void, NoProjectOpenError | EnvironmentProfileError>;
  readonly listLocalCredentialStatuses: Effect.Effect<
    ReadonlyArray<LocalAuthCredentialStatus>,
    NoProjectOpenError
  >;
  readonly getLocalCredentials: (
    authRef: string,
  ) => Effect.Effect<
    BasicAuthCredentials | undefined,
    NoProjectOpenError | EnvironmentProfileError
  >;
  readonly saveLocalCredentials: (
    authRef: string,
    credentials: BasicAuthCredentials,
  ) => Effect.Effect<void, NoProjectOpenError | EnvironmentProfileError>;
  readonly deleteLocalCredentials: (
    authRef: string,
  ) => Effect.Effect<void, NoProjectOpenError | EnvironmentProfileError>;
  readonly resolveRunTarget: (
    target: RunTarget,
  ) => Effect.Effect<ResolvedRunTarget, NoProjectOpenError | EnvironmentProfileError>;
}

export class EnvironmentProfileService extends Context.Service<
  EnvironmentProfileService,
  EnvironmentProfileServiceShape
>()("greenlight/environment/EnvironmentProfileService") {}

const decodeProfilesDocument = Schema.decodeUnknownEffect(EnvironmentProfilesDocument);

const emptyProfilesDocument = () => ({ version: 1 as const, profiles: [] });

const normalizeOptional = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
};

const slugFor = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "profile";

const makeProfileId = (
  name: string,
  profiles: ReadonlyArray<EnvironmentProfile>,
): EnvironmentProfileId => {
  const used = new Set(profiles.map((profile) => profile.id));
  const base = `env_${slugFor(name)}`;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate as EnvironmentProfileId)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  return candidate as EnvironmentProfileId;
};

export const make = Effect.gen(function* () {
  const project = yield* ProjectService;
  const sql = yield* SqlClient.SqlClient;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const profilesPath = (root: string) => path.join(root, PROFILES_DIR, PROFILES_FILE);

  const readDocument = (root: string) =>
    Effect.gen(function* () {
      const filePath = profilesPath(root);
      const exists = yield* fs.exists(filePath).pipe(Effect.orElseSucceed(() => false));
      if (!exists) return emptyProfilesDocument();

      const raw = yield* fs.readFileString(filePath).pipe(
        Effect.mapError(
          (cause) =>
            new EnvironmentProfileError({
              detail: `Failed to read environment profiles: ${cause.message}`,
            }),
        ),
      );
      const parsed = yield* Effect.try({
        try: () => JSON.parse(raw) as unknown,
        catch: () =>
          new EnvironmentProfileError({ detail: "Environment profiles file is invalid JSON." }),
      });
      return yield* decodeProfilesDocument(parsed).pipe(
        Effect.mapError(
          () =>
            new EnvironmentProfileError({
              detail: "Environment profiles file has an invalid shape.",
            }),
        ),
      );
    });

  const writeDocument = (root: string, document: EnvironmentProfilesDocument) =>
    Effect.gen(function* () {
      const filePath = profilesPath(root);
      yield* fs.makeDirectory(path.dirname(filePath), { recursive: true }).pipe(
        Effect.mapError(
          (cause) =>
            new EnvironmentProfileError({
              detail: `Failed to create .greenlight folder: ${cause.message}`,
            }),
        ),
      );
      yield* fs.writeFileString(filePath, `${JSON.stringify(document, null, 2)}\n`).pipe(
        Effect.mapError(
          (cause) =>
            new EnvironmentProfileError({
              detail: `Failed to write environment profiles: ${cause.message}`,
            }),
        ),
      );
    });

  const cleanAuthRef = (authRef: string) => {
    const cleaned = authRef.trim();
    return cleaned === ""
      ? Effect.fail(
          new EnvironmentProfileError({ detail: "Authentication reference is required." }),
        )
      : Effect.succeed(cleaned);
  };

  const list: EnvironmentProfileServiceShape["list"] = Effect.gen(function* () {
    const root = yield* project.currentPath;
    const document = yield* readDocument(root);
    return document.profiles;
  });

  const get: EnvironmentProfileServiceShape["get"] = (id) =>
    Effect.gen(function* () {
      const profiles = yield* list;
      const profile = profiles.find((entry) => entry.id === id);
      if (profile === undefined) {
        return yield* Effect.fail(
          new EnvironmentProfileError({ detail: "Environment profile not found." }),
        );
      }
      return profile;
    });

  const save: EnvironmentProfileServiceShape["save"] = (input) =>
    Effect.gen(function* () {
      const root = yield* project.currentPath;
      const document = yield* readDocument(root);
      const name = input.name.trim();
      if (name === "") {
        return yield* Effect.fail(new EnvironmentProfileError({ detail: "Name is required." }));
      }
      const target = parseHttpTargetUrl(input.targetUrl);
      if ("error" in target) {
        return yield* Effect.fail(new EnvironmentProfileError({ detail: target.error }));
      }

      const existing =
        input.id === undefined
          ? undefined
          : document.profiles.find((profile) => profile.id === input.id);
      if (input.id !== undefined && existing === undefined) {
        return yield* Effect.fail(
          new EnvironmentProfileError({ detail: "Environment profile not found." }),
        );
      }

      const duplicateName = document.profiles.some(
        (profile) =>
          profile.id !== input.id && profile.name.trim().toLowerCase() === name.toLowerCase(),
      );
      if (duplicateName) {
        return yield* Effect.fail(
          new EnvironmentProfileError({
            detail: "An environment profile with this name already exists.",
          }),
        );
      }

      const notes = normalizeOptional(input.notes);
      const authRef = normalizeOptional(input.authRef);
      const profile: EnvironmentProfile = {
        id: input.id ?? makeProfileId(name, document.profiles),
        name,
        targetUrl: target.targetUrl,
        ...(notes !== undefined ? { notes } : {}),
        ...(authRef !== undefined ? { authRef } : {}),
      };
      const profiles =
        existing === undefined
          ? [...document.profiles, profile]
          : document.profiles.map((entry) => (entry.id === profile.id ? profile : entry));
      yield* writeDocument(root, { version: 1, profiles });
      return profile;
    });

  const deleteLocalCredentials: EnvironmentProfileServiceShape["deleteLocalCredentials"] = (
    authRef,
  ) =>
    Effect.gen(function* () {
      const root = yield* project.currentPath;
      const cleaned = yield* cleanAuthRef(authRef);
      yield* sql`
        DELETE FROM environment_profile_credentials
        WHERE project_path = ${root} AND auth_ref = ${cleaned}
      `.pipe(Effect.orDie);
    });

  const deleteProfile: EnvironmentProfileServiceShape["delete"] = (
    id,
    deleteLocalCredentialsFlag,
  ) =>
    Effect.gen(function* () {
      const root = yield* project.currentPath;
      const document = yield* readDocument(root);
      const profile = document.profiles.find((entry) => entry.id === id);
      if (profile === undefined) {
        return yield* Effect.fail(
          new EnvironmentProfileError({ detail: "Environment profile not found." }),
        );
      }
      if (deleteLocalCredentialsFlag && profile.authRef !== undefined) {
        yield* deleteLocalCredentials(profile.authRef);
      }
      yield* writeDocument(root, {
        version: 1,
        profiles: document.profiles.filter((entry) => entry.id !== id),
      });
    });

  const listLocalCredentialStatuses: EnvironmentProfileServiceShape["listLocalCredentialStatuses"] =
    Effect.gen(function* () {
      const root = yield* project.currentPath;
      const rows = yield* sql`
        SELECT auth_ref FROM environment_profile_credentials
        WHERE project_path = ${root}
        ORDER BY auth_ref ASC
      `.pipe(Effect.orDie);
      return rows.map((row) => ({
        authRef: String(row.auth_ref),
        hasCredentials: true,
      }));
    });

  const getLocalCredentials: EnvironmentProfileServiceShape["getLocalCredentials"] = (authRef) =>
    Effect.gen(function* () {
      const root = yield* project.currentPath;
      const cleaned = yield* cleanAuthRef(authRef);
      const rows = yield* sql`
        SELECT username, password FROM environment_profile_credentials
        WHERE project_path = ${root} AND auth_ref = ${cleaned}
      `.pipe(Effect.orDie);
      const first = rows[0];
      if (first === undefined) return undefined;
      return {
        username: String(first.username),
        password: String(first.password),
      };
    });

  const saveLocalCredentials: EnvironmentProfileServiceShape["saveLocalCredentials"] = (
    authRef,
    credentials,
  ) =>
    Effect.gen(function* () {
      const root = yield* project.currentPath;
      const cleaned = yield* cleanAuthRef(authRef);
      if (credentials.username.trim() === "" || credentials.password === "") {
        return yield* Effect.fail(
          new EnvironmentProfileError({
            detail: "Basic Auth username and password are required.",
          }),
        );
      }
      const now = DateTime.formatIso(yield* DateTime.now);
      yield* sql`
        INSERT INTO environment_profile_credentials
          (project_path, auth_ref, username, password, updated_at)
        VALUES (${root}, ${cleaned}, ${credentials.username}, ${credentials.password}, ${now})
        ON CONFLICT (project_path, auth_ref) DO UPDATE SET
          username = excluded.username,
          password = excluded.password,
          updated_at = excluded.updated_at
      `.pipe(Effect.orDie);
    });

  const resolveRunTarget: EnvironmentProfileServiceShape["resolveRunTarget"] = (target) =>
    Effect.gen(function* () {
      if (target.kind === "adHoc") {
        return {
          baseUrl: target.baseUrl,
          ...(target.httpCredentials !== undefined
            ? { httpCredentials: target.httpCredentials }
            : {}),
        };
      }

      const profile = yield* get(target.environmentProfileId);
      const credentials =
        profile.authRef === undefined ? undefined : yield* getLocalCredentials(profile.authRef);
      if (profile.authRef !== undefined && credentials === undefined) {
        return yield* Effect.fail(
          new EnvironmentProfileError({
            detail: `Local credentials missing for ${profile.authRef}.`,
          }),
        );
      }
      return {
        baseUrl: profile.targetUrl,
        environmentProfileName: profile.name,
        ...(credentials !== undefined ? { httpCredentials: credentials } : {}),
      };
    });

  return {
    list,
    get,
    save,
    delete: deleteProfile,
    listLocalCredentialStatuses,
    getLocalCredentials,
    saveLocalCredentials,
    deleteLocalCredentials,
    resolveRunTarget,
  } satisfies EnvironmentProfileServiceShape;
});

export const EnvironmentProfileServiceLive = Layer.effect(EnvironmentProfileService, make);
