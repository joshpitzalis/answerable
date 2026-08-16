import { Context, Effect, Layer, Option } from "effect";
import { toMessage } from "@/features/question-finder/services/discord/lib/DTOs";
import type { DiscordFailed } from "@/features/question-finder/services/discord/lib/errors";
import type {
	DiscordMessage,
	Snowflake,
} from "@/features/question-finder/services/discord/schema";
import { fixtureFetch, listMessages } from "./handlers";

/** Discord snowflake. Sorts lexicographically by time, which is why it works as a cursor. */

const make = (fetch: typeof globalThis.fetch, token: string) => {
	return {
		messagesSince: (channelId: string, cursor: Option.Option<Snowflake>) =>
			listMessages(
				`/channels/${channelId}/messages?limit=10${
					Option.isNone(cursor) ? "" : `&after=${cursor.value}`
				}`,
				token,
				fetch,
				// Discord answers newest-first; the pipeline wants oldest-first so the
				// last message it sees is the new cursor.
			).pipe(Effect.map((raw) => raw.map(toMessage).reverse())),

		hasReplyFrom: (threadId: string, authorName: string) =>
			listMessages(
				`/channels/${threadId}/messages?limit=10`,
				token,
				fetch,
			).pipe(
				Effect.map((raw) =>
					raw
						.map(toMessage)
						.some((message) => message.authorName === authorName),
				),
			),
	};
};

export class Discord extends Context.Service<
	Discord,
	{
		/** Messages newer than `cursor`, oldest first. `None` means "from the beginning". */
		readonly messagesSince: (
			channelId: string,
			cursor: Option.Option<Snowflake>,
		) => Effect.Effect<ReadonlyArray<DiscordMessage>, DiscordFailed>;
		readonly hasReplyFrom: (
			threadId: string,
			authorName: string,
		) => Effect.Effect<boolean, DiscordFailed>;
	}
>()("app/Discord") {
	/** Token is passed in, never read here — the secret lives in `env`. */
	static readonly layer = (token: string) =>
		Layer.sync(Discord, () =>
			Discord.of(make(globalThis.fetch.bind(globalThis), token)),
		);

	/** Same code — request building, decoding, mapping. Only the wire is faked. */
	static readonly stub = Layer.sync(Discord, () =>
		Discord.of(make(fixtureFetch, "stub-token")),
	);
}
