import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { DiscordFailed } from "../../lib/errors";
import { listMessages } from "../listMessages";

const PATH = "/channels/1/messages";

const respondWith =
  (response: Response): typeof globalThis.fetch =>
  () =>
    Promise.resolve(response);

const failureOf = (fetch: typeof globalThis.fetch) =>
  Effect.runPromise(Effect.flip(listMessages(PATH, "secret", fetch)));

describe(listMessages, () => {
  it("sends the token to the Discord API and decodes the body", async () => {
    const calls: { url: string; authorization: string | null }[] = [];

    const fetch: typeof globalThis.fetch = (input, init) => {
      calls.push({
        authorization: new Headers(init?.headers).get("Authorization"),
        url: String(input),
      });

      return Promise.resolve(
        Response.json([
          {
            author: { username: "ada" },
            channel_id: "1",
            content: "hi",
            id: "9",
            timestamp: "2026-08-10T00:00:00.000+00:00",
          },
        ])
      );
    };

    const messages = await Effect.runPromise(
      listMessages(PATH, "secret", fetch)
    );

    expect(calls).toStrictEqual([
      {
        authorization: "secret",
        url: "https://discord.com/api/v9/channels/1/messages",
      },
    ]);
    expect(messages.map((message) => message.id)).toStrictEqual(["9"]);
  });

  it("names the path and status of a refused request", async () => {
    const failure = await failureOf(
      respondWith(new Response("nope", { status: 401 }))
    );

    expect(failure).toBeInstanceOf(DiscordFailed);
    expect(failure.reason).toBe("GET /channels/1/messages returned 401");
  });

  it("fails on a body that is not a list of messages", async () => {
    const failure = await failureOf(
      respondWith(Response.json({ message: "unexpected" }))
    );

    expect(failure).toBeInstanceOf(DiscordFailed);
  });

  it("reports a network failure", async () => {
    const failure = await failureOf(() => Promise.reject(new Error("offline")));

    expect(failure.reason).toBe("Error: offline");
  });
});
