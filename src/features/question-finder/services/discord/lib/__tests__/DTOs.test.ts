import { describe, expect, it } from "vitest";

import { toMessage } from "../DTOs";

const RAW = {
  author: { global_name: null, username: "ada" },
  channel_id: "7",
  content: "hi",
  id: "9",
  timestamp: "2026-08-10T00:00:00.000+00:00",
};

describe(toMessage, () => {
  it("falls back to the message itself and the given server when there is no thread", () => {
    expect(toMessage(RAW, "42")).toStrictEqual({
      authorName: "ada",
      content: "hi",
      createdAt: new Date("2026-08-10T00:00:00Z"),
      id: "9",
      replyCount: 0,
      threadId: "9",
      url: "https://discord.com/channels/42/7/9",
    });
  });

  it("prefers the display name and the thread's own guild and count", () => {
    const message = toMessage(
      {
        ...RAW,
        author: { global_name: "Ada L", username: "ada" },
        thread: { guild_id: "1", id: "55", message_count: 3 },
      },
      "42"
    );

    expect(message).toMatchObject({
      authorName: "Ada L",
      replyCount: 3,
      threadId: "55",
      url: "https://discord.com/channels/1/7/9",
    });
  });
});
