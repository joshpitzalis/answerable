import { Effect } from "effect";
import { DiscordFailed } from "@/features/question-finder/services/discord/lib/errors";
import { API } from "../lib/constants";
import { decodeMessages } from "../schema";

export const listMessages = Effect.fn("Discord.listMessages")(function* (
	path: string,
	token: string,
	fetch: typeof globalThis.fetch,
) {
	const response = yield* Effect.tryPromise({
		try: () =>
			fetch(`${API}${path}`, {
				headers: { Authorization: token },
			}),
		catch: (error) => new DiscordFailed({ reason: String(error) }),
	});

	if (!response.ok) {
		return yield* Effect.fail(
			new DiscordFailed({
				reason: `GET ${path} returned ${response.status}`,
			}),
		);
	}

	const body = yield* Effect.tryPromise({
		try: () => response.json(),
		catch: (error) => new DiscordFailed({ reason: String(error) }),
	});

	return yield* decodeMessages(body).pipe(
		Effect.mapError((error) => new DiscordFailed({ reason: error.message })),
	);
});
