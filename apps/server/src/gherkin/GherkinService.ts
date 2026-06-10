/**
 * GherkinService - parses .feature sources into pickles.
 *
 * Pickles are Gherkin's compiled scenarios: Background steps are folded
 * into each scenario and every Scenario Outline Examples row becomes its
 * own pickle. The engine operates exclusively on pickles.
 *
 * @module GherkinService
 */
import { generateMessages } from "@cucumber/gherkin";
import * as messages from "@cucumber/messages";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  GherkinParseError,
  type ParsedFeature,
  type ParsedScenario,
  PickleId,
  type StepKeyword,
} from "@greenlight/contracts";

export interface ParseFeatureResult {
  readonly feature: ParsedFeature | undefined;
  readonly errors: ReadonlyArray<GherkinParseError>;
}

export interface GherkinServiceShape {
  /**
   * Parse a feature source. Parse failures are returned in `errors`
   * rather than failing the effect.
   */
  readonly parseFeature: (content: string, uri: string) => Effect.Effect<ParseFeatureResult>;
}

export class GherkinService extends Context.Service<GherkinService, GherkinServiceShape>()(
  "greenlight/gherkin/GherkinService",
) {}

const KEYWORDS: ReadonlyArray<StepKeyword> = ["Given", "When", "Then", "And", "But", "*"];

const normalizeKeyword = (raw: string | undefined): StepKeyword => {
  const trimmed = raw?.trim() ?? "*";
  return KEYWORDS.includes(trimmed as StepKeyword) ? (trimmed as StepKeyword) : "*";
};

/** Map every AST step id to its keyword so pickle steps can show Given/When/Then. */
const collectStepKeywords = (document: messages.GherkinDocument): Map<string, StepKeyword> => {
  const byId = new Map<string, StepKeyword>();
  const addSteps = (steps: ReadonlyArray<messages.Step>) => {
    for (const step of steps) byId.set(step.id, normalizeKeyword(step.keyword));
  };
  for (const child of document.feature?.children ?? []) {
    if (child.background) addSteps(child.background.steps);
    if (child.scenario) addSteps(child.scenario.steps);
    for (const ruleChild of child.rule?.children ?? []) {
      if (ruleChild.background) addSteps(ruleChild.background.steps);
      if (ruleChild.scenario) addSteps(ruleChild.scenario.steps);
    }
  }
  return byId;
};

export const make = (): GherkinServiceShape => ({
  parseFeature: (content, uri) =>
    Effect.sync(() => {
      // Incrementing ids keep pickle ids stable for identical content, so
      // clients can target a scenario across re-parses.
      const envelopes = generateMessages(
        content,
        uri,
        messages.SourceMediaType.TEXT_X_CUCUMBER_GHERKIN_PLAIN,
        {
          newId: messages.IdGenerator.incrementing(),
          includeSource: false,
          includeGherkinDocument: true,
          includePickles: true,
        },
      );

      const errors: Array<GherkinParseError> = [];
      let document: messages.GherkinDocument | undefined;
      const pickles: Array<messages.Pickle> = [];

      for (const envelope of envelopes) {
        if (envelope.parseError) {
          errors.push(
            new GherkinParseError({
              uri,
              detail: envelope.parseError.message,
              ...(envelope.parseError.source.location
                ? {
                    line: envelope.parseError.source.location.line,
                    ...(envelope.parseError.source.location.column !== undefined
                      ? { column: envelope.parseError.source.location.column }
                      : {}),
                  }
                : {}),
            }),
          );
        }
        if (envelope.gherkinDocument) document = envelope.gherkinDocument;
        if (envelope.pickle) pickles.push(envelope.pickle);
      }

      if (document?.feature === undefined) {
        return { feature: undefined, errors };
      }

      const keywords = collectStepKeywords(document);
      const scenarios: Array<ParsedScenario> = pickles.map((pickle) => ({
        pickleId: PickleId.make(pickle.id),
        name: pickle.name,
        tags: pickle.tags.map((tag) => tag.name),
        steps: pickle.steps.map((step) => ({
          keyword: normalizeKeyword(
            step.astNodeIds[0] !== undefined ? keywords.get(step.astNodeIds[0]) : undefined,
          ),
          text: step.text,
        })),
      }));

      const feature: ParsedFeature = {
        name: document.feature.name,
        description: document.feature.description.trim(),
        scenarios,
      };

      return { feature, errors };
    }),
});

export const GherkinServiceLive = Layer.sync(GherkinService, make);
