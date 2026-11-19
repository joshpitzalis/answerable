import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { Corpus } from "../corpus";
import type { Post } from "../corpus";

const postsFor = (projectSlug: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const corpus = yield* Corpus;

      return yield* corpus.all(projectSlug);
    }).pipe(Effect.provide(Corpus.stub))
  );

describe("Corpus.all", () => {
  it("returns the Effect Project's Posts", async () => {
    const posts = await postsFor("effect");

    expect(posts.map((post) => post.slug)).toStrictEqual([
      "layers-once-per-isolate",
      "schema-at-the-boundary",
    ]);
  });

  it("returns the XState Project's Posts", async () => {
    const posts = await postsFor("xstate");

    expect(posts.map((post) => post.slug)).toStrictEqual([
      "stopping-child-actors",
      "guards-and-delays",
    ]);
  });

  it("returns no Posts for a Project that has none", async () => {
    await expect(postsFor("nope")).resolves.toStrictEqual([]);
  });
});

const snapshot = (post: Post) =>
  Effect.runPromise(
    Corpus.snapshot("example").pipe(
      Effect.provideService(
        Corpus,
        Corpus.of({ all: () => Effect.succeed([post]) })
      )
    )
  );

describe("Corpus.snapshot", () => {
  it("encodes the empty evidence digest as unambiguous fixed-width hexadecimal", async () => {
    const empty = await Effect.runPromise(
      Corpus.snapshot("nope").pipe(Effect.provide(Corpus.stub))
    );

    expect(empty).toStrictEqual({
      posts: [],
      revision:
        "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    });
  });

  it.each([
    { slug: "other" },
    { title: "Other title" },
    { body: "Other body" },
  ])(
    "versions changed evidence while preserving identical snapshots: %o",
    async (change) => {
      const original = {
        slug: "one",
        title: "First title",
        body: "First body",
      };

      const first = await snapshot(original);
      const unchanged = await snapshot({ ...original });
      const changed = await snapshot({ ...original, ...change });
      expect(unchanged).toStrictEqual(first);
      expect(changed.revision).not.toBe(first.revision);
      expect(changed.posts).toStrictEqual([{ ...original, ...change }]);
    }
  );
});
