---
status: accepted
---

# A Project owns its durable Harvest

Each Project has one SQLite Durable Object, named by runtime mode and permanent Project ID. It owns collected messages, thread state, processing revisions, questions, contribution inputs, pagination and due work. This keeps page commits and their continuations in one transaction, and gives one coordinator responsibility for concurrent manual requests and alarm delivery.

XState v6 owns the short-lived batch flow. Effect services own Discord, Judge, Corpus and storage IO. An actor is reconstructed from committed records for each invocation; promises, fibers and machine snapshots are not recovery records. A native alarm wakes the earliest continuation, retry or regular cycle. A recovery wake is armed before external IO, and generation/revision checks reject late results.

Saved reads never collect. First activation and Refresh schedule work explicitly; subsequent browser polling only reads saved rows and status. One instance claims its runner before an external await. SQLite persists the obligations across instance eviction, while duplicate delivery remains safe. Network reads and Judge calls can repeat after a crash before commit; stored effects, not external calls or billing, are idempotent.

## Alternatives deferred

- **Emmett event streams and projections:** the vendored reference includes a Durable Object adapter, but this contract needs transactional current state and checkpoints, not replay or an audit history. Keep the subtree as reference, without adding an app dependency.
- **D1 projections:** no cross-Project query requires a shared projection. Adding one would introduce another consistency boundary without serving this feature.
- **Discord Gateway:** incremental polling and bounded reconciliation meet the agreed coverage. A Gateway connection, reconnect protocol and event history would broaden the reliability contract.
- **One object per Channel:** it would split Project cooldown, fair work selection, contributor counts and status across coordinators.

## Consequences

Projects collect independently, including when their configured sources overlap. This release has no token-global rate-limit coordinator. Batches stay within five sequential Discord requests, twenty candidate evaluations, four concurrent Judge calls and twenty seconds elapsed work.

Keep the Alchemy stack/stage, native `ProjectHarvest` class and `PROJECT_HARVEST` namespace binding stable. Append transactional SQL migrations and refuse unknown future versions. First activation seeds new storage; there is no migration of vanished Map contents. Rollback retains data and first quiesces every activated object's alarm using the [operations procedure](../agents/harvest-operations.md).

This is a persistent working copy with deliberately partial history. [Coverage and verification](../agents/durable-harvest-verification.md) distinguish local proofs from the separately authorized deployment rehearsal.
