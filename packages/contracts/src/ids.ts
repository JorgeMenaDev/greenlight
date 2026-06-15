/**
 * Branded identifiers and base schemas shared across contracts.
 *
 * @module ids
 */
import * as Schema from "effect/Schema";

export const TrimmedNonEmptyString = Schema.String.check(Schema.isNonEmpty());

export const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** ISO-8601 timestamp string. */
export const IsoDateTime = Schema.String;
export type IsoDateTime = typeof IsoDateTime.Type;

const makeEntityId = <Brand extends string>(brand: Brand) =>
  TrimmedNonEmptyString.pipe(Schema.brand(brand));

export const RunId = makeEntityId("RunId");
export type RunId = typeof RunId.Type;

export const PickleId = makeEntityId("PickleId");
export type PickleId = typeof PickleId.Type;

export const EvidenceId = makeEntityId("EvidenceId");
export type EvidenceId = typeof EvidenceId.Type;

export const EnvironmentProfileId = makeEntityId("EnvironmentProfileId");
export type EnvironmentProfileId = typeof EnvironmentProfileId.Type;
