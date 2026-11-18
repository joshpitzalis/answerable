# Stored first Harvest

Issues #17/#18 add `ProjectHarvest.harvest(project)`, `requestHarvest(project)` and `read(project)`. The UI still uses its existing fixture path until #23. `read` only reads local SQLite. `requestHarvest` requests a new cycle without external IO; requests during an active cycle coalesce. `harvest` runs one bounded batch, initially activating a new Project. Repeating a completed Harvest returns saved data without changing freshness unless the processing policy changed.

## Storage boundaries

- `ProjectStorage.ingestPage` commits source messages, processing obligations and the supplied stream progress together. Call it only after decoding the whole page. A failed transaction leaves the previous progress intact.
- Message IDs are canonical decimal strings, compared by length then value. A relevant source change increments `sourceRevision`; observation or edit timestamps alone do not. An unchanged replay does not requeue completed work.
- `pending(channelIds)` returns the saved message revision and policy revision. `complete(candidate, row)` atomically saves or removes the question and marks processing complete, refusing an obsolete revision. Judge failure leaves the candidate pending so retry needs no Discord download.
- `FetchProgress` holds the completed boundary separately from `upperBoundary` and `before`. Initial coverage is one latest-50 page per Channel. Later cycles capture an upper boundary and walk backward until reaching the completed lower boundary or exhausting history. Each page commits its continuation atomically. Empty initial pages use the request-start snowflake as their boundary, after confirming access and Message Content Intent.
- `read(project)` filters removed Channels and uses current display labels. Contributions derive from retained messages grouped by author ID, excluding bots, webhooks and deleted messages. Project/server identity cannot move.
- Processing policy revisions distinguish the question rule, Judge mode/evidence and reply policy. Fixture policy includes `stored-replies-v1` and the owner name; live owner-reply exclusion remains disabled.

## Discord boundary and continuation handoff

`Discord.sourcePage` validates message and author identity, timestamps, page size and Channel membership before returning anything. It returns a text page, public-thread discovery page, starter or tracked-thread message page. `threadId` is nullable: an ordinary message ID never stands in for a thread ID.

The adapter makes four sequential metadata calls (application, Channel, guild, bot member), then one data call. A batch acquires at most one text page, discovery page, starter or thread page, staying within five actual Discord calls. It checks Message Content Intent and effective View Channel/Read Message History permissions, including overwrites. A method invocation is not necessarily one wire request. A successful empty response alone is not proof of readable content.

## Bounded work contract (#18)

`harvestStoredProject(runtime, project, mode, clock?)` runs preparation, acquisition and processing inside one XState state with a 20-second timeout. Cancellation reaches Effect and the actual fetch AbortSignal. The optional XState clock permits deterministic deadline tests. One batch processes at most 20 candidates selected in SQL from one Channel, with at most four concurrent Judge calls. A timeout preserves unfinished processing and range progress; it never advances complete success.

`requestStoredHarvest(project)` activates the Project and calls `ProjectStorage.beginCycle`; the persisted generation increments only when the prior cycle is inactive. `claimAcquisition(project)` returns `{generation, channelId}` or null; `claimProcessing(project)` returns a Channel ID or null. Both persist the next Channel turn before external work, so restarts and busy/failing Channels do not starve siblings. Acquisition and processing rotate independently. `finish(project, at)` closes a cycle only after all configured streams and processing obligations are complete.

The bounded runner does not schedule itself. `ScheduledHarvest` invokes the same batch from alarms; it owns concurrency, cooldowns and retry deadlines. Forum/thread work extends the persisted stream/discovery selection instead of introducing a parallel collector. One invocation may perform less than its maximum allowance; no extra IO is required merely to consume the budget.

## Durable scheduling contract (#21)

`activateHarvest(slug)` and `refreshHarvest(slug)` are validated POST server functions. They resolve trusted Project configuration server-side. Native `activate(projectId)` and `requestHarvest(project)` resolve it again and check the named object's mode/identity. The legacy UI remains until #23; it must use these operations plus saved reads and remove direct inline batch collection.

Activation records the Project once and arms its first alarm without collecting inline. A single synchronous in-memory claim coalesces alarm deliveries; manual requests during a running batch return saved state. Reads remain available during external IO. SQL persists activation, generation, next due/alarm times, manual eligibility, global pause and retry obligations. A recovery alarm is armed before work starts. The `run_generation` marker distinguishes a completed batch whose final schedule write failed from a fresh regular cycle, so reconstruction can finish scheduling without collecting again. There is no persisted running lock.

Completed cycles schedule their next check fifteen minutes after last complete success. Manual requests coalesce and reserve a minimum sixty-second interval, including queued requests. Continuations run no sooner than one second later. Source `retry_after` and Project-wide global pauses survive reconstruction. Each failed acquisition unit or processing candidate gets two retries in its generation; exhaustion retains pending work and partial failure until the next cycle, fifteen minutes later. Expected external failures become retry rows; unexpected storage/runtime failures escape the alarm for native recovery. The bounded runner's twenty-second timeout aborts unfinished IO and schedules a continuation.

`workEligible(sql, kind, workId, generation, at)` and `nextWork` in `projectStorage/retries.ts` govern due work. Acquisition keys parent pages/discovery by parent Channel and starter/reply pages by thread ID; processing keys by message ID. `acquisitionWork` supplies the same outstanding units to claims and earliest-deadline calculation. A delayed thread does not block siblings. Successful source/processing commits clear their retry row in the same SQL transaction. Never clear retry state in a later workflow call: a crash between those commits would leave a completed item permanently failed. Page ingestion accepts `expectedGeneration`; processing candidates carry their claimed generation. Both reject stale commits, as do forum/thread writes.

Saved status includes `nextEligibleAt`. Queued work with a future deadline reports `waiting`; failures remain `partial`, and current data waiting for its ordinary fifteen-minute check stays `current`. Last attempt and last complete success remain separate. #24 includes reconciliation obligations in earliest-work selection. Configuration and suspension are reconciled before due work; removed Projects/mode mismatches stop scheduling.

Runtime tests use actual Durable Object SQLite, native activation/alarms/eviction, controlled clocks, held IO and SQL failure triggers. `withHarvestRuntime` accepts an optional sixth `time` argument after Corpus; `withScheduledHarvest` exposes the scheduling coordinator on real storage with that clock. No real Discord calls or long timer sleeps are required.

The tests use real local Durable Object SQLite and injected Discord/Judge services. They cover eviction, atomic rollback, duplicate and rejected-message retention, same-name authors, pending retry, stale-result refusal and a native RPC round trip with the committed fixture. No real Discord calls are needed.

## Forum discovery contract (#19)

The same acquisition turn performs active discovery, public archive pages, then pending starters. `forum_scans` persists the generation, archive floor, captured upper timestamp and exclusive cursor; `discord_threads` persists canonical thread/starter identity, parent, title, archive state and pending starter work. The first active list admits its latest 50 distinct public posts. Later active lists admit every new post since activation and refresh already tracked posts. Archive traversal starts at activation and subsequently overlaps the previous captured upper timestamp, so a post archived between checks remains discoverable without historical archive backfill.

`forumRequest(channelId, generation)` selects the next saved phase. `saveThreadPage` atomically commits metadata/context invalidation and discovery continuation; it returns false when a timestamp cursor cannot advance. Boundary overlap retains sub-millisecond ties, and an unpageable repeated boundary fails visibly instead of skipping records. `saveForumStarter` atomically stores the raw message, its title context and the completed starter obligation. Missing/forbidden starters stay pending. Only completed archive traversal plus no pending starters completes the parent acquisition generation. A failed Channel does not block other Channels' turns.

Forum title and body remain separate in storage. `pending` joins the starter's current title; the existing processor derives title plus body for judgement/display. The raw starter contributes once. Title changes invalidate processing in the metadata transaction, preserving the old saved question until replacement commits.

## Tracked thread comments (#20)

Text parents perform public active/archive discovery after their message pages. Existing seeded text starters and new threads since activation enter the registry; ordinary message IDs are never requested as threads. Each registry entry has its own `fetch_progress` row seeded at boundary zero, so the first collection walks all accessible history rather than stopping at fifty messages. Active entries collect every generation. An observed archive transition sets final-tail work; archived entries then rest until rediscovered active.

`ForumRequest` selects starter or message obligations in persisted round-robin order, excluding delayed/exhausted thread IDs. `saveThreadMessages` atomically commits raw replies, continuation, retry clearing and combined context invalidation. `finishDiscovery` completes the parent only after discovery, starters and reply obligations finish. Each batch still makes at most four access reads and one data request. Missing/inaccessible threads retain their saved rows and pending obligation.

Replies contribute by author ID but never acquire standalone processing rows. A starter seen again in thread pagination retains its original row, including a text starter's parent URL/body. Context combines title and ordered reply IDs/content/author identity/name/deletion state. Stored reply count supplies visible comments, and fixture mode excludes owner-answered threads from those same stored records. Live mode keeps owner-answered questions. The fixture HTTP adapter exposes real fixture thread identities and replies through this boundary. Legacy UI acquisition remains separate until #23.

## Reprocessing contract (#22)

`prepareProcessing(project, mode)` obtains a `Corpus.snapshot`: the Posts and a SHA-256 revision of their ordered slug/title/body fields. Fixture policy includes that revision; the live accept-all Judge ignores evidence changes intentionally. It requeues retained messages only when their policy differs. The same Posts snapshot must be passed to `processCandidate(project, candidate, posts, mode)`, so a result cannot be labelled with a different evidence revision. Run preparation inside XState after validating Project identity, before the cached-current decision and before acquisition.

`ProjectStorage.reprocess(channelIds, policyRevision)` is one atomic SQL update; rejected messages and nonquestions remain available. Failed processing preserves the prior question and last complete success. Reads never invoke preparation, Discord or Judge. `pending(channelIds, limit=20)` filters and limits in SQLite; freshness uses a separate count of all pending work.

Candidates carry independent source, policy and context revisions. `complete` checks all three while saving/removing the question and completing processing in one transaction. Observation/edit timestamps alone do not change a source revision.

## Trusted configuration and suspension (#25)

The native entry re-resolves the stable Project ID against the current mode's trusted registry, including saved reads. The scheduler records sorted Channel IDs and owner policy inputs in SQLite. Source changes and suspension invalidate the generation before further claims; acquisition and processing reject stale configuration, and candidate selection excludes disabled or removed sources. Display labels and slugs do not change generation or storage identity. Current read models filter retained content through current Channels.

`HARVEST_ENABLED=false` makes the existing read/activation/refresh entry return saved `suspended` state after clearing the native alarm. Removed Projects and mode mismatches take the same alarm cancellation path. A running old batch cannot republish stale results, mark complete success or rearm a suspended Project. Resumption queues only previously activated Projects, preserving rows, cursors and global rate-limit pauses. [The operations guide](harvest-operations.md) describes the required per-Project quiescence confirmation before rollback and the retained-data re-enable procedure.

For #19/#20, `invalidateContext(messageId, revision)` requeues a candidate only when its derived context changes. Derive that revision from the relevant thread title and reply inputs (IDs, content, author identity/name and deletion state), not just reply count or observation time. A reply edit with the same count must invalidate. The storage helper `invalidateProcessingContext` in `services/projectStorage/processing.ts` accepts the SQL handle: call it inside the same transaction that persists thread/reply changes. Later producers supply those records and extend `processCandidate`; they must not introduce a second processor or commit contextual records and invalidation in separate calls.

## Daily reconciliation (#24)

The first daily deadline is activation plus 24 hours. `reconciliation_work` retains separate recent-page, known-message and thread-metadata obligations. A due pass snapshots configured text Channels, tracked active threads and displayed questions; unfinished work survives reconstruction and later cycles. Recent pages read at most 50 messages without advancing the incremental collection cursor. Displayed starters receive individual lookups, and displayed threads receive metadata lookups, including archived threads.

The existing acquisition claim alternates normal collection and reconciliation within a Channel while retaining its persisted Channel rotation. Reconciliation uses independent `reconcile:` retry keys and the same wire, candidate, concurrency and elapsed-time limits. Pending reconciliation prevents a complete-success timestamp; the next daily deadline participates in regular alarm scheduling. A large daily backlog keeps that cycle incomplete; the next regular cycle remains fifteen minutes after completion. There is no second runner.

`saveReconciliation` commits observations, revisions, question removal, derived contribution changes, thread-context invalidation, retry clearing and obligation completion in one SQLite transaction. Unchanged observations do not requeue processing. A confirmed deletion increments its source revision once; repeated observations retain its first tombstone time.

The Discord adapter recognizes deletion only for a known-message endpoint returning HTTP 404 with Discord code 10008 after access checks ([Discord error codes](https://docs.discord.com/developers/topics/opcodes-and-status-codes#json)). Public-thread permissions inherit from the configured parent ([Discord thread permissions](https://docs.discord.com/developers/topics/threads#permissions)). Unknown Channel, permission failures, malformed responses and absence from a recent list retain saved content and never prove deletion. This remains a working copy: edits outside the latest-50/displayed-question coverage and deletions never observed through a known-message check are not guaranteed to appear.
