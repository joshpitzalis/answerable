import { Effect } from "effect";

import { DiscordFailed } from "#/features/question-finder/services/discord/lib/errors";

import { decodeChannelKind, decodePostSearch } from "../schema";
import { discordGet } from "./discordGet";

/** Discord channel types whose threads are posts: forum and media channels. */
const POST_CHANNEL_TYPES: ReadonlySet<number> = new Set([15, 16]);

/** Whether `channelId` is a forum (or media) Channel, whose posts are its questions. */
export const isPostChannel = Effect.fn("Discord.isPostChannel")(function* (
  channelId: string,
  token: string,
  fetch: typeof globalThis.fetch
) {
  const body = yield* discordGet(`/channels/${channelId}`, token, fetch);

  const channel = yield* decodeChannelKind(body).pipe(
    Effect.mapError((error) => new DiscordFailed({ reason: error.message }))
  );

  return POST_CHANNEL_TYPES.has(channel.type);
});

/**
 * A forum Channel's active posts, newest first, with each post's first message.
 *
 * ponytail: only the 10 newest active posts are read per Harvest, as with text
 * Channels' 10 messages. Archived posts are never listed. Upgrade path: also
 * read `archived=true`, and page with `offset` (`has_more`) until the cursor.
 */
export const listPosts = Effect.fn("Discord.listPosts")(function* (
  channelId: string,
  token: string,
  fetch: typeof globalThis.fetch
) {
  const body = yield* discordGet(
    `/channels/${channelId}/threads/search?archived=false&sort_by=creation_time&sort_order=desc&limit=10&offset=0`,
    token,
    fetch
  );

  return yield* decodePostSearch(body).pipe(
    Effect.mapError((error) => new DiscordFailed({ reason: error.message }))
  );
});
