# Implementer rules

Working rules for a subagent implementing a ticket in this repo. The orchestrator's brief supplies the ticket, the integration branch name and the co-author line; everything else is here.

## Start

1. Confirm the worktree is on the integration branch tip: `git rev-parse HEAD` equals `git rev-parse <integration branch>`. If not (worktrees can start at `origin/main`), `git reset --hard <integration branch>`.
2. `pnpm install` once.
3. Read [CODING_STANDARDS.md](../../CODING_STANDARDS.md) and the ticket's spec. Where a spec's testing section and CODING_STANDARDS.md differ, CODING_STANDARDS.md sets the floor.

## Commands

- One plain command per Bash call, run from the worktree root: no `cd`, no chained commands, no heredocs.
- Create and edit files with Write and Edit.
- A hook may rewrite a command into an `rtk ...` form and ask you to re-issue it; do so.
- There is no `build` script. A ticket that says "`pnpm build` passes" means `pnpm verify` passes.

## Checks after the final commit

Run, one per call, and read each exit code directly (a passing `pnpm check` prints only a header):

1. `pnpm fix`, then review its diff; commit anything it changed.
2. `pnpm check`
3. `pnpm types`
4. `pnpm test`
5. `pnpm e2e`, when the change touches UI, routes or the Harvest.

The pre-push hook and CI run `pnpm check`, `pnpm types` and `pnpm test`; e2e is in neither, so it is your check.

## e2e

- `pnpm e2e` serves the app on `E2E_PORT` (default 1338); the dev server uses `DEV_PORT` (default 1337). It runs while a dev server is up.
- `e2e/e2e.env` leaves the Discord token unset, so the app serves the captured fixture and pages show fixture data.

## Never

- `pnpm dev` with the owner's token, `pnpm deploy`, `pnpm destroy`.
- Call the real Discord API. `node scripts/discord-probe.mjs "<api path>"` is the one read-only exception, and only when the ticket says to use it.
- Copy the owner's private Project values (from the gitignored `projects.config.ts`) into tracked files, tests, fixtures, commit messages or reports. `pnpm check:private` fails on them and the pre-commit hook runs it.
- Push.

## Commit and merge

- Every commit message ends with the co-author line the orchestrator supplies.
- Before reporting, merge the integration branch tip into your branch, resolve conflicts, and rerun the checks above.

## Report

- Branch name and tip commit.
- Result of each check (exit code).
- What changed, one line per file group, and anything the ticket asked for that you did not do, with the reason.
- Decisions you made where the ticket was silent.
