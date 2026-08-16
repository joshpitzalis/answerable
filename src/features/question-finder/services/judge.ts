import { Context, Effect, Layer, Schema } from "effect";
import type { Post } from "./corpus";

export const Verdict = Schema.Struct({
	answerable: Schema.Boolean,
	citedPost: Schema.optional(Schema.String),
});
export type Verdict = Schema.Schema.Type<typeof Verdict>;

export class JudgeFailed extends Schema.TaggedError<JudgeFailed>()(
	"JudgeFailed",
	{ reason: Schema.String },
) {}

export class Judge extends Context.Service<
	Judge,
	{
		readonly answerable: (
			question: string,
			posts: ReadonlyArray<Post>,
		) => Effect.Effect<Verdict, JudgeFailed>;
	}
>()("app/Judge") {
	/**
	 * Stub verdict: keyword overlap with a post title.
	 *
	 * The real one sends `question` + posts to Workers AI. Whole posts work
	 * until the corpus outgrows the context window; Vectorize + the existing
	 * `Embedder` is the upgrade, and it lands entirely inside this service.
	 */
	static readonly stub = Layer.sync(Judge, () =>
		Judge.of({
			answerable: (question, posts) =>
				Effect.sync(() => {
					const asked = question.toLowerCase();
					const hit = posts.find((post) =>
						post.title
							.toLowerCase()
							.split(" ")
							.some((word) => word.length > 4 && asked.includes(word)),
					);
					return hit === undefined
						? { answerable: false }
						: { answerable: true, citedPost: hit.slug };
				}),
		}),
	);
}
