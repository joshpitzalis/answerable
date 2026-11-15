import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { DiscordFailed, DiscordRateLimited } from "../../lib/errors";
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

    expect(failure).toStrictEqual(
      new DiscordFailed({ reason: "GET /channels/1/messages returned 401" })
    );
  });

  it("reports a rate limit with the delay Discord's body asks for, in milliseconds", async () => {
    const failure = await failureOf(
      respondWith(
        Response.json(
          { global: false, message: "rate limited", retry_after: 2.5 },
          { status: 429 }
        )
      )
    );

    expect(failure).toStrictEqual(
      new DiscordRateLimited({ retryAfterMs: 2500 })
    );
    expect(failure._tag).toBe("DiscordRateLimited");
  });

  it("does not read a delay out of a failure that is not a 429", async () => {
    const failure = await failureOf(
      respondWith(
        Response.json(
          { message: "oops", retry_after: 2.5 },
          { headers: { "Retry-After": "3" }, status: 500 }
        )
      )
    );

    expect(failure).toStrictEqual(
      new DiscordFailed({ reason: "GET /channels/1/messages returned 500" })
    );
    expect(failure._tag).toBe("DiscordFailed");
  });

  it("falls back to the Retry-After header when the body has no delay", async () => {
    const failure = await failureOf(
      respondWith(
        new Response("slow down", {
          headers: { "Retry-After": "3" },
          status: 429,
        })
      )
    );

    expect(failure).toStrictEqual(
      new DiscordRateLimited({ retryAfterMs: 3000 })
    );
  });

  it("treats a 429 that names no delay as an ordinary failure", async () => {
    const failure = await failureOf(
      respondWith(new Response("slow down", { status: 429 }))
    );

    expect(failure).toStrictEqual(
      new DiscordFailed({ reason: "GET /channels/1/messages returned 429" })
    );
  });

  it("fails on a body that is not a list of messages", async () => {
    const failure = await failureOf(
      respondWith(Response.json({ message: "unexpected" }))
    );

    expect(failure).toBeInstanceOf(DiscordFailed);
  });

  it("reports a network failure", async () => {
    const failure = await failureOf(() => Promise.reject(new Error("offline")));

    expect(failure).toStrictEqual(
      new DiscordFailed({ reason: "Error: offline" })
    );
  });
});
