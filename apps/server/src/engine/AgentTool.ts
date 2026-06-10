/**
 * AgentTool - the tool shape the engine hands to the LLM session.
 *
 * Mirrors the Copilot SDK's `Tool` interface (JSON-Schema parameters,
 * promise-returning handler) so `CopilotService` can pass tools through
 * unchanged while tests drive the same handlers with a fake session.
 *
 * @module AgentTool
 */
export interface AgentTool {
  readonly name: string;
  readonly description: string;
  /** JSON Schema for the arguments object. */
  readonly parameters: Record<string, unknown>;
  readonly handler: (args: unknown) => Promise<string>;
}

export const toolArgs = (args: unknown): Record<string, unknown> =>
  typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};

export const stringArg = (args: Record<string, unknown>, key: string): string => {
  const value = args[key];
  return typeof value === "string" ? value : "";
};
