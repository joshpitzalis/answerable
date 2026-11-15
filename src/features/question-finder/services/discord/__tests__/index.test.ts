import { Effect, Option } from "effect";
import { describe, expect, it } from "vitest";

import { Discord } from "../index";

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
      discord.messagesSince(CHANNEL, Option.none())
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
      discord.messagesSince(CHANNEL, Option.some("1526704420086353921"))
    );

    expect(messages.map((message) => message.id)).toStrictEqual([
      "1534145198391693322",
      "1535912718735777863",
    ]);
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
