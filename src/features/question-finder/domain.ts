import { Schema } from "effect";

/** Discord snowflake. Sorts lexicographically by time, which is why it works as a cursor. */
export type Snowflake = string;

export const DiscordMessage = Schema.Struct({
  id: Schema.String,
  threadId: Schema.String,
  authorName: Schema.String,
  content: Schema.String,
  replyCount: Schema.Number,
  createdAt: Schema.Date,
  /** Deep link to the message in the Discord client. */
  url: Schema.String,
});

export type DiscordMessage = Schema.Schema.Type<typeof DiscordMessage>;

export const QuestionsRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  comments: Schema.Number,
  question: Schema.String,
  dateAsked: Schema.Date,
  url: Schema.String,
});

export type QuestionsRow = Schema.Schema.Type<typeof QuestionsRow>;

// ponytail: '?' is enough for text channels. If these are forum channels every
// thread is already a question and this filter disappears entirely.
export const looksLikeAQuestion = (message: DiscordMessage): boolean =>
  message.content.includes("?");

export const toRow = (message: DiscordMessage): QuestionsRow => ({
  id: message.id,
  name: message.authorName,
  comments: message.replyCount,
  question: message.content,
  dateAsked: message.createdAt,
  url: message.url,
});
