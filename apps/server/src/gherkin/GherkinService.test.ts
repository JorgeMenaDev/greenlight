import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";

import { make } from "./GherkinService.ts";

const gherkin = make();

const parse = (content: string) => Effect.runPromise(gherkin.parseFeature(content, "test.feature"));

describe("GherkinService", () => {
  it("parses scenarios with keywords preserved", async () => {
    const { feature, errors } = await parse(`Feature: Demo
  Scenario: First
    Given I am on the page
    When I click the button
    Then I should see a result
    And the counter should be 1
`);
    expect(errors).toHaveLength(0);
    expect(feature?.name).toBe("Demo");
    expect(feature?.scenarios).toHaveLength(1);
    expect(feature?.scenarios[0]?.steps.map((step) => step.keyword)).toEqual([
      "Given",
      "When",
      "Then",
      "And",
    ]);
  });

  it("folds Background steps into every pickle", async () => {
    const { feature } = await parse(`Feature: Demo
  Background:
    Given I am logged in

  Scenario: A
    When I do a thing

  Scenario: B
    When I do another thing
`);
    expect(feature?.scenarios).toHaveLength(2);
    for (const scenario of feature?.scenarios ?? []) {
      expect(scenario.steps[0]).toEqual({ keyword: "Given", text: "I am logged in" });
      expect(scenario.steps).toHaveLength(2);
    }
  });

  it("expands Scenario Outline examples into separate pickles", async () => {
    const { feature } = await parse(`Feature: Demo
  Scenario Outline: Add <count> items
    When I add <count> items
    Then I should see "<label>"

    Examples:
      | count | label        |
      | 1     | 1 item left  |
      | 3     | 3 items left |
`);
    expect(feature?.scenarios).toHaveLength(2);
    expect(feature?.scenarios[0]?.steps[0]?.text).toBe("I add 1 items");
    expect(feature?.scenarios[1]?.steps[1]?.text).toBe('I should see "3 items left"');
    const ids = feature?.scenarios.map((scenario) => scenario.pickleId);
    expect(new Set(ids).size).toBe(2);
  });

  it("returns structured errors for malformed gherkin", async () => {
    const { feature, errors } = await parse(`Feature: Broken
  Scenario: X
    Given ok
   unparseable line outside any step
  | table | out of place |
`);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.uri).toBe("test.feature");
    expect(errors[0]?.line).toBeGreaterThan(0);
    void feature;
  });

  it("keeps pickle ids stable for identical content", async () => {
    const source = `Feature: Stable
  Scenario: One
    Given a step
`;
    const first = await parse(source);
    const second = await parse(source);
    expect(first.feature?.scenarios[0]?.pickleId).toBe(second.feature?.scenarios[0]?.pickleId);
  });
});
