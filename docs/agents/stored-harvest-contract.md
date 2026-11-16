# Stored first Harvest

Issues #17/#18 add `ProjectHarvest.harvest(project)`, `requestHarvest(project)` and `read(project)`. The UI still uses its existing fixture path until #23. `read` only reads local SQLite. `requestHarvest` requests a new cycle without external IO; requests during an active cycle coalesce. `harvest` runs one bounded batch, initially activating a new Project. Repeating a completed Harvest returns saved data without changing freshness unless the processing policy changed.

## Storage boundaries

- `ProjectStorage.ingestPage` commits source messages, processing obligations and the supplied stream progress together. Call it only after decoding the whole page. A failed transaction leaves the previous progress intact.
- Message IDs are canonical decimal strings, compared by length then value. A relevant source change increments `sourceRevision`; observation or edit timestamps alone do not. An unchanged replay does not requeue completed work.
- `pending(channelIds)` returns the saved message revision and policy revision. `complete(candidate, row)` atomically saves or removes the question and marks processing complete, refusing an obsolete revision. Judge failure leaves the candidate pending so retry needs no Discord download.
- `FetchProgress` holds the completed boundary separately from `upperBoundary` and `before`. Initial coverage is one latest-50 page per Channel. Later cycles capture an upper boundary and walk backward until reaching the completed lower boundary or exhausting history. Each page commits its continuation atomically. Empty initial pages use the request-start snowflake as their boundary, after confirming access and Message Content Intent.
- `read(project)` filters removed Channels and uses current display labels. Contributions derive from retained messages grouped by author ID, excluding bots, webhooks and deleted messages. Project/server identity cannot move.
- Processing policy revisions distinguish the question rule, Judge mode/evidence and reply policy. #20 adds stored owner-reply filtering; the current fixture revision explicitly says `replies-pending`.

## Discord boundary and continuation handoff

`Discord.messagePage` validates message and author identity, timestamps, page size and Channel membership before returning anything. `threadId` is nullable: an ordinary message ID never stands in for a thread ID.

The text adapter makes four sequential metadata calls (application, Channel, guild, bot member), then one message-page call. A batch acquires exactly one such page at most, staying within five actual Discord calls. It checks Message Content Intent and effective View Channel/Read Message History permissions, including overwrites. #19 must count discovery/starter/reply requests against that same bound; a method invocation is not necessarily one wire request. A successful empty response alone is not proof of readable content.

## Bounded work contract (#18)

`harvestStoredProject(runtime, project, mode, clock?)` runs preparation, acquisition and processing inside one XState state with a 20-second timeout. Cancellation reaches Effect and the actual fetch AbortSignal. The optional XState clock permits deterministic deadline tests. One batch processes at most 20 candidates selected in SQL from one Channel, with at most four concurrent Judge calls. A timeout preserves unfinished processing and range progress; it never advances complete success.

`requestStoredHarvest(project)` activates the Project and calls `ProjectStorage.beginCycle`; the persisted generation increments only when the prior cycle is inactive. `claimAcquisition(project)` returns `{generation, channelId}` or null; `claimProcessing(project)` returns a Channel ID or null. Both persist the next Channel turn before external work, so restarts and busy/failing Channels do not starve siblings. Acquisition and processing rotate independently. `finish(project, at)` closes a cycle only after all configured streams and processing obligations are complete.

The bounded runner does not schedule itself. #21 should invoke the same batch from alarms and use the saved status to continue work; it owns concurrency, leases, cooldowns and retry deadlines. #19 extends the persisted stream/discovery selection instead of introducing a parallel collector. Currently one invocation may perform less than its maximum allowance; no extra IO is required merely to consume the budget.

The tests use real local Durable Object SQLite and injected Discord/Judge services. They cover eviction, atomic rollback, duplicate and rejected-message retention, same-name authors, pending retry, stale-result refusal and a native RPC round trip with the committed fixture. No real Discord calls are needed.

## Reprocessing contract (#22)

`prepareProcessing(project, mode)` obtains a `Corpus.snapshot`: the Posts and a SHA-256 revision of their ordered slug/title/body fields. Fixture policy includes that revision; the live accept-all Judge ignores evidence changes intentionally. It requeues retained messages only when their policy differs. The same Posts snapshot must be passed to `processCandidate(project, candidate, posts)`, so a result cannot be labelled with a different evidence revision. Run preparation inside XState after validating Project identity, before the cached-current decision and before acquisition.

`ProjectStorage.reprocess(channelIds, policyRevision)` is one atomic SQL update; rejected messages and nonquestions remain available. Failed processing preserves the prior question and last complete success. Reads never invoke preparation, Discord or Judge. `pending(channelIds, limit=20)` filters and limits in SQLite; freshness uses a separate count of all pending work.

Candidates carry independent source, policy and context revisions. `complete` checks all three while saving/removing the question and completing processing in one transaction. Observation/edit timestamps alone do not change a source revision.

For #19/#20, `invalidateContext(messageId, revision)` requeues a candidate only when its derived context changes. Derive that revision from the relevant thread title and reply inputs (IDs, content, author identity/name and deletion state), not just reply count or observation time. A reply edit with the same count must invalidate. The storage helper `invalidateProcessingContext` in `services/projectStorage/processing.ts` accepts the SQL handle: call it inside the same transaction that persists thread/reply changes. Later producers supply those records and extend `processCandidate`; they must not introduce a second processor or commit contextual records and invalidation in separate calls.
