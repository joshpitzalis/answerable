import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { DiscordFailed } from "../../lib/errors";
import { messagePage } from "../messagePage";

const request = {
  channelId: "800",
  parentChannelId: "800",
  serverId: "700",
  before: null,
  limit: 50,
};

const raw = {
  id: "101",
  channel_id: "800",
  content: "How?",
  timestamp: "2026-11-01T00:00:00Z",
  author: { id: "900", username: "Writer" },
};

const wire =
  ({
    permissions = "66560",
    flags = 262_144,
    messages = [raw],
    overwrites = [],
  }: {
    permissions?: string;
    flags?: number;
    messages?: readonly object[];
    overwrites?: readonly {
      id: string;
      type: number;
      allow: string;
      deny: string;
    }[];
  } = {}): typeof globalThis.fetch =>
  (input) => {
    const path = new URL(String(input)).pathname;

    if (path.endsWith("/applications/@me")) {
      return Promise.resolve(Response.json({ bot: { id: "600" }, flags }));
    }

    if (path.endsWith("/guilds/700")) {
      return Promise.resolve(
        Response.json({ owner_id: "500", roles: [{ id: "700", permissions }] })
      );
    }

    if (path.endsWith("/members/600")) {
      return Promise.resolve(Response.json({ roles: [] }));
    }

    if (path.endsWith("/channels/800")) {
      return Promise.resolve(
        Response.json({
          id: "800",
          guild_id: "700",
          type: 0,
          permission_overwrites: overwrites,
        })
      );
    }

    return Promise.resolve(Response.json(messages));
  };

describe("durable Harvest", () => {
  it("refuses missing history permission instead of treating Discord's empty reply as complete", async () => {
    await expect(
      Effect.runPromise(
        messagePage(
          request,
          "invented-token",
          wire({ permissions: "1024", messages: [] })
        )
      )
    ).rejects.toMatchObject({
      reason: "Discord message history is unavailable",
    });
  });

  it("parses identities and edits, keeps webhook identity, and never fabricates a thread", async () => {
    const result = await Effect.runPromise(
      messagePage(
        request,
        "invented-token",
        wire({
          messages: [
            {
              ...raw,
              webhook_id: "901",
              edited_timestamp: "2026-11-02T00:00:00Z",
            },
          ],
        })
      )
    );

    expect(result).toStrictEqual([
      {
        id: "101",
        channelId: "800",
        parentChannelId: "800",
        threadId: null,
        authorId: "900",
        authorName: "Writer",
        authorAvatarUrl: null,
        authorIsBot: false,
        authorIsWebhook: true,
        content: "How?",
        createdAt: "2026-11-01T00:00:00Z",
        editedAt: "2026-11-02T00:00:00Z",
        replyCount: 0,
        isPost: false,
        url: "https://discord.com/channels/700/800/101",
      },
    ]);
  });

  it("refuses missing message-content intent rather than storing redacted blanks", async () => {
    await expect(
      Effect.runPromise(
        messagePage(request, "invented-token", wire({ flags: 0 }))
      )
    ).rejects.toMatchObject({
      reason: "Discord message content is unavailable",
    });
  });

  it("applies member overrides after everyone and permits an administrator", async () => {
    const overwrites = [
      { id: "700", type: 0, allow: "0", deny: "65536" },
      { id: "600", type: 1, allow: "65536", deny: "0" },
    ];

    await expect(
      Effect.runPromise(
        messagePage(
          request,
          "invented-token",
          wire({ overwrites, messages: [] })
        )
      )
    ).resolves.toStrictEqual([]);
    await expect(
      Effect.runPromise(
        messagePage(
          request,
          "invented-token",
          wire({ permissions: "8", overwrites: [overwrites[0]], messages: [] })
        )
      )
    ).resolves.toStrictEqual([]);
    await expect(
      Effect.runPromise(
        messagePage(
          request,
          "invented-token",
          wire({ overwrites: [overwrites[0]], messages: [] })
        )
      )
    ).rejects.toBeInstanceOf(DiscordFailed);
  });

  it.each([
    { ...raw, author: { username: "Missing ID" } },
    { ...raw, id: "not-a-snowflake" },
    { ...raw, timestamp: "not-a-date" },
    { ...raw, channel_id: "another-channel" },
  ])("rejects a whole malformed page before ingestion", async (invalid) => {
    await expect(
      Effect.runPromise(
        messagePage(
          request,
          "invented-token",
          wire({ messages: [raw, invalid] })
        )
      )
    ).rejects.toBeInstanceOf(DiscordFailed);
  });
});
