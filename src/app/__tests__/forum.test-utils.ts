export const forumThread = (
  id: string,
  archived = false,
  at = "2026-11-01T00:00:00.000000Z"
) => ({
  id,
  parent_id: "800",
  type: 11,
  name: `Forum ${id}`,
  thread_metadata: { archived, archive_timestamp: at },
});

export const forumWire = () => {
  const active: ReturnType<typeof forumThread>[] = [];
  const requests: URL[] = [];

  const state = {
    channelType: 15,
    active,
    archives: new Map<
      string,
      { threads: ReturnType<typeof forumThread>[]; has_more: boolean }
    >(),
    missing: new Set<string>(),
    messages: new Map<
      string,
      {
        id: string;
        channel_id: string;
        content: string;
        timestamp: string;
        author: { id: string; username: string; bot?: boolean };
        webhook_id?: string;
      }[]
    >(),
    requests,
  };

  const fetch: typeof globalThis.fetch = (input) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api\/v\d+/u, "");
    state.requests.push(url);

    const metadata = new Map([
      [
        "/applications/@me",
        Response.json({ bot: { id: "600" }, flags: 262_144 }),
      ],
      ["/guilds/700", Response.json({ owner_id: "600", roles: [] })],
      ["/guilds/700/members/600", Response.json({ roles: [] })],
      [
        "/channels/800",
        Response.json({
          id: "800",
          guild_id: "700",
          type: state.channelType,
          permission_overwrites: [],
        }),
      ],
    ]);

    const meta = metadata.get(path);

    if (meta !== undefined) {
      return Promise.resolve(meta);
    }

    if (path === "/guilds/700/threads/active") {
      return Promise.resolve(Response.json({ threads: state.active }));
    }

    if (path === "/channels/800/threads/archived/public") {
      return Promise.resolve(
        Response.json(
          state.archives.get(url.searchParams.get("before") ?? "") ?? {
            threads: [],
            has_more: false,
          }
        )
      );
    }

    const stream = /^\/channels\/(?<id>\d+)\/messages$/u.exec(path)?.groups?.id;

    if (stream !== undefined) {
      const before = url.searchParams.get("before");
      const messages = state.messages.get(stream) ?? [];

      return Promise.resolve(
        Response.json(
          messages
            .filter(
              (message) =>
                before === null || BigInt(message.id) < BigInt(before)
            )
            .toSorted((a, b) => (BigInt(a.id) > BigInt(b.id) ? -1 : 1))
            .slice(0, Number(url.searchParams.get("limit") ?? 50))
        )
      );
    }

    const id = /^\/channels\/(?<thread>\d+)\/messages\/(?<message>\d+)$/u.exec(
      path
    )?.groups?.message;

    if (id === undefined || state.missing.has(id)) {
      return Promise.resolve(Response.json({ code: 10_008 }, { status: 404 }));
    }

    return Promise.resolve(
      Response.json({
        id,
        channel_id: id,
        content: "Plain forum body",
        timestamp: "2026-11-01T00:00:00Z",
        author: { id: "900", username: "Writer" },
      })
    );
  };

  return { state, fetch };
};
