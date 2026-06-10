/**
 * Run events - the live event stream pushed to `run.subscribe` clients.
 *
 * Every event carries the run id, a monotonically increasing per-run
 * sequence number and a timestamp, so clients can replay-then-tail
 * without gaps or duplicates.
 *
 * @module events
 */
import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, PickleId, RunId } from "./ids.ts";
import { Run, RunStatus, StepResult, StepStatus } from "./run.ts";

const eventBase = {
  runId: RunId,
  seq: NonNegativeInt,
  at: IsoDateTime,
};

export const RunStarted = Schema.Struct({
  ...eventBase,
  type: Schema.Literal("run.started"),
  /** Full run snapshot with every step pending. */
  run: Run,
});

export const ScenarioStarted = Schema.Struct({
  ...eventBase,
  type: Schema.Literal("scenario.started"),
  pickleId: PickleId,
});

export const StepStarted = Schema.Struct({
  ...eventBase,
  type: Schema.Literal("step.started"),
  pickleId: PickleId,
  stepIndex: NonNegativeInt,
});

export const AgentActivity = Schema.Struct({
  ...eventBase,
  type: Schema.Literal("agent.activity"),
  pickleId: PickleId,
  stepIndex: NonNegativeInt,
  kind: Schema.Literals(["tool_call", "message"]),
  tool: Schema.optional(Schema.String),
  summary: Schema.String,
});

export const StepFinished = Schema.Struct({
  ...eventBase,
  type: Schema.Literal("step.finished"),
  pickleId: PickleId,
  stepIndex: NonNegativeInt,
  result: StepResult,
});

export const ScenarioFinished = Schema.Struct({
  ...eventBase,
  type: Schema.Literal("scenario.finished"),
  pickleId: PickleId,
  status: StepStatus,
});

export const RunFinished = Schema.Struct({
  ...eventBase,
  type: Schema.Literal("run.finished"),
  status: RunStatus,
  error: Schema.optional(Schema.String),
});

export const RunEvent = Schema.Union([
  RunStarted,
  ScenarioStarted,
  StepStarted,
  AgentActivity,
  StepFinished,
  ScenarioFinished,
  RunFinished,
]);
export type RunEvent = typeof RunEvent.Type;
