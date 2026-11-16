// Runs Stryker only on source files changed since the merge-base with
// origin/main (tracked changes plus untracked new files). Usage:
//   pnpm mutate:changed [baseRef]
import { execFileSync, spawnSync } from "node:child_process";

/** Mirrors the `mutate` globs in stryker.config.json. */
export const isMutatable = (file) =>
  /^src\/.*\.tsx?$/u.test(file) &&
  !file.endsWith(".d.ts") &&
  !file.includes("/__tests__/") &&
  file !== "src/routeTree.gen.ts" &&
  !file.startsWith("src/shared/testing/");

/** Sorted, de-duplicated files Stryker would mutate. */
export const selectMutatable = (files) =>
  [...new Set(files.filter(isMutatable))].toSorted();

const lines = (...args) =>
  execFileSync("git", args, { encoding: "utf-8" })
    .split("\n")
    .filter((line) => line !== "");

const main = () => {
  const [base = "origin/main"] = process.argv.slice(2);
  const [mergeBase] = lines("merge-base", "HEAD", base);

  const changed = selectMutatable([
    ...lines("diff", "--name-only", "--diff-filter=ACMR", mergeBase),
    ...lines("ls-files", "--others", "--exclude-standard"),
  ]);

  if (changed.length === 0) {
    console.log(`mutate:changed: no source files changed since ${base}.`);

    return 0;
  }

  console.log(`mutate:changed: ${changed.length} file(s) since ${base}.`);

  // One comma-separated list: repeated --mutate flags do not combine.
  const result = spawnSync(
    "pnpm",
    ["exec", "stryker", "run", "--mutate", changed.join(",")],
    { stdio: "inherit" }
  );

  return result.status ?? 1;
};

if (process.argv[1] === import.meta.filename) {
  process.exitCode = main();
}
