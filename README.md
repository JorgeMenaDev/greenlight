# Greenlight

AI-driven end-to-end web testing from plain-English Gherkin scenarios.

Write test cases as Cucumber Gherkin `.feature` files — **no step definitions**. Point Greenlight at a URL, and an AI agent interprets each step, drives a real browser (Playwright), verifies your `Then` assertions, and reports pass/fail with screenshots and logs as evidence.

```gherkin
Scenario: Add a todo
  Given I am on the todo app
  When I add a todo called "buy milk"
  Then I should see "buy milk" in the todo list
```

## Status

Early development. Architecture: TypeScript + [Effect](https://effect.website) monorepo — a headless engine server, a React UI, and an Electron desktop shell. The LLM layer uses the [GitHub Copilot SDK](https://github.com/github/copilot-sdk) (bring your own Copilot subscription — the Free tier works).

## Development

Requires Node >= 22.18 and pnpm.

```sh
pnpm install
pnpm dev:server   # run the engine server
pnpm typecheck
pnpm test
```

## License

MIT
