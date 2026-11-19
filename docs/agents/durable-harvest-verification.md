# Durable Harvest coverage and verification

## What freshness means

First activation seeds the latest 50 top-level messages per text Channel and the latest 50 accessible active forum posts. It records partial history, including an empty-stream boundary; it does not backfill an archive. Later cycles walk every accessible new message after the completed boundary in resumable pages, with a captured upper boundary so arrivals during traversal belong to the next cycle.

Active public threads and public threads archived since activation are discovered separately. Tracked threads retain independent message cursors, collect a final tail when archived and resume when active again. Daily reconciliation checks the latest 50 text/active-thread messages plus displayed starters and thread metadata. Only a specific unknown-message response after verified stream access confirms deletion. Missing pages, inaccessible Channels and permission failures retain content. Older edits outside this coverage and messages deleted before observation may never be discovered.

The next regular cycle starts fifteen minutes after the preceding cycle completes. Manual Refresh has a sixty-second Project cooldown, joins a running cycle and cannot bypass a longer rate-limit deadline. Reconciliation shares the same bounded runner; a large backlog keeps freshness incomplete. Saved questions remain visible throughout work, and partial failures retain the last complete-success timestamp. Pending/failed processing prevents an up-to-date claim even when acquisition has finished.

## Local evidence seams

`pnpm test` runs unit/component tests, real Workers SQLite/alarm tests and script tests without Cloudflare credentials. The fixture browser suite runs separately with `pnpm e2e`. Fake Discord and Judge enter through existing Effect contracts or injected fetch; no module mocking or real Discord collection is needed.

| Contract | Evidence |
| --- | --- |
| Native binding, version-one upgrade through schema nine, retained rows, actual instance eviction and alarm delivery | `projectHarvest.workers.test.ts`, `scheduledHarvest.workers.test.ts` |
| Complete fixture journey, comments, refresh failure, reconstruction and Project isolation | `durableHarvestJourney.workers.test.ts` |
| Transaction rollback, processing retry without reacquisition, duplicates | `harvestRecovery.workers.test.ts`, `processingCommit.workers.test.ts` |
| Uncapped pagination, arrivals, fair rotation and elapsed deadline | `harvestPagination.workers.test.ts`, `harvestFairness.workers.test.ts`, `harvestDeadline.workers.test.ts` |
| Forum/archive overlap, starters, tracked comments and context revisions | `forumArchives.workers.test.ts`, `forumAtomicity.workers.test.ts`, `threadHarvest.workers.test.ts`, `threadContext.workers.test.ts` |
| Crash windows, concurrent requests, persisted retry budgets and global pauses | `scheduledRecovery.workers.test.ts`, `scheduledGeneration.workers.test.ts`, `scheduledPause.workers.test.ts` |
| Edits, confirmed deletion, access failure and daily fixture compatibility | `reconciliation.workers.test.ts`, Discord reconciliation handler tests |
| Trusted configuration, removed sources, suspension and retained progress | Configuration Workers tests and `harvest-operations.md` |
| Saved read, Refresh/filter retention, navigation and responsive layout | `e2e/questions.spec.ts` and saved-question machine/component tests |

All Workers test paths above live in `src/app/__tests__`. Keep lower-level behavioral proofs when extending the assembled journey; browser tests should not duplicate every failure case.

## Build and mutation gates

`node scripts/prove-worker-build.mjs` uses the pinned Alchemy build provider, asserts the generated Worker exports the native class and TanStack default handler, scans client JavaScript for Worker/Effect leakage, then runs the native storage, scheduled Harvest and assembled fixture journey tests against that generated entry. The complete source-level suite remains under `pnpm test`. A bare Vite build or Alchemy plan is not this proof.

`pnpm mutate:changed` selects changed source since the merge-base with `origin/main`. Its dedicated Vitest project includes both unit and Workers tests, with distinct project names and no Node alias in the Workers runtime. Related-test filtering is disabled because native RPC dependencies are not visible in Vite's static import graph. Per-test mutation coverage remains enabled. Stryker concurrency is one; it still starts a checker and a test runner, and each Vitest project runs one worker with an instrumentation allowance of thirty seconds per test. Vite's literal-only `import.meta.glob` macro is narrowly excluded from runtime instrumentation; surrounding configuration selection and validation remain mutated.

Incremental results and JSON/HTML reports remain under ignored `reports/` for survivor review. The event recorder also persists each mutant result while the run is in progress. Preserve these before restarting: terminal interruption through nested package-manager processes can prevent the incremental reporter's asynchronous exit handler from flushing. Run mutations against source, never a prebuilt `PROJECT_WORKER_ENTRY` override.

## Diagnostics

Ingestion emits numeric inserted/updated/unchanged counts only after the storage transaction succeeds, for text pages, forum starters, tracked-thread messages and reconciliation. Every completed acquisition attempt emits its Channel's configured ordinal, failure count and pending-processing count, including empty/unchanged results and persisted external failures with no processing work. Each processing batch emits its Channel's configured ordinal, evaluated/question/unanswered/kept/failed counts and remaining pending count. The ordinal lets the owner correlate configuration locally without putting IDs, slugs, labels or Channel names in logs. These are batch counts, not a claim of historical completeness. Retries report only their kind, persisted attempt count and delay in milliseconds. No message content, token, owner name, URL or raw Discord error enters these lines.

## Deployment status

The local checkpoint `885636bd` passed `pnpm fix` (no changes), `pnpm check`, `pnpm types`, `pnpm test` (336 unit/component, 151 Workers and six script tests), the Alchemy built-Worker proof (eight native tests plus export/client separation assertions), and `pnpm e2e --workers=1` (eleven Chromium journeys). Each command exited zero on 2026-11-19. The mutation baseline completed, but its fresh replay and individual survivor accounting remain pending in [the mutation review](durable-harvest-mutation.md).

Local test/build results do not prove deployed alarm delivery, retention or rollback. No non-production deployment rehearsal is authorized or claimed. Before release, obtain authorization for a separate stage, rehearse activation, restart/alarm recovery and the [quiesce/rollback/re-enable procedure](harvest-operations.md), and record that deployed evidence separately. Do not close the parent issue merely because local checks pass.
