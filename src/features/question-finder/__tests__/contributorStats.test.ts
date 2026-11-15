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

const said = (id: string, author: string, content = "Hello."): WireMessage => ({
  author,
  content,
  id,
});

describe("the contributor statistic of a Project", () => {
  it("is the mean responses per contributor and the count one standard deviation above it, over every message read", async () => {
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

    // ana 4, bo 1, cy 1: mean 2, SD 1.41, so 4.
    expect(reply.contributorStats).toStrictEqual({
      meanResponses: 2,
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

    // ana 1, bo 2: mean 1.5, SD 0.5, so 2.
    expect(reply.contributorStats).toStrictEqual({
      meanResponses: 1.5,
      plusOneSd: 2,
    });
  });

  it("adds the messages of a later Harvest to the earlier ones", async () => {
    const x1 = [said("100", "ana"), said("110", "bo")];
    const wire = fakeDiscord({ channels: { x1, x2: [] } });
    const runtime = runtimeOver(wire.fetch);

    await listQuestions(runtime, XSTATE);
    x1.push(said("120", "ana"), said("130", "ana"));

    const reply = await listQuestions(runtime, XSTATE);

    // ana 3, bo 1: mean 2, SD 1, so 3.
    expect(reply.contributorStats).toStrictEqual({
      meanResponses: 2,
      plusOneSd: 3,
    });
  });

  it("counts a message once when its Channel failed after reading it and reads it again", async () => {
    // Its reply check breaks, so Channel x1 fails with the cursor unmoved.
    const wire = fakeDiscord({
      broken: ["100"],
      channels: {
        x1: [said("100", "ana", "How do actors stop?")],
        x2: [said("200", "bo")],
      },
    });

    const runtime = ManagedRuntime.make(
      Layer.mergeAll(
        Discord.layer("token", wire.fetch),
        Cursors.stub,
        Contributions.stub,
        Corpus.stub,
        Judge.everythingAnswerable,
        QuestionStore.stub
      )
    );

    await listQuestions(runtime, XSTATE);

    const reply = await listQuestions(runtime, XSTATE);

    expect(reply.failedChannels.map((channel) => channel.name)).toStrictEqual([
      "xstate-help",
    ]);
    // ana 1, bo 1.
    expect(reply.contributorStats).toStrictEqual({
      meanResponses: 1,
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
    // ana 2, bo 1: mean 1.5, SD 0.5, so 2.
    expect(reply.contributorStats).toStrictEqual({
      meanResponses: 1.5,
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

    expect(xstate.contributorStats).toStrictEqual({
      meanResponses: 2,
      plusOneSd: 2,
    });
    expect(effect.contributorStats).toStrictEqual({
      meanResponses: 1,
      plusOneSd: 1,
    });
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

    expect(reply.contributorStats).toStrictEqual({
      meanResponses: 1.5,
      plusOneSd: 2,
    });
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
