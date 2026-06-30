/**
 * CopilotService - GitHub Copilot SDK client lifecycle and sessions.
 *
 * The SDK spawns the bundled Copilot CLI as a JSON-RPC subprocess on
 * first use; the process is stopped when the service layer's scope
 * closes. Authentication uses the SDK credential chain (copilot / gh
 * CLI login or COPILOT_GITHUB_TOKEN / GH_TOKEN / GITHUB_TOKEN).
 *
 * @module CopilotService
 */
import * as NodeFs from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";

import { approveAll, CopilotClient, type CopilotSession } from "@github/copilot-sdk";

import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";

import type { Usage } from "@greenlight/contracts";

import type { AgentTool } from "../engine/AgentTool.ts";

export class CopilotError extends Data.TaggedError("CopilotError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface CopilotAuthState {
  readonly state: "authenticated" | "unauthenticated" | "error";
  readonly login?: string;
  readonly message?: string;
}

export interface AgentSessionOptions {
  readonly model?: string | undefined;
  readonly systemMessage: string;
  readonly tools: ReadonlyArray<AgentTool>;
}

export interface AgentSession {
  /**
   * Send one user message and wait until the agent turn completes
   * (tool calls included). Resolves with the final assistant text.
   */
  readonly sendAndWait: (
    prompt: string,
    timeoutMs: number,
  ) => Effect.Effect<string | undefined, CopilotError>;
  /**
   * Read usage + resolved model from one SDK metrics call. Usage is
   * undefined when the runtime reports no meaningful metrics so a Scenario
   * renders "not captured", not zero.
   */
  readonly readSessionMetrics: Effect.Effect<{
    readonly usage: Usage | undefined;
    readonly model: string | undefined;
  }>;
}

export interface CopilotServiceShape {
  /** Never fails: auth problems come back as `state: "error"`. */
  readonly authStatus: Effect.Effect<CopilotAuthState>;
  readonly listModels: Effect.Effect<
    ReadonlyArray<{ readonly id: string; readonly name: string }>,
    CopilotError
  >;
  readonly createSession: (
    options: AgentSessionOptions,
  ) => Effect.Effect<AgentSession, CopilotError, Scope.Scope>;
}

export class CopilotService extends Context.Service<CopilotService, CopilotServiceShape>()(
  "greenlight/copilot/CopilotService",
) {}

/**
 * The bundled Copilot CLI cannot be spawned directly when this server runs
 * under Electron-as-Node (commander.js misparses argv when
 * `process.versions.electron` is set without `process.defaultApp`), so the
 * SDK is pointed at copilot-cli-shim.js via COPILOT_CLI_PATH and the shim
 * chain-loads the real CLI. The shim sits next to this module in dev (src
 * runs directly) and next to the bundle in prod (tsdown copies it to dist/).
 */
const resolveCliShim = (): { readonly shimPath: string; readonly realCliPath: string } | null => {
  const shimPath = NodePath.join(import.meta.dirname, "copilot-cli-shim.js");
  if (!NodeFs.existsSync(shimPath)) return null;
  // Resolve the real CLI the same way the SDK's getBundledCliPath does, but
  // anchored at the SDK package (under pnpm @github/copilot is only
  // resolvable from there, not from this package).
  const requireFromHere = NodeModule.createRequire(import.meta.url);
  const requireFromSdk = NodeModule.createRequire(requireFromHere.resolve("@github/copilot-sdk"));
  for (const base of requireFromSdk.resolve.paths("@github/copilot") ?? []) {
    const candidate = NodePath.join(base, "@github", "copilot", "index.js");
    if (NodeFs.existsSync(candidate)) return { shimPath, realCliPath: candidate };
  }
  return null;
};

const copilotTry = <A>(message: string, run: () => Promise<A>): Effect.Effect<A, CopilotError> =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new CopilotError({
        message: `${message}: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause,
      }),
  });

type SessionUsageMetrics = Awaited<ReturnType<CopilotSession["rpc"]["usage"]["getMetrics"]>>;

/**
 * Map the SDK's session usage aggregate to our `Usage`. Token totals are
 * summed across per-model metrics (a Scenario normally uses one model);
 * `premiumRequestCost` is the runtime's authoritative premium request
 * count, which correctly bills per user-initiated request (see ADR 0002).
 */
export const toUsage = (metrics: SessionUsageMetrics): Usage => {
  let inputTokens = 0;
  let outputTokens = 0;
  for (const metric of Object.values(metrics.modelMetrics)) {
    if (metric === undefined) continue;
    inputTokens += metric.usage.inputTokens;
    outputTokens += metric.usage.outputTokens;
  }
  return { inputTokens, outputTokens, premiumRequestCost: metrics.totalPremiumRequestCost };
};

/**
 * Map SDK metrics to Usage when the runtime actually reported data.
 * Empty aggregates resolve to undefined so callers show "not captured".
 */
export const usageFromMetrics = (metrics: SessionUsageMetrics): Usage | undefined => {
  const hasModelMetrics = Object.values(metrics.modelMetrics).some(
    (metric) => metric !== undefined,
  );
  if (!hasModelMetrics && metrics.totalPremiumRequestCost === 0) {
    return undefined;
  }
  const usage = toUsage(metrics);
  if (usage.inputTokens === 0 && usage.outputTokens === 0 && usage.premiumRequestCost === 0) {
    return undefined;
  }
  return usage;
};

/** The concrete model id the runtime billed against, if any. */
export const modelFromMetrics = (metrics: SessionUsageMetrics): string | undefined =>
  Object.keys(metrics.modelMetrics)[0];

export const make = Effect.gen(function* () {
  const layerScope = yield* Effect.service(Scope.Scope);
  const clientRef = yield* Ref.make<CopilotClient | undefined>(undefined);
  const startLock = yield* Semaphore.make(1);

  const getClient = startLock.withPermits(1)(
    Effect.gen(function* () {
      const existing = yield* Ref.get(clientRef);
      if (existing !== undefined) return existing;
      const client = yield* copilotTry("Failed to start the Copilot CLI runtime", async () => {
        const shim = resolveCliShim();
        const created = new CopilotClient({
          logLevel: "error",
          ...(shim === null
            ? {}
            : {
                env: {
                  ...process.env,
                  COPILOT_CLI_PATH: shim.shimPath,
                  GREENLIGHT_COPILOT_CLI: shim.realCliPath,
                },
              }),
        });
        await created.start();
        return created;
      });
      yield* Scope.addFinalizer(
        layerScope,
        Effect.promise(() => client.stop()).pipe(Effect.ignore),
      );
      yield* Ref.set(clientRef, client);
      return client;
    }),
  );

  const authStatus: CopilotServiceShape["authStatus"] = Effect.gen(function* () {
    const client = yield* getClient;
    const status = yield* copilotTry("Failed to read Copilot auth status", () =>
      client.getAuthStatus(),
    );
    return {
      state: status.isAuthenticated ? "authenticated" : "unauthenticated",
      ...(status.login !== undefined ? { login: status.login } : {}),
      ...(status.statusMessage !== undefined ? { message: status.statusMessage } : {}),
    } satisfies CopilotAuthState;
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed({ state: "error", message: error.message } satisfies CopilotAuthState),
    ),
  );

  const listModels: CopilotServiceShape["listModels"] = Effect.gen(function* () {
    const client = yield* getClient;
    const models = yield* copilotTry("Failed to list Copilot models", () => client.listModels());
    return models.map((model) => ({ id: model.id, name: model.name }));
  });

  const createSession: CopilotServiceShape["createSession"] = (options) =>
    Effect.gen(function* () {
      const client = yield* getClient;
      const session = yield* Effect.acquireRelease(
        copilotTry("Failed to create Copilot session", () =>
          client.createSession({
            ...(options.model !== undefined ? { model: options.model } : {}),
            tools: options.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
              handler: (args: unknown) => tool.handler(args),
              skipPermission: true,
            })),
            // Restrict the agent to our browser tools: no shell, no file
            // editing, no repo instructions leaking into test runs.
            availableTools: ["custom:*"],
            skipCustomInstructions: true,
            systemMessage: { mode: "append", content: options.systemMessage },
            onPermissionRequest: approveAll,
          }),
        ),
        (created) => Effect.promise(() => created.disconnect()).pipe(Effect.ignore),
      );

      const sendAndWait: AgentSession["sendAndWait"] = (prompt, timeoutMs) =>
        copilotTry("Copilot turn failed", async () => {
          try {
            const reply = await session.sendAndWait({ prompt }, timeoutMs);
            return reply?.data.content;
          } catch (error) {
            await session.abort().catch(() => undefined);
            throw error;
          }
        });

      const readSessionMetrics: AgentSession["readSessionMetrics"] = Effect.tryPromise(() =>
        session.rpc.usage.getMetrics(),
      ).pipe(
        Effect.map((metrics) => ({
          usage: usageFromMetrics(metrics),
          model: modelFromMetrics(metrics),
        })),
        Effect.catch(() =>
          Effect.succeed({ usage: undefined, model: undefined } satisfies {
            readonly usage: Usage | undefined;
            readonly model: string | undefined;
          }),
        ),
      );

      return { sendAndWait, readSessionMetrics } satisfies AgentSession;
    });

  return { authStatus, listModels, createSession } satisfies CopilotServiceShape;
});

export const CopilotServiceLive = Layer.effect(CopilotService, make);
