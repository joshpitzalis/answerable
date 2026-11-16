# Stored first Harvest

Issue #17 adds `ProjectHarvest.harvest(project)` and `read(project)`. The UI still uses its existing fixture path until #23. `read` only reads local SQLite; `harvest` seeds at most the latest 50 messages per configured text Channel and processes saved candidates. Repeating a completed first Harvest returns saved data without changing freshness. #18 supplies subsequent cycles and budgets.

## Storage boundaries

- `ProjectStorage.ingestPage` commits source messages, processing obligations and the supplied stream progress together. Call it only after decoding the whole page. A failed transaction leaves the previous progress intact.
- Message IDs are canonical decimal strings, compared by length then value. A relevant source change increments `sourceRevision`; observation or edit timestamps alone do not. An unchanged replay does not requeue completed work.
- `pending(channelIds)` returns the saved message revision and policy revision. `complete(candidate, row)` atomically saves or removes the question and marks processing complete, refusing an obsolete revision. Judge failure leaves the candidate pending so retry needs no Discord download.
- `FetchProgress` holds the completed boundary separately from `upperBoundary` and `before`. #17 completes one initial page; #18 owns bounded catch-up and alarm continuation. Empty initial pages use the request-start snowflake as their boundary, after confirming access and Message Content Intent.
- `read(project)` filters removed Channels and uses current display labels. Contributions derive from retained messages grouped by author ID, excluding bots, webhooks and deleted messages. Project/server identity cannot move.
- Processing policy revisions distinguish live and fixture Judge behavior. #20 adds stored owner-reply filtering; the current fixture revision explicitly says `replies-pending`. #22 owns configuration/policy changes and local requeue.

## Discord boundary and continuation handoff

`Discord.messagePage` validates message and author identity, timestamps, page size and Channel membership before returning anything. `threadId` is nullable: an ordinary message ID never stands in for a thread ID.

The initial text adapter makes four metadata calls (application, Channel, guild, bot member), then one message-page call. It checks Message Content Intent and effective View Channel/Read Message History permissions, including overwrites. #18 must include these calls in its Discord budget; #19 extends access/discovery for forum and thread streams. A successful empty response alone is not proof of readable content.

The tests use real local Durable Object SQLite and injected Discord/Judge services. They cover eviction, atomic rollback, duplicate and rejected-message retention, same-name authors, pending retry, stale-result refusal and a native RPC round trip with the committed fixture. No real Discord calls are needed.
