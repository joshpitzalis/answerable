import { Effect } from "effect";

import type { Channel, Project } from "../domain";
import { looksLikeAQuestion, toRow } from "../domain";
import { Corpus } from "../services/corpus";
import { Cursors } from "../services/cursors";
import { Discord } from "../services/discord";
import { Judge } from "../services/judge";
import { QuestionStore } from "../services/question-store";

/**
 * Surface Discord questions that are BOTH unanswered by me and answerable from
 * something I've already written.
 *
 * Filter order is the design: `Judge` costs an LLM call per question, the two
 * filters above it cost nothing and one cheap API call. A busy channel is
 * thousands of messages and maybe five answerable questions, so everything that
 * dies before `Judge` is money not spent.
 */

const harvestChannel = Effect.fn("harvestChannel")(function* (
  project: Project,
  channel: Channel
) {
  const discord = yield* Discord;
  const cursor = yield* Cursors.use((cursors) => cursors.get(channel.id));

  const messages = yield* discord.messagesSince(
    channel.id,
    cursor,
    project.serverId
  );

  const newest = messages.at(-1);

  if (newest === undefined) {
    return [];
  }

  const asking = messages.filter(looksLikeAQuestion);

  const unanswered = yield* Effect.filter(asking, (message) =>
    Effect.map(
      discord.hasReplyFrom(message.threadId, project.ownerName),
      (replied) => !replied
    )
  );

  const posts = yield* Corpus.use((corpus) => corpus.all(project.slug));

  const judged = yield* Effect.forEach(
    unanswered,
    (message) =>
      Judge.use((judge) => judge.answerable(message.content, posts)).pipe(
        Effect.map((verdict) => ({ message, verdict }))
      ),
    { concurrency: 4 }
  );

  const rows = judged
    .filter(({ verdict }) => verdict.answerable)
    .map(({ message }) => toRow(message, project, channel));

  // Save BEFORE advancing. The cursor is a promise that these messages are
  // already accounted for — advancing first would drop them permanently on a
  // mid-run failure, and they can never be re-read.
  yield* QuestionStore.use((store) => store.save(rows));
  yield* Cursors.use((cursors) => cursors.set(channel.id, newest.id));
});

/**
 * The write side, for one Project. One bad channel must not kill the others.
 *
 * This is what the cron Worker will call. It returns nothing — the rows go to
 * the store, which is the only thing the read side ever touches.
 */
export const harvestQuestions = Effect.fn("harvestQuestions")(function* (
  project: Project
) {
  yield* Effect.forEach(
    project.channels,
    (channel) =>
      harvestChannel(project, channel).pipe(
        // Still swallowed — one bad channel must not kill the others — but a
        // dead token is a 401 on every channel, and silence reads as "no
        // questions today". The log is the difference between the two.
        Effect.catchCause((cause) =>
          Effect.logError(`harvest failed for ${channel.id}`, cause)
        )
      ),
    { concurrency: 3, discard: true }
  );
});
