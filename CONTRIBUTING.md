# Contributing to Greenlight

Thanks for your interest! This document covers everything you need to get a dev environment running and land a change.

## Dev setup

Prerequisites:

- Node.js >= 22.18 (the server runs TypeScript directly via Node's native type stripping — no build step in dev)
- pnpm (the repo pins `pnpm@10.28.2` via the `packageManager` field; `corepack enable` is the easiest way to get it)
- A GitHub Copilot subscription (Free tier is fine) with credentials available locally — sign in with `gh auth login` or the Copilot CLI
- Chromium for Playwright

```sh
pnpm install
npx playwright install chromium
pnpm typecheck   # should pass before and after your change
pnpm lint        # oxlint
pnpm fmt         # prettier --write .
```

## Repo layout

```
packages/contracts        Schema types + WS RPC definitions (src/rpc.ts) — the protocol's single source of truth
packages/shared           Net/port helpers, DrainableWorker
packages/client-runtime   GreenlightRpcClient + layerGreenlightClient(url) — the WS RPC client
apps/server               The engine: Gherkin parsing, Copilot sessions, Playwright tools, SQLite, run events, evidence
apps/web                  React UI
apps/desktop              Electron shell
examples/                 Sample .feature files used by the demo command
```

If you change the client/server protocol, change `packages/contracts` first — both sides are typed off it.

## Running each app

```sh
# Engine server (http://127.0.0.1:4773; GREENLIGHT_PORT / GREENLIGHT_HOST / GREENLIGHT_DATA_DIR to override)
pnpm dev:server

# Web UI dev server, then open http://localhost:5733/?server=http://127.0.0.1:4773
pnpm --filter @greenlight/web dev

# Electron desktop shell
pnpm dev:desktop

# Headless demo run (the fastest way to exercise the whole engine end to end)
pnpm --filter @greenlight/server exec node src/bin.ts demo ../../examples/todomvc/todo.feature --url https://demo.playwright.dev/todomvc
```

## Effect 4 beta caveats

Greenlight is built on **Effect 4.0 beta**, pinned via the pnpm catalog in `pnpm-workspace.yaml` (currently `4.0.0-beta.78`, with overrides so every package resolves the same build). Use `"catalog:"` as the version specifier for `effect`, `@effect/platform-node`, `typescript`, and `@types/node` in any package.json you touch — never a literal version.

The Effect 4 API differs from Effect 3 (and from most online examples), so trust the existing code over your instincts. Notable differences you'll hit:

- `Schema.Literals([...])` for literal unions; `Schema.Union([A, B])` takes an **array**; tagged errors via `Schema.TaggedErrorClass<Self>()("Tag", { fields })`; branded constructors are `.make(value)`.
- Services: `class Foo extends Context.Service<Foo, FooShape>()("id") {}` paired with `Layer.effect(Foo, makeEffect)`.
- `Effect.catch` (not `catchAll`); `Effect.timeout("5 seconds")`; semaphores via `effect/Semaphore`.
- RPC and HTTP modules live under `effect/unstable/rpc` and `effect/unstable/http`.
- Scope pitfall: `Effect.provide(layer)` tears the layer down when that effect ends. Provide clients/protocols **around** their entire usage, or build them with `Layer.build` inside a long-lived Scope.

When bumping the beta, update the catalog versions in `pnpm-workspace.yaml` only, then run `pnpm install` and `pnpm typecheck`.

## Code style & verification

- Strict TypeScript everywhere: each package's tsconfig extends `tsconfig.base.json` (strict, NodeNext, `verbatimModuleSyntax`, `exactOptionalPropertyTypes`). Don't loosen compiler options.
- Formatting and linting are enforced by Prettier and oxlint — run `pnpm fmt` and `pnpm lint` before opening a PR.
- **Do not write tests.** This is project policy: the interesting behavior is an LLM agent driving a real browser, which doesn't unit-test meaningfully. Verification is manual — run the headless demo command above (and the affected UI, if you touched one) and confirm the run completes with sensible verdicts. Describe what you ran in your PR.
- CI runs `pnpm typecheck` (and the placeholder `pnpm test`, which must remain green via `--passWithNoTests`).

## Commit conventions

Use short, imperative, scoped subjects in the [Conventional Commits](https://www.conventionalcommits.org/) style:

```
feat(server): replay run events to late subscribers
fix(contracts): make run.subscribe payload optional
docs: expand quickstart
```

Keep PRs focused on one change; protocol changes (`packages/contracts`) should land together with both sides that use them.
