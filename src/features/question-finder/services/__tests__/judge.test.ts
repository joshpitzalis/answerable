import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { Corpus } from "../corpus";
import { Judge } from "../judge";

const verdictFor = (project: string, question: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const corpus = yield* Corpus;
      const judge = yield* Judge;

      return yield* judge.answerable(question, yield* corpus.all(project));
    }).pipe(Effect.provide(Layer.mergeAll(Corpus.stub, Judge.stub)))
  );

describe("Judge.answerable over the stub Corpus", () => {
  it("cites the Effect Post whose title shares a word with the question", async () => {
    await expect(
      verdictFor("effect", "Why build Layers more than once?")
    ).resolves.toStrictEqual({
      answerable: true,
      citedPost: "layers-once-per-isolate",
    });
    await expect(
      verdictFor("effect", "Where does schema decoding belong?")
    ).resolves.toStrictEqual({
      answerable: true,
      citedPost: "schema-at-the-boundary",
    });
  });

  it("finds a question answerable only by a Post of its own Project", async () => {
    await expect(
      verdictFor("xstate", "Why build Layers more than once?")
    ).resolves.toStrictEqual({ answerable: false });
  });

  it("ignores a shared word of four letters or fewer", async () => {
    // "when" is in the title "Stopping child actors when a machine finishes".
    await expect(
      verdictFor("xstate", "What happens when it ends?")
    ).resolves.toStrictEqual({ answerable: false });
  });
});
