import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { test } from "node:test";

test("private-check tests cannot mutate the repository inherited from a Git hook", () => {
  const env = { ...process.env };
  // A nested test runner must execute the child suite, not inherit this worker's IPC mode.
  delete env.NODE_TEST_CONTEXT;

  const localVariables = execFileSync(
    "git",
    ["rev-parse", "--local-env-vars"],
    {
      encoding: "utf-8",
    }
  )
    .trim()
    .split("\n");

  for (const name of localVariables) {
    Reflect.deleteProperty(env, name);
  }

  const outer = mkdtempSync(nodePath.join(tmpdir(), "private-hook-"));
  const git = (...args) => execFileSync("git", args, { cwd: outer, env });

  try {
    git("init", "-q");
    writeFileSync(nodePath.join(outer, "sentinel"), "outer repository\n");
    git("add", "sentinel");
    git(
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-qm",
      "sentinel"
    );
    const head = git("rev-parse", "HEAD");
    const config = readFileSync(nodePath.join(outer, ".git/config"));
    const index = readFileSync(nodePath.join(outer, ".git/index"));

    const result = spawnSync(
      process.execPath,
      ["--test", nodePath.join(import.meta.dirname, "check-private.test.mjs")],
      {
        cwd: outer,
        env: {
          ...env,
          GIT_DIR: nodePath.join(outer, ".git"),
          GIT_WORK_TREE: outer,
          GIT_COMMON_DIR: nodePath.join(outer, ".git"),
          GIT_INDEX_FILE: nodePath.join(outer, ".git/index"),
          GIT_OBJECT_DIRECTORY: nodePath.join(outer, ".git/objects"),
          GIT_CONFIG_COUNT: "1",
          GIT_CONFIG_KEY_0: "core.bare",
          GIT_CONFIG_VALUE_0: "true",
        },
        encoding: "utf-8",
      }
    );

    assert.deepEqual(git("rev-parse", "HEAD"), head, "outer HEAD changed");
    assert.deepEqual(
      readFileSync(nodePath.join(outer, ".git/config")),
      config,
      "outer config changed"
    );
    assert.deepEqual(
      readFileSync(nodePath.join(outer, ".git/index")),
      index,
      "outer index changed"
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /run passes without a local config/u);
  } finally {
    rmSync(outer, { recursive: true, force: true });
  }
});
