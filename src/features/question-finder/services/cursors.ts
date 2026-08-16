import { Context, Effect, Layer, Option } from "effect";
import type { Snowflake } from "@/features/question-finder/services/discord/schema";
export class Cursors extends Context.Service<
	Cursors,
	{
		readonly get: (
			channelId: string,
		) => Effect.Effect<Option.Option<Snowflake>>;
		readonly set: (
			channelId: string,
			snowflake: Snowflake,
		) => Effect.Effect<void>;
	}
>()("app/Cursors") {
	// ponytail: in-memory Map. Becomes a D1 table — one row per channel — and
	// D1 is already needed for the rows, so no KV.
	static readonly stub = Layer.sync(Cursors, () => {
		const seen = new Map<string, Snowflake>();
		return Cursors.of({
			get: (channelId) =>
				Effect.sync(() => Option.fromNullishOr(seen.get(channelId))),
			set: (channelId, snowflake) =>
				Effect.sync(() => {
					seen.set(channelId, snowflake);
				}),
		});
	});
}
