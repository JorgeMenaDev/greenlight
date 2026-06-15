/**
 * Run target contracts shared by the UI and server.
 *
 * @module targets
 */
import * as Schema from "effect/Schema";

import { BasicAuthCredentials } from "./auth.ts";
import { EnvironmentProfileId } from "./ids.ts";

export const isHttpTargetUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

export const HttpTargetUrl = Schema.String.check(
  Schema.makeFilter(
    (value) =>
      isHttpTargetUrl(value) ? undefined : { path: [], issue: "an absolute http(s) URL" },
    { title: "HttpTargetUrl" },
  ),
).pipe(Schema.brand("HttpTargetUrl"));
export type HttpTargetUrl = typeof HttpTargetUrl.Type;

export const parseHttpTargetUrl = (
  raw: string,
): { readonly targetUrl: HttpTargetUrl } | { readonly error: string } => {
  const targetUrl = raw.trim();
  if (targetUrl === "") return { error: "Target URL is required." };
  if (!isHttpTargetUrl(targetUrl)) {
    return { error: "Target URL must be an absolute http:// or https:// URL." };
  }
  return { targetUrl: targetUrl as HttpTargetUrl };
};

export const RunTarget = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("adHoc"),
    baseUrl: HttpTargetUrl,
    httpCredentials: Schema.optional(BasicAuthCredentials),
  }),
  Schema.Struct({
    kind: Schema.Literal("environmentProfile"),
    environmentProfileId: EnvironmentProfileId,
  }),
]);
export type RunTarget = typeof RunTarget.Type;
