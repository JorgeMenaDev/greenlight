/**
 * Authentication contracts shared by run configuration and profile storage.
 *
 * @module auth
 */
import * as Schema from "effect/Schema";

export const BasicAuthCredentials = Schema.Struct({
  username: Schema.String,
  password: Schema.String,
});
export type BasicAuthCredentials = typeof BasicAuthCredentials.Type;
