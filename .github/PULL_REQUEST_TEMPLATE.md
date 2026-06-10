## What & why

<!-- Summary of the change and its motivation. Link related issues. -->

## How I verified it

<!-- No automated tests in this repo (project policy) — describe the manual verification you did.
     For engine changes, the usual check is the headless demo:
     pnpm --filter @greenlight/server exec node src/bin.ts demo ../../examples/todomvc/todo.feature --url https://demo.playwright.dev/todomvc -->

## Checklist

- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` and `pnpm fmt:check` pass
- [ ] Protocol changes (if any) made in `packages/contracts` with both sides updated
