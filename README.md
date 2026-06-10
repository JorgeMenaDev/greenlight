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
npx playwright install chromium
```

### Headless demo (no UI)

Run a feature file against a live site straight from the terminal:

```sh
pnpm --filter @greenlight/server exec node src/bin.ts demo ../../examples/todomvc/todo.feature --url https://demo.playwright.dev/todomvc
```

You'll see each step interpreted live, with per-step and per-scenario verdicts at the end. Add `--model <id>` to pick a specific Copilot model. (The command runs inside `apps/server`, hence the `../../` in the feature path — equivalently, run `node apps/server/src/bin.ts demo examples/todomvc/todo.feature --url …` from the repo root.)

### Engine server + browser UI

```sh
pnpm dev:server                      # engine server on http://127.0.0.1:4773
pnpm --filter @greenlight/web dev    # web UI dev server
```

Then open <http://localhost:5733/?server=http://127.0.0.1:4773>.

### Desktop app (Electron)

```sh
pnpm dev:desktop
```

The desktop shell spawns its own local engine server and connects to it automatically.

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

The design is **headless-engine-first**, mirroring the t3code reference architecture: the engine is a standalone server exposing a WebSocket RPC API (`GET /ws`), evidence over HTTP (`GET /evidence/:id`), and a health check (`GET /healthz`); in production it also serves the built web UI. The Electron app is a thin shell around the same server the web UI talks to — everything you can do in the desktop app you can also do headlessly or against a remote engine.

## Status & roadmap

Early but functional. Working today:

- Gherkin parsing (scenarios, outlines, backgrounds, examples)
- Copilot-driven step interpretation with Playwright browser tools
- Mandatory per-step verdicts with screenshot evidence
- SQLite persistence of runs, steps, and evidence
- Live run event streaming over WS RPC, with replay for late subscribers
- Headless `demo` CLI command

Toward v1:

- [x] M0 — monorepo scaffold + walking skeleton
- [x] M1 — headless engine vertical slice (`demo` command)
- [x] M2 — persistence + full RPC surface
- [ ] M3 — web renderer (run UI, live step feed, evidence viewer)
- [ ] M4 — Electron desktop shell
- [ ] M5 — onboarding + packaging
- [ ] M6 — OSS polish

## License

[MIT](./LICENSE)
