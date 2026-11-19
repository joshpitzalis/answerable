# Project storage integration proof

Ticket #16 establishes the infrastructure gate for #14. It does not yet move page reads or Discord collection onto durable storage.

This is the historical first gate. The assembled implementation and current verification procedure are documented in [durable Harvest verification](durable-harvest-verification.md).

## Local evidence

On 2026-11-16, with invented data and no Discord token:

- `pnpm test`: 184 existing unit/component tests, three Workers-runtime tests and five script tests passed.
- `pnpm e2e`: all nine existing fixture journeys passed through Alchemy with the custom Worker entry.
- `node scripts/prove-worker-build.mjs`: the pinned Alchemy provider built the production client and Worker. Assertions found both `ProjectHarvest` and the Start default export and no Worker/Effect runtime markers in client JavaScript. The same three Workers tests then passed against the generated `dist/server/index.js` entry, proving named SQLite calls and alarms through the actual built Worker.
- `pnpm check` and `pnpm types` passed.

The Workers suite calls the actual native class with a named SQLite binding. It saves a question, evicts the instance with `evictDurableObject`, verifies a different instance and the retained row, delivers an alarm, then evicts again and reads its persisted effect. Other tests prove Project/mode isolation, repeat initialization, upgrade preservation, failed SQL migration rollback and future-version refusal. The test configuration is local and does not replace Alchemy's infrastructure declaration.

## Stable contracts

`ProjectHarvest` is the exported class and the logical namespace name; `PROJECT_HARVEST` is its binding. Preserve these after deployment. Alchemy scopes the hosting Worker/namespace by stack and stage. Object names are `<live|fixture>:<stable Project ID>`; labels and route slugs are not storage identity. SQL table migrations are transactional and numbered separately from Cloudflare namespace migrations.

`src/app/worker.config.ts` supplies the entry and compatibility settings to Alchemy and the local build proof. `src/app/worker.ts` retains TanStack's default handler. The object constructs its own Effect runtime, enters feature workflows, and its alarm uses the existing XState/Effect bridge. Initialization blocks only migrations. No synthetic HTTP route is exposed; the proof uses internal RPC.

The initial questions table stores the existing read model. Ticket #17 extends storage with transaction-owned raw content, progress and processing; the current page still uses its established in-memory path until the UI cutover. No existing Map data is represented as migrated.

## Limits

This proves local SQLite reconstruction and local alarm delivery, not deployed retention or alarm behavior. A non-production deployment rehearsal still requires explicit authorization. No deployment or real Discord collection ran.

The build reports an existing large-client-chunk warning and a CSS sourcemap warning. The installed dependency graph reports an `unenv` peer mismatch (`2.0.0-rc.25` installed; `@cloudflare/unenv-preset@2.16.2` requests `2.0.0-rc.24`); the local build, Workers suite and fixture journeys pass despite it. Do not upgrade the stack as part of this proof.
