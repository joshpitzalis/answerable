# AGENTS.md

Project-specific guidance for AI coding agents.

## Coding standards

Read [CODING_STANDARDS.md](CODING_STANDARDS.md) before adding, moving, testing or reviewing code: feature layout under `src/features/`, where each kind of code goes, file growth, tests, clickable surfaces and comments.

## Lint and format: Ultracite (oxlint + oxfmt)

- `pnpm fix` formats and autofixes; `pnpm check` verifies.
- Review every autofix diff. Autofixes can change behaviour: one put `new` before `Schema.TaggedError<X>()(...)`.
- Rule overrides live in `oxlint.config.ts`, each with its reason. A rule that fights an Effect idiom or CODING_STANDARDS.md gets an override there; a one-off exception gets `// oxlint-disable-next-line <rule> -- <reason>`.
- `tools/oxlint/anti-slop/` is vendored from [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) (generic and Effect rules) and is ours to edit; record changes in its `UPSTREAM.md`. Keep `@oxlint/plugins` pinned to the exact `oxlint` version.
- Fix anti-slop findings in the code: parse at the boundary, use `Match`, use tagged constructors. Casts and suppressions are not fixes.

## Tests and verify

- Run the `verify` skill before every `git push`: `pnpm verify` chains `pnpm check`, `pnpm types`, `pnpm test` and `pnpm e2e`, and must exit 0.
- `pnpm test` is Vitest over `src/**/__tests__/*.test.ts(x)`. `pnpm e2e` is Playwright over `e2e/*.spec.ts`, served by `alchemy dev` with `e2e/e2e.env`, which leaves the Discord token unset so pages show fixture data.
- After writing or changing tests, run Stryker on the files under test: `pnpm mutate --mutate "src/path/file.ts"`. Kill every surviving mutant with a test, or say why it is equivalent. A full `pnpm mutate` takes about 9 minutes; the report lands in `reports/mutation/index.html`.
- Fake at a seam the code already has: a service contract (`Layer.succeed(Discord, Discord.of({...}))`) or an injected function (`listMessages(path, token, fetch)`). Module mocking is lint-banned.
- Vitest aliases `cloudflare:workers` to an empty `env` (`src/shared/testing/cloudflareWorkers.ts`), so code that reads bindings gets stub services.

## XState v6 (beta)

- `xstate` and `@xstate/react` are pinned to exact beta versions. v6 is not v5: read [docs/agents/xstate-v6.md](docs/agents/xstate-v6.md) and the docs shipped in `node_modules/xstate/docs/` before writing a machine. Old v5 event keys are accepted and silently never fire.
- Machines own flow and state; Effect services do the outside work, invoked through `workflows/fromEffect.ts` ([ADR 0001](docs/adr/0001-xstate-orchestrates-effect-services.md)). No Effect import may be reachable from the browser.
- A beta newer than pnpm's release-age window needs its exact version under `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`. Check its npm provenance first.

## Projects config

- The owner's real Discord servers, Channels and display names live in `src/features/question-finder/lib/projects.config.ts`, which is gitignored. Never commit it or copy its values into tracked files, tests, fixtures, commit messages or PR text.
- `projects.config.example.ts` beside it is the committed template and the stand-in when no local file exists. With no Discord token bound the server always uses the example Projects, because the stub fixture keys off their ids. Tests import the example, never the local file.

## Cloudflare via Alchemy

- `alchemy.run.ts` is the single source of infrastructure: the Worker, its bindings and its secrets. There is no `wrangler.jsonc`.
- `pnpm dev` runs `alchemy dev` against real Cloudflare resources. `pnpm exec alchemy plan` previews. Ask the user before `pnpm deploy` or `pnpm destroy`.
- Builds go through Alchemy, which injects the Cloudflare Vite plugin; bare `vite build` fails on `cloudflare:workers`, and `@cloudflare/vite-plugin` in `vite.config.ts` conflicts.
- New binding: declare it under `env` in `alchemy.run.ts`. `src/env.d.ts` types `import { env } from "cloudflare:workers"` from that declaration.
- Read `env` inside a handler or a lazily built layer, from server-only modules. At module scope it throws on the Worker; in the client bundle it does not resolve.
- Secrets: `Config.Redacted("NAME")` in `alchemy.run.ts`, value in the gitignored `.env`.
- Alchemy is a v2 beta built on Effect and its API moves: look it up at https://alchemy.run/llms.txt. For Workers platform limits and APIs, use https://developers.cloudflare.com/workers/.

<!-- ASTRYX:START -->
Astryx v0.4.2 · 156 components
CLI: run every command as `pnpm exec astryx <cmd>` (shown below as `astryx ...`).

SETUP (once, in your app entry e.g. main.tsx) — without these, components render unstyled:
  import "@astryxdesign/core/reset.css";
  import "@astryxdesign/core/astryx.css";

WORKFLOW — discover, don't guess. Before writing UI:
1. `astryx build "<idea>"` — START HERE: returns a kit (closest [page] + [block]s + [component]s). No args = full playbook.
2. `astryx template <name> [--skeleton]` — scaffold the [page]/[block]s it named, or study their layout. Templates are reference code.
3. `astryx component <Name>` — props + examples for every component you use.

RULES:
- No <div> — components do all layout/spacing, page frame included.
- Frame first: read `astryx docs layout` before writing any page or screen — page frame, region widths, breakpoint behavior.
- Dense data = rows (Table, List/Item), never Card-wrapped list items; Card is for standalone widgets. Status = StatusDot/Token; Badge = counts only.
- Custom styling: component props first; else Tailwind utilities backed by tokens (bg-surface, text-primary, rounded-lg) via tailwind-theme.css. No raw hex/px.
- Tokens for every value (`astryx docs tokens`). Brand/accent belongs in the theme (`astryx theme list` / `theme add <slug>`, or `astryx theme template` for a custom one) — never override --color-* in :root.
- SELF-CHECK before you finish: re-read the file and replace any style={{…}}, raw <div>/<span> layout, imported .css/@apply, or hardcoded/arbitrary value (e.g. bg-[#fff], p-[13px]) with the component or a token-backed utility. If unsure a component/prop exists, run `astryx component <Name>` / `astryx search "<thing>"`; don't hand-roll CSS.

MORE CLI:
  search "<query>"   find any component / hook / doc / template / block
  component --list   156 components by category
  template --list    page + block recipes
  docs <topic>       color, elevation, icons, illustrations, internationalization, layout, migration, motion, principles, shape, spacing, styling, theme, tokens, typography
  swizzle <Name>     eject component source for deep customization
  upgrade --apply    run after any @astryxdesign/core bump
<!-- ASTRYX:END -->
