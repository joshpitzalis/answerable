import { Schema } from "effect";

export type Snowflake = string;

// MESSAGES

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

// RAW MESSAGES

const RawMessage = Schema.Struct({
	id: Schema.String,
	content: Schema.String,
	timestamp: Schema.String,
	channel_id: Schema.String,
	author: Schema.Struct({
		username: Schema.String,
		global_name: Schema.optional(Schema.NullOr(Schema.String)),
	}),
	thread: Schema.optional(
		Schema.Struct({
			id: Schema.String,
			guild_id: Schema.optional(Schema.String),
			message_count: Schema.optional(Schema.Number),
		}),
	),
});

export type RawMessage = Schema.Schema.Type<typeof RawMessage>;

export const decodeMessages = Schema.decodeUnknownEffect(
	Schema.Array(RawMessage),
);
