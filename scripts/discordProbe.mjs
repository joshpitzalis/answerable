/**
 * The read-only Discord inspector's logic, apart from the network and the disk
 * so a test can run it. It reports the STRUCTURE of a response, never its
 * content: no token, no message text, no names, no ids.
 */

/* oxlint-disable anti-slop/no-runtime-typeof -- this module's whole job is to look at JSON of unknown shape and name its types */

const API = "https://discord.com/api/v9";

/**
 * The shape of a JSON value as plain data: a string is `string(<length>)`, other
 * primitives are their type name, an object maps each key to the shape of its
 * value, and an array is its length plus the shape of its first item.
 */
export const describeJson = (value) => {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return `string(${value.length})`;
  }

  if (Array.isArray(value)) {
    return value.length === 0
      ? { length: 0 }
      : { first: describeJson(value[0]), length: value.length };
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, describeJson(inner)])
    );
  }

  return typeof value;
};

/** The value of `DISCORD_BOT_TOKEN` in the text of a `.env` file, or `null`. */
export const tokenFromEnv = (envText) => {
  for (const line of envText.split("\n")) {
    const match =
      /^\s*(?:export\s+)?DISCORD_BOT_TOKEN\s*=\s*(?<value>.*?)\s*$/u.exec(line);

    if (match?.groups !== undefined) {
      const token = match.groups.value.replace(
        /^(?<quote>["'])(?<inner>.*)\k<quote>$/u,
        "$<inner>"
      );

      return token === "" ? null : token;
    }
  }

  return null;
};

const isDiscordError = (body) =>
  body !== null &&
  typeof body.code === "number" &&
  typeof body.message === "string";

/**
 * Sends one GET and returns what to print and the exit code. Takes the CLI
 * arguments, the text of `.env` (or `null` when there is none) and a `fetch`.
 */
export const probe = async (args, envText, fetchFn) => {
  const [path, ...extra] = args;

  if (path === undefined || !path.startsWith("/") || extra.length > 0) {
    return {
      exitCode: 2,
      lines: [
        'Usage: node scripts/discord-probe.mjs "/channels/<id>/messages?limit=1"',
        "One path starting with /, no other options. GET only.",
      ],
    };
  }

  const token = envText === null ? null : tokenFromEnv(envText);

  if (token === null) {
    return {
      exitCode: 1,
      lines: ["No DISCORD_BOT_TOKEN in .env. No request was made."],
    };
  }

  const response = await fetchFn(`${API}${path}`, {
    headers: { Authorization: token },
    method: "GET",
  });

  const text = await response.text();
  const lines = [`status ${response.status}`];

  try {
    const body = JSON.parse(text);

    if (!response.ok && isDiscordError(body)) {
      lines.push(`error code ${body.code}: ${body.message}`);
    }

    lines.push(JSON.stringify(describeJson(body), null, 2));
  } catch {
    lines.push(`body is not JSON (${text.length} characters)`);
  }

  return { exitCode: response.ok ? 0 : 1, lines };
};
