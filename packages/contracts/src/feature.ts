/**
 * Feature file contracts - parsed Gherkin structure exposed to clients.
 *
 * Greenlight operates on Gherkin *pickles*: compiled scenarios where
 * Background steps are folded in and each Scenario Outline Examples row
 * becomes its own pickle.
 *
 * @module feature
 */
import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, PickleId, TrimmedNonEmptyString } from "./ids.ts";

export const StepKeyword = Schema.Literals(["Given", "When", "Then", "And", "But", "*"]);
export type StepKeyword = typeof StepKeyword.Type;

export const PickleStepInfo = Schema.Struct({
  keyword: StepKeyword,
  text: Schema.String,
});
export type PickleStepInfo = typeof PickleStepInfo.Type;

export const ParsedScenario = Schema.Struct({
  pickleId: PickleId,
  name: Schema.String,
  tags: Schema.Array(Schema.String),
  steps: Schema.Array(PickleStepInfo),
});
export type ParsedScenario = typeof ParsedScenario.Type;

export class GherkinParseError extends Schema.TaggedErrorClass<GherkinParseError>()(
  "GherkinParseError",
  {
    uri: Schema.String,
    detail: Schema.String,
    line: Schema.optional(Schema.Number),
    column: Schema.optional(Schema.Number),
  },
) {
  override get message(): string {
    const location = this.line !== undefined ? `:${this.line}` : "";
    return `Failed to parse ${this.uri}${location}: ${this.detail}`;
  }
}

export const ParsedFeature = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  scenarios: Schema.Array(ParsedScenario),
});
export type ParsedFeature = typeof ParsedFeature.Type;

export const FeatureFileEntry = Schema.Struct({
  /** Path relative to the project root. */
  path: TrimmedNonEmptyString,
  name: Schema.String,
  sizeBytes: NonNegativeInt,
  modifiedAt: IsoDateTime,
});
export type FeatureFileEntry = typeof FeatureFileEntry.Type;
