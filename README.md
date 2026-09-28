# Greenlight

AI-driven end-to-end web testing from plain-English Gherkin scenarios.

Write test cases as Cucumber Gherkin `.feature` files — **no step definitions, no selectors, no glue code**. Point Greenlight at a URL, and an AI agent interprets each step, drives a real browser, verifies your `Then` assertions, and reports pass/fail with screenshots as evidence.

```gherkin
Feature: TodoMVC

  Scenario: Add a todo
    Given I am on the todo app
    When I add a todo called "buy milk"
    Then I should see "buy milk" in the todo list
```

That's the whole test. No `Given(...)` implementations anywhere.

<!-- TODO: screenshot of the Greenlight desktop app running a feature file -->

## How it works

1. Greenlight parses your `.feature` files with the official Gherkin parser — scenarios, scenario outlines, backgrounds, and examples tables all work.
2. For each scenario, an agent session is created via the [GitHub Copilot SDK](https://github.com/github/copilot-sdk). The agent is handed a set of Playwright-backed browser tools (navigate, click, type, …) and one step at a time.
3. The agent works **snapshot-first**: it reads an accessibility snapshot of the page to decide what to interact with, instead of guessing CSS selectors. Screenshots are captured along the way and stored as evidence.
4. Every step ends with a **mandatory verdict tool call** — the agent cannot waffle. It must report passed or failed with a reason, and `Then` steps must be backed by what the agent actually observed on the page.
5. Results, step verdicts, timing, and evidence are persisted to SQLite and streamed live to connected UIs over a WebSocket RPC protocol (late subscribers get a replay).

Because the agent interprets intent rather than matching step text, the same feature file keeps working across cosmetic UI changes that would break selector-based suites.

## Requirements

- **Node.js >= 22.18**
- **pnpm** (the repo pins `pnpm@10.28.2` via `packageManager`)
- **A GitHub Copilot subscription** — the Free tier works. Sign in with the GitHub CLI (`gh auth login`) or the Copilot CLI before running; Greenlight picks up your existing Copilot credentials.

## Quickstart

```sh
pnpm install
pnpm --filter @greenlight/server exec playwright install chromium
```

### Headless demo (no UI)

Run a feature file against a live site straight from the terminal:

```sh
pnpm --filter @greenlight/server exec node src/bin.ts demo ../../examples/todomvc/todo.feature --url https://demo.playwright.dev/todomvc
```

You'll see each step interpreted live, with per-step and per-scenario verdicts at the end. Add `--model <id>` to pick a specific Copilot model. (The command runs inside `apps/server`, hence the `../../` in the feature path — equivalently, run `node apps/server/src/bin.ts demo examples/todomvc/todo.feature --url …` from the repo root.)

### Model benchmark (compare Copilot models)

Run the same feature across several Copilot models and compare wall-clock time plus token/premium cost:

```sh
node apps/server/src/bin.ts benchmark examples/todomvc/todo.feature \
  --url https://demo.playwright.dev/todomvc \
  --models gpt-5-mini,gemini-3.5-flash
```

Results print as a comparison table and are written to `<dataDir>/benchmark/benchmark.json` (override with `--out`). Re-running with an extra model reuses cached results for models already benchmarked; pass `--no-cache` or `--refresh` to force a full re-run. Omit `--models` to use the default template in `apps/server/benchmark/models.default.json`.

Open `apps/server/benchmark/dashboard.html` in a browser and **Load benchmark.json** to chart the report. Reasoning effort is not pinned — each model runs at its Copilot runtime default.

Per-scenario token usage is also shown in the web UI run view and run history after a live run completes.

### Engine server + browser UI

```sh
GREENLIGHT_WEB_ORIGIN=http://127.0.0.1:5733 node apps/server/src/bin.ts
# In another terminal:
bun run --cwd apps/web dev --host 127.0.0.1
```

Open the web UI at `http://127.0.0.1:5733/?server=http://127.0.0.1:4773#token=<launch-token>`, using the token from the server's local launch link. Use `127.0.0.1` for both origins so the session cookie stays same-site.

### Desktop app (Electron)

```sh
pnpm dev:desktop
```

The desktop shell spawns its own local engine server and connects to it automatically.

## Local access and saved credentials

The engine binds only to loopback. Open the launch link printed by a standalone server, or let the desktop app open it. The UI exchanges the fragment token for an HttpOnly, SameSite=Strict session cookie and removes the fragment. Restarting a standalone server with a generated token invalidates its session. A configured token stays valid until it is rotated. Host and Origin checks reject unrelated websites; RPC and evidence require authentication.

Treat the launch link as a local password. For a managed standalone process, inject `GREENLIGHT_AUTH_TOKEN` as 32 random bytes in lowercase hexadecimal. When supplied, the server does not print it. Non-browser RPC clients pass the token as the optional second argument to `layerGreenlightClient`; HTTP clients use a Bearer header. `GREENLIGHT_WEB_ORIGIN` permits one exact loopback HTTP origin for a separate dev UI.

Desktop saves a random credential-encryption key through Electron's OS secure store. It refuses unavailable secure storage and Linux's plaintext fallback. Standalone servers that save Basic Auth passwords need a persistent `GREENLIGHT_CREDENTIAL_KEY`, also 32 random bytes in lowercase hexadecimal, injected from a secret store. Keep the same key across launches. Both secrets are removed from the server's environment before it starts child processes.

On startup, existing plaintext password rows migrate transactionally to AES-256-GCM ciphertext bound to their project path and credential reference. If the key is unavailable, migration stops without changing passwords. Usernames remain local metadata. Existing backups may still contain old plaintext; protect them separately. Keep the OS key store and encrypted key file with desktop backups, or the standalone key with standalone backups. An older binary cannot safely read migrated credentials, so restore a matching protected pre-upgrade backup if rolling back.

Feature operations accept only `.feature` paths inside the opened project and reject descendant symlinks. This protects against remote file access through the API; it does not isolate a process that already controls your OS account or can race filesystem changes.

## Architecture

Greenlight is a pnpm monorepo built on [Effect](https://effect.website), pinned to an Effect **4.0 beta** via the pnpm catalog — see [CONTRIBUTING.md](./CONTRIBUTING.md) for the caveats that come with that.

| Package | Path | What it is |
| --- | --- | --- |
| `@greenlight/contracts` | `packages/contracts` | Shared Schema types and the WebSocket RPC group — the single source of truth for the client/server protocol |
| `@greenlight/shared` | `packages/shared` | Small shared utilities (port helpers, drainable workers) |
| `@greenlight/client-runtime` | `packages/client-runtime` | WS RPC client used by every UI (web, desktop, scripts) |
| `@greenlight/server` | `apps/server` | The headless engine: Gherkin parsing, Copilot agent sessions, Playwright browser tools, SQLite persistence, run event streams with replay, evidence serving |
| `@greenlight/web` | `apps/web` | React UI (runs in any browser, or inside the desktop shell) |
| `@greenlight/desktop` | `apps/desktop` | Electron shell that manages a local engine server process |

The design is **headless-engine-first**, mirroring the t3code reference architecture: the engine is a standalone server exposing a WebSocket RPC API (`GET /ws`), evidence over HTTP (`GET /evidence/:id`), and a health check (`GET /healthz`); in production it also serves the built web UI. The Electron app is a thin shell around the same server the web UI talks to — the same engine serves the desktop app and authenticated local clients.

## Status & roadmap

Early but functional. Working today:

- Gherkin parsing (scenarios, outlines, backgrounds, examples)
- Copilot-driven step interpretation with Playwright browser tools
- Mandatory per-step verdicts with screenshot evidence
- SQLite persistence of runs, steps, and evidence
- Live run event streaming over WS RPC, with replay for late subscribers
- Headless `demo` CLI command
- Per-scenario Copilot token usage in runs and history
- `benchmark` CLI + JSON report for comparing models on the same feature

Toward v1:

- [x] M0 — monorepo scaffold + walking skeleton
- [x] M1 — headless engine vertical slice (`demo` command)
- [x] M2 — persistence + full RPC surface
- [x] M3 — web renderer (run UI, live step feed, evidence viewer)
- [x] M4 — Electron desktop shell
- [x] M5 — onboarding + packaging
- [ ] M6 — OSS polish

## License

[MIT](./LICENSE)
