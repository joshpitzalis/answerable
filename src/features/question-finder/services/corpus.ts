import { Context, Effect, Layer, Schema } from "effect";

/** A blog post I've written. The evidence `Judge` reasons over. */
export const Post = Schema.Struct({
	slug: Schema.String,
	title: Schema.String,
	body: Schema.String,
});
export type Post = Schema.Schema.Type<typeof Post>;

export class Corpus extends Context.Service<
	Corpus,
	{ readonly all: () => Effect.Effect<ReadonlyArray<Post>> }
>()("app/Corpus") {
	static readonly stub = Layer.sync(Corpus, () =>
		Corpus.of({ all: () => Effect.succeed(STUB_POSTS) }),
	);
}

const STUB_POSTS: ReadonlyArray<Post> = [
	{
		slug: "layers-once-per-isolate",
		title: "Building Effect Layers once per Worker isolate",
		body: "ManagedRuntime builds its layers on first use…",
	},
	{
		slug: "schema-at-the-boundary",
		title: "Schema decoding at the boundary",
		body: "Parse, don't validate — the seam is where unknown becomes typed…",
	},
];
