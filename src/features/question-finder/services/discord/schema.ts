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
