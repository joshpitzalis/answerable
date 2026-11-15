# XState v6 beta notes (xstate@6.0.0-beta.3, @xstate/react@7.0.0-beta.0, effect@4.1.4)

Source of truth: installed package docs at `node_modules/xstate/docs/*.md` (index.md, agents.md, cheatsheet.md, xstate-v5-to-v6.md, invoke.md, spawn.md, delays.md, testing.md, history-states.md, final-states.md) and `.d.ts` under `node_modules/@xstate/react/dist/declarations/src/`. Everything marked RAN was executed with Node 24 against the installed packages in a throwaway probe before the feature was built. The working code that grew out of it is in `src/features/question-finder/workflows/` (Harvest machines, `fromEffect.ts`) and `src/features/question-finder/ui/questionsMachine.ts`. Re-check these notes when the pinned versions change.

The shipped README says "v6 alpha"; the package is beta.3. `xstate` has zero runtime deps. Note the docs say `createMachine` takes ONE argument; `createMachine(config, impls)` throws.

## 0. Renamed / removed

| v5 | v6 |
| --- | --- |
| `assign({...})` | transition/entry/exit fn returns `{ context: {...} }` (SHALLOW patch merged at top level, RAN: `{count, other}` + patch `{count}` keeps `other`) |
| `raise/sendTo/sendParent/forwardTo/emit/log/cancel/spawnChild/stopChild` | `enq.raise/sendTo/emit/log/cancel/spawn/stop` (second arg `enq` of every fn) |
| `enqueueActions` | plain fn `(args, enq) => {...}` |
| `guard:` prop, `and/or/not`, `stateIn` | no `guard` property (RAN: throws E4 at createMachine). Plain JS inside the fn; return `undefined` to refuse. `self.getSnapshot().matches('x')` replaces stateIn |
| `fromPromise(fn)` | `createAsyncLogic({ run: (args, enq) => ... })` |
| `fromCallback/fromObservable/fromTransition` | `createCallbackLogic/createObservableLogic/createStepLogic` |
| `types: {} as {...}` | `schemas: { context, events, input, output, ... }` with `types<T>()` (type-only) or Zod/Standard Schema |
| events union | events MAP keyed by type: `events: { add: types<{ n: number }>() }` |
| `on: { E: 'target' }` string / `[...]` arrays | string form THROWS at createMachine (E38). Arrays happened to work in my run but docs say not v6 syntax: do not use. One event = one transition; branch inside the fn |
| `invoke.onDone/onError` | kept, but event shapes changed (section 3) |
| `xstate.done.actor.<id>` etc. | `'xstate.done.actor'` + `matches: { actorId }` |
| `interpret`, `systemId`, `parent` option, `@xstate/immer`, `@xstate/inspect`, `typegen` | removed |
| `useMachine` | deprecated alias of `useActor` |
| React hooks recreate actor when machine changes | first machine used for component lifetime |

## 1. Defining a machine

```ts
import { setup, createActor, types, toPromise } from "xstate";
const m = setup({
  schemas: {
    input: types<{ start: number }>(),
    context: types<{ count: number; other: string }>(),
    events: { add: types<{ n: number }>(), reset: types<{}>() },
    output: types<{ total: number }>(),
  },
}).createMachine({
  context: ({ input }) => ({ count: input.start, other: "keep" }), // lazy context from input
  initial: "on",
  states: {
    on: {
      on: {
        // inline transition: return { target?, context? } or undefined (= event NOT handled)
        add: ({ context, event }) =>
          event.n < 0
            ? undefined
            : { context: { count: context.count + event.n } },
        reset: () => ({ target: "done" }),
        // with effects: (args, enq) => { enq(() => sideEffect()); return {...} }
      },
    },
    done: { type: "final" },
  },
  output: ({ context }) => ({ total: context.count }),
});
const a = createActor(m, { input: { start: 1 } }).start(); // input REQUIRED by type when schemas.input excludes undefined
a.send({ type: "add", n: 2 });
a.trigger.add({ n: 2 }); // trigger is typed from schemas.events
```

RAN output: `{"count":3,"other":"keep"}`; negative add refused (count stays 3); after reset `status 'done'`, `output {total:3}`.

- Both `setup({...}).createMachine({...})` and bare `createMachine({ schemas, ... })` work. Named implementations go in `setup({ actors, guards, actions, delays })`; reference actors by name string (`src: 'fetchStep'`), which also makes `machine.provide({ actors: { fetchStep: fake } })` possible (RAN: `real` vs `fake:7`).
- Fn args (transition): `{ context, event, self, parent, children, actions, actors, guards, delays, value, system, input }`.
- Named guards: `guards: { hasStock: (a, q) => a >= q }` then `({ context, guards }) => { if (!guards.hasStock(...)) return; ... }`.
- Relative `target` resolves among SIBLINGS only. Jumping out of a compound state needs a state `id` and `'#id'` (RAN: `target: 'waiting'` from `working.checking` threw E14; `id: 'waiting'` + `target: '#waiting'` worked).
- Dev builds deep-freeze plain objects/arrays in context; never mutate, always return new objects.
- Context patch is shallow: a nested object in the patch REPLACES that key. (The cheatsheet shows `{...context, x}`; both work.)
- `output` only read on final states and machine root; elsewhere silently ignored.

## 2. createAsyncLogic (was fromPromise)

Signature (docs): `createAsyncLogic<TOutput, TInput>({ id?, timeout?, run: ({ input, signal, self, system }, enq) => Promise<TOutput> })`. `enq` has `emit` and `step(key, exec)` (durable step memoised on snapshot `effects[key]`; experimental). `timeout` = ms or `'10s'`/ISO; on expiry it aborts the signal and errors with exported `TimeoutError`. Input comes from `invoke.input` / `spawn` `input` option.

```ts
const work = createAsyncLogic<{ ok: number }, { ms: number }>({
  run: async ({ input, signal }) => {
    await sleep(input.ms, { signal });
    return { ok: input.ms };
  },
});
```

When the signal aborts (all RAN):

- leaving the invoking state (any transition out): aborted, `signal.reason` is `DOMException` named `AbortError` ("This operation was aborted").
- `actor.stop()` on the parent: aborted, snapshot status `'stopped'`.
- parent stopping/completing also stops children (docs).
- A result arriving after abort is ignored (stale responses cannot arrive).
- A rejection of the run promise after abort is swallowed (no `onError`).

## 3. Invoking async logic: exact keys and event shapes

```ts
loading: {
  invoke: {
    id: 'w',                                   // default id is `<stateId>:<index>` e.g. 'loading:0'
    src: work,                                 // logic value, or registered name string
    input: ({ context, event, self }) => ({ ms: 20 }),
    onDone:  ({ context, event }) => ({ target: 'ok',  context: { v: event.output } }),
    onError: ({ context, event }) => ({ target: 'bad', context: { reason: String(event.error) } }),
    // onSnapshot, timeout (ms or fn), onTimeout (REQUIRED when timeout set; dev build throws otherwise)
  },
}
```

Event shapes (RAN, JSON.stringify of event):

- done: `{ type: 'xstate.done.actor', output: {ok: 20}, actorId: 'w', sessionId: '...' }`
- error: `{ type: 'xstate.error.actor', actorId: 'w', error: <the thrown value> }`
- `onDone/onError/onSnapshot` auto-filter on `matches: { actorId }`. Raw form on ancestor states: `on: { 'xstate.done.actor': { matches: { actorId: 'w' }, target: 'x' } }`.
- Other generated types: `xstate.done.state` (`stateId`, `output`), `xstate.after` (`stateId`,`delay`), `xstate.timeout.state`, `xstate.timeout.actor`, `xstate.snapshot.actor`.
- Old names: key `'xstate.done.actor.w'` THROWS at createMachine (E3), BUT `'done.invoke.w'` and any made-up key like `'onDone'` under `on` are ACCEPTED and silently never fire (RAN). Do not use them.
- Completed child is removed from `snapshot.children` right after its done/error event; read output from the event, not the snapshot.
- Unhandled child error (no `onError`) errors the parent actor (status `'error'`); with a root subscriber `{ error }` it is delivered there, otherwise reported via `setTimeout(() => { throw })` (unhandled error, can crash a Node process; RAN: crashed the script).
- Typed in TS: `event.output` is typed in `onDone` for registered/named actors; `event.error` is `unknown` (narrow with `instanceof`).

## 4. Spawn N children, concurrency, join, collect outputs

`invoke` is static (fixed count); for one-per-list-item use `enq.spawn` (`entry` or a transition). Children run concurrently (RAN: 3 async children, max concurrently running = 3). Spawned children have NO `onDone/onError`. Two ways to observe:

A) raw lifecycle events on the parent (RAN): spawned children DO send `xstate.done.actor` and `xstate.error.actor` to the parent.

```ts
on: { 'xstate.done.actor': ({ context, event }) => { /* event.actorId, event.output */ } }
```

B) `enq.subscribeTo(child, { done: (output) => ({ type: 'channel.done', output }), error: (e) => ({...}), snapshot })` mapping to your own typed event (RAN, typechecks, output typed from the child). **Even with subscribeTo you must also handle `xstate.error.actor` if the child can reject**: my subscribeTo-only variant crashed the parent with the child's error. Safest: child machines never reject (catch via invoke `onError` into a `failed` FINAL state with output).

Verified end-to-end pattern (`full.ts`, typechecked + RAN):

```ts
const channelMachine = setup({
  schemas: {
    input: types<Channel>(),
    context: types<{ channel: Channel; reason: string | null }>(),
    output: types<{ channel: string; failure: string | null }>(),
  },
  actors: { fetchStep },
}).createMachine({
  context: ({ input }) => ({ channel: input, reason: null }),
  initial: "fetching",
  states: {
    fetching: {
      invoke: {
        src: "fetchStep",
        input: ({ context }) => context.channel,
        onDone: { target: "done" },
        onError: ({ event }) => ({
          target: "failed",
          context: {
            reason:
              event.error instanceof Error ? event.error.message : "unknown",
          },
        }),
      },
    },
    done: { type: "final" },
    failed: { type: "final" },
  },
  output: ({ context }) => ({
    channel: context.channel.name,
    failure: context.reason,
  }),
});
const projectMachine = setup({
  schemas: {
    input: types<Project>(),
    context: types<{
      channels: Channel[];
      pending: number;
      results: ChannelResult[];
    }>(),
    events: { "channel.done": types<{ output: ChannelResult }>() },
    output: types<{ failed: ChannelResult[]; all: ChannelResult[] }>(),
  },
  actors: { channelMachine },
}).createMachine({
  context: ({ input }) => ({
    channels: input.channels,
    pending: input.channels.length,
    results: [],
  }),
  initial: "running",
  states: {
    running: {
      entry: ({ context }, enq) => {
        for (const c of context.channels) {
          const child = enq.spawn(channelMachine, {
            id: `channel-${c.id}`,
            input: c,
          }); // unique live id or it throws
          enq.subscribeTo(child, {
            done: (output) => ({ type: "channel.done", output }),
          });
        }
      },
      always: ({ context }) =>
        context.pending === 0 ? { target: "finished" } : undefined, // empty list would hang otherwise (RAN: stays 'running')
      on: {
        "channel.done": ({ context, event }) => {
          const results = [...context.results, event.output];
          const pending = context.pending - 1;
          return {
            target: pending === 0 ? "finished" : undefined,
            context: { pending, results },
          };
        },
      },
    },
    finished: { type: "final" },
  },
  output: ({ context }) => ({
    all: context.results,
    failed: context.results.filter((r) => r.failure !== null),
  }),
});
```

RAN result: `{"all":[B(failed 'Discord 401'), O, S],"failed":[B]}` (order = completion order, not input order; sort if order matters). Empty list: `{"all":[],"failed":[]}`.

- Duplicate live child `id` throws and errors the parent. Make ids from stable keys (channel id).
- Spawned children persist beyond the spawning state; they stop when done, `enq.stop(ref)`, or parent stops/finishes.
- Spawned _inline_ (unregistered) logic cannot be persisted; irrelevant here, but register machines in `actors` anyway.

## 5. Final states, output, running to completion from async code

- Top-level `type: 'final'` -> `snapshot.status === 'done'`, `snapshot.output` = final state's `output` or root `output` mapper (receives `{ context, output }`).
- Final states are inert (no `on/after/invoke`).
- Run to completion (RAN):

```ts
const actor = createActor(machine, { input }); // subscribe BEFORE start if you need the initial snapshot
actor.start();
try {
  return await toPromise(actor);
} // resolves with output; REJECTS with the actor's error if it errored
finally {
  actor.stop();
} // stop on done is fine
```

- `toPromise` on an actor that is `stop()`ped resolves `undefined` (RAN), it does not reject.
- `waitFor(actor, (s) => s.matches('x'), { timeout, signal })` returns the snapshot; always pass `timeout`.
- Actors are single-use: `start()` after `stop()` throws (E48). Create one actor per request; no module-scope actors.
- Root actor `id` = machine `id` if set.

## 6. Delays, simulated clock, dynamic delays

```ts
after: { 5000: { target: 'timedOut' } }        // also '5s', '250ms', ISO 'PT1M30S'. NOT '5m'/'1h'.
after: { retryAfter: { target: 'x' } }         // named delay (setup/createMachine `delays`)
setup({ delays: { retryAfter: ({ context }) => context.waitMs } })   // DYNAMIC: function of context (evaluated ONCE on state entry, after entry fn updated context)
```

- No inline-function delay keys; dynamic delay = named delay fn. Undeclared name -> throws E9 when the state is entered (RAN), not silently immediate.
- `after` transitions can themselves be fns: `after: { d: ({ context }) => ({ target: context.resume }) }` (RAN).
- Timers are cancelled when the state is exited. `enq.raise(ev, { delay, id })` / `enq.cancel(id)` for delayed events.
- Test without sleeping (RAN):

```ts
import { SimulatedClock } from "xstate";
const clock = new SimulatedClock();
const a = createActor(machine, { clock }).start();
clock.increment(4999); /* still waiting */
clock.increment(1); /* fires */
```

Child actors inherit the parent's clock (RAN: invoked child with `after: 1000` fired via parent's `clock.increment(1000)`). Custom clock shape: `{ setTimeout, clearTimeout, now? }`. After `increment`, async invoke results still need a macrotask/`waitFor` to settle (RAN used `await sleep(5)`/`waitFor`); timers of the simulated clock do not affect real promise timers inside async logic (use `provide` with fake logic).

- Snapshot exposes `snapshot.timers` (declared delay, event).
- Invoke `timeout` must be ms (number or fn); async-logic `timeout` accepts duration strings. State `timeout` + `onTimeout` also exists.

## 7. "Re-enter the interrupted step" (waiting state)

Both RAN with SimulatedClock; 429 -> `waiting` (5000 ms from context) -> back; result identical (calls fetching, checking(429), checking). A) History (shallow default target REQUIRED):

```ts
working: { initial: 'fetching', states: { fetching: stepState('fetching','checking'), checking: stepState('checking','done'),
    hist: { type: 'history', target: 'fetching' }, done: { type: 'final' } }, onDone: { target: '#finished' } },
waiting: { id: 'waiting', after: { retryAfter: { target: 'working.hist' } } },
// inside a step state's onError:  return { target: '#waiting', context: { ...context, retries: context.retries + 1, waitMs: event.error.retryAfterMs } };
```

History is recorded on exit, before exit actions. Re-entering through `hist` re-runs `working` entry and restarts the step's invoke (a NEW request/actor). A `hist` state does not keep the "current" child, it falls back to default target if never exited. B) Remembered target in context (flat states, simplest, no ids on parent):

```ts
onError: ({ context, event }) => ({ target: '#waiting', context: { ...context, retries: context.retries + 1, waitMs: event.error.retryAfterMs, resume: 'checking' } })
waiting: { id: 'waiting', after: { retryAfter: ({ context }) => ({ target: context.resume }) } }
```

Retry cap: `if (context.retries >= 2) return { target: '#failed', ... }` in the same onError. Declare delay: `setup({ delays: { retryAfter: ({ context }) => context.waitMs } })`. Note `target` strings are NOT type-checked against ids when written as `'#id'` in all positions: verify by running.

## 8. @xstate/react 7 beta

Exports: `useActor, useActorRef, useSelector, useMachine (deprecated alias), createActorContext, shallowEqual`.

```ts
useActor<TLogic>(logic, options?: ActorOptions<TLogic>): [snapshot, actor.send, actor]   // options REQUIRED (type) when logic needs input
useActor(actor)                                       // pass a pre-created Actor (e.g. restoreActor) instead
useActorRef(logic, options?, observer?) : Actor       // no re-render on snapshots
useSelector(actor, (snapshot) => value, compare?)     // actor may be undefined
```

- Pass input: `useActor(machine, { input: { slug } })` (RAN). Hooks read `input` and the machine ONCE (like `useState` initializer). Later renders with a different `input` or machine are ignored silently (RAN: prop change `a` -> `b` without a key kept state `loaded:a`, no new invoke). Only `machine.provide({...})` implementations are refreshed per render.
- FRESH ACTOR PER TAB/ROUTE: put a `key` on the component (`<ProjectView key={slug} slug={slug} />`) (RAN: key change -> new actor, `loading:c`, `start c`). Otherwise TanStack Router reuses the component across param changes and you keep the old actor.
- Lifecycle: actor is created during render (`useState` initializer), started in `useEffect`, stopped on unmount via a microtask that StrictMode's remount cancels (RAN under `<StrictMode>`: exactly one `start`; unmount -> signal aborted `abort c`). An externally stopped actor is replaced by a fresh one.
- SSR (RAN with `renderToString`): output `<p>loading:xstate:0</p>`; `_processingStatus` 0 (not started), invoked async logic did NOT run (0 calls), context initializer ran once. So server HTML shows the machine's INITIAL snapshot (no hydration data). Client first render uses `getSnapshot` for both server/client snapshot, so hydration markup matches; the actor starts after mount and loading begins client-side. Avoid initial-state values that differ between server and client (no `Date.now()`/random in context initializer).
- Errors: if the actor reaches `status: 'error'`, `useActor`/`useSelector` THROW the error during render (needs an error boundary). Design child states so expected failures are data (`failed` state).
- Send: `const [snap, send] = useActor(...)`; `send({ type: 'retry' })`, or `actor.trigger.retry()` (typed from `schemas.events`). Read: `snap.matches('loading')`, `snap.context.x`, `snap.value`; or `useSelector(actor, s => s.context.questions)` / `actor.select(fn).get()`.
- Peer deps: react ^16.8..^19, xstate ^6.0.0-beta.0 (pin exact; it is `^` in the package, ours should be exact).

## 9. Cloudflare Workers / TanStack Start SSR gotchas (from dist source + runs)

- No Node-only imports in `xstate` or `@xstate/react` ESM (`xstate.esm.js`, `createActor-*.esm.js` import only each other; the `rxjs`/`zod` strings are in comments). `xstate/persist`, `/durable`, `/graph`, `/fsm`, `/actors` are separate entries, not needed.
- Module-scope: only counters/caches and lazy `executionIdPrefix`; uses `globalThis.crypto.getRandomValues`/`randomUUID` inside try/catch with `Date.now`/`Math.random` fallback, and only on first actor creation (so not at Worker global scope). The prefix is cached in module state across requests in one isolate: harmless (session ids only).
- Timers: default clock is global `setTimeout`/`clearTimeout`. In Workers timers only run while the request is alive; `after` delays longer than the request lifetime will not fire. Unrecovered errors are rethrown via `setTimeout(() => { throw err })` (can surface as uncaught exception outside your try/catch). Always give root actors an `error` subscriber / `toPromise` and keep child failures as data.
- Do not create actors at module scope; one per request, `start()`, await, `stop()`.
- Dev vs prod build: `exports` has a `development` condition (extra warnings, deep-freeze of context, dev errors e.g. missing `onTimeout`). Vite dev picks it; Workers prod build uses `module`. Frozen context: Effect services/class instances are not frozen (only plain objects/arrays), but keep them out of context anyway (persistable JSON only).
- Hooks do not start actors in `renderToString`; nothing async or timer-based happens server-side.
- Pass the `env`/runtime in via `input` or via `machine.provide({ actors })` per request; do not import `cloudflare:workers` from the machine file.

## 10. Effect run from async logic (effect@4.1.4)

Confirmed in `node_modules/effect/dist/ManagedRuntime.d.ts:166`: `readonly runPromise: <A, E>(effect: Effect.Effect<A, E, R>, options?: Effect.RunOptions) => Promise<A>` and `Effect.RunOptions { signal?: AbortSignal; scheduler?; uninterruptible?; onFiberStart? }` (Effect.d.ts:17357).

```ts
import { Effect, ManagedRuntime } from "effect";
import { createAsyncLogic } from "xstate";
export const fromEffect = <A, I, R>(
  rt: ManagedRuntime.ManagedRuntime<R, never>,
  make: (input: I) => Effect.Effect<A, unknown, R>
) =>
  createAsyncLogic<A, I>({
    run: ({ input, signal }) => rt.runPromise(make(input), { signal }),
  });
```

(typechecks under `tsc --strict`.) RAN results:

- Leaving the invoking state: `Effect.onInterrupt` finalizer ran (1) and machine moved on. `actor.stop()`: finalizer ran (1).
- Normal result: done event `output` is the Effect's success value.
- Failure: `Effect.fail(new Boom())` -> `event.error` is the original `Boom` instance (`instanceof Boom` true, `_tag 'Boom'`); not wrapped in a FiberFailure.
- Abort mid-flight rejection is `Error: All fibers interrupted without error` (swallowed by XState because the actor is already stopped/left).
- CAVEAT: with an ALREADY-aborted signal, `runPromise` still RAN the effect to success (RAN). A signal passed after the state was left is not a realistic path (XState does not run logic after leaving), but do not rely on pre-abort short-circuit in tests.
- `Context.Service` class syntax in effect 4: `class Svc extends Context.Service<...>()('Svc', { make })` (adapt to the repo's existing service style).
- Untyped `E`: the wrapper erases it; map to a domain error inside the effect (`Effect.catchTag`...) or handle `event.error` with `instanceof`/`_tag` checks (no casts).

## Verified by the build

- Local workerd through `alchemy dev`: the Harvest machines and the client machine run end to end (`pnpm e2e`).
- `@xstate/react` with TanStack Router: a Project route keyed by slug gets a fresh actor per visit (`e2e/questions.spec.ts`).

## UNVERIFIED

- A deployed Worker (production build conditions); only `alchemy dev` has run.
- `useSelector`/`createActorContext` runtime (read source only).
- Docs claim arrays/strings in `on` are not v6 syntax; arrays still ran in my probe (do not use).
- Compile-time check that `'#id'` targets are validated by TS types.
