import { Schema } from "effect";

export class DiscordFailed extends Schema.TaggedError<DiscordFailed>()(
	"DiscordFailed",
	{ reason: Schema.String },
) {}
