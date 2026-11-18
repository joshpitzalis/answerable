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

const wire = (
  status: number,
  code: number,
  accessible = true,
  data?: ThreadFixture
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
        { id: "800", guild_id: "700", type: 0, permission_overwrites: [] },
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
