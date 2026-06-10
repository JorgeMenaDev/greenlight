/**
 * Run contracts - the result model for executing scenarios against a URL.
 *
 * @module run
 */
import * as Schema from "effect/Schema";

import { EvidenceId, IsoDateTime, NonNegativeInt, PickleId, RunId } from "./ids.ts";
import { PickleStepInfo } from "./feature.ts";

export const StepStatus = Schema.Literals(["pending", "running", "passed", "failed", "skipped"]);
export type StepStatus = typeof StepStatus.Type;

export const RunStatus = Schema.Literals([
  "queued",
  "running",
  "passed",
  "failed",
  "cancelled",
  "error",
]);
export type RunStatus = typeof RunStatus.Type;

export const EvidenceKind = Schema.Literals(["screenshot", "console", "trace"]);
export type EvidenceKind = typeof EvidenceKind.Type;

export const EvidenceRef = Schema.Struct({
  id: EvidenceId,
  kind: EvidenceKind,
  label: Schema.String,
  createdAt: IsoDateTime,
});
export type EvidenceRef = typeof EvidenceRef.Type;

/**
 * The verdict the agent must report for every step via the
 * `report_step_result` tool.
 */
export const StepVerdict = Schema.Struct({
  status: Schema.Literals(["passed", "failed"]),
  /** What the agent did / observed while executing the step. */
  summary: Schema.String,
  expected: Schema.optional(Schema.String),
  actual: Schema.optional(Schema.String),
});
export type StepVerdict = typeof StepVerdict.Type;

export const StepResult = Schema.Struct({
  index: NonNegativeInt,
  keyword: PickleStepInfo.fields.keyword,
  text: Schema.String,
  status: StepStatus,
  startedAt: Schema.optional(IsoDateTime),
  finishedAt: Schema.optional(IsoDateTime),
  errorMessage: Schema.optional(Schema.String),
  expected: Schema.optional(Schema.String),
  actual: Schema.optional(Schema.String),
  agentSummary: Schema.optional(Schema.String),
  evidence: Schema.Array(EvidenceRef),
});
export type StepResult = typeof StepResult.Type;

export const ScenarioResult = Schema.Struct({
  pickleId: PickleId,
  name: Schema.String,
  status: StepStatus,
  startedAt: Schema.optional(IsoDateTime),
  finishedAt: Schema.optional(IsoDateTime),
  steps: Schema.Array(StepResult),
});
export type ScenarioResult = typeof ScenarioResult.Type;

export const Run = Schema.Struct({
  runId: RunId,
  featurePath: Schema.String,
  baseUrl: Schema.String,
  model: Schema.optional(Schema.String),
  status: RunStatus,
  createdAt: IsoDateTime,
  startedAt: Schema.optional(IsoDateTime),
  finishedAt: Schema.optional(IsoDateTime),
  error: Schema.optional(Schema.String),
  scenarios: Schema.Array(ScenarioResult),
});
export type Run = typeof Run.Type;

export const RunSummary = Schema.Struct({
  runId: RunId,
  featurePath: Schema.String,
  baseUrl: Schema.String,
  status: RunStatus,
  createdAt: IsoDateTime,
  finishedAt: Schema.optional(IsoDateTime),
  scenarioCounts: Schema.Struct({
    passed: NonNegativeInt,
    failed: NonNegativeInt,
    skipped: NonNegativeInt,
  }),
});
export type RunSummary = typeof RunSummary.Type;
