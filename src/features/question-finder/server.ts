import { createServerFn } from "@tanstack/react-start";
import { Effect } from "effect";
import { CHANNELS, ME } from "./lib/constants";
import { toRow } from "./lib/DTOs";
import { looksLikeAQuestion } from "./lib/utils";
import { runtime } from "./runtime";
import type { QuestionsRow } from "./schema";
import { Corpus, Cursors, Discord, Judge, QuestionStore } from "./services";

/**
 * ─── THE SEAM ────────────────────────────────────────────────────────────────
 *
 * Below this line is the Worker. On the client this call collapses into a fetch.
 *
 * Surface Discord questions that are BOTH unanswered by me and answerable from
 * something I've already written.
 *
 * Filter order is the design: `Judge` costs an LLM call per question, the two
 * filters above it cost nothing and one cheap API call. A busy channel is
 * thousands of messages and maybe five answerable questions, so everything that
 * dies before `Judge` is money not spent.
 */

const harvestChannel = Effect.fn("harvestChannel")(function* (
	channelId: string,
) {
	const discord = yield* Discord;
	const cursor = yield* Cursors.use((cursors) => cursors.get(channelId));
	const messages = yield* discord.messagesSince(channelId, cursor);

	const newest = messages.at(-1);
	if (newest === undefined) return [];

	const asking = messages.filter(looksLikeAQuestion);

	const unanswered = yield* Effect.filter(asking, (message) =>
		Effect.map(
			discord.hasReplyFrom(message.threadId, ME),
			(replied) => !replied,
		),
	);

	const posts = yield* Corpus.use((corpus) => corpus.all());

	const judged = yield* Effect.forEach(
		unanswered,
		(message) =>
			Judge.use((judge) => judge.answerable(message.content, posts)).pipe(
				Effect.map((verdict) => ({ message, verdict })),
			),
		{ concurrency: 4 },
	);

	const rows = judged
		.filter(({ verdict }) => verdict.answerable)
		.map(({ message }) => toRow(message));

	// Save BEFORE advancing. The cursor is a promise that these messages are
	// already accounted for — advancing first would drop them permanently on a
	// mid-run failure, and they can never be re-read.
	yield* QuestionStore.use((store) => store.save(rows));
	yield* Cursors.use((cursors) => cursors.set(channelId, newest.id));
});

/**
 * The write side. One bad channel must not kill the others.
 *
 * This is what the cron Worker will call. It returns nothing — the rows go to
 * the store, which is the only thing the read side ever touches.
 */
export const harvestQuestions = Effect.fn("harvestQuestions")(function* () {
	yield* Effect.forEach(
		CHANNELS,
		(channelId) =>
			harvestChannel(channelId).pipe(
				// Still swallowed — one bad channel must not kill the others — but a
				// dead token is a 401 on every channel, and silence reads as "no
				// questions today". The log is the difference between the two.
				Effect.catchCause((cause) =>
					Effect.logError(`harvest failed for ${channelId}`, cause),
				),
			),
		{ concurrency: 3, discard: true },
	);
});

/**
 * The read side.
 *
 * ponytail: harvests inline first, because nothing else triggers it yet. Delete
 * that line the day a cron Worker calls `harvestQuestions` on a schedule — the
 * `listOpen` read below is already the final shape.
 */
export const listQuestions = createServerFn({ method: "GET" }).handler(
	(): Promise<QuestionsRow[]> =>
		runtime.runPromise(
			harvestQuestions().pipe(
				Effect.andThen(QuestionStore.use((store) => store.listOpen())),
			),
		),
);
