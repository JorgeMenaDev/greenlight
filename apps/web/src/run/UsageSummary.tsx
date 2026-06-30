/**
 * Tokens + premium request cost for a Scenario or derived Run total.
 */
import type { Usage } from "@greenlight/contracts";

import { formatPremium, formatTokens } from "../lib/format.ts";

export interface UsageSummaryProps {
  readonly usage: Usage;
  /** When fewer scenarios captured usage than ran, hint partial totals. */
  readonly partial?: boolean | undefined;
}

export const UsageSummary = ({ usage, partial }: UsageSummaryProps) => (
  <span
    className="usage-summary"
    title={
      `${usage.inputTokens} input tokens · ${usage.outputTokens} output tokens · ` +
      `${usage.premiumRequestCost} premium requests` +
      (partial === true ? " (partial — not every scenario captured usage)" : "")
    }
  >
    <span className="usage-tokens">
      {formatTokens(usage.inputTokens)} in / {formatTokens(usage.outputTokens)} out
    </span>
    <span className="usage-premium">{formatPremium(usage.premiumRequestCost)} premium</span>
    {partial === true && <span className="usage-partial">partial</span>}
  </span>
);
