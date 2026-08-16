import { Context, Effect, Layer } from "effect";
import type { QuestionsRow } from "../schema";

export class QuestionStore extends Context.Service<
	QuestionStore,
	{
		readonly save: (rows: ReadonlyArray<QuestionsRow>) => Effect.Effect<void>;
		readonly listOpen: () => Effect.Effect<QuestionsRow[]>;
	}
>()("app/QuestionStore") {
	// ponytail: in-memory Map keyed by id, so a re-harvest is idempotent.
	// Becomes a D1 table with `id` as primary key and an UPSERT.
	static readonly stub = Layer.sync(QuestionStore, () => {
		const byId = new Map<string, QuestionsRow>();
		return QuestionStore.of({
			save: (rows) =>
				Effect.sync(() => {
					for (const row of rows) byId.set(row.id, row);
				}),
			listOpen: () => Effect.sync(() => [...byId.values()]),
		});
	});
}
