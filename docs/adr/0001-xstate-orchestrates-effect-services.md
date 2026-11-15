---
status: accepted
---

# XState orchestrates, Effect services do the outside work

Supporting several Projects, each with several Channels, turned the Harvest into a multi-step, multi-actor flow with partial failure and rate-limit waits. We decided that XState v6 owns flow and state on both the client and the server, while the existing Effect services (`Discord`, `Judge`, `Corpus`, `Cursors`, `QuestionStore`) keep doing all outside and async work, invoked by machines when needed. Effect stays because it already handles dependency injection and typed errors for those services; XState is added because step states make failure points and waiting explicit.

## Considered Options

- **Effect only, no XState.** Rejected: the owner wants the new work built on XState v6, and step states give visible per-Channel progress and failure.
- **XState replaces the services too** (services become actor logic, Layers replaced by `machine.provide`). Rejected: rewrites working code for no gain.
- **`@xstate/effect` bridge** to run Effects as actor logic. Rejected for now: it is marked experimental and requires `effect@^4` stable while the repo pins `4.0.0-rc.109`. Machines call Effects through a plain wrapper (`createAsyncLogic` running the Effect on the existing `ManagedRuntime`) instead. Revisit when the bridge is stable.
- **XState v5 stable now, migrate later.** Rejected: v6 rewrites every transition (no `assign`, inline transition functions), so a later migration would redo the work.

## Consequences

- XState v6 is in beta and releasing every few days. `xstate` and `@xstate/react` are pinned to exact versions with no range; upgrades are deliberate.
- Effect no longer runs in the browser. The client machine calls the server function directly, and `@effect/atom-react` is removed.
- v6 React hooks do not start actors during server render, so questions load in the browser after first paint.
- `/search` and `Embedder` are outside this decision and stay on Effect alone.
