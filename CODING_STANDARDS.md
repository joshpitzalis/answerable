# CODING_STANDARDS.md

The single source of truth for how code in this repository is laid out, written and tested. Read it before adding or moving code and again when reviewing. This is a single app: the composition root is `src/app`, features live under `src/features/`, shared code under `src/shared` and `src/components`, and end-to-end tests are Playwright specs under `e2e/`.

TypeScript + Effect. Follow the installed versions and existing tooling.

## Scope

Apply these conventions to all new and substantially changed code: features, fixes and refactoring. Do not restructure legacy code in passing; move it when its feature is already being changed.

## Feature ownership

- Build self-contained vertical slices under `src/features/`.
- A feature represents a business capability; workflows represent actions within it.
- Keep a feature's code, UI, tests and supporting files together. Removing a feature should mean deleting its folder plus minimal external registration.
- Cross features only through their explicit public exports (`index.ts`); never import another feature's internals.
- Features depend on capabilities, not providers: call `Discord.listMessages(...)`, never `fetch` against the Discord API.

## Structure

Start with files; introduce folders only as needed. Never scaffold empty files.

```text
src/
  features/
    question-finder/
      index.ts
      domain.ts
      workflows/
        harvestQuestions.ts
      services/
        corpus.ts
      subscriptions.ts
      ui/
      lib/
      __tests__/
  shared/
  components/
  app/
```

| Path | What goes here |
| --- | --- |
| `index.ts` | The feature's entry and its only trust boundary: the one file that sees `unknown`. Parses untrusted input from any transport (request body, URL search params, queue message, CLI args), calls one workflow, maps the reply and errors (status codes included), and re-exports the feature's public API. |
| `domain.ts` | Business types, entities, value objects, events, read models, domain errors and pure rules, including rules that span several objects (the caller loads the data). No HTTP, database or framework imports. When `domain.ts` grows into `domain/`, name each split file `<name>.<kind>.ts`, where kind is `entities`, `values`, `rules`, `events`, `errors` or `read-models` (`question.entities.ts`, `cursor.values.ts`, `answered.rules.ts`, `question-kept.events.ts`, `channel.errors.ts`, `question-row.read-models.ts`). |
| `workflows/` | One file per user intention (`harvestQuestions`, `listQuestions`). Coordinates domain behaviour and service calls through service contracts. No React. |
| `services/` | IO used only by this feature. Each service starts as one file holding its Effect contract, live implementation and Layer. |
| `subscriptions.ts` | Reactions to another feature's events. Only once a real subscriber exists. |
| `ui/` | Frontend components (one `.tsx` file each) and hooks. A component imports domain and calls workflows through hooks; it never imports services or `index.ts` internals. |
| `lib/` | Pure leftovers that are not domain or workflows: static config, constants, small helpers and formatters. No IO. Prefer the named files first. Name each file `<name>.<kind>.ts`, where kind is `utils`, `config` or `errors` (`questionsTable.utils.ts`, `projects.config.example.ts`, `channel.errors.ts`); a folder needing only one file of a kind may use the bare `utils.ts`, `config.ts` or `errors.ts`. |
| `__tests__/` | Tests, fixtures and test helpers. One test file per source file (`domain.ts` → `__tests__/domain.test.ts`); component tests keep `.tsx`. Name test data `<name>.fixtures.ts` and shared render or setup helpers `<name>.test-utils.ts(x)`. |

Entities enforce their invariants, delegating to domain rules when useful. Workflows must not bypass them.

Wiring happens only in the app's composition root (`src/app`, with the thin route files in `src/routes`): it provides live layers and registers routes. Features do not add a `layer.ts`. Framework-required routes and external registration stay thin. Keep frontend imports separate from server implementations and secrets.

### Where IO lives

- IO used by one feature only: that feature's `services/`.
- IO used by more than one feature: `src/shared/<purpose>/`.
- When a feature-local service gains a second user, move it to `src/shared/<purpose>/`.

Provider-specific detail stays inside the service's live implementation. A feature never creates an SDK client, database client or API wrapper itself, and never reads `process.env` or secrets directly. If a service owns a resource, its live implementation defines how it is released (Effect scopes, layers or `Effect.acquireRelease`).

### Where shared code lives

- Shared technical code: `src/shared/<purpose>/`, for example `src/shared/hooks/` for generic, domain-free React hooks. Generic, domain-free UI components: `src/components/`. Shared code never depends on features. Domain types shared by several features usually mean a feature boundary is wrong; flag it rather than moving them to `shared/`.

### React hooks

- Pure logic is not a hook. A function that does not use React state, effects, refs or lifecycle is a plain function in `domain.ts`, a workflow or `lib/`. Move heavy derivation out of components, or compute it in the read model, and leave components as thin rendering.
- A hook lives in `ui/`. The feature's main hook holds React state and runs a workflow; the loading, saving and service calls belong to the workflow.
- A hook that serves one component sits beside it. Generic hooks go in `src/shared/hooks/`.
- A hook performing IO goes through a workflow and a service contract, never `fetch`, an SDK client or `process.env`.

### Dependency direction

```text
domain         imports nothing from the feature
workflows      import domain and service contracts, never live implementations
services       import domain for mapping, plus infrastructure libraries
subscriptions  same rules as workflows
ui             imports domain; runs workflows through hooks
index.ts       imports workflows and domain; never services directly
app root       imports everything; the only place wiring happens
```

Downward only. A violation is a finding to fix, not just a file to move.

### Where does this code go?

Ask in order and stop at the first yes:

1. Do two instances with identical fields count as the same thing? A value object in `domain`. Otherwise it has identity: does it save on its own (an entity in `domain`) or only through a parent (it lives beside its parent)? Reference other entities by ID, never by holding the instance.
2. Is it a rule about one object's own state? A method on that entity or value object. A rule spanning several objects? A pure function in `domain`; the caller loads the data. A "rule" that does IO is a workflow.
3. Is it a past-tense fact that something outside the feature reacts to? An event in `domain`. If nothing reacts to it, it is not an event: make the follow-up a direct call, or delete it.
4. Is it a failure the business would name ("slug already taken")? A domain error. Timeouts and 500s are service or `index.ts` errors.
5. Is it one intention a user can express? A workflow.
6. Does it return JSX, or hold React state? `ui/`.
7. Does it react to another feature's event? `subscriptions.ts`.
8. Does it touch a database, network, filesystem or clock? A service: the feature's `services/` if only this feature uses it, otherwise `src/shared/<purpose>/`.
9. Does it parse untrusted input, serialise a reply or map errors to status codes? `index.ts`.
10. Is it a query-only shape with no invariants? A read model in `domain`.
11. Is it technical code used by several features? `src/shared/<purpose>/`.
12. None of the above? `lib/` if it is pure, otherwise `other/` (see below).

### Legacy names

Older features still use these. Do not create them in new code.

| Legacy | Becomes |
| --- | --- |
| `inbound.ts`, `controller.ts` as an HTTP or route entry | `index.ts` |
| `capabilities.ts`, `helpers.ts` as use cases, `controller.ts` as the feature hook | `workflows/`, with the hook in `ui/` |
| `constraints.ts` | pure rules in `domain.ts` (`domain/<name>.rules.ts` once it grows) |
| `components/` | `ui/` |
| feature-local `services.ts` | `services/<name>.ts` |
| `tests/` | `__tests__/` |
| `src/lib/` | `src/shared/<purpose>/` (`src/lib/hooks/` becomes `src/shared/hooks/`) |

## File growth

- Aim for roughly 200 lines per file. Keep a larger file only when it is one cohesive unit and splitting it would make it harder to read.
- When a file grows, replace it with a same-named folder containing `index.ts`. Extract the most semantically isolated concept into a named sibling file; repeat as needed.
- Apply this recursively to features, domain code, workflows, services, helpers and utilities. A feature-local service starts as one file holding its contract, stub layer and live layer; when it grows it becomes a folder with `index.ts` (the contract and its layers), `handlers/` for each operation and `lib/` for its helpers, as `services/discord/` does.
- When a folder holds three files of the same kind suffix, move them into a folder named for the kind (`lib/utils/`, `domain/rules/`). Files keep their suffix, and the kind folder gets no `index.ts`; import each file directly. Two files of a kind stay where they are.

Start:

```text
workflows/
  harvestQuestions.ts
```

As `harvestQuestions.ts` grows:

```text
workflows/
  harvestQuestions/
    index.ts
    helpers.ts
    lib/
      errors.ts
      utils.ts
      config.ts
```

As `helpers.ts` or `utils.ts` grows:

```text
workflows/
  harvestQuestions/
    index.ts
    helpers/
      index.ts
      readChannel.ts
      keepQuestions.ts
    lib/
      errors.ts
      utils/
        index.ts
        formatDate.ts
      config.ts
```

- Create supporting files only when needed; these trees are examples, not required scaffolding.
- Keep indexes cohesive and small. Avoid redundant nesting and arbitrary splits.
- Preserve public exports and follow the project's import-resolution conventions.

## Exceptions

Use `other/` at the nearest meaningful level when code does not fit. Use descriptive filenames and include a short README explaining the mismatch and any proposed structural change. Mention additions in the completion summary so the structure can be reviewed.

## Tautological tests considered harmful

A tautological test is one that cannot fail when the code is wrong. It restates the implementation, asserts against a value it just computed the same way, or mocks the thing it claims to test. It adds a green tick and no evidence.

Common shapes:

- Asserting a function returns `x` after mocking it to return `x`.
- Copying the production formula into the test and comparing the two outputs.
- `expect(result).toEqual(result)` variants — snapshotting whatever the code produced and calling it expected.
- Checking that a mock was called, when the behaviour being tested is what the call _does_.

Every test must be able to fail. Before committing, ask: what plausible bug would turn this red? If the answer is "none", delete it or rewrite it against a hand-written expected value derived from the spec, not from the code.

## Test at the lowest level that can go red

Place each test at the cheapest level where the bug it guards against would turn it red:

| The behaviour is… | Its test lives in… |
| --- | --- |
| A rule, calculation or state transition | a unit test beside `domain.ts` |
| An entry point's contract: reply, status, refusal | an `index.ts` test against fake service Layers |
| What a component renders for a given state, and what it sends | a component test (Vitest + Testing Library) |
| A user journey that needs a real browser and the full stack | a Playwright spec in `e2e/` |

A Playwright spec proves a **journey**: real navigation across routes, cross-feature wiring (a change here shows up there), or layout that jsdom cannot measure. Edge cases, refusals and variations of a journey belong one level down; the spec keeps the happy path.

## Where this file and a spec differ

This file sets the floor for tests: a spec's testing section may add tests, not remove them.

## Mutation testing at review time

Run `pnpm mutate:changed` (Stryker on the source files changed since the merge-base with `origin/main`) when reviewing. Kill every survivor with a test, or say why it is equivalent.

## Clickable surfaces must look clickable

Anything the user is meant to click — buttons, links, rows, cards, chips, icons, table cells that open something — must:

1. Show `cursor: pointer` on hover. No exceptions. A `<div onClick>` with the default arrow cursor is a bug.
2. Give a gentle visual reaction on hover and/or press: a background tint, a border, an underline, a subtle colour shift. It should be noticeable, not loud.

Native `<button>` and `<a href>` get the cursor for free in most setups, so prefer them; if a non-native element takes a click handler, add the cursor and hover state alongside it in the same change. Disabled controls should drop both, so the absence of affordance also carries meaning.

## Comments say only what the code cannot

A comment earns its place by carrying something a reader cannot get from the code in front of them: the reason a choice was made, a constraint from outside the file, a ceiling or trade-off, a link to the issue or plan that motivated it.

Delete any claim a reader can derive from the code: what a function does when its name and body already say so, what a variable holds, that a loop iterates, that a branch handles the case its condition names. Restating the code in prose gives the reader two things to keep in sync and no new information.

Keep what survives short. One or two lines, close to the thing it explains. If the explanation needs a paragraph, that is a sign the code needs a better name or a smaller shape, not a longer comment.

Good:

```ts
// Two spaces: a single-space project redirects to its space route.
spaces: [makeSpace("site-a"), makeSpace("site-b")],
```

Avoid:

```ts
// Create two spaces and assign them to the spaces array.
spaces: [makeSpace("site-a"), makeSpace("site-b")],
```
