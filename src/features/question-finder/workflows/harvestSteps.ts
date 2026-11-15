import { Effect } from "effect";

import type {
  Channel,
  DiscordMessage,
  Project,
  QuestionsRow,
  Snowflake,
} from "../domain";
import { toRow } from "../domain";
import { Corpus } from "../services/corpus";
import { Cursors } from "../services/cursors";
import { Discord } from "../services/discord";
import { Judge } from "../services/judge";
import { QuestionStore } from "../services/question-store";

/** Everything the Harvest steps ask of the runtime. */
export type HarvestServices =
  | Discord
  | Cursors
  | Corpus
  | Judge
  | QuestionStore;

/**
 * One Effect per Harvest step, each over the whole batch. Filter order is the
 * design: `Judge` costs an LLM call per question, so everything that dies before
 * it is money not spent.
 */

export const fetchNewMessages = (input: {
  readonly project: Project;
  readonly channel: Channel;
}) =>
  Effect.gen(function* () {
    const cursor = yield* Cursors.use((cursors) =>
      cursors.get(input.channel.id)
    );

    return yield* Discord.use((discord) =>
      discord.messagesSince(input.channel.id, cursor, input.project.serverId)
    );
  });

export const dropRepliedThreads = (input: {
  readonly project: Project;
  readonly messages: readonly DiscordMessage[];
}) =>
  Effect.filter(input.messages, (message) =>
    Discord.use((discord) =>
      discord.hasReplyFrom(message.threadId, input.project.ownerName)
    ).pipe(Effect.map((replied) => !replied))
  );

export const keepAnswerable = (input: {
  readonly project: Project;
  readonly channel: Channel;
  readonly messages: readonly DiscordMessage[];
}) =>
  Effect.gen(function* () {
    const posts = yield* Corpus.use((corpus) => corpus.all(input.project.slug));

    const judged = yield* Effect.forEach(
      input.messages,
      (message) =>
        Judge.use((judge) => judge.answerable(message.content, posts)).pipe(
          Effect.map((verdict) => ({ message, verdict }))
        ),
      { concurrency: 4 }
    );

    return judged
      .filter(({ verdict }) => verdict.answerable)
      .map(({ message }) => toRow(message, input.project, input.channel));
  });

export const saveThenAdvance = (input: {
  readonly channel: Channel;
  readonly rows: readonly QuestionsRow[];
  readonly newest: Snowflake | null;
}) =>
  Effect.gen(function* () {
    // Save BEFORE advancing. The cursor is a promise that these messages are
    // already accounted for — advancing first would drop them permanently on a
    // mid-run failure, and they can never be re-read.
    yield* QuestionStore.use((store) => store.save(input.rows));

    const { newest } = input;

    if (newest !== null) {
      yield* Cursors.use((cursors) => cursors.set(input.channel.id, newest));
    }
  });
