# Answerable

Surfaces questions asked in library communities that the owner has not answered yet but could answer from something they have already written.

- [PRODUCT.md](PRODUCT.md): who it is for and what it does
- [GLOSSARY.md](GLOSSARY.md): the project's terms
- [CODING_STANDARDS.md](CODING_STANDARDS.md): code layout and conventions
- [docs/adr/](docs/adr/): architecture decisions

## Getting Started

```bash
pnpm install
pnpm dev
```

`pnpm dev` runs `alchemy dev` against real Cloudflare resources. Secrets are read from the gitignored `.env`.

## Linting & Formatting

This project uses [Ultracite](https://www.ultracite.ai/) (oxlint + oxfmt) for linting and formatting, with the vendored [anti-slop](https://github.com/dmmulroy/anti-slop) rules in `tools/oxlint/anti-slop/`:

```bash
pnpm fix
pnpm check
pnpm types
```

## Testing

```bash
pnpm test     # Vitest unit and component tests
pnpm e2e      # Playwright, starts `alchemy dev` on fixture data
pnpm mutate   # Stryker mutation testing
pnpm verify   # check + types + test + e2e
```

## Deploy to Cloudflare Workers

This project deploys with [Alchemy](https://alchemy.run/); the Worker, its bindings and its secrets are declared in `alchemy.run.ts`:

1. Authenticate once: `pnpm exec alchemy profile edit --add Cloudflare`
2. Preview: `pnpm exec alchemy plan`
3. Deploy: `pnpm deploy`

Secrets are read from `.env` at deploy time and bound to the Worker.
