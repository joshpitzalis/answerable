import { Schema } from "effect";

// RAW MESSAGES

const RawMessage = Schema.Struct({
  id: Schema.String,
  content: Schema.String,
  timestamp: Schema.String,
  channel_id: Schema.String,
  author: Schema.Struct({
    username: Schema.String,
    global_name: Schema.optional(Schema.NullOr(Schema.String)),
    // Optional: read off Discord's documented shape, not probed against the live API.
    id: Schema.optional(Schema.String),
    avatar: Schema.optional(Schema.NullOr(Schema.String)),
    /** `true` for bot and webhook accounts; absent or false for people. */
    bot: Schema.optional(Schema.Boolean),
  }),
  thread: Schema.optional(
    Schema.Struct({
      id: Schema.String,
      guild_id: Schema.optional(Schema.String),
      message_count: Schema.optional(Schema.Number),
    })
  ),
});

export type RawMessage = Schema.Schema.Type<typeof RawMessage>;

export const decodeMessages = Schema.decodeUnknownEffect(
  Schema.Array(RawMessage)
);

// CHANNELS

/** `GET /channels/{id}`: only the kind is read. */
export const decodeChannelKind = Schema.decodeUnknownEffect(
  Schema.Struct({ type: Schema.Number })
);

// FORUM POSTS

const RawPost = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  message_count: Schema.optional(Schema.Number),
  guild_id: Schema.optional(Schema.String),
});

export type RawPost = Schema.Schema.Type<typeof RawPost>;

/** `GET /channels/{forumId}/threads/search`: posts, and the first message of each. */
export const decodePostSearch = Schema.decodeUnknownEffect(
  Schema.Struct({
    threads: Schema.Array(RawPost),
    first_messages: Schema.optional(Schema.Array(RawMessage)),
    has_more: Schema.optional(Schema.Boolean),
  })
);
