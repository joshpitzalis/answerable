import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import type { QuestionsRow } from "../../domain";
import { QuestionStore } from "../question-store";

const row = (id: string, project: string, question = "q"): QuestionsRow => ({
  channel: { id: "c", name: "help" },
  comments: 0,
  dateAsked: new Date("2026-08-01T00:00:00Z"),
  id,
  isPost: false,
  name: "ada",
  project,
  question,
  url: "u",
});

const withStore = <A>(
  run: (store: QuestionStore["Service"]) => Effect.Effect<A>
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* run(yield* QuestionStore);
    }).pipe(Effect.provide(QuestionStore.stub))
  );

describe("QuestionStore.listOpen", () => {
  it("returns only the requested Project's rows", async () => {
    const listed = await withStore((store) =>
      Effect.gen(function* () {
        yield* store.save([row("1", "effect"), row("2", "xstate")]);

        return yield* store.listOpen("xstate");
      })
    );

    expect(listed.map((saved) => saved.id)).toStrictEqual(["2"]);
  });

  it("keeps one row per message id when saved twice", async () => {
    const listed = await withStore((store) =>
      Effect.gen(function* () {
        yield* store.save([row("1", "effect", "first")]);
        yield* store.save([row("1", "effect", "second")]);

        return yield* store.listOpen("effect");
      })
    );

    expect(listed.map((saved) => saved.question)).toStrictEqual(["second"]);
  });
});
