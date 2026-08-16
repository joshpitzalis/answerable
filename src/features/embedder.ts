import { env } from "cloudflare:workers";
import { Context, Effect, Layer, ManagedRuntime, Option, Schema } from "effect";

/**
 * Everything in this file runs on the Worker and nowhere else.
 *
 * It is imported only from server function handlers. Importing it from a
 * component or a route loader would pull `cloudflare:workers` into the client
 * bundle, which is exactly the mistake the seam exists to prevent.
 */

export class EmbeddingFailed extends Schema.TaggedError<EmbeddingFailed>()(
	"EmbeddingFailed",
	{ reason: Schema.String },
) {}

/**
 * Workers AI types every field on this response as optional, and the model can
 * also hand back an async-queue receipt instead of vectors. So the response is
 * parsed rather than trusted.
 */
const EmbeddingResponse = Schema.Struct({
	data: Schema.NonEmptyArray(Schema.Array(Schema.Number)),
});

const decodeResponse = Schema.decodeUnknownOption(EmbeddingResponse);

export class Embedder extends Context.Service<
	Embedder,
	{
		readonly embed: (
			text: string,
		) => Effect.Effect<ReadonlyArray<number>, EmbeddingFailed>;
	}
>()("app/Embedder") {
	static readonly layer = Layer.sync(Embedder, () =>
		Embedder.of({
			embed: Effect.fn("Embedder.embed")(function* (text: string) {
				const raw = yield* Effect.tryPromise({
					try: () =>
						env.AI.run("@cf/baai/bge-base-en-v1.5", {
							text: [text],
							pooling: "cls",
						}),
					catch: (cause) => new EmbeddingFailed({ reason: String(cause) }),
				});

				const parsed = decodeResponse(raw);
				if (Option.isNone(parsed)) {
					return yield* new EmbeddingFailed({
						reason: "unexpected Workers AI response shape",
					});
				}

				return parsed.value.data[0];
			}),
		}),
	);
}

/**
 * One runtime per Worker isolate.
 *
 * ManagedRuntime builds its layers on first use, so nothing executes in
 * Cloudflare's global scope at import time — that would throw. There is no
 * dispose() call because workerd tears the isolate down itself.
 *
 * ponytail: single layer for now. Add services with Layer.mergeAll(A, B, C).
 */
export const runtime = ManagedRuntime.make(Embedder.layer);
