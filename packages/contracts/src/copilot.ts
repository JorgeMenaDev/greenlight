/**
 * Copilot contracts - auth status and model listing.
 *
 * @module copilot
 */
import * as Schema from "effect/Schema";

export const CopilotAuthStatus = Schema.Struct({
  state: Schema.Literals(["authenticated", "unauthenticated", "error"]),
  login: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
});
export type CopilotAuthStatus = typeof CopilotAuthStatus.Type;

export const CopilotModel = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});
export type CopilotModel = typeof CopilotModel.Type;

export class CopilotUnavailableError extends Schema.TaggedErrorClass<CopilotUnavailableError>()(
  "CopilotUnavailableError",
  {
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}
