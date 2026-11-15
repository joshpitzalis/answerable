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
  {
    readonly all: (projectSlug: string) => Effect.Effect<readonly Post[]>;
  }
>()("app/Corpus") {
  static readonly stub = Layer.sync(Corpus, () =>
    Corpus.of({
      all: (projectSlug) => Effect.succeed(stubPostsFor(projectSlug)),
    })
  );
}

const EFFECT_POSTS: readonly Post[] = [
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

const stubPostsFor = (projectSlug: string): readonly Post[] =>
  projectSlug === "effect" ? EFFECT_POSTS : [];
