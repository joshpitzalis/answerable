import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { DiscordFailed } from "../../lib/errors";
import { sourcePage } from "../sourcePage";

interface ThreadFixture {
  readonly id: string;
  readonly parent_id: string;
  readonly type: number;
  readonly name: string;
  readonly thread_metadata: {
    readonly archived: boolean;
    readonly archive_timestamp: string;
  };
}

const request = {
  channelId: "800",
  parentChannelId: "800",
  serverId: "700",
  before: null,
  limit: 50,
  reconciliation: { kind: "message", messageId: "101" } as const,
};

const message = {
  id: "101",
  channel_id: "800",
  content: "Where is the saved answer?",
  timestamp: "2026-11-01T00:00:00Z",
  author: { id: "500", username: "Example writer" },
};

const wire = (
  status: number,
  code: number,
  accessible = true,
  data?: ThreadFixture | typeof message | readonly (typeof message)[],
  channelType = 0
) => {
  const paths: string[] = [];

  const fetch: typeof globalThis.fetch = (input) => {
    const path = new URL(String(input)).pathname.replace(/^\/api\/v\d+/u, "");
    paths.push(path);

    const metadata = new Map([
      ["/applications/@me", { bot: { id: "600" }, flags: 262_144 }],
      ["/guilds/700", { owner_id: "600", roles: [] }],
      ["/guilds/700/members/600", { roles: [] }],
      [
        "/channels/800",
        {
          id: "800",
          guild_id: "700",
          type: channelType,
          permission_overwrites: [],
        },
      ],
    ]);

    if (!accessible && path === "/channels/800") {
      return Promise.resolve(Response.json({ code: 50_001 }, { status: 403 }));
    }

    const body = metadata.get(path);

    return Promise.resolve(
      body === undefined
        ? Response.json(data ?? { code }, { status })
        : Response.json(body)
    );
  };

  return { fetch, paths };
};

describe("known-message reconciliation", () => {
  it.each([
    { channelId: "800", channelType: 0 },
    { channelId: "101", channelType: 15 },
  ])(
    "reads recent messages from $channelId after checking its parent access",
    async ({ channelId, channelType }) => {
      const fixture = wire(
        200,
        0,
        true,
        [{ ...message, channel_id: channelId }],
        channelType
      );

      await expect(
        Effect.runPromise(
          sourcePage(
            { ...request, channelId, reconciliation: { kind: "recent" } },
            "invented",
            fixture.fetch
          )
        )
      ).resolves.toMatchObject({
        reconciliation: {
          kind: "messages",
          messages: [{ id: "101", channelId, parentChannelId: "800" }],
        },
      });
      expect(fixture.paths).toHaveLength(5);
      expect(fixture.paths.at(-1)).toBe(`/channels/${channelId}/messages`);
    }
  );

  it("returns the requested known message after checking access", async () => {
    const fixture = wire(200, 0, true, message);

    await expect(
      Effect.runPromise(sourcePage(request, "invented", fixture.fetch))
    ).resolves.toMatchObject({
      reconciliation: {
        kind: "messages",
        messages: [
          {
            id: "101",
            channelId: "800",
            parentChannelId: "800",
            content: "Where is the saved answer?",
          },
        ],
      },
    });
  });

  it.each([{ id: "102" }, { channel_id: "801" }])(
    "refuses a known message with another identity: %j",
    async (change) => {
      const fixture = wire(200, 0, true, { ...message, ...change });

      await expect(
        Effect.runPromise(sourcePage(request, "invented", fixture.fetch))
      ).rejects.toBeInstanceOf(DiscordFailed);
    }
  );

  it.each([{ id: "102" }, { parent_id: "801" }, { type: 12 }])(
    "refuses foreign or private thread metadata",
    async (change) => {
      const fixture = wire(200, 0, true, {
        id: "101",
        parent_id: "800",
        type: 11,
        name: "Thread",
        thread_metadata: {
          archived: false,
          archive_timestamp: "2026-11-01T00:00:00Z",
        },
        ...change,
      });

      await expect(
        Effect.runPromise(
          sourcePage(
            {
              ...request,
              channelId: "101",
              reconciliation: { kind: "thread" },
            },
            "invented",
            fixture.fetch
          )
        )
      ).rejects.toBeInstanceOf(DiscordFailed);
    }
  );

  it.each([15, 16])(
    "never requests a recent messages page from forum/media root %i",
    async (channelType) => {
      const fixture = wire(500, 0, true, undefined, channelType);
      await expect(
        Effect.runPromise(
          sourcePage(
            { ...request, reconciliation: { kind: "recent" } },
            "invented",
            fixture.fetch
          )
        )
      ).resolves.toStrictEqual({
        reconciliation: { kind: "messages", messages: [] },
      });
      expect(fixture.paths).toHaveLength(4);
    }
  );

  it("checks displayed thread metadata in the same five-request allowance", async () => {
    const fixture = wire(200, 0, true, {
      id: "101",
      parent_id: "800",
      type: 11,
      name: "Changed thread",
      thread_metadata: {
        archived: true,
        archive_timestamp: "2026-11-18T00:00:00Z",
      },
    });

    const result = await Effect.runPromise(
      sourcePage(
        { ...request, channelId: "101", reconciliation: { kind: "thread" } },
        "invented",
        fixture.fetch
      )
    );

    expect(result).toMatchObject({
      reconciliation: {
        kind: "thread",
        thread: { id: "101", title: "Changed thread", archived: true },
      },
    });
    expect(fixture.paths).toHaveLength(5);
  });

  it("confirms deletion only after access checks and a strict Unknown Message response", async () => {
    const fixture = wire(404, 10_008);
    await expect(
      Effect.runPromise(sourcePage(request, "invented", fixture.fetch))
    ).resolves.toStrictEqual({
      reconciliation: { kind: "deleted", messageId: "101" },
    });
    expect(fixture.paths).toHaveLength(5);
    expect(fixture.paths.at(-1)).toBe("/channels/800/messages/101");
  });

  it.each([
    [404, 10_003],
    [403, 50_001],
    [500, 10_008],
    [404, 0],
  ])(
    "does not turn status %s code %s into a deletion",
    async (status, code) => {
      const fixture = wire(status, code);
      await expect(
        Effect.runPromise(sourcePage(request, "invented", fixture.fetch))
      ).rejects.toBeInstanceOf(DiscordFailed);
    }
  );

  it("does not look up the message when access cannot be established", async () => {
    const fixture = wire(404, 10_008, false);
    await expect(
      Effect.runPromise(sourcePage(request, "invented", fixture.fetch))
    ).rejects.toBeInstanceOf(DiscordFailed);
    expect(fixture.paths).not.toContain("/channels/800/messages/101");
  });
});
