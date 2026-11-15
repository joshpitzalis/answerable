#!/usr/bin/env node
// Read-only Discord inspector: one GET, prints the structure of the response.
// Usage: node scripts/discord-probe.mjs "/channels/<id>/messages?limit=1"
import { readFileSync } from "node:fs";

import { probe } from "./discordProbe.mjs";

const readEnv = () => {
  try {
    return readFileSync(".env", "utf-8");
  } catch {
    return null;
  }
};

const { exitCode, lines } = await probe(
  process.argv.slice(2),
  readEnv(),
  fetch
);

process.stdout.write(`${lines.join("\n")}\n`);

process.exitCode = exitCode;
