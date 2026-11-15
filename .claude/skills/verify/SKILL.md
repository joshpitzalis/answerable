---
name: verify
description: Verify the repo with one command - lint, types, unit tests and e2e. Use before every git push, and when asked to verify that the code works.
---

# Verify

1. Run `pnpm verify` from the repo root. It runs these in order and stops at the first failure:
   - `pnpm check`: oxlint and oxfmt
   - `pnpm types`: `tsc --noEmit`
   - `pnpm test`: Vitest
   - `pnpm e2e`: Playwright against `alchemy dev` on fixture data
2. On a failure, fix the cause and rerun `pnpm verify` from the start. `pnpm fix` repairs formatting and autofixable lint; review its diff, because autofixes can change behaviour.
3. Push only after one uninterrupted run exits 0. Report each stage's result. A stage that could not run counts as a failure and is reported as one.

`pnpm e2e` starts `alchemy dev`, which uses the user's Cloudflare account. If that command is denied or cannot authenticate, stop and ask the user to run `pnpm verify` themselves; a partial run does not clear a push.
