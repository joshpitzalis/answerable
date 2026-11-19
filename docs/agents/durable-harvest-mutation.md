# Durable Harvest mutation review

The changed-source baseline, fresh replay and behavioral confirmations finished. Timing-dependent outcomes still require their separate confirmation; exit zero alone does not resolve surviving or uncovered mutations.

## Baseline and replay

The completed `pnpm mutate:changed` run exited zero after 220 minutes 27 seconds: 3,197 outcomes comprise 1,540 Killed, 1,077 CompileError, 467 Survived, 91 NoCoverage, 12 Timeout, seven RuntimeError and three Ignored. Unchanged copies are saved as `reports/mutation/baseline-full.json`, `baseline-full.html`, `events-full/` and `reports/stryker-incremental-full.json`.

Tests added while that sandbox ran do not retroactively strengthen its results. The fresh replay selects every Survived/NoCoverage outcome, all twelve timeouts and all 41 test kills whose reason mentions a timeout, because a host suspension makes their timing ambiguous. It also mutates every substantively changed or new source file in full. Source comparisons strip static imports to recognize mechanical value-file relocations; changed bodies force whole-file replay. Unchanged ranges are mapped by unique unchanged source context, with ambiguous mappings also forcing the whole file. The selection audit records source hashes and original IDs in `reports/mutation/replay-selection.json`; no recorded outcome is edited.

The replay uses `force: true`, its own incremental file and separate JSON/HTML/event reports. It mutates source with the current complete test suite, never the generated Worker. Baseline and replay counts must remain separate because selected ranges can contain previously killed mutations as well as the intended unresolved ones.

The fresh replay exited zero after 264 minutes 5 seconds: 1,588 outcomes comprise 979 Killed, 378 CompileError, 168 Survived, 25 NoCoverage and 38 Timeout. Forty of its Killed outcomes report a test timeout and are not treated as assertion detections. All 193 Survived/NoCoverage entries have individual dispositions in `reports/mutation/replay-ledger.json`, with source spans, replacements and hashes. The unchanged raw report is `reports/mutation/replay.json`.

Forty behavioral gaps received regression assertions and a fresh confirmation at test checkpoint `23543c9`. All forty were killed by assertions, with exact original-to-confirmation matches in `behavior-confirmation-matches.json`. That run exited zero after 12 minutes 45 seconds: its 110 nearby mutants yielded 89 Killed, 17 CompileError and four Survived. The four survivors map to existing scoped equivalences (#840, #846, #1013 and #1285), recorded in `behavior-confirmation-remaining.json`. Vitest's inherited include arrays made this a full 500-test baseline, despite the intended narrower include list.

The remaining timing confirmation selects all 38 Timeout and all 40 test-timeout Killed outcomes, preserving their original statuses. It uses the full suite, a ninety-second per-test limit and Stryker's sixty-second allowance plus three times baseline duration. Its selection, source checks and report hashes remain separate; no recorded outcome is edited.

## Build-only configuration

`worker.config.ts` is evaluated by the build/test configuration before Stryker's per-test instrumentation runs. Its uncovered mutants require the actual Alchemy build gate, not a test that restates the configuration object. Each mutation below was applied temporarily, exercised with `node scripts/prove-worker-build.mjs`, then restored. No mutated configuration is committed.

| Mutation | Observed result |
| --- | --- |
| Whole configuration replaced with `{}` | Exit 1: generated Worker lacks the `ProjectHarvest` export |
| `main` replaced with empty string | Exit 1: Alchemy/Vite cannot resolve the Worker entry |
| `compatibilityDate` replaced with empty string | Exit 1: Workers runtime configuration refuses the missing compatibility contract |
| `compatibilityFlags` replaced with `[]` | Exit 0, eight native build tests pass; equivalent at the pinned date, as explained below |
| `nodejs_compat` replaced with empty string | Exit 1: workerd rejects the unknown empty compatibility flag |

The Workers test configuration now reads date/flags from the same `workerBuild` declaration as Alchemy, so generated-entry tests cannot silently retain flags removed from deployment configuration.

## Browser-only routes

The existing browser journeys detect the two route mutations that the Vitest projects cannot execute. Each was applied temporarily and restored; the route has no lasting diff. `E2E_PORT=1341 pnpm e2e --grep 'each Project has a tab'` exits 1 with the `ProjectPage` body removed, because the Project link never appears. `E2E_PORT=1341 pnpm e2e --grep 'an unknown Project slug'` exits 1 with `notFoundComponent: undefined`, because the required Project-not-found message disappears. Failure artifacts remain under `reports/mutation/manual-route-page/` and `reports/mutation/manual-route-not-found/`. These are manual browser detections, separate from Stryker's test-kill count.

## Local configuration selection

Local registry selection also needs a build-time input absent from fixture runs. In this worktree the gitignored `projects.config.ts` did not exist. A temporary configuration containing only invented IDs (`manual-local-selection`, `invented-server`, `invented-channel`) and a temporary import-contract test established that `PROJECTS`/`findProject` select it while `STUB_PROJECTS` stays `effect`/`xstate`. The focused Vitest command passed (exit 0), failed (exit 1) when `local["./projects.config.ts"]` became `local[""]`, then passed again after restoration. Both temporary files were removed. This manually detects #307; it is not equivalent and does not require the owner's real configuration.

A second invented local configuration used two Projects with the same `manual-duplicate-id` and different slugs. A dynamic-import test requiring configuration rejection passed (exit 0), failed (exit 1) with `assertProjectIds(PROJECTS)` removed, and passed after restoration. This manually detects #308 before application import succeeds. The temporary configuration and test were removed afterward.

For #309, a valid invented local registry was paired temporarily with an empty fixture Project ID. The import-rejection test passed, failed when `assertProjectIds(STUB_PROJECTS)` was removed, and passed after restoration (exits 0/1/0). The example fixture was then restored exactly and the temporary local configuration/test removed. This proves the fixture validation remains independent of the local registry.

## Equivalent mutations

- The fixture active-discovery `message.thread !== undefined` check can be always true for the committed fixture: every message has a thread. The requested-Project filter remains necessary and has a separate exact-output test. This is scoped to the current fixture data.
- Removing the fixture thread-title `slice(0, 100)` does not change any current fixture title: all fifteen messages have at most 96 characters. Optional thread property access can also be direct because all fifteen entries have a thread. Neither equivalence extends to different fixture data.
- The pagination completion predicate's `oldest !== undefined` check can be always true with a positive page limit: empty pages already complete through the preceding short-page condition, and nonempty pages have an oldest ID. The comparison against the lower boundary remains required.
- The `Effect.fn` operation label is diagnostic metadata; replacing it with an empty string does not change request, failure or retry behavior.
- Storage operation labels populate `ProjectStorageError.operation`, which no production caller reads. The storage error's string tag likewise has no `catchTag`/tag-branch consumer; callers retain the same failing Effect and error class. These are scoped diagnostic equivalences, not permission to discard user-visible failure reasons.
- Clearing the questions machine's reason on `loaded` → `refreshing` is redundant: every entry into loaded goes through `received`, which already clears it. Retaining the old reason during `failed` → `refreshing` is also observationally equivalent for the current view: it displays that reason only while failed, and the next success clears it or the next failure replaces it. This does not claim identical arbitrary context introspection.
- Overwrite-kind checks that become always true while retaining the exact role/member ID predicate are equivalent for supported Discord overwrites: [overwrite types are 0 for roles and 1 for members](https://github.com/discord/discord-api-docs/blob/main/developers/resources/channel.mdx#overwrite-object), and [snowflake identity is globally unique](https://github.com/discord/discord-api-docs/blob/main/developers/reference.mdx#snowflakes), with documented parent/child sharing such as the guild's everyone role. A user/member ID cannot select another role's overwrite. This does not waive membership, identity, mask or precedence mutations, and makes no claim about unsupported overwrite kinds or corrupt colliding identities.
- Rejecting announcement-thread type 10 is equivalent within the supported source kinds. [Discord defines type 10 under announcement parent type 5](https://github.com/discord/discord-api-docs/blob/main/developers/resources/channel.mdx#channel-types), which `requireMessageAccess` already refuses; supported parent types are 0, 15 and 16. Public-thread type 11 and private-thread refusal remain tested. This is not a claim of announcement-Channel support.

- Empty compatibility flags preserve Node support at the pinned `2026-11-16` date. Installed `@cloudflare/vitest-plugin/dist/pool/index.mjs` defines `NODEJS_COMPAT_DEFAULT_ON_DATE = "2026-08-04"`; `resolveNodejsCompat` enables it by default on/after that date unless explicitly disabled. The pinned Alchemy `Workers/Worker.ts` compatibility documentation records the same default. The manual built-Worker tests above confirm the application behaves the same.
- `listQuestions` server-function options `{ method: "GET" }` replaced with `{}`: the installed TanStack `start-client-core/src/createServerFn.ts` assigns `GET` when the method is undefined. The same saved-read handler and request method result. This does not waive mutations to the handler itself or POST activation/Refresh methods.
- Corpus service key `app/Corpus` replaced with an empty string: provision and consumption use the same Context tag, and no other application service has an empty key. Only the diagnostic identifier changes; the required Corpus behavior is unchanged. This reasoning does not apply if another empty service key is introduced.
- `advanceMessagePage`'s late `oldest === undefined` branch is unreachable for the supported positive page limit: an empty page already completes through `messages.length < limit`. Both production callers pass 50. A synthetic zero limit would not exercise the supported contract.
- The reconciliation invalid-stored-ID error's text can be empty without changing its rejection. No caller interprets that diagnostic text.
- `processingPolicy`'s default evidence revision and owner name are unused by its production caller, which supplies the Corpus revision and trusted Project owner explicitly. Changing those defaults does not change production processing policy.
- `ProjectQuestions` memo dependency list can be empty under its sole route caller: the component is keyed by Project slug and the imported server callbacks stay stable for that mount. This equivalence is scoped to the current caller.
- `clearRetry`'s stale-generation early return is redundant under current callers. Text/forum/thread/reconciliation commits check the same generation in their enclosing synchronous transaction; processing's UPDATE checks generation before it can reach `clearRetry`. No async boundary permits a generation change between those checks. The stale-result/failure tests exercise the actual public paths.
- The questions machine's `schemas` declaration contains XState type metadata, not runtime validators. Installed XState's `types()` produces pass-through validation; deleting that declaration does not change machine behavior.
- `recordRetry`'s optional-generation check can be always true under current production callers: acquisition always supplies its claimed generation, and processing candidates always receive `harvest_cycle.generation` from `pendingCandidates`. The following generation equality check still rejects stale work. This does not waive mutations to that equality check.
- Discord starter/refusal error text can change without changing the typed failure or retry behavior; callers do not interpret the literal wording. Fixture Corpus prose is sample data, not a required title/body string; evidence revisions and Judge behavior are tested separately rather than pinning arbitrary prose.
- The fixture URL path's `split("/").at(-2)` fallback cannot be reached for the supported absolute Discord URLs, whose pathname begins with `/`. Replacing that fallback does not change a fixture response.
- The schedule identity mismatch throw is redundant on current production paths. `ScheduledHarvest.activate/request` reconcile the Project ID/mode first and stop on mismatch; the native object additionally checks its fixed mode/name. The sole production `requestScheduled` caller cannot change those identities. This reasoning does not remove the internal defensive guard.
- The legacy storage `fail` wrapper has no production or test caller; durable acquisition/processing failures use `retry` instead. Mutations confined to that unused wrapper do not change the assembled Harvest.
- The schedule's nonfinite-due fallback is unreachable with the trusted finite clock and current writers: current status supplies finite cadence; incomplete acquisition, processing or reconciliation supplies queued work; failures supply persisted retries. Suspended/mismatched configuration returns earlier, and initial storage has no failure. Retain the fallback for malformed or legacy state; this equivalence claim does not extend to those unsupported inputs.
- Always attempting the text-thread association UPDATE for a forum does not change valid stored data: its predicate requires the message to be in the parent Channel, while a forum starter is stored in the distinct thread Channel. The actual text-thread association remains required and tested.
- `finishDiscovery` always has its parent scan on assembled paths: active discovery writes it atomically before finishing, archives require it, and starter/message work follows discovered threads. Reconciliation operates on retained threads; no writer deletes scans. The numbered migration introducing threads also introduced scans, and later migrations preserve both. Removing optional access there is equivalent for valid retained state, not for an artificially orphaned thread.
- Reconciliation's `messages: [observed]` argument to `ingestMessage` can be empty because that single-message writer reads only `observedAt` and `policyRevision` from the page object; the observed message is passed separately. This does not apply to `ingestPage`, which iterates the page's messages.
- The same unused page-message argument applies to the single forum-starter writer. The legacy Discord comparison's unequal-length branch can use `>=` instead of `>` because equal lengths have already selected the other ternary branch.
- Removing `actor.stop()` after the awaited terminal `toPromise` in the native wake proof is equivalent for this non-cancellable function: installed XState's `createActor` implementation calls `_stopProcedure` on both `_terminate({status: 'done'})` and `_error`, before completing/rejecting observers. The explicit finally remains as defensive lifecycle cleanup.
- Always applying the text-page upper-bound filter is equivalent when no upper boundary exists: its null fallback compares each message ID to itself and keeps every message. Bypassing the filter for a captured range is not equivalent.
- The processing outcome `rejected` is only the non-kept remainder in the numeric funnel; no consumer matches that literal. Replacing it with another non-special string leaves the counts unchanged. Stale/negative outcomes still must not report `kept`, and fixture owner replies must still report `answered`.
- The thread completion check's generation equality can be always true while retaining `before === null`: every non-null result from `advanceMessagePage` with no continuation carries the supplied generation. The continuation check itself remains necessary when a completed thread reopens within the same generation.
- Thread comment requests follow a completed starter obligation. Every writer clearing `starter_pending` first persists or finds the starter; failed reads retain the obligation, and deletion retains the message row. The comment writer's starter-existence lookup is therefore redundant on assembled paths. Migration five initializes the flag pending and later migrations preserve it. Likewise, every supported scan writer sets `active_done=1`; that table starts empty in migration five.
- Initial reconciliation enqueue is repeated before any acquisition by `startScheduledBatch`, using retained activation time. Removing the first call changes no exposed saved result or eventual obligation, including delayed first wakes. A retry-cycle deadline cannot be in the future when the assembled scheduler starts work: its due check runs first, manual requests preserve the lower bound, and configuration changes clear the retry deadline.
- `discordGet` attaches a parsed error code only for actual HTTP 404 responses. Therefore the reconciliation handler's remaining code-10008 check implies the status check on every supported failure path.
- The committed fixture generates at most one reply per thread, so truncating it to a positive page limit is redundant. Its reply prose is sample data; owner-answer behavior uses the retained author identity. Neither observation applies to arbitrary production messages or a future multi-reply fixture.

## Current-run triage

Baseline IDs below describe the original gaps; source changes renumbered the fresh replay. The exact per-mutant ledger and confirmation matches above are authoritative. The forty fresh behavioral gaps are confirmed; timing-only results remain separate.

| Mutants or seam | Response |
| --- | --- |
| Project client mode literals/object name | `projectHarvestClient.workers.test.ts`: native stable fixture/live namespace and sibling isolation |
| Runtime #55 active registry | Same test: token-free registry is the committed fixture registry |
| Native #3/#6/#13/#14 suspension | `projectHarvestConfig.workers.test.ts`: disabled native Harvest retains rows, reports suspended and clears alarm |
| Registry #46/#47/#48 mode branch | Explicit trusted registry argument and distinct invented registries in `projectHarvestConfig.test.ts` |
| Worker #56–#60 | Manual generated-build outcomes above |
| Feature #254 GET options | Equivalent default GET, explained above |
| Feature #262 POST options | `index.test.ts`: public server-function method is POST for activation/Refresh, GET for reads |
| Corpus #320 service key | Equivalent shared Context tag, explained above |
| Thread schema #1031/#1032 anchors | `sourcePage.test.ts`: rejects leading/trailing junk, zero and leading zero; accepts complete nonzero decimal IDs |
| Retry #2313 stale generation | `scheduledGeneration.workers.test.ts`: old acquisition/Judge failure creates no retry, global pause or fetch failure in the new generation |
| UI #2624 timestamp options | `QuestionsView.test.tsx`: distinct last-success/attempt values include time of day |
| UI #2629/#2634/#2635 busy, #2636/#2639/#2644 states | `HarvestStatus.test.tsx`: observable labels and Refresh gating, including busy current/partial states |
| Boundary #67/#69 | `harvest.values.test.ts`: known Discord epoch and one/two-millisecond snowflake vectors, per [Discord's wire format](https://docs.discord.com/developers/reference#snowflakes) |
| Configuration #1180/#1182/#1183/#1185 | `harvestConfiguration.workers.test.ts`: old owner metadata cannot claim current work; trusted metadata can, suspension refuses it |
| UI #2820/#2821 partial Refresh | `storedQuestionsMachine.test.ts`: refreshes partial state, retains rows while pending, then displays current state |
| UI #2705 Project title | `ProjectQuestions.test.tsx`: Project heading and slug reach the view/read operation |
| Baseline #264/#274/#289/#291/#296/#305/#306 | RuntimeError during application import: empty/forced-invalid IDs, forced duplicate refusal, or broken optional local-registry selection. These are detected startup failures, reported separately from test kills. |
| Corpus #330/#331 digest encoding | `corpus.test.ts`: fixed SHA-256 vector for empty JSON evidence, including zero-prefixed bytes; independently checked with Python hashlib |
| Access #723–#727 Channel type guard | `messagePage.test.ts`: allowed text/forum/media types and refused direct/voice/private-thread types before content fetch |
| Content #1359/#1361 page stream identity | `pageAtomicity.workers.test.ts`: a mixed valid/wrong-stream page rolls back all content and its cursor |
| UI #2726 first-read failure | `QuestionsView.test.tsx`: initial failure offers Retry without fabricated saved freshness, then recovers |
| Message #672 avatar URL | `messagePage.test.ts`: an invented non-null avatar maps to its usable Discord CDN URL |
| Starter #813 and reconciliation #869 | `readStarter.test.ts` and `reconciliation.test.ts`: wrong message/stream/parent/private-thread identities reject foreign content |
| Reconciliation #837 | `reconciliation.test.ts`: forum/media root recent reads stop after four metadata calls, without a messages endpoint |
| UI #2841/#2842 | `storedQuestionsMachine.test.ts`: a failed partial Refresh can be refreshed again |
| Fixture #480–#483/#487/#488 | `fixtureFetch.test.ts`: known reply identity and missing-message HTTP 404/code 10008 |
| Route #3280/#3289 | Existing navigation/not-found browser journeys fail under each temporary mutation; manual receipts above |
| Thread writers #2511/#2512/#2517/#2530/#2541; forum #1557/#1558/#1542 | `threadWriter.workers.test.ts`: stale generations, atomic foreign-stream rollback, nonprogress, captured upper boundary and exhausted forum obligations |
| Reconciliation storage #2141/#2152 | `reconciliationIdentity.workers.test.ts`: mixed identity responses roll back; system starter cannot replace original parent text |
| Schedule #2385 | `harvestConfiguration.workers.test.ts`: paused manual request cannot change lastManual or restore scheduled work |
| Fixture #516–#525/#543–#545 and reconcile #887 | Strict fixture windows and known-message foreign identity cases in `fixtureFetch.test.ts`/`reconciliation.test.ts` |
| Wake #2579/#2583 | `wakeSuspension.workers.test.ts`: paused requests cannot arm; suspension during a held native alarm write removes both actual alarm and saved next alarm |
| Reconciliation #2193/#2218/#2227 | `reconciliationIdentity.workers.test.ts`: mismatched deletion, metadata and message work retain content and obligations |
| Forum #1624 | `threadWriter.workers.test.ts`: archive discovery without an active range fails without saving threads or scan state |
| Retry #2352/#2354 | `scheduledRetryCommit.workers.test.ts`: sibling processing retry retains failure; final successful processing clears failure/pending and restores current status |
| Source #930 | `sourcePage.test.ts`: a foreign thread parent is refused after metadata checks, before content is read |
| Archive #191 | `thread.rules.test.ts`: below-floor exhaustion despite hasMore, with equal-floor overlap preserved |
| Forum #1458–#1461/#1657/#1669 | `forumWriter.workers.test.ts`: public metadata roundtrip, stale starter preservation and foreign starter rollback |
| Discord #1114 reply-check opt-out | Discord service test: the live opt-out returns false without fetching reply content |
| Example #277 empty server identity | `durableHarvestJourney.workers.test.ts`: assembled fixture questions have complete Discord message links with nonempty server/channel/message path segments |
| Pagination #144 | `pagination.rules.test.ts`: an entirely older page cannot move a completed boundary backwards; equality mutation #145 is equivalent because both choices are the same ID |
| Reconciliation queue #2248/#2250 | `reconciliationQueue.workers.test.ts`: exact daily deadline enqueues, while unfinished obligations prevent another daily batch/deadline advance |
| UI #2660/#2789 | Refresh failure shows Update unavailable; failed first activation retains the saved new-state context |
| Configuration #1205 | Identity refusal covers changing Project ID alone and server ID alone, retaining alarm quiescence |
| Forum association #1474 | Text-thread reconciliation test asserts discovery attaches the retained parent message's threadId |
| Acquisition #2888 | `threadRetry.workers.test.ts`: a non-advancing thread page preserves content/cursor and records partial status plus a persisted retry |
| Archive #216 and rate limit #584 | Pure archive middle-page continuation; header-only global rate limits preserve scope and retry delay in `listMessages.test.ts` |
| Content #1312 | `contentRevival.workers.test.ts`: identical re-observation after deletion counts as an update, advances source revision and requeues processing |
| Fixture #372/#374 | Active discovery fixture test returns only the requested Project's known threads with their parent identities |
| Reconciliation #2269 | Queue deadline test finishes regular acquisition/processing but keeps status working while reconciliation alone remains |
| Forum #1488/#1489/#1490 | `forumWriter.workers.test.ts`: parent progress stays incomplete until both archive discovery and thread content finish, in either order |
| UI #2684/#2813 | Status tests hide duplicate last-attempt timestamps; lifecycle tests refuse Refresh from suspended and failed-new states |
| Content #1329 | Removing eager deletion exposed the review finding: saved questions must remain until replacement processing commits. The reviewed fix removes this block; replay the changed content writer in full. |
| Thread timestamp #226/#227/#230/#231/#232/#240/#241/#242 | `thread.values.test.ts`: fixed submillisecond comparison vectors, fraction normalization, second rollover and timezone equality |
| Configuration #1247 | Held Judge work cannot commit after an owner-only configuration change |
| Access #685 | Permission-bit strings reject prefixes/suffixes/whitespace through the typed access failure |
| Discord GET #612 | Extra 404 response-body fields cannot override the actual HTTP status or trusted failure reason |
| Content #1333 | Diagnostics assert three newly inserted messages are counted as inserted, not updated |
| Message #627 and UI #2689/#2690 | Message-page schema rejects prefixed/suffixed/zero IDs independently of thread metadata; status table shows continuation time only for waiting with a known deadline |
| Message #638; UI #2694/#2695/#2696; configuration resume guards | HTTP request preserves explicit limit and continuation; partial warning appears only for partial status; saved reads resume previously activated objects but cannot activate a new object after suspension |
| Access #709/#710/#711 | Foreign Channel ID and guild ID are independently refused after metadata, before reading message content |
| Configuration #1241/#1273 | A real schema-8→9 upgrade preserves retained work: absent configuration suspends alarms without deleting unknown-source obligations; known configuration retains the already scheduled future wake instead of starting work early |
| Access #734/#736 and UI #2731/#2732 | Unassigned guild roles cannot grant permission; an assigned role can. Loading text appears before the first saved read and disappears when it settles. |
| Access overwrite guards #747/#749/#750 and related masks | Fixed permission vectors prove everyone → assigned role union → own member precedence, excluding unassigned roles and other members |
| Starter #795 and reconciliation #830 | Forum starters use the thread stream, text-thread starters use the parent stream; recent text/thread reads collect content instead of applying the forum-root short circuit |
| Fixture #451 | A direct metadata read retains the known active thread's parent, type and archived=false state |
| Cycle #1388/#1401/#1402 | Three-Channel claims skip a deferred sibling without reversing rotation; regular acquisition and reconciliation each receive a turn while both remain pending |
| Cycle #1435 and fixture #478/#479 | Stale/suspended metadata cannot claim pending processing; a known fixture starter is available only from its original Channel |
| Cycle #1445/#1447 and fixture #495 | Processing claims skip empty/deferred Channels and stop when none is eligible; fixture pages honor an explicit small limit and the default window |
| Cycle #1437 and related acquisition loop bound | Removing every configured Channel leaves both public claim methods empty, without indexing a nonexistent Channel |
| Thread writer #2539/#2552/#2556 | Captured-range test includes the exact upper boundary, asserts committed ingestion counts, and retains the completed generation |
| Reconciliation #2155/#2158/#2159/#2163/#2165 | `reconciliationMetadata.workers.test.ts`: preserved starter/reply association, post kind, and exact inserted/updated/unchanged counts |
| Thread writer #2559/#2562 | `threadContinuation.workers.test.ts`: a same-generation archived tail stays pending across a full page and finishes only after continuation |
| Schedule #2439 | `scheduledSiblingRetry.workers.test.ts`: one exhausted Channel cannot delay a ready sibling until the retry-budget reset |
| Forum #1592 | `forumBoundary.workers.test.ts`: subsequent discovery includes the exact activation snowflake and excludes the older neighbor |
| Source #956/#957 | Archive fetch contract preserves its 100-thread limit and persisted timestamp continuation |
| Schedule #2477 | `configurationSources.workers.test.ts`: starting a batch creates newly configured Channel progress, preserves existing progress and updates the attempt timestamp |
| Reconciliation #2221 | Valid thread metadata reconciliation updates title/archive metadata and reopens the final message tail through the public request API |
| Forum #1634/#1637 | Archive admission includes exact activation-floor/captured-upper timestamps and excludes each microsecond outside that range |
| Wake resume guards | Native alarm observation rejects transient writes for disabled/removed/mismatched configuration; a real SQLite resume interruption still leaves the pre-commit recovery alarm |
| Source #1015 | Public text-thread discovery returns non-forum/non-post metadata, independently of the forum discovery contract |
| Forum #1672 | Metadata proof also asserts the initial forum starter's exact committed ingestion count |
| Forum #1678 | Processing a starter followed by an empty first comment page does not requeue unchanged context |
| Progress #1966 | Removing an unfinished Channel permits remaining completed sources to become current while preserving the removed source's raw progress |
| Progress #1992/#1994/#1995 | Saved failure reports deduplicate identical Channel/reason pairs without merging sibling Channels or distinct reasons |
| Progress #2010 | Real scheduled acquisition keeps freshness working after one Channel finishes discovery while its seeded sibling still has an archive scan pending |
| Progress #2008/#2013/#2016/#2018/#2022 and related progress guards | Real schema-three upgrades preserve unseeded, incomplete-continuation, missing-source and fully completed freshness when the later cycle table initializes inactive |
| Progress #2066 | The same mixed-discovery journey reports waiting before its persisted continuation deadline, then working once eligible |
| Progress #2080 and processing #3094 | Saved read metadata and actual processing both preserve each row's source Channel when configured Channels are reordered/renamed |
| Acquisition #2854 | Reconciliation cannot advance the pending-thread selection cursor without performing that thread's work; subsequent ordinary collection preserves rotation |
| Processing #3124/#3126/#3128 | The owner-answered fixture reports unanswered=0; stale processing that cannot commit never reports a kept result |
| Stored failure-reason literals | Acquisition, rate-limit and Judge failures expose a nonempty safe explanation in saved failure rows, without leaking the original secret-bearing error |
| Acquisition #2905/#2907/#2908/#2910/#2912 | The actual text acquisition workflow filters above-upper arrivals while retaining the exact captured boundary and completing that saved range |
| Fresh replay #1440/#1441 | `textBoundary.workers.test.ts` adds the separate non-progressing text-page workflow path: retained content/cursor, nonempty saved failure and exact failed=1 diagnostic. Confirmed by fresh mutation replay. |
| Fresh replay #247 | Unsupported Channel tests now invoke `requireMessageAccess` directly and require refusal after two metadata reads. Calling `sourcePage` had allowed a later malformed forum response to mask removal of the access guard. Confirmed by fresh mutation replay. |
| Fresh replay #563/#566/#568 | Existing suspension/resume cases now require the immediate resumed alarm deadline. Merely checking for any alarm allowed the pre-commit recovery wake to mask missing durable schedule restoration. Confirmed by fresh mutation replay. |
| Fresh replay #228 timeout | A direct message-page test now refuses two individually valid messages when the requested limit is one. The timeout is not credited as a kill; confirmation with a larger allowance remains pending. |
| Fresh replay #657 | Public storage activation without `beginCycle` cannot claim acquisition; starting the cycle makes the source claimable. The proof uses API-produced state and a positive control. Confirmed by fresh mutation replay. |
| Fresh replay #1309 | The existing component Refresh journey holds its reply and checks Refreshing plus a disabled control before releasing the new rows. This verifies `QuestionsView` busy-state wiring separately from the status component's prop tests. Confirmed by fresh mutation replay. |
| Fresh replay #350/#351/#352 | The existing injected-fetch metadata test covers text, forum and media parents and requires the corresponding non-post/post/post classification. Confirmed by fresh mutation replay. |
| Fresh replay #376 | An archive response missing `has_more` is refused, rather than silently declaring the archive exhausted. Confirmed by fresh mutation replay. |
| Fresh replay #1083 | The daily queue journey replays consumed work while siblings keep the generation active; the stale response cannot replace retained messages. Confirmed by fresh mutation replay. |
| Fresh replay #1256 | The existing native alarm observer explicitly requests a wake while paused and requires no transient write, not just a null alarm after cancellation. Confirmed by fresh mutation replay. |
| Fresh replay #770 | Completed forum discovery schedules recent-message reconciliation for the active thread, never the forum root. Confirmed by fresh mutation replay. |
| Fresh replay #1179/#1180/#1182 | Refresh during a real partial continuation preserves its schedule and manual cooldown; subsequent alarms complete that same cycle. Confirmed by fresh mutation replay. |
| Fresh replay #538 timeout | The stale-metadata claim proof now independently varies owner and Channel configuration. Full-suite mutation confirmation with a larger timeout allowance remains pending. |
| Fresh replay #1276 | An unchanged active saved read must not replace the native alarm with a resume-recovery wake. Confirmed by fresh mutation replay. |
| Fresh replay #1282/#1283/#1287 | Adding a source after completed collection moves the native alarm from regular cadence to immediate work; suspension/resume also requires the exact restored deadline. Confirmed by fresh mutation replay. |
| Fresh replay #833/#898 | Real schema-five upgrades preserve acquisition failures without retry records, as written by `2a23640f` before scheduling existed; successful active discovery and starter collection must clear them. Confirmed by fresh mutation replay. |
| Fresh replay #838 | A configuration change advances the cycle; archive work cannot use the previous generation's retained active range. Confirmed by fresh mutation replay. |
| Fresh replay #1015/#1016/#1033 | A schema-eight snapshot may retain a removed source's older generation. Reading completed retained work must not invent an active cycle; a retained failure remains partial when a manual retry is queued within cooldown. Confirmed by fresh mutation replay. |
| Fresh replay #1396/#1407/#1423 | Actual reconciliation, archive, starter and comment acquisition journeys require successful funnel lines with `failed=0`. Confirmed by fresh mutation replay. |
| Fresh replay #1575 | The existing crash-before-activation proof now requires its recovery alarm thirty seconds in the future; merely checking that an alarm existed missed a past deadline. The after-activation crash still requires its immediate wake. Confirmed by fresh mutation replay. |
| Fresh replay #1608/#1610/#1614/#1615 | The existing held-IO concurrency journey checks that Refresh preserves the recovery wake, a duplicate alarm remains pending with the first runner, and only one acquisition (including discovery) occurs. Confirmed by fresh mutation replay. |
| Fresh replay #1470 | Timing confirmation exposed a processing-log ordinal gap. The existing diagnostic test now processes the second Channel after an empty first Channel and requires `channel=2`, retaining exact counts and privacy checks. Its small follow-up mutation confirmation remains pending. |
| Fresh replay #1496 | With a larger allowance, an empty already-current transition eventually returns through the twenty-second outer deadline. The completed-Harvest test now uses an unadvanced simulated clock, requiring completion independently of that deadline. Its small follow-up confirmation remains pending. |

## Interrupted run

The first instrumented baseline passed 300 tests. An overnight host pause inflated elapsed time and made 80 timeout outcomes unreliable. Terminal interruption through nested package-manager processes ended the run before its asynchronous incremental checkpoint flushed, so none of that partial run is counted as final evidence. The replacement run includes the built-in event recorder, which persists every result under `reports/mutation/events/`, as well as incremental JSON and final JSON/HTML reports.

The replacement run was checkpointed successfully at 493 results using SIGINT on the exact Stryker PID. Stryker confirmed writing `reports/stryker-incremental.json`; unchanged copies remain in `reports/stryker-incremental-checkpoint-493.json` and `reports/mutation/events-checkpoint-493/`. No outcomes were edited. The next run uses incremental reuse with the additional tests and concurrency one, because two processes caused substantial memory swapping on this machine.
