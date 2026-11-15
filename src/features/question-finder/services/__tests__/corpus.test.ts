import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { Corpus } from "../corpus";

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

  it("returns no Posts for a Project that has none", async () => {
    await expect(postsFor("xstate")).resolves.toStrictEqual([]);
  });
});
