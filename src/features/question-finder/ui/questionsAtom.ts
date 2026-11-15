import { Effect, Schema } from "effect";
import { Atom } from "effect/reactivity";

import { listQuestions } from "../index";
import { EFFECT_PROJECT } from "../lib/projects.config";

export class QuestionsUnavailable extends Schema.TaggedError<QuestionsUnavailable>()(
  "QuestionsUnavailable",
  { reason: Schema.String }
) {}

const fetchQuestions = Effect.tryPromise({
  try: () => listQuestions({ data: EFFECT_PROJECT.slug }),
  catch: (cause) => new QuestionsUnavailable({ reason: String(cause) }),
});

export const questionsAtom = Atom.make(fetchQuestions);
