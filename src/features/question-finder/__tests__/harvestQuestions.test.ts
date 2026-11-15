import { Effect, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";

import type { DiscordMessage } from "../domain";
import { Corpus } from "../services/corpus";
import { Cursors } from "../services/cursors";
import { Discord } from "../services/discord";
import { DiscordFailed } from "../services/discord/lib/errors";
import { Judge } from "../services/judge";
import { QuestionStore } from "../services/question-store";
import { harvestQuestions } from "../workflows/harvestQuestions";

const CHANNEL = "1125094089281511474";
const THREAD_I_ANSWERED = "300";

const message = (id: string, content: string): DiscordMessage => ({
  authorName: "ada",
  content,
  createdAt: new Date("2026-08-01T00:00:00Z"),
  id,
  replyCount: 2,
  threadId: id,
  url: `https://discord.com/channels/1/2/${id}`,
});

// Judge.stub answers a question that shares a long word with a post title:
// "layers" and "effect" match, "pizza" does not.
const MESSAGES = [
  message("100", "How do I build layers once?"),
  message("200", "Layers are great."),
  message(THREAD_I_ANSWERED, "Why are Effect layers lazy?"),
  message("400", "What is the best pizza topping?"),
];

const discordServing = (messages: readonly DiscordMessage[]) =>
  Layer.succeed(
    Discord,
    Discord.of({
      hasReplyFrom: (threadId) =>
        Effect.succeed(threadId === THREAD_I_ANSWERED),
      messagesSince: (_channelId, cursor) =>
        Effect.succeed(
          Option.isNone(cursor)
            ? messages
            : messages.filter((candidate) => candidate.id > cursor.value)
        ),
    })
  );

const discordDown = Layer.succeed(
  Discord,
  Discord.of({
    hasReplyFrom: () => Effect.fail(new DiscordFailed({ reason: "down" })),
    messagesSince: () => Effect.fail(new DiscordFailed({ reason: "down" })),
  })
);

const harvestWith = (discord: Layer.Layer<Discord>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* harvestQuestions();

      return {
        cursor: Option.getOrNull(
          yield* Cursors.use((cursors) => cursors.get(CHANNEL))
        ),
        rows: yield* QuestionStore.use((store) => store.listOpen()),
      };
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          discord,
          Cursors.stub,
          Corpus.stub,
          Judge.stub,
          QuestionStore.stub
        )
      )
    )
  );

describe(harvestQuestions, () => {
  it("stores only unanswered questions that a post can answer", async () => {
    const { rows } = await harvestWith(discordServing(MESSAGES));

    expect(rows).toStrictEqual([
      {
        comments: 2,
        dateAsked: new Date("2026-08-01T00:00:00Z"),
        id: "100",
        name: "ada",
        question: "How do I build layers once?",
        url: "https://discord.com/channels/1/2/100",
      },
    ]);
  });

  it("advances the cursor to the newest message it read", async () => {
    const { cursor } = await harvestWith(discordServing(MESSAGES));

    expect(cursor).toBe("400");
  });

  it("survives a Discord outage without storing rows or moving the cursor", async () => {
    const { cursor, rows } = await harvestWith(discordDown);

    expect(rows).toStrictEqual([]);
    expect(cursor).toBeNull();
  });
});
