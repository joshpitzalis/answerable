import { Effect, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";

import type { DiscordMessage, Project } from "../domain";
import { EFFECT_PROJECT } from "../lib/projects.config";
import { Corpus } from "../services/corpus";
import { Cursors } from "../services/cursors";
import { Discord } from "../services/discord";
import { DiscordFailed } from "../services/discord/lib/errors";
import { Judge } from "../services/judge";
import { QuestionStore } from "../services/question-store";
import { harvestQuestions } from "../workflows/harvestQuestions";

const CHANNEL = "1125094089281511474";
const THREAD_I_ANSWERED = "300";

const OTHER_PROJECT: Project = {
  channels: [
    { id: "x1", name: "xstate-help" },
    { id: "x2", name: "xstate-chat" },
  ],
  label: "XState",
  ownerName: "xena",
  serverId: "999",
  slug: "xstate",
};

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

interface Call {
  readonly channelId: string;
  readonly serverId: string;
}

interface ReplyAsked {
  readonly threadId: string;
  readonly authorName: string;
}

const discordServing = (
  messages: readonly DiscordMessage[],
  calls: Call[] = [],
  repliesAsked: ReplyAsked[] = []
) =>
  Layer.succeed(
    Discord,
    Discord.of({
      hasReplyFrom: (threadId, authorName) =>
        Effect.sync(() => {
          repliesAsked.push({ authorName, threadId });

          return threadId === THREAD_I_ANSWERED;
        }),
      messagesSince: (channelId, cursor, serverId) =>
        Effect.sync(() => {
          calls.push({ channelId, serverId });

          return Option.isNone(cursor)
            ? messages
            : messages.filter((candidate) => candidate.id > cursor.value);
        }),
    })
  );

const discordDown = Layer.succeed(
  Discord,
  Discord.of({
    hasReplyFrom: () => Effect.fail(new DiscordFailed({ reason: "down" })),
    messagesSince: () => Effect.fail(new DiscordFailed({ reason: "down" })),
  })
);

const harvestWith = (
  discord: Layer.Layer<Discord>,
  project: Project = EFFECT_PROJECT
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* harvestQuestions(project);

      return {
        cursor: Option.getOrNull(
          yield* Cursors.use((cursors) => cursors.get(CHANNEL))
        ),
        rows: yield* QuestionStore.use((store) => store.listOpen(project.slug)),
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
  it("stores only unanswered questions that a post can answer, with their Project and Channel", async () => {
    const { rows } = await harvestWith(discordServing(MESSAGES));

    expect(rows).toStrictEqual([
      {
        channel: { id: CHANNEL, name: "effect-help" },
        comments: 2,
        dateAsked: new Date("2026-08-01T00:00:00Z"),
        id: "100",
        name: "ada",
        project: "effect",
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

  it("reads only the requested Project's Channels, with that Project's server id", async () => {
    const calls: Call[] = [];

    await harvestWith(discordServing([], calls), OTHER_PROJECT);

    expect(calls).toStrictEqual([
      { channelId: "x1", serverId: "999" },
      { channelId: "x2", serverId: "999" },
    ]);
  });

  it("asks for a reply from the requested Project's owner name", async () => {
    const repliesAsked: ReplyAsked[] = [];

    await harvestWith(
      discordServing(
        [message("100", "How do I build layers once?")],
        [],
        repliesAsked
      ),
      OTHER_PROJECT
    );

    expect(repliesAsked).toStrictEqual([
      { authorName: "xena", threadId: "100" },
      { authorName: "xena", threadId: "100" },
    ]);
  });

  it("judges against the requested Project's Posts only", async () => {
    // The question matches an Effect post, but XState has none.
    const { rows } = await harvestWith(discordServing(MESSAGES), OTHER_PROJECT);

    expect(rows).toStrictEqual([]);
  });
});
