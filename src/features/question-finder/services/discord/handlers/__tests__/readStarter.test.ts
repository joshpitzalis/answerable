import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { DiscordFailed } from "../../lib/errors";
import { readStarter } from "../readStarter";

const request = {
  channelId: "101",
  parentChannelId: "800",
  serverId: "700",
  before: null,
  limit: 50,
};

const thread = {
  id: "101",
  parentChannelId: "800",
  starterId: "101",
  title: "Question",
  archived: false,
  archiveTimestamp: "2026-11-01T00:00:00Z",
  isPost: true,
};

const raw = {
  id: "101",
  channel_id: "101",
  content: "How?",
  timestamp: "2026-11-01T00:00:00Z",
  author: { id: "900", username: "Writer" },
};

describe("forum starter identity", () => {
  it.each([
    { isPost: true, channelId: "101" },
    { isPost: false, channelId: "800" },
  ])(
    "reads the real starter stream for isPost=$isPost",
    async ({ isPost, channelId }) => {
      const urls: string[] = [];

      const fetch: typeof globalThis.fetch = (input) => {
        urls.push(String(input));

        return Promise.resolve(
          Response.json({ ...raw, channel_id: channelId })
        );
      };

      const result = await Effect.runPromise(
        readStarter(request, { ...thread, isPost }, "invented", fetch)
      );

      expect(urls).toStrictEqual([
        `https://discord.com/api/v9/channels/${channelId}/messages/101`,
      ]);
      expect(result.starter).toMatchObject({
        id: "101",
        channelId,
        parentChannelId: "800",
        threadId: "101",
        isPost,
      });
    }
  );

  it.each([
    { response: { ...raw, id: "102" }, parentChannelId: "800" },
    { response: { ...raw, channel_id: "102" }, parentChannelId: "800" },
    { response: raw, parentChannelId: "801" },
  ])(
    "rejects another message, stream or configured parent",
    async ({ response, parentChannelId }) => {
      const fetch: typeof globalThis.fetch = () =>
        Promise.resolve(Response.json(response));

      await expect(
        Effect.runPromise(
          readStarter(
            { ...request, parentChannelId },
            thread,
            "invented",
            fetch
          )
        )
      ).rejects.toBeInstanceOf(DiscordFailed);
    }
  );
});
