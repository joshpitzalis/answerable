import { Effect, Schema } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { listQuestions } from "./server";

export class QuestionsUnavailable extends Schema.TaggedError<QuestionsUnavailable>()(
	"QuestionsUnavailable",
	{ reason: Schema.String },
) {}

const fetchQuestions = Effect.tryPromise({
	try: () => listQuestions(),
	catch: (cause) => new QuestionsUnavailable({ reason: String(cause) }),
});

export const questionsAtom = Atom.make(fetchQuestions);
