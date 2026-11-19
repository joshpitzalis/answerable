import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { DiscordFailed } from "../../lib/errors";
import { readMessagePage } from "../messagePage";
import { requireMessageAccess } from "../readAccess";
import { sourcePage as messagePage } from "../sourcePage";

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
    channelType = 0,
    channelId = "800",
    guildId = "700",
  }: {
    permissions?: string;
    flags?: number;
    channelType?: number;
    channelId?: string;
    guildId?: string;
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
          id: channelId,
          guild_id: guildId,
          type: channelType,
          permission_overwrites: overwrites,
        })
      );
    }

    return Promise.resolve(Response.json(messages));
  };

describe("durable Harvest", () => {
  it.each([{ channelId: "801" }, { guildId: "701" }])(
    "refuses foreign Channel metadata before reading messages: %j",
    async (identity) => {
      const paths: string[] = [];
      const fetch = wire(identity);

      const observed: typeof globalThis.fetch = (input, init) => {
        paths.push(new URL(String(input)).pathname);

        return fetch(input, init);
      };

      await expect(
        Effect.runPromise(messagePage(request, "invented", observed))
      ).rejects.toBeInstanceOf(DiscordFailed);
      expect(paths).toHaveLength(2);
      expect(paths.some((path) => path.endsWith("/messages"))).toBeFalsy();
    }
  );

  it("sends the bounded page size and continuation to Discord", async () => {
    const urls: string[] = [];

    const fetch: typeof globalThis.fetch = (input) => {
      urls.push(String(input));

      return Promise.resolve(Response.json([raw]));
    };

    const result = await Effect.runPromise(
      readMessagePage(
        { ...request, limit: 2, before: "103" },
        "invented",
        fetch
      )
    );

    expect(urls).toStrictEqual([
      "https://discord.com/api/v9/channels/800/messages?limit=2&before=103",
    ]);
    expect(result.map((message) => message.id)).toStrictEqual(["101"]);
  });

  it("refuses an oversized response before mapping its messages", async () => {
    await expect(
      Effect.runPromise(
        readMessagePage(
          { ...request, limit: 1 },
          "invented",
          wire({ messages: [{ ...raw, id: "102" }, raw] })
        )
      )
    ).rejects.toBeInstanceOf(DiscordFailed);
  });

  it.each(["x66560", "66560x", "+66560", " 66560", "66560 "])(
    "refuses malformed permission bits %j through the typed access failure",
    async (permissions) => {
      await expect(
        Effect.runPromise(
          messagePage(request, "invented", wire({ permissions }))
        )
      ).rejects.toBeInstanceOf(DiscordFailed);
    }
  );

  it.each([0, 15, 16])(
    "accepts supported public Channel type %i",
    async (channelType) => {
      await expect(
        Effect.runPromise(
          requireMessageAccess("800", "700", "invented", wire({ channelType }))
        )
      ).resolves.toBe(channelType);
    }
  );

  it.each([1, 2, 12])(
    "refuses unsupported Channel type %i before reading content",
    async (channelType) => {
      const paths: string[] = [];
      const fetch = wire({ channelType });

      const observed: typeof globalThis.fetch = (input, init) => {
        paths.push(new URL(String(input)).pathname);

        return fetch(input, init);
      };

      await expect(
        Effect.runPromise(
          requireMessageAccess("800", "700", "invented", observed)
        )
      ).rejects.toBeInstanceOf(DiscordFailed);
      expect(paths).toHaveLength(2);
      expect(paths.some((path) => path.endsWith("/messages"))).toBeFalsy();
    }
  );

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
              author: { ...raw.author, avatar: "invented-avatar" },
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
        authorAvatarUrl:
          "https://cdn.discordapp.com/avatars/900/invented-avatar.png?size=64",
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
    { ...raw, id: "x101" },
    { ...raw, id: "101x" },
    { ...raw, id: "0101" },
    { ...raw, id: "0" },
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
