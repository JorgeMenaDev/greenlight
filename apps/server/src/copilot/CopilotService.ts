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
import { approveAll, CopilotClient } from "@github/copilot-sdk";

import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";

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

const copilotTry = <A>(message: string, run: () => Promise<A>): Effect.Effect<A, CopilotError> =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new CopilotError({
        message: `${message}: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause,
      }),
  });

export const make = Effect.gen(function* () {
  const layerScope = yield* Effect.service(Scope.Scope);
  const clientRef = yield* Ref.make<CopilotClient | undefined>(undefined);
  const startLock = yield* Semaphore.make(1);

  const getClient = startLock.withPermits(1)(
    Effect.gen(function* () {
      const existing = yield* Ref.get(clientRef);
      if (existing !== undefined) return existing;
      const client = yield* copilotTry("Failed to start the Copilot CLI runtime", async () => {
        const created = new CopilotClient({ logLevel: "error" });
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

      return { sendAndWait } satisfies AgentSession;
    });

  return { authStatus, listModels, createSession } satisfies CopilotServiceShape;
});

export const CopilotServiceLive = Layer.effect(CopilotService, make);
