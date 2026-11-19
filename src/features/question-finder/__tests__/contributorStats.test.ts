import { Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import type { Project } from "../domain";
import { EFFECT_PROJECT } from "../lib/projects.config.example";
import { Contributions } from "../services/contributions";
import { Corpus } from "../services/corpus";
import { Cursors } from "../services/cursors";
import { Discord } from "../services/discord";
import { Judge } from "../services/judge";
import { QuestionStore } from "../services/question-store";
import { listQuestions } from "../workflows/listQuestions";
import type { WireMessage } from "./discordWire.test-utils";
import { fakeDiscord } from "./discordWire.test-utils";

const XSTATE: Project = {
  id: "xstate",
  channels: [
    { id: "x1", name: "xstate-help" },
    { id: "x2", name: "xstate-chat" },
  ],
  label: "XState",
  ownerName: "xena",
  serverId: "999",
  slug: "xstate",
};

const runtimeOver = (fetch: typeof globalThis.fetch) =>
  ManagedRuntime.make(
    Layer.mergeAll(
      Discord.layer("token", fetch),
      Cursors.stub,
      Contributions.stub,
      Corpus.stub,
      Judge.everythingAnswerable,
      QuestionStore.stub
    )
  );

const said = (
  id: string,
  author: string,
  content = "Hello.",
  extra: Partial<WireMessage> = {}
): WireMessage => ({
  author,
  content,
  id,
  ...extra,
});

const namesAndCounts = (
  stats: {
    topContributors: readonly { name: string; responses: number }[];
  } | null
) => stats?.topContributors.map(({ name, responses }) => [name, responses]);

describe("the contributor statistic of a Project", () => {
  it("is the median responses per contributor and the count one standard deviation above the mean, over every message read", async () => {
    const wire = fakeDiscord({
      channels: {
        x1: [
          said("100", "ana"),
          said("110", "ana", "How do actors stop?"),
          said("120", "ana"),
          said("130", "ana"),
          said("140", "bo"),
        ],
        x2: [said("200", "cy")],
      },
    });

    const reply = await listQuestions(runtimeOver(wire.fetch), XSTATE);

    // ana 4, bo 1, cy 1: median 1; mean 2, SD 1.41, so 4.
    expect(reply.contributorStats).toMatchObject({
      medianResponses: 1,
      plusOneSd: 4,
    });
  });

  it("counts a forum post's first message and not the replies in its thread", async () => {
    const wire = fakeDiscord({
      channels: { x1: [said("100", "ana")] },
      forums: {
        f1: [
          { author: "bo", content: "It hangs.", id: "200", title: "Hang" },
          { author: "bo", content: "Again.", id: "300", title: "Hang again" },
        ],
      },
      replies: { "100": ["ana", "ana", "ana"], "200": ["cy", "cy"] },
    });

    const reply = await listQuestions(runtimeOver(wire.fetch), {
      ...XSTATE,
      channels: [
        { id: "x1", name: "xstate-help" },
        { id: "f1", name: "xstate-forum" },
      ],
    });

    // ana 1, bo 2: median 1.5; mean 1.5, SD 0.5, so 2.
    expect(reply.contributorStats).toMatchObject({
      medianResponses: 1.5,
      plusOneSd: 2,
    });
    expect(namesAndCounts(reply.contributorStats)).toStrictEqual([
      ["bo", 2],
      ["ana", 1],
    ]);
  });

  it("adds the messages of a later Harvest to the earlier ones", async () => {
    const x1 = [said("100", "ana"), said("110", "bo")];
    const wire = fakeDiscord({ channels: { x1, x2: [] } });
    const runtime = runtimeOver(wire.fetch);

    await listQuestions(runtime, XSTATE);
    x1.push(said("120", "ana"), said("130", "ana"));

    const reply = await listQuestions(runtime, XSTATE);

    // ana 3, bo 1: median 2; mean 2, SD 1, so 3.
    expect(reply.contributorStats).toMatchObject({
      medianResponses: 2,
      plusOneSd: 3,
    });
  });

  it("counts a message once when its Channel failed after reading it and reads it again", async () => {
    // Its reply check breaks, so Channel x1 fails with the cursor unmoved.
    const wire = fakeDiscord({
      broken: ["100"],
      channels: {
        x1: [{ ...said("100", "ana", "How do actors stop?"), threadId: "100" }],
        x2: [said("200", "bo")],
      },
    });

    const runtime = runtimeOver(wire.fetch);

    await listQuestions(runtime, XSTATE);

    const reply = await listQuestions(runtime, XSTATE);

    expect(reply.failedChannels.map((channel) => channel.name)).toStrictEqual([
      "xstate-help",
    ]);
    // ana 1, bo 1.
    expect(reply.contributorStats).toMatchObject({
      medianResponses: 1,
      plusOneSd: 1,
    });
  });

  it("still counts the other Channels' messages when one Channel fails", async () => {
    const wire = fakeDiscord({
      broken: ["x2"],
      channels: {
        x1: [said("100", "ana"), said("110", "ana"), said("120", "bo")],
        x2: [said("200", "cy")],
      },
    });

    const reply = await listQuestions(runtimeOver(wire.fetch), XSTATE);

    expect(reply.failedChannels).toHaveLength(1);
    // ana 2, bo 1: median 1.5; mean 1.5, SD 0.5, so 2.
    expect(reply.contributorStats).toMatchObject({
      medianResponses: 1.5,
      plusOneSd: 2,
    });
  });

  it("does not mix one Project's messages into another's", async () => {
    const wire = fakeDiscord({
      channels: {
        "1125094089281511474": [said("900", "dee")],
        x1: [said("100", "ana"), said("110", "ana")],
        x2: [],
      },
    });

    const runtime = runtimeOver(wire.fetch);

    const xstate = await listQuestions(runtime, XSTATE);
    const effect = await listQuestions(runtime, EFFECT_PROJECT);

    expect(xstate.contributorStats).toMatchObject({
      medianResponses: 2,
      plusOneSd: 2,
    });
    expect(namesAndCounts(xstate.contributorStats)).toStrictEqual([["ana", 2]]);
    expect(effect.contributorStats).toMatchObject({
      medianResponses: 1,
      plusOneSd: 1,
    });
    expect(namesAndCounts(effect.contributorStats)).toStrictEqual([["dee", 1]]);
  });

  it("is worked out the same way when wired the live way, with no reply check", async () => {
    const wire = fakeDiscord({
      channels: {
        x1: [said("100", "ana"), said("110", "ana"), said("120", "bo")],
        x2: [],
      },
    });

    const runtime = ManagedRuntime.make(
      Layer.mergeAll(
        Discord.layerSkippingReplyCheck("token", wire.fetch),
        Cursors.stub,
        Contributions.stub,
        Corpus.stub,
        Judge.everythingAnswerable,
        QuestionStore.stub
      )
    );

    const reply = await listQuestions(runtime, XSTATE);

    expect(reply.contributorStats).toMatchObject({
      medianResponses: 1.5,
      plusOneSd: 2,
    });
    expect(namesAndCounts(reply.contributorStats)).toStrictEqual([
      ["ana", 2],
      ["bo", 1],
    ]);
  });

  it("is not there for a Project with no Channels", async () => {
    const wire = fakeDiscord({ channels: {} });

    const reply = await listQuestions(runtimeOver(wire.fetch), {
      ...XSTATE,
      channels: [],
    });

    expect(reply.contributorStats).toBeNull();
  });

  it("is not there while nothing has been read", async () => {
    const wire = fakeDiscord({ channels: { x1: [], x2: [] } });

    const reply = await listQuestions(runtimeOver(wire.fetch), XSTATE);

    expect(reply.contributorStats).toBeNull();
  });
});

describe("bot accounts in the contributor statistic", () => {
  it("change neither the median, the bracket nor the top list, whatever they write", async () => {
    const wire = fakeDiscord({
      channels: {
        x1: [
          said("100", "ana"),
          said("110", "ana"),
          said("120", "bo"),
          said("130", "robo", "Build passed.", { bot: true }),
          said("140", "robo", "Build failed.", { bot: true }),
          said("150", "robo", "Build passed.", { bot: true }),
          said("160", "hook", "Deploy done.", { bot: true }),
        ],
        x2: [said("200", "robo", "Nightly run.", { bot: true })],
      },
    });

    const reply = await listQuestions(runtimeOver(wire.fetch), XSTATE);

    // Only ana 2 and bo 1: median 1.5; mean 1.5, SD 0.5, so 2.
    expect(reply.contributorStats).toStrictEqual({
      medianResponses: 1.5,
      plusOneSd: 2,
      topContributors: [
        { avatarUrl: null, name: "ana", responses: 2 },
        { avatarUrl: null, name: "bo", responses: 1 },
      ],
    });
  });

  it("have no statistic at all when only bots wrote", async () => {
    const wire = fakeDiscord({
      channels: {
        x1: [said("100", "robo", "Build passed.", { bot: true })],
        x2: [],
      },
    });

    const reply = await listQuestions(runtimeOver(wire.fetch), XSTATE);

    expect(reply.contributorStats).toBeNull();
  });

  it("do not count as a forum post's contributor, though the post stays listed", async () => {
    const wire = fakeDiscord({
      channels: { x1: [said("100", "ana")] },
      forums: {
        f1: [
          {
            author: "robo",
            bot: true,
            content: "Release notes.",
            id: "200",
            title: "Release",
          },
        ],
      },
    });

    const reply = await listQuestions(runtimeOver(wire.fetch), {
      ...XSTATE,
      channels: [
        { id: "x1", name: "xstate-help" },
        { id: "f1", name: "xstate-forum" },
      ],
    });

    expect(namesAndCounts(reply.contributorStats)).toStrictEqual([["ana", 1]]);
    expect(reply.questions.map((row) => row.name)).toContain("robo");
  });

  it("can still be listed as a question", async () => {
    const wire = fakeDiscord({
      channels: {
        x1: [said("100", "robo", "Is the build green?", { bot: true })],
        x2: [],
      },
    });

    const reply = await listQuestions(runtimeOver(wire.fetch), XSTATE);

    expect(reply.questions.map((row) => row.name)).toStrictEqual(["robo"]);
    expect(reply.contributorStats).toBeNull();
  });

  it("never lend their avatar to the top list", async () => {
    const wire = fakeDiscord({
      channels: {
        x1: [
          said("100", "ana", "Hello.", { avatar: "ana-hash" }),
          said("110", "ana", "Hello.", {
            avatar: "bot-hash",
            bot: true,
          }),
        ],
        x2: [],
      },
    });

    const reply = await listQuestions(runtimeOver(wire.fetch), XSTATE);

    expect(JSON.stringify(reply.contributorStats)).not.toContain("bot-hash");
    expect(reply.contributorStats?.topContributors).toStrictEqual([
      {
        avatarUrl:
          "https://cdn.discordapp.com/avatars/user-ana/ana-hash.png?size=64",
        name: "ana",
        responses: 1,
      },
    ]);
  });
});

describe("the top contributors of a Project", () => {
  it("are the five with the most responses across its Channels, most first, ties by name", async () => {
    const wire = fakeDiscord({
      channels: {
        x1: [
          said("100", "Zed"),
          said("101", "Zed"),
          said("102", "Zed"),
          said("103", "Cal"),
          said("104", "Cal"),
          said("105", "Amy"),
          said("106", "Amy"),
          said("107", "Eli"),
          said("108", "Dov"),
        ],
        x2: [
          said("200", "Bea"),
          said("201", "Bea"),
          said("202", "Fay"),
          said("203", "Zed"),
        ],
      },
    });

    const reply = await listQuestions(runtimeOver(wire.fetch), XSTATE);

    // Zed 4; Amy, Bea, Cal 2; Dov, Eli, Fay 1 (Dov takes the fifth place by name).
    expect(namesAndCounts(reply.contributorStats)).toStrictEqual([
      ["Zed", 4],
      ["Amy", 2],
      ["Bea", 2],
      ["Cal", 2],
      ["Dov", 1],
    ]);
  });

  it("are fewer than five when fewer people wrote", async () => {
    const wire = fakeDiscord({
      channels: { x1: [said("100", "bo"), said("110", "ana")], x2: [] },
    });

    const reply = await listQuestions(runtimeOver(wire.fetch), XSTATE);

    expect(namesAndCounts(reply.contributorStats)).toStrictEqual([
      ["ana", 1],
      ["bo", 1],
    ]);
  });

  it("show the avatar from the person's most recent message, and none when Discord gave no hash", async () => {
    const wire = fakeDiscord({
      channels: {
        x1: [
          said("100", "ana", "Hello.", { authorId: "u-ana", avatar: "old1" }),
          said("120", "ana", "Hello.", { authorId: "u-ana", avatar: "new2" }),
          said("110", "ana", "Hello.", { authorId: "u-ana", avatar: "mid3" }),
          said("130", "bo", "Hello.", { authorId: "u-bo", avatar: null }),
          said("140", "cy", "Hello.", { authorId: "u-cy" }),
          said("150", "dee", "Hello.", { authorId: "u-dee", avatar: "was4" }),
          said("160", "dee", "Hello.", { authorId: "u-dee", avatar: null }),
        ],
        x2: [],
      },
    });

    const reply = await listQuestions(runtimeOver(wire.fetch), XSTATE);

    expect(reply.contributorStats?.topContributors).toStrictEqual([
      {
        avatarUrl: "https://cdn.discordapp.com/avatars/u-ana/new2.png?size=64",
        name: "ana",
        responses: 3,
      },
      { avatarUrl: null, name: "dee", responses: 2 },
      { avatarUrl: null, name: "bo", responses: 1 },
      { avatarUrl: null, name: "cy", responses: 1 },
    ]);
  });
});
