import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { runViteBuildChild } from "@alchemy.run/cloudflare/Workers/ViteChild";
import { PlatformServices } from "alchemy/Util/PlatformServices";
import * as Effect from "effect/Effect";

import { workerBuild } from "../src/app/worker.config.ts";

const result = await Effect.runPromise(
  runViteBuildChild(
    {
      ...workerBuild,
      rootDir: process.cwd(),
      env: {},
      viteEnvironments: undefined,
    },
    (_channel, line) => Effect.sync(() => console.log(line))
  ).pipe(Effect.provide(PlatformServices))
);

assert.ok(result.serverBundle, "Alchemy must produce a Worker bundle");

const entry = Buffer.from(result.serverBundle.files[0].content).toString(
  "utf-8"
);

assert.ok(
  /export\s*\{[^}]*ProjectHarvest[^}]*\}/u.test(entry),
  "Worker bundle must export ProjectHarvest"
);

assert.ok(
  /export\s*\{[^}]*default[^}]*\}/u.test(entry),
  "Worker bundle must retain the Start default export"
);

assert.ok(result.clientDirectory);

const { clientDirectory } = result;
const clientFiles = await readdir(clientDirectory, { recursive: true });

await Promise.all(
  clientFiles.map(async (file) => {
    if (file.endsWith(".js")) {
      const content = await readFile(path.join(clientDirectory, file), "utf-8");
      assert.ok(
        !/cloudflare:workers|app\/ProjectStorage|effect\/|~effect/u.test(
          content
        ),
        "Client bundle must exclude Worker/Effect runtime code"
      );
    }
  })
);

console.log(
  "Alchemy Worker exports ProjectHarvest and Start; client output excludes Worker storage."
);

// The bundled entry's pool exits between files; independent processes retain real native RPC coverage.
for (const test of [
  "projectHarvest",
  "scheduledHarvest",
  "durableHarvestJourney",
]) {
  const proof = spawnSync(
    "pnpm",
    [
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.workers.config.ts",
      `src/app/__tests__/${test}.workers.test.ts`,
      "--maxWorkers",
      "1",
    ],
    {
      stdio: "inherit",
      env: { ...process.env, PROJECT_WORKER_ENTRY: "./dist/server/index.js" },
    }
  );

  assert.equal(proof.status, 0, `The built Worker must pass ${test}`);
}
