/**
 * Browser contracts - Playwright browser provisioning status.
 *
 * @module browser
 */
import * as Schema from "effect/Schema";

export const BrowserStatus = Schema.Struct({
  state: Schema.Literals(["ready", "missing"]),
  detail: Schema.optional(Schema.String),
});
export type BrowserStatus = typeof BrowserStatus.Type;
