import { Schema } from "effect";

export class DiscordFailed extends Schema.TaggedError<DiscordFailed>()(
  "DiscordFailed",
  { reason: Schema.String }
) {}

/** Discord answered 429: try again after `retryAfterMs`. */
export class DiscordRateLimited extends Schema.TaggedError<DiscordRateLimited>()(
  "DiscordRateLimited",
  { retryAfterMs: Schema.Number, global: Schema.optional(Schema.Boolean) }
) {}
