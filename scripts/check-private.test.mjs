import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { test } from "node:test";

import { extractPrivateValues, findLeaks, run } from "./check-private.mjs";

const EXAMPLE = `
export const A = { serverId: "example-server-id", channels: [{ id: "example-channel-1", name: "help" }], ownerName: "example-owner" };
`;

const CONFIG = `
export const A = {
  serverId: "invented-server-9001",
  channels: [{ id: "invented-chan-7", name: "help" }, { id: "example-channel-1", name: "x" }],
  ownerName: "Invented Owner",
};
export const B = { serverId: "short", ownerName: "example-owner" };
`;

test("extracts only values absent from the example and long enough", () => {
  const values = extractPrivateValues(CONFIG, EXAMPLE);

  assert.deepEqual(
    values,
    new Map([
      ["invented-server-9001", "serverId"],
      ["invented-chan-7", "channel id"],
      ["Invented Owner", "ownerName"],
    ])
  );
});

test("reports file, line and kind but not the value", () => {
  const values = extractPrivateValues(CONFIG, EXAMPLE);

  const leaks = findLeaks(values, [
    { path: "a.ts", text: "ok\nconst s = 'invented-server-9001';\n" },
    { path: "b.ts", text: "nothing here" },
  ]);

  assert.deepEqual(leaks, [{ path: "a.ts", line: 2, kind: "serverId" }]);
});

const sh = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: "pipe" });

const put = (root, path, text) => {
  mkdirSync(nodePath.dirname(nodePath.join(root, path)), { recursive: true });
  writeFileSync(nodePath.join(root, path), text);
};

const lib = "src/features/question-finder/lib";

test("run passes without a local config, fails on tracked and staged leaks", () => {
  const root = mkdtempSync(nodePath.join(tmpdir(), "check-private-"));

  try {
    sh(root, "init", "-q");
    put(root, `${lib}/projects.config.example.ts`, EXAMPLE);
    put(root, "clean.ts", "nothing\n");
    sh(root, "add", ".");
    assert.equal(run(root).code, 0);

    put(root, `${lib}/projects.config.ts`, CONFIG);
    assert.equal(run(root).code, 0);

    put(root, "tracked.ts", "x\nconst id = 'invented-chan-7';\n");
    sh(root, "add", "tracked.ts");
    sh(root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "m");
    const tracked = run(root);
    assert.equal(tracked.code, 1);
    assert.ok(tracked.messages.some((m) => m.includes("tracked.ts:2")));
    assert.ok(tracked.messages.every((m) => !m.includes("invented-chan-7")));

    put(root, "tracked.ts", "x\n");
    sh(root, "add", "tracked.ts");
    sh(
      root,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-qm",
      "m2"
    );
    assert.equal(run(root).code, 0);

    put(root, "staged.ts", "Invented Owner\n");
    sh(root, "add", "staged.ts");
    put(root, "staged.ts", "clean now\n");
    const staged = run(root);
    assert.equal(staged.code, 1);
    assert.ok(staged.messages.some((m) => m.includes("staged.ts (staged):1")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
