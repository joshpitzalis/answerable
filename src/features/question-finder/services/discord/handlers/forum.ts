import { Effect } from "effect";

import { DiscordFailed } from "#/features/question-finder/services/discord/lib/errors";

import { decodeChannelKind, decodePostSearch } from "../schema";
import { discordGet } from "./discordGet";

/** Discord channel types whose threads are posts: forum and media channels. */
const POST_CHANNEL_TYPES: ReadonlySet<number> = new Set([15, 16]);

/** The most posts Discord serves in one `threads/search` page. */
export const POST_PAGE = 25;

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
 * Discord serves at most 25 posts a page (`limit` above that is a 400), so
 * `offset` picks the page.
 *
 * ponytail: only the 50 newest active posts are read per Harvest (two pages),
 * as with text Channels' 50 messages. Archived posts are never listed. Upgrade
 * path: also read `archived=true`, and page on (`has_more`) until the cursor.
 */
export const listPosts = Effect.fn("Discord.listPosts")(function* (
  channelId: string,
  token: string,
  fetch: typeof globalThis.fetch,
  offset = 0
) {
  const body = yield* discordGet(
    `/channels/${channelId}/threads/search?archived=false&sort_by=creation_time&sort_order=desc&limit=${POST_PAGE}&offset=${offset}`,
    token,
    fetch
  );

  return yield* decodePostSearch(body).pipe(
    Effect.mapError((error) => new DiscordFailed({ reason: error.message }))
  );
});
