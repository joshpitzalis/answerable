import { describe, expect, it } from "vitest";

import { XSTATE_PROJECT } from "../../../../lib/projects.config.example";
import { fixtureFetch } from "../_fixtureFetch";

describe("fixture active-thread discovery", () => {
  it("keeps active thread metadata consistent with discovery", async () => {
    const response = await fixtureFetch(
      "https://discord.com/api/v9/channels/1540000000000000002"
    );

    await expect(response.json()).resolves.toMatchObject({
      id: "1540000000000000002",
      parent_id: "xstate-placeholder-channel-help",
      type: 11,
      thread_metadata: { archived: false },
    });
  });

  it("discovers only active threads belonging to the requested Project", async () => {
    const response = await fixtureFetch(
      `https://discord.com/api/v9/guilds/${XSTATE_PROJECT.serverId}/threads/active`
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      threads: [
        {
          id: "1540000000000000005",
          parent_id: "xstate-placeholder-channel-guards",
        },
        {
          id: "1540000000000000004",
          parent_id: "xstate-placeholder-channel-guards",
        },
        {
          id: "1540000000000000003",
          parent_id: "xstate-placeholder-channel-help",
        },
        {
          id: "1540000000000000002",
          parent_id: "xstate-placeholder-channel-help",
        },
        {
          id: "1540000000000000001",
          parent_id: "xstate-placeholder-channel-help",
        },
      ],
      has_more: false,
    });
  });
});

describe("fixture known-message reads", () => {
  it.each([
    {
      channel: "xstate-placeholder-channel-help",
      status: 200,
      body: {
        id: "1540000000000000002",
        channel_id: "xstate-placeholder-channel-help",
      },
    },
    {
      channel: "xstate-placeholder-channel-guards",
      status: 404,
      body: { code: 10_008 },
    },
  ])(
    "requires the starter's original Channel: $channel",
    async ({ channel, status, body }) => {
      const response = await fixtureFetch(
        `https://discord.com/api/v9/channels/${channel}/messages/1540000000000000002`
      );

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toMatchObject(body);
    }
  );

  it("returns a known thread reply with its owner and stream identity", async () => {
    const response = await fixtureFetch(
      "https://discord.com/api/v9/channels/1540000000000000002/messages/1540000000000000002001"
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: "1540000000000000002001",
      channel_id: "1540000000000000002",
      author: { username: XSTATE_PROJECT.ownerName },
    });
  });

  it("returns Discord Unknown Message for a missing message", async () => {
    const response = await fixtureFetch(
      "https://discord.com/api/v9/channels/1540000000000000002/messages/999"
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toStrictEqual({ code: 10_008 });
  });
});

describe("fixture message pagination", () => {
  it.each([
    { query: "?limit=1", expected: [{ id: "1540000000000000003" }] },
    {
      query: "",
      expected: [
        { id: "1540000000000000003" },
        { id: "1540000000000000002" },
        { id: "1540000000000000001" },
      ],
    },
  ])(
    "honors an explicit small limit and the default window: $query",
    async ({ query, expected }) => {
      const response = await fixtureFetch(
        `https://discord.com/api/v9/channels/xstate-placeholder-channel-help/messages${query}`
      );

      await expect(response.json()).resolves.toMatchObject(expected);
    }
  );

  it.each([
    {
      channel: "1540000000000000002",
      before: "1540000000000000002002",
      after: "1540000000000000002000",
      expected: [{ id: "1540000000000000002001" }],
    },
    {
      channel: "1540000000000000002",
      before: "1540000000000000002001",
      after: "1540000000000000002000",
      expected: [],
    },
    {
      channel: "1540000000000000002",
      before: "1540000000000000002002",
      after: "1540000000000000002001",
      expected: [],
    },
    {
      channel: "xstate-placeholder-channel-help",
      before: "1540000000000000003",
      after: "1540000000000000001",
      expected: [{ id: "1540000000000000002" }],
    },
  ])(
    "returns only messages strictly between $after and $before",
    async ({ channel, before, after, expected }) => {
      const response = await fixtureFetch(
        `https://discord.com/api/v9/channels/${channel}/messages?before=${before}&after=${after}&limit=50`
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject(expected);
    }
  );
});
