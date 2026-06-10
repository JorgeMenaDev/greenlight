/**
 * applyRunEvent - fold a RunEvent into a Run snapshot.
 *
 * Used by the server (persisted snapshot) and the web client (live run
 * view) so both reconstruct identical state from the same event stream.
 *
 * @module runReducer
 */
import type { RunEvent } from "./events.ts";
import type { Run, ScenarioResult } from "./run.ts";

const updateScenario = (
  run: Run,
  pickleId: string,
  update: (scenario: ScenarioResult) => ScenarioResult,
): Run => ({
  ...run,
  scenarios: run.scenarios.map((scenario) =>
    scenario.pickleId === pickleId ? update(scenario) : scenario,
  ),
});

export const applyRunEvent = (run: Run | undefined, event: RunEvent): Run | undefined => {
  switch (event.type) {
    case "run.started":
      return event.run;
    case "scenario.started":
      return run === undefined
        ? run
        : updateScenario(run, event.pickleId, (scenario) => ({
            ...scenario,
            status: "running",
            startedAt: event.at,
          }));
    case "step.started":
      return run === undefined
        ? run
        : updateScenario(run, event.pickleId, (scenario) => ({
            ...scenario,
            steps: scenario.steps.map((step) =>
              step.index === event.stepIndex
                ? { ...step, status: "running", startedAt: event.at }
                : step,
            ),
          }));
    case "agent.activity":
      return run;
    case "step.finished":
      return run === undefined
        ? run
        : updateScenario(run, event.pickleId, (scenario) => ({
            ...scenario,
            steps: scenario.steps.map((step) =>
              step.index === event.stepIndex ? event.result : step,
            ),
          }));
    case "scenario.finished":
      return run === undefined
        ? run
        : updateScenario(run, event.pickleId, (scenario) => ({
            ...scenario,
            status: event.status,
            finishedAt: event.at,
          }));
    case "run.finished":
      return run === undefined
        ? run
        : {
            ...run,
            status: event.status,
            finishedAt: event.at,
            ...(event.error !== undefined ? { error: event.error } : {}),
          };
  }
};
