/**
 * StepAgent - executes one Gherkin step through an agent session.
 *
 * Sends the step as a prompt, waits for the turn to complete, and reads
 * the verdict the agent reported through `report_step_result`. A missing
 * verdict gets one corrective nudge before the step is failed.
 *
 * @module StepAgent
 */
import * as Effect from "effect/Effect";

import type { PickleStepInfo, StepVerdict } from "@greenlight/contracts";

import type { AgentSession } from "../copilot/CopilotService.ts";
import type { VerdictSlot } from "./PlaywrightTools.ts";
import { NUDGE_PROMPT, stepPrompt } from "./prompts.ts";

export const DEFAULT_STEP_TIMEOUT_MS = 120_000;
export const NUDGE_TIMEOUT_MS = 30_000;
export const DEFAULT_STEP_TOOL_BUDGET = 15;

export interface ExecuteStepOptions {
  readonly session: AgentSession;
  readonly step: PickleStepInfo;
  readonly stepNumber: number;
  readonly totalSteps: number;
  readonly scenarioName: string;
  readonly baseUrl: string;
  readonly verdict: VerdictSlot;
  readonly budget: { remaining: number };
  readonly stepTimeoutMs?: number;
}

const failedVerdict = (summary: string): StepVerdict => ({ status: "failed", summary });

/**
 * Never fails: agent/session errors become a failed verdict.
 */
export const executeStep = (options: ExecuteStepOptions): Effect.Effect<StepVerdict> =>
  Effect.gen(function* () {
    options.verdict.current = null;
    options.budget.remaining = DEFAULT_STEP_TOOL_BUDGET;

    const prompt = stepPrompt({
      step: options.step,
      stepNumber: options.stepNumber,
      totalSteps: options.totalSteps,
      scenarioName: options.scenarioName,
      baseUrl: options.baseUrl,
    });

    yield* options.session.sendAndWait(prompt, options.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS);

    if (options.verdict.current === null) {
      yield* options.session.sendAndWait(NUDGE_PROMPT, NUDGE_TIMEOUT_MS);
    }

    return options.verdict.current ?? failedVerdict("The agent did not report a verdict.");
  }).pipe(
    Effect.catch((error) => Effect.succeed(failedVerdict(`Agent error: ${error.message}`))),
  );
