# Capture token usage per Scenario via the SDK session aggregate

Each Scenario runs in its own Copilot SDK session, so after a Scenario's steps finish the engine reads `session.rpc.usage.getMetrics()` and records `inputTokens`, `outputTokens`, and `premiumRequestCost` on that Scenario's result. A Run's usage is derived by summing its Scenarios; it is never stored as a separate field, so it cannot drift from the per-Scenario numbers.

## Considered Options

- **Sum the per-call `assistant.usage` events.** Rejected: a single Scenario turn can trigger several tool-follow-up model calls, and summing the per-event `cost` risks over-counting premium requests, which GitHub bills per user-initiated request rather than per API call. `getMetrics()` returns the runtime's own authoritative `totalPremiumRequestCost`.
- **Live token ticking as a new run event.** Rejected for now: the need is a per-Scenario summary, and the usage total is folded into the existing `scenario.finished` event instead of adding an ephemeral event type.

## Consequences

- Both `session.rpc.usage.getMetrics()` and the usage fields it returns are marked `@experimental` in the SDK; the mapping is isolated in `CopilotService` so a shape change is contained.
- `usage` is optional on `ScenarioResult`. Runs persisted before this change have no usage in their `run_json` snapshot and render as "—"; no migration is required.
