// Fails when the owner's private Project values (Discord server ids, Channel
// ids, display names from the gitignored projects.config.ts) appear in tracked
// or staged files. The config is parsed as text: it is a simple literal file.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import nodePath from "node:path";

const CONFIG = "src/features/question-finder/lib/projects.config.ts";
const EXAMPLE = "src/features/question-finder/lib/projects.config.example.ts";
const MIN_LENGTH = 6;

const KINDS = {
  serverId: "serverId",
  id: "channel id",
  ownerName: "ownerName",
};

const FIELD =
  /\b(?<field>serverId|id|ownerName)\s*:\s*(?<quote>["'`])(?<value>[^"'`]*)\k<quote>/gu;

/** Map of `value -> kind` for every watched field in a config's text. */
const readFields = (text) => {
  const found = new Map();

  for (const match of text.matchAll(FIELD)) {
    found.set(match.groups.value, KINDS[match.groups.field]);
  }

  return found;
};

/** Private values: in the local config, absent from the example, long enough. */
export const extractPrivateValues = (configText, exampleText) => {
  const example = readFields(exampleText);
  const privateValues = new Map();

  for (const [value, kind] of readFields(configText)) {
    if (value.length >= MIN_LENGTH && !example.has(value)) {
      privateValues.set(value, kind);
    }
  }

  return privateValues;
};

/** Every occurrence as `{ path, line, kind }`; never the matched text. */
export const findLeaks = (privateValues, files) => {
  const leaks = [];

  for (const { path, text } of files) {
    const lines = text.split("\n");

    for (const [index, content] of lines.entries()) {
      for (const [value, kind] of privateValues) {
        if (content.includes(value)) {
          leaks.push({ path, line: index + 1, kind });
        }
      }
    }
  }

  return leaks;
};

const git = (root, ...args) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "buffer",
    maxBuffer: 256 * 1024 * 1024,
  });

const names = (root, ...args) =>
  git(root, ...args, "-z")
    .toString("utf-8")
    .split("\0")
    .filter((name) => name !== "");

const asText = (buffer) =>
  buffer.includes(0) ? undefined : buffer.toString("utf-8");

const collectFiles = (root) => {
  const files = [];

  for (const path of names(root, "ls-files")) {
    const full = nodePath.join(root, path);

    if (existsSync(full)) {
      files.push({ path, text: asText(readFileSync(full)) });
    }
  }

  const staged = names(
    root,
    "diff",
    "--cached",
    "--name-only",
    "--diff-filter=ACM"
  );

  for (const path of staged) {
    files.push({
      path: `${path} (staged)`,
      text: asText(git(root, "show", `:${path}`)),
    });
  }

  return files.filter((file) => file.text !== undefined);
};

/** Returns `{ code, messages }`; the caller prints and exits. */
export const run = (root) => {
  const configPath = nodePath.join(root, CONFIG);

  if (!existsSync(configPath)) {
    return {
      code: 0,
      messages: [
        "check:private: no local projects.config.ts, nothing to check.",
      ],
    };
  }

  const privateValues = extractPrivateValues(
    readFileSync(configPath, "utf-8"),
    readFileSync(nodePath.join(root, EXAMPLE), "utf-8")
  );

  const leaks = findLeaks(privateValues, collectFiles(root));

  if (leaks.length === 0) {
    return {
      code: 0,
      messages: [
        `check:private: ${privateValues.size} private values, none found in tracked or staged files.`,
      ],
    };
  }

  return {
    code: 1,
    messages: [
      "check:private: private Project values found in tracked or staged files:",
      ...leaks.map(
        (leak) => `  ${leak.path}:${leak.line} contains a private ${leak.kind}`
      ),
      "Replace them with the placeholders from projects.config.example.ts.",
    ],
  };
};

if (process.argv[1] === import.meta.filename) {
  const root = git(process.cwd(), "rev-parse", "--show-toplevel")
    .toString("utf-8")
    .trim();

  const { code, messages } = run(root);
  console.log(messages.join("\n"));
  process.exitCode = code;
}
