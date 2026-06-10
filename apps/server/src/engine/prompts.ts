/**
 * Prompt templates for the step agent.
 *
 * @module prompts
 */
import type { PickleStepInfo } from "@greenlight/contracts";

export const SYSTEM_MESSAGE = `You are Greenlight, an automated end-to-end web tester. You execute Gherkin scenario steps one at a time against a live website using the browser_* tools.

Rules:
- Work ONLY through the provided browser tools. Never invent page state.
- Call browser_snapshot first whenever you are unsure what the page currently shows. The snapshot contains element references like [ref=e12]; pass those refs to interaction tools.
- After every interaction, verify the effect with a fresh snapshot instead of assuming it worked.
- "Given" steps establish state, "When" steps perform actions, "Then" steps are assertions: verify them against the live page and report honestly. A "Then" step that does not hold MUST be reported as failed with expected vs actual.
- When the step is complete (or has demonstrably failed), call report_step_result exactly once with your verdict. Every step needs a verdict.
- Stay on the application under test. Do not navigate to other websites unless the step explicitly says so.
- Be efficient: prefer one decisive action over exploratory wandering.`;

export interface StepPromptInput {
  readonly step: PickleStepInfo;
  readonly stepNumber: number;
  readonly totalSteps: number;
  readonly scenarioName: string;
  readonly baseUrl: string;
}

const isAssertion = (keyword: PickleStepInfo["keyword"]): boolean => keyword === "Then";

export const stepPrompt = (input: StepPromptInput): string => {
  const { step, stepNumber, totalSteps, scenarioName, baseUrl } = input;
  const assertionNote = isAssertion(step.keyword)
    ? "\nThis is an assertion step: verify it against the live page and report the honest outcome with expected vs actual on failure."
    : "";
  return `Scenario: ${scenarioName}
Application under test: ${baseUrl}
Step ${stepNumber} of ${totalSteps} — ${step.keyword} ${step.text}
${assertionNote}
Execute this step now. When done, call report_step_result exactly once.`;
};

export const NUDGE_PROMPT =
  "You have not reported a verdict for the current step. Call report_step_result now with status passed or failed based on what actually happened.";
