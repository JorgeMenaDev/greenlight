/**
 * HTTP routes - health check, evidence blobs, and the static renderer.
 *
 * @module http
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { ServerConfig } from "./config.ts";
import { EvidenceStore } from "./evidence/EvidenceStore.ts";

const EVIDENCE_ROUTE_PREFIX = "/evidence/";

export const healthzRouteLayer = HttpRouter.add(
  "GET",
  "/healthz",
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    return HttpServerResponse.text(`ok ${config.version}`);
  }),
);

export const evidenceRouteLayer = HttpRouter.add(
  "GET",
  `${EVIDENCE_ROUTE_PREFIX}*`,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }
    const id = decodeURIComponent(url.value.pathname.slice(EVIDENCE_ROUTE_PREFIX.length));
    if (id.length === 0 || id.includes("/") || id.includes("..")) {
      return HttpServerResponse.text("Invalid evidence id", { status: 400 });
    }

    const evidence = yield* EvidenceStore;
    const resolved = yield* evidence.resolve(id);
    if (resolved === undefined) {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }

    const fs = yield* FileSystem.FileSystem;
    const info = yield* fs.stat(resolved.filePath).pipe(Effect.orElseSucceed(() => null));
    if (info === null || info.type !== "File") {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }

    return yield* HttpServerResponse.file(resolved.filePath, {
      headers: {
        "content-type": "image/png",
        "cache-control": "private, max-age=31536000, immutable",
      },
    }).pipe(Effect.orDie);
  }),
);

/**
 * Serve the built web renderer in production. Resolution order: bundled
 * `client/` next to the server dist, then the monorepo web build, then the
 * packaged Electron resources layout (resources/server/dist/../../web is
 * resources/web, where electron-builder copies the web dist).
 */
const resolveStaticDir = Effect.gen(function* () {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const candidates = [
    path.resolve(import.meta.dirname, "client"),
    path.resolve(import.meta.dirname, "../../web/dist"),
    path.resolve(import.meta.dirname, "../../web"),
  ];
  for (const candidate of candidates) {
    const hasIndex = yield* fs
      .exists(path.join(candidate, "index.html"))
      .pipe(Effect.orElseSucceed(() => false));
    if (hasIndex) return candidate;
  }
  return undefined;
});

export const staticRouteLayer = HttpRouter.add(
  "GET",
  "*",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const staticDir = yield* resolveStaticDir;
    if (staticDir === undefined) {
      return HttpServerResponse.text(
        "Greenlight server is running. The web client is not built; use the Vite dev server.",
        { status: 200 },
      );
    }

    const path = yield* Path.Path;
    const fs = yield* FileSystem.FileSystem;
    const requested = url.value.pathname === "/" ? "/index.html" : url.value.pathname;
    const relative = path.normalize(requested.replace(/^[/\\]+/, ""));
    if (relative.length === 0 || relative.startsWith("..") || relative.includes("\0")) {
      return HttpServerResponse.text("Invalid path", { status: 400 });
    }

    const filePath = path.join(staticDir, relative);
    const info = yield* fs.stat(filePath).pipe(Effect.orElseSucceed(() => null));
    if (info === null || info.type !== "File") {
      // SPA fallback.
      return yield* HttpServerResponse.file(path.join(staticDir, "index.html")).pipe(Effect.orDie);
    }
    return yield* HttpServerResponse.file(filePath).pipe(Effect.orDie);
  }),
);
