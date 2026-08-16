import { Schema } from "effect";

export const QuestionsRow = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	comments: Schema.Number,
	question: Schema.String,
	dateAsked: Schema.Date,
	url: Schema.String,
});

export type QuestionsRow = Schema.Schema.Type<typeof QuestionsRow>;
