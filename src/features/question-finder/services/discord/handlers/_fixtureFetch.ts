import { ME } from "@/features/question-finder/lib/constants";
import FIXTURE from "@/features/question-finder/services/_fixtures/messages.json" with {
	type: "json",
};
import { ANSWERED_THREADS } from "@/features/question-finder/services/discord/lib/constants";

/**
 * ponytail: just enough of Discord's list-messages contract for the pipeline to
 * run — `after` filtering, newest-first ordering, thread replies. It serves the
 * captured fixture; the code under test above is the real client. Delete when
 * `Discord.layer` gets a token.
 */
export const fixtureFetch: typeof globalThis.fetch = (input) => {
	const url = new URL(String(input));
	// `/api/v10/channels/{id}/messages`
	const id = url.pathname.split("/").at(-2) ?? "";
	const after = url.searchParams.get("after");

	// The fixture holds forum starters. Anything that isn't a channel in it is
	// being read as a thread.
	const starters = FIXTURE.filter((message) => message.channel_id === id);
	if (starters.length === 0) return Promise.resolve(Response.json(replies(id)));

	// Already newest-first, same as the API.
	return Promise.resolve(
		Response.json(
			after === null
				? starters
				: starters.filter((message) => message.id > after),
		),
	);
};

const replies = (threadId: string) =>
	ANSWERED_THREADS.has(threadId)
		? [
				{
					id: `${threadId}-reply`,
					content: "Covered in an earlier post.",
					timestamp: "2026-08-10T00:00:00.000+00:00",
					channel_id: threadId,
					author: { username: ME, global_name: null },
				},
			]
		: [];
