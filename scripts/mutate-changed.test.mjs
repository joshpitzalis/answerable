import assert from "node:assert/strict";
import { test } from "node:test";

import { selectMutatable } from "./mutate-changed.mjs";

test("keeps only what stryker.config.json mutates, sorted and unique", () => {
  const selected = selectMutatable([
    "src/features/a/lib/b.ts",
    "src/features/a/ui/C.tsx",
    "src/features/a/lib/b.ts",
    "src/features/a/lib/__tests__/b.test.ts",
    "src/env.d.ts",
    "src/routeTree.gen.ts",
    "src/shared/testing/cloudflareWorkers.ts",
    "e2e/home.spec.ts",
    "scripts/mutate-changed.mjs",
    "src/styles.css",
    "docs/note.ts",
  ]);

  assert.deepEqual(selected, [
    "src/features/a/lib/b.ts",
    "src/features/a/ui/C.tsx",
  ]);
});

test("nothing mutatable gives an empty list", () => {
  assert.deepEqual(selectMutatable(["README.md", "package.json"]), []);
});
