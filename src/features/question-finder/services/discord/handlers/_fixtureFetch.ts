import FIXTURE from "#/features/question-finder/services/_fixtures/messages.json" with { type: "json" };
import { ANSWERED_THREADS } from "#/features/question-finder/services/discord/lib/constants";

import { compareSnowflakes } from "../../../domain/harvest.values";
import { PROJECTS } from "../../../lib/projects.config.example";

/**
 * ponytail: just enough of Discord's list-messages contract for the pipeline to
 * run — `after` filtering, newest-first ordering, thread replies. It serves the
 * captured fixture; the code under test above is the real client. Delete when
 * `Discord.layer` gets a token.
 */
export const fixtureFetch: typeof globalThis.fetch = (input) => {
  const url = new URL(String(input));

  if (url.pathname.endsWith("/applications/@me")) {
    return Promise.resolve(
      Response.json({ bot: { id: "830000000000000001" }, flags: 262_144 })
    );
  }

  if (url.pathname.endsWith("/members/830000000000000001")) {
    return Promise.resolve(Response.json({ roles: [] }));
  }

  if (url.pathname.split("/").at(-2) === "guilds") {
    const serverId = url.pathname.split("/").at(-1);

    return Promise.resolve(
      Response.json({
        owner_id: "830000000000000002",
        roles: [{ id: serverId, permissions: "66560" }],
      })
    );
  }

  // `/api/v9/channels/{id}`: the kind lookup. Every fixture Channel is text.
  if (url.pathname.split("/").at(-2) === "channels") {
    const channelId = url.pathname.split("/").at(-1);

    const project = PROJECTS.find((item) =>
      item.channels.some((channel) => channel.id === channelId)
    );

    return Promise.resolve(
      Response.json({
        id: channelId,
        type: 0,
        guild_id: project?.serverId,
        permission_overwrites: [],
      })
    );
  }

  // `/api/v9/channels/{id}/messages`
  const id = url.pathname.split("/").at(-2) ?? "";
  const after = url.searchParams.get("after");
  const before = url.searchParams.get("before");
  const limit = Number(url.searchParams.get("limit") ?? 50);

  // The fixture holds forum starters. Anything that isn't a channel in it is
  // being read as a thread.
  const starters = FIXTURE.filter((message) => message.channel_id === id);

  if (starters.length === 0) {
    return Promise.resolve(Response.json(replies(id)));
  }

  // Already newest-first, same as the API.
  return Promise.resolve(
    Response.json(
      starters
        .filter(
          (message) =>
            (after === null || compareSnowflakes(message.id, after) > 0) &&
            (before === null || compareSnowflakes(message.id, before) < 0)
        )
        .slice(0, limit)
    )
  );
};

const replies = (threadId: string) => {
  const owner = ANSWERED_THREADS.get(threadId);

  return owner === undefined
    ? []
    : [
        {
          id: (BigInt(threadId) + 1n).toString(),
          content: "Covered in an earlier post.",
          timestamp: "2026-08-10T00:00:00.000+00:00",
          channel_id: threadId,
          author: {
            id: "830000000000000003",
            username: owner,
            global_name: null,
          },
        },
      ];
};
