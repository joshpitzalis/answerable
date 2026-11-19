import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { DiscordFailed } from "../../lib/errors";
import { sourcePage } from "../sourcePage";

const request = {
  channelId: "800",
  parentChannelId: "800",
  serverId: "700",
  before: null,
  limit: 50,
};

const thread = {
  id: "101",
  parent_id: "800",
  type: 11,
  name: "A forum question",
  thread_metadata: {
    archived: false,
    archive_timestamp: "2026-11-01T00:00:00.000001Z",
  },
};

interface DiscoveryFixture {
  readonly threads: readonly (typeof thread)[];
  readonly has_more?: boolean | string;
}

const wire =
  (page: DiscoveryFixture, channelType = 15): typeof globalThis.fetch =>
  (input) => {
    const path = new URL(String(input)).pathname;

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

    const response = [...metadata.entries()].find(([suffix]) =>
      path.endsWith(suffix)
    )?.[1];

    return Promise.resolve(Response.json(response ?? page));
  };

describe("forum discovery boundary", () => {
  it("distinguishes public text threads from forum posts during discovery", async () => {
    const result = await Effect.runPromise(
      sourcePage(
        {
          ...request,
          forum: { kind: "active" },
        },
        "invented",
        wire({ threads: [thread] }, 0)
      )
    );

    expect(result).toMatchObject({
      isForum: false,
      threads: [{ id: "101", isPost: false, parentChannelId: "800" }],
    });
  });

  it("requests a bounded archive page with the persisted timestamp continuation", async () => {
    const urls: URL[] = [];
    const metadata = wire({ threads: [], has_more: false });

    const fetch: typeof globalThis.fetch = (input, init) => {
      urls.push(new URL(String(input)));

      return metadata(input, init);
    };

    await Effect.runPromise(
      sourcePage(
        {
          ...request,
          forum: { kind: "archive", before: "2026-11-01T00:00:00.000001Z" },
        },
        "invented",
        fetch
      )
    );

    const archive = urls.find((url) =>
      url.pathname.endsWith("/threads/archived/public")
    );

    expect(archive?.pathname).toMatch(
      /\/channels\/800\/threads\/archived\/public$/u
    );
    expect(archive?.searchParams.get("limit")).toBe("100");
    expect(archive?.searchParams.get("before")).toBe(
      "2026-11-01T00:00:00.000001Z"
    );
  });

  it("refuses another Channel's thread before requesting its messages", async () => {
    const paths: string[] = [];
    const metadata = wire({ threads: [] });

    const fetch: typeof globalThis.fetch = (input, init) => {
      paths.push(new URL(String(input)).pathname);

      return metadata(input, init);
    };

    await expect(
      Effect.runPromise(
        sourcePage(
          {
            ...request,
            forum: {
              kind: "messages",
              before: null,
              thread: {
                id: "101",
                parentChannelId: "801",
                title: "Another Channel's question",
                starterId: "101",
                archived: false,
                archiveTimestamp: "2026-11-01T00:00:00Z",
                isPost: true,
              },
            },
          },
          "invented",
          fetch
        )
      )
    ).rejects.toBeInstanceOf(DiscordFailed);
    expect(paths).toHaveLength(4);
  });

  it.each(["x101", "101x", "0101", "0", ""])(
    "refuses the entire malformed thread ID %j",
    async (id) => {
      await expect(
        Effect.runPromise(
          sourcePage(
            request,
            "invented",
            wire({ threads: [{ ...thread, id }] })
          )
        )
      ).rejects.toBeInstanceOf(DiscordFailed);
    }
  );

  it.each(["1", "10", "101"])(
    "accepts a complete nonzero decimal thread ID %j",
    async (id) => {
      const result = await Effect.runPromise(
        sourcePage(request, "invented", wire({ threads: [{ ...thread, id }] }))
      );

      expect(result).toMatchObject({ threads: [{ id }] });
    }
  );

  it("retains only configured-parent public threads from the guild-wide active list", async () => {
    const result = await Effect.runPromise(
      sourcePage(
        request,
        "invented",
        wire({
          threads: [
            thread,
            { ...thread, id: "102", type: 12 },
            { ...thread, id: "103", parent_id: "801" },
          ],
        })
      )
    );

    expect(result).toStrictEqual({
      isForum: true,
      scope: "active",
      hasMore: false,
      threads: [
        {
          id: "101",
          isPost: true,
          parentChannelId: "800",
          title: "A forum question",
          starterId: "101",
          archived: false,
          archiveTimestamp: "2026-11-01T00:00:00.000001Z",
          createdAt: null,
        },
      ],
    });
  });

  it.each([
    {
      threads: [
        {
          ...thread,
          thread_metadata: {
            ...thread.thread_metadata,
            create_timestamp: "invalid",
          },
        },
      ],
    },
    {
      threads: [
        {
          ...thread,
          thread_metadata: { archived: false, archive_timestamp: "invalid" },
        },
      ],
    },
    { threads: [{ ...thread, id: "wrong" }] },
    {
      threads: [
        {
          ...thread,
          thread_metadata: {
            archived: true,
            archive_timestamp: "2026-11-01T00:00:00Z",
          },
        },
      ],
    },
  ])(
    "rejects malformed active pages without producing discovery work",
    async (page) => {
      await expect(
        Effect.runPromise(sourcePage(request, "invented", wire(page)))
      ).rejects.toBeInstanceOf(DiscordFailed);
    }
  );

  it.each([
    { threads: [thread], has_more: false },
    { threads: [], has_more: "false" },
    { threads: [] },
    {
      threads: [
        {
          ...thread,
          type: 12,
          thread_metadata: { ...thread.thread_metadata, archived: true },
        },
      ],
      has_more: false,
    },
    {
      threads: [
        {
          ...thread,
          parent_id: "801",
          thread_metadata: { ...thread.thread_metadata, archived: true },
        },
      ],
      has_more: false,
    },
  ])(
    "rejects invalid archive responses rather than declaring them exhausted",
    async (page) => {
      await expect(
        Effect.runPromise(
          sourcePage(
            { ...request, forum: { kind: "archive", before: null } },
            "invented",
            wire(page)
          )
        )
      ).rejects.toBeInstanceOf(DiscordFailed);
    }
  );
});
