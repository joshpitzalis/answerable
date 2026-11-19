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

  static readonly snapshot = (projectId: string) =>
    Effect.gen(function* () {
      const posts = yield* Corpus.use((corpus) => corpus.all(projectId));

      const encoded = new TextEncoder().encode(
        JSON.stringify(
          posts.map(({ slug, title, body }) => [slug, title, body])
        )
      );

      const digest = yield* Effect.promise(() =>
        crypto.subtle.digest("SHA-256", encoded)
      );

      return {
        posts,
        revision: Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0")
        ).join(""),
      };
    });
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

const XSTATE_POSTS: readonly Post[] = [
  {
    slug: "stopping-child-actors",
    title: "Stopping child actors when a machine finishes",
    body: "A parent machine stops the actors it spawned when it reaches a final state…",
  },
  {
    slug: "guards-and-delays",
    title: "Guards and delayed transitions in XState",
    body: "A guard reads the event and context; a delay restarts on re-entry…",
  },
];

const stubPostsFor = (projectSlug: string): readonly Post[] => {
  switch (projectSlug) {
    case "effect": {
      return EFFECT_POSTS;
    }

    case "xstate": {
      return XSTATE_POSTS;
    }

    default: {
      return [];
    }
  }
};
