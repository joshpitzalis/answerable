import { describe, expect, it } from "vitest";

import {
  describeJson,
  probe,
  tokenFromEnv,
} from "../../../scripts/discordProbe.mjs";

const ENV = "OTHER=1\nDISCORD_BOT_TOKEN=secret-token-abc\n";

/** A fetch that answers every request with `body`, and records what it was asked. */
const stubFetch = (status: number, body: string) => {
  const requests: { url: string; init: RequestInit | undefined }[] = [];

  const fetchFn: typeof globalThis.fetch = (input, init) => {
    requests.push({ init, url: String(input) });

    return Promise.resolve(new Response(body, { status }));
  };

  return { fetchFn, requests };
};

describe(describeJson, () => {
  it("names the type of a primitive and the length of a string", () => {
    expect(describeJson("hello")).toBe("string(5)");
    expect(describeJson("")).toBe("string(0)");
    expect(describeJson(12)).toBe("number");
    expect(describeJson(true)).toBe("boolean");
    expect(describeJson(null)).toBe("null");
  });

  it("describes nested objects by their keys, never their values", () => {
    expect(
      describeJson({
        author: { id: "user-1234", username: "ada", avatar: null },
        content: "a".repeat(300),
        pinned: false,
        reactions: 3,
      })
    ).toStrictEqual({
      author: { avatar: "null", id: "string(9)", username: "string(3)" },
      content: "string(300)",
      pinned: "boolean",
      reactions: "number",
    });
  });

  it("gives an array's length and the shape of its first item", () => {
    expect(describeJson([])).toStrictEqual({ length: 0 });
    expect(describeJson([{ id: "x1" }, { id: "x2" }, 7])).toStrictEqual({
      first: { id: "string(2)" },
      length: 3,
    });
    expect(describeJson([[null]])).toStrictEqual({
      first: { first: "null", length: 1 },
      length: 1,
    });
  });

  it("does not reveal a string's text", () => {
    expect(
      JSON.stringify(describeJson({ name: "Invented Person" }))
    ).not.toContain("Invented");
  });
});

describe(tokenFromEnv, () => {
  it("reads the token, with or without quotes or export", () => {
    expect(tokenFromEnv("DISCORD_BOT_TOKEN=abc")).toBe("abc");
    expect(tokenFromEnv('DISCORD_BOT_TOKEN="abc"')).toBe("abc");
    expect(tokenFromEnv("DISCORD_BOT_TOKEN='abc'")).toBe("abc");
    expect(tokenFromEnv("export DISCORD_BOT_TOKEN = abc ")).toBe("abc");
    expect(tokenFromEnv("export   DISCORD_BOT_TOKEN=abc")).toBe("abc");
  });

  it("strips quotes only when they wrap the whole value", () => {
    expect(tokenFromEnv('DISCORD_BOT_TOKEN=ab"cd"')).toBe('ab"cd"');
    expect(tokenFromEnv('DISCORD_BOT_TOKEN="abc"def')).toBe('"abc"def');
    expect(tokenFromEnv("DISCORD_BOT_TOKEN='abc\"")).toBe("'abc\"");
  });

  it("finds nothing when the token is missing or empty", () => {
    expect(tokenFromEnv("OTHER=1\n")).toBeNull();
    expect(tokenFromEnv("DISCORD_BOT_TOKEN=\n")).toBeNull();
    expect(tokenFromEnv("NOT_DISCORD_BOT_TOKEN=abc")).toBeNull();
  });
});

describe(probe, () => {
  it("sends one GET with the raw token and prints the status and structure only", async () => {
    const wire = stubFetch(
      200,
      JSON.stringify([{ content: "private words", id: "123456" }])
    );

    const result = await probe(
      ["/channels/1/messages?limit=1"],
      ENV,
      wire.fetchFn
    );

    expect(
      wire.requests.map(({ init, url }) => ({
        authorization: new Headers(init?.headers).get("Authorization"),
        method: init?.method,
        url,
      }))
    ).toStrictEqual([
      {
        authorization: "secret-token-abc",
        method: "GET",
        url: "https://discord.com/api/v9/channels/1/messages?limit=1",
      },
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.lines[0]).toBe("status 200");
  });

  it("never prints content, ids or the token", async () => {
    const wire = stubFetch(
      200,
      JSON.stringify([{ content: "private words", id: "123456" }])
    );

    const result = await probe(["/x"], ENV, wire.fetchFn);
    const printed = result.lines.join("\n");

    expect(printed).toContain("string(13)");
    expect(printed).not.toContain("private words");
    expect(printed).not.toContain("123456");
    expect(printed).not.toContain("secret-token-abc");
  });

  it("prints a Discord error's code and message", async () => {
    const wire = stubFetch(
      403,
      JSON.stringify({ code: 50_001, message: "Missing Access" })
    );

    const result = await probe(["/channels/1"], ENV, wire.fetchFn);

    expect(result.exitCode).toBe(1);
    expect(result.lines.slice(0, 2)).toStrictEqual([
      "status 403",
      "error code 50001: Missing Access",
    ]);
  });

  it("does not treat a successful body with a code field as an error", async () => {
    const wire = stubFetch(200, JSON.stringify({ code: 1, message: "hi" }));

    const result = await probe(["/x"], ENV, wire.fetchFn);

    expect(result.lines.join("\n")).not.toContain("error code");
  });

  it("prints a JSON null body as null, not as a failure to read it", async () => {
    const result = await probe(["/x"], ENV, stubFetch(403, "null").fetchFn);

    expect(result.lines).toStrictEqual(["status 403", '"null"']);
  });

  it("prints an error line only for a body with a numeric code and a string message", async () => {
    const bodies = [
      "null",
      '"text"',
      "5",
      "[1]",
      '{"code":1}',
      '{"message":"m"}',
      '{"code":"1","message":"m"}',
      '{"code":1,"message":5}',
    ];

    for (const body of bodies) {
      // oxlint-disable-next-line no-await-in-loop -- sequential cases
      const result = await probe(["/x"], ENV, stubFetch(403, body).fetchFn);

      expect(
        result.lines.filter((line) => line.startsWith("error"))
      ).toStrictEqual([]);
      expect(result.lines[0]).toBe("status 403");
    }
  });

  it("says so when the body is not JSON, without printing it", async () => {
    const wire = stubFetch(500, "upstream exploded");

    const result = await probe(["/x"], ENV, wire.fetchFn);

    expect(result.exitCode).toBe(1);
    expect(result.lines).toStrictEqual([
      "status 500",
      "body is not JSON (17 characters)",
    ]);
  });

  it("makes no request without a token", async () => {
    const wire = stubFetch(200, "[]");

    for (const env of [null, "OTHER=1\n"]) {
      // oxlint-disable-next-line no-await-in-loop -- sequential cases
      const result = await probe(["/x"], env, wire.fetchFn);

      expect(result.exitCode).toBe(1);
      expect(result.lines).toStrictEqual([
        "No DISCORD_BOT_TOKEN in .env. No request was made.",
      ]);
    }

    expect(wire.requests).toHaveLength(0);
  });

  it("refuses a path that does not start with a slash, or extra arguments, and makes no request", async () => {
    const wire = stubFetch(200, "[]");

    const cases = [
      [],
      ["channels/1"],
      ["https://example.com/x"],
      ["/x", "POST"],
    ];

    for (const args of cases) {
      // oxlint-disable-next-line no-await-in-loop -- sequential cases
      const result = await probe(args, ENV, wire.fetchFn);

      expect(result.exitCode).toBe(2);
      expect(result.lines).toStrictEqual([
        'Usage: node scripts/discord-probe.mjs "/channels/<id>/messages?limit=1"',
        "One path starting with /, no other options. GET only.",
      ]);
    }

    expect(wire.requests).toHaveLength(0);
  });
});
