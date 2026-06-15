/**
 * Environment profile contracts - reusable project-scoped run targets.
 *
 * @module environmentProfiles
 */
import * as Schema from "effect/Schema";

import { EnvironmentProfileId, TrimmedNonEmptyString } from "./ids.ts";
import { HttpTargetUrl } from "./targets.ts";

export const EnvironmentProfile = Schema.Struct({
  id: EnvironmentProfileId,
  name: TrimmedNonEmptyString,
  targetUrl: HttpTargetUrl,
  notes: Schema.optional(Schema.String),
  authRef: Schema.optional(TrimmedNonEmptyString),
});
export type EnvironmentProfile = typeof EnvironmentProfile.Type;

export const EnvironmentProfileInput = Schema.Struct({
  id: Schema.optional(EnvironmentProfileId),
  name: Schema.String,
  targetUrl: Schema.String,
  notes: Schema.optional(Schema.String),
  authRef: Schema.optional(Schema.String),
});
export type EnvironmentProfileInput = typeof EnvironmentProfileInput.Type;

export const EnvironmentProfilesDocument = Schema.Struct({
  version: Schema.Literal(1),
  profiles: Schema.Array(EnvironmentProfile),
});
export type EnvironmentProfilesDocument = typeof EnvironmentProfilesDocument.Type;

export const LocalAuthCredentialStatus = Schema.Struct({
  authRef: TrimmedNonEmptyString,
  hasCredentials: Schema.Boolean,
});
export type LocalAuthCredentialStatus = typeof LocalAuthCredentialStatus.Type;

export class EnvironmentProfileError extends Schema.TaggedErrorClass<EnvironmentProfileError>()(
  "EnvironmentProfileError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}
