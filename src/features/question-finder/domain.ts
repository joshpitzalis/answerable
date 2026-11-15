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
  /** A forum post (title and first message) rather than a message in a text Channel. */
  isPost: Schema.Boolean,
});

export type DiscordMessage = Schema.Schema.Type<typeof DiscordMessage>;

export const Channel = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});

export type Channel = Schema.Schema.Type<typeof Channel>;

/** A library community: one Discord server, the Channels read in it, and who "I" am there. */
export interface Project {
  readonly slug: string;
  readonly label: string;
  readonly serverId: string;
  readonly channels: readonly Channel[];
  readonly ownerName: string;
}

export const QuestionsRow = Schema.Struct({
  id: Schema.String,
  project: Schema.String,
  channel: Channel,
  name: Schema.String,
  comments: Schema.Number,
  question: Schema.String,
  dateAsked: Schema.Date,
  url: Schema.String,
});

export type QuestionsRow = Schema.Schema.Type<typeof QuestionsRow>;

/** A Channel the Harvest could not read, for the page to name. Plain data. */
export interface FailedChannel {
  readonly name: string;
  readonly reason: string;
}

/** What the server function replies with. Plain data: failures are not thrown. */
export interface QuestionsReply {
  readonly questions: QuestionsRow[];
  readonly failedChannels: FailedChannel[];
}

// ponytail: '?' is enough for text channels. A forum post is a question by
// being a post, so it skips the rule.
export const looksLikeAQuestion = (message: DiscordMessage): boolean =>
  message.isPost || message.content.includes("?");

export const toRow = (
  message: DiscordMessage,
  project: Project,
  channel: Channel
): QuestionsRow => ({
  id: message.id,
  project: project.slug,
  channel,
  name: message.authorName,
  comments: message.replyCount,
  question: message.content,
  dateAsked: message.createdAt,
  url: message.url,
});
