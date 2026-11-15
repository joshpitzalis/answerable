import { Effect, Option } from "effect";
import { describe, expect, it } from "vitest";

import { Discord } from "../index";

const SERVER = "795981131316985866";
const CHANNEL = "1125094089281511474";
const ANSWERED_THREAD = "1525693287409913856";
const OPEN_THREAD = "1534145198391693322";

// Discord.stub runs the real client over the captured fixture; only the wire is faked.
const withDiscord = <A, E>(
  run: (discord: Discord["Service"]) => Effect.Effect<A, E>
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* run(yield* Discord);
    }).pipe(Effect.provide(Discord.stub))
  );

describe("Discord.messagesSince", () => {
  it("returns a channel's messages oldest first", async () => {
    const messages = await withDiscord((discord) =>
      discord.messagesSince(CHANNEL, Option.none(), SERVER)
    );

    expect(messages).toHaveLength(10);
    expect(messages.at(0)).toStrictEqual({
      authorName: "Fish Fan 10",
      content:
        "Do guppies carry a counting schema — can one really tell four dots from five?",
      createdAt: new Date("2026-06-25T19:29:05.200Z"),
      id: "1519786530753872124",
      replyCount: 1,
      threadId: "1519786530753872124",
      url: "https://discord.com/channels/795981131316985866/1125094089281511474/1519786530753872124",
    });
    expect(messages.at(-1)?.id).toBe("1535912718735777863");
  });

  it("returns only messages after the cursor", async () => {
    const messages = await withDiscord((discord) =>
      discord.messagesSince(CHANNEL, Option.some("1526704420086353921"), SERVER)
    );

    expect(messages.map((message) => message.id)).toStrictEqual([
      "1534145198391693322",
      "1535912718735777863",
    ]);
  });
});

describe("Discord.messagesSince for the XState Channels", () => {
  it("serves each placeholder Channel's own messages, oldest first, linked under the placeholder server", async () => {
    const help = await withDiscord((discord) =>
      discord.messagesSince(
        "xstate-placeholder-channel-help",
        Option.none(),
        "xstate-placeholder-server"
      )
    );

    const guards = await withDiscord((discord) =>
      discord.messagesSince(
        "xstate-placeholder-channel-guards",
        Option.none(),
        "xstate-placeholder-server"
      )
    );

    expect(help.map((message) => message.id)).toStrictEqual([
      "1540000000000000001",
      "1540000000000000002",
      "1540000000000000003",
    ]);
    expect(guards.map((message) => message.id)).toStrictEqual([
      "1540000000000000004",
      "1540000000000000005",
    ]);
    expect(help[0]?.url).toBe(
      "https://discord.com/channels/xstate-placeholder-server/xstate-placeholder-channel-help/1540000000000000001"
    );
  });
});

describe("Discord.hasReplyFrom for the XState Project", () => {
  it("is true for the XState owner in its answered thread, false for the Effect owner", async () => {
    await expect(
      withDiscord((discord) =>
        discord.hasReplyFrom("1540000000000000002", "xstate-placeholder-owner")
      )
    ).resolves.toBeTruthy();
    await expect(
      withDiscord((discord) =>
        discord.hasReplyFrom("1540000000000000002", "josh")
      )
    ).resolves.toBeFalsy();
    await expect(
      withDiscord((discord) =>
        discord.hasReplyFrom("1525693287409913856", "xstate-placeholder-owner")
      )
    ).resolves.toBeFalsy();
  });
});

describe("Discord.hasReplyFrom", () => {
  it("is true when the author replied in the thread", async () => {
    await expect(
      withDiscord((discord) => discord.hasReplyFrom(ANSWERED_THREAD, "josh"))
    ).resolves.toBeTruthy();
  });

  it("is false for another author or an unanswered thread", async () => {
    await expect(
      withDiscord((discord) => discord.hasReplyFrom(ANSWERED_THREAD, "ada"))
    ).resolves.toBeFalsy();
    await expect(
      withDiscord((discord) => discord.hasReplyFrom(OPEN_THREAD, "josh"))
    ).resolves.toBeFalsy();
  });
});
